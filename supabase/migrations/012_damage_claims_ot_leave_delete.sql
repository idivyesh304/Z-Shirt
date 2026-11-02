-- =====================================================================
-- Z-SHIRTS · Phase 8 · Damaged goods → vendor claims, overtime at the
-- hourly rate, 1 paid leave a month, delete (archive) a product.
-- Run after 011.
-- =====================================================================

-- ---------------------------------------------------------------- 1. new stock reasons
alter table stock_moves drop constraint if exists stock_moves_reason_check;
alter table stock_moves add constraint stock_moves_reason_check check (reason in ('opening', 'production', 'sale', 'cancel', 'rto',
  'return', 'replacement_out', 'writeoff', 'damaged', 'vendor_replace', 'damage_undo'));
alter table blank_moves drop constraint if exists blank_moves_reason_check;
alter table blank_moves add constraint blank_moves_reason_check check (reason in ('purchase', 'used', 'damaged', 'adjust', 'replaced'));
alter table dtf_moves drop constraint if exists dtf_moves_reason_check;
alter table dtf_moves add constraint dtf_moves_reason_check check (reason in ('purchase', 'used', 'damaged', 'replaced', 'adjust'));

-- ---------------------------------------------------------------- 2. damage claims
-- Damaged DTF prints, blank tees or printed tees: photos go in, the pieces leave stock,
-- and the claim follows the vendor until it is replaced, refunded or refused.
create table damage_claims (
  id             bigint generated always as identity primary key,
  item           text not null check (item in ('dtf', 'blank', 'tee')),
  product_id     bigint references products(id),
  variant_id     bigint references product_variants(id),
  colour         text,
  colour_hex     text,
  size           text,
  qty            int not null check (qty > 0),
  vendor         text not null,
  ask            text not null check (ask in ('return', 'refund', 'replace')),
  reason         text not null,
  photos         text[] not null,
  unit_cost      numeric(12,2),
  value          numeric(12,2),
  status         text not null default 'reported'
                   check (status in ('reported', 'sent', 'replaced', 'refunded', 'settled', 'rejected', 'cancelled')),
  replaced_qty   int not null default 0,
  refund_amount  numeric(12,2) not null default 0,
  refund_request bigint references requests(id),
  sent_at        timestamptz,
  sent_by        uuid references members(id),
  settled_at     timestamptz,
  settled_by     uuid references members(id),
  settle_note    text,
  settle_photo   text,
  reported_by    uuid not null references members(id),
  created_at     timestamptz not null default now()
);
create index on damage_claims (status, created_at desc);
create trigger damage_internal  before insert or update on damage_claims for each row execute function require_internal();
create trigger damage_permanent before delete on damage_claims for each row execute function forbid_change();
create trigger audit_damage     after insert or update on damage_claims for each row execute function write_audit();
alter table damage_claims enable row level security;
create policy damage_read on damage_claims for select to authenticated using ((current_member()).id is not null);
grant select on damage_claims to authenticated;

create view damage_board with (security_invoker = true) as
select d.*,
       case d.item when 'dtf' then 'DTF print' when 'blank' then 'Blank tee' else 'Printed tee' end as item_label,
       coalesce(p.name, '') || case when d.item = 'tee' then ' · ' || pv.colour || ' / ' || pv.size
                                    when d.item = 'blank' then d.colour || ' / ' || d.size else '' end as what,
       r.name as reported_by_name, s.name as settled_by_name, rq.status::text as refund_status
from damage_claims d
left join products p on p.id = coalesce(d.product_id, (select product_id from product_variants where id = d.variant_id))
left join product_variants pv on pv.id = d.variant_id
left join members r on r.id = d.reported_by
left join members s on s.id = d.settled_by
left join requests rq on rq.id = d.refund_request;
grant select on damage_board to authenticated;

-- vendors you have bought from (for the vendor picker)
create view vendor_names with (security_invoker = true) as
select distinct trim(v) as vendor from (
  select vendor as v from damage_claims
  union all select supplier from production_batches
) x where coalesce(trim(v), '') <> '';
grant select on vendor_names to authenticated;

create function report_damage(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  v_item text := p->>'item';
  v_qty int := (p->>'qty')::int;
  v_prod bigint := nullif(p->>'product_id', '')::bigint;
  v_var bigint := nullif(p->>'variant_id', '')::bigint;
  v_colour text := initcap(trim(coalesce(p->>'colour', '')));
  v_size text := upper(trim(coalesce(p->>'size', '')));
  v_hex text;
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
    select name into v_name from products where id = v_prod;
    if v_name is null then raise exception 'Choose the design.'; end if;
    select coalesce(sum(qty), 0) into v_have from dtf_moves where product_id = v_prod;
    select cost_per_print into v_cost from dtf_stock where product_id = v_prod;
  elsif v_item = 'blank' then
    if v_colour = '' or v_size = '' then raise exception 'Choose colour and size.'; end if;
    select coalesce(sum(qty), 0), max(colour_hex) into v_have, v_hex from blank_moves where lower(colour) = lower(v_colour) and size = v_size;
    select round(sum(cost) / nullif(sum(qty), 0), 2) into v_cost from blank_moves
      where lower(colour) = lower(v_colour) and reason = 'purchase' and cost is not null;
    v_name := v_colour || ' ' || v_size || ' blank';
  else
    select pv.product_id, p2.name || ' ' || pv.colour || ' ' || pv.size, p2.cost_price into v_prod, v_name, v_cost
      from product_variants pv join products p2 on p2.id = pv.product_id where pv.id = v_var;
    if v_name is null then raise exception 'Choose the tee, colour and size.'; end if;
    v_have := stock_of(v_var);
    v_prod := null;
  end if;
  if v_qty > v_have then raise exception 'Only % in stock. You cannot mark more as damaged.', v_have; end if;

  perform set_config('zs.internal', 'on', true);
  insert into damage_claims (item, product_id, variant_id, colour, colour_hex, size, qty, vendor, ask, reason, photos, unit_cost, value, reported_by)
  values (v_item, v_prod, case when v_item = 'tee' then v_var end, nullif(v_colour, ''), v_hex, nullif(v_size, ''), v_qty,
          trim(p->>'vendor'), p->>'ask', trim(p->>'reason'), v_photos, v_cost, round(v_cost * v_qty, 2), m.id)
  returning id into v_id;

  if v_item = 'dtf' then
    insert into dtf_moves (product_id, qty, reason, note, by_member) values (v_prod, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id);
  elsif v_item = 'blank' then
    insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member) values (v_colour, v_hex, v_size, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id);
  else
    insert into stock_moves (variant_id, qty, reason, note, by_member) values (v_var, -v_qty, 'damaged', 'Damage claim #' || v_id, m.id);
  end if;

  perform _notify('stock', 'Damaged: ' || v_qty || ' × ' || v_name,
    'Asking ' || trim(p->>'vendor') || ' to ' || (p->>'ask') || ' · ' || trim(p->>'reason') || ' · by ' || m.name, null, round(v_cost * v_qty, 2), false, 'partners');
  return v_id;
end $$;

-- move a claim forward: sent to vendor → settled (replaced and/or refunded) or rejected; cancel if it was a mistake
create function damage_update(p_id bigint, p_action text, p_qty int default 0, p_amount numeric default 0,
                              p_note text default null, p_photo text default null) returns text
language plpgsql security definer set search_path = public as $$
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
        insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member) values (d.colour, d.colour_hex, d.size, p_qty, 'replaced', v_label || ' replaced', m.id);
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
      insert into blank_moves (colour, colour_hex, size, qty, reason, note, by_member) values (d.colour, d.colour_hex, d.size, d.qty, 'adjust', v_label || ' cancelled', m.id);
    else
      insert into stock_moves (variant_id, qty, reason, note, by_member) values (d.variant_id, d.qty, 'damage_undo', v_label || ' cancelled', m.id);
    end if;
    update damage_claims set status = 'cancelled', settled_at = now(), settled_by = m.id, settle_note = nullif(trim(coalesce(p_note, '')), '') where id = d.id;
    return 'cancelled';
  end if;
  raise exception 'Unknown step.';
end $$;

-- ---------------------------------------------------------------- 3. HR: overtime at the hourly rate, 1 paid leave a month
-- day rate = monthly salary ÷ 30, hourly rate = day rate ÷ 10, overtime = hours after 9 PM × hourly rate
select set_config('zs.internal', 'on', false);
update settings set value = value || '{"paid_leaves_per_month":1,"salary_days":30,"hours_per_day":10,"ot_multiplier":1}'::jsonb
where key = 'hr_policy';
select set_config('zs.internal', 'off', false);

create or replace function request_leave(p_from date, p_to date, p_kind text, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); pol jsonb := hr_policy(); v_id bigint; v_free numeric; v_used numeric;
begin
  if m.id is null or m.role <> 'employee' then raise exception 'Leave requests are for employees.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Write the reason.'; end if;
  if p_kind not in ('paid', 'unpaid', 'half_day') then raise exception 'Choose the leave type.'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date.'; end if;
  if p_kind = 'half_day' and not coalesce((pol->>'half_day_allowed')::boolean, true) then raise exception 'Half days are not allowed.'; end if;
  if p_kind = 'half_day' and p_to <> p_from then raise exception 'A half day is a single date.'; end if;
  if p_kind = 'paid' then
    v_free := coalesce((pol->>'paid_leaves_per_month')::numeric, 0);
    if v_free = 0 then raise exception 'There is no paid leave. Ask for unpaid leave.'; end if;
    if date_trunc('month', p_from) <> date_trunc('month', p_to) then raise exception 'Ask paid leave for one month at a time.'; end if;
    select coalesce(sum(to_day - from_day + 1), 0) into v_used from leave_requests
      where member_id = m.id and kind = 'paid' and status in ('pending', 'approved') and date_trunc('month', from_day) = date_trunc('month', p_from);
    if v_used + (p_to - p_from + 1) > v_free then
      raise exception 'Only % paid leave a month, and % already asked for this month. Ask unpaid leave for the extra days.', v_free, v_used;
    end if;
  end if;
  perform set_config('zs.internal', 'on', true);
  insert into leave_requests (member_id, from_day, to_day, kind, reason) values (m.id, p_from, p_to, p_kind, trim(p_reason)) returning id into v_id;
  perform _notify('approval', 'Leave request · ' || m.name, to_char(p_from, 'DD Mon') ||
    case when p_to <> p_from then ' to ' || to_char(p_to, 'DD Mon') else '' end || ' · ' || replace(p_kind, '_', ' ') || ' · ' || trim(p_reason),
    null, null, false, 'partners');
  return v_id;
end $$;

drop function if exists hr_payroll(date);
create function hr_payroll(p_month date) returns table (
  member_id uuid, name text, monthly_salary numeric, working_days int, present_days numeric, paid_leave numeric,
  unpaid_leave numeric, late_count int, late_half_days int, absent_days numeric, ot_hours numeric,
  per_day numeric, per_hour numeric, deductions numeric, ot_pay numeric, net_pay numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  pol jsonb := hr_policy();
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  upto date := least(m1, today_ist());
  e record;
  v_work int; v_present numeric; v_paid numeric; v_unpaid numeric; v_lates int; v_lhd int; v_abs numeric; v_ot numeric;
  v_sal numeric; v_pd numeric; v_ph numeric; v_free numeric;
begin
  if not is_partner() and not exists (select 1 from members where auth_user_id = auth.uid() and role = 'employee') then
    raise exception 'Not allowed.';
  end if;
  for e in select mm.* from members mm where mm.role = 'employee' and mm.active
           and (is_partner() or mm.auth_user_id = auth.uid()) loop
    select count(*) into v_work from generate_series(m0, upto, interval '1 day') d
      where trim(to_char(d, 'Day')) <> coalesce(pol->>'weekly_off', 'Sunday');
    select count(*) into v_present from attendance a where a.member_id = e.id and a.day between m0 and upto and a.in_at is not null;
    select count(*) filter (where late_min > 0 or lunch_over_min > 0) into v_lates from attendance a where a.member_id = e.id and a.day between m0 and upto;
    v_lhd := floor(v_lates::numeric / greatest(coalesce((pol->>'lates_per_half_day')::int, 3), 1));
    select coalesce(sum(case when l.kind = 'half_day' then 0.5 else (least(l.to_day, upto) - greatest(l.from_day, m0) + 1) end) filter (where l.kind in ('paid', 'half_day')), 0),
           coalesce(sum(least(l.to_day, upto) - greatest(l.from_day, m0) + 1) filter (where l.kind = 'unpaid'), 0)
      into v_paid, v_unpaid
      from leave_requests l where l.member_id = e.id and l.status = 'approved' and l.to_day >= m0 and l.from_day <= upto;
    -- paid leave beyond the monthly allowance becomes unpaid
    v_free := coalesce((pol->>'paid_leaves_per_month')::numeric, 0);
    if v_paid > v_free then v_unpaid := v_unpaid + (v_paid - v_free); v_paid := v_free; end if;
    v_abs := greatest(v_work - v_present - v_paid - v_unpaid, 0);
    select coalesce(sum(greatest(extract(epoch from ((a.out_at at time zone 'Asia/Kolkata') - (a.day + (pol->>'ot_after')::time))) / 3600, 0)), 0)
      into v_ot from attendance a where a.member_id = e.id and a.day between m0 and upto and a.out_at is not null;
    select coalesce(ep.monthly_salary, 0) into v_sal from employee_pay ep where ep.member_id = e.id;
    v_sal := coalesce(v_sal, 0);
    v_pd := round(v_sal / greatest(coalesce((pol->>'salary_days')::numeric, 30), 1), 2);
    v_ph := round(v_pd / greatest(coalesce((pol->>'hours_per_day')::numeric, 10), 1), 2);
    member_id := e.id; name := e.name; monthly_salary := v_sal; working_days := v_work; present_days := v_present;
    paid_leave := v_paid; unpaid_leave := v_unpaid; late_count := v_lates; late_half_days := v_lhd; absent_days := v_abs;
    ot_hours := round(floor(v_ot * 4) / 4, 2); per_day := v_pd; per_hour := v_ph;
    deductions := round((v_abs + v_unpaid + 0.5 * v_lhd) * v_pd, 0);
    ot_pay := round(ot_hours * v_ph * coalesce((pol->>'ot_multiplier')::numeric, 1), 0);
    net_pay := greatest(round(v_sal - deductions + coalesce(ot_pay, 0), 0), 0);
    return next;
  end loop;
end $$;
grant execute on function hr_payroll(date) to authenticated;

-- ---------------------------------------------------------------- 4. delete a product (kept in history, gone from everywhere else)
alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists deleted_by uuid references members(id);

create or replace view stock_board with (security_invoker = true) as
select pv.id as variant_id, pv.product_id, p.name as product_name, p.published_at is not null as published,
       p.active as product_active, pv.colour, pv.colour_hex, pv.size, pv.sku, pv.active,
       stock_of(pv.id) as stock, p.price, p.mrp,
       case when is_partner() then p.cost_price end as cost_price,
       p.drop_name, p.drop_at, p.limited_qty, p.is_preorder,
       (select count(*) from restock_requests r where r.variant_id = pv.id and r.notified_at is null) as waiting
from product_variants pv join products p on p.id = pv.product_id
where (current_member()).id is not null and p.deleted_at is null;

create function delete_product(p_id bigint, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); pr products; v_left int;
begin
  if not is_partner() then raise exception 'Only partners can delete a product.'; end if;
  select * into pr from products where id = p_id for update;
  if pr.id is null then raise exception 'Product not found.'; end if;
  if pr.deleted_at is not null then raise exception 'This product is already deleted.'; end if;
  select coalesce(sum(greatest(stock_of(id), 0)), 0) into v_left from product_variants where product_id = p_id;
  perform set_config('zs.internal', 'on', true);
  update products set deleted_at = now(), deleted_by = m.id, active = false, published_at = null, featured = false where id = p_id;
  update product_variants set active = false where product_id = p_id;
  perform _notify('stock', 'Product deleted: ' || pr.name,
    'by ' || m.name || case when v_left > 0 then ' · ' || v_left || ' pieces were still in stock' else '' end ||
    coalesce(' · ' || nullif(trim(p_reason), ''), ''), null, null, false, 'partners');
  return pr.name;
end $$;

create function restore_product(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); pr products;
begin
  if not is_partner() then raise exception 'Only partners can restore a product.'; end if;
  select * into pr from products where id = p_id for update;
  if pr.deleted_at is null then raise exception 'This product is not deleted.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set deleted_at = null, deleted_by = null, active = true where id = p_id;   -- comes back as a draft
  update product_variants set active = true where product_id = p_id;
  perform _notify('stock', 'Product restored: ' || pr.name, 'by ' || m.name || ' · back as a draft', null, null, false, 'partners');
  return pr.name;
end $$;

create or replace function publish_product(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only a partner can publish a product to the shop.'; end if;
  if exists (select 1 from products where id = p_id and deleted_at is not null) then raise exception 'This product is deleted. Restore it first.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set published_at = coalesce(published_at, now()), active = true where id = p_id;
end $$;

revoke execute on function report_damage(jsonb), damage_update(bigint, text, int, numeric, text, text),
  delete_product(bigint, text), restore_product(bigint) from public, anon;
grant execute on function report_damage(jsonb), damage_update(bigint, text, int, numeric, text, text),
  delete_product(bigint, text), restore_product(bigint) to authenticated;

notify pgrst, 'reload schema';
