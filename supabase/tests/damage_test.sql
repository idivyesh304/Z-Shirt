-- Z-SHIRTS · phase 8 test: damaged goods → vendor claims, overtime, paid leave, delete product
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
:as_server
select id as mahendra from members where email = 'mahendra@example.com' \gset
select id as p_basic from products where name = 'Z Basic Tee' \gset
select pv.id as bl from product_variants pv where pv.product_id = :p_basic and pv.size = 'L' \gset

\echo '\n== 50. Damaged DTF prints, blanks and printed tees =='
:as_mahendra
select coalesce(sum(qty), 0) as dtf0 from dtf_moves where product_id = :p_basic \gset
select stock_of(:bl) as tee0 \gset
select add_blanks('White', '#ffffff', 'M', 20, 'purchase', 2400, 'Tiruppur Knits');
select t.expect_error(format('select report_damage(%L)', jsonb_build_object('item', 'dtf', 'product_id', :p_basic, 'qty', 2, 'vendor', 'PrintHub', 'ask', 'replace', 'reason', 'Peeling print')), 'at least one photo');
select t.expect_error(format('select report_damage(%L)', jsonb_build_object('item', 'dtf', 'product_id', :p_basic, 'qty', 99999, 'vendor', 'PrintHub', 'ask', 'replace', 'reason', 'Peeling', 'photos', '["a.jpg"]'::jsonb)), 'in stock');
select report_damage(jsonb_build_object('item', 'dtf', 'product_id', :p_basic, 'qty', 3, 'vendor', 'PrintHub', 'ask', 'replace', 'reason', 'Print peeling off', 'photos', '["m/d1.jpg","m/d2.jpg"]'::jsonb)) as c1 \gset
select t.eq('damaged DTF prints leave stock', (select coalesce(sum(qty), 0) from dtf_moves where product_id = :p_basic), (:dtf0 - 3)::bigint);
select t.eq('claim value from DTF cost (₹30 × 3)', (select value from damage_claims where id = :c1), 90.00::numeric);
select report_damage(jsonb_build_object('item', 'blank', 'colour', 'white', 'size', 'm', 'qty', 4, 'vendor', 'Tiruppur Knits', 'ask', 'return', 'reason', 'Holes in fabric', 'photos', '["m/b1.jpg"]'::jsonb)) as c2 \gset
select t.eq('damaged blanks leave stock', (select qty from blank_stock where colour = 'White' and size = 'M'), 16);
select t.eq('blank value at ₹120 a piece', (select value from damage_claims where id = :c2), 480.00::numeric);
select report_damage(jsonb_build_object('item', 'tee', 'variant_id', :bl, 'qty', 1, 'vendor', 'Tiruppur Knits', 'ask', 'refund', 'reason', 'Shrunk after wash', 'photos', '["m/t1.jpg"]'::jsonb)) as c3 \gset
select t.eq('damaged printed tee leaves sellable stock', stock_of(:bl), :tee0 - 1);
:as_aaryak
select t.eq('partners told with the value', (select count(*) from notifications where title like 'Damaged: 3 × %'), 1::bigint);
:as_mahendra
select t.eq('board shows what and who', (select reported_by_name || ' · ' || item_label from damage_board where id = :c2), 'Mahendra Sisodiya · Blank tee');

\echo '\n== 51. Vendor replaces, refunds or refuses =='
select damage_update(:c1, 'sent', 0, 0, 'Handed to PrintHub delivery boy');
select t.expect_error(format('select damage_update(%s, ''sent'')', :c1), 'already sent');
select damage_update(:c1, 'settle', 3);
select t.eq('replaced prints come back into DTF stock', (select coalesce(sum(qty), 0) from dtf_moves where product_id = :p_basic), :dtf0::bigint);
select t.eq('claim marked replaced', (select status from damage_claims where id = :c1), 'replaced');
select t.expect_error(format('select damage_update(%s, ''settle'', 0, 480)', :c2), 'photo of the refund');
select damage_update(:c2, 'settle', 0, 480, 'UPI received', 'm/refund.jpg');
select t.eq('refund goes for partner approval as income', (select type::text || ' ' || amount from requests where id = (select refund_request from damage_claims where id = :c2)), 'income 480.00');
select t.eq('refund category is vendor refund', (select payload->>'category' from requests where id = (select refund_request from damage_claims where id = :c2)), 'vendor_refund');
select t.expect_error(format('select damage_update(%s, ''rejected'', 0, 0, '''')', :c3), 'what the vendor said');
select damage_update(:c3, 'rejected', 0, 0, 'Vendor says washed wrong');
select t.eq('refused claim stays out of stock', stock_of(:bl), :tee0 - 1);
select report_damage(jsonb_build_object('item', 'tee', 'variant_id', :bl, 'qty', 1, 'vendor', 'X', 'ask', 'replace', 'reason', 'Oops wrong tee', 'photos', '["m/x.jpg"]'::jsonb)) as c4 \gset
select damage_update(:c4, 'cancel');
select t.eq('cancelled claim puts the piece back', stock_of(:bl), :tee0 - 1);
:as_guest
select t.expect_error(format('select report_damage(%L)', '{}'), 'permission denied');
:as_server
select t.expect_error('delete from damage_claims', 'permanent');
\o
\echo '\nALL DAMAGE CLAIM RULES PASSED ✅'

\o /dev/null
\echo '\n== 52. Overtime at the hourly rate, 1 paid leave =='
:as_server
alter table employee_pay disable trigger user;
insert into employee_pay (member_id, monthly_salary) values (:'mahendra', 20000) on conflict (member_id) do update set monthly_salary = 20000;
alter table employee_pay enable trigger user;
alter table attendance disable trigger user;
delete from attendance where member_id = :'mahendra' and day = today_ist() - 1;
insert into attendance (member_id, day, in_at, out_at) values (:'mahendra', today_ist() - 1,
  ((today_ist() - 1) + time '10:00') at time zone 'Asia/Kolkata', ((today_ist() - 1) + time '23:00') at time zone 'Asia/Kolkata');
alter table attendance enable trigger user;
:as_aaryak
select t.eq('day rate = 20000 ÷ 30', (select per_day from hr_payroll(today_ist() - 1)), 666.67::numeric);
select t.eq('hourly rate = day rate ÷ 10', (select per_hour from hr_payroll(today_ist() - 1)), 66.67::numeric);
select t.eq('2 hours after 9 PM paid at the hourly rate', (select ot_hours || ' h = ' || ot_pay from hr_payroll(today_ist() - 1)), '2.00 h = 133');
\o
\echo '\nALL OVERTIME RULES PASSED ✅'

\o /dev/null
\echo '\n== 53. Delete a product =='
:as_aaryak
select upsert_product(jsonb_build_object('name', 'Mistake Tee', 'mrp', 999, 'price', 799, 'variants', jsonb_build_array(jsonb_build_object('colour', 'Black', 'size', 'M')))) as mt \gset
select publish_product(:mt);
:as_mahendra
select t.expect_error(format('select delete_product(%s)', :mt), 'Only partners');
:as_aaryak
select delete_product(:mt, 'Added by mistake');
select t.eq('deleted product gone from stock', (select count(*) from stock_board where product_id = :mt), 0::bigint);
:as_guest
select t.eq('deleted product gone from the shop', (select count(*) from catalog where id = :mt), 0::bigint);
:as_aaryak
select t.expect_error(format('select publish_product(%s)', :mt), 'Restore it first');
select t.eq('history kept for restore', (select count(*) from products where id = :mt and deleted_at is not null), 1::bigint);
select restore_product(:mt);
select t.eq('restored as a draft', (select count(*) from stock_board where product_id = :mt and not published), 1::bigint);
\o
\echo '\nALL DELETE PRODUCT RULES PASSED ✅'
