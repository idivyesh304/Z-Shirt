-- =====================================================================
-- SINDIICAT · 016 · Full listing: many collections per tee, product details,
-- and offers that belong to one tee (a code that works only on that tee).
-- =====================================================================

-- ---------------------------------------------------------------- 1. a tee can sit in many collections
alter table products add column if not exists labels text[] not null default '{}';
alter table products add column if not exists details jsonb not null default '{}';
alter table products drop constraint if exists products_label_check;
alter table products add constraint products_label_check check (shop_label in ('new', 'bestseller', 'premium', 'coming_soon', 'prebook', 'restocked', 'limited'));
alter table products drop constraint if exists products_labels_check;
alter table products add constraint products_labels_check check (labels <@ array['new', 'bestseller', 'premium', 'coming_soon', 'prebook', 'restocked', 'limited']);
do $$ begin
  perform set_config('zs.internal', 'on', true);
  update products set labels = array[shop_label] where shop_label is not null and cardinality(labels) = 0;
end $$;

-- set every collection a tee is in. The first by importance becomes its main badge.
create or replace function set_product_labels(p_product bigint, p_labels text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member(); pr products;
  v text[]; v_main text;
  ord text[] := array['coming_soon', 'prebook', 'premium', 'limited', 'new', 'bestseller', 'restocked'];
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into pr from products where id = p_product;
  if pr.id is null then raise exception 'Product not found.'; end if;
  select coalesce(array_agg(x order by array_position(ord, x)), '{}') into v
    from (select distinct lower(trim(x)) x from unnest(coalesce(p_labels, '{}')) x where trim(x) <> '' and lower(trim(x)) <> 'none') s;
  if exists (select 1 from unnest(v) x where not x = any (ord)) then raise exception 'Unknown label.'; end if;
  if 'coming_soon' = any (v) and 'prebook' = any (v) then raise exception 'A tee cannot be Coming soon and Pre-book at the same time.'; end if;
  v_main := v[1];
  perform set_config('zs.internal', 'on', true);
  update products set labels = v, shop_label = v_main, label_at = now(),
         is_preorder = case when 'prebook' = any (v) then true
                            when 'prebook' = any (pr.labels) or pr.shop_label = 'prebook' then false else is_preorder end
   where id = pr.id;
  return v;
end $$;
revoke execute on function set_product_labels(bigint, text[]) from public, anon;
grant execute on function set_product_labels(bigint, text[]) to authenticated;

-- the old one-label call now replaces the list with that one label
create or replace function set_product_label(p_product bigint, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  v := set_product_labels(p_product, case when coalesce(nullif(lower(trim(p_label)), ''), 'none') = 'none' then '{}'::text[] else array[lower(trim(p_label))] end);
  return coalesce(v[1], 'none');
end $$;


-- ---------------------------------------------------------------- 2. listing saves details and collections
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
    line = case when lower(coalesce(p->>'line', '')) in ('designed', 'plain') then lower(p->>'line') else line end,
    details = case when jsonb_typeof(p->'details') = 'object' then
                (select coalesce(jsonb_object_agg(k, val), '{}'::jsonb) from jsonb_each(p->'details') e(k, val)
                  where k in ('neck', 'sleeve', 'print_type', 'print_place', 'care', 'model', 'highlights', 'origin', 'fit_note') and val <> '""'::jsonb and val <> 'null'::jsonb)
              else details end
  where id = v_id;
  if jsonb_typeof(p->'labels') = 'array' then perform set_product_labels(v_id, array(select jsonb_array_elements_text(p->'labels')));
  elsif coalesce(p->>'shop_label', '') <> '' then perform set_product_label(v_id, p->>'shop_label'); end if;
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
    p.drop_at IS NOT NULL AND p.drop_at > now() OR 'coming_soon'::text = ANY (p.labels) AS coming_soon,
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
    p.label_at,
    p.labels,
    p.details
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


-- ---------------------------------------------------------------- 3. offers for one tee
alter table coupons add column if not exists product_ids bigint[] not null default '{}';

CREATE OR REPLACE FUNCTION public.save_coupon(p jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                       usage_limit, per_customer_limit, first_order_only, influencer_id, member_id, created_by, product_ids)
  values (v_code, p->>'description', p->>'kind', (p->>'value')::numeric, coalesce((p->>'min_order')::numeric, 0),
          (p->>'max_discount')::numeric, coalesce(nullif(p->>'channel', ''), 'both'), (p->>'starts_at')::timestamptz,
          (p->>'ends_at')::timestamptz, (p->>'usage_limit')::int, coalesce((p->>'per_customer_limit')::int, 1),
          coalesce((p->>'first_order_only')::boolean, false), (p->>'influencer_id')::bigint, nullif(p->>'member_id', '')::uuid, m.id,
          coalesce(array(select jsonb_array_elements_text(p->'product_ids')::bigint), '{}'))
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public._price_cart(p_channel text, p_items jsonb, p_opts jsonb, p_lock boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  it        record;
  v_scope   numeric;
  v_cbase   numeric;
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
      -- a code made for one tee only discounts that tee
      v_cbase := v_base;
      if v_cerr is null and cardinality(coalesce(cp.product_ids, '{}')) > 0 then
        select coalesce(sum((l->>'price')::numeric * (l->>'qty')::int), 0) into v_scope
          from jsonb_array_elements(lines) l where (l->>'product_id')::bigint = any (cp.product_ids);
        if v_scope = 0 then v_cerr := 'This code works only on ' || (select string_agg(name, ', ') from products where id = any (cp.product_ids)) || '.';
        else v_cbase := round(v_base * v_scope / nullif(v_sub, 0), 2); end if;
      end if;
      if v_cerr is null then
        v_cdisc := case when cp.kind = 'percent' then round(v_cbase * cp.value / 100, 0) else cp.value end;
        if cp.max_discount is not null then v_cdisc := least(v_cdisc, cp.max_discount); end if;
        v_cdisc := least(v_cdisc, v_cbase);
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

  -- SINDIICAT Club points (logged-in customers only)
  if v_pts > 0 then
    if v_cust is null then
      if p_lock then raise exception 'Sign in to use SINDIICAT Club points.'; end if;
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

create or replace view public_offers as
SELECT code,
    description,
    kind,
    value,
    min_order,
    max_discount,
    first_order_only,
    ends_at,
    product_ids
   FROM coupons c
  WHERE active AND show_in_shop AND influencer_id IS NULL AND member_id IS NULL AND channel <> 'store'::text AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) AND (usage_limit IS NULL OR (( SELECT count(*) AS count
           FROM orders o
          WHERE o.coupon_code = c.code AND o.status <> 'cancelled'::text)) < usage_limit);
grant select on public_offers to anon, authenticated;

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
    p.shop_label,
    p.labels
   FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
  WHERE (current_member()).id IS NOT NULL AND p.deleted_at IS NULL;


-- coupon list in the team app shows which tee a code is for
notify pgrst, 'reload schema';
