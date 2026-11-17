-- =====================================================================
-- Z-SHIRTS · Phase 10 · Shop experience
-- Wishlist, saved addresses, verified-buyer reviews (with fit feedback),
-- public offers, "customers also bought", optional prepaid discount and
-- COD fee (Indian checkout logic), ratings in the catalogue.
-- Run after 013.
-- =====================================================================

-- ---------------------------------------------------------------- 1. settings partners can change
select set_config('zs.internal', 'on', false);
insert into settings (key, value, label, kind, grp) values
  ('prepaid_discount_pct', '0'::jsonb,   'Shop: extra % off when paying online (0 = off)', 'number', 'Shop'),
  ('prepaid_discount_max', '100'::jsonb, 'Shop: most the online-payment discount can be (₹)', 'number', 'Shop'),
  ('cod_fee',              '0'::jsonb,   'Shop: cash-on-delivery handling fee (₹, 0 = free)', 'number', 'Shop')
on conflict (key) do nothing;
select set_config('zs.internal', 'off', false);

create or replace view public_settings as
select key, value from settings
where key = any (array['shipping_fee', 'free_shipping_above', 'cod_enabled', 'return_window_days', 'loyalty_points_per_100',
  'loyalty_max_redeem_pct', 'business_name', 'store_whatsapp', 'instagram', 'gst_threshold', 'gst_rate_low', 'gst_rate_high',
  'prepaid_discount_pct', 'prepaid_discount_max', 'cod_fee']);
grant select on public_settings to anon, authenticated;

-- ---------------------------------------------------------------- 2. pricing knows how you pay
create or replace function _price_cart(p_channel text, p_items jsonb, p_opts jsonb, p_lock boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- the order keeps the online-payment discount in "discount" and the COD fee in "shipping"
create or replace function _create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text, p_member uuid, p_opts jsonb)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  if v_cust is null and length(v_phone) = 10 and p_member is not null then
    select id into v_cust from customers where phone = v_phone and auth_user_id is not null order by id limit 1;
  end if;

  q := _price_cart(p_channel, p_items, p_opts || jsonb_build_object('customer_id', v_cust, 'phone', v_phone, 'pay', p_method), true);

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
          (q->>'bundle_discount')::numeric + (q->>'manual_discount')::numeric + (q->>'coupon_discount')::numeric + (q->>'points_used')::numeric
            + coalesce((q->>'prepaid_discount')::numeric, 0),
          (q->>'shipping')::numeric + coalesce((q->>'cod_fee')::numeric, 0), (q->>'total')::numeric,
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
    || case when coalesce((q->>'prepaid_discount')::numeric, 0) > 0 then ' · prepaid offer ₹' || (q->>'prepaid_discount') else '' end
    || case when v_pre then ' · pre-order' else '' end);
  return o;
end $function$;

-- ---------------------------------------------------------------- 3. wishlist
create table wishlists (
  customer_id bigint not null references customers(id),
  product_id  bigint not null references products(id),
  created_at  timestamptz not null default now(),
  primary key (customer_id, product_id)
);
alter table wishlists enable row level security;   -- reached only through the functions below

create function my_wishlist() returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(product_id order by created_at desc), '{}') from wishlists where customer_id = my_customer_id()
$$;

create function toggle_wishlist(p_product bigint, p_on boolean default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare c bigint := my_customer_id(); v_has boolean;
begin
  if c is null then raise exception 'Sign in to save your wishlist.'; end if;
  v_has := exists (select 1 from wishlists where customer_id = c and product_id = p_product);
  if coalesce(p_on, not v_has) then
    insert into wishlists (customer_id, product_id) values (c, p_product) on conflict do nothing;
    return true;
  end if;
  delete from wishlists where customer_id = c and product_id = p_product;
  return false;
end $$;

-- after signing in, the guest wishlist joins the account one
create function merge_wishlist(p_products bigint[]) returns bigint[]
language plpgsql security definer set search_path = public as $$
declare c bigint := my_customer_id();
begin
  if c is null then raise exception 'Sign in first.'; end if;
  insert into wishlists (customer_id, product_id)
  select c, x from unnest(coalesce(p_products, '{}')) x where exists (select 1 from products where id = x)
  on conflict do nothing;
  return my_wishlist();
end $$;

-- ---------------------------------------------------------------- 4. saved addresses
create table customer_addresses (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers(id),
  label       text not null default 'Home',
  name        text not null,
  phone       text not null,
  line1       text not null,
  line2       text,
  city        text not null,
  state       text not null,
  pincode     text not null check (pincode ~ '^\d{6}$'),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on customer_addresses (customer_id);
alter table customer_addresses enable row level security;

create function my_addresses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(a) - 'customer_id' order by a.is_default desc, a.id desc), '[]'::jsonb)
  from customer_addresses a where a.customer_id = my_customer_id()
$$;

create function save_address(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c bigint := my_customer_id(); v_id bigint := nullif(p->>'id', '')::bigint; v_def boolean := coalesce((p->>'is_default')::boolean, false);
begin
  if c is null then raise exception 'Sign in to save addresses.'; end if;
  if coalesce(length(trim(p->>'name')), 0) < 2 then raise exception 'Enter the name.'; end if;
  if length(phone10(p->>'phone')) <> 10 then raise exception 'Enter a 10-digit mobile number.'; end if;
  if coalesce(trim(p->>'line1'), '') = '' or coalesce(trim(p->>'city'), '') = '' or coalesce(trim(p->>'state'), '') = '' then raise exception 'Complete the address.'; end if;
  if coalesce(p->>'pincode', '') !~ '^\d{6}$' then raise exception 'Enter a 6-digit pincode.'; end if;
  if (select count(*) from customer_addresses where customer_id = c) >= 10 and v_id is null then raise exception 'You can save up to 10 addresses.'; end if;
  if not exists (select 1 from customer_addresses where customer_id = c) then v_def := true; end if;
  if v_def then update customer_addresses set is_default = false where customer_id = c; end if;
  if v_id is null then
    insert into customer_addresses (customer_id, label, name, phone, line1, line2, city, state, pincode, is_default)
    values (c, coalesce(nullif(trim(p->>'label'), ''), 'Home'), trim(p->>'name'), phone10(p->>'phone'), trim(p->>'line1'), nullif(trim(p->>'line2'), ''),
            trim(p->>'city'), trim(p->>'state'), p->>'pincode', v_def);
  else
    update customer_addresses set label = coalesce(nullif(trim(p->>'label'), ''), 'Home'), name = trim(p->>'name'), phone = phone10(p->>'phone'),
      line1 = trim(p->>'line1'), line2 = nullif(trim(p->>'line2'), ''), city = trim(p->>'city'), state = trim(p->>'state'), pincode = p->>'pincode',
      is_default = v_def or is_default
    where id = v_id and customer_id = c;
    if not found then raise exception 'Address not found.'; end if;
  end if;
  return my_addresses();
end $$;

create function delete_address(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c bigint := my_customer_id(); v_was boolean;
begin
  delete from customer_addresses where id = p_id and customer_id = c returning is_default into v_was;
  if v_was then
    update customer_addresses set is_default = true where id = (select id from customer_addresses where customer_id = c order by id desc limit 1);
  end if;
  return my_addresses();
end $$;

-- ---------------------------------------------------------------- 5. reviews from people who actually bought
create table product_reviews (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id),
  customer_id bigint not null references customers(id),
  order_id    bigint references orders(id),
  rating      int not null check (rating between 1 and 5),
  title       text,
  body        text,
  fit         text check (fit in ('small', 'true', 'large')),
  size_bought text,
  photos      text[] not null default '{}',
  status      text not null default 'published' check (status in ('published', 'hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (product_id, customer_id)
);
create index on product_reviews (product_id, status);
alter table product_reviews enable row level security;
create policy reviews_team_read on product_reviews for select to authenticated using ((current_member()).id is not null);
grant select on product_reviews to authenticated;

-- what shoppers see: first name + initial, never the phone or e-mail
create view public_reviews as
select r.id, r.product_id, r.rating, r.title, r.body, r.fit, r.size_bought, r.photos, r.created_at,
       split_part(trim(c.name), ' ', 1) || coalesce(' ' || left(nullif(split_part(trim(c.name), ' ', 2), ''), 1) || '.', '') as author,
       r.order_id is not null as verified
from product_reviews r join customers c on c.id = r.customer_id
where r.status = 'published';
grant select on public_reviews to anon, authenticated;

create function add_review(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c bigint := my_customer_id();
  v_prod bigint := (p->>'product_id')::bigint;
  v_order bigint; v_size text; v_id bigint;
  v_photos text[];
begin
  if c is null then raise exception 'Sign in to write a review.'; end if;
  if coalesce((p->>'rating')::int, 0) not between 1 and 5 then raise exception 'Tap the stars to rate it.'; end if;
  select o.id, split_part(i.variant_label, ' / ', 2) into v_order, v_size
  from orders o join order_items i on i.order_id = o.id join product_variants pv on pv.id = i.variant_id
  where o.customer_id = c and pv.product_id = v_prod and o.status = 'delivered'
  order by o.delivered_at desc nulls last limit 1;
  if v_order is null then raise exception 'You can review a tee once it has been delivered to you.'; end if;
  select coalesce(array_agg(x), '{}') into v_photos from (select jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x limit 4) s;
  insert into product_reviews (product_id, customer_id, order_id, rating, title, body, fit, size_bought, photos)
  values (v_prod, c, v_order, (p->>'rating')::int, left(nullif(trim(p->>'title'), ''), 80), left(nullif(trim(p->>'body'), ''), 1000),
          nullif(p->>'fit', ''), v_size, v_photos)
  on conflict (product_id, customer_id) do update set rating = excluded.rating, title = excluded.title, body = excluded.body,
    fit = excluded.fit, photos = case when cardinality(excluded.photos) > 0 then excluded.photos else product_reviews.photos end,
    updated_at = now(), status = 'published'
  returning id into v_id;
  perform _notify('client', 'New ' || (p->>'rating') || '-star review', (select name from products where id = v_prod)
    || coalesce(' · ' || left(nullif(trim(p->>'title'), ''), 60), ''), null, null, false, 'all');
  return v_id;
end $$;

-- products this shopper can review (delivered, any order)
create function my_reviewable() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('product_id', pv.product_id, 'reviewed',
           exists (select 1 from product_reviews r where r.product_id = pv.product_id and r.customer_id = o.customer_id))), '[]'::jsonb)
  from orders o join order_items i on i.order_id = o.id join product_variants pv on pv.id = i.variant_id
  where o.customer_id = my_customer_id() and o.status = 'delivered'
$$;

create function set_review_status(p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners can hide or show reviews.'; end if;
  if p_status not in ('published', 'hidden') then raise exception 'Unknown status.'; end if;
  update product_reviews set status = p_status, updated_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- 6. offers shoppers can see
alter table coupons add column if not exists show_in_shop boolean not null default true;
create view public_offers as
select c.code, c.description, c.kind, c.value, c.min_order, c.max_discount, c.first_order_only, c.ends_at
from coupons c
where c.active and c.show_in_shop and c.influencer_id is null and c.member_id is null
  and c.channel <> 'store'
  and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
  and (c.usage_limit is null or (select count(*) from orders o where o.coupon_code = c.code and o.status <> 'cancelled') < c.usage_limit);
grant select on public_offers to anon, authenticated;

-- ---------------------------------------------------------------- 7. "customers also bought" (counts only, no names)
create view also_bought as
select a.product_id, b.product_id as other_id, count(distinct a.order_id)::int as n
from (select distinct i.order_id, pv.product_id from order_items i join product_variants pv on pv.id = i.variant_id
      join orders o on o.id = i.order_id where o.status not in ('cancelled', 'rto')) a
join (select distinct i.order_id, pv.product_id from order_items i join product_variants pv on pv.id = i.variant_id) b
  on b.order_id = a.order_id and b.product_id <> a.product_id
group by 1, 2;
grant select on also_bought to anon, authenticated;

-- ---------------------------------------------------------------- 8. ratings in the catalogue
create or replace view catalog as
 select p.id, p.name, p.slug, c.name as category, c.slug as category_slug, p.type, p.description, p.fabric, p.gsm, p.mrp, p.price,
    round((1::numeric - p.price / p.mrp) * 100::numeric)::integer as discount_pct,
    p.images, p.tags, p.featured, p.published_at, p.drop_name, p.drop_at, p.limited_qty, p.is_preorder,
    p.drop_at is not null and p.drop_at > now() as coming_soon,
    coalesce(v.variants, '[]'::jsonb) as variants,
    coalesce(v.total_stock, 0::bigint) as total_stock,
    coalesce(s.sold, 0::bigint) as sold_count,
    coalesce(r.avg_rating, 0) as rating,
    coalesce(r.n, 0) as rating_count,
    r.fit_small, r.fit_true, r.fit_large
   from products p
     left join categories c on c.id = p.category_id
     left join lateral ( select jsonb_agg(jsonb_build_object('id', pv.id, 'colour', pv.colour, 'hex', pv.colour_hex, 'size', pv.size, 'stock', greatest(stock_of(pv.id), 0))
                 order by pv.colour, (array_position(array['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'], pv.size)), pv.size) as variants,
            sum(greatest(stock_of(pv.id), 0)) as total_stock
           from product_variants pv
          where pv.product_id = p.id and pv.active) v on true
     left join lateral ( select sum(i.qty) as sold
           from order_items i
             join product_variants pv on pv.id = i.variant_id
             join orders o on o.id = i.order_id
          where pv.product_id = p.id and (o.status <> all (array['cancelled', 'rto', 'returned']))) s on true
     left join lateral ( select round(avg(pr.rating)::numeric, 1) as avg_rating, count(*)::int as n,
            count(*) filter (where pr.fit = 'small')::int as fit_small, count(*) filter (where pr.fit = 'true')::int as fit_true,
            count(*) filter (where pr.fit = 'large')::int as fit_large
           from product_reviews pr where pr.product_id = p.id and pr.status = 'published') r on true
  where p.active and p.published_at is not null;
grant select on catalog to anon, authenticated;

-- ---------------------------------------------------------------- 9. account includes addresses + wishlist
create or replace function my_account() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c customers;
begin
  select * into c from customers where auth_user_id = auth.uid();
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'points', points_of(c.id),
    'addresses', my_addresses(), 'wishlist', my_wishlist(), 'reviewable', my_reviewable(),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
                 'order_no', o.order_no, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                 'phone', o.customer_phone, 'delivered_at', o.delivered_at, 'payment_method', o.payment_method,
                 'payment_status', o.payment_status, 'production_status', o.production_status,
                 'items', (select jsonb_agg(jsonb_build_object('name', i.product_name, 'variant', i.variant_label, 'qty', i.qty,
                                                               'variant_id', i.variant_id, 'price', i.price,
                                                               'product_id', (select product_id from product_variants where id = i.variant_id)))
                           from order_items i where i.order_id = o.id))
               order by o.created_at desc), '[]'::jsonb)
               from orders o where o.customer_id = c.id),
    'points_history', (select coalesce(jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'at', l.created_at, 'note', l.note)
                       order by l.id desc), '[]'::jsonb) from loyalty_ledger l where l.customer_id = c.id));
end $$;

revoke execute on function my_wishlist(), toggle_wishlist(bigint, boolean), merge_wishlist(bigint[]), my_addresses(), save_address(jsonb),
  delete_address(bigint), add_review(jsonb), my_reviewable(), set_review_status(bigint, text) from public, anon;
grant execute on function my_wishlist(), toggle_wishlist(bigint, boolean), merge_wishlist(bigint[]), my_addresses(), save_address(jsonb),
  delete_address(bigint), add_review(jsonb), my_reviewable(), set_review_status(bigint, text) to authenticated;

notify pgrst, 'reload schema';
-- =====================================================================
-- Z-SHIRTS · review photos (public bucket). Run after 014.
-- Shoppers upload into their own folder: reviews/<login-id>/...
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reviews', 'reviews', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "shoppers upload own review photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reviews' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "anyone sees review photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'reviews');
