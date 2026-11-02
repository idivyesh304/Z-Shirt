-- =====================================================================
-- Z-SHIRTS · Phase 3 · Growth, operations and money features
--   A. Customers (Google login), loyalty, coupons, bundles, drops,
--      pre-orders, pincode delivery check, restock alerts, push outbox
--   B. Production batches, cost price + profit, daily cash close,
--      HR (attendance, leave, payroll), influencers, ad spend,
--      partner voting, monthly + investor reports
-- Run after 001-004.
-- =====================================================================

alter type request_type add value if not exists 'hr_policy';
alter type request_type add value if not exists 'salary_change';
alter type request_type add value if not exists 'decision';
alter type request_type add value if not exists 'coupon';

-- guards also cover deletes now (return the old row so allowed deletes go through)
create or replace function require_internal() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('zs.internal', true), '') <> 'on' then
    raise exception 'Direct changes to % are not allowed. Use the Z-SHIRTS app.', tg_table_name;
  end if;
  return coalesce(new, old);
end $$;

select set_config('zs.internal', 'on', false);

insert into settings (key, value, label) values
  ('loyalty_points_per_100', '5'::jsonb,  'Z-Club points earned per ₹100 spent (1 point = ₹1)'),
  ('loyalty_max_redeem_pct', '20'::jsonb, 'Max % of an order that can be paid with points'),
  ('delivery_days',          '{"city":"1-2","state":"2-4","india":"4-7","home_city":"Ahmedabad","home_state":"Gujarat"}'::jsonb,
                             'Delivery estimate by distance'),
  ('hr_policy',              '{"shift_start":"10:00","shift_end":"19:00","grace_min":15,"lates_per_half_day":3,
                               "weekly_off":"Tuesday","paid_leaves_per_month":1,"ot_after":"19:30","ot_multiplier":1,
                               "office_lat":null,"office_lng":null,"office_radius_m":200}'::jsonb,
                             'Attendance, leave and overtime rules')
on conflict (key) do nothing;

-- competitors give 15-30 days; start at 15 (partners can change it)
update settings set value = '15'::jsonb where key = 'return_window_days' and value = '7'::jsonb;

select set_config('zs.internal', 'off', false);

-- =====================================================================
-- A1. Customers + loyalty
-- =====================================================================
create table customers (
  id            bigint generated always as identity primary key,
  auth_user_id  uuid unique,
  name          text,
  email         text,
  phone         text,
  created_at    timestamptz not null default now()
);
create index on customers (phone);

create table loyalty_ledger (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references customers(id),
  points       int not null check (points <> 0),
  reason       text not null check (reason in ('earn', 'redeem', 'reverse', 'bonus')),
  order_id     bigint references orders(id),
  note         text,
  created_at   timestamptz not null default now()
);
create index on loyalty_ledger (customer_id);

create function my_customer_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from customers where auth_user_id = auth.uid()
$$;

create function points_of(p_customer bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int from loyalty_ledger where customer_id = p_customer
$$;

-- Logged-in shopper (Google) creates / updates their profile
create function save_my_profile(p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  c customers;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  if (current_member()).id is not null then raise exception 'Team logins cannot shop as customers.'; end if;
  if p_phone is not null and length(phone10(p_phone)) <> 10 then raise exception 'Enter a valid 10-digit mobile number.'; end if;
  select email into v_email from auth.users where id = v_uid;
  perform set_config('zs.internal', 'on', true);
  insert into customers (auth_user_id, name, email, phone)
  values (v_uid, nullif(trim(coalesce(p_name, '')), ''), v_email, nullif(phone10(p_phone), ''))
  on conflict (auth_user_id) do update
    set name = coalesce(excluded.name, customers.name),
        phone = coalesce(excluded.phone, customers.phone),
        email = coalesce(excluded.email, customers.email)
  returning * into c;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'points', points_of(c.id));
end $$;

create function my_account() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c customers;
begin
  select * into c from customers where auth_user_id = auth.uid();
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'points', points_of(c.id),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
                 'order_no', o.order_no, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                 'phone', o.customer_phone, 'delivered_at', o.delivered_at,
                 'payment_status', o.payment_status, 'production_status', o.production_status,
                 'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'variant', i.variant_label, 'qty', i.qty,
                                                               'variant_id', i.variant_id, 'price', i.price)) from order_items i where i.order_id = o.id))
               order by o.created_at desc), '[]'::jsonb)
               from orders o where o.customer_id = c.id),
    'points_history', (select coalesce(jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'at', l.created_at, 'note', l.note)
                       order by l.id desc), '[]'::jsonb) from loyalty_ledger l where l.customer_id = c.id));
end $$;

-- =====================================================================
-- A2. Catalogue extras: drops, limited editions, pre-orders, cost price
-- =====================================================================
alter table products add column if not exists cost_price  numeric(10,2) not null default 0 check (cost_price >= 0);
alter table products add column if not exists drop_name   text;
alter table products add column if not exists drop_at     timestamptz;
alter table products add column if not exists limited_qty int check (limited_qty is null or limited_qty > 0);
alter table products add column if not exists is_preorder boolean not null default false;

-- orders remember where the money came from
alter table orders add column if not exists customer_id       bigint references customers(id);
alter table orders add column if not exists coupon_code       text;
alter table orders add column if not exists coupon_discount   numeric(12,2) not null default 0;
alter table orders add column if not exists bundle_name       text;
alter table orders add column if not exists bundle_discount   numeric(12,2) not null default 0;
alter table orders add column if not exists points_used       int not null default 0;
alter table orders add column if not exists utm_source        text;
alter table orders add column if not exists utm_campaign      text;
alter table orders add column if not exists production_status text
  check (production_status is null or production_status in ('queued', 'printing', 'quality_check', 'ready'));

alter table order_items add column if not exists unit_cost numeric(10,2) not null default 0;

-- =====================================================================
-- A3. Coupons and bundles
-- =====================================================================
create table influencers (
  id          bigint generated always as identity primary key,
  name        text not null,
  handle      text,
  platform    text not null default 'Instagram',
  phone       text,
  city        text,
  followers   int,
  notes       text,
  active      boolean not null default true,
  created_by  uuid references members(id),
  created_at  timestamptz not null default now()
);

create table coupons (
  id                  bigint generated always as identity primary key,
  code                text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,20}$'),
  description         text,
  kind                text not null check (kind in ('percent', 'flat')),
  value               numeric(10,2) not null check (value > 0),
  min_order           numeric(10,2) not null default 0,
  max_discount        numeric(10,2),
  channel             text not null default 'both' check (channel in ('online', 'store', 'both')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  usage_limit         int,
  per_customer_limit  int not null default 1,
  first_order_only    boolean not null default false,
  influencer_id       bigint references influencers(id),
  active              boolean not null default true,
  created_by          uuid references members(id),
  created_at          timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90)
);

create table bundles (
  id           bigint generated always as identity primary key,
  name         text not null,
  qty          int not null check (qty between 2 and 10),
  price        numeric(10,2) not null check (price > 0),
  product_ids  bigint[] not null default '{}',     -- empty = every product
  active       boolean not null default true,
  created_by   uuid references members(id),
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- A4. Pricing engine: one place computes every price, discount and total
-- =====================================================================
-- p_opts: {coupon, points, discount_pct, customer_id, phone}
create function _price_cart(p_channel text, p_items jsonb, p_opts jsonb, p_lock boolean) returns jsonb
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
  v_online  boolean := p_channel <> 'store';
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
    if it.qty is null or it.qty <= 0 or it.qty > 20 then raise exception 'Quantity must be between 1 and 20.'; end if;
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

-- Shop: live price preview for the bag (no login needed)
create function quote_cart(p_items jsonb, p_opts jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  p_opts := coalesce(p_opts, '{}'::jsonb) - 'discount_pct' || jsonb_build_object('customer_id', my_customer_id());
  return _price_cart('website', p_items, p_opts, false);
end $$;

-- Team app: live price preview at the counter / for a DM order
create function staff_quote(p_channel text, p_items jsonb, p_discount_pct numeric default 0, p_coupon text default null,
                            p_phone text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  return _price_cart(p_channel, p_items,
    jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon, 'phone', p_phone), false);
end $$;

-- =====================================================================
-- A5. Orders go through the pricing engine
-- =====================================================================
drop function if exists place_web_order(jsonb, jsonb, text);
drop function if exists staff_create_order(text, jsonb, jsonb, text, numeric, text);
drop function if exists _create_order(text, jsonb, jsonb, text, uuid, numeric);

create function _create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                              p_member uuid, p_opts jsonb) returns orders
language plpgsql security definer set search_path = public as $$
declare
  o       orders;
  q       jsonb;
  l       jsonb;
  v_name  text := trim(coalesce(p_customer->>'name', ''));
  v_phone text := phone10(p_customer->>'phone');
  v_addr  jsonb := coalesce(p_customer->'address', '{}'::jsonb);
  v_pre   boolean := false;
  v_cust  bigint := (p_opts->>'customer_id')::bigint;
begin
  if p_channel = 'store' then
    v_name := coalesce(nullif(v_name, ''), 'Walk-in customer');
  else
    if length(v_name) < 2 then raise exception 'Enter the customer''s name.'; end if;
    if length(v_phone) <> 10 then raise exception 'Enter a valid 10-digit mobile number.'; end if;
    if coalesce(trim(v_addr->>'line1'), '') = '' or coalesce(trim(v_addr->>'city'), '') = ''
       or coalesce(v_addr->>'pincode', '') !~ '^\d{6}$' then
      raise exception 'Enter the full delivery address with a 6-digit pincode.';
    end if;
  end if;
  -- store / social orders can be linked to a registered customer by phone
  if v_cust is null and length(v_phone) = 10 and p_member is not null then
    select id into v_cust from customers where phone = v_phone and auth_user_id is not null order by id limit 1;
  end if;

  q := _price_cart(p_channel, p_items, p_opts || jsonb_build_object('customer_id', v_cust, 'phone', v_phone), true);

  perform set_config('zs.internal', 'on', true);
  insert into orders (channel, customer_name, customer_phone, customer_email, address, payment_method, created_by,
                      customer_id, mrp_total, subtotal, discount, shipping, total,
                      coupon_code, coupon_discount, bundle_name, bundle_discount, points_used,
                      utm_source, utm_campaign)
  values (p_channel, v_name, nullif(v_phone, ''), nullif(trim(coalesce(p_customer->>'email', '')), ''),
          v_addr, p_method, p_member, v_cust,
          (q->>'mrp_total')::numeric, (q->>'subtotal')::numeric,
          (q->>'bundle_discount')::numeric + (q->>'manual_discount')::numeric + (q->>'coupon_discount')::numeric + (q->>'points_used')::numeric,
          (q->>'shipping')::numeric, (q->>'total')::numeric,
          q->>'coupon_code', (q->>'coupon_discount')::numeric, q->>'bundle_name', (q->>'bundle_discount')::numeric,
          (q->>'points_used')::int,
          left(nullif(trim(coalesce(p_opts->>'utm_source', '')), ''), 60), left(nullif(trim(coalesce(p_opts->>'utm_campaign', '')), ''), 80))
  returning * into o;

  for l in select * from jsonb_array_elements(q->'lines') loop
    insert into order_items (order_id, variant_id, product_name, variant_label, qty, mrp, price, line_total, unit_cost)
    values (o.id, (l->>'variant_id')::bigint, l->>'name', l->>'label', (l->>'qty')::int,
            (l->>'mrp')::numeric, (l->>'price')::numeric, (l->>'price')::numeric * (l->>'qty')::int, (l->>'cost')::numeric);
    insert into stock_moves (variant_id, qty, reason, order_id, by_member)
    values ((l->>'variant_id')::bigint, -(l->>'qty')::int, 'sale', o.id, p_member);
    if (l->>'preorder')::boolean then v_pre := true; end if;
  end loop;

  if v_pre then update orders set production_status = 'queued' where id = o.id returning * into o; end if;
  if (q->>'points_used')::int > 0 then
    insert into loyalty_ledger (customer_id, points, reason, order_id, note)
    values (v_cust, -(q->>'points_used')::int, 'redeem', o.id, 'Used on ' || o.order_no);
  end if;

  perform _event(o.id, 'placed', channel_label(p_channel) || ' order'
    || case when o.coupon_code is not null then ' · coupon ' || o.coupon_code else '' end
    || case when v_pre then ' · pre-order' else '' end);
  return o;
end $$;

create function place_web_order(p_customer jsonb, p_items jsonb, p_method text, p_opts jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if p_method not in ('online', 'cod') then raise exception 'Choose online payment or cash on delivery.'; end if;
  if p_method = 'cod' and coalesce(setting_num('cod_enabled'), 0) = 0 then
    raise exception 'Cash on delivery is not available right now.';
  end if;
  if (current_member()).id is not null then raise exception 'Team logins cannot place shop orders. Use Sell in the team app.'; end if;
  if p_method = 'cod' and exists (select 1 from cod_blocked_pincodes where pincode = p_customer->'address'->>'pincode') then
    raise exception 'Cash on delivery is not available for this pincode. Please pay online.';
  end if;
  p_opts := coalesce(p_opts, '{}'::jsonb) - 'discount_pct' || jsonb_build_object('customer_id', my_customer_id());
  o := _create_order('website', p_customer, p_items, p_method, null, p_opts);
  if p_method = 'cod' then
    perform _notify('order', 'New website order · COD', o.customer_name || ' · ' || o.order_no, o.id, o.total, true);
  end if;
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'shipping', o.shipping,
                            'payment_method', o.payment_method);
end $$;

create function staff_create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                                   p_discount_pct numeric default 0, p_note text default null,
                                   p_coupon text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  v_paid boolean;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_channel not in ('instagram', 'whatsapp', 'store') then raise exception 'Choose Store, Instagram or WhatsApp.'; end if;
  if p_channel = 'store' and p_method not in ('cash', 'upi') then raise exception 'Store sales are paid by cash or UPI.'; end if;
  if p_channel <> 'store' and p_method not in ('upi', 'cod') then raise exception 'Choose prepaid (UPI) or cash on delivery.'; end if;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > coalesce(setting_num('max_store_discount_pct'), 0) then
    raise exception 'Discount can be at most %', setting_num('max_store_discount_pct') || '%.';
  end if;

  o := _create_order(p_channel, p_customer, p_items, p_method, m.id,
                     jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon));
  v_paid := p_method in ('cash', 'upi');

  perform set_config('zs.internal', 'on', true);
  update orders set
    payment_status = case when v_paid then 'paid' else 'pending' end,
    status = case when p_channel = 'store' then 'delivered' else 'confirmed' end,
    delivered_at = case when p_channel = 'store' then now() end,
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = o.id returning * into o;
  perform _event(o.id, o.status, case when p_channel = 'store' then 'Sold at store · ' || upper(p_method) else 'Confirmed by ' || m.name end);
  if v_paid then perform _post_sale(o.id); end if;
  if o.status = 'delivered' and o.payment_status = 'paid' then perform _earn_points(o.id); end if;
  perform _notify('order',
    case p_channel when 'store' then 'Store sale' else 'New ' || channel_label(p_channel) || ' order' end
      || case when v_paid then ' · Paid' else ' · COD' end,
    o.customer_name || ' · ' || o.order_no || ' · by ' || m.name, o.id, o.total, true);
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'id', o.id);
end $$;

-- Points are earned once an order is delivered and paid; taken back on RTO/return
create function _earn_points(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; v_pts int;
begin
  select * into o from orders where id = p_order;
  if o.customer_id is null then return; end if;
  if exists (select 1 from loyalty_ledger where order_id = o.id and reason = 'earn') then return; end if;
  v_pts := floor((o.total - o.shipping) * coalesce(setting_num('loyalty_points_per_100'), 0) / 100);
  if v_pts <= 0 then return; end if;
  perform set_config('zs.internal', 'on', true);
  insert into loyalty_ledger (customer_id, points, reason, order_id, note) values (o.customer_id, v_pts, 'earn', o.id, 'Order ' || o.order_no);
end $$;

create function _reverse_points(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; v_net int;
begin
  select * into o from orders where id = p_order;
  if o.customer_id is null then return; end if;
  select coalesce(sum(points), 0) into v_net from loyalty_ledger where order_id = o.id;
  if v_net = 0 then return; end if;
  perform set_config('zs.internal', 'on', true);
  insert into loyalty_ledger (customer_id, points, reason, order_id, note) values (o.customer_id, -v_net, 'reverse', o.id, 'Order ' || o.order_no || ' ' || o.status);
end $$;

create function points_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'delivered' and new.payment_status = 'paid' and (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status) then
    perform _earn_points(new.id);
  elsif new.status in ('cancelled', 'rto', 'returned') and old.status is distinct from new.status then
    perform _reverse_points(new.id);
  end if;
  return null;
end $$;
create trigger orders_points after update on orders for each row execute function points_on_status();

-- Pre-order / custom print making status, visible to the customer
create function set_production_status(p_order_id bigint, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  if p_status not in ('queued', 'printing', 'quality_check', 'ready') then raise exception 'Unknown making status.'; end if;
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  perform set_config('zs.internal', 'on', true);
  update orders set production_status = p_status, updated_at = now() where id = o.id;
  perform _event(o.id, o.status, 'Making: ' || replace(initcap(p_status), '_', ' '));
  perform _push_customer(o.customer_id, 'Your Z-SHIRTS order ' || o.order_no,
    case p_status when 'printing' then 'Your tee is being printed.' when 'quality_check' then 'Your tee is in quality check.'
                  when 'ready' then 'Your tee is ready and will ship soon.' else 'Your order is in the making queue.' end,
    '?track=' || o.order_no);
  return p_status;
end $$;

-- =====================================================================
-- A6. Delivery check by pincode
-- =====================================================================
create table cod_blocked_pincodes (
  pincode    text primary key check (pincode ~ '^\d{6}$'),
  reason     text,
  created_at timestamptz not null default now()
);

create function delivery_check(p_pincode text, p_city text default null, p_state text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb := (select value from settings where key = 'delivery_days');
  v_days text;
  v_zone text;
begin
  if coalesce(p_pincode, '') !~ '^\d{6}$' then raise exception 'Enter a 6-digit pincode.'; end if;
  v_zone := case when lower(coalesce(p_city, '')) = lower(d->>'home_city') then 'city'
                 when lower(coalesce(p_state, '')) = lower(d->>'home_state') then 'state'
                 else 'india' end;
  v_days := d->>v_zone;
  return jsonb_build_object(
    'zone', v_zone, 'days', v_days,
    'by_date', to_char((now() at time zone 'Asia/Kolkata')::date + split_part(v_days, '-', 2)::int, 'Dy, DD Mon'),
    'cod', coalesce(setting_num('cod_enabled'), 0) = 1 and not exists (select 1 from cod_blocked_pincodes where pincode = p_pincode));
end $$;

-- =====================================================================
-- A7. Push notifications (outbox, sent by the 'push' server function)
--     + restock alerts
-- =====================================================================
create table push_subscriptions (
  id           bigint generated always as identity primary key,
  endpoint     text not null unique,
  p256dh       text not null,
  auth_key     text not null,
  member_id    uuid references members(id),
  customer_id  bigint references customers(id),
  created_at   timestamptz not null default now(),
  failed_at    timestamptz
);

create table push_outbox (
  id               bigint generated always as identity primary key,
  audience         text,
  subscription_id  bigint references push_subscriptions(id),
  title            text not null,
  body             text,
  url              text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index on push_outbox (sent_at) where sent_at is null;

create table restock_requests (
  id               bigint generated always as identity primary key,
  variant_id       bigint not null references product_variants(id),
  subscription_id  bigint references push_subscriptions(id),
  customer_id      bigint references customers(id),
  created_at       timestamptz not null default now(),
  notified_at      timestamptz,
  unique (variant_id, subscription_id)
);

create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Invalid subscription.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into push_subscriptions (endpoint, p256dh, auth_key, member_id, customer_id)
  values (p_endpoint, p_p256dh, p_auth, (current_member()).id, my_customer_id())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        member_id = coalesce(excluded.member_id, push_subscriptions.member_id),
        customer_id = coalesce(excluded.customer_id, push_subscriptions.customer_id),
        failed_at = null
  returning id into v_id;
  return v_id;
end $$;

create function request_restock(p_variant bigint, p_endpoint text) returns text
language plpgsql security definer set search_path = public as $$
declare v_sub bigint;
begin
  if not exists (select 1 from product_variants where id = p_variant) then raise exception 'Size not found.'; end if;
  select id into v_sub from push_subscriptions where endpoint = p_endpoint;
  if v_sub is null then raise exception 'Allow notifications first.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into restock_requests (variant_id, subscription_id, customer_id) values (p_variant, v_sub, my_customer_id())
  on conflict (variant_id, subscription_id) do update set notified_at = null, created_at = now();
  return 'ok';
end $$;

create function _push_customer(p_customer bigint, p_title text, p_body text, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null then return; end if;
  perform set_config('zs.internal', 'on', true);
  insert into push_outbox (subscription_id, title, body, url)
  select id, p_title, p_body, p_url from push_subscriptions where customer_id = p_customer and failed_at is null;
end $$;

-- every team notification becomes a phone push
create function notif_to_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  insert into push_outbox (audience, title, body, url)
  values (new.audience, new.title,
          concat_ws(' · ', case when new.amount is not null then '₹' || trim(to_char(new.amount, 'FM99,99,99,990')) end, new.body),
          'admin/');
  return null;
end $$;
create trigger notifications_push after insert on notifications for each row execute function notif_to_push();

-- a size coming back into stock pings everyone waiting for it
create function restock_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.qty > 0 and stock_of(new.variant_id) > 0 and stock_of(new.variant_id) - new.qty <= 0 then
    select p.name, p.slug, pv.colour, pv.size into v
    from product_variants pv join products p on p.id = pv.product_id where pv.id = new.variant_id;
    perform set_config('zs.internal', 'on', true);
    insert into push_outbox (subscription_id, title, body, url)
    select r.subscription_id, 'Back in stock: ' || v.name, v.colour || ' / ' || v.size || ' is back. Grab it before it''s gone.',
           '?p=' || v.slug
    from restock_requests r where r.variant_id = new.variant_id and r.notified_at is null and r.subscription_id is not null;
    update restock_requests set notified_at = now() where variant_id = new.variant_id and notified_at is null;
  end if;
  return null;
end $$;
create trigger stock_restock_push after insert on stock_moves for each row execute function restock_push();

-- order updates reach the customer's phone
create function order_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is not null and old.status is distinct from new.status and new.status in ('confirmed', 'shipped', 'delivered') then
    perform _push_customer(new.customer_id, 'Order ' || new.order_no,
      case new.status when 'confirmed' then 'Confirmed! We''re getting it ready.'
                      when 'shipped' then 'On the way' || coalesce(' with ' || new.courier, '') || '.'
                      else 'Delivered. Enjoy the fit!' end,
      '?track=' || new.order_no);
  end if;
  return null;
end $$;
create trigger orders_push after update on orders for each row execute function order_push();

-- server-side helpers for the push function (service role only)
create table app_secrets (key text primary key, value text not null);
alter table app_secrets enable row level security;   -- no policies: only the database owner and service role

create view push_public_key as
select value as key from app_secrets where key = 'vapid_public';

-- =====================================================================
-- B1. Production batches → stock + weighted cost price
-- =====================================================================
create sequence batch_no_seq start 101;
create table production_batches (
  id             bigint generated always as identity primary key,
  code           text not null unique default ('PB' || nextval('batch_no_seq')),
  product_id     bigint not null references products(id),
  items          jsonb not null,                    -- [{variant_id, qty}]
  stage          text not null default 'planned'
                   check (stage in ('planned', 'blanks', 'printing', 'quality_check', 'ready', 'cancelled')),
  supplier       text,
  blank_cost     numeric(12,2) not null default 0 check (blank_cost >= 0),
  print_cost     numeric(12,2) not null default 0 check (print_cost >= 0),
  other_cost     numeric(12,2) not null default 0 check (other_cost >= 0),
  expected_date  date,
  notes          text,
  created_by     uuid references members(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  ready_at       timestamptz
);

create function save_batch(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); b production_batches; v_id bigint; it jsonb;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'Add at least one size and quantity.'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if (it->>'qty')::int is null or (it->>'qty')::int <= 0 then raise exception 'Every quantity must be above 0.'; end if;
    if not exists (select 1 from product_variants where id = (it->>'variant_id')::bigint and product_id = (p->>'product_id')::bigint) then
      raise exception 'A size does not belong to this product.';
    end if;
  end loop;
  perform set_config('zs.internal', 'on', true);
  if p->>'id' is null then
    insert into production_batches (product_id, items, supplier, blank_cost, print_cost, other_cost, expected_date, notes, created_by)
    values ((p->>'product_id')::bigint, p->'items', p->>'supplier', coalesce((p->>'blank_cost')::numeric, 0),
            coalesce((p->>'print_cost')::numeric, 0), coalesce((p->>'other_cost')::numeric, 0),
            (p->>'expected_date')::date, p->>'notes', m.id)
    returning id into v_id;
  else
    select * into b from production_batches where id = (p->>'id')::bigint for update;
    if b.stage in ('ready', 'cancelled') then raise exception 'A % batch cannot be edited.', b.stage; end if;
    update production_batches set items = p->'items', supplier = p->>'supplier',
      blank_cost = coalesce((p->>'blank_cost')::numeric, 0), print_cost = coalesce((p->>'print_cost')::numeric, 0),
      other_cost = coalesce((p->>'other_cost')::numeric, 0), expected_date = (p->>'expected_date')::date,
      notes = p->>'notes', updated_at = now()
    where id = b.id;
    v_id := b.id;
  end if;
  return v_id;
end $$;

create function set_batch_stage(p_id bigint, p_stage text) returns text
language plpgsql security definer set search_path = public as $$
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
end $$;

-- manual cost price for products made before tracking started (partners)
create function set_cost_price(p_product bigint, p_cost numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners can set the cost price.'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'Enter a valid cost.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set cost_price = p_cost where id = p_product;
end $$;

-- =====================================================================
-- B2. Daily cash close
-- =====================================================================
create table cash_closes (
  day          date primary key,
  opening      numeric(12,2) not null,
  cash_sales   numeric(12,2) not null,
  cash_refunds numeric(12,2) not null,
  cash_out     numeric(12,2) not null,
  expected     numeric(12,2) not null,
  counted      numeric(12,2) not null,
  difference   numeric(12,2) not null,
  note         text,
  photo_path   text not null,
  by_member    uuid references members(id),
  created_at   timestamptz not null default now()
);

create function cash_day_preview(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, today_ist());
  v_open numeric; v_sales numeric; v_ref numeric;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  select counted into v_open from cash_closes where day < v_day order by day desc limit 1;
  select coalesce(sum(l.amount), 0) into v_sales from ledger l join orders o on o.id = l.order_id
   where l.kind = 'sale' and o.payment_method = 'cash' and l.entry_date = v_day;
  select coalesce(-sum(l.amount), 0) into v_ref from ledger l join orders o on o.id = l.order_id
   where l.kind = 'refund' and o.payment_method = 'cash' and l.entry_date = v_day;
  return jsonb_build_object('day', v_day, 'opening', coalesce(v_open, 0), 'cash_sales', v_sales, 'cash_refunds', v_ref,
                            'closed', exists (select 1 from cash_closes where day = v_day));
end $$;

create function close_cash_day(p_counted numeric, p_cash_out numeric, p_note text, p_photo text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  pv jsonb;
  c cash_closes;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash you counted.'; end if;
  if coalesce(p_cash_out, 0) < 0 then raise exception 'Cash taken out cannot be negative.'; end if;
  if coalesce(trim(p_photo), '') = '' then raise exception 'Add a photo of the counted cash.'; end if;
  pv := cash_day_preview(p_day);
  if (pv->>'closed')::boolean then raise exception 'This day is already closed.'; end if;
  if coalesce(p_cash_out, 0) > 0 and coalesce(trim(p_note), '') = '' then raise exception 'Write where the cash taken out went (bank deposit, expense…).'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into cash_closes (day, opening, cash_sales, cash_refunds, cash_out, expected, counted, difference, note, photo_path, by_member)
  values ((pv->>'day')::date, (pv->>'opening')::numeric, (pv->>'cash_sales')::numeric, (pv->>'cash_refunds')::numeric,
          coalesce(p_cash_out, 0),
          (pv->>'opening')::numeric + (pv->>'cash_sales')::numeric - (pv->>'cash_refunds')::numeric - coalesce(p_cash_out, 0),
          p_counted,
          p_counted - ((pv->>'opening')::numeric + (pv->>'cash_sales')::numeric - (pv->>'cash_refunds')::numeric - coalesce(p_cash_out, 0)),
          nullif(trim(coalesce(p_note, '')), ''), p_photo, m.id)
  returning * into c;
  if c.difference <> 0 then
    perform _notify('approval', 'Cash ' || case when c.difference < 0 then 'short' else 'extra' end || ' by ₹' || abs(c.difference),
      'Cash close ' || to_char(c.day, 'DD Mon') || ' by ' || m.name || ' · expected ₹' || c.expected || ', counted ₹' || c.counted,
      null, abs(c.difference), false, 'partners');
  end if;
  return to_jsonb(c);
end $$;

-- =====================================================================
-- B3. HR: attendance, leave, payroll
-- =====================================================================
create table employee_pay (
  member_id       uuid primary key references members(id),
  monthly_salary  numeric(10,2) not null default 0 check (monthly_salary >= 0),
  updated_at      timestamptz not null default now()
);

create table attendance (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references members(id),
  day         date not null,
  in_at       timestamptz,
  out_at      timestamptz,
  in_photo    text,
  out_photo   text,
  in_lat      numeric, in_lng numeric,
  out_lat     numeric, out_lng numeric,
  late_min    int not null default 0,
  unique (member_id, day)
);

create table leave_requests (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references members(id),
  from_day    date not null,
  to_day      date not null,
  kind        text not null check (kind in ('paid', 'unpaid', 'half_day')),
  reason      text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by  uuid references members(id),
  decided_at  timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  check (to_day >= from_day)
);

create function hr_policy() returns jsonb
language sql stable security definer set search_path = public as $$ select value from settings where key = 'hr_policy' $$;

create function _distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create function punch(p_kind text, p_photo text, p_lat numeric, p_lng numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  pol jsonb := hr_policy();
  v_now timestamptz := now();
  v_day date := today_ist();
  v_start timestamp;
  v_late int := 0;
  a attendance;
begin
  if m.id is null or m.role <> 'employee' then raise exception 'Attendance is for employees.'; end if;
  if p_kind not in ('in', 'out') then raise exception 'Choose check in or check out.'; end if;
  if coalesce(trim(p_photo), '') = '' then raise exception 'Take a selfie to mark attendance.'; end if;
  if pol->>'office_lat' is not null then
    if p_lat is null or p_lng is null then raise exception 'Turn on location to mark attendance.'; end if;
    if _distance_m(p_lat, p_lng, (pol->>'office_lat')::numeric, (pol->>'office_lng')::numeric) > coalesce((pol->>'office_radius_m')::numeric, 200) then
      raise exception 'You are not at the store. Attendance can only be marked there.';
    end if;
  end if;
  perform set_config('zs.internal', 'on', true);
  select * into a from attendance where member_id = m.id and day = v_day for update;
  if p_kind = 'in' then
    if a.in_at is not null then raise exception 'You already checked in today.'; end if;
    v_start := v_day + (pol->>'shift_start')::time;
    v_late := greatest(0, floor(extract(epoch from ((v_now at time zone 'Asia/Kolkata') - v_start)) / 60)::int);
    if v_late <= coalesce((pol->>'grace_min')::int, 0) then v_late := 0; end if;
    insert into attendance (member_id, day, in_at, in_photo, in_lat, in_lng, late_min)
    values (m.id, v_day, v_now, p_photo, p_lat, p_lng, v_late)
    returning * into a;
  else
    if a.in_at is null then raise exception 'Check in first.'; end if;
    if a.out_at is not null then raise exception 'You already checked out today.'; end if;
    update attendance set out_at = v_now, out_photo = p_photo, out_lat = p_lat, out_lng = p_lng where id = a.id returning * into a;
  end if;
  return to_jsonb(a);
end $$;

create function request_leave(p_from date, p_to date, p_kind text, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint;
begin
  if m.id is null or m.role <> 'employee' then raise exception 'Leave requests are for employees.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Write the reason.'; end if;
  if p_kind = 'half_day' and p_to <> p_from then raise exception 'A half day is a single date.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into leave_requests (member_id, from_day, to_day, kind, reason) values (m.id, p_from, p_to, p_kind, trim(p_reason)) returning id into v_id;
  perform _notify('approval', 'Leave request · ' || m.name, to_char(p_from, 'DD Mon') ||
    case when p_to <> p_from then ' to ' || to_char(p_to, 'DD Mon') else '' end || ' · ' || replace(p_kind, '_', ' ') || ' · ' || trim(p_reason),
    null, null, false, 'partners');
  return v_id;
end $$;

create function decide_leave(p_id bigint, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); l leave_requests;
begin
  if not is_partner() then raise exception 'Only partners can approve leave.'; end if;
  select * into l from leave_requests where id = p_id for update;
  if l.status <> 'pending' then raise exception 'This request is already %.', l.status; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Write why the leave is rejected.'; end if;
  perform set_config('zs.internal', 'on', true);
  update leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = m.id, decided_at = now(), note = nullif(trim(coalesce(p_note, '')), '') where id = l.id;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- Payroll for one month, from attendance + approved leave + the HR policy
create function hr_payroll(p_month date) returns table (
  member_id uuid, name text, monthly_salary numeric, working_days int, present_days numeric, paid_leave numeric,
  unpaid_leave numeric, late_count int, late_half_days int, absent_days numeric, ot_hours numeric,
  per_day numeric, deductions numeric, ot_pay numeric, net_pay numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  pol jsonb := hr_policy();
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  upto date := least(m1, today_ist());
  e record;
  v_work int; v_present numeric; v_paid numeric; v_unpaid numeric; v_lates int; v_lhd int; v_abs numeric; v_ot numeric;
  v_sal numeric; v_pd numeric; v_shift numeric; v_free numeric;
begin
  if not is_partner() and not exists (select 1 from members where auth_user_id = auth.uid() and role = 'employee') then
    raise exception 'Not allowed.';
  end if;
  v_shift := extract(epoch from ((pol->>'shift_end')::time - (pol->>'shift_start')::time)) / 3600;
  for e in select mm.* from members mm where mm.role = 'employee' and mm.active
           and (is_partner() or mm.auth_user_id = auth.uid()) loop
    select count(*) into v_work from generate_series(m0, upto, interval '1 day') d
      where trim(to_char(d, 'Day')) <> coalesce(pol->>'weekly_off', 'Sunday');
    select count(*) into v_present from attendance a where a.member_id = e.id and a.day between m0 and upto and a.in_at is not null;
    select count(*) filter (where late_min > 0) into v_lates from attendance a where a.member_id = e.id and a.day between m0 and upto;
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
    v_pd := round(v_sal / extract(day from m1)::numeric, 2);
    member_id := e.id; name := e.name; monthly_salary := v_sal; working_days := v_work; present_days := v_present;
    paid_leave := v_paid; unpaid_leave := v_unpaid; late_count := v_lates; late_half_days := v_lhd; absent_days := v_abs;
    ot_hours := round(floor(v_ot * 4) / 4, 2); per_day := v_pd;
    deductions := round((v_abs + v_unpaid + 0.5 * v_lhd) * v_pd, 0);
    ot_pay := round(ot_hours * (v_pd / nullif(v_shift, 0)) * coalesce((pol->>'ot_multiplier')::numeric, 1), 0);
    net_pay := greatest(round(v_sal - deductions + coalesce(ot_pay, 0), 0), 0);
    return next;
  end loop;
end $$;

-- =====================================================================
-- B4. Ad spend, influencers, categories on money out
-- =====================================================================
alter table ledger add column if not exists category      text;
alter table ledger add column if not exists campaign      text;
alter table ledger add column if not exists influencer_id bigint references influencers(id);

create function save_influencer(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the influencer''s name.'; end if;
  perform set_config('zs.internal', 'on', true);
  if p->>'id' is null then
    insert into influencers (name, handle, platform, phone, city, followers, notes, created_by)
    values (trim(p->>'name'), nullif(trim(coalesce(p->>'handle', '')), ''), coalesce(nullif(p->>'platform', ''), 'Instagram'),
            nullif(phone10(p->>'phone'), ''), p->>'city', (p->>'followers')::int, p->>'notes', m.id)
    returning id into v_id;
  else
    update influencers set name = trim(p->>'name'), handle = nullif(trim(coalesce(p->>'handle', '')), ''),
      platform = coalesce(nullif(p->>'platform', ''), platform), phone = nullif(phone10(p->>'phone'), ''),
      city = p->>'city', followers = (p->>'followers')::int, notes = p->>'notes',
      active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::bigint returning id into v_id;
  end if;
  return v_id;
end $$;

-- Coupons: partners create them; turning one off is instant
create function save_coupon(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint; v_code text := upper(trim(coalesce(p->>'code', '')));
begin
  if not is_partner() then raise exception 'Only partners can create coupons.'; end if;
  if v_code !~ '^[A-Z0-9_-]{3,20}$' then raise exception 'Code: 3-20 letters or numbers, no spaces.'; end if;
  if p->>'kind' not in ('percent', 'flat') or (p->>'value')::numeric is null or (p->>'value')::numeric <= 0 then
    raise exception 'Choose percent off or rupees off and enter a value.';
  end if;
  if p->>'kind' = 'percent' and (p->>'value')::numeric > 90 then raise exception 'Percent off can be at most 90.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into coupons (code, description, kind, value, min_order, max_discount, channel, starts_at, ends_at,
                       usage_limit, per_customer_limit, first_order_only, influencer_id, created_by)
  values (v_code, p->>'description', p->>'kind', (p->>'value')::numeric, coalesce((p->>'min_order')::numeric, 0),
          (p->>'max_discount')::numeric, coalesce(nullif(p->>'channel', ''), 'both'), (p->>'starts_at')::timestamptz,
          (p->>'ends_at')::timestamptz, (p->>'usage_limit')::int, coalesce((p->>'per_customer_limit')::int, 1),
          coalesce((p->>'first_order_only')::boolean, false), (p->>'influencer_id')::bigint, m.id)
  returning id into v_id;
  return v_id;
end $$;

create function set_coupon_active(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners can change coupons.'; end if;
  perform set_config('zs.internal', 'on', true);
  update coupons set active = p_active where id = p_id;
end $$;

create function save_bundle(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_id bigint;
begin
  if not is_partner() then raise exception 'Only partners can create combo offers.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name the combo, e.g. Any 3 for ₹999.'; end if;
  perform set_config('zs.internal', 'on', true);
  if p->>'id' is null then
    insert into bundles (name, qty, price, product_ids, created_by)
    values (trim(p->>'name'), (p->>'qty')::int, (p->>'price')::numeric,
            coalesce(array(select jsonb_array_elements_text(p->'product_ids')::bigint), '{}'), m.id)
    returning id into v_id;
  else
    update bundles set name = trim(p->>'name'), qty = (p->>'qty')::int, price = (p->>'price')::numeric,
      product_ids = coalesce(array(select jsonb_array_elements_text(p->'product_ids')::bigint), '{}'),
      active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::bigint returning id into v_id;
  end if;
  return v_id;
end $$;

-- Drops / limited editions / pre-orders (partners)
create function set_product_drop(p_product bigint, p_drop_name text, p_drop_at timestamptz, p_limited int, p_preorder boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners can schedule drops.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set drop_name = nullif(trim(coalesce(p_drop_name, '')), ''), drop_at = p_drop_at,
                      limited_qty = p_limited, is_preorder = coalesce(p_preorder, false),
                      published_at = coalesce(published_at, now())
  where id = p_product;
end $$;

create function block_cod_pincode(p_pincode text, p_reason text, p_block boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  perform set_config('zs.internal', 'on', true);
  if p_block then
    insert into cod_blocked_pincodes (pincode, reason) values (p_pincode, p_reason) on conflict (pincode) do update set reason = excluded.reason;
  else
    delete from cod_blocked_pincodes where pincode = p_pincode;
  end if;
end $$;

-- =====================================================================
-- B5. Approval engine: + HR policy, salary, partner decisions, expense categories
-- =====================================================================
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
  end case;
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
                   'loyalty_points_per_100', 'loyalty_max_redeem_pct') then
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
                                  'ot_after', 'ot_multiplier', 'office_lat', 'office_lng', 'office_radius_m')) then
        raise exception 'Unknown HR rule.';
      end if;
      v_req := v_n;

    when 'salary_change' then
      if not exists (select 1 from members where id = (p_payload->>'member_id')::uuid and role = 'employee') then raise exception 'Choose the employee.'; end if;
      if (p_payload->>'salary')::numeric is null or (p_payload->>'salary')::numeric < 0 then raise exception 'Enter the monthly salary.'; end if;
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

-- =====================================================================
-- C. Reports
-- =====================================================================
drop view if exists catalog;
create view catalog as
select p.id, p.name, p.slug, c.name as category, c.slug as category_slug, p.type, p.description,
       p.fabric, p.gsm, p.mrp, p.price,
       round((1 - p.price / p.mrp) * 100)::int as discount_pct,
       p.images, p.tags, p.featured, p.published_at,
       p.drop_name, p.drop_at, p.limited_qty, p.is_preorder,
       (p.drop_at is not null and p.drop_at > now()) as coming_soon,
       coalesce(v.variants, '[]'::jsonb) as variants,
       coalesce(v.total_stock, 0) as total_stock,
       coalesce(s.sold, 0) as sold_count
from products p
left join categories c on c.id = p.category_id
left join lateral (
  select jsonb_agg(jsonb_build_object('id', pv.id, 'colour', pv.colour, 'hex', pv.colour_hex, 'size', pv.size,
                                      'stock', greatest(stock_of(pv.id), 0))
                   order by pv.colour, array_position(array['XS','S','M','L','XL','XXL','3XL','4XL'], pv.size), pv.size) as variants,
         sum(greatest(stock_of(pv.id), 0)) as total_stock
  from product_variants pv where pv.product_id = p.id and pv.active
) v on true
left join lateral (
  select sum(i.qty) as sold from order_items i join product_variants pv on pv.id = i.variant_id
  join orders o on o.id = i.order_id where pv.product_id = p.id and o.status not in ('cancelled', 'rto', 'returned')
) s on true
where p.active and p.published_at is not null;

create or replace view public_settings as
select key, value from settings
where key in ('shipping_fee', 'free_shipping_above', 'cod_enabled', 'return_window_days',
              'loyalty_points_per_100', 'loyalty_max_redeem_pct');

create view coupon_board with (security_invoker = true) as
select cp.*, i.name as influencer_name,
       (select count(*) from orders o where o.coupon_code = cp.code and o.status <> 'cancelled') as uses,
       (select coalesce(sum(o.total), 0) from orders o where o.coupon_code = cp.code and o.status not in ('cancelled', 'rto', 'returned')) as revenue,
       (select coalesce(sum(o.coupon_discount), 0) from orders o where o.coupon_code = cp.code and o.status not in ('cancelled', 'rto', 'returned')) as discount_given
from coupons cp left join influencers i on i.id = cp.influencer_id;

-- revenue net of every discount, cost from the price snapshot at sale time
create view product_profit with (security_invoker = true) as
with lines as (
  select pv.product_id, i.qty, i.line_total, i.unit_cost,
         i.line_total * case when o.subtotal > 0 then (o.total - o.shipping) / o.subtotal else 1 end as net_revenue
  from order_items i join orders o on o.id = i.order_id join product_variants pv on pv.id = i.variant_id
  where o.status not in ('cancelled', 'rto', 'returned') and o.payment_status = 'paid'
)
select p.id as product_id, p.name, p.drop_name, p.price, p.cost_price,
       coalesce(sum(l.qty), 0) as units_sold,
       round(coalesce(sum(l.net_revenue), 0), 2) as revenue,
       round(coalesce(sum(l.unit_cost * l.qty), 0), 2) as cost,
       round(coalesce(sum(l.net_revenue - l.unit_cost * l.qty), 0), 2) as profit,
       case when coalesce(sum(l.net_revenue), 0) > 0
            then round(100 * sum(l.net_revenue - l.unit_cost * l.qty) / sum(l.net_revenue), 1) end as margin_pct
from products p left join lines l on l.product_id = p.id
where is_partner()
group by p.id;

create view drop_profit with (security_invoker = true) as
select coalesce(drop_name, 'No drop') as drop_name, count(*) as products, sum(units_sold) as units_sold,
       sum(revenue) as revenue, sum(cost) as cost, sum(profit) as profit,
       case when sum(revenue) > 0 then round(100 * sum(profit) / sum(revenue), 1) end as margin_pct
from product_profit group by 1;

create view monthly_report with (security_invoker = true) as
with months as (
  select date_trunc('month', entry_date)::date as month from ledger
  union select date_trunc('month', (created_at at time zone 'Asia/Kolkata'))::date from orders
), o as (
  select date_trunc('month', (created_at at time zone 'Asia/Kolkata'))::date as month, *
  from orders where not (payment_method = 'online' and payment_status = 'pending' and status = 'cancelled')
), firsts as (
  select coalesce(customer_phone, 'c' || customer_id) as who, min(created_at) as first_at from orders
  where status <> 'cancelled' and coalesce(customer_phone, customer_id::text) is not null group by 1
)
select m.month,
  (select coalesce(sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind = 'sale') as sales,
  (select coalesce(-sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind = 'refund') as refunds,
  (select coalesce(-sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind = 'expense') as expenses,
  (select coalesce(-sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind = 'expense' and category = 'ads') as ad_spend,
  (select coalesce(sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind = 'income') as other_income,
  (select coalesce(sum(amount), 0) from ledger l where date_trunc('month', l.entry_date) = m.month and kind in ('sale', 'refund', 'expense', 'income')) as net_result,
  (select coalesce(sum(i.unit_cost * i.qty), 0) from order_items i join o on o.id = i.order_id
    where o.month = m.month and o.status not in ('cancelled', 'rto', 'returned') and o.payment_status = 'paid') as cost_of_goods,
  (select count(*) from o where o.month = m.month and o.status <> 'cancelled') as orders,
  (select round(avg(total), 0) from o where o.month = m.month and o.status not in ('cancelled')) as avg_order_value,
  (select count(*) from o where o.month = m.month and o.status = 'rto') as rto_orders,
  (select count(*) from o where o.month = m.month and o.status = 'returned') as returned_orders,
  (select count(*) from firsts f where date_trunc('month', (f.first_at at time zone 'Asia/Kolkata'))::date = m.month) as new_customers,
  (select count(distinct coalesce(o.customer_phone, 'c' || o.customer_id)) from o
     join firsts f on f.who = coalesce(o.customer_phone, 'c' || o.customer_id)
    where o.month = m.month and o.status <> 'cancelled' and date_trunc('month', (f.first_at at time zone 'Asia/Kolkata'))::date < m.month) as repeat_customers,
  (select coalesce(sum(i.qty), 0) from order_items i join o on o.id = i.order_id where o.month = m.month and o.status <> 'cancelled') as pieces
from months m
where is_partner();

create view ad_report with (security_invoker = true) as
select coalesce(l.campaign, 'Untagged') as campaign, -sum(l.amount) as spend,
       (select count(*) from orders o where o.utm_campaign = l.campaign and o.status not in ('cancelled')) as orders,
       (select coalesce(sum(o.total), 0) from orders o where o.utm_campaign = l.campaign and o.status not in ('cancelled', 'rto', 'returned')) as revenue
from ledger l where l.kind = 'expense' and l.category = 'ads' and is_partner()
group by l.campaign;

create view influencer_report with (security_invoker = true) as
select i.*,
  (select string_agg(code, ', ') from coupons c where c.influencer_id = i.id) as codes,
  (select count(*) from orders o join coupons c on c.code = o.coupon_code where c.influencer_id = i.id and o.status <> 'cancelled') as orders,
  (select coalesce(sum(o.total), 0) from orders o join coupons c on c.code = o.coupon_code
     where c.influencer_id = i.id and o.status not in ('cancelled', 'rto', 'returned')) as revenue,
  (select coalesce(-sum(l.amount), 0) from ledger l where l.influencer_id = i.id and l.kind = 'expense') as paid,
  (select count(*) from requests r where r.type = 'stock_writeoff' and r.status = 'approved' and r.payload->>'influencer_id' = i.id::text) as gifts
from influencers i;

create view batch_board with (security_invoker = true) as
select b.*, p.name as product_name,
       (select sum((x->>'qty')::int) from jsonb_array_elements(b.items) x) as pieces,
       b.blank_cost + b.print_cost + b.other_cost as total_cost,
       case when (select sum((x->>'qty')::int) from jsonb_array_elements(b.items) x) > 0
            then round((b.blank_cost + b.print_cost + b.other_cost) / (select sum((x->>'qty')::int) from jsonb_array_elements(b.items) x), 2) end as cost_per_piece,
       (select jsonb_agg(jsonb_build_object('variant_id', pv.id, 'label', pv.colour || ' / ' || pv.size, 'qty', (x->>'qty')::int))
          from jsonb_array_elements(b.items) x join product_variants pv on pv.id = (x->>'variant_id')::bigint) as item_list
from production_batches b join products p on p.id = b.product_id;

-- partners see the cost price; Mahendra and customers don't need it
drop view if exists stock_board;
create view stock_board with (security_invoker = true) as
select pv.id as variant_id, pv.product_id, p.name as product_name, p.published_at is not null as published,
       p.active as product_active, pv.colour, pv.colour_hex, pv.size, pv.sku, pv.active,
       stock_of(pv.id) as stock, p.price, p.mrp,
       case when is_partner() then p.cost_price end as cost_price,
       p.drop_name, p.drop_at, p.limited_qty, p.is_preorder,
       (select count(*) from restock_requests r where r.variant_id = pv.id and r.notified_at is null) as waiting
from product_variants pv join products p on p.id = pv.product_id
where (current_member()).id is not null;

drop view if exists order_board;
create view order_board with (security_invoker = true) as
select o.*,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'variant', i.variant_label,
                                            'qty', i.qty, 'price', i.price, 'variant_id', i.variant_id) order by i.id)
        from order_items i where i.order_id = o.id) as items,
       (select coalesce(sum(qty), 0) from order_items i where i.order_id = o.id) as pieces,
       (select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note, 'by', e.actor_name) order by e.at)
        from order_events e where e.order_id = o.id) as events,
       (select count(*) from service_requests s where s.order_id = o.id and s.status in ('open', 'approved')) as open_requests,
       (select c.name from customers c where c.id = o.customer_id) as account_name
from orders o;

create view customer_board with (security_invoker = true) as
select coalesce(o.customer_phone, '') as phone, max(o.customer_name) as name, count(*) as orders,
       sum(o.total) filter (where o.status not in ('cancelled', 'rto', 'returned')) as spend,
       count(*) filter (where o.status = 'rto') as rto, max(o.created_at) as last_order,
       max(o.customer_id) as customer_id,
       (select points_of(max(o.customer_id))) as points
from orders o where o.customer_phone is not null and o.status <> 'cancelled' and (current_member()).id is not null
group by o.customer_phone;

-- extend the customer's order tracking with making status
create or replace function track_order(p_order_no text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where upper(order_no) = upper(trim(p_order_no));
  if o.id is null or o.customer_phone is distinct from phone10(p_phone) then
    raise exception 'No order found with that number and phone.';
  end if;
  return jsonb_build_object(
    'order_no', o.order_no, 'status', o.status, 'payment_method', o.payment_method,
    'payment_status', o.payment_status, 'total', o.total, 'shipping', o.shipping, 'discount', o.discount,
    'coupon_code', o.coupon_code, 'points_used', o.points_used, 'production_status', o.production_status,
    'created_at', o.created_at, 'delivered_at', o.delivered_at, 'courier', o.courier, 'tracking_no', o.tracking_no,
    'customer_name', o.customer_name,
    'return_days', setting_num('return_window_days'),
    'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'variant', i.variant_label,
                                                  'qty', i.qty, 'price', i.price, 'variant_id', i.variant_id,
                                                  'product_id', pv.product_id) order by i.id)
              from order_items i join product_variants pv on pv.id = i.variant_id where i.order_id = o.id),
    'events', (select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note',
                                                   case when e.actor_name in ('Customer', 'System') or e.note like 'Making:%' then e.note end) order by e.at)
               from order_events e where e.order_id = o.id),
    'requests', (select jsonb_agg(jsonb_build_object('kind', s.kind, 'status', s.status, 'resolution', s.resolution, 'at', s.created_at))
                 from service_requests s where s.order_id = o.id));
end $$;

-- =====================================================================
-- D. Guards, audit, access
-- =====================================================================
create trigger loyalty_permanent  before update or delete on loyalty_ledger for each row execute function forbid_change();
create trigger cash_permanent     before update or delete on cash_closes    for each row execute function forbid_change();
create trigger attendance_no_del  before delete on attendance               for each row execute function forbid_change();

do $$
declare t text;
begin
  foreach t in array array['customers', 'loyalty_ledger', 'influencers', 'coupons', 'bundles', 'cod_blocked_pincodes',
                           'push_subscriptions', 'push_outbox', 'restock_requests', 'production_batches', 'cash_closes',
                           'employee_pay', 'attendance', 'leave_requests']
  loop
    execute format('create trigger %I before insert or update on %I for each row execute function require_internal()', t || '_internal', t);
    execute format('alter table %I enable row level security', t);
  end loop;
  foreach t in array array['coupons', 'bundles', 'influencers', 'production_batches', 'cash_closes', 'employee_pay',
                           'attendance', 'leave_requests', 'loyalty_ledger', 'customers']
  loop
    execute format('create trigger %I after insert or update on %I for each row execute function write_audit()', 'audit_' || t, t);
  end loop;
end $$;
create trigger cod_pin_no_internal_delete before delete on cod_blocked_pincodes for each row execute function require_internal();

-- who can see what
create policy customers_read   on customers          for select to authenticated using (auth_user_id = auth.uid() or (current_member()).id is not null);
create policy loyalty_read     on loyalty_ledger     for select to authenticated using (customer_id = my_customer_id() or (current_member()).id is not null);
create policy influencers_read on influencers        for select to authenticated using ((current_member()).id is not null);
create policy coupons_read     on coupons            for select to authenticated using ((current_member()).id is not null);
create policy bundles_read     on bundles            for select to anon, authenticated using (active or (current_member()).id is not null);
create policy codpin_read      on cod_blocked_pincodes for select to authenticated using ((current_member()).id is not null);
create policy restock_read     on restock_requests   for select to authenticated using ((current_member()).id is not null);
create policy batches_read     on production_batches for select to authenticated using ((current_member()).id is not null);
create policy cash_read        on cash_closes        for select to authenticated using ((current_member()).id is not null);
create policy pay_read         on employee_pay       for select to authenticated
  using (is_partner() or member_id = (current_member()).id);
create policy attendance_read  on attendance         for select to authenticated
  using (is_partner() or member_id = (current_member()).id);
create policy leave_read       on leave_requests     for select to authenticated
  using (is_partner() or member_id = (current_member()).id);
-- customers see their own orders
create policy orders_mine on orders      for select to authenticated using (customer_id is not null and customer_id = my_customer_id());
create policy items_mine  on order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id and o.customer_id is not null and o.customer_id = my_customer_id()));

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke select on app_secrets, push_outbox, push_subscriptions from authenticated;
grant select on categories, products, product_variants, catalog, public_settings, bundles, push_public_key to anon;
grant select on push_public_key to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    '_price_cart(text,jsonb,jsonb,boolean)', '_create_order(text,jsonb,jsonb,text,uuid,jsonb)', '_earn_points(bigint)',
    '_reverse_points(bigint)', '_push_customer(bigint,text,text,text)', 'notif_to_push()', 'restock_push()', 'order_push()',
    'points_on_status()']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- shoppers (no login or Google login)
grant execute on function quote_cart(jsonb, jsonb), place_web_order(jsonb, jsonb, text, jsonb), delivery_check(text, text, text),
  save_push_subscription(text, text, text), request_restock(bigint, text) to anon, authenticated;
revoke execute on function save_my_profile(text, text), my_account() from public, anon;
grant execute on function save_my_profile(text, text), my_account(), my_customer_id() to authenticated;
-- team
revoke execute on function staff_quote(text, jsonb, numeric, text, text), staff_create_order(text, jsonb, jsonb, text, numeric, text, text), set_production_status(bigint, text),
  save_batch(jsonb), set_batch_stage(bigint, text), set_cost_price(bigint, numeric), cash_day_preview(date),
  close_cash_day(numeric, numeric, text, text, date), punch(text, text, numeric, numeric), request_leave(date, date, text, text),
  decide_leave(bigint, boolean, text), hr_payroll(date), save_influencer(jsonb), save_coupon(jsonb), set_coupon_active(bigint, boolean),
  save_bundle(jsonb), set_product_drop(bigint, text, timestamptz, int, boolean), block_cod_pincode(text, text, boolean) from public, anon;
grant execute on function staff_quote(text, jsonb, numeric, text, text), staff_create_order(text, jsonb, jsonb, text, numeric, text, text), set_production_status(bigint, text),
  save_batch(jsonb), set_batch_stage(bigint, text), set_cost_price(bigint, numeric), cash_day_preview(date),
  close_cash_day(numeric, numeric, text, text, date), punch(text, text, numeric, numeric), request_leave(date, date, text, text),
  decide_leave(bigint, boolean, text), hr_payroll(date), save_influencer(jsonb), save_coupon(jsonb), set_coupon_active(bigint, boolean),
  save_bundle(jsonb), set_product_drop(bigint, text, timestamptz, int, boolean), block_cod_pincode(text, text, boolean) to authenticated;
