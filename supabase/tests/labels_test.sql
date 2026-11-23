-- SINDIICAT · automatic collections test
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

\echo '\n== 72. New shows by itself and drops off =='
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Auto Label Tee', 'fit', 'oversized', 'mrp', 999, 'price', 699, 'labels', jsonb_build_array('premium', 'new'),
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'colour_hex', '#111111', 'size', 'M')))) as pa \gset
select pv.id as va from product_variants pv where pv.product_id = :pa \gset
:as_guest
select t.eq('new tee: badge first, then New', (select array_to_string(labels, ',') from catalog where id = :pa), 'premium,new');
reset role;
do $$ begin perform set_config('zs.internal', 'on', true); end $$;
select set_config('zs.internal', 'on', false);
update products set created_at = now() - interval '40 days', published_at = now() - interval '40 days' where name = 'Auto Label Tee';
select set_config('zs.internal', '', false);
:as_guest
select t.eq('after 30 days New drops off', (select array_to_string(labels, ',') from catalog where id = :pa), 'premium');
reset role;
select set_config('zs.internal', 'on', false);
update settings set value = '60' where key = 'label_new_days';
select set_config('zs.internal', '', false);
:as_guest
select t.eq('partners can make New last longer', (select 'new' = any (labels) from catalog where id = :pa), true);
reset role;
select set_config('zs.internal', 'on', false);
update settings set value = '30' where key = 'label_new_days';
select set_config('zs.internal', '', false);

\echo '\n== 73. Restocked shows when a sold-out size comes back =='
:as_aaryak
select add_stock(:va, 2, 'opening');
:as_guest
select t.eq('first stock is not a restock', (select 'restocked' = any (labels) from catalog where id = :pa), false);
reset role;
select set_config('zs.internal', 'on', false);
insert into stock_moves (variant_id, qty, reason, note) values (:va, -2, 'sale', 'test sell-out');
select set_config('zs.internal', '', false);
:as_aaryak
select add_stock(:va, 5, 'production');
:as_guest
select t.eq('sold out, then fresh stock = Restocked', (select array_to_string(labels, ',') from catalog where id = :pa), 'premium,restocked');
:as_aaryak
select t.eq('team stock screen sees it too', (select 'restocked' = any (labels) from stock_board where product_id = :pa limit 1), true);

\echo '\n== 74. Bestseller comes from real sales =='
reset role;
select set_config('zs.internal', 'on', false);
update settings set value = '1' where key = 'label_bestseller_min';
update settings set value = '1' where key = 'label_bestseller_top';
select set_config('zs.internal', '', false);
:as_guest
select t.eq('exactly the top seller is a Bestseller', (select count(*)::int from catalog where 'bestseller' = any (labels)), 1);
reset role;
select set_config('zs.internal', 'on', false);
update settings set value = '100000' where key = 'label_bestseller_min';
select set_config('zs.internal', '', false);
:as_guest
select t.eq('no tee sold enough = no Bestseller', (select count(*)::int from catalog where 'bestseller' = any (labels)), 0);
\o
\echo '\nALL AUTO LABEL RULES PASSED ✅'
