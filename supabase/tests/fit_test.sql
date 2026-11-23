-- SINDIICAT · phase 11 test: Regular Fit tees next to Oversized
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'

\echo '\n== 62. A Regular Fit tee =='
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Z Classic Regular Tee', 'type', 'Regular Fit Tee', 'fit', 'regular', 'mrp', 699, 'price', 449,
  'fabric', '100% Cotton', 'gsm', 180,
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Navy', 'colour_hex', '#1f2a44', 'size', 'M'), jsonb_build_object('colour', 'Navy', 'colour_hex', '#1f2a44', 'size', 'L')))) as p_reg \gset
select t.eq('product saved as Regular Fit', (select fit from products where id = :p_reg), 'regular');
select t.eq('SKU carries the fit code', (select bool_and(sku like 'SC-RF-%') from product_variants where product_id = :p_reg), true);
select id as p_basic from products where name = 'Z Basic Tee' \gset
select t.eq('older tees stay Oversized', (select fit from products where id = :p_basic), 'oversized');
select upsert_product(jsonb_build_object('name', 'Z Plain Regular', 'type', 'Regular Fit Tee', 'mrp', 599, 'price', 399)) as p_reg2 \gset
select t.eq('"Regular" in the type is enough', (select fit from products where id = :p_reg2), 'regular');
:as_guest
select t.eq('shop sees the fit', (select fit_label from catalog where id = :p_reg), 'Regular Fit');
select pv.id as rl from product_variants pv where pv.product_id = :p_reg and pv.size = 'L' \gset

\echo '\n== 63. Plain tee stock kept apart by fit =='
:as_mahendra
select add_blanks('Navy', '#1f2a44', 'L', 30, 'purchase', 3600, 'Tiruppur Knits');
select add_blanks('Navy', '#1f2a44', 'L', 20, 'purchase', 2000, 'Tiruppur Knits', 'regular');
select t.eq('two lines: Oversized and Regular', (select string_agg(fit || ':' || qty, ',' order by fit) from blank_stock where colour = 'Navy' and size = 'L'), 'oversized:30,regular:20');
select t.eq('average cost per fit', (select avg_cost from blank_stock where colour = 'Navy' and size = 'L' and fit = 'regular'), 100.00::numeric);
select save_batch(jsonb_build_object('product_id', :p_reg, 'items', jsonb_build_array(jsonb_build_object('variant_id', :rl, 'qty', 5)))) as b1 \gset
select set_batch_stage(:b1, 'printing');
select t.eq('printing a Regular tee uses Regular blanks', (select qty from blank_stock where colour = 'Navy' and size = 'L' and fit = 'regular'), 15);
select t.eq('Oversized blanks untouched', (select qty from blank_stock where colour = 'Navy' and size = 'L' and fit = 'oversized'), 30);

\echo '\n== 64. Damage and purchase orders by fit =='
select report_damage(jsonb_build_object('item', 'blank', 'fit', 'regular', 'colour', 'navy', 'size', 'l', 'qty', 2, 'vendor', 'Tiruppur Knits', 'ask', 'replace', 'reason', 'Stitching open', 'photos', '["m/r1.jpg"]'::jsonb)) as c1 \gset
select t.eq('damaged Regular blanks leave Regular stock', (select qty from blank_stock where colour = 'Navy' and size = 'L' and fit = 'regular'), 13);
select t.eq('claim says Regular Fit', (select what from damage_board where id = :c1), 'Regular Fit · Navy / L');
select damage_update(:c1, 'settle', 2);
select t.eq('replacements go back to Regular stock', (select qty from blank_stock where colour = 'Navy' and size = 'L' and fit = 'regular'), 15);
select t.expect_error(format('select report_damage(%L)', jsonb_build_object('item', 'blank', 'fit', 'regular', 'colour', 'navy', 'size', 'xl', 'qty', 1, 'vendor', 'X', 'ask', 'return', 'reason', 'Torn', 'photos', '["a.jpg"]'::jsonb)), 'in stock');
select (save_vendor('{"category":"plain","name":"Regular Knits","phone":"9811122299","state_code":"24"}'::jsonb))->>'id' as v1 \gset
select (save_po(jsonb_build_object('po_type', 'plain', 'vendor_id', :v1, 'terms', '["Match the swatch"]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('description', 'Regular tee 180 GSM · Navy · M', 'qty', 40, 'rate', 110, 'gst_rate', 5, 'colour', 'navy', 'colour_hex', '#1f2a44', 'size', 'm', 'specs', jsonb_build_object('fit', 'Regular')))))) as po \gset
select (:'po'::jsonb)->>'id' as po_id \gset
select t.eq('PO line remembers Regular', (select fit from po_items where po_id = :po_id), 'regular');
select submit_po(:po_id);
:as_aaryak
select cast_vote((select request_id from purchase_orders where id = :po_id), 'approve');
:as_ayush
select cast_vote((select request_id from purchase_orders where id = :po_id), 'approve');
:as_jigar
select cast_vote((select request_id from purchase_orders where id = :po_id), 'approve');
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
:as_devanshi
select cast_vote((select request_id from purchase_orders where id = :po_id), 'approve');
:as_mahendra
select po_action(:po_id, 'receive', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 40)) from po_items where po_id = :po_id));
select t.eq('received into Regular blank stock', (select qty from blank_stock where colour = 'Navy' and size = 'M' and fit = 'regular'), 40);

\echo '\n== 65. Accounts by fit =='
:as_mahendra
select set_batch_stage(:b1, 'ready');
:as_aaryak
select t.eq('profit report has a line per fit', (select string_agg(fit, ',' order by fit) from fit_profit), 'oversized,regular');
select t.eq('Regular printed stock counted', (select printed_stock from fit_profit where fit = 'regular'), 5);
select t.eq('Regular blanks counted', (select blank_stock from fit_profit where fit = 'regular'), 55);
select t.eq('period summary has both fits', jsonb_array_length(fit_summary(today_ist() - 30, today_ist())), 2);
select t.eq('product profit carries the fit', (select fit from product_profit where product_id = :p_reg), 'regular');
:as_mahendra
select t.eq('employees do not see fit profit', (select count(*) from fit_profit), 0::bigint);
select t.expect_error('select fit_summary()', 'Partners only');

\echo '\n== 66. Pure Essence plain tees straight from blanks =='
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Pure Essence Regular Fit', 'line', 'plain', 'fit', 'regular', 'type', 'Regular Fit Tee', 'mrp', 499, 'price', 349, 'shop_label', 'premium',
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Navy', 'colour_hex', '#1f2a44', 'size', 'M'), jsonb_build_object('colour', 'Navy', 'colour_hex', '#1f2a44', 'size', 'L')))) as p_pe \gset
select t.eq('plain line saved with its badge', (select line || '/' || shop_label from products where id = :p_pe), 'plain/premium');
select pv.id as pem from product_variants pv where pv.product_id = :p_pe and pv.size = 'M' \gset
:as_mahendra
select t.expect_error(format('select blanks_to_shop(%s, %L)', :p_pe, jsonb_build_array(jsonb_build_object('variant_id', :pem, 'qty', 999))), 'in blank stock');
select t.eq('moves 10 plain tees into the shop', blanks_to_shop(:p_pe, jsonb_build_array(jsonb_build_object('variant_id', :pem, 'qty', 10))), 10);
select t.eq('they are on the shelf', stock_of(:pem), 10);
select t.eq('and gone from Regular blanks', (select qty from blank_stock where colour = 'Navy' and size = 'M' and fit = 'regular'), 30);
select t.eq('cost comes from the blank price', (select cost_price from products where id = :p_pe),
  (select round(sum(cost) filter (where reason = 'purchase') / sum(qty) filter (where reason = 'purchase'), 2) from blank_moves where colour = 'Navy' and fit = 'regular'));
select t.expect_error(format('select blanks_to_shop(%s, %L)', :p_reg, jsonb_build_array(jsonb_build_object('variant_id', :rl, 'qty', 1))), 'Only Pure Essence');

\echo '\n== 67. Shop labels =='
select set_product_label(:p_pe, 'premium');
select t.eq('label changed any time', (select shop_label from catalog where id = :p_pe), 'premium');
select set_product_label(:p_reg, 'prebook');
select t.eq('pre-book lets customers order with no stock', (select is_preorder from products where id = :p_reg), true);
select set_product_label(:p_reg, 'limited');
select t.eq('moving off pre-book switches it off', (select is_preorder from products where id = :p_reg), false);
select set_product_label(:p_pe, 'coming_soon');
:as_guest
select t.eq('coming soon shows in the shop', (select coming_soon from catalog where id = :p_pe), true);
select t.expect_error(format('select quote_cart(%L)', jsonb_build_array(jsonb_build_object('variant_id', :pem, 'qty', 1))), 'coming soon');
:as_mahendra
select set_product_label(:p_pe, 'none');
select t.eq('label cleared', (select shop_label is null from products where id = :p_pe), true);
select t.expect_error(format('select set_product_label(%s, ''hot'')', :p_pe), 'Unknown label');
\o
\echo '\nALL REGULAR FIT RULES PASSED ✅'
