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
