-- =====================================================================
-- Z-SHIRTS · phase 4 test: who sold it, channels, targets, cash counter,
-- blank tees, Mahendra's shift rules (runs after growth_test.sql)
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set guest2 '''{"name":"Kavya Rao","phone":"9833344455","address":{"line1":"7 Park Street","city":"Surat","state":"Gujarat","pincode":"395007"}}'''

:as_server
select id as mahendra from members where email = 'mahendra@example.com' \gset
select id as jigar from members where email = 'jigar@example.com' \gset
select id as aaryak from members where email = 'aaryak@example.com' \gset
select pv.id as bl from product_variants pv join products p on p.id = pv.product_id where p.name = 'Z Basic Tee' and pv.size = 'L' \gset
select id as p_basic from products where name = 'Z Basic Tee' \gset

\echo '\n== 35. Who brought the sale + new channels =='
:as_mahendra
select (staff_create_order('event', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), 'cash', 0, 'Navratri stall', null, :'jigar'))->>'order_no' as ev \gset
:as_server
select t.eq('event sale credited to Jigar', (select sold_by from orders where order_no = :'ev'), :'jigar'::uuid);
select t.eq('event sale is delivered on the spot', (select status from orders where order_no = :'ev'), 'delivered');
:as_mahendra
select (staff_create_order('stall', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'upi'))->>'order_no' as st \gset
:as_server
select t.eq('no name picked: Mahendra gets credit', (select sold_by from orders where order_no = :'st'), :'mahendra'::uuid);
:as_mahendra
select (staff_create_order('referral', '{"name":"Om","phone":"9822233344","address":{"line1":"1 Road","city":"Pune","state":"Maharashtra","pincode":"411002"}}',
  jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'upi', 0, null, null, null, 'Rahul (friend)'))->>'order_no' as rf \gset
:as_server
select t.eq('outside seller name kept', (select sold_by_name from orders where order_no = :'rf'), 'Rahul (friend)');
:as_mahendra
select t.expect_error(format('select staff_create_order(''event'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cod'')', :bl), 'cash or UPI');
select t.expect_error(format('select staff_create_order(''website'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''upi'')', :bl), 'where this sale');
:as_aaryak
select save_coupon(jsonb_build_object('code', 'AARYAK10', 'kind', 'percent', 'value', 10, 'member_id', :'aaryak', 'per_customer_limit', 3));
:as_guest
select (place_web_order(:guest2, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod', '{"coupon":"AARYAK10"}'))->>'order_no' as wr \gset
:as_server
select t.eq('partner code makes it a referral order', (select channel from orders where order_no = :'wr'), 'referral');
select t.eq('partner code credits the partner', (select sold_by from orders where order_no = :'wr'), :'aaryak'::uuid);
:as_guest
select (place_web_order(:guest2, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod', '{"source":"app"}'))->>'order_no' as ap \gset
:as_server
select t.eq('installed shop app orders show as App', (select channel from orders where order_no = :'ap'), 'app');
:as_guest
select (place_web_order(:guest2, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod', '{"coupon":"ROHAN10"}'))->>'order_no' as inf \gset
:as_server
select t.eq('influencer code makes it an influencer order', (select channel from orders where order_no = :'inf'), 'influencer');

\echo '\n== 36. Monthly targets =='
:as_mahendra
select t.expect_error(format('select set_target(%L, null, 100, 50000)', today_ist()), 'Only partners');
:as_aaryak
select set_target(today_ist(), null, 300, 200000);
select set_target(today_ist(), :'jigar', 50, 30000);
select set_target(today_ist(), :'jigar', 60, 35000);
select t.eq('target updated, not duplicated', (select count(*) from sales_targets where member_id = :'jigar'), 1::bigint);
:as_mahendra
select t.eq('Mahendra sees the business milestone', (select target_pcs from target_progress(null) where member_id is null), 300);
select t.eq('Jigar has 2 pieces this month', (select pcs from target_progress(null) where member_id = :'jigar'), 2::bigint);
select t.eq('Aaryak got his referral piece', (select pcs from target_progress(null) where member_id = :'aaryak') >= 1, true);

\echo '\n== 37. Cash counter =='
:as_server
-- the growth test already closed today; reopen it for this test only
alter table cash_closes disable trigger user;
delete from cash_closes where day = today_ist();
alter table cash_closes enable trigger user;
:as_aaryak
select (cash_day_preview(null))->>'expected' as exp0 \gset
:as_mahendra
select t.expect_error(format('select cash_handover(100, %L)', :'mahendra'), 'partner who took');
select t.expect_error(format('select cash_handover(99999999, %L)', :'jigar'), 'more cash than the store');
select cash_handover(500, :'jigar', 'Weekly collection');
select t.eq('Mahendra sees only his own handover', (select count(*) from cash_moves), 1::bigint);
select t.eq('Mahendra cannot see what partners collected', (select count(*) from cash_with_partners), 0::bigint);
:as_aaryak
select t.expect_error(format('select cash_handover(100, %L)', :'jigar'), 'Record only the cash you took yourself');
select cash_handover(200, :'aaryak', 'For courier payment');
select t.eq('drawer goes down only by handovers', (:'exp0')::numeric - ((cash_day_preview(null))->>'expected')::numeric, 700::numeric);
select t.eq('Jigar holds ₹500 from the store', (select collected from cash_with_partners where partner_id = :'jigar'), 500::numeric);
select t.eq('partners told who took the cash', (select count(*) from notifications where title like 'Jigar Panchal took ₹500 cash%'), 1::bigint);
:as_server
select t.expect_error('delete from cash_moves', 'not allowed');

\echo '\n== 38. Blank tees =='
:as_mahendra
select add_blanks('black', '#000000', 'L', 40, 'purchase', 6000, 'Tiruppur') as bk \gset
select t.eq('40 blank black L in stock', :bk, 40);
select save_batch(jsonb_build_object('product_id', :p_basic, 'items', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 15)))) as b2 \gset
select set_batch_stage(:b2, 'printing');
select t.eq('printing uses 15 blanks', (select qty from blank_stock where colour = 'Black' and size = 'L'), 25);
select set_batch_stage(:b2, 'ready');
select t.eq('blanks not taken twice', (select qty from blank_stock where colour = 'Black' and size = 'L'), 25);
select add_blanks('Black', '#000000', 'L', 2, 'damaged', null, 'Stain');
select t.eq('damaged blanks go out', (select qty from blank_stock where colour = 'Black' and size = 'L'), 23);
select t.eq('stock history shows the batch', (select count(*) > 0 from stock_history where variant_id = :bl and reason = 'production'), true);

\echo '\n== 39. Mahendra''s shift rules =='
:as_server
select t.eq('shift ends 21:00 with 30-min lunch', (hr_policy()->>'shift_end') || '/' || (hr_policy()->>'lunch_min'), '21:00/30');
:as_mahendra
select t.expect_error(format('select request_leave(%L, %L, ''half_day'', ''doctor'')', today_ist() + 9, today_ist() + 9), 'Half days are not allowed');
select request_leave((date_trunc('month', today_ist()) + interval '1 month 4 days')::date, (date_trunc('month', today_ist()) + interval '1 month 4 days')::date, 'paid', 'Family function');
select t.expect_error(format('select request_leave(%L, %L, ''paid'', ''trip'')', (date_trunc('month', today_ist()) + interval '1 month 9 days')::date, (date_trunc('month', today_ist()) + interval '1 month 9 days')::date), 'Only 1 paid leave a month');
select t.expect_error('select punch(''lunch_in'', null, null, null)', 'Start lunch first');

\o
\echo '\nALL PEOPLE RULES PASSED ✅'

\o /dev/null
\echo '\n== 40. Welcome, moments, demand =='
:as_aaryak
select t.eq('first login not welcomed yet', (my_welcome())->>'welcomed_at', null::text);
select t.eq('welcome knows his investment', ((my_welcome())->>'capital')::numeric > 0, true);
select mark_welcomed();
select t.eq('welcome shown only once', (my_welcome())->>'welcomed_at' is not null, true);
:as_mahendra
select (staff_create_order('store', '{"name":"Zoya","phone":"9877700011"}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cash'))->>'id' as zo \gset
:as_server
select t.eq('offline sale is its own moment', (select kind from notifications where order_id = :zo and kind in ('sale', 'order') limit 1), 'sale');
select t.eq('new customer moment', (select count(*) from notifications where order_id = :zo and kind = 'client'), 1::bigint);
:as_mahendra
select (staff_create_order('store', '{"name":"Zoya","phone":"9877700011"}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cash'))->>'id' as zo2 \gset
:as_server
select t.eq('repeat customer is not new', (select count(*) from notifications where order_id = :zo2 and kind = 'client'), 0::bigint);
select id as ship_id from orders where status = 'confirmed' limit 1 \gset
:as_mahendra
select set_order_status(:ship_id, 'packed');
select set_order_status(:ship_id, 'shipped', null, 'Delhivery', 'D9');
:as_server
select t.eq('dispatch moment', (select count(*) from notifications where order_id = :ship_id and kind = 'dispatch'), 1::bigint);
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Launch Test Tee', 'mrp', 999, 'price', 799, 'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'size', 'M'))));
select t.eq('new product launch moment', (select count(*) from notifications where kind = 'launch' and title like '%Launch Test Tee'), 1::bigint);
:as_mahendra
select t.eq('best seller of the week', (demand_report(7))->'products'->0->>'name', 'Z Basic Tee');
select t.eq('black is the colour in demand', (demand_report(30))->'colours'->0->>'name', 'Black');
:as_guest
select t.expect_error('select demand_report(7)', 'permission denied');
\o
\echo '\nALL WELCOME + DEMAND RULES PASSED ✅'
