-- =====================================================================
-- Z-SHIRTS · growth features test (runs after commerce_test.sql)
-- coupons, combos, Z-Club, Google customers, drops, pre-orders, push,
-- production, profit, cash close, HR, partner decisions
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_neha     'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''neha@gmail.com''), false); set role authenticated;'
\set as_karan    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''karan@gmail.com''), false); set role authenticated;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set neha '''{"name":"Neha Joshi","phone":"9811122233","address":{"line1":"4 Lake View, Vastrapur","city":"Ahmedabad","state":"Gujarat","pincode":"380015"}}'''
\set guest '''{"name":"Om Mehta","phone":"9822233344","address":{"line1":"9 MG Road","city":"Pune","state":"Maharashtra","pincode":"411001"}}'''

:as_server
insert into auth.users (email) values ('neha@gmail.com'), ('karan@gmail.com');
select id as mahendra from members where email = 'mahendra@example.com' \gset
select setting_num('free_shipping_above') as fsa \gset
select set_config('zs.internal','on',false);
update settings set value = '0'::jsonb where key in ('shipping_fee', 'free_shipping_above');

\echo '\n== 25. Catalogue for growth tests =='
:as_aaryak
select id as cat from categories limit 1 \gset
select upsert_product(jsonb_build_object('name', 'Z Basic Tee', 'category_id', :cat, 'mrp', 799, 'price', 499,
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'size', 'L'), jsonb_build_object('colour', 'Black', 'size', 'XL')))) as p_basic \gset
select upsert_product(jsonb_build_object('name', 'Chrome Dragon Tee', 'category_id', :cat, 'mrp', 1999, 'price', 1499,
  'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'size', 'L')))) as p_drop \gset
select upsert_product(jsonb_build_object('name', 'Custom Name Tee', 'category_id', :cat, 'mrp', 1299, 'price', 999,
  'variants', jsonb_build_array(jsonb_build_object('colour', 'White', 'size', 'M')))) as p_pre \gset
:as_server
select id as bl from product_variants where product_id = :p_basic and size = 'L' \gset
select id as bxl from product_variants where product_id = :p_basic and size = 'XL' \gset
select id as dl from product_variants where product_id = :p_drop \gset
select id as pm from product_variants where product_id = :p_pre \gset
:as_mahendra
select add_stock(:bl, 20, 'opening');
select add_stock(:dl, 5, 'opening');
:as_aaryak
select set_cost_price(:p_basic, 220);
:as_mahendra
select t.expect_error(format('select set_cost_price(%s, 1)', :p_basic), 'Only partners');
select t.eq('Mahendra cannot see cost price', (select cost_price from stock_board where variant_id = :bl), null::numeric);

\echo '\n== 26. Drops, limited editions, pre-orders =='
:as_mahendra
select t.expect_error(format('select set_product_drop(%s, ''Drop 01'', now() + interval ''2 days'', 50, false)', :p_drop), 'Only partners');
:as_aaryak
select set_product_drop(:p_drop, 'Drop 01 · Chrome', now() + interval '2 days', 50, false);
select set_product_drop(:p_pre, 'Made for you', null, null, true);
:as_guest
select t.eq('drop shows as coming soon', (select coming_soon from catalog where id = :p_drop), true);
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 1}]'', ''cod'')', :guest, :dl), 'drops on');
select (place_web_order(:guest, jsonb_build_array(jsonb_build_object('variant_id', :pm, 'qty', 2)), 'cod'))->>'order_no' as o_pre \gset
:as_server
select t.eq('pre-order accepted with zero stock', (select production_status from orders where order_no = :'o_pre'), 'queued');
select id as o_pre_id from orders where order_no = :'o_pre' \gset
:as_mahendra
select set_production_status(:o_pre_id, 'printing');
:as_guest
select t.eq('customer sees making status', (track_order(:'o_pre', '9822233344'))->>'production_status', 'printing');
:as_aaryak
select set_product_drop(:p_drop, 'Drop 01 · Chrome', now() - interval '1 minute', 50, false);

\echo '\n== 27. Coupons (online + store) =='
:as_mahendra
select t.expect_error('select save_coupon(''{"code":"HACK50","kind":"percent","value":50}'')', 'Only partners');
:as_ayush
select save_influencer('{"name":"Rohan Vlogs","handle":"@rohanvlogs","followers":42000}') as inf \gset
select save_coupon(jsonb_build_object('code', 'ROHAN10', 'kind', 'percent', 'value', 10, 'channel', 'online', 'influencer_id', :inf, 'per_customer_limit', 1));
select save_coupon('{"code":"STORE100","kind":"flat","value":100,"min_order":900,"channel":"store","per_customer_limit":5}');
select save_coupon('{"code":"FIRST15","kind":"percent","value":15,"max_discount":100,"first_order_only":true}');
select t.expect_error('select save_coupon(''{"code":"bad code","kind":"flat","value":1}'')', '3-20 letters');
:as_guest
select t.eq('online coupon priced into the bag',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), '{"coupon":"rohan10"}'))->'coupon_discount', '100'::jsonb);
select t.eq('store coupon refused online',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), '{"coupon":"STORE100"}'))->>'coupon_error', 'This coupon works only at the store.');
select t.eq('unknown coupon explained',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"coupon":"NOPE"}'))->>'coupon_error', 'This coupon code is not valid.');
select (place_web_order(:guest, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), 'cod', '{"coupon":"ROHAN10","utm_source":"instagram","utm_campaign":"diwali"}'))->>'total' as t1 \gset
select t.eq('coupon order total 998 - 100', :'t1'::text, '898.00');
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 1}]'', ''cod'', ''{"coupon":"ROHAN10"}'')', :guest, :bl), 'already used');
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 1}]'', ''cod'', ''{"coupon":"FIRST15"}'')', :guest, :bl), 'first order');
:as_mahendra
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cash'', 0, null, ''STORE100'')', :bl), 'more to use');
select (staff_create_order('store', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), 'cash', 0, null, 'store100'))->>'total' as t2 \gset
select t.eq('store coupon at the counter', :'t2'::text, '898.00');
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 2}]'', ''cash'', 5, null, ''STORE100'')', :bl), 'not both');
:as_guest
select t.expect_error('select * from coupons', 'permission denied');
:as_ayush
select t.eq('influencer tracker counts the order', (select orders from influencer_report where id = :inf), 1::bigint);
select t.eq('coupon board shows 1 use', (select uses from coupon_board where code = 'ROHAN10'), 1::bigint);

\echo '\n== 28. Combos =='
:as_mahendra
select t.expect_error('select save_bundle(''{"name":"x","qty":3,"price":1}'')', 'Only partners');
:as_jigar
select save_bundle(jsonb_build_object('name', 'Any 3 basics for ₹1199', 'qty', 3, 'price', 1199, 'product_ids', jsonb_build_array(:p_basic))) as bun \gset
:as_guest
select t.eq('combo applied automatically',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 3), jsonb_build_object('variant_id', :dl, 'qty', 1))))->'bundle_discount', '298'::jsonb);
select t.eq('combo + other tee total',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 3), jsonb_build_object('variant_id', :dl, 'qty', 1))))->'total', '2698'::jsonb);
select t.eq('2 tees: no combo yet',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2))))->'bundle_discount', '0'::jsonb);

\echo '\n== 29. Google customers + Z-Club =='
:as_neha
select t.eq('no account until profile saved', my_account(), null::jsonb);
select save_my_profile('Neha Joshi', '98111 22233');
select t.eq('account created with 0 points', (my_account())->'points', '0'::jsonb);
select (place_web_order(:neha, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), 'cod'))->>'order_no' as on1 \gset
:as_server
select id as on1_id, customer_id as neha_id from orders where order_no = :'on1' \gset
select t.eq('order linked to Neha''s account', (:neha_id)::bigint is not null, true);
:as_mahendra
select set_order_status(:on1_id, 'confirmed');
select set_order_status(:on1_id, 'packed');
select set_order_status(:on1_id, 'shipped', null, 'Delhivery', 'DL1');
:as_server
select t.eq('order push queued for Neha', (select count(*) from push_outbox where url = '?track=' || :'on1'), 0::bigint);
:as_neha
select save_push_subscription('https://push.example.com/neha', 'k1', 'a1');
:as_mahendra
select set_order_status(:on1_id, 'delivered');
:as_server
select t.eq('delivered push reaches Neha''s phone', (select count(*) from push_outbox where url = '?track=' || :'on1'), 1::bigint);
:as_neha
select t.eq('earned 5 points per ₹100 (₹998 → 49)', (my_account())->'points', '49'::jsonb);
select t.eq('sees her own order history', jsonb_array_length((my_account())->'orders'), 1);
select t.eq('sees only her own orders', (select count(*) from orders), 1::bigint);
select t.eq('redeem capped at 20% of order',
  (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"points":49}'))->'points_used', '49'::jsonb);
select (place_web_order(:neha, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod', '{"points":40}'))->>'total' as t3 \gset
select t.eq('points paid ₹40 of the order', :'t3'::text, '459.00');
select t.eq('balance after redeem', (my_account())->'points', '9'::jsonb);
:as_server
select id as on2_id from orders where customer_id = :neha_id order by id desc limit 1 \gset
:as_mahendra
select set_order_status(:on2_id, 'cancelled', 'Customer changed mind');
:as_neha
select t.eq('points returned on cancel', (my_account())->'points', '49'::jsonb);
:as_karan
select t.eq('another shopper sees nothing of Neha', (select count(*) from orders), 0::bigint);
select t.eq('another shopper sees no points', (select count(*) from loyalty_ledger), 0::bigint);
select t.eq('shopper sees no team members', (select count(*) from members), 0::bigint);
:as_server
create temp table leak (name text, n bigint);
grant all on leak to authenticated;
:as_karan
do $$ declare r record; v bigint; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v')
             and c.relname not in ('catalog', 'public_settings', 'categories', 'products', 'product_variants', 'bundles', 'push_public_key', 'customers', 'business_summary')
             and has_table_privilege('authenticated', c.oid, 'select') loop
    execute format('select count(*) from %I', r.relname) into v;
    if v > 0 then insert into leak values (r.relname, v); end if;
  end loop; end $$;
select t.eq('business totals show zero to shoppers', (select cash_balance from business_summary), 0::numeric);
select t.eq('a Google shopper can read no team table or report', (select string_agg(name, ', ') from leak), null::text);
:as_guest
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 1}]'', ''cod'', ''{"points":10}'')', :guest, :bl), 'Sign in');
select t.expect_error('select save_my_profile(''x'', ''9999999999'')', 'permission denied');

\echo '\n== 30. Delivery check + restock alerts =='
:as_guest
select t.eq('same city 1-2 days', (delivery_check('380015', 'Ahmedabad', 'Gujarat'))->>'days', '1-2');
select t.eq('other state 4-7 days', (delivery_check('411001', 'Pune', 'Maharashtra'))->>'days', '4-7');
:as_mahendra
select block_cod_pincode('411001', 'High RTO', true);
:as_guest
select t.eq('COD off for risky pincode', (delivery_check('411001', 'Pune', 'Maharashtra'))->>'cod', 'false');
select t.expect_error(format('select place_web_order(%L, ''[{"variant_id": %s, "qty": 1}]'', ''cod'')', :guest, :bl), 'not available for this pincode');
select save_push_subscription('https://push.example.com/om', 'k2', 'a2');
select request_restock(:bxl, 'https://push.example.com/om');
:as_mahendra
select t.eq('team sees 1 waiting for XL', (select waiting from stock_board where variant_id = :bxl), 1::bigint);
select add_stock(:bxl, 4, 'production');
:as_server
select t.eq('restock push queued', (select count(*) from push_outbox where title = 'Back in stock: Z Basic Tee'), 1::bigint);
select t.eq('team orders also push to phones', (select count(*) > 0 from push_outbox where audience is not null), true);
:as_guest
select t.expect_error('select * from push_outbox', 'permission denied');

\echo '\n== 31. Production batches =='
:as_mahendra
select save_batch(jsonb_build_object('product_id', :p_basic, 'items', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 10)),
  'supplier', 'Tiruppur Blanks', 'blank_cost', 2000, 'print_cost', 600, 'other_cost', 0)) as batch \gset
select set_batch_stage(:batch, 'printing');
select stock_of(:bl) as before_bl \gset
select set_batch_stage(:batch, 'ready');
select t.eq('ready batch adds 10 to stock', stock_of(:bl) - :before_bl, 10);
select t.expect_error(format('select set_batch_stage(%s, ''printing'')', :batch), 'already ready');
:as_aaryak
select t.eq('cost per piece on the batch', (select cost_per_piece from batch_board where id = :batch), 260.00::numeric);
select t.eq('weighted average cost updated', (select cost_price > 220 and cost_price < 260 from products where id = :p_basic), true);
select t.eq('profit per tee calculated', (select profit > 0 from product_profit where product_id = :p_basic), true);
select t.eq('drop report lists the drop', (select count(*) from drop_profit where drop_name = 'Drop 01 · Chrome'), 1::bigint);
select t.eq('monthly report has this month', (select count(*) from monthly_report where month = date_trunc('month', today_ist())), 1::bigint);
:as_mahendra
select t.eq('Mahendra cannot see profit', (select count(*) from product_profit), 0::bigint);

\echo '\n== 32. Daily cash close =='
:as_mahendra
select (cash_day_preview())->>'cash_sales' as cs \gset
select t.expect_error('select close_cash_day(100, 0, null, '''')', 'photo');
select t.expect_error('select close_cash_day(100, 50, null, ''cash/1.jpg'')', 'where the cash');
select close_cash_day((:'cs')::numeric - 20, 0, null, 'cash/1.jpg');
select t.expect_error('select close_cash_day(100, 0, null, ''cash/2.jpg'')', 'already closed');
:as_aaryak
select t.eq('partners told cash is short by 20', (select count(*) from notifications where title = 'Cash short by ₹20.00'), 1::bigint);
:as_server
select t.expect_error('update cash_closes set counted = 0', 'permanent');

\echo '\n== 33. HR: attendance, leave, salary, policy =='
:as_mahendra
select t.expect_error('select punch(''in'', '''', null, null)', 'selfie');
select punch('in', 'hr/in.jpg', 23.03, 72.55);
select t.expect_error('select punch(''in'', ''hr/in2.jpg'', null, null)', 'already checked in');
select punch('out', 'hr/out.jpg', 23.03, 72.55);
select request_leave(today_ist() + 3, today_ist() + 3, 'paid', 'Family function') as lv \gset
select t.expect_error(format('select decide_leave(%s, true)', :lv), 'Only partners');
select t.expect_error(format('select raise_request(''salary_change'', null, ''raise'', null, ''{"member_id":"%s","salary":99999}'')', :'mahendra'), 'Employees can only');
:as_devanshi
select decide_leave(:lv, true);
select raise_request('salary_change', null, 'Mahendra monthly salary', null, jsonb_build_object('member_id', :'mahendra', 'salary', 15000)) as sal \gset
select raise_request('hr_policy', null, 'Shift starts 10:30', null, '{"policy":{"shift_start":"10:30"}}') as pol \gset
select t.expect_error('select raise_request(''hr_policy'', null, ''x'', null, ''{"policy":{"bonus":1}}'')', 'Unknown HR rule');
:as_aaryak
select cast_vote(:sal, 'approve'); select cast_vote(:pol, 'approve');
:as_ayush
select cast_vote(:sal, 'approve'); select cast_vote(:pol, 'approve');
:as_server
select t.eq('salary waits for all 4', (select monthly_salary from employee_pay limit 1), null::numeric);
:as_jigar
select cast_vote(:sal, 'approve'); select cast_vote(:pol, 'approve');
:as_server
select t.eq('salary set after all 4 approve', (select monthly_salary from employee_pay limit 1), 15000.00::numeric);
select t.eq('HR policy changed after all 4 approve', hr_policy()->>'shift_start', '10:30');
select t.eq('other HR rules kept', hr_policy()->>'weekly_off', 'Tuesday');
:as_mahendra
select t.eq('Mahendra sees his own payroll', (select count(*) from hr_payroll(today_ist())), 1::bigint);
select t.eq('payroll uses the approved salary', (select monthly_salary from hr_payroll(today_ist())), 15000.00::numeric);

\echo '\n== 34. Partner voting + ad spend =='
:as_mahendra
select t.expect_error('select raise_request(''decision'', null, ''Open a second store'', null, ''{}'')', 'Employees can only');
:as_aaryak
select raise_request('decision', null, 'Launch Drop 02 in December', null, '{"rule":"majority"}') as dec \gset
:as_ayush
select cast_vote(:dec, 'approve');
:as_server
select t.eq('majority decision needs 3 of 4', (select status::text from requests where id = :dec), 'pending');
:as_jigar
select cast_vote(:dec, 'approve');
:as_server
select t.eq('decision passed with 3 votes', (select status::text from requests where id = :dec), 'approved');
:as_mahendra
select raise_request('expense', 1500, 'Instagram ads · Diwali', 'bills/ads.jpg', '{"category":"ads","campaign":"diwali"}');
:as_aaryak
select t.eq('ad spend tracked by campaign', (select spend from ad_report where campaign = 'diwali'), 1500.00::numeric);
select t.eq('ad campaign linked to orders', (select orders from ad_report where campaign = 'diwali'), 1::bigint);

:as_server
select set_config('zs.internal','off',false);
\o
\echo '\nALL GROWTH RULES PASSED ✅'
