-- =====================================================================
-- Z-SHIRTS · Phase 9 · Purchase orders
-- Vendors with codes, GST (CGST+SGST inside Gujarat, IGST outside, none for
-- unregistered vendors), a terms library per PO type, partner approvals
-- (a partner's PO needs the other 3, Mahendra's PO needs all 4), receiving
-- into blank / DTF stock. Run after 012.
-- =====================================================================
alter type request_type add value if not exists 'purchase_order';

-- ---------------------------------------------------------------- 1. settings
select set_config('zs.internal', 'on', false);
insert into settings (key, value, label, kind, grp) values
  ('business_state_code', '"24"'::jsonb, 'GST state code of the business (24 = Gujarat)', 'text', 'Tax & GST'),
  ('business_phone',      '""'::jsonb,   'Business phone on purchase orders',             'text', 'Business'),
  ('business_email',      '""'::jsonb,   'Business email on purchase orders',             'text', 'Business'),
  ('po_ship_to',          '""'::jsonb,   'Purchase orders: deliver to (address)',          'text', 'Purchase orders'),
  ('po_prefix',           '"ZS/PO"'::jsonb, 'Purchase orders: number prefix',              'text', 'Purchase orders'),
  ('po_freight_gst',      '18'::jsonb,   'Purchase orders: GST on freight (%)',            'number', 'Purchase orders')
on conflict (key) do nothing;
select set_config('zs.internal', 'off', false);

create or replace function setting_text(k text) returns text
language sql stable security definer set search_path = public as $$ select value #>> '{}' from settings where key = k $$;

-- ---------------------------------------------------------------- 2. GST states + GSTIN check
create table gst_states (code text primary key, name text not null);
insert into gst_states values
  ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),('04','Chandigarh'),('05','Uttarakhand'),('06','Haryana'),
  ('07','Delhi'),('08','Rajasthan'),('09','Uttar Pradesh'),('10','Bihar'),('11','Sikkim'),('12','Arunachal Pradesh'),('13','Nagaland'),
  ('14','Manipur'),('15','Mizoram'),('16','Tripura'),('17','Meghalaya'),('18','Assam'),('19','West Bengal'),('20','Jharkhand'),
  ('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),('24','Gujarat'),('26','Dadra and Nagar Haveli and Daman and Diu'),
  ('27','Maharashtra'),('29','Karnataka'),('30','Goa'),('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
  ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),('38','Ladakh'),('97','Other Territory');
alter table gst_states enable row level security;
create policy gst_states_read on gst_states for select to authenticated using ((current_member()).id is not null);
grant select on gst_states to authenticated;

-- true when the 15-character GSTIN has the right shape and check digit
create function gstin_ok(g text) returns boolean language plpgsql immutable as $$
declare
  cs constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s int := 0; v int; f int := 1; p int; i int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  for i in 1..14 loop
    v := strpos(cs, substr(g, i, 1)) - 1;
    p := v * f;
    s := s + (p / 36) + (p % 36);
    f := case when f = 1 then 2 else 1 end;
  end loop;
  return substr(cs, ((36 - (s % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- ---------------------------------------------------------------- 3. vendors with codes
create table vendors (
  id             bigint generated always as identity primary key,
  code           text not null unique,
  category       text not null check (category in ('plain', 'dtf', 'embroidery', 'patchwork', 'other')),
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  gstin          text,
  pan            text,
  state_code     text references gst_states(code),
  address        text,
  city           text,
  pincode        text,
  bank_name      text,
  bank_account   text,
  ifsc           text,
  upi            text,
  payment_terms  text,
  notes          text,
  active         boolean not null default true,
  created_by     uuid references members(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create trigger vendors_internal  before insert or update on vendors for each row execute function require_internal();
create trigger vendors_permanent before delete on vendors for each row execute function forbid_change();
create trigger audit_vendors     after insert or update on vendors for each row execute function write_audit();
alter table vendors enable row level security;
create policy vendors_read on vendors for select to authenticated using ((current_member()).id is not null);
grant select on vendors to authenticated;

create function vendor_prefix(p_cat text) returns text language sql immutable as $$
  select case p_cat when 'plain' then 'PT' when 'dtf' then 'DTF' when 'embroidery' then 'EMB' when 'patchwork' then 'PCH' else 'OTH' end
$$;

create function save_vendor(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  v vendors;
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_cat text := coalesce(p->>'category', '');
  v_gst text := upper(regexp_replace(coalesce(p->>'gstin', ''), '\s', '', 'g'));
  v_state text := nullif(trim(coalesce(p->>'state_code', '')), '');
  v_code text;
  v_n int;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if v_cat not in ('plain', 'dtf', 'embroidery', 'patchwork', 'other') then raise exception 'Choose what this vendor supplies.'; end if;
  if coalesce(length(trim(p->>'name')), 0) < 2 then raise exception 'Write the vendor''s business name.'; end if;
  if coalesce(trim(p->>'phone'), '') !~ '^[0-9+ -]{10,15}$' then raise exception 'Enter the vendor''s phone number.'; end if;
  if v_gst <> '' then
    if not gstin_ok(v_gst) then raise exception 'This GSTIN is not valid. Check all 15 characters.'; end if;
    v_state := substr(v_gst, 1, 2);
    if exists (select 1 from vendors where gstin = v_gst and id is distinct from v_id) then raise exception 'A vendor with this GSTIN already exists.'; end if;
  end if;
  if v_state is null or not exists (select 1 from gst_states where code = v_state) then raise exception 'Choose the vendor''s state.'; end if;

  perform set_config('zs.internal', 'on', true);
  if v_id is null then
    select coalesce(max(nullif(regexp_replace(code, '^.*-', ''), '')::int), 0) + 1 into v_n from vendors where category = v_cat;
    v_code := 'ZV-' || vendor_prefix(v_cat) || '-' || lpad(v_n::text, 3, '0');
    insert into vendors (code, category, name, contact_person, phone, email, gstin, pan, state_code, address, city, pincode,
                         bank_name, bank_account, ifsc, upi, payment_terms, notes, created_by)
    values (v_code, v_cat, trim(p->>'name'), nullif(trim(p->>'contact_person'), ''), trim(p->>'phone'), nullif(trim(p->>'email'), ''),
            nullif(v_gst, ''), case when v_gst <> '' then substr(v_gst, 3, 10) else nullif(upper(trim(p->>'pan')), '') end, v_state,
            nullif(trim(p->>'address'), ''), nullif(trim(p->>'city'), ''), nullif(trim(p->>'pincode'), ''),
            nullif(trim(p->>'bank_name'), ''), nullif(trim(p->>'bank_account'), ''), nullif(upper(trim(p->>'ifsc')), ''), nullif(trim(p->>'upi'), ''),
            nullif(trim(p->>'payment_terms'), ''), nullif(trim(p->>'notes'), ''), m.id)
    returning * into v;
    perform _notify('stock', 'New vendor ' || v.code || ' · ' || v.name, 'Added by ' || m.name, null, null, false, 'partners');
  else
    select * into v from vendors where id = v_id for update;
    if v.id is null then raise exception 'Vendor not found.'; end if;
    if not is_partner() and v.created_by is distinct from m.id then raise exception 'Only partners can edit this vendor.'; end if;
    update vendors set category = category,   -- the code never changes
      name = trim(p->>'name'), contact_person = nullif(trim(p->>'contact_person'), ''), phone = trim(p->>'phone'), email = nullif(trim(p->>'email'), ''),
      gstin = nullif(v_gst, ''), pan = case when v_gst <> '' then substr(v_gst, 3, 10) else nullif(upper(trim(p->>'pan')), '') end, state_code = v_state,
      address = nullif(trim(p->>'address'), ''), city = nullif(trim(p->>'city'), ''), pincode = nullif(trim(p->>'pincode'), ''),
      bank_name = nullif(trim(p->>'bank_name'), ''), bank_account = nullif(trim(p->>'bank_account'), ''), ifsc = nullif(upper(trim(p->>'ifsc')), ''),
      upi = nullif(trim(p->>'upi'), ''), payment_terms = nullif(trim(p->>'payment_terms'), ''), notes = nullif(trim(p->>'notes'), ''),
      active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = v_id returning * into v;
  end if;
  return jsonb_build_object('id', v.id, 'code', v.code);
end $$;

-- ---------------------------------------------------------------- 4. terms library (tick-box terms per PO type)
create table po_terms (
  id         bigint generated always as identity primary key,
  po_type    text not null check (po_type in ('all', 'plain', 'dtf', 'embroidery', 'patchwork', 'other')),
  body       text not null,
  default_on boolean not null default true,
  sort       int not null default 100,
  active     boolean not null default true,
  created_by uuid references members(id),
  created_at timestamptz not null default now()
);
create trigger po_terms_internal  before insert or update on po_terms for each row execute function require_internal();
create trigger po_terms_permanent before delete on po_terms for each row execute function forbid_change();
create trigger audit_po_terms     after insert or update on po_terms for each row execute function write_audit();
alter table po_terms enable row level security;
create policy po_terms_read on po_terms for select to authenticated using ((current_member()).id is not null);
grant select on po_terms to authenticated;

select set_config('zs.internal', 'on', false);
insert into po_terms (po_type, body, default_on, sort) values
  ('all', 'Please quote this PO number on your invoice, delivery challan and every package.', true, 1),
  ('all', 'Goods must match the approved sample, specifications and quantities in this PO. Anything that does not match will be returned at the vendor''s cost.', true, 2),
  ('all', 'Delivery on or before the delivery date. Delays without written notice may lead to cancellation of the pending quantity.', true, 3),
  ('all', 'Every lot is inspected on arrival. Damaged or defective pieces will be returned for replacement or refund within 7 days.', true, 4),
  ('all', 'A proper GST tax invoice with our GSTIN, HSN/SAC codes and tax break-up is required for payment.', true, 5),
  ('all', 'Payment as per the payment terms, counted from the date all goods are received and accepted.', true, 6),
  ('all', 'Rates in this PO are final and include packing. No extra charges without prior written approval.', true, 7),
  ('all', 'All designs, artwork and samples shared by Z-SHIRTS are confidential and may not be reused, sold or shown to anyone else.', true, 8),
  ('all', 'Subject to Ahmedabad jurisdiction.', true, 99),
  ('plain', 'Fabric GSM, composition and colour must match the approved swatch. Variation of more than ±5 GSM will be rejected.', true, 10),
  ('plain', 'Garments must be pre-shrunk / bio-washed. Shrinkage above 5% after first wash will be returned.', true, 11),
  ('plain', 'Size measurements as per the Z-SHIRTS oversized size chart, tolerance ±1 cm.', true, 12),
  ('plain', 'Pack size-wise and colour-wise in polybags with a size sticker on each piece.', true, 13),
  ('plain', 'Shade variation within the same lot is not accepted.', false, 14),
  ('plain', 'No vendor labels or branding on the garments.', true, 15),
  ('dtf', 'Print with original DTF inks and powder. Prints must not crack, peel or fade after 30 washes.', true, 20),
  ('dtf', 'Colours must match the approved digital proof / Pantone references.', true, 21),
  ('dtf', 'Print size and placement exactly as given in this PO.', true, 22),
  ('dtf', 'Transfers delivered on film, sorted design-wise, protected from dust and moisture.', true, 23),
  ('dtf', 'Misprints, smudges or missing parts will be reprinted free of cost.', true, 24),
  ('dtf', 'Hot-peel / cold-peel and pressing temperature to be mentioned with the delivery.', false, 25),
  ('embroidery', 'Stitch count, thread colours and size as per the approved design file and sample.', true, 30),
  ('embroidery', 'No loose threads, puckering or backing paper visible on the outside.', true, 31),
  ('embroidery', 'Our garments sent for embroidery remain Z-SHIRTS property. Damaged garments will be charged at cost.', true, 32),
  ('embroidery', 'Return every garment sent with a count sheet. Shortage will be charged at cost.', true, 33),
  ('embroidery', 'Thread must be colour-fast and not bleed in wash.', true, 34),
  ('patchwork', 'Patch type, size, backing and colours exactly as per the approved sample.', true, 40),
  ('patchwork', 'Edges must be neatly finished (merrow / laser cut) with no fraying.', true, 41),
  ('patchwork', 'Iron-on backing must hold after 20 washes when applied as instructed.', true, 42),
  ('patchwork', 'Patches to be packed design-wise with a count on each pack.', true, 43),
  ('other', 'Specifications as described in this PO and agreed on call / WhatsApp.', true, 50);
select set_config('zs.internal', 'off', false);

create function save_po_term(p_id bigint, p_type text, p_body text, p_default boolean default true, p_active boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint;
begin
  if not is_partner() then raise exception 'Only partners can change PO terms.'; end if;
  if p_type not in ('all', 'plain', 'dtf', 'embroidery', 'patchwork', 'other') then raise exception 'Choose which PO type this term is for.'; end if;
  if coalesce(length(trim(p_body)), 0) < 5 then raise exception 'Write the term.'; end if;
  perform set_config('zs.internal', 'on', true);
  if p_id is null then
    insert into po_terms (po_type, body, default_on, sort, created_by)
    values (p_type, trim(p_body), coalesce(p_default, true), (select coalesce(max(sort), 0) + 1 from po_terms where po_type = p_type), m.id)
    returning id into v_id;
  else
    update po_terms set po_type = p_type, body = trim(p_body), default_on = coalesce(p_default, default_on), active = coalesce(p_active, active)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Term not found.'; end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- 5. purchase orders
create table purchase_orders (
  id              bigint generated always as identity primary key,
  po_no           text not null unique,
  po_type         text not null check (po_type in ('plain', 'dtf', 'embroidery', 'patchwork', 'other')),
  vendor_id       bigint not null references vendors(id),
  vendor          jsonb not null,                -- copy of the vendor at the time of the PO
  po_date         date not null default today_ist(),
  delivery_date   date,
  ship_to         text,
  quotation_ref   text,
  tax_mode        text not null check (tax_mode in ('cgst_sgst', 'igst', 'none')),
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  taxable         numeric(12,2) not null default 0,
  cgst            numeric(12,2) not null default 0,
  sgst            numeric(12,2) not null default 0,
  igst            numeric(12,2) not null default 0,
  freight         numeric(12,2) not null default 0,
  freight_tax     numeric(12,2) not null default 0,
  round_off       numeric(12,2) not null default 0,
  grand_total     numeric(12,2) not null default 0,
  terms           text[] not null default '{}',
  payment_terms   text,
  advance_pct     numeric(5,2) not null default 0,
  notes           text,
  status          text not null default 'draft'
                    check (status in ('draft', 'pending', 'approved', 'rejected', 'sent', 'partly_received', 'received', 'cancelled')),
  request_id      bigint references requests(id),
  created_by      uuid not null references members(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  submitted_at    timestamptz,
  approved_at     timestamptz,
  sent_at         timestamptz,
  received_at     timestamptz,
  cancelled_note  text,
  copied_from     bigint references purchase_orders(id)
);
create index on purchase_orders (status, created_at desc);

create table po_items (
  id           bigint generated always as identity primary key,
  po_id        bigint not null references purchase_orders(id),
  line_no      int not null,
  description  text not null,
  specs        jsonb not null default '{}',
  hsn          text,
  unit         text not null default 'pcs',
  qty          numeric(12,2) not null check (qty > 0),
  rate         numeric(12,2) not null check (rate >= 0),
  disc_pct     numeric(5,2) not null default 0 check (disc_pct between 0 and 100),
  gst_rate     numeric(5,2) not null default 0,
  taxable      numeric(12,2) not null,
  tax          numeric(12,2) not null,
  total        numeric(12,2) not null,
  received_qty numeric(12,2) not null default 0,
  product_id   bigint references products(id),
  colour       text,
  colour_hex   text,
  size         text
);
create index on po_items (po_id);

create trigger po_internal  before insert or update or delete on purchase_orders for each row execute function require_internal();
create trigger po_permanent before delete on purchase_orders for each row execute function forbid_change();
create trigger audit_po     after insert or update on purchase_orders for each row execute function write_audit();
create trigger po_items_internal before insert or update or delete on po_items for each row execute function require_internal();
alter table purchase_orders enable row level security;
alter table po_items enable row level security;
create policy po_read on purchase_orders for select to authenticated using ((current_member()).id is not null);
create policy po_items_read on po_items for select to authenticated using ((current_member()).id is not null);
grant select on purchase_orders, po_items to authenticated;

-- financial-year PO number: ZS/PO/26-27/0001
create function next_po_no() returns text language plpgsql security definer set search_path = public as $$
declare d date := today_ist(); y int; fy text; pre text; n int;
begin
  y := case when extract(month from d) >= 4 then extract(year from d)::int else extract(year from d)::int - 1 end;
  fy := lpad((y % 100)::text, 2, '0') || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  pre := coalesce(nullif(trim(setting_text('po_prefix')), ''), 'ZS/PO') || '/' || fy || '/';
  select coalesce(max(nullif(regexp_replace(po_no, '^.*/', ''), '')::int), 0) + 1 into n from purchase_orders where po_no like pre || '%';
  return pre || lpad(n::text, 4, '0');
end $$;

-- create or edit a draft (or a rejected PO). The server works out every rupee.
create function save_po(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
                          product_id, colour, colour_hex, size)
    values (po.id, i, trim(it->>'description'), coalesce(it->'specs', '{}'::jsonb), nullif(trim(it->>'hsn'), ''), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::numeric, (it->>'rate')::numeric, coalesce((it->>'disc_pct')::numeric, 0), v_rate, v_line_taxable, v_line_tax, v_line_taxable + v_line_tax,
            nullif(it->>'product_id', '')::bigint, nullif(initcap(trim(coalesce(it->>'colour', ''))), ''), nullif(it->>'colour_hex', ''), nullif(upper(trim(coalesce(it->>'size', ''))), ''));
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
end $$;

-- send for approval: a partner's PO needs the other 3 partners, Mahendra's needs all 4
create function submit_po(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); po purchase_orders; v_req bigint;
begin
  select * into po from purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'PO not found.'; end if;
  if po.status not in ('draft', 'rejected') then raise exception 'This PO is already %.', po.status; end if;
  if not is_partner() and po.created_by <> m.id then raise exception 'Only the person who made it or a partner can send it for approval.'; end if;
  if not exists (select 1 from po_items where po_id = po.id) then raise exception 'Add at least one item.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into requests (type, amount, description, payload, raised_by, required_approvals)
  values ('purchase_order', po.grand_total,
          'PO ' || po.po_no || ' · ' || (po.vendor->>'code') || ' ' || (po.vendor->>'name') || ' · ' ||
          case po.po_type when 'plain' then 'Plain tees' when 'dtf' then 'DTF prints' when 'embroidery' then 'Embroidery' when 'patchwork' then 'Patchwork' else 'Other' end,
          jsonb_build_object('po_id', po.id, 'po_no', po.po_no), m.id, partner_count())
  returning id into v_req;
  update purchase_orders set status = 'pending', request_id = v_req, submitted_at = now(), updated_at = now() where id = po.id;
  if m.role = 'partner' then
    insert into votes (request_id, member_id, decision, note) values (v_req, m.id, 'approve', 'Made this purchase order');
  end if;
  perform evaluate_request(v_req);
  return (select status from purchase_orders where id = po.id);
end $$;

-- votes on the approval request move the PO
create function po_follow_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare po purchase_orders;
begin
  if new.type::text <> 'purchase_order' or new.status = old.status then return null; end if;
  select * into po from purchase_orders where id = (new.payload->>'po_id')::bigint;
  if po.id is null or po.status <> 'pending' then return null; end if;
  perform set_config('zs.internal', 'on', true);
  if new.status = 'approved' then
    update purchase_orders set status = 'approved', approved_at = now(), updated_at = now() where id = po.id;
    perform _notify('approval', 'PO approved · ' || po.po_no, (po.vendor->>'name') || ' · ready to send to the vendor', null, po.grand_total, true, 'all');
  elsif new.status = 'rejected' then
    update purchase_orders set status = 'rejected', updated_at = now() where id = po.id;
    perform _notify('approval', 'PO rejected · ' || po.po_no, (po.vendor->>'name') || ' · open it to see why, edit and send again', null, po.grand_total, false, 'all');
  elsif new.status = 'cancelled' then
    update purchase_orders set status = 'draft', updated_at = now() where id = po.id;
  end if;
  return null;
end $$;
create trigger requests_po after update of status on requests for each row execute function po_follow_request();

-- sent to vendor, received (into stock), cancelled
create function po_action(p_id bigint, p_action text, p_note text default null, p_items jsonb default '[]'::jsonb) returns text
language plpgsql security definer set search_path = public as $$
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
        insert into blank_moves (colour, colour_hex, size, qty, reason, cost, note, by_member)
        values (it.colour, it.colour_hex, it.size, q::int, 'purchase', round(it.total / it.qty * q, 2), 'PO ' || po.po_no || ' · ' || (po.vendor->>'name'), m.id);
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
end $$;

-- one view for the list and the A4 page
create view po_board with (security_invoker = true) as
select po.*,
       mk.name as created_by_name, mk.role as created_by_role,
       (select jsonb_agg(to_jsonb(i) order by i.line_no) from po_items i where i.po_id = po.id) as items,
       (select coalesce(jsonb_agg(jsonb_build_object('name', vm.name, 'decision', vt.decision, 'note', vt.note, 'at', vt.created_at) order by vt.created_at), '[]'::jsonb)
          from votes vt join members vm on vm.id = vt.member_id where vt.request_id = po.request_id) as votes,
       r.required_approvals
from purchase_orders po
join members mk on mk.id = po.created_by
left join requests r on r.id = po.request_id;
grant select on po_board to authenticated;

-- ---------------------------------------------------------------- 6. the approval engine knows about POs
create or replace function apply_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requests;
  e ledger;
  v_petty numeric;
  v_big   numeric;
begin
  select * into r from requests where id = p_id;
  perform set_config('zs.internal', 'on', true);

  case r.type::text
    when 'expense' then
      insert into ledger (kind, amount, description, request_id, category, campaign, influencer_id)
      values ('expense', -r.amount, r.description, r.id, nullif(r.payload->>'category', ''),
              nullif(r.payload->>'campaign', ''), (r.payload->>'influencer_id')::bigint);
    when 'income' then
      insert into ledger (kind, amount, description, request_id, category) values ('income', r.amount, r.description, r.id, nullif(r.payload->>'category', ''));
    when 'capital_in' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('capital_in', r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);
    when 'partner_payout' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('partner_payout', -r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);
    when 'reversal' then
      select * into e from ledger where id = (r.payload->>'entry_id')::bigint;
      insert into ledger (kind, amount, partner_id, description, request_id, reverses_entry, order_id, category, campaign, influencer_id)
      values (e.kind, -e.amount, e.partner_id, 'Reversal of entry #' || e.id || ': ' || r.description, r.id, e.id, e.order_id,
              e.category, e.campaign, e.influencer_id);
    when 'setting_change' then
      update settings set value = to_jsonb((r.payload->>'value')::numeric), updated_at = now() where key = r.payload->>'key';
      v_petty := setting_num('employee_petty_limit');
      v_big   := setting_num('all_partner_limit');
      if v_petty >= v_big then
        raise exception 'Employee limit (₹%) must stay below the all-partner limit (₹%).', v_petty, v_big;
      end if;
    when 'share_rule' then
      update settings set value = to_jsonb(r.payload->>'profit_rule'), updated_at = now() where key = 'profit_rule';
      update settings set value = to_jsonb(r.payload->>'loss_rule'),   updated_at = now() where key = 'loss_rule';
      if r.payload ? 'split' then
        update settings set value = r.payload->'split', updated_at = now() where key = 'custom_split';
      end if;
    when 'price_change' then
      update products set price = (r.payload->>'price')::numeric, mrp = (r.payload->>'mrp')::numeric
      where id = (r.payload->>'product_id')::bigint;
    when 'stock_writeoff' then
      perform 1 from product_variants where id = (r.payload->>'variant_id')::bigint for update;
      if stock_of((r.payload->>'variant_id')::bigint) < (r.payload->>'qty')::int then
        raise exception 'Not enough stock left to write off.';
      end if;
      insert into stock_moves (variant_id, qty, reason, note)
      values ((r.payload->>'variant_id')::bigint, -(r.payload->>'qty')::int, 'writeoff',
              case when r.payload ? 'influencer_id' then 'Gift to influencer #' || (r.payload->>'influencer_id') || ': ' else '' end || r.description);
    when 'hr_policy' then
      update settings set value = value || (r.payload->'policy'), updated_at = now() where key = 'hr_policy';
    when 'salary_change' then
      insert into employee_pay (member_id, monthly_salary) values ((r.payload->>'member_id')::uuid, (r.payload->>'salary')::numeric)
      on conflict (member_id) do update set monthly_salary = excluded.monthly_salary, updated_at = now();
    when 'decision' then
      null;  -- the decision itself is the record
    when 'coupon' then
      null;
    when 'discount' then
      null;  -- used once on the bill it was approved for
    when 'purchase_order' then
      null;  -- the PO follows the request through po_follow_request
    else
      null;
  end case;
end $$;

revoke execute on function save_vendor(jsonb), save_po_term(bigint, text, text, boolean, boolean), save_po(jsonb), submit_po(bigint),
  po_action(bigint, text, text, jsonb), next_po_no() from public, anon;
grant execute on function save_vendor(jsonb), save_po_term(bigint, text, text, boolean, boolean), save_po(jsonb), submit_po(bigint),
  po_action(bigint, text, text, jsonb) to authenticated;
grant execute on function gstin_ok(text) to authenticated;

notify pgrst, 'reload schema';
