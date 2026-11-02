-- =====================================================================
-- Z-SHIRTS · shop / orders / stock rules test (runs after rules_test.sql)
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_customer 'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set riya '''{"name":"Riya Shah","phone":"98765 43210","address":{"line1":"12 Sunrise Flats, Bodakdev","city":"Ahmedabad","state":"Gujarat","pincode":"380054"}}'''

\set riya_dummy 1
:as_server
grant usage on schema t to anon;
grant execute on all functions in schema t to anon;
select id as aaryak from members where email = 'aaryak@example.com' \gset
select id as ayush from members where email = 'ayush@example.com' \gset
select id as devanshi from members where email = 'devanshi@example.com' \gset
select id as jigar from members where email = 'jigar@example.com' \gset

\echo '\n== 14. Catalogue and stock =='
:as_mahendra
select upsert_category('Oversized Tees', 1) as cat \gset
select upsert_product(jsonb_build_object('name', 'Neon Static Tee', 'category_id', :cat, 'mrp', 1499, 'price', 999,
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'size', 'M')))) as p_draft \gset
select t.eq('Mahendra''s product starts as a draft', (select published_at is null from products where id = :p_draft), true);
:as_customer
select t.eq('customers cannot see drafts', (select count(*) from catalog where id = :p_draft), 0::bigint);
:as_aaryak
select publish_product(:p_draft);
select upsert_product(jsonb_build_object('name', 'Acid Wash Drop', 'category_id', :cat, 'mrp', 1999, 'price', 1299,
  'variants', jsonb_build_array(
     jsonb_build_object('colour', 'Black', 'colour_hex', '#0b0b0c', 'size', 'M'),
     jsonb_build_object('colour', 'Black', 'colour_hex', '#0b0b0c', 'size', 'L'),
     jsonb_build_object('colour', 'White', 'colour_hex', '#ffffff', 'size', 'M')))) as p_acid \gset
:as_server
select id as bm from product_variants where product_id = :p_acid and colour = 'Black' and size = 'M' \gset
select id as bl from product_variants where product_id = :p_acid and colour = 'Black' and size = 'L' \gset
select id as wm from product_variants where product_id = :p_acid and colour = 'White' and size = 'M' \gset
:as_mahendra
select add_stock(:bm, 10, 'production', 'Batch 1');
select add_stock(:bl, 3, 'production');
select add_stock(:wm, 6, 'opening');
select t.expect_error(format('select add_stock(%s, 5, ''sale'')', :bm), 'production or opening');
:as_customer
select t.eq('shop shows both products', (select count(*) from catalog), 2::bigint);
select t.eq('shop shows 35% off on Acid Wash', (select discount_pct from catalog where id = :p_acid), 35);
select t.eq('shop shows stock 10 for Black M',
  (select (v->>'stock')::int from catalog, jsonb_array_elements(variants) v where id = :p_acid and (v->>'id')::bigint = :bm), 10);
select t.expect_error('select * from orders', 'permission denied');
select t.expect_error('update products set price = 1', 'permission denied');

\echo '\n== 15. Website order · cash on delivery =='
:as_customer
select (place_web_order(:riya, jsonb_build_array(jsonb_build_object('variant_id', :bm, 'qty', 2),
                                                  jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod'))->>'order_no' as o1 \gset
:as_server
select t.eq('stock reserved: Black M now 8', stock_of(:bm), 8);
select t.eq('order total uses shop prices (not the browser)', (select total from orders where order_no = :'o1'), 3897.00::numeric);
select t.eq('team notified with celebration', (select celebrate from notifications where kind = 'order' and order_id = (select id from orders where order_no = :'o1')), true);
:as_customer
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 5}]'', ''cod'')', :riya, :bl), 'Only 2 left');
select t.expect_error(format('select place_web_order(''{"name":"X Y","phone":"123","address":{}}'', ''[{"variant_id": %s, "qty": 1}]'', ''cod'')', :bm), '10-digit');

\echo '\n== 16. Website order · online payment (Razorpay) =='
:as_customer
select (place_web_order(:riya, jsonb_build_array(jsonb_build_object('variant_id', :wm, 'qty', 1)), 'online'))->>'order_no' as o2 \gset
select t.expect_error(format('select confirm_online_payment(%L, ''x'', ''y'', 129900)', :'o2'), 'permission denied');
:as_server
select t.eq('no order celebration before payment', (select count(*) from notifications where kind = 'order' and order_id = (select id from orders where order_no = :'o2')), 0::bigint);
select t.eq('low-stock alert fired (White M down to 5)', (select count(*) from notifications where kind = 'stock' and title = 'Low stock: Acid Wash Drop'), 1::bigint);
select attach_razorpay_order(:'o2', 'order_RZP1');
select t.expect_error(format('select confirm_online_payment(%L, ''order_RZP1'', ''pay_1'', 100)', :'o2'), 'does not match');
select t.expect_error(format('select confirm_online_payment(%L, ''order_FAKE'', ''pay_1'', 129900)', :'o2'), 'does not belong');
select t.eq('payment confirmed', confirm_online_payment(:'o2', 'order_RZP1', 'pay_1', 129900), 'paid');
select t.eq('confirming twice is harmless', confirm_online_payment(:'o2', 'order_RZP1', 'pay_1', 129900), 'already_paid');
select t.eq('sale posted to the books', (select amount from ledger where kind = 'sale' and order_id = (select id from orders where order_no = :'o2')), 1299.00::numeric);
select t.eq('FIRST ORDER EVER milestone fired', (select count(*) from notifications where kind = 'milestone' and title = 'FIRST ORDER EVER!'), 1::bigint);

\echo '\n== 17. Order pipeline =='
:as_server
select id as id1 from orders where order_no = :'o1' \gset
:as_mahendra
select t.expect_error(format('select set_order_status(%s, ''shipped'')', :id1), 'cannot be marked');
select set_order_status(:id1, 'confirmed');
select set_order_status(:id1, 'packed');
select t.expect_error(format('select set_order_status(%s, ''shipped'')', :id1), 'courier');
select set_order_status(:id1, 'shipped', null, 'Delhivery', 'DL123456');
select set_order_status(:id1, 'delivered');
select t.eq('COD collected on delivery → paid', (select payment_status from orders where id = :id1), 'paid');
:as_server
select t.eq('COD sale posted', (select count(*) from ledger where order_id = :id1 and kind = 'sale'), 1::bigint);
:as_mahendra
select t.expect_error(format('select set_order_status(%s, ''confirmed'')', :id1), 'cannot be marked');

\echo '\n== 18. RTO puts stock back =='
:as_customer
select (place_web_order(:riya, jsonb_build_array(jsonb_build_object('variant_id', :bm, 'qty', 1)), 'cod'))->>'order_no' as o3 \gset
:as_server
select id as id3 from orders where order_no = :'o3' \gset
:as_mahendra
select set_order_status(:id3, 'confirmed');
select set_order_status(:id3, 'packed');
select set_order_status(:id3, 'shipped', null, 'Shiprocket', 'SR1');
select t.eq('before RTO: Black M 7', stock_of(:bm), 7);
select set_order_status(:id3, 'rto', 'Customer refused');
select t.eq('after RTO: Black M back to 8', stock_of(:bm), 8);
:as_server
select t.eq('RTO never touched the books', (select count(*) from ledger where order_id = :id3), 0::bigint);
:as_mahendra

\echo '\n== 19. Cancelling a paid order = refund = partner only =='
:as_server
select id as id2 from orders where order_no = :'o2' \gset
:as_mahendra
select t.expect_error(format('select set_order_status(%s, ''cancelled'', ''customer asked'')', :id2), 'Only a partner');
:as_aaryak
select t.expect_error(format('select set_order_status(%s, ''cancelled'')', :id2), 'why the order');
select set_order_status(:id2, 'cancelled', 'Customer changed mind before dispatch');
select t.eq('stock back: White M 6', stock_of(:wm), 6);
select t.eq('refund posted −1,299', (select amount from ledger where kind = 'refund' and order_id = :id2), -1299.00::numeric);

\echo '\n== 20. Instagram order and store sale =='
:as_mahendra
select t.expect_error(format('select staff_create_order(''instagram'', %L, ''[{"variant_id": %s, "qty": 1}]'', ''upi'', 15)', :riya, :bm), 'at most 10');
select (staff_create_order('instagram', :riya, jsonb_build_array(jsonb_build_object('variant_id', :bm, 'qty', 1)), 'upi', 5))->>'id' as id4 \gset
select t.eq('Instagram prepaid order: 5% off → ₹1,234', (select total from orders where id = :id4), 1234.00::numeric);
:as_server
select t.eq('prepaid → sale in books', (select amount from ledger where kind = 'sale' and order_id = :id4), 1234.00::numeric);
:as_mahendra
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cod'')', :bm), 'cash or UPI');
select (staff_create_order('store', '{}', jsonb_build_array(jsonb_build_object('variant_id', :wm, 'qty', 1)), 'cash'))->>'id' as id5 \gset
select t.eq('store sale is delivered + paid instantly', (select status || '/' || payment_status from orders where id = :id5), 'delivered/paid');
select t.eq('walk-in name filled in', (select customer_name from orders where id = :id5), 'Walk-in customer');

\echo '\n== 21. Tracking, replacement and return =='
:as_customer
select t.expect_error(format('select track_order(%L, ''9999999999'')', :'o1'), 'No order found');
select t.eq('customer tracks order', (track_order(:'o1', '+91 98765-43210'))->>'status', 'delivered');
:as_server
select id as item_bm from order_items where order_id = :id1 and variant_id = :bm \gset
:as_customer
select request_service(:'o1', '9876543210', 'replacement', 'Size M is too small',
  jsonb_build_array(jsonb_build_object('order_item_id', :item_bm, 'qty', 1, 'new_variant_id', :bl))) as sr1 \gset
select t.expect_error(format('select request_service(%L, ''9876543210'', ''return'', ''Changed my mind'', ''[{"order_item_id": %s, "qty": 1}]'')', :'o1', :item_bm), 'already an open request');
:as_mahendra
select t.eq('Mahendra approves replacement', set_service_status(:sr1, 'approve', 'Sending L'), 'approved');
select t.eq('L before swap: 2', stock_of(:bl), 2);
select set_service_status(:sr1, 'complete');
select t.eq('M came back: 8', stock_of(:bm), 8);
select t.eq('L went out: 1', stock_of(:bl), 1);
-- return on the Instagram order
select set_order_status(:id4, 'packed');
select set_order_status(:id4, 'shipped', null, 'Delhivery', 'DL9');
select set_order_status(:id4, 'delivered');
:as_server
select order_no as o4 from orders where id = :id4 \gset
select id as item4 from order_items where order_id = :id4 \gset
:as_customer
select request_service(:'o4', '9876543210', 'return', 'Fabric not as expected',
  jsonb_build_array(jsonb_build_object('order_item_id', :item4, 'qty', 1))) as sr2 \gset
:as_mahendra
select t.expect_error(format('select set_service_status(%s, ''approve'')', :sr2), 'partner must approve');
:as_jigar
select set_service_status(:sr2, 'approve', 'Pickup arranged');
select set_service_status(:sr2, 'complete', 'Refunded by UPI');
select t.eq('return refunds what was actually paid (after 5% off)', (select amount from ledger where kind = 'refund' and order_id = :id4), -1234.00::numeric);
select t.eq('order marked returned', (select status from orders where id = :id4), 'returned');

\echo '\n== 22. Live price changes and damaged stock need all 4 =='
:as_aaryak
select t.expect_error(format('select upsert_product(''{"id": %s, "name": "Acid Wash Drop", "mrp": 1999, "price": 999}'')', :p_acid), 'needs all partners');
select raise_request('price_change', null, 'Festive price', null, jsonb_build_object('product_id', :p_acid, 'price', 1199, 'mrp', 1999)) as r_price \gset
:as_ayush
select cast_vote(:r_price, 'approve');
:as_devanshi
select cast_vote(:r_price, 'approve');
select t.eq('price unchanged at 3 of 4', (select price from products where id = :p_acid), 1299.00::numeric);
:as_jigar
select cast_vote(:r_price, 'approve');
select t.eq('price now ₹1,199', (select price from products where id = :p_acid), 1199.00::numeric);
:as_mahendra
select t.expect_error(format('select raise_request(''stock_writeoff'', null, ''too many'', null, ''{"variant_id": %s, "qty": 99}'')', :wm), 'Only 5 in stock');
select raise_request('stock_writeoff', null, 'Print smudged on 1 piece', null, jsonb_build_object('variant_id', :wm, 'qty', 1)) as r_wo \gset
:as_aaryak
select cast_vote(:r_wo, 'approve');
:as_ayush
select cast_vote(:r_wo, 'approve');
:as_devanshi
select cast_vote(:r_wo, 'approve');
select t.eq('still 5 at 3 of 4', stock_of(:wm), 5);
:as_jigar
select cast_vote(:r_wo, 'approve');
select t.eq('written off: 4 left', stock_of(:wm), 4);

\echo '\n== 23. Custom profit split =='
:as_aaryak
select t.expect_error(format($$select raise_request('share_rule', null, 'custom', null, '{"profit_rule":"custom","loss_rule":"equal","split":{"%s":50}}')$$, :'aaryak'), 'every partner');
select t.expect_error(format($$select raise_request('share_rule', null, 'custom', null, '{"profit_rule":"custom","loss_rule":"custom","split":{"%s":50,"%s":20,"%s":20,"%s":20}}')$$, :'aaryak', :'ayush', :'devanshi', :'jigar'), 'add up to 100');
select raise_request('share_rule', null, '40/20/20/20', null, jsonb_build_object('profit_rule', 'custom', 'loss_rule', 'custom',
  'split', jsonb_build_object(:'aaryak', 40, :'ayush', 20, :'devanshi', 20, :'jigar', 20))) as r_split \gset
:as_ayush
select cast_vote(:r_split, 'approve');
:as_devanshi
select cast_vote(:r_split, 'approve');
:as_jigar
select cast_vote(:r_split, 'approve');
select t.eq('Aaryak now shares 40%', (select result_share from partner_positions where name = 'Aaryak Patel'), 0.40::numeric);
select t.eq('settlements still add up', (select sum(settlement_balance) from partner_positions), (select cash_balance from business_summary));

\echo '\n== 24. Notifications and access =='
:as_mahendra
select t.eq('Mahendra never sees partner-only alerts', (select count(*) from notifications where audience = 'partners'), 0::bigint);
select t.expect_error('insert into orders (channel, customer_name, payment_method) values (''store'', ''x'', ''cash'')', 'permission denied');
:as_aaryak
select t.eq('partners get approval alerts', (select count(*) > 0 from notifications where kind = 'approval'), true);
select t.eq('order history kept', (select count(*) from order_events where order_id = :id1) >= 5, true);

\echo '\nALL COMMERCE RULES PASSED ✅'
