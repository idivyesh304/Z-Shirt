-- Z-SHIRTS · phase 12 test: full listing (collections, details, tee-only offers)
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'

\echo '\n== 68. One listing, everything filled in =='
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Kesari Sunset Tee', 'fit', 'oversized', 'mrp', 1299, 'price', 899, 'gsm', 240, 'fabric', '100% Cotton',
  'labels', jsonb_build_array('new', 'premium'),
  'details', jsonb_build_object('neck', 'Rib crew neck', 'sleeve', 'Half sleeve', 'print_type', 'Puff print', 'print_place', 'Front and back',
     'care', 'Wash cold, inside out', 'model', 'Model is 5''11" and wears L', 'highlights', jsonb_build_array('Heavy 240 GSM', 'Pre-shrunk'), 'junk', 'x'),
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Saffron', 'colour_hex', '#f28c28', 'size', 'L')))) as p1 \gset
select t.eq('two collections at once', (select array_to_string(labels, ',') from products where id = :p1), 'premium,new');
select t.eq('main badge is the most important', (select shop_label from products where id = :p1), 'premium');
select t.eq('details saved, unknown keys dropped', (select details->>'print_type' || '/' || (details ? 'junk')::text from products where id = :p1), 'Puff print/false');
:as_guest
select t.eq('shop sees labels and details', (select array_length(labels, 1) || ' ' || (details->>'model') from catalog where id = :p1), '2 Model is 5''11" and wears L');
:as_mahendra
select set_product_labels(:p1, array['new', 'prebook']);
select t.eq('labels changed later, pre-book turns on', (select is_preorder from products where id = :p1), true);
select set_product_labels(:p1, array['premium']);
select t.eq('dropping pre-book turns it off', (select is_preorder from products where id = :p1), false);
select t.expect_error(format('select set_product_labels(%s, array[''coming_soon'', ''prebook''])', :p1), 'same time');
select t.expect_error(format('select set_product_labels(%s, array[''hot''])', :p1), 'Unknown label');

\echo '\n== 69. An offer that works only on this tee =='
:as_aaryak
select save_coupon(jsonb_build_object('code', 'KESARI20', 'kind', 'percent', 'value', 20, 'description', '20% off Kesari Sunset', 'product_ids', jsonb_build_array(:p1)));
select pv.id as k1 from product_variants pv where pv.product_id = :p1 \gset
select add_stock(:k1, 10, 'opening');
select pv.id as bl from product_variants pv join products p on p.id = pv.product_id where p.name = 'Z Basic Tee' and pv.size = 'L' \gset
:as_guest
select t.eq('offer listed for the shop with its tee', (select product_ids = array[:p1]::bigint[] from public_offers where code = 'KESARI20'), true);
select t.eq('20% only on the Kesari tee (₹899 → ₹180 off)', (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :k1, 'qty', 1), jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"coupon":"KESARI20"}'))->>'coupon_discount', '180');
select t.eq('other tees alone get an error', (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"coupon":"KESARI20"}'))->>'coupon_error', 'This code works only on Kesari Sunset Tee.');
\o
\echo '\nALL LISTING RULES PASSED ✅'
