-- =====================================================================
-- Z-SHIRTS · Phase 4 · who sold it, targets, more sales channels, cash counter,
-- blank tee stock, Mahendra's shift rules, partner settle-up support
-- Run after 001-006.
-- =====================================================================

-- ---------------------------------------------------------------- 1. sales channels
alter table orders drop constraint if exists orders_channel_check;
alter table orders add constraint orders_channel_check check (channel in
  ('website', 'app', 'instagram', 'whatsapp', 'referral', 'store', 'event', 'stall', 'influencer'));

create or replace function channel_label(p text) returns text
language sql immutable as $$
  select case p when 'website' then 'Website' when 'app' then 'App' when 'instagram' then 'Instagram'
                when 'whatsapp' then 'WhatsApp' when 'referral' then 'Referral' when 'store' then 'Store'
                when 'event' then 'Event' when 'stall' then 'Event stall' when 'influencer' then 'Influencer' else p end
$$;

create or replace function is_in_person(p text) returns boolean
language sql immutable as $$ select p in ('store', 'event', 'stall') $$;

-- ---------------------------------------------------------------- 2. who brought the sale
alter table orders  add column if not exists sold_by      uuid references members(id);
alter table orders  add column if not exists sold_by_name text;
alter table coupons add column if not exists member_id    uuid references members(id);   -- personal referral code
create index if not exists orders_sold_by_idx on orders (sold_by);
-- older orders: the person who created them sold them
select set_config('zs.internal', 'on', false);
update orders set sold_by = created_by where sold_by is null and created_by is not null;
select set_config('zs.internal', 'off', false);

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
create or replace function _create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
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
  v_sold  uuid := nullif(p_opts->>'sold_by', '')::uuid;
  v_sold_name text := nullif(trim(coalesce(p_opts->>'sold_by_name', '')), '');
begin
  if is_in_person(p_channel) then
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

  -- credit: chosen person > owner of the coupon used > whoever created the order
  if v_sold is null and v_sold_name is null and q->>'coupon_code' is not null then
    select member_id into v_sold from coupons where code = q->>'coupon_code';
  end if;
  if v_sold is null and v_sold_name is null then v_sold := p_member; end if;

  perform set_config('zs.internal', 'on', true);
  insert into orders (channel, customer_name, customer_phone, customer_email, address, payment_method, created_by,
                      customer_id, mrp_total, subtotal, discount, shipping, total,
                      coupon_code, coupon_discount, bundle_name, bundle_discount, points_used,
                      utm_source, utm_campaign, sold_by, sold_by_name)
  values (p_channel, v_name, nullif(v_phone, ''), nullif(trim(coalesce(p_customer->>'email', '')), ''),
          v_addr, p_method, p_member, v_cust,
          (q->>'mrp_total')::numeric, (q->>'subtotal')::numeric,
          (q->>'bundle_discount')::numeric + (q->>'manual_discount')::numeric + (q->>'coupon_discount')::numeric + (q->>'points_used')::numeric,
          (q->>'shipping')::numeric, (q->>'total')::numeric,
          q->>'coupon_code', (q->>'coupon_discount')::numeric, q->>'bundle_name', (q->>'bundle_discount')::numeric,
          (q->>'points_used')::int,
          left(nullif(trim(coalesce(p_opts->>'utm_source', '')), ''), 60), left(nullif(trim(coalesce(p_opts->>'utm_campaign', '')), ''), 80), v_sold, v_sold_name)
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
create or replace function place_web_order(p_customer jsonb, p_items jsonb, p_method text, p_opts jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  cp coupons;
  v_channel text := case when p_opts->>'source' = 'app' then 'app' else 'website' end;
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
  -- influencer and partner / staff referral codes credit the right channel and person
  select * into cp from coupons where code = upper(trim(coalesce(p_opts->>'coupon', ''))) and active;
  if cp.influencer_id is not null then v_channel := 'influencer';
  elsif cp.member_id is not null then v_channel := 'referral';
  end if;
  o := _create_order(v_channel, p_customer, p_items, p_method, null, p_opts);
  if p_method = 'cod' then
    perform _notify('order', 'New ' || channel_label(v_channel) || ' order · COD', o.customer_name || ' · ' || o.order_no, o.id, o.total, true);
  end if;
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'shipping', o.shipping,
                            'payment_method', o.payment_method);
end $$;
drop function if exists staff_create_order(text, jsonb, jsonb, text, numeric, text, text);
create function staff_create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                                   p_discount_pct numeric default 0, p_note text default null,
                                   p_coupon text default null, p_sold_by uuid default null,
                                   p_sold_by_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  v_paid boolean;
  v_here boolean := is_in_person(p_channel);
  v_who text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_channel not in ('store', 'event', 'stall', 'instagram', 'whatsapp', 'referral', 'influencer') then
    raise exception 'Choose where this sale happened.';
  end if;
  if v_here and p_method not in ('cash', 'upi') then raise exception 'In-person sales are paid by cash or UPI.'; end if;
  if not v_here and p_method not in ('upi', 'cod') then raise exception 'Choose prepaid (UPI) or cash on delivery.'; end if;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > coalesce(setting_num('max_store_discount_pct'), 0) then
    raise exception 'Discount can be at most %', setting_num('max_store_discount_pct') || '%.';
  end if;
  if p_sold_by is not null and not exists (select 1 from members where id = p_sold_by and active) then
    raise exception 'Choose who made this sale.';
  end if;

  o := _create_order(p_channel, p_customer, p_items, p_method, m.id,
                     jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon,
                                        'sold_by', p_sold_by, 'sold_by_name', p_sold_by_name));
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
  if o.status = 'delivered' and o.payment_status = 'paid' then perform _earn_points(o.id); end if;
  perform _notify('order',
    case when v_here then channel_label(p_channel) || ' sale' else 'New ' || channel_label(p_channel) || ' order' end
      || case when v_paid then ' · Paid' else ' · COD' end,
    o.customer_name || ' · ' || o.order_no || ' · by ' || v_who, o.id, o.total, true);
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'id', o.id);
end $$;

create or replace function save_coupon(p jsonb) returns bigint
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
                       usage_limit, per_customer_limit, first_order_only, influencer_id, member_id, created_by)
  values (v_code, p->>'description', p->>'kind', (p->>'value')::numeric, coalesce((p->>'min_order')::numeric, 0),
          (p->>'max_discount')::numeric, coalesce(nullif(p->>'channel', ''), 'both'), (p->>'starts_at')::timestamptz,
          (p->>'ends_at')::timestamptz, (p->>'usage_limit')::int, coalesce((p->>'per_customer_limit')::int, 1),
          coalesce((p->>'first_order_only')::boolean, false), (p->>'influencer_id')::bigint, nullif(p->>'member_id', '')::uuid, m.id)
  returning id into v_id;
  return v_id;
end $$;
drop view if exists coupon_board;
create view coupon_board with (security_invoker = true) as
select cp.*, i.name as influencer_name, mm.name as owner_name,
       (select count(*) from orders o where o.coupon_code = cp.code and o.status <> 'cancelled') as uses,
       (select coalesce(sum(o.total), 0) from orders o where o.coupon_code = cp.code and o.status not in ('cancelled', 'rto', 'returned')) as revenue,
       (select coalesce(sum(o.coupon_discount), 0) from orders o where o.coupon_code = cp.code and o.status not in ('cancelled', 'rto', 'returned')) as discount_given
from coupons cp left join influencers i on i.id = cp.influencer_id left join members mm on mm.id = cp.member_id;

-- ---------------------------------------------------------------- 3. monthly targets (business + each person)
create table sales_targets (
  id             bigint generated always as identity primary key,
  month          date not null check (extract(day from month) = 1),
  member_id      uuid references members(id),            -- null = whole business milestone
  target_pcs     int not null default 0 check (target_pcs >= 0),
  target_amount  numeric(12,2) not null default 0 check (target_amount >= 0),
  updated_by     uuid references members(id),
  updated_at     timestamptz not null default now(),
  unique nulls not distinct (month, member_id)
);

create function set_target(p_month date, p_member uuid, p_pcs int, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare m members := current_member();
begin
  if not is_partner() then raise exception 'Only partners set targets.'; end if;
  if p_member is not null and not exists (select 1 from members where id = p_member and active) then raise exception 'Choose a team member.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into sales_targets (month, member_id, target_pcs, target_amount, updated_by)
  values (date_trunc('month', p_month)::date, p_member, greatest(coalesce(p_pcs, 0), 0), greatest(coalesce(p_amount, 0), 0), m.id)
  on conflict (month, member_id) do update set target_pcs = excluded.target_pcs, target_amount = excluded.target_amount,
    updated_by = excluded.updated_by, updated_at = now();
end $$;

-- progress for a month: business milestone (member_id null) + every active team member
create function target_progress(p_month date default null) returns table (
  member_id uuid, name text, role text, target_pcs int, target_amount numeric, pcs bigint, amount numeric, orders bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  m0 date := date_trunc('month', coalesce(p_month, today_ist()))::date;
  m1 date := (date_trunc('month', coalesce(p_month, today_ist())) + interval '1 month')::date;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  return query
  with o as (
    select o.id, o.sold_by, o.total - o.shipping as value
    from orders o
    where (o.created_at at time zone 'Asia/Kolkata')::date >= m0 and (o.created_at at time zone 'Asia/Kolkata')::date < m1
      and o.status not in ('cancelled', 'rto', 'returned')
      and not (o.payment_method = 'online' and o.payment_status = 'pending')
  ), pc as (
    select o.id, o.sold_by, o.value, (select coalesce(sum(i.qty), 0) from order_items i where i.order_id = o.id) as pcs from o
  )
  select null::uuid, 'Z-SHIRTS (all sales)'::text, 'business'::text,
         coalesce((select t.target_pcs from sales_targets t where t.month = m0 and t.member_id is null), 0),
         coalesce((select t.target_amount from sales_targets t where t.month = m0 and t.member_id is null), 0),
         coalesce((select sum(pc.pcs) from pc), 0)::bigint, coalesce((select sum(pc.value) from pc), 0), (select count(*) from pc)
  union all
  select mm.id, mm.name, mm.role::text,
         coalesce(t.target_pcs, 0), coalesce(t.target_amount, 0),
         coalesce((select sum(pc.pcs) from pc where pc.sold_by = mm.id), 0)::bigint,
         coalesce((select sum(pc.value) from pc where pc.sold_by = mm.id), 0),
         (select count(*) from pc where pc.sold_by = mm.id)
  from members mm left join sales_targets t on t.month = m0 and t.member_id = mm.id
  where mm.active;
end $$;

-- ---------------------------------------------------------------- 4. cash counter ("punch cash")
create table cash_moves (
  id          bigint generated always as identity primary key,
  day         date not null default today_ist(),
  kind        text not null check (kind in ('in', 'out')),
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null,
  category    text,
  photo_path  text,
  by_member   uuid references members(id),
  created_at  timestamptz not null default now()
);

alter table cash_closes add column if not exists cash_in numeric(12,2) not null default 0;

create function cash_punch(p_kind text, p_amount numeric, p_reason text, p_photo text default null, p_category text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); c cash_moves;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_kind not in ('in', 'out') then raise exception 'Choose cash in or cash out.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Write what this cash is for.'; end if;
  if exists (select 1 from cash_closes where day = today_ist()) then raise exception 'Today''s cash is already closed. Add it tomorrow.'; end if;
  if p_kind = 'out' and m.role = 'employee' and p_amount > coalesce(setting_num('employee_petty_limit'), 0) then
    raise exception 'You can take out up to ₹% at a time. Ask a partner for more.', setting_num('employee_petty_limit');
  end if;
  if p_kind = 'out' and m.role = 'employee' and coalesce(trim(p_photo), '') = '' then
    raise exception 'Add a photo of the bill or deposit slip.';
  end if;
  perform set_config('zs.internal', 'on', true);
  insert into cash_moves (kind, amount, reason, category, photo_path, by_member)
  values (p_kind, p_amount, trim(p_reason), nullif(p_category, ''), nullif(trim(coalesce(p_photo, '')), ''), m.id)
  returning * into c;
  if p_kind = 'out' then
    perform _notify('approval', 'Cash out ₹' || trim(to_char(p_amount, 'FM99,99,990')) || ' by ' || m.name, trim(p_reason), null, p_amount, false, 'partners');
  end if;
  return to_jsonb(c);
end $$;

create or replace function cash_day_preview(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, today_ist());
  v_open numeric; v_sales numeric; v_ref numeric; v_in numeric; v_out numeric;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  select counted into v_open from cash_closes where day < v_day order by day desc limit 1;
  select coalesce(sum(l.amount), 0) into v_sales from ledger l join orders o on o.id = l.order_id
   where l.kind = 'sale' and o.payment_method = 'cash' and l.entry_date = v_day;
  select coalesce(-sum(l.amount), 0) into v_ref from ledger l join orders o on o.id = l.order_id
   where l.kind = 'refund' and o.payment_method = 'cash' and l.entry_date = v_day;
  select coalesce(sum(amount) filter (where kind = 'in'), 0), coalesce(sum(amount) filter (where kind = 'out'), 0)
    into v_in, v_out from cash_moves where day = v_day;
  return jsonb_build_object('day', v_day, 'opening', coalesce(v_open, 0), 'cash_sales', v_sales, 'cash_refunds', v_ref,
                            'cash_in', v_in, 'cash_out', v_out,
                            'expected', coalesce(v_open, 0) + v_sales - v_ref + v_in - v_out,
                            'closed', exists (select 1 from cash_closes where day = v_day));
end $$;

create or replace function close_cash_day(p_counted numeric, p_cash_out numeric, p_note text, p_photo text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  pv jsonb;
  c cash_closes;
  v_out numeric;
  v_exp numeric;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash you counted.'; end if;
  if coalesce(p_cash_out, 0) < 0 then raise exception 'Cash taken out cannot be negative.'; end if;
  if coalesce(trim(p_photo), '') = '' then raise exception 'Add a photo of the counted cash.'; end if;
  pv := cash_day_preview(p_day);
  if (pv->>'closed')::boolean then raise exception 'This day is already closed.'; end if;
  if coalesce(p_cash_out, 0) > 0 and coalesce(trim(p_note), '') = '' then raise exception 'Write where the cash taken out went (bank deposit, expense…).'; end if;
  v_out := (pv->>'cash_out')::numeric + coalesce(p_cash_out, 0);
  v_exp := (pv->>'expected')::numeric - coalesce(p_cash_out, 0);
  perform set_config('zs.internal', 'on', true);
  insert into cash_closes (day, opening, cash_sales, cash_refunds, cash_in, cash_out, expected, counted, difference, note, photo_path, by_member)
  values ((pv->>'day')::date, (pv->>'opening')::numeric, (pv->>'cash_sales')::numeric, (pv->>'cash_refunds')::numeric,
          (pv->>'cash_in')::numeric, v_out, v_exp, p_counted, p_counted - v_exp,
          nullif(trim(coalesce(p_note, '')), ''), p_photo, m.id)
  returning * into c;
  if c.difference <> 0 then
    perform _notify('approval', 'Cash ' || case when c.difference < 0 then 'short' else 'extra' end || ' by ₹' || abs(c.difference),
      'Cash close ' || to_char(c.day, 'DD Mon') || ' by ' || m.name || ' · expected ₹' || c.expected || ', counted ₹' || c.counted,
      null, abs(c.difference), false, 'partners');
  end if;
  return to_jsonb(c);
end $$;

-- ---------------------------------------------------------------- 5. Mahendra's shift: 10 AM-9 PM, 30-min lunch, every day, no half day, no paid leave
select set_config('zs.internal', 'on', false);
update settings set value = value || '{"shift_start":"10:00","shift_end":"21:00","lunch_min":30,"weekly_off":"None",
  "paid_leaves_per_month":0,"half_day_allowed":false,"ot_after":"21:00"}'::jsonb
where key = 'hr_policy';
select set_config('zs.internal', 'off', false);

alter table attendance add column if not exists lunch_out_at   timestamptz;
alter table attendance add column if not exists lunch_in_at    timestamptz;
alter table attendance add column if not exists lunch_over_min int not null default 0;

create or replace function punch(p_kind text, p_photo text, p_lat numeric, p_lng numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  pol jsonb := hr_policy();
  v_now timestamptz := now();
  v_day date := today_ist();
  v_start timestamp;
  v_late int := 0;
  v_over int;
  a attendance;
begin
  if m.id is null or m.role <> 'employee' then raise exception 'Attendance is for employees.'; end if;
  if p_kind not in ('in', 'lunch_out', 'lunch_in', 'out') then raise exception 'Unknown punch.'; end if;
  if p_kind in ('in', 'out') and coalesce(trim(p_photo), '') = '' then raise exception 'Take a selfie to mark attendance.'; end if;
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
    values (m.id, v_day, v_now, p_photo, p_lat, p_lng, v_late) returning * into a;
  elsif p_kind = 'lunch_out' then
    if a.in_at is null then raise exception 'Check in first.'; end if;
    if a.out_at is not null then raise exception 'You already checked out today.'; end if;
    if a.lunch_out_at is not null then raise exception 'Lunch break already started today.'; end if;
    update attendance set lunch_out_at = v_now where id = a.id returning * into a;
  elsif p_kind = 'lunch_in' then
    if a.lunch_out_at is null then raise exception 'Start lunch first.'; end if;
    if a.lunch_in_at is not null then raise exception 'You are already back from lunch.'; end if;
    v_over := greatest(0, floor(extract(epoch from (v_now - a.lunch_out_at)) / 60)::int - coalesce((pol->>'lunch_min')::int, 30));
    update attendance set lunch_in_at = v_now, lunch_over_min = v_over where id = a.id returning * into a;
  else
    if a.in_at is null then raise exception 'Check in first.'; end if;
    if a.out_at is not null then raise exception 'You already checked out today.'; end if;
    if a.lunch_out_at is not null and a.lunch_in_at is null then raise exception 'End your lunch break first.'; end if;
    update attendance set out_at = v_now, out_photo = p_photo, out_lat = p_lat, out_lng = p_lng where id = a.id returning * into a;
  end if;
  return to_jsonb(a);
end $$;

create or replace function request_leave(p_from date, p_to date, p_kind text, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); pol jsonb := hr_policy(); v_id bigint;
begin
  if m.id is null or m.role <> 'employee' then raise exception 'Leave requests are for employees.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Write the reason.'; end if;
  if p_kind not in ('paid', 'unpaid', 'half_day') then raise exception 'Choose the leave type.'; end if;
  if p_kind = 'half_day' and not coalesce((pol->>'half_day_allowed')::boolean, true) then raise exception 'Half days are not allowed.'; end if;
  if p_kind = 'paid' and coalesce((pol->>'paid_leaves_per_month')::numeric, 0) = 0 then raise exception 'There is no paid leave. Ask for unpaid leave.'; end if;
  if p_kind = 'half_day' and p_to <> p_from then raise exception 'A half day is a single date.'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into leave_requests (member_id, from_day, to_day, kind, reason) values (m.id, p_from, p_to, p_kind, trim(p_reason)) returning id into v_id;
  perform _notify('approval', 'Leave request · ' || m.name, to_char(p_from, 'DD Mon') ||
    case when p_to <> p_from then ' to ' || to_char(p_to, 'DD Mon') else '' end || ' · ' || replace(p_kind, '_', ' ') || ' · ' || trim(p_reason),
    null, null, false, 'partners');
  return v_id;
end $$;

create or replace function hr_payroll(p_month date) returns table (
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

-- ---------------------------------------------------------------- 6. blank tee stock (plain tees before printing)
create table blank_moves (
  id          bigint generated always as identity primary key,
  colour      text not null,
  colour_hex  text,
  size        text not null,
  qty         int not null check (qty <> 0),
  reason      text not null check (reason in ('purchase', 'used', 'damaged', 'adjust')),
  batch_id    bigint references production_batches(id),
  cost        numeric(12,2),
  note        text,
  by_member   uuid references members(id),
  at          timestamptz not null default now()
);

create view blank_stock with (security_invoker = true) as
select initcap(colour) as colour, max(colour_hex) as colour_hex, size, sum(qty)::int as qty,
       sum(qty) filter (where reason = 'purchase')::int as bought, -sum(qty) filter (where reason = 'used')::int as used
from blank_moves group by initcap(colour), size;

create function add_blanks(p_colour text, p_hex text, p_size text, p_qty int, p_reason text default 'purchase',
                           p_cost numeric default null, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v int;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p_colour), '') = '' or coalesce(trim(p_size), '') = '' then raise exception 'Choose colour and size.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many pieces.'; end if;
  if p_reason not in ('purchase', 'damaged') then raise exception 'Choose bought or damaged.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into blank_moves (colour, colour_hex, size, qty, reason, cost, note, by_member)
  values (initcap(trim(p_colour)), p_hex, upper(trim(p_size)), case when p_reason = 'damaged' then -p_qty else p_qty end, p_reason, p_cost, p_note, m.id);
  if p_reason = 'damaged' then
    perform _notify('stock', 'Blank tees damaged: ' || p_qty || ' × ' || initcap(p_colour) || ' ' || upper(p_size), coalesce(p_note, '') || ' · by ' || m.name, null, null, false, 'partners');
  end if;
  select coalesce(sum(qty), 0) into v from blank_moves where lower(colour) = lower(trim(p_colour)) and size = upper(trim(p_size));
  return v;
end $$;

create or replace function set_batch_stage(p_id bigint, p_stage text) returns text
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
  -- printing starts: the plain tees leave blank stock (only for colours you track as blanks)
  if p_stage in ('printing', 'quality_check', 'ready') and not exists (select 1 from blank_moves where batch_id = b.id) then
    insert into blank_moves (colour, colour_hex, size, qty, reason, batch_id, note, by_member)
    select initcap(pv.colour), pv.colour_hex, pv.size, -(bi->>'qty')::int, 'used', b.id, 'Batch ' || b.code, m.id
    from jsonb_array_elements(b.items) bi join product_variants pv on pv.id = (bi->>'variant_id')::bigint
    where exists (select 1 from blank_moves bm where lower(bm.colour) = lower(pv.colour) and bm.size = pv.size);
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
                                  'ot_after', 'ot_multiplier', 'office_lat', 'office_lng', 'office_radius_m', 'lunch_min', 'half_day_allowed')) then
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

-- order_board again so it carries the new sold_by columns
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

-- ---------------------------------------------------------------- 7. stock history per size (printed piece tracking)
create view stock_history with (security_invoker = true) as
select sm.id, sm.variant_id, sm.qty, sm.reason, sm.note, sm.created_at as at, o.order_no, mm.name as by_name
from stock_moves sm left join orders o on o.id = sm.order_id left join members mm on mm.id = sm.by_member
where (current_member()).id is not null;

-- ---------------------------------------------------------------- guards + access
do $$
declare t text;
begin
  foreach t in array array['sales_targets', 'cash_moves', 'blank_moves'] loop
    execute format('create trigger %I before insert or update or delete on %I for each row execute function require_internal()', t || '_internal', t);
    execute format('create trigger %I after insert or update on %I for each row execute function write_audit()', 'audit_' || t, t);
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create trigger cash_moves_permanent  before update or delete on cash_moves  for each row execute function forbid_change();
create trigger blank_moves_permanent before update or delete on blank_moves for each row execute function forbid_change();

create policy targets_read on sales_targets for select to authenticated using ((current_member()).id is not null);
create policy cashm_read   on cash_moves    for select to authenticated using ((current_member()).id is not null);
create policy blanks_read  on blank_moves   for select to authenticated using ((current_member()).id is not null);

revoke all on sales_targets, cash_moves, blank_moves, blank_stock, stock_history, coupon_board, order_board from anon;
grant select on sales_targets, cash_moves, blank_moves, blank_stock, stock_history, coupon_board, order_board to authenticated;
revoke execute on function staff_create_order(text, jsonb, jsonb, text, numeric, text, text, uuid, text), set_target(date, uuid, int, numeric),
  target_progress(date), cash_punch(text, numeric, text, text, text), add_blanks(text, text, text, int, text, numeric, text) from public, anon;
grant execute on function staff_create_order(text, jsonb, jsonb, text, numeric, text, text, uuid, text), set_target(date, uuid, int, numeric),
  target_progress(date), cash_punch(text, numeric, text, text, text), add_blanks(text, text, text, int, text, numeric, text) to authenticated;
