-- Z-SHIRTS · phase 6 test: DTF stock, store day, petty cash, finance statement
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
:as_server
select id as mahendra from members where email = 'mahendra@example.com' \gset
select id as p_basic from products where name = 'Z Basic Tee' \gset
select pv.id as bl from product_variants pv where pv.product_id = :p_basic and pv.size = 'L' \gset

\echo '\n== 41. DTF prints =='
:as_mahendra
select add_dtf(:p_basic, 30, 'purchase', 900, 'DTF vendor') as d1 \gset
select t.eq('30 DTF prints in stock', :d1, 30);
select save_batch(jsonb_build_object('product_id', :p_basic, 'items', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 12)))) as b3 \gset
select set_batch_stage(:b3, 'printing');
select t.eq('printing uses 12 DTF prints', (select qty from dtf_stock where product_id = :p_basic), 18);
select t.eq('DTF cost per print', (select cost_per_print from dtf_stock where product_id = :p_basic), 30.00::numeric);

\echo '\n== 42. Store day =='
:as_mahendra
select store_open('All good');
select t.expect_error('select store_open()', 'already open');
select t.eq('Mahendra sees opening time', (select opened_at is not null from store_register(3) where day = today_ist()), true);
select t.eq('Mahendra does not see money', (select opening from store_register(3) where day = today_ist()), null::numeric);
:as_aaryak
select t.eq('partners see cash sales', (select cash_sales > 0 from store_register(3) where day = today_ist()), true);

\echo '\n== 43. Petty cash =='
:as_mahendra
select t.expect_error(format('select petty_topup(%L, 1000)', :'mahendra'), 'Only partners');
select t.expect_error('select petty_spend(100, ''Tape'', ''packaging'', ''p/1.jpg'')', 'Not enough petty cash');
:as_aaryak
select petty_topup(:'mahendra', 1500, 'For packing material');
:as_mahendra
select t.expect_error('select petty_spend(100, ''Tape'', ''packaging'', '''')', 'photo of the bill');
select petty_spend(250, 'Packing tape and bags', 'packaging', 'p/1.jpg') as left1 \gset
select t.eq('petty cash left 1250', (:'left1')::numeric, 1250::numeric);
:as_aaryak
select t.eq('petty spend lands in the books as an expense', (select count(*) from ledger where description like 'Packing tape and bags (petty cash)%' and category = 'packaging'), 1::bigint);
select t.eq('partners see petty balance', (select balance from petty_board where holder = :'mahendra'), 1250::numeric);

\echo '\n== 44. Finance statement =='
:as_mahendra
select t.expect_error(format('select finance_statement(%L, %L)', date_trunc('month', today_ist())::date, today_ist() + 1), 'Partners only');
:as_aaryak
select finance_statement(date_trunc('month', today_ist())::date, (date_trunc('month', today_ist()) + interval '1 month')::date) as fs \gset
select t.eq('GST is taken out of sales', round(((:'fs')::jsonb->>'output_gst')::numeric / (((:'fs')::jsonb->>'gross_sales')::numeric - ((:'fs')::jsonb->>'refunds')::numeric), 3), round(5.0 / 105, 3));
select t.eq('gross profit = revenue - cost of goods', ((:'fs')::jsonb->>'gross_profit')::numeric, ((:'fs')::jsonb->>'revenue')::numeric - ((:'fs')::jsonb->>'cogs')::numeric);
select t.eq('EBITDA = gross profit - operating costs', ((:'fs')::jsonb->>'ebitda')::numeric, ((:'fs')::jsonb->>'gross_profit')::numeric - ((:'fs')::jsonb->>'opex')::numeric);
select t.eq('PAT = PBT - tax', ((:'fs')::jsonb->>'pat')::numeric, ((:'fs')::jsonb->>'pbt')::numeric - ((:'fs')::jsonb->>'tax')::numeric);
select t.eq('no tax on a loss', (((:'fs')::jsonb->>'pbt')::numeric >= 0 or ((:'fs')::jsonb->>'tax')::numeric = 0), true);
\o
\echo '\nALL FINANCE RULES PASSED ✅'

\o /dev/null
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
:as_server
select id as aaryak from members where email = 'aaryak@example.com' \gset
:as_mahendra
select add_stock(:bl, 60, 'production');

\echo '\n== 45. Settings: partners change everything, protected rules need all =='
:as_mahendra
select t.expect_error('select update_setting(''shipping_fee'', ''49'')', 'Only partners');
:as_aaryak
select update_setting('shipping_fee', '49');
select t.eq('partner changed delivery charge directly', setting_num('shipping_fee'), 49::numeric);
select t.eq('change is in the change log', (select count(*) from change_log where table_name = 'settings' and row_ref = 'shipping_fee') > 0, true);
select t.eq('partners are told who changed it', (select count(*) from notifications where title = 'Aaryak Patel changed a setting'), 1::bigint);
select t.expect_error('select update_setting(''discount_free_pct'', ''20'')', 'all of them must approve');
select update_setting('shipping_fee', '0');

\echo '\n== 46. GST slabs + HSN =='
:as_server
select t.eq('cotton tee gets HSN 61091000', (select hsn_code from products where id = :p_basic), '61091000');
select t.eq('₹2,500 tee is 5%', gst_rate_for(2500), 5::numeric);
select t.eq('₹2,501 tee is 18%', gst_rate_for(2501), 18::numeric);
:as_aaryak
select set_product_tax(:p_basic, 'synthetic');
select t.eq('synthetic tee gets HSN 610990', (select hsn_code from products where id = :p_basic), '610990');
select set_product_tax(:p_basic, 'cotton');
:as_mahendra
select (staff_create_order('store', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cash'))->>'id' as gq \gset
:as_server
select t.eq('bill line carries GST rate and HSN', (select gst_rate || '/' || hsn_code from order_items where order_id = :gq), '5.00/61091000');

\echo '\n== 47. Cost sheet + per-tee finance + partner finance inputs =='
:as_mahendra
select t.expect_error(format('select save_product_costs(%s, ''{"blank":100}'')', :p_basic), 'Only partners');
:as_aaryak
select save_product_costs(:p_basic, '{"blank":120,"dtf":40,"printing":15,"packing":12,"tag_label":3}') as cp \gset
select t.eq('cost price = sum of the cost sheet', (:'cp')::numeric, 190::numeric);
select save_finance_input(jsonb_build_object('month', today_ist(), 'kind', 'depreciation', 'amount', 1000, 'note', 'Heat press 36 months')) as fi \gset
select save_finance_input(jsonb_build_object('id', :fi, 'month', today_ist(), 'kind', 'depreciation', 'amount', 1200, 'note', 'Heat press 36 months')) ;
select t.eq('partner edited a finance input', (select amount from finance_inputs where id = :fi), 1200.00::numeric);
select t.eq('edit is logged', (select count(*) from change_log where table_name = 'finance_inputs' and action = 'UPDATE'), 1::bigint);
select finance_statement(date_trunc('month', today_ist())::date, (date_trunc('month', today_ist()) + interval '1 month')::date) as fs2 \gset
select t.eq('depreciation input lowers EBIT', ((:'fs2')::jsonb->>'depreciation')::numeric >= 1200, true);
select t.eq('per-tee finance lists the basic tee', (select count(*) from product_finance(date_trunc('month', today_ist())::date, (date_trunc('month', today_ist()) + interval '1 month')::date) where name = 'Z Basic Tee'), 1::bigint);
:as_mahendra
select t.expect_error('select * from product_finance(current_date, current_date + 1)', 'Partners only');

\echo '\n== 48. Daily / weekly / monthly targets =='
:as_aaryak
select set_standing_target(:'mahendra', 'day', 5, 2500);
select set_standing_target(:'mahendra', 'week', 30, 15000);
select set_standing_target(null, 'day', 20, 10000);
:as_mahendra
select t.eq('Mahendra sees his daily target', (select target_pcs from target_now('day') where member_id = :'mahendra'), 5);
select t.eq('weekly target', (select target_pcs from target_now('week') where member_id = :'mahendra'), 30);
select t.eq('business daily target', (select target_pcs from target_now('day') where member_id is null), 20);
select t.expect_error(format('select set_standing_target(%L, ''day'', 1, 1)', :'mahendra'), 'Only partners');

\echo '\n== 49. Partner discount above 10% =='
:as_mahendra
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cash'', 15)', :bl), 'at most 10');
:as_aaryak
select (staff_create_order('store', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 2)), 'cash', 20))->>'order_no' as d1o \gset
:as_server
select t.eq('10% above the free limit charged to Aaryak (₹998 × 10%)', (select -amount from ledger where kind = 'partner_payout' and description like 'Charged to Aaryak Patel%' || :'d1o'), 100.00::numeric);
select t.eq('business gets it back as income', (select amount from ledger where kind = 'income' and description like '%' || :'d1o' || ' borne by Aaryak Patel'), 100.00::numeric);
:as_aaryak
select raise_request('discount', null, 'Bulk order 30 tees for a college fest', null, '{"pct":20,"pieces":30}') as dr \gset
select t.eq('needs all 4 partners', (select required_approvals from requests where id = :dr), 4);
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cash'', 20, null, null, null, null, %s)', :bl, :dr), 'not valid');
:as_ayush
select cast_vote(:dr, 'approve');
:as_jigar
select cast_vote(:dr, 'approve');
:as_devanshi
select cast_vote(:dr, 'approve');
:as_aaryak
select (staff_create_order('store', '{}', jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 30)), 'cash', 20, null, null, null, null, :dr))->>'order_no' as d2o \gset
:as_server
select t.eq('approved bulk discount: nothing charged to Aaryak', (select count(*) from ledger where kind = 'partner_payout' and description like '%' || :'d2o'), 0::bigint);
:as_aaryak
select t.expect_error(format('select staff_create_order(''store'', ''{}'', ''[{"variant_id": %s, "qty": 1}]'', ''cash'', 20, null, null, null, null, %s)', :bl, :dr), 'already used');
\o
\echo '\nALL SETTINGS + DISCOUNT RULES PASSED ✅'
