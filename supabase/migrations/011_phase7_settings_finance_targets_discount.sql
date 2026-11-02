-- =====================================================================
-- Z-SHIRTS · Phase 7 · settings for everything, GST slabs + HSN, product
-- cost sheet + per-tee finance, partners' finance inputs, daily / weekly /
-- monthly targets, partner discount rule
-- Run after 010. Run the ALTER TYPE line on its own first in Supabase.
-- =====================================================================
alter type request_type add value if not exists 'discount';

-- ---------------------------------------------------------------- 1. settings: every rule lives here
alter table settings add column if not exists kind      text not null default 'number';
alter table settings add column if not exists grp       text not null default 'Shop';
alter table settings add column if not exists protected boolean not null default false;   -- needs all partners

select set_config('zs.internal', 'on', false);
insert into settings (key, value, label) values
  ('gst_threshold',            '2500'::jsonb,       'GST: price per piece up to which the low rate applies (₹)'),
  ('gst_rate_low',             '5'::jsonb,          'GST: rate up to the threshold (%)'),
  ('gst_rate_high',            '18'::jsonb,         'GST: rate above the threshold (%)'),
  ('hsn_cotton',               '"61091000"'::jsonb, 'HSN code: cotton T-shirts'),
  ('hsn_synthetic',            '"610990"'::jsonb,   'HSN code: synthetic, silk or wool T-shirts'),
  ('discount_free_pct',        '10'::jsonb,         'Discount a partner can give without approval (%)'),
  ('discount_bulk_pcs',        '25'::jsonb,         'Bulk deal: tees in one bill for a bigger approved discount'),
  ('max_partner_discount_pct', '50'::jsonb,         'Highest discount a partner can ever give (%)'),
  ('business_name',            '"Z-SHIRTS"'::jsonb, 'Business name on bills'),
  ('business_address',         '""'::jsonb,         'Business address on bills'),
  ('gstin',                    '""'::jsonb,         'GSTIN'),
  ('store_whatsapp',           '""'::jsonb,         'Store WhatsApp number (91XXXXXXXXXX)'),
  ('instagram',                '""'::jsonb,         'Instagram handle'),
  ('store_open_time',          '"10:00"'::jsonb,    'Store opens at'),
  ('store_close_time',         '"21:00"'::jsonb,    'Store closes at'),
  ('max_qty_per_line',         '20'::jsonb,         'Most pieces of one size a customer can order online')
on conflict (key) do nothing;

update settings set grp = 'Money & approvals', protected = true
 where key in ('employee_petty_limit', 'all_partner_limit', 'profit_rule', 'loss_rule', 'custom_split', 'discount_free_pct', 'discount_bulk_pcs', 'max_partner_discount_pct');
update settings set grp = 'Selling'  where key in ('shipping_fee', 'free_shipping_above', 'cod_enabled', 'max_store_discount_pct', 'return_window_days', 'low_stock_alert');
update settings set grp = 'Z-Club'   where key like 'loyalty%';
update settings set grp = 'Tax & GST' where key in ('gst_threshold', 'gst_rate_low', 'gst_rate_high', 'hsn_cotton', 'hsn_synthetic', 'income_tax_rate_pct', 'gstin');
update settings set grp = 'Business' where key in ('business_name', 'business_address', 'store_whatsapp', 'instagram', 'store_open_time', 'store_close_time', 'delivery_days');
update settings set grp = 'Team & HR' where key = 'hr_policy';
update settings set label = 'Discount Mahendra can give on a bill (%)' where key = 'max_store_discount_pct';
update settings set kind = 'text'   where key in ('hsn_cotton', 'hsn_synthetic', 'business_name', 'business_address', 'gstin', 'store_whatsapp', 'instagram', 'profit_rule', 'loss_rule');
update settings set kind = 'time'   where key in ('store_open_time', 'store_close_time');
update settings set kind = 'object' where jsonb_typeof(value) = 'object';
update settings set kind = 'switch' where key = 'cod_enabled';
select set_config('zs.internal', 'off', false);

-- Any partner can change any setting straight away (logged, and all partners are told).
-- Settings that protect partners from each other still need all partners (they go through a request).
create or replace function update_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); s settings; v jsonb := p_value;
begin
  if not is_partner() then raise exception 'Only partners change settings.'; end if;
  select * into s from settings where key = p_key;
  if s.key is null then raise exception 'Unknown setting.'; end if;
  if s.protected then raise exception 'This setting protects all partners, so all of them must approve. Send it for approval.'; end if;
  if s.kind = 'number' and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0) then raise exception 'Enter a number (0 or more).'; end if;
  if s.kind = 'switch' and (v #>> '{}') not in ('0', '1') then raise exception 'Use on or off.'; end if;
  if s.kind = 'object' then
    if jsonb_typeof(v) <> 'object' then raise exception 'Invalid value.'; end if;
    v := s.value || v;
  end if;
  if p_key = 'gst_rate_low' and (v #>> '{}')::numeric > 28 or p_key = 'gst_rate_high' and (v #>> '{}')::numeric > 40 then raise exception 'That GST rate looks wrong.'; end if;
  if v = s.value then return s.value; end if;
  perform set_config('zs.internal', 'on', true);
  update settings set value = v, updated_at = now() where key = p_key;
  perform _notify('approval', m.name || ' changed a setting', s.label || ': ' || coalesce(s.value #>> '{}', s.value::text) || ' → ' || coalesce(v #>> '{}', v::text), null, null, false, 'partners');
  if p_key in ('gst_threshold', 'gst_rate_low', 'gst_rate_high') then
    update products set gst_rate = gst_rate_for(price);
  end if;
  return v;
end $$;

-- the shop needs a few business details
create or replace view public_settings as
select key, value from settings
where key in ('shipping_fee', 'free_shipping_above', 'cod_enabled', 'return_window_days',
              'loyalty_points_per_100', 'loyalty_max_redeem_pct', 'business_name', 'store_whatsapp', 'instagram', 'gst_threshold', 'gst_rate_low', 'gst_rate_high');

-- ---------------------------------------------------------------- 2. GST slabs + HSN on every product and bill line
create or replace function gst_rate_for(p_price numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_price > coalesce(setting_num('gst_threshold'), 2500) then coalesce(setting_num('gst_rate_high'), 18)
              else coalesce(setting_num('gst_rate_low'), 5) end
$$;

alter table products    add column if not exists fabric_type text not null default 'cotton' check (fabric_type in ('cotton', 'synthetic'));
alter table products    add column if not exists hsn_code    text;
alter table order_items add column if not exists hsn_code    text;
alter table order_items add column if not exists gst_rate    numeric(5,2);

create or replace function product_tax_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.hsn_code := coalesce(nullif(new.hsn_code, ''),
    case when new.fabric_type = 'synthetic' then (select value #>> '{}' from settings where key = 'hsn_synthetic')
         else (select value #>> '{}' from settings where key = 'hsn_cotton') end);
  new.gst_rate := gst_rate_for(new.price);
  return new;
end $$;
drop trigger if exists products_tax on products;
create trigger products_tax before insert or update of price, fabric_type, hsn_code on products for each row execute function product_tax_fill();

create or replace function order_item_tax_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(new.hsn_code, p.hsn_code) into new.hsn_code from product_variants pv join products p on p.id = pv.product_id where pv.id = new.variant_id;
  new.gst_rate := coalesce(new.gst_rate, gst_rate_for(new.price));
  return new;
end $$;
drop trigger if exists order_items_tax on order_items;
create trigger order_items_tax before insert on order_items for each row execute function order_item_tax_fill();

select set_config('zs.internal', 'on', false);
update products set fabric_type = fabric_type;   -- fills HSN + GST rate on existing products
select set_config('zs.internal', 'off', false);

-- products: partners set cotton / synthetic (changes HSN)
create or replace function set_product_tax(p_product bigint, p_fabric_type text, p_hsn text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners change tax details.'; end if;
  if p_fabric_type not in ('cotton', 'synthetic') then raise exception 'Choose cotton or synthetic.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set fabric_type = p_fabric_type, hsn_code = nullif(trim(coalesce(p_hsn, '')), '') where id = p_product;
end $$;

-- ---------------------------------------------------------------- 3. product cost sheet (partners edit freely, every change logged)
create table product_costs (
  product_id  bigint primary key references products(id),
  blank       numeric(10,2) not null default 0 check (blank >= 0),
  dtf         numeric(10,2) not null default 0 check (dtf >= 0),
  printing    numeric(10,2) not null default 0 check (printing >= 0),
  packing     numeric(10,2) not null default 0 check (packing >= 0),
  tag_label   numeric(10,2) not null default 0 check (tag_label >= 0),
  other       numeric(10,2) not null default 0 check (other >= 0),
  shipping    numeric(10,2) not null default 0 check (shipping >= 0),   -- per online order piece, not in cost price
  notes       text,
  updated_by  uuid references members(id),
  updated_at  timestamptz not null default now()
);

create function save_product_costs(p_product bigint, p jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v numeric;
begin
  if not is_partner() then raise exception 'Only partners edit the cost sheet.'; end if;
  if not exists (select 1 from products where id = p_product) then raise exception 'Product not found.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into product_costs (product_id, blank, dtf, printing, packing, tag_label, other, shipping, notes, updated_by)
  values (p_product, coalesce((p->>'blank')::numeric, 0), coalesce((p->>'dtf')::numeric, 0), coalesce((p->>'printing')::numeric, 0),
          coalesce((p->>'packing')::numeric, 0), coalesce((p->>'tag_label')::numeric, 0), coalesce((p->>'other')::numeric, 0),
          coalesce((p->>'shipping')::numeric, 0), p->>'notes', m.id)
  on conflict (product_id) do update set blank = excluded.blank, dtf = excluded.dtf, printing = excluded.printing, packing = excluded.packing,
    tag_label = excluded.tag_label, other = excluded.other, shipping = excluded.shipping, notes = excluded.notes,
    updated_by = excluded.updated_by, updated_at = now();
  select blank + dtf + printing + packing + tag_label + other into v from product_costs where product_id = p_product;
  update products set cost_price = v where id = p_product;
  return v;
end $$;

-- ---------------------------------------------------------------- 4. partners' own finance inputs (add / change / remove, all logged)
create table finance_inputs (
  id          bigint generated always as identity primary key,
  month       date not null check (extract(day from month) = 1),
  kind        text not null check (kind in ('depreciation', 'overhead', 'interest', 'other_income', 'tax_paid')),
  amount      numeric(12,2) not null check (amount >= 0),
  note        text not null,
  created_by  uuid references members(id),
  updated_at  timestamptz not null default now()
);

create function save_finance_input(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint;
begin
  if not is_partner() then raise exception 'Partners only.'; end if;
  if coalesce(trim(p->>'note'), '') = '' then raise exception 'Write what this is.'; end if;
  perform set_config('zs.internal', 'on', true);
  if (p->>'delete')::boolean then
    delete from finance_inputs where id = (p->>'id')::bigint;
    perform _notify('approval', m.name || ' removed a finance entry', p->>'note', null, null, false, 'partners');
    return null;
  end if;
  if p->>'id' is null then
    insert into finance_inputs (month, kind, amount, note, created_by)
    values (date_trunc('month', (p->>'month')::date)::date, p->>'kind', (p->>'amount')::numeric, trim(p->>'note'), m.id) returning id into v_id;
  else
    update finance_inputs set month = date_trunc('month', (p->>'month')::date)::date, kind = p->>'kind', amount = (p->>'amount')::numeric,
      note = trim(p->>'note'), updated_at = now() where id = (p->>'id')::bigint returning id into v_id;
  end if;
  perform _notify('approval', m.name || ' updated finance inputs', (p->>'kind') || ' ₹' || (p->>'amount') || ' · ' || trim(p->>'note'), null, (p->>'amount')::numeric, false, 'partners');
  return v_id;
end $$;

create or replace function finance_statement(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sales numeric; v_refunds numeric; v_gst numeric; v_rate numeric; v_income numeric; v_cogs numeric; v_prod numeric;
  v_opex numeric; v_equip numeric; v_interest numeric; v_tax_paid numeric; v_rev numeric; v_gp numeric; v_ebitda numeric;
  v_ebit numeric; v_pbt numeric; v_tax numeric; v_pat numeric; v_cats jsonb; v_cogs_basis text; v_taxrate numeric;
begin
  if not is_partner() then raise exception 'Partners only.'; end if;
  select coalesce(sum(amount), 0) into v_sales from ledger where kind = 'sale' and entry_date >= p_from and entry_date < p_to;
  select coalesce(-sum(amount), 0) into v_refunds from ledger where kind = 'refund' and entry_date >= p_from and entry_date < p_to;
  select coalesce(sum(amount), 0) into v_income from ledger where kind = 'income' and entry_date >= p_from and entry_date < p_to;
  -- weighted GST rate of what was sold (5% for tees up to ₹2,500 a piece)
  select coalesce(sum(i.line_total * coalesce(i.gst_rate, gst_rate_for(i.price))) / nullif(sum(i.line_total), 0), coalesce(setting_num('gst_rate_low'), 5)) into v_rate
  from ledger l join order_items i on i.order_id = l.order_id
  where l.kind = 'sale' and l.entry_date >= p_from and l.entry_date < p_to;
  v_gst := round((v_sales - v_refunds) * v_rate / (100 + v_rate), 2);
  v_rev := v_sales - v_refunds - v_gst;
  -- cost of the tees sold (from production cost); orders returned later are left out
  select coalesce(sum(i.unit_cost * i.qty), 0) into v_cogs
  from ledger l join orders o on o.id = l.order_id join order_items i on i.order_id = o.id
  where l.kind = 'sale' and l.entry_date >= p_from and l.entry_date < p_to and o.status not in ('returned', 'rto');
  select coalesce(-sum(amount), 0) into v_prod from ledger where kind = 'expense' and category = 'production' and entry_date >= p_from and entry_date < p_to;
  v_cogs_basis := 'cost price';
  if v_cogs = 0 and v_prod > 0 then v_cogs := v_prod; v_cogs_basis := 'production spend'; end if;
  select coalesce(-sum(amount) filter (where coalesce(category, 'other') not in ('production', 'equipment', 'interest', 'tax')), 0),
         coalesce(-sum(amount) filter (where category = 'equipment'), 0),
         coalesce(-sum(amount) filter (where category = 'interest'), 0),
         coalesce(-sum(amount) filter (where category = 'tax'), 0)
    into v_opex, v_equip, v_interest, v_tax_paid
  from ledger where kind = 'expense' and entry_date >= p_from and entry_date < p_to;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cats from (
    select coalesce(category, 'other') as cat, -sum(amount) as amt from ledger
    where kind = 'expense' and entry_date >= p_from and entry_date < p_to group by 1) x;
  -- partners' own finance inputs (depreciation, overheads, other income, tax paid) for the period
  v_opex := v_opex + coalesce((select sum(amount) from finance_inputs where kind = 'overhead' and month >= date_trunc('month', p_from) and month < p_to), 0);
  v_equip := v_equip + coalesce((select sum(amount) from finance_inputs where kind = 'depreciation' and month >= date_trunc('month', p_from) and month < p_to), 0);
  v_interest := v_interest + coalesce((select sum(amount) from finance_inputs where kind = 'interest' and month >= date_trunc('month', p_from) and month < p_to), 0);
  v_income := v_income + coalesce((select sum(amount) from finance_inputs where kind = 'other_income' and month >= date_trunc('month', p_from) and month < p_to), 0);
  v_tax_paid := v_tax_paid + coalesce((select sum(amount) from finance_inputs where kind = 'tax_paid' and month >= date_trunc('month', p_from) and month < p_to), 0);
  v_taxrate := coalesce(setting_num('income_tax_rate_pct'), 31.2);
  v_gp := v_rev - v_cogs;
  v_ebitda := v_gp - v_opex;
  v_ebit := v_ebitda - v_equip;                 -- equipment is written off in the month it is bought
  v_pbt := v_ebit - v_interest + v_income;
  v_tax := round(greatest(v_pbt, 0) * v_taxrate / 100, 2);
  v_pat := v_pbt - v_tax;
  return jsonb_build_object(
    'from', p_from, 'to', p_to - 1,
    'gross_sales', v_sales, 'refunds', v_refunds, 'gst_rate', round(v_rate, 2), 'output_gst', v_gst, 'revenue', v_rev,
    'cogs', v_cogs, 'cogs_basis', v_cogs_basis, 'production_spend', v_prod, 'gross_profit', v_gp,
    'opex', v_opex, 'expenses_by_category', v_cats, 'ebitda', v_ebitda, 'depreciation', v_equip, 'ebit', v_ebit,
    'interest', v_interest, 'other_income', v_income, 'pbt', v_pbt, 'tax_rate', v_taxrate, 'tax', v_tax, 'pat', v_pat,
    'tax_paid', v_tax_paid,
    'gross_margin', case when v_rev > 0 then round(100 * v_gp / v_rev, 1) end,
    'ebitda_margin', case when v_rev > 0 then round(100 * v_ebitda / v_rev, 1) end,
    'ebit_margin', case when v_rev > 0 then round(100 * v_ebit / v_rev, 1) end,
    'net_margin', case when v_rev > 0 then round(100 * v_pat / v_rev, 1) end,
    'orders', (select count(distinct order_id) from ledger where kind = 'sale' and entry_date >= p_from and entry_date < p_to),
    'cash_balance', (select coalesce(sum(amount), 0) from ledger where entry_date < p_to));
end $$;

-- per-tee finance: each tee carries its share of the month's costs (by revenue)
create function product_finance(p_from date, p_to date) returns table (
  product_id bigint, name text, units bigint, revenue numeric, cogs numeric, gross_profit numeric, opex numeric,
  ebitda numeric, depreciation numeric, ebit numeric, interest numeric, pbt numeric, tax numeric, net_profit numeric,
  gross_margin numeric, net_margin numeric, cost_per_tee numeric, profit_per_tee numeric)
language plpgsql stable security definer set search_path = public as $$
declare f jsonb;
begin
  if not is_partner() then raise exception 'Partners only.'; end if;
  f := finance_statement(p_from, p_to);
  return query
  with s as (
    select pv.product_id as pid, sum(i.qty)::bigint as u,
           sum(i.line_total * case when o.subtotal > 0 then (o.total - o.shipping) / o.subtotal else 1 end / (1 + coalesce(i.gst_rate, 5) / 100)) as rev,
           sum(i.unit_cost * i.qty) as c
    from ledger l join orders o on o.id = l.order_id join order_items i on i.order_id = o.id join product_variants pv on pv.id = i.variant_id
    where l.kind = 'sale' and l.entry_date >= p_from and l.entry_date < p_to and o.status not in ('returned', 'rto')
    group by pv.product_id
  ), t as (select sum(rev) as tot from s)
  select p.id, p.name, s.u, round(s.rev, 2), round(s.c, 2), round(s.rev - s.c, 2),
    round((f->>'opex')::numeric * s.rev / nullif(t.tot, 0), 2),
    round(s.rev - s.c - (f->>'opex')::numeric * s.rev / nullif(t.tot, 0), 2),
    round((f->>'depreciation')::numeric * s.rev / nullif(t.tot, 0), 2),
    round(s.rev - s.c - ((f->>'opex')::numeric + (f->>'depreciation')::numeric) * s.rev / nullif(t.tot, 0), 2),
    round(((f->>'interest')::numeric - (f->>'other_income')::numeric) * s.rev / nullif(t.tot, 0), 2),
    round(s.rev - s.c - ((f->>'opex')::numeric + (f->>'depreciation')::numeric + (f->>'interest')::numeric - (f->>'other_income')::numeric) * s.rev / nullif(t.tot, 0), 2),
    round((f->>'tax')::numeric * s.rev / nullif(t.tot, 0), 2),
    round((f->>'pat')::numeric * s.rev / nullif(t.tot, 0), 2),
    round(100 * (s.rev - s.c) / nullif(s.rev, 0), 1),
    round(100 * ((f->>'pat')::numeric * s.rev / nullif(t.tot, 0)) / nullif(s.rev, 0), 1),
    p.cost_price,
    round(((f->>'pat')::numeric * s.rev / nullif(t.tot, 0)) / nullif(s.u, 0), 2)
  from s join products p on p.id = s.pid cross join t
  order by s.rev desc;
end $$;

-- ---------------------------------------------------------------- 5. daily / weekly / monthly targets for each person
create table standing_targets (
  id            bigint generated always as identity primary key,
  member_id     uuid references members(id),        -- null = whole business
  period        text not null check (period in ('day', 'week', 'month')),
  target_pcs    int not null default 0 check (target_pcs >= 0),
  target_amount numeric(12,2) not null default 0 check (target_amount >= 0),
  updated_by    uuid references members(id),
  updated_at    timestamptz not null default now(),
  unique nulls not distinct (member_id, period)
);

create function set_standing_target(p_member uuid, p_period text, p_pcs int, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare m members := current_member();
begin
  if not is_partner() then raise exception 'Only partners set targets.'; end if;
  if p_period not in ('day', 'week', 'month') then raise exception 'Choose day, week or month.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into standing_targets (member_id, period, target_pcs, target_amount, updated_by)
  values (p_member, p_period, greatest(coalesce(p_pcs, 0), 0), greatest(coalesce(p_amount, 0), 0), m.id)
  on conflict (member_id, period) do update set target_pcs = excluded.target_pcs, target_amount = excluded.target_amount,
    updated_by = excluded.updated_by, updated_at = now();
  if p_period = 'month' then   -- keep this month's milestone in step
    perform set_target(today_ist(), p_member, p_pcs, p_amount);
  end if;
end $$;

-- progress for today / this week (Mon-Sun) / this month, for the business and every person
create function target_now(p_period text default 'day') returns table (
  member_id uuid, name text, role text, target_pcs int, target_amount numeric, pcs bigint, amount numeric, orders bigint, period_start date, period_end date)
language plpgsql stable security definer set search_path = public as $$
declare
  d0 date := case p_period when 'day' then today_ist() when 'week' then date_trunc('week', today_ist())::date else date_trunc('month', today_ist())::date end;
  d1 date := case p_period when 'day' then today_ist() + 1 when 'week' then date_trunc('week', today_ist())::date + 7 else (date_trunc('month', today_ist()) + interval '1 month')::date end;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  return query
  with o as (
    select o.id, o.sold_by, o.total - o.shipping as value, (select coalesce(sum(i.qty), 0) from order_items i where i.order_id = o.id) as pcs
    from orders o
    where (o.created_at at time zone 'Asia/Kolkata')::date >= d0 and (o.created_at at time zone 'Asia/Kolkata')::date < d1
      and o.status not in ('cancelled', 'rto', 'returned') and not (o.payment_method = 'online' and o.payment_status = 'pending')
  ), tg as (
    select st.member_id as mid, st.target_pcs as tp, st.target_amount as ta from standing_targets st where st.period = p_period
    union all
    select x.member_id, x.target_pcs, x.target_amount from sales_targets x where p_period = 'month' and x.month = d0
      and not exists (select 1 from standing_targets st2 where st2.period = 'month' and st2.member_id is not distinct from x.member_id)
  )
  select null::uuid, 'Z-SHIRTS (all sales)'::text, 'business'::text,
    coalesce((select tp from tg where mid is null limit 1), 0), coalesce((select ta from tg where mid is null limit 1), 0),
    coalesce((select sum(o.pcs) from o), 0)::bigint, coalesce((select sum(o.value) from o), 0), (select count(*) from o), d0, d1 - 1
  union all
  select mm.id, mm.name, mm.role::text,
    coalesce((select tp from tg where mid = mm.id limit 1), 0), coalesce((select ta from tg where mid = mm.id limit 1), 0),
    coalesce((select sum(o.pcs) from o where o.sold_by = mm.id), 0)::bigint, coalesce((select sum(o.value) from o where o.sold_by = mm.id), 0),
    (select count(*) from o where o.sold_by = mm.id), d0, d1 - 1
  from members mm where mm.active;
end $$;

-- ---------------------------------------------------------------- 6. partner discount rule (+ bulk quantities at the counter)
create or replace function _price_cart(p_channel text, p_items jsonb, p_opts jsonb, p_lock boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
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
           p.is_preorder, p.drop_at
      into v
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = it.variant_id and pv.active and p.active and p.published_at is not null;
    if not found then raise exception 'One of the items is no longer available.'; end if;
    if v.drop_at is not null and v.drop_at > now() then
      raise exception '% drops on % — it can''t be ordered yet.', v.name,
        to_char(v.drop_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
    end if;
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
  end if;

  return jsonb_build_object(
    'lines', lines, 'mrp_total', v_mrp, 'subtotal', v_sub,
    'bundle_name', v_bname, 'bundle_discount', v_best,
    'manual_discount', v_manual,
    'coupon_code', case when v_cerr is null and v_code <> '' then v_code end,
    'coupon_discount', v_cdisc, 'coupon_error', v_cerr,
    'points_used', v_pts, 'points_balance', case when v_cust is not null then points_of(v_cust) end,
    'shipping', v_ship, 'total', v_after + v_ship,
    'points_earn', floor(v_after * coalesce(setting_num('loyalty_points_per_100'), 0) / 100),
    'errors', v_errors);
end $$;

create or replace function staff_quote(p_channel text, p_items jsonb, p_discount_pct numeric default 0, p_coupon text default null,
                            p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  return _price_cart(p_channel, p_items,
    jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon, 'phone', p_phone, 'staff', true), false);
end $$;

drop function if exists staff_create_order(text, jsonb, jsonb, text, numeric, text, text, uuid, text);
create function staff_create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                                   p_discount_pct numeric default 0, p_note text default null,
                                   p_coupon text default null, p_sold_by uuid default null,
                                   p_sold_by_name text default null, p_discount_request bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  v_paid boolean;
  v_here boolean := is_in_person(p_channel);
  v_who text;
  v_free numeric := coalesce(setting_num('discount_free_pct'), 10);
  v_max numeric;
  v_excess numeric := 0;
  v_req requests;
  v_covered boolean := false;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_channel not in ('store', 'event', 'stall', 'instagram', 'whatsapp', 'referral', 'influencer') then
    raise exception 'Choose where this sale happened.';
  end if;
  if v_here and p_method not in ('cash', 'upi') then raise exception 'In-person sales are paid by cash or UPI.'; end if;
  if not v_here and p_method not in ('upi', 'cod') then raise exception 'Choose prepaid (UPI) or cash on delivery.'; end if;
  -- Mahendra: up to the store limit. Partners: higher, but above the free % it is on them unless all partners approved.
  v_max := case when m.role = 'partner' then coalesce(setting_num('max_partner_discount_pct'), 50) else coalesce(setting_num('max_store_discount_pct'), 0) end;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > v_max then
    raise exception 'Discount can be at most %', v_max || '%.';
  end if;
  if p_discount_request is not null then
    select * into v_req from requests where id = p_discount_request;
    if v_req.id is null or v_req.type::text <> 'discount' or v_req.status <> 'approved' or v_req.raised_by <> m.id then
      raise exception 'That discount approval is not valid for you.';
    end if;
    if v_req.payload ? 'used_order' then raise exception 'That discount approval was already used on %.', v_req.payload->>'used_order'; end if;
    if coalesce(p_discount_pct, 0) > (v_req.payload->>'pct')::numeric then
      raise exception 'Partners approved up to %', (v_req.payload->>'pct') || '% only.';
    end if;
    v_covered := true;
  end if;
  if p_sold_by is not null and not exists (select 1 from members where id = p_sold_by and active) then
    raise exception 'Choose who made this sale.';
  end if;

  o := _create_order(p_channel, p_customer, p_items, p_method, m.id,
                     jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon,
                                        'sold_by', p_sold_by, 'sold_by_name', p_sold_by_name, 'staff', true));
  v_paid := p_method in ('cash', 'upi');

  perform set_config('zs.internal', 'on', true);
  update orders set
    payment_status = case when v_paid then 'paid' else 'pending' end,
    status = case when v_here then 'delivered' else 'confirmed' end,
    delivered_at = case when v_here then now() end,
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = o.id returning * into o;
  v_who := coalesce((select name from members where id = o.sold_by), o.sold_by_name, m.name);
  perform _event(o.id, o.status, case when v_here then 'Sold at ' || lower(channel_label(p_channel)) || ' · ' || upper(p_method) || ' · by ' || v_who
                                      else 'Confirmed by ' || m.name || ' · sold by ' || v_who end);
  if v_paid then perform _post_sale(o.id); end if;
  -- discount above the free % given by a partner: the business keeps it only with all-partner approval
  if m.role = 'partner' and coalesce(p_discount_pct, 0) > v_free then
    select round(coalesce(sum(i.price * i.qty), 0) * (p_discount_pct - v_free) / 100, 0) into v_excess from order_items i where i.order_id = o.id;
    v_excess := least(v_excess, greatest(o.discount - o.bundle_discount - o.coupon_discount - o.points_used, 0));
    if v_covered then
      update requests set payload = payload || jsonb_build_object('used_order', o.order_no) where id = v_req.id;
      perform _event(o.id, o.status, p_discount_pct || '% discount approved by all partners (request #' || v_req.id || ')');
    elsif v_excess > 0 then
      insert into ledger (kind, amount, description, order_id)
      values ('income', v_excess, 'Discount above ' || v_free || '% on ' || o.order_no || ' borne by ' || m.name, o.id);
      insert into ledger (kind, amount, partner_id, description, order_id)
      values ('partner_payout', -v_excess, m.id, 'Charged to ' || m.name || ': discount above ' || v_free || '% on ' || o.order_no, o.id);
      perform _event(o.id, o.status, p_discount_pct || '% discount · ₹' || v_excess || ' above ' || v_free || '% charged to ' || m.name);
      perform _notify('approval', m.name || ' gave ' || p_discount_pct || '% off on ' || o.order_no,
        '₹' || v_excess || ' above ' || v_free || '% goes to ' || m.name || '''s personal account', o.id, v_excess, false, 'partners');
    end if;
  end if;
  if o.status = 'delivered' and o.payment_status = 'paid' then perform _earn_points(o.id); end if;
  perform _notify(case when v_here then 'sale' else 'order' end,
    case when v_here then channel_label(p_channel) || ' sale' else 'New ' || channel_label(p_channel) || ' order' end
      || case when v_paid then ' · Paid' else ' · COD' end,
    o.customer_name || ' · ' || o.order_no || ' · by ' || v_who, o.id, o.total, true);
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'id', o.id);
end $$;

create or replace function raise_request(
  p_type        request_type,
  p_amount      numeric,
  p_description text,
  p_proof_path  text  default null,
  p_payload     jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m        members;
  v_req    int;
  v_n      int := partner_count();
  v_petty  numeric := setting_num('employee_petty_limit');
  v_big    numeric := setting_num('all_partner_limit');
  v_id     bigint;
  v_sum    numeric;
  e        ledger;
  pr       products;
  k        text;
begin
  m := current_member();
  if m.id is null then raise exception 'You are not registered as a Z-SHIRTS member.'; end if;
  if m.role = 'employee' and p_type::text not in ('expense', 'income', 'stock_writeoff') then
    raise exception 'Employees can only record expenses, income and damaged stock.';
  end if;
  if month_is_closed(today_ist()) then raise exception 'This month is already closed by all partners.'; end if;
  p_payload := coalesce(p_payload, '{}'::jsonb);

  case p_type::text
    when 'expense' then
      if p_amount is null then raise exception 'Enter the expense amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then raise exception 'A photo of the bill is required for every expense.'; end if;
      v_req := case when p_amount <= v_petty then 0 when p_amount <= v_big then least(2, v_n) else v_n end;

    when 'income' then
      if p_amount is null then raise exception 'Enter the amount received.'; end if;
      v_req := least(2, v_n);

    when 'capital_in', 'partner_payout' then
      if p_amount is null then raise exception 'Enter the amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then raise exception 'Attach the bank transfer screenshot as proof.'; end if;
      if not exists (select 1 from members where id = (p_payload->>'partner_id')::uuid and role = 'partner' and active) then
        raise exception 'Choose which partner this is for.';
      end if;
      v_req := v_n;

    when 'reversal' then
      select * into e from ledger where id = (p_payload->>'entry_id')::bigint;
      if e.id is null then raise exception 'Entry not found.'; end if;
      if e.reverses_entry is not null then raise exception 'A reversal cannot itself be reversed. Raise a new entry.'; end if;
      if exists (select 1 from ledger where reverses_entry = e.id) then raise exception 'Entry #% has already been reversed.', e.id; end if;
      if exists (select 1 from requests where type = 'reversal' and status = 'pending' and payload->>'entry_id' = e.id::text) then
        raise exception 'A reversal for entry #% is already waiting for approval.', e.id;
      end if;
      p_amount := abs(e.amount);
      v_req := v_n;

    when 'setting_change' then
      k := p_payload->>'key';
      if k not in ('employee_petty_limit', 'all_partner_limit', 'shipping_fee', 'free_shipping_above',
                   'cod_enabled', 'max_store_discount_pct', 'low_stock_alert', 'return_window_days',
                   'loyalty_points_per_100', 'loyalty_max_redeem_pct', 'income_tax_rate_pct', 'discount_free_pct', 'discount_bulk_pcs', 'max_partner_discount_pct') then
        raise exception 'That setting cannot be changed this way.';
      end if;
      if (p_payload->>'value')::numeric is null or (p_payload->>'value')::numeric < 0
         or (k in ('employee_petty_limit', 'all_partner_limit') and (p_payload->>'value')::numeric <= 0) then
        raise exception 'Enter a valid amount.';
      end if;
      if k = 'cod_enabled' and (p_payload->>'value')::numeric not in (0, 1) then raise exception 'Use 1 for on, 0 for off.'; end if;
      if k in ('max_store_discount_pct', 'loyalty_max_redeem_pct') and (p_payload->>'value')::numeric > 90 then raise exception 'That percentage is too high.'; end if;
      if (k = 'employee_petty_limit' and (p_payload->>'value')::numeric >= v_big)
         or (k = 'all_partner_limit' and (p_payload->>'value')::numeric <= v_petty) then
        raise exception 'Employee limit must stay below the all-partner limit (now ₹% and ₹%).', v_petty, v_big;
      end if;
      v_req := v_n;

    when 'share_rule' then
      if p_payload->>'profit_rule' not in ('investment', 'equal', 'custom')
         or p_payload->>'loss_rule' not in ('investment', 'equal', 'custom') then
        raise exception 'Choose equal, investment ratio or custom for both profit and loss.';
      end if;
      if 'custom' in (p_payload->>'profit_rule', p_payload->>'loss_rule') then
        if jsonb_typeof(p_payload->'split') is distinct from 'object' then raise exception 'Enter the percentage for every partner.'; end if;
        if exists (select 1 from members where role = 'partner' and active and not (p_payload->'split' ? id::text)) then
          raise exception 'Enter the percentage for every partner.';
        end if;
        select sum(value::numeric) into v_sum from jsonb_each_text(p_payload->'split');
        if v_sum is distinct from 100 then raise exception 'The custom percentages must add up to 100 (now %).', v_sum; end if;
        if exists (select 1 from jsonb_each_text(p_payload->'split') where value::numeric < 0) then
          raise exception 'Percentages cannot be negative.';
        end if;
      end if;
      v_req := v_n;

    when 'price_change' then
      select * into pr from products where id = (p_payload->>'product_id')::bigint;
      if pr.id is null then raise exception 'Product not found.'; end if;
      if (p_payload->>'price')::numeric is null or (p_payload->>'mrp')::numeric is null
         or (p_payload->>'price')::numeric <= 0 or (p_payload->>'price')::numeric > (p_payload->>'mrp')::numeric then
        raise exception 'Selling price must be above 0 and not more than MRP.';
      end if;
      if exists (select 1 from requests where type::text = 'price_change' and status = 'pending'
                 and payload->>'product_id' = pr.id::text) then
        raise exception 'A price change for this product is already waiting for approval.';
      end if;
      v_req := v_n;

    when 'stock_writeoff' then
      if (p_payload->>'qty')::int is null or (p_payload->>'qty')::int <= 0 then raise exception 'Enter how many pieces.'; end if;
      if stock_of((p_payload->>'variant_id')::bigint) < (p_payload->>'qty')::int then
        raise exception 'Only % in stock.', stock_of((p_payload->>'variant_id')::bigint);
      end if;
      v_req := v_n;

    when 'hr_policy' then
      if jsonb_typeof(p_payload->'policy') is distinct from 'object' then raise exception 'Nothing to change.'; end if;
      if exists (select 1 from jsonb_object_keys(p_payload->'policy') k2
                 where k2 not in ('shift_start', 'shift_end', 'grace_min', 'lates_per_half_day', 'weekly_off', 'paid_leaves_per_month',
                                  'ot_after', 'ot_multiplier', 'office_lat', 'office_lng', 'office_radius_m', 'lunch_min', 'half_day_allowed')) then
        raise exception 'Unknown HR rule.';
      end if;
      v_req := v_n;

    when 'salary_change' then
      if not exists (select 1 from members where id = (p_payload->>'member_id')::uuid and role = 'employee') then raise exception 'Choose the employee.'; end if;
      if (p_payload->>'salary')::numeric is null or (p_payload->>'salary')::numeric < 0 then raise exception 'Enter the monthly salary.'; end if;
      v_req := v_n;

    when 'discount' then
      if (p_payload->>'pct')::numeric is null or (p_payload->>'pct')::numeric <= coalesce(setting_num('discount_free_pct'), 10)
         or (p_payload->>'pct')::numeric > coalesce(setting_num('max_partner_discount_pct'), 50) then
        raise exception 'Ask for a discount between % and %', coalesce(setting_num('discount_free_pct'), 10) || '%', coalesce(setting_num('max_partner_discount_pct'), 50) || '%.';
      end if;
      if (p_payload->>'pieces')::int is null or (p_payload->>'pieces')::int <= 0 then raise exception 'How many tees in this deal?'; end if;
      v_req := v_n;
    when 'decision' then
      if coalesce(length(trim(p_description)), 0) < 5 then raise exception 'Describe the decision.'; end if;
      v_req := case when p_payload->>'rule' = 'majority' then (v_n / 2) + 1 else v_n end;

    else
      raise exception 'Unknown request type.';
  end case;

  perform set_config('zs.internal', 'on', true);
  insert into requests (type, amount, description, proof_path, payload, raised_by, required_approvals)
  values (p_type, p_amount, trim(p_description), nullif(trim(p_proof_path), ''), p_payload, m.id, v_req)
  returning id into v_id;

  if m.role = 'partner' and v_req > 0 then
    insert into votes (request_id, member_id, decision, note) values (v_id, m.id, 'approve', 'Raised this request');
  end if;
  perform evaluate_request(v_id);
  return v_id;
end $$;

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
  end case;
end $$;

-- one place partners can read every change made to settings, costs, targets and finance inputs
create view change_log with (security_invoker = true) as
select a.id, a.at, a.actor_name, a.action, a.table_name, a.row_ref, a.old_data, a.new_data
from audit_log a
where a.table_name in ('settings', 'product_costs', 'standing_targets', 'sales_targets', 'finance_inputs', 'coupons', 'bundles', 'products', 'employee_pay', 'members')
  and is_partner();

-- bills show HSN + GST per line
drop view if exists order_board;
create view order_board with (security_invoker = true) as
select o.*,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'variant', i.variant_label,
                                            'qty', i.qty, 'price', i.price, 'variant_id', i.variant_id, 'hsn', i.hsn_code, 'gst', i.gst_rate) order by i.id)
        from order_items i where i.order_id = o.id) as items,
       (select coalesce(sum(qty), 0) from order_items i where i.order_id = o.id) as pieces,
       (select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note, 'by', e.actor_name) order by e.at)
        from order_events e where e.order_id = o.id) as events,
       (select count(*) from service_requests s where s.order_id = o.id and s.status in ('open', 'approved')) as open_requests,
       (select c.name from customers c where c.id = o.customer_id) as account_name
from orders o;
revoke all on order_board from anon;
grant select on order_board to authenticated;

-- ---------------------------------------------------------------- guards + access
do $$
declare t text;
begin
  foreach t in array array['product_costs', 'finance_inputs', 'standing_targets'] loop
    execute format('create trigger %I before insert or update or delete on %I for each row execute function require_internal()', t || '_internal', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function write_audit()', 'audit_' || t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create policy pcost_read on product_costs    for select to authenticated using (is_partner());
create policy finin_read on finance_inputs   for select to authenticated using (is_partner());
create policy stgt_read  on standing_targets for select to authenticated using ((current_member()).id is not null);

revoke all on product_costs, finance_inputs, standing_targets, change_log from anon;
grant select on product_costs, finance_inputs, standing_targets, change_log to authenticated;
revoke execute on function update_setting(text, jsonb), set_product_tax(bigint, text, text), save_product_costs(bigint, jsonb), save_finance_input(jsonb),
  product_finance(date, date), set_standing_target(uuid, text, int, numeric), target_now(text),
  staff_create_order(text, jsonb, jsonb, text, numeric, text, text, uuid, text, bigint) from public, anon;
grant execute on function update_setting(text, jsonb), set_product_tax(bigint, text, text), save_product_costs(bigint, jsonb), save_finance_input(jsonb),
  product_finance(date, date), set_standing_target(uuid, text, int, numeric), target_now(text),
  staff_create_order(text, jsonb, jsonb, text, numeric, text, text, uuid, text, bigint), gst_rate_for(numeric) to authenticated;
