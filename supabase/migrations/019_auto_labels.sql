-- =====================================================================
-- SINDIICAT · 019 · One badge, automatic collections
-- Partners pick ONE badge per tee (Premium, Limited, Coming soon, Pre-book).
-- New, Restocked and Bestseller are worked out automatically:
--   New        → launched in the last N days (default 30)
--   Restocked  → a sold-out size got fresh stock in the last N days (default 14)
--   Bestseller → among the top sellers of the last N days (default top 6, 30 days, min 5 pcs)
-- =====================================================================

-- ---------------------------------------------------------------- 1. settings partners can change
do $$ begin
  perform set_config('zs.internal', 'on', true);
  insert into settings (key, value, label, kind, grp) values
    ('label_new_days', '30', 'Shop: a tee shows "New" for this many days after launch', 'number', 'Shop'),
    ('label_restocked_days', '14', 'Shop: "Restocked" shows for this many days after a sold-out size comes back', 'number', 'Shop'),
    ('label_bestseller_top', '6', 'Shop: how many top-selling tees get "Bestseller"', 'number', 'Shop'),
    ('label_bestseller_days', '30', 'Shop: "Bestseller" looks at sales from the last this-many days', 'number', 'Shop'),
    ('label_bestseller_min', '5', 'Shop: pieces a tee must sell (in that time) to be a "Bestseller"', 'number', 'Shop')
  on conflict (key) do nothing;
  -- keep only the one hand-picked badge on every tee
  update products set
    labels = coalesce((select array[x] from unnest(labels) x where x in ('coming_soon', 'prebook', 'premium', 'limited')
                       order by array_position(array['coming_soon', 'prebook', 'premium', 'limited'], x) limit 1), '{}'),
    shop_label = (select x from unnest(labels) x where x in ('coming_soon', 'prebook', 'premium', 'limited')
                  order by array_position(array['coming_soon', 'prebook', 'premium', 'limited'], x) limit 1)
  where labels && array['new', 'bestseller', 'restocked'] or cardinality(labels) > 1 or shop_label in ('new', 'bestseller', 'restocked');
end $$;

-- ---------------------------------------------------------------- 2. live labels (badge + automatic ones)
create or replace view product_labels_live as
with cfg as (
  select coalesce((select (value #>> '{}')::numeric from settings where key = 'label_new_days'), 30)::int as nd,
         coalesce((select (value #>> '{}')::numeric from settings where key = 'label_restocked_days'), 14)::int as rd,
         coalesce((select (value #>> '{}')::numeric from settings where key = 'label_bestseller_top'), 6)::int as bt,
         coalesce((select (value #>> '{}')::numeric from settings where key = 'label_bestseller_days'), 30)::int as bd,
         coalesce((select (value #>> '{}')::numeric from settings where key = 'label_bestseller_min'), 5)::int as bm
),
sales as (
  select pv.product_id, sum(i.qty) as units
  from order_items i join orders o on o.id = i.order_id join product_variants pv on pv.id = i.variant_id, cfg
  where o.status not in ('cancelled', 'rto', 'returned') and o.created_at > now() - make_interval(days => cfg.bd)
  group by pv.product_id
),
best as (
  select product_id from (
    select s.product_id, row_number() over (order by s.units desc, s.product_id) as rn
    from sales s, cfg where s.units >= cfg.bm) x, cfg
  where x.rn <= cfg.bt
),
restock as (
  -- fresh stock (not a return or cancel) that brought a sold-out size back
  select distinct pv.product_id
  from stock_moves m join product_variants pv on pv.id = m.variant_id, cfg
  where m.qty > 0 and m.reason not in ('return', 'cancel', 'rto', 'damage_undo', 'opening')
    and m.created_at > now() - make_interval(days => cfg.rd)
    and exists (select 1 from stock_moves e where e.variant_id = m.variant_id and (e.created_at, e.id) < (m.created_at, m.id))
    and (select coalesce(sum(e.qty), 0) from stock_moves e where e.variant_id = m.variant_id and (e.created_at, e.id) < (m.created_at, m.id)) <= 0
)
select p.id as product_id, l.labels, l.labels[1] as shop_label
from products p cross join cfg
cross join lateral (
  select coalesce(array_agg(x order by array_position(array['coming_soon', 'prebook', 'premium', 'limited', 'new', 'bestseller', 'restocked'], x)), '{}') as labels
  from (
    select y as x from unnest(coalesce(p.labels, '{}')) y where y in ('coming_soon', 'prebook', 'premium', 'limited')
    union
    select 'new' where not ('coming_soon' = any (coalesce(p.labels, '{}')))
      and coalesce(p.drop_at, p.published_at, p.created_at) between now() - make_interval(days => cfg.nd) and now()
    union
    select 'bestseller' where p.id in (select product_id from best)
    union
    select 'restocked' where p.id in (select product_id from restock) and not ('coming_soon' = any (coalesce(p.labels, '{}')))
  ) s
) l;
revoke all on product_labels_live from public, anon, authenticated;
-- the shop reads labels only through this, never the raw view
create or replace function live_labels() returns table (product_id bigint, labels text[], shop_label text)
language sql stable security definer set search_path = public as $f$ select product_id, labels, shop_label from product_labels_live $f$;
revoke execute on function live_labels() from public;
grant execute on function live_labels() to anon, authenticated;

-- ---------------------------------------------------------------- 3. pick ONE badge; automatic ones are ignored
create or replace function set_product_labels(p_product bigint, p_labels text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member(); pr products;
  v text[]; v_main text;
  ord text[] := array['coming_soon', 'prebook', 'premium', 'limited'];
  auto text[] := array['new', 'bestseller', 'restocked'];
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into pr from products where id = p_product;
  if pr.id is null then raise exception 'Product not found.'; end if;
  select coalesce(array_agg(x order by array_position(ord, x)), '{}') into v
    from (select distinct lower(trim(x)) x from unnest(coalesce(p_labels, '{}')) x
          where trim(x) <> '' and lower(trim(x)) <> 'none') s
    where not x = any (auto);
  if exists (select 1 from unnest(v) x where not x = any (ord)) then raise exception 'Unknown label.'; end if;
  if 'coming_soon' = any (v) and 'prebook' = any (v) then raise exception 'A tee cannot be Coming soon and Pre-book at the same time.'; end if;
  if cardinality(v) > 1 then raise exception 'Pick one badge. New, Restocked and Bestseller come automatically.'; end if;
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


-- ---------------------------------------------------------------- 4. shop and stock screens show the live labels
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
    p.drop_at IS NOT NULL AND p.drop_at > now() OR ('coming_soon'::text = ANY (p.labels)) AS coming_soon,
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
    pl.shop_label,
    p.label_at,
    pl.labels,
    p.details
   FROM products p
     LEFT JOIN live_labels() pl(product_id, labels, shop_label) ON pl.product_id = p.id
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
    pl.shop_label,
    pl.labels,
    p.labels as badge
   FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN live_labels() pl(product_id, labels, shop_label) ON pl.product_id = p.id
  WHERE (current_member()).id IS NOT NULL AND p.deleted_at IS NULL;

notify pgrst, 'reload schema';
