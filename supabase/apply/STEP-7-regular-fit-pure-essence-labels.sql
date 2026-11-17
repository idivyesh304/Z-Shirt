-- =====================================================================
-- Z-SHIRTS · 015 · Regular Fit, Pure Essence plain tees, shop labels
-- Every tee now has a fit. Blank (plain) tee stock, purchase orders, damage
-- claims, production, SKUs, the shop catalogue and the profit reports all
-- keep Oversized and Regular apart.
-- =====================================================================

-- ---------------------------------------------------------------- 1. fit on products
alter table products add column if not exists fit text not null default 'oversized';
alter table products drop constraint if exists products_fit_check;
alter table products add constraint products_fit_check check (fit in ('oversized', 'regular'));
do $$ begin
  perform set_config('zs.internal', 'on', true);
  update products set fit = 'regular' where type ilike '%regular%' and fit <> 'regular';
end $$;

-- Pure Essence = plain tees with no design, listed by colour. Designed = printed tees.
alter table products add column if not exists line text not null default 'designed';
alter table products drop constraint if exists products_line_check;
alter table products add constraint products_line_check check (line in ('designed', 'plain'));
-- the shop label a partner or Mahendra picks when stock first comes in, changeable any time
alter table products add column if not exists shop_label text;
alter table products add column if not exists label_at timestamptz;
alter table products drop constraint if exists products_label_check;
alter table products add constraint products_label_check check (shop_label in ('new', 'bestseller', 'premium', 'coming_soon', 'prebook', 'restocked'));

create or replace function fit_label(p_fit text) returns text language sql immutable as $$
  select case p_fit when 'regular' then 'Regular Fit' else 'Oversized' end
$$;

-- ---------------------------------------------------------------- 2. fit on plain tee stock, POs, damage claims
alter table blank_moves add column if not exists fit text not null default 'oversized';
alter table blank_moves drop constraint if exists blank_moves_fit_check;
alter table blank_moves add constraint blank_moves_fit_check check (fit in ('oversized', 'regular'));

alter table po_items add column if not exists fit text check (fit in ('oversized', 'regular'));
alter table damage_claims add column if not exists fit text check (fit in ('oversized', 'regular'));

drop view if exists blank_stock;
create view blank_stock with (security_invoker = true) as
select initcap(colour) as colour, max(colour_hex) as colour_hex, size, sum(qty)::int as qty,
       sum(qty) filter (where reason = 'purchase')::int as bought, -sum(qty) filter (where reason = 'used')::int as used,
       fit, fit_label(fit) as fit_label,
       round(sum(cost) filter (where reason = 'purchase') / nullif(sum(qty) filter (where reason = 'purchase'), 0), 2) as avg_cost
from blank_moves group by initcap(colour), size, fit;
grant select on blank_stock to authenticated;

-- ---------------------------------------------------------------- 3. add plain tees with a fit
drop function if exists add_blanks(text, text, text, int, text, numeric, text);

CREATE OR REPLACE FUNCTION public.add_blanks(p_colour text, p_hex text, p_size text, p_qty integer, p_reason text DEFAULT 'purchase'::text, p_cost numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_fit text DEFAULT 'oversized'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m members := current_member(); v int; v_fit text := case when lower(coalesce(p_fit, '')) like 'regular%' then 'regular' else 'oversized' end;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p_colour), '') = '' or coalesce(trim(p_size), '') = '' then raise exception 'Choose colour and size.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many pieces.'; end if;
  if p_reason not in ('purchase', 'damaged') then raise exception 'Choose bought or damaged.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into blank_moves (colour, colour_hex, size, qty, reason, cost, note, by_member, fit)
  values (initcap(trim(p_colour)), p_hex, upper(trim(p_size)), case when p_reason = 'damaged' then -p_qty else p_qty end, p_reason, p_cost, p_note, m.id, v_fit);
  if p_reason = 'damaged' then
    perform _notify('stock', 'Blank tees damaged: ' || p_qty || ' × ' || fit_label(v_fit) || ' ' || initcap(p_colour) || ' ' || upper(p_size), coalesce(p_note, '') || ' · by ' || m.name, null, null, false, 'partners');
  end if;
  select coalesce(sum(qty), 0) into v from blank_moves where lower(colour) = lower(trim(p_colour)) and size = upper(trim(p_size)) and fit = v_fit;
  return v;
end $function$;
revoke execute on function add_blanks(text, text, text, int, text, numeric, text, text) from public, anon;
grant execute on function add_blanks(text, text, text, int, text, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------- 4. production uses plain tees of the same fit

CREATE OR REPLACE FUNCTION public.set_batch_stage(p_id bigint, p_stage text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  b production_batches;
  it jsonb;
  v_qty int := 0;
  v_have int;
  v_cost numeric;
  v_old numeric;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into b from production_batches where id = p_id for update;
  if b.id is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('ready', 'cancelled') then raise exception 'This batch is already %.', b.stage; end if;
  if p_stage not in ('planned', 'blanks', 'printing', 'quality_check', 'ready', 'cancelled') then raise exception 'Unknown stage.'; end if;
  perform set_config('zs.internal', 'on', true);
  -- printing starts: the plain tees leave blank stock (only for colours you track as blanks)
  if p_stage in ('printing', 'quality_check', 'ready') and not exists (select 1 from blank_moves where batch_id = b.id) then
    insert into blank_moves (colour, colour_hex, size, qty, reason, batch_id, note, by_member, fit)
    select initcap(pv.colour), pv.colour_hex, pv.size, -(bi->>'qty')::int, 'used', b.id, 'Batch ' || b.code, m.id, pr.fit
    from jsonb_array_elements(b.items) bi join product_variants pv on pv.id = (bi->>'variant_id')::bigint
         join products pr on pr.id = pv.product_id
    where exists (select 1 from blank_moves bm where lower(bm.colour) = lower(pv.colour) and bm.size = pv.size and bm.fit = pr.fit);
  end if;
  -- DTF prints for this design leave DTF stock at the same time (only if you track DTF for this tee)
  if p_stage in ('printing', 'quality_check', 'ready') and not exists (select 1 from dtf_moves where batch_id = b.id)
     and exists (select 1 from dtf_moves where product_id = b.product_id) then
    insert into dtf_moves (product_id, qty, reason, batch_id, note, by_member)
    select b.product_id, -sum((bi->>'qty')::int), 'used', b.id, 'Batch ' || b.code, m.id from jsonb_array_elements(b.items) bi;
  end if;
  if p_stage = 'ready' then
    select coalesce(sum(greatest(stock_of(pv.id), 0)), 0) into v_have from product_variants pv where pv.product_id = b.product_id;
    for it in select * from jsonb_array_elements(b.items) loop
      insert into stock_moves (variant_id, qty, reason, note, by_member)
      values ((it->>'variant_id')::bigint, (it->>'qty')::int, 'production', 'Batch ' || b.code, m.id);
      v_qty := v_qty + (it->>'qty')::int;
    end loop;
    v_cost := (b.blank_cost + b.print_cost + b.other_cost);
    if v_qty > 0 and v_cost > 0 then
      select cost_price into v_old from products where id = b.product_id;
      update products set cost_price = round((v_old * v_have + v_cost) / (v_have + v_qty), 2) where id = b.product_id;
    end if;
    perform _notify('stock', 'Batch ready: ' || b.code, v_qty || ' pieces added to stock', null, null, true);
  end if;
  update production_batches set stage = p_stage, updated_at = now(),
         ready_at = case when p_stage = 'ready' then now() end where id = b.id;
  return p_stage;
end $function$;


-- ---------------------------------------------------------------- 5. damage claims know the fit

CREATE OR REPLACE FUNCTION public.report_damage(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  v_item text := p->>'item';
  v_qty int := (p->>'qty')::int;
  v_prod bigint := nullif(p->>'product_id', '')::bigint;
  v_var bigint := nullif(p->>'variant_id', '')::bigint;
  v_colour text := initcap(trim(coalesce(p->>'colour', '')));
  v_size text := upper(trim(coalesce(p->>'size', '')));
  v_hex text;
  v_fit text := case when lower(coalesce(p->>'fit', '')) like 'regular%' then 'regular' else 'oversized' end;
  v_photos text[];
  v_have int;
  v_cost numeric;
  v_name text;
  v_id bigint;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if v_item not in ('dtf', 'blank', 'tee') then raise exception 'Choose what is damaged: DTF print, blank tee or printed tee.'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter how many pieces are damaged.'; end if;
  if coalesce(trim(p->>'vendor'), '') = '' then raise exception 'Write the vendor who supplied it.'; end if;
  if coalesce(p->>'ask', '') not in ('return', 'refund', 'replace') then raise exception 'Choose return, refund or replace.'; end if;
  if coalesce(length(trim(p->>'reason')), 0) < 3 then raise exception 'Write what is wrong with it.'; end if;
  select array_agg(x) into v_photos from jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x where trim(x) <> '';
  if coalesce(array_length(v_photos, 1), 0) = 0 then raise exception 'Add at least one photo of the damage.'; end if;

  if v_item = 'dtf' then
    select name, fit into v_name, v_fit from products where id = v_prod;
    if v_name is null then raise exception 'Choose the design.'; end if;
    select coalesce(sum(qty), 0) into v_have from dtf_moves where product_id = v_prod;
    select cost_per_print into v_cost from dtf_stock where product_id = v_prod;
  elsif v_item = 'blank' then
    if v_colour = '' or v_size = '' then raise exception 'Choose colour and size.'; end if;
    select coalesce(sum(qty), 0), max(colour_hex) into v_have, v_hex from blank_moves where lower(colour) = lower(v_colour) and size = v_size and fit = v_fit;
    select round(sum(cost) / nullif(sum(qty), 0), 2) into v_cost from blank_moves
      where lower(colour) = lower(v_colour) and fit = v_fit and reason = 'purchase' and cost is not null;
    v_name := fit_label(v_fit) || ' ' || v_colour || ' ' || v_size || ' blank';
  else
    select pv.product_id, p2.name || ' ' || pv.colour || ' ' || pv.size, p2.cost_price, p2.fit into v_prod, v_name, v_cost, v_fit
      from product_variants pv join products p2 on p2.id = pv.product_id where pv.id = v_var;
    if v_name is null then raise exception 'Choose the tee, colour and size.'; end if;
    v_have := stock_of(v_var);
    v_prod := null;
  end if;
  if v_qty > v_have then raise exception 'Only % in stock. You cannot mark more as damaged.', v_have; end if;

  perform set_config('zs.internal', 'on', true);
  insert into damage_claims (item, product_id, variant_id, colour, colour_hex, size, qty, vendor, ask, reason, photos, unit_cost, value, reported_by, fit)
  values (v_item, v_prod, case when v_item = 'tee' then v_var end, nullif(v_colour, ''), v_hex, nullif(v_size, ''), v_qty,
          trim(p->>'vendor'), p->>'ask', trim(p->>'reason'), v_photos, v_cost, round(v_cost * v_qty, 2), m.id, v_fit)
  returning id into v_id;

  if v_item = 'dtf' then
    insert into dtf_moves (product_id, qty, reason, note, by_member) values (v_prod, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id);
  elsif v_item = 'blank' then
    insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member, fit) values (v_colour, v_hex, v_size, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id, v_fit);
  else
    insert into stock_moves (variant_id, qty, reason, note, by_member) values (v_var, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id);
  end if;

  perform _notify('stock', 'Damaged: ' || v_qty || ' × ' || v_name,
    'Asking ' || trim(p->>'vendor') || ' to ' || (p->>'ask') || ' · ' || trim(p->>'reason') || ' · by ' || m.name, null, round(v_cost * v_qty, 2), false, 'partners');
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.damage_update(p_id bigint, p_action text, p_qty integer DEFAULT 0, p_amount numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_photo text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  d damage_claims;
  v_req bigint;
  v_status text;
  v_label text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into d from damage_claims where id = p_id for update;
  if d.id is null then raise exception 'Claim not found.'; end if;
  v_label := 'Claim #' || d.id || ' · ' || d.vendor;
  perform set_config('zs.internal', 'on', true);

  if p_action = 'sent' then
    if d.status <> 'reported' then raise exception 'This claim is already %.', d.status; end if;
    update damage_claims set status = 'sent', sent_at = now(), sent_by = m.id,
           settle_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), settle_note) where id = d.id;
    return 'sent';

  elsif p_action = 'settle' then
    if d.status not in ('reported', 'sent') then raise exception 'This claim is already %.', d.status; end if;
    p_qty := coalesce(p_qty, 0); p_amount := coalesce(p_amount, 0);
    if p_qty < 0 or p_amount < 0 then raise exception 'Numbers cannot be negative.'; end if;
    if p_qty = 0 and p_amount = 0 then raise exception 'Enter the pieces replaced or the money refunded.'; end if;
    if p_qty > d.qty then raise exception 'Only % pieces were damaged.', d.qty; end if;
    if p_amount > 0 and coalesce(trim(p_photo), '') = '' then raise exception 'Add a photo of the refund (UPI screenshot or credit note).'; end if;
    if p_qty > 0 then
      if d.item = 'dtf' then
        insert into dtf_moves (product_id, qty, reason, note, by_member) values (d.product_id, p_qty, 'replaced', v_label || ' replaced', m.id);
      elsif d.item = 'blank' then
        insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member, fit) values (d.colour, d.colour_hex, d.size, p_qty, 'replaced', v_label || ' replaced', m.id, coalesce(d.fit, 'oversized'));
      else
        insert into stock_moves (variant_id, qty, reason, note, by_member) values (d.variant_id, p_qty, 'vendor_replace', v_label || ' replaced', m.id);
      end if;
    end if;
    if p_amount > 0 then
      -- vendor money goes into the books like any other income (partners approve it)
      v_req := raise_request('income', p_amount, 'Vendor refund · ' || v_label || ' · ' || d.qty || ' damaged pieces', p_photo,
                             jsonb_build_object('category', 'vendor_refund', 'damage_claim', d.id));
      perform set_config('zs.internal', 'on', true);
    end if;
    v_status := case when p_qty > 0 and p_amount > 0 then 'settled' when p_qty > 0 then 'replaced' else 'refunded' end;
    update damage_claims set status = v_status, replaced_qty = p_qty, refund_amount = p_amount, refund_request = v_req,
           settled_at = now(), settled_by = m.id, settle_note = nullif(trim(coalesce(p_note, '')), ''), settle_photo = nullif(trim(coalesce(p_photo, '')), '')
    where id = d.id;
    perform _notify('stock', 'Vendor settled · ' || v_label,
      case when p_qty > 0 then p_qty || ' replaced' else '' end || case when p_qty > 0 and p_amount > 0 then ' · ' else '' end ||
      case when p_amount > 0 then '₹' || p_amount || ' refund (needs approval)' else '' end || ' · by ' || m.name, null, p_amount, false, 'partners');
    return v_status;

  elsif p_action = 'rejected' then
    if d.status not in ('reported', 'sent') then raise exception 'This claim is already %.', d.status; end if;
    if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Write what the vendor said.'; end if;
    update damage_claims set status = 'rejected', settled_at = now(), settled_by = m.id, settle_note = trim(p_note) where id = d.id;
    perform _notify('approval', 'Vendor refused · ' || v_label, coalesce(d.value::text, '?') || ' rupees lost · ' || trim(p_note) || ' · by ' || m.name,
      null, d.value, false, 'partners');
    return 'rejected';

  elsif p_action = 'cancel' then
    if d.status <> 'reported' then raise exception 'Only a claim not yet sent to the vendor can be cancelled.'; end if;
    if not is_partner() and d.reported_by <> m.id then raise exception 'Only the person who reported it or a partner can cancel.'; end if;
    if d.item = 'dtf' then
      insert into dtf_moves (product_id, qty, reason, note, by_member) values (d.product_id, d.qty, 'adjust', v_label || ' cancelled', m.id);
    elsif d.item = 'blank' then
      insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member, fit) values (d.colour, d.colour_hex, d.size, d.qty, 'adjust', v_label || ' cancelled', m.id, coalesce(d.fit, 'oversized'));
    else
      insert into stock_moves (variant_id, qty, reason, note, by_member) values (d.variant_id, d.qty, 'damage_undo', v_label || ' cancelled', m.id);
    end if;
    update damage_claims set status = 'cancelled', settled_at = now(), settled_by = m.id, settle_note = nullif(trim(coalesce(p_note, '')), '') where id = d.id;
    return 'cancelled';
  end if;
  raise exception 'Unknown step.';
end $function$;

create or replace view damage_board with (security_invoker = true) as
SELECT d.id,
    d.item,
    d.product_id,
    d.variant_id,
    d.colour,
    d.colour_hex,
    d.size,
    d.qty,
    d.vendor,
    d.ask,
    d.reason,
    d.photos,
    d.unit_cost,
    d.value,
    d.status,
    d.replaced_qty,
    d.refund_amount,
    d.refund_request,
    d.sent_at,
    d.sent_by,
    d.settled_at,
    d.settled_by,
    d.settle_note,
    d.settle_photo,
    d.reported_by,
    d.created_at,
        CASE d.item
            WHEN 'dtf'::text THEN 'DTF print'::text
            WHEN 'blank'::text THEN 'Blank tee'::text
            ELSE 'Printed tee'::text
        END AS item_label,
    COALESCE(p.name, ''::text) ||
        CASE
            WHEN d.item = 'tee'::text THEN ((' · '::text || pv.colour) || ' / '::text) || pv.size
            WHEN d.item = 'blank'::text THEN (((fit_label(COALESCE(d.fit, 'oversized'::text)) || ' · '::text) || d.colour) || ' / '::text) || d.size
            ELSE ''::text
        END AS what,
    r.name AS reported_by_name,
    s.name AS settled_by_name,
    rq.status::text AS refund_status,
    COALESCE(d.fit, p.fit) AS fit
   FROM damage_claims d
     LEFT JOIN products p ON p.id = COALESCE(d.product_id, ( SELECT product_variants.product_id
           FROM product_variants
          WHERE product_variants.id = d.variant_id))
     LEFT JOIN product_variants pv ON pv.id = d.variant_id
     LEFT JOIN members r ON r.id = d.reported_by
     LEFT JOIN members s ON s.id = d.settled_by
     LEFT JOIN requests rq ON rq.id = d.refund_request;


-- ---------------------------------------------------------------- 6. purchase orders for plain tees carry the fit

CREATE OR REPLACE FUNCTION public.save_po(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  po purchase_orders;
  v vendors;
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_type text := p->>'po_type';
  v_mode text;
  v_my_state text := coalesce(nullif(trim(setting_text('business_state_code')), ''), '24');
  it jsonb;
  i int := 0;
  v_sub numeric := 0; v_disc numeric := 0; v_tax numeric := 0; v_line_gross numeric; v_line_tax numeric; v_line_taxable numeric;
  v_fr numeric := round(coalesce((p->>'freight')::numeric, 0), 2);
  v_fr_tax numeric := 0; v_frate numeric := coalesce(setting_num('po_freight_gst'), 18);
  v_raw numeric; v_grand numeric; v_terms text[];
  v_rate numeric;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if v_type not in ('plain', 'dtf', 'embroidery', 'patchwork', 'other') then raise exception 'Choose the PO type.'; end if;
  select * into v from vendors where id = (p->>'vendor_id')::bigint;
  if v.id is null or not v.active then raise exception 'Choose an active vendor.'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Add at least one item.'; end if;
  if v_fr < 0 then raise exception 'Freight cannot be negative.'; end if;
  if (p->>'delivery_date') is not null and (p->>'delivery_date')::date < today_ist() then raise exception 'The delivery date is in the past.'; end if;
  select array_agg(trim(t)) into v_terms from jsonb_array_elements_text(coalesce(p->'terms', '[]'::jsonb)) t where trim(t) <> '';
  if coalesce(array_length(v_terms, 1), 0) = 0 then raise exception 'Tick at least one term and condition.'; end if;

  v_mode := case when v.gstin is null then 'none' when v.state_code = v_my_state then 'cgst_sgst' else 'igst' end;

  if v_id is not null then
    select * into po from purchase_orders where id = v_id for update;
    if po.id is null then raise exception 'PO not found.'; end if;
    if po.status not in ('draft', 'rejected') then raise exception 'Only a draft or a rejected PO can be edited. Make a copy instead.'; end if;
    if not is_partner() and po.created_by <> m.id then raise exception 'Only the person who made it or a partner can edit this PO.'; end if;
  end if;

  perform set_config('zs.internal', 'on', true);
  if v_id is null then
    insert into purchase_orders (po_no, po_type, vendor_id, vendor, tax_mode, created_by, copied_from)
    values (next_po_no(), v_type, v.id, '{}', v_mode, m.id, nullif(p->>'copied_from', '')::bigint) returning * into po;
  else
    delete from po_items where po_id = po.id;
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    i := i + 1;
    if coalesce(length(trim(it->>'description')), 0) < 2 then raise exception 'Line %: write what you are ordering.', i; end if;
    if coalesce((it->>'qty')::numeric, 0) <= 0 then raise exception 'Line %: enter the quantity.', i; end if;
    if coalesce((it->>'rate')::numeric, -1) < 0 then raise exception 'Line %: enter the rate.', i; end if;
    v_rate := case when v_mode = 'none' then 0 else coalesce((it->>'gst_rate')::numeric, 5) end;
    if v_rate not in (0, 3, 5, 12, 18, 28, 40) then raise exception 'Line %: GST rate must be 0, 5, 12, 18, 28 or 40%%.', i; end if;
    v_line_gross := round((it->>'qty')::numeric * (it->>'rate')::numeric, 2);
    v_line_taxable := round(v_line_gross * (1 - coalesce((it->>'disc_pct')::numeric, 0) / 100), 2);
    v_line_tax := round(v_line_taxable * v_rate / 100, 2);
    v_sub := v_sub + v_line_gross; v_disc := v_disc + (v_line_gross - v_line_taxable); v_tax := v_tax + v_line_tax;
    insert into po_items (po_id, line_no, description, specs, hsn, unit, qty, rate, disc_pct, gst_rate, taxable, tax, total,
                          product_id, colour, colour_hex, size, fit)
    values (po.id, i, trim(it->>'description'), coalesce(it->'specs', '{}'::jsonb), nullif(trim(it->>'hsn'), ''), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::numeric, (it->>'rate')::numeric, coalesce((it->>'disc_pct')::numeric, 0), v_rate, v_line_taxable, v_line_tax, v_line_taxable + v_line_tax,
            nullif(it->>'product_id', '')::bigint, nullif(initcap(trim(coalesce(it->>'colour', ''))), ''), nullif(it->>'colour_hex', ''), nullif(upper(trim(coalesce(it->>'size', ''))), ''),
            case when po.po_type = 'plain' then case when lower(coalesce(coalesce(it->>'fit', it->'specs'->>'fit'), '')) like 'regular%' then 'regular' else 'oversized' end end);
  end loop;

  if v_mode <> 'none' and v_fr > 0 then v_fr_tax := round(v_fr * v_frate / 100, 2); end if;
  v_raw := (v_sub - v_disc) + v_tax + v_fr + v_fr_tax;
  v_grand := round(v_raw, 0);

  update purchase_orders set
    po_type = v_type, vendor_id = v.id,
    vendor = jsonb_build_object('code', v.code, 'name', v.name, 'contact_person', v.contact_person, 'phone', v.phone, 'email', v.email,
      'gstin', v.gstin, 'pan', v.pan, 'state_code', v.state_code, 'state', (select name from gst_states where code = v.state_code),
      'address', v.address, 'city', v.city, 'pincode', v.pincode, 'bank_name', v.bank_name, 'bank_account', v.bank_account, 'ifsc', v.ifsc, 'upi', v.upi),
    delivery_date = nullif(p->>'delivery_date', '')::date,
    ship_to = coalesce(nullif(trim(p->>'ship_to'), ''), nullif(setting_text('po_ship_to'), ''), setting_text('business_address')),
    quotation_ref = nullif(trim(p->>'quotation_ref'), ''),
    tax_mode = v_mode, subtotal = v_sub, discount = v_disc, taxable = v_sub - v_disc,
    cgst = case when v_mode = 'cgst_sgst' then round((v_tax + v_fr_tax) / 2, 2) else 0 end,
    sgst = case when v_mode = 'cgst_sgst' then (v_tax + v_fr_tax) - round((v_tax + v_fr_tax) / 2, 2) else 0 end,
    igst = case when v_mode = 'igst' then v_tax + v_fr_tax else 0 end,
    freight = v_fr, freight_tax = v_fr_tax, round_off = v_grand - v_raw, grand_total = v_grand,
    terms = v_terms, payment_terms = nullif(trim(p->>'payment_terms'), ''),
    advance_pct = least(greatest(coalesce((p->>'advance_pct')::numeric, 0), 0), 100), notes = nullif(trim(p->>'notes'), ''),
    status = 'draft', updated_at = now()
  where id = po.id returning * into po;
  return jsonb_build_object('id', po.id, 'po_no', po.po_no, 'grand_total', po.grand_total, 'tax_mode', po.tax_mode);
end $function$;

CREATE OR REPLACE FUNCTION public.po_action(p_id bigint, p_action text, p_note text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  po purchase_orders;
  it po_items;
  x jsonb;
  q numeric;
  v_left numeric;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into po from purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'PO not found.'; end if;
  perform set_config('zs.internal', 'on', true);

  if p_action = 'sent' then
    if po.status <> 'approved' then raise exception 'Only an approved PO can be sent to the vendor.'; end if;
    update purchase_orders set status = 'sent', sent_at = now(), updated_at = now() where id = po.id;
    return 'sent';

  elsif p_action = 'receive' then
    if po.status not in ('approved', 'sent', 'partly_received') then raise exception 'Only an approved PO can be received.'; end if;
    for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      q := coalesce((x->>'qty')::numeric, 0);
      continue when q = 0;
      select * into it from po_items where id = (x->>'item_id')::bigint and po_id = po.id for update;
      if it.id is null then raise exception 'Item not in this PO.'; end if;
      if q < 0 or it.received_qty + q > it.qty then raise exception '% : only % left to receive.', it.description, it.qty - it.received_qty; end if;
      update po_items set received_qty = received_qty + q where id = it.id;
      -- plain tees go into blank stock, DTF prints into DTF stock
      if po.po_type = 'plain' and it.colour is not null and it.size is not null then
        insert into blank_moves (colour, colour_hex, size, qty, reason, cost, note, by_member, fit)
        values (it.colour, it.colour_hex, it.size, q::int, 'purchase', round(it.total / it.qty * q, 2), 'PO ' || po.po_no || ' · ' || (po.vendor->>'name'), m.id, coalesce(it.fit, 'oversized'));
      elsif po.po_type = 'dtf' and it.product_id is not null then
        insert into dtf_moves (product_id, qty, reason, cost, note, by_member)
        values (it.product_id, q::int, 'purchase', round(it.total / it.qty * q, 2), 'PO ' || po.po_no || ' · ' || (po.vendor->>'name'), m.id);
      end if;
    end loop;
    select coalesce(sum(qty - received_qty), 0) into v_left from po_items where po_id = po.id;
    update purchase_orders set status = case when v_left = 0 then 'received' else 'partly_received' end,
           received_at = case when v_left = 0 then now() else received_at end, updated_at = now() where id = po.id;
    perform _notify('stock', case when v_left = 0 then 'PO received in full · ' else 'PO partly received · ' end || po.po_no,
      (po.vendor->>'name') || ' · checked in by ' || m.name, null, null, false, 'partners');
    return case when v_left = 0 then 'received' else 'partly_received' end;

  elsif p_action = 'cancel' then
    if po.status in ('received', 'partly_received', 'cancelled') then raise exception 'This PO cannot be cancelled now.'; end if;
    if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Write why it is cancelled.'; end if;
    if po.status in ('approved', 'sent') and not is_partner() then raise exception 'Only partners can cancel an approved PO.'; end if;
    if po.status in ('draft', 'pending', 'rejected') and not is_partner() and po.created_by <> m.id then raise exception 'Only the person who made it or a partner can cancel.'; end if;
    if po.status = 'pending' then
      update requests set status = 'cancelled', decided_at = now() where id = po.request_id and status = 'pending';
    end if;
    update purchase_orders set status = 'cancelled', cancelled_note = trim(p_note), updated_at = now() where id = po.id;
    if po.status in ('approved', 'sent') then
      perform _notify('approval', 'PO cancelled · ' || po.po_no, trim(p_note) || ' · by ' || m.name, null, po.grand_total, false, 'partners');
    end if;
    return 'cancelled';
  end if;
  raise exception 'Unknown step.';
end $function$;


-- ---------------------------------------------------------------- 7. shop labels
create or replace function set_product_label(p_product bigint, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); pr products; v text := nullif(lower(trim(coalesce(p_label, ''))), '');
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if v = 'none' then v := null; end if;
  if v is not null and v not in ('new', 'bestseller', 'premium', 'coming_soon', 'prebook', 'restocked') then raise exception 'Unknown label.'; end if;
  select * into pr from products where id = p_product;
  if pr.id is null then raise exception 'Product not found.'; end if;
  perform set_config('zs.internal', 'on', true);
  -- Pre-book lets customers order with 0 stock; moving away from it switches that off again
  update products set shop_label = v, label_at = now(),
         is_preorder = case when v = 'prebook' then true when pr.shop_label = 'prebook' then false else is_preorder end
   where id = pr.id;
  return coalesce(v, 'none');
end $$;
revoke execute on function set_product_label(bigint, text) from public, anon;
grant execute on function set_product_label(bigint, text) to authenticated;

-- Pure Essence: plain tees go from blank stock straight to the shop (no printing)
create or replace function blanks_to_shop(p_product bigint, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member(); pr products; it jsonb; pv product_variants;
  q int; have int; v_total int := 0; v_cost numeric; v_have_shop int; v_add_cost numeric := 0;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into pr from products where id = p_product;
  if pr.id is null or pr.line <> 'plain' then raise exception 'Only Pure Essence (plain) tees can be moved from blank stock.'; end if;
  perform set_config('zs.internal', 'on', true);
  select coalesce(sum(greatest(stock_of(x.id), 0)), 0) into v_have_shop from product_variants x where x.product_id = pr.id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    q := coalesce((it->>'qty')::int, 0);
    continue when q <= 0;
    select * into pv from product_variants where id = (it->>'variant_id')::bigint and product_id = pr.id;
    if pv.id is null then raise exception 'That colour / size is not part of this tee.'; end if;
    select coalesce(sum(qty), 0) into have from blank_moves where lower(colour) = lower(pv.colour) and size = pv.size and fit = pr.fit;
    if q > have then raise exception 'Only % plain % % % in blank stock.', have, fit_label(pr.fit), pv.colour, pv.size; end if;
    select round(sum(cost) filter (where reason = 'purchase') / nullif(sum(qty) filter (where reason = 'purchase'), 0), 2) into v_cost
      from blank_moves where lower(colour) = lower(pv.colour) and fit = pr.fit;
    insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member, fit)
    values (initcap(pv.colour), pv.colour_hex, pv.size, -q, 'used', 'Moved to shop · ' || pr.name, m.id, pr.fit);
    insert into stock_moves (variant_id, qty, reason, note, by_member) values (pv.id, q, 'production', 'From blank stock', m.id);
    v_total := v_total + q; v_add_cost := v_add_cost + coalesce(v_cost, 0) * q;
  end loop;
  if v_total = 0 then raise exception 'Enter how many pieces to move.'; end if;
  if v_add_cost > 0 then
    update products set cost_price = round((coalesce(cost_price, 0) * v_have_shop + v_add_cost) / (v_have_shop + v_total), 2) where id = pr.id;
  end if;
  perform _notify('stock', 'Pure Essence restocked: ' || v_total || ' pieces', pr.name || ' · by ' || m.name, null, null, false, 'partners');
  return v_total;
end $$;
revoke execute on function blanks_to_shop(bigint, jsonb) from public, anon;
grant execute on function blanks_to_shop(bigint, jsonb) to authenticated;


-- ---------------------------------------------------------------- 8. products: save the fit, fit code in new SKUs

CREATE OR REPLACE FUNCTION public.upsert_product(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m members := current_member();
  old products;
  v_id bigint;
  v jsonb;
  v_slug text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the product name.'; end if;
  if (p->>'mrp')::numeric is null or (p->>'price')::numeric is null then raise exception 'Enter MRP and selling price.'; end if;
  if (p->>'price')::numeric > (p->>'mrp')::numeric then raise exception 'Selling price cannot be more than MRP.'; end if;

  perform set_config('zs.internal', 'on', true);

  if p->>'id' is null then
    v_slug := slugify(p->>'name');
    if exists (select 1 from products where slug = v_slug) then
      v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
    end if;
    insert into products (name, slug, category_id, type, description, fabric, gsm, mrp, price, gst_rate,
                          images, tags, featured, created_by, published_at)
    values (trim(p->>'name'), v_slug, (p->>'category_id')::bigint, coalesce(nullif(p->>'type', ''), 'Oversized Tee'),
            coalesce(p->>'description', ''), p->>'fabric', (p->>'gsm')::int,
            (p->>'mrp')::numeric, (p->>'price')::numeric, coalesce((p->>'gst_rate')::numeric, 5),
            coalesce(array(select jsonb_array_elements_text(p->'images')), '{}'),
            coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}'),
            coalesce((p->>'featured')::boolean, false), m.id,
            -- partners publish straight away; Mahendra's products wait for a partner
            case when m.role = 'partner' and coalesce((p->>'publish')::boolean, true) then now() end)
    returning id into v_id;
  else
    select * into old from products where id = (p->>'id')::bigint;
    if old.id is null then raise exception 'Product not found.'; end if;
    if old.published_at is not null
       and ((p->>'price')::numeric <> old.price or (p->>'mrp')::numeric <> old.mrp) then
      raise exception 'This product is live. Changing its price needs all partners — use "Request price change".';
    end if;
    update products set
      name = trim(p->>'name'), category_id = (p->>'category_id')::bigint,
      type = coalesce(nullif(p->>'type', ''), type), description = coalesce(p->>'description', ''),
      fabric = p->>'fabric', gsm = (p->>'gsm')::int,
      mrp = (p->>'mrp')::numeric, price = (p->>'price')::numeric,
      gst_rate = coalesce((p->>'gst_rate')::numeric, gst_rate),
      images = coalesce(array(select jsonb_array_elements_text(p->'images')), images),
      tags = coalesce(array(select jsonb_array_elements_text(p->'tags')), tags),
      featured = coalesce((p->>'featured')::boolean, featured),
      active = coalesce((p->>'active')::boolean, active)
    where id = old.id;
    v_id := old.id;
  end if;

  update products set fit = case
      when lower(coalesce(p->>'fit', '')) in ('oversized', 'regular') then lower(p->>'fit')
      when type ilike '%regular%' then 'regular' else fit end,
    line = case when lower(coalesce(p->>'line', '')) in ('designed', 'plain') then lower(p->>'line') else line end
  where id = v_id;
  if coalesce(p->>'shop_label', '') <> '' then perform set_product_label(v_id, p->>'shop_label'); end if;
  for v in select * from jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) loop
    if coalesce(trim(v->>'colour'), '') = '' or coalesce(trim(v->>'size'), '') = '' then continue; end if;
    insert into product_variants (product_id, colour, colour_hex, size, sku)
    values (v_id, trim(v->>'colour'), coalesce(nullif(v->>'colour_hex', ''), '#111111'), upper(trim(v->>'size')),
            'ZS-' || (select case fit when 'regular' then 'RF' else 'OS' end from products where id = v_id) || '-' || v_id || '-' || upper(left(regexp_replace(v->>'colour', '[^A-Za-z]', '', 'g'), 3)) || '-' || upper(trim(v->>'size')))
    on conflict (product_id, colour, size) do update
      set active = coalesce((v->>'active')::boolean, true), colour_hex = excluded.colour_hex;
  end loop;

  return v_id;
end $function$;


-- coming soon cannot be ordered
CREATE OR REPLACE FUNCTION public._price_cart(p_channel text, p_items jsonb, p_opts jsonb, p_lock boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it        record;
  v         record;
  lines     jsonb := '[]'::jsonb;
  units     numeric[] := '{}';
  v_sub     numeric := 0;
  v_mrp     numeric := 0;
  v_stock   int;
  b         record;
  v_best    numeric := 0;
  v_bname   text;
  v_bdisc   numeric;
  v_elig    numeric[];
  v_groups  int;
  v_base    numeric;
  v_pct     numeric := coalesce((p_opts->>'discount_pct')::numeric, 0);
  v_manual  numeric := 0;
  cp        coupons;
  v_code    text := upper(trim(coalesce(p_opts->>'coupon', '')));
  v_cdisc   numeric := 0;
  v_cerr    text;
  v_used    int;
  v_cust    bigint := (p_opts->>'customer_id')::bigint;
  v_phone   text := phone10(p_opts->>'phone');
  v_bal     int;
  v_pts     int := greatest(coalesce((p_opts->>'points')::int, 0), 0);
  v_ship    numeric := 0;
  v_after   numeric;
  v_online  boolean := not is_in_person(p_channel);
  v_errors  jsonb := '[]'::jsonb;
  v_pay     text := p_opts->>'pay';
  v_prepct  numeric := coalesce(setting_num('prepaid_discount_pct'), 0);
  v_preoff  numeric := 0;
  v_preoffer numeric := 0;
  v_codfee  numeric := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty.';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Too many items in one order.'; end if;

  for it in
    select (e->>'variant_id')::bigint as variant_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if it.qty is null or it.qty <= 0 or it.qty > coalesce(nullif((p_opts->>'staff')::boolean, false)::int * 1000, setting_num('max_qty_per_line'), 20) then
      raise exception 'Quantity must be between 1 and %. For bulk orders, ask the store.', coalesce(nullif((p_opts->>'staff')::boolean, false)::int * 1000, setting_num('max_qty_per_line'), 20);
    end if;
    if p_lock then
      perform 1 from product_variants where id = it.variant_id for update;
    end if;
    select pv.id, pv.colour, pv.size, p.id as product_id, p.name, p.mrp, p.price, p.cost_price,
           p.is_preorder, p.drop_at, p.shop_label
      into v
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = it.variant_id and pv.active and p.active and p.published_at is not null;
    if not found then raise exception 'One of the items is no longer available.'; end if;
    if v.drop_at is not null and v.drop_at > now() then
      raise exception '% drops on % — it can''t be ordered yet.', v.name,
        to_char(v.drop_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
    end if;
    if v.shop_label = 'coming_soon' then raise exception '% is coming soon. It can''t be ordered yet.', v.name; end if;
    v_stock := stock_of(v.id);
    if not v.is_preorder and v_stock < it.qty then
      if p_lock then
        raise exception 'Only % left of % (% / %).', greatest(v_stock, 0), v.name, v.colour, v.size;
      end if;
      v_errors := v_errors || to_jsonb(format('Only %s left of %s (%s / %s).', greatest(v_stock, 0), v.name, v.colour, v.size));
    end if;
    lines := lines || jsonb_build_object('variant_id', v.id, 'product_id', v.product_id, 'name', v.name,
               'label', v.colour || ' / ' || v.size, 'qty', it.qty, 'mrp', v.mrp, 'price', v.price,
               'cost', v.cost_price, 'preorder', v.is_preorder);
    v_sub := v_sub + v.price * it.qty;
    v_mrp := v_mrp + v.mrp * it.qty;
    for i in 1..it.qty loop units := units || v.price; end loop;
  end loop;

  -- best bundle (one per order)
  for b in select * from bundles where active loop
    select coalesce(array_agg(u order by u desc), '{}') into v_elig
    from (select (l->>'price')::numeric as u, generate_series(1, (l->>'qty')::int)
          from jsonb_array_elements(lines) l
          where cardinality(b.product_ids) = 0 or (l->>'product_id')::bigint = any (b.product_ids)) x;
    v_groups := floor(cardinality(v_elig)::numeric / b.qty);
    if v_groups > 0 then
      select coalesce(sum(u), 0) into v_bdisc from unnest(v_elig[1:v_groups * b.qty]) u;
      v_bdisc := v_bdisc - v_groups * b.price;
      if v_bdisc > v_best then v_best := v_bdisc; v_bname := b.name; end if;
    end if;
  end loop;
  v_base := v_sub - v_best;

  -- manual (staff) discount
  if v_pct > 0 then
    if v_code <> '' then raise exception 'Use either a coupon or a manual discount, not both.'; end if;
    v_manual := round(v_base * v_pct / 100, 0);
  end if;
  v_base := v_base - v_manual;

  -- coupon
  if v_code <> '' then
    select * into cp from coupons where code = v_code;
    if cp.id is null or not cp.active then v_cerr := 'This coupon code is not valid.';
    elsif cp.starts_at is not null and cp.starts_at > now() then v_cerr := 'This coupon is not active yet.';
    elsif cp.ends_at is not null and cp.ends_at < now() then v_cerr := 'This coupon has expired.';
    elsif (cp.channel = 'store' and v_online) or (cp.channel = 'online' and not v_online) then
      v_cerr := case when v_online then 'This coupon works only at the store.' else 'This coupon works only online.' end;
    elsif v_base < cp.min_order then v_cerr := format('Add ₹%s more to use this coupon.', ceil(cp.min_order - v_base));
    else
      select count(*) into v_used from orders where coupon_code = cp.code and status <> 'cancelled';
      if cp.usage_limit is not null and v_used >= cp.usage_limit then v_cerr := 'This coupon has been fully used.'; end if;
      if v_cerr is null and (v_cust is not null or length(v_phone) = 10) then
        select count(*) into v_used from orders
        where coupon_code = cp.code and status <> 'cancelled'
          and ((v_cust is not null and customer_id = v_cust) or (length(v_phone) = 10 and customer_phone = v_phone));
        if v_used >= cp.per_customer_limit then v_cerr := 'You have already used this coupon.'; end if;
      end if;
      if v_cerr is null and cp.first_order_only and (v_cust is not null or length(v_phone) = 10)
         and exists (select 1 from orders where status <> 'cancelled'
                     and ((v_cust is not null and customer_id = v_cust) or (length(v_phone) = 10 and customer_phone = v_phone))) then
        v_cerr := 'This coupon is only for a first order.';
      end if;
      if v_cerr is null then
        v_cdisc := case when cp.kind = 'percent' then round(v_base * cp.value / 100, 0) else cp.value end;
        if cp.max_discount is not null then v_cdisc := least(v_cdisc, cp.max_discount); end if;
        v_cdisc := least(v_cdisc, v_base);
      end if;
    end if;
    if v_cerr is not null and p_lock then raise exception '%', v_cerr; end if;
  end if;
  v_base := v_base - v_cdisc;

  -- extra off for paying online (shop only); always reported so the shop can show the saving
  if v_online and v_prepct > 0 then
    v_preoffer := least(round(v_base * v_prepct / 100, 0), coalesce(setting_num('prepaid_discount_max'), 100000));
    if v_pay = 'online' then v_preoff := v_preoffer; end if;
  end if;
  v_base := v_base - v_preoff;

  -- Z-Club points (logged-in customers only)
  if v_pts > 0 then
    if v_cust is null then
      if p_lock then raise exception 'Sign in to use Z-Club points.'; end if;
      v_pts := 0;
    else
      v_bal := points_of(v_cust);
      v_pts := least(v_pts, v_bal, floor(v_base * coalesce(setting_num('loyalty_max_redeem_pct'), 20) / 100)::int);
    end if;
  end if;
  v_after := v_base - v_pts;

  if v_online then
    v_ship := case when setting_num('free_shipping_above') > 0 and v_after >= setting_num('free_shipping_above') then 0
                   else coalesce(setting_num('shipping_fee'), 0) end;
    if v_pay = 'cod' then v_codfee := coalesce(setting_num('cod_fee'), 0); end if;
  end if;

  return jsonb_build_object(
    'lines', lines, 'mrp_total', v_mrp, 'subtotal', v_sub,
    'bundle_name', v_bname, 'bundle_discount', v_best,
    'manual_discount', v_manual,
    'coupon_code', case when v_cerr is null and v_code <> '' then v_code end,
    'coupon_discount', v_cdisc, 'coupon_error', v_cerr,
    'prepaid_discount', v_preoff, 'prepaid_offer', v_preoffer, 'cod_fee', v_codfee,
    'points_used', v_pts, 'points_balance', case when v_cust is not null then points_of(v_cust) end,
    'shipping', v_ship, 'total', v_after + v_ship + v_codfee,
    'points_earn', floor(v_after * coalesce(setting_num('loyalty_points_per_100'), 0) / 100),
    'errors', v_errors);
end $function$;


-- ---------------------------------------------------------------- 9. stock, catalogue and profit by fit

create or replace view stock_board with (security_invoker = true) as
SELECT pv.id AS variant_id,
    pv.product_id,
    p.name AS product_name,
    p.published_at IS NOT NULL AS published,
    p.active AS product_active,
    pv.colour,
    pv.colour_hex,
    pv.size,
    pv.sku,
    pv.active,
    stock_of(pv.id) AS stock,
    p.price,
    p.mrp,
        CASE
            WHEN is_partner() THEN p.cost_price
            ELSE NULL::numeric
        END AS cost_price,
    p.drop_name,
    p.drop_at,
    p.limited_qty,
    p.is_preorder,
    ( SELECT count(*) AS count
           FROM restock_requests r
          WHERE r.variant_id = pv.id AND r.notified_at IS NULL) AS waiting,
    p.fit,
    p.line,
    p.shop_label
   FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
  WHERE (current_member()).id IS NOT NULL AND p.deleted_at IS NULL;

create or replace view catalog as
SELECT p.id,
    p.name,
    p.slug,
    c.name AS category,
    c.slug AS category_slug,
    p.type,
    p.description,
    p.fabric,
    p.gsm,
    p.mrp,
    p.price,
    round((1::numeric - p.price / p.mrp) * 100::numeric)::integer AS discount_pct,
    p.images,
    p.tags,
    p.featured,
    p.published_at,
    p.drop_name,
    p.drop_at,
    p.limited_qty,
    p.is_preorder,
    p.drop_at IS NOT NULL AND p.drop_at > now() OR p.shop_label = 'coming_soon'::text AS coming_soon,
    COALESCE(v.variants, '[]'::jsonb) AS variants,
    COALESCE(v.total_stock, 0::bigint) AS total_stock,
    COALESCE(s.sold, 0::bigint) AS sold_count,
    COALESCE(r.avg_rating, 0::numeric) AS rating,
    COALESCE(r.n, 0) AS rating_count,
    r.fit_small,
    r.fit_true,
    r.fit_large,
    p.fit,
    fit_label(p.fit) AS fit_label,
    p.line,
    p.shop_label,
    p.label_at
   FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('id', pv.id, 'colour', pv.colour, 'hex', pv.colour_hex, 'size', pv.size, 'stock', GREATEST(stock_of(pv.id), 0)) ORDER BY pv.colour, (array_position(ARRAY['XS'::text, 'S'::text, 'M'::text, 'L'::text, 'XL'::text, 'XXL'::text, '3XL'::text, '4XL'::text], pv.size)), pv.size) AS variants,
            sum(GREATEST(stock_of(pv.id), 0)) AS total_stock
           FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.active) v ON true
     LEFT JOIN LATERAL ( SELECT sum(i.qty) AS sold
           FROM order_items i
             JOIN product_variants pv ON pv.id = i.variant_id
             JOIN orders o ON o.id = i.order_id
          WHERE pv.product_id = p.id AND (o.status <> ALL (ARRAY['cancelled'::text, 'rto'::text, 'returned'::text]))) s ON true
     LEFT JOIN LATERAL ( SELECT round(avg(pr.rating), 1) AS avg_rating,
            count(*)::integer AS n,
            count(*) FILTER (WHERE pr.fit = 'small'::text)::integer AS fit_small,
            count(*) FILTER (WHERE pr.fit = 'true'::text)::integer AS fit_true,
            count(*) FILTER (WHERE pr.fit = 'large'::text)::integer AS fit_large
           FROM product_reviews pr
          WHERE pr.product_id = p.id AND pr.status = 'published'::text) r ON true
  WHERE p.active AND p.published_at IS NOT NULL;
grant select on catalog to anon, authenticated;

create or replace view product_profit with (security_invoker = true) as
WITH lines AS (
         SELECT pv.product_id,
            i.qty,
            i.line_total,
            i.unit_cost,
            i.line_total *
                CASE
                    WHEN o.subtotal > 0::numeric THEN (o.total - o.shipping) / o.subtotal
                    ELSE 1::numeric
                END AS net_revenue
           FROM order_items i
             JOIN orders o ON o.id = i.order_id
             JOIN product_variants pv ON pv.id = i.variant_id
          WHERE (o.status <> ALL (ARRAY['cancelled'::text, 'rto'::text, 'returned'::text])) AND o.payment_status = 'paid'::text
        )
 SELECT p.id AS product_id,
    p.name,
    p.drop_name,
    p.price,
    p.cost_price,
    COALESCE(sum(l.qty), 0::bigint) AS units_sold,
    round(COALESCE(sum(l.net_revenue), 0::numeric), 2) AS revenue,
    round(COALESCE(sum(l.unit_cost * l.qty::numeric), 0::numeric), 2) AS cost,
    round(COALESCE(sum(l.net_revenue - l.unit_cost * l.qty::numeric), 0::numeric), 2) AS profit,
        CASE
            WHEN COALESCE(sum(l.net_revenue), 0::numeric) > 0::numeric THEN round(100::numeric * sum(l.net_revenue - l.unit_cost * l.qty::numeric) / sum(l.net_revenue), 1)
            ELSE NULL::numeric
        END AS margin_pct,
    p.fit
   FROM products p
     LEFT JOIN lines l ON l.product_id = p.id
  WHERE is_partner()
  GROUP BY p.id;


-- one line per fit: what sold, what it cost, what is left on the shelf (partners only)
create view fit_profit with (security_invoker = true) as
select f.fit, fit_label(f.fit) as fit_label,
       coalesce(sum(pp.units_sold), 0)::int as units_sold,
       coalesce(sum(pp.revenue), 0) as revenue,
       coalesce(sum(pp.cost), 0) as cost,
       coalesce(sum(pp.profit), 0) as profit,
       case when coalesce(sum(pp.revenue), 0) > 0 then round(100 * sum(pp.profit) / sum(pp.revenue), 1) end as margin_pct,
       (select count(*) from products p where p.fit = f.fit and p.deleted_at is null and p.published_at is not null)::int as live_designs,
       (select coalesce(sum(greatest(stock_of(pv.id), 0)), 0) from product_variants pv join products p on p.id = pv.product_id
         where p.fit = f.fit and p.deleted_at is null)::int as printed_stock,
       (select coalesce(sum(greatest(stock_of(pv.id), 0) * p.cost_price), 0) from product_variants pv join products p on p.id = pv.product_id
         where p.fit = f.fit and p.deleted_at is null) as printed_stock_value,
       (select coalesce(sum(qty), 0) from blank_moves b where b.fit = f.fit)::int as blank_stock,
       (select coalesce(sum(qty), 0) * coalesce(round(sum(cost) filter (where reason = 'purchase') / nullif(sum(qty) filter (where reason = 'purchase'), 0), 2), 0)
          from blank_moves b where b.fit = f.fit) as blank_stock_value
from (values ('oversized'), ('regular')) f(fit)
left join product_profit pp on pp.fit = f.fit
where is_partner()
group by f.fit;
grant select on fit_profit to authenticated;

-- the same split for any period (Finance screen): sales, cost, profit, plus stock on hand now
create function fit_summary(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Partners only.'; end if;
  return (select jsonb_agg(row_to_json(x) order by x.fit) from (
    select f.fit, fit_label(f.fit) as fit_label,
           coalesce(sum(l.qty), 0)::int as units_sold,
           round(coalesce(sum(l.net), 0), 2) as revenue,
           round(coalesce(sum(l.cost), 0), 2) as cost,
           round(coalesce(sum(l.net - l.cost), 0), 2) as profit,
           case when coalesce(sum(l.net), 0) > 0 then round(100 * sum(l.net - l.cost) / sum(l.net), 1) end as margin_pct,
           (select printed_stock from fit_profit fp where fp.fit = f.fit) as printed_stock,
           (select printed_stock_value from fit_profit fp where fp.fit = f.fit) as printed_stock_value,
           (select blank_stock from fit_profit fp where fp.fit = f.fit) as blank_stock,
           (select blank_stock_value from fit_profit fp where fp.fit = f.fit) as blank_stock_value
    from (values ('oversized'), ('regular')) f(fit)
    left join (
      select pr.fit, i.qty,
             i.line_total * case when o.subtotal > 0 then (o.total - o.shipping) / o.subtotal else 1 end as net,
             coalesce(i.unit_cost, 0) * i.qty as cost
      from order_items i join orders o on o.id = i.order_id
           join product_variants pv on pv.id = i.variant_id join products pr on pr.id = pv.product_id
      where o.status not in ('cancelled', 'rto', 'returned') and o.payment_status = 'paid'
        and (p_from is null or (o.created_at at time zone 'Asia/Kolkata')::date >= p_from)
        and (p_to is null or (o.created_at at time zone 'Asia/Kolkata')::date <= p_to)
    ) l on l.fit = f.fit
    group by f.fit) x);
end $$;
revoke execute on function fit_summary(date, date) from public, anon;
grant execute on function fit_summary(date, date) to authenticated;

notify pgrst, 'reload schema';
