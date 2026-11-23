-- SINDIICAT · phase 9 test: vendors, purchase orders, GST, approvals, receiving
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
:as_server
select id as p_basic from products where name = 'Z Basic Tee' \gset

\echo '\n== 54. Vendors with codes and GSTIN checks =='
:as_mahendra
select t.expect_error('select save_vendor(''{"category":"plain","name":"Bad GST","phone":"9876543210","gstin":"24AAACZ1234A1Z9"}'')', 'not valid');
select (save_vendor('{"category":"plain","name":"Shree Knit Fab","phone":"9876543210","gstin":"24AAACZ1234A1Z1","city":"Ahmedabad"}'::jsonb))->>'id' as v_local \gset
select (save_vendor('{"category":"dtf","name":"PrintHub Mumbai","phone":"9822233344","gstin":"27ABCDE1234F1Z0"}'::jsonb))->>'id' as v_out \gset
select (save_vendor('{"category":"plain","name":"Local Tailor","phone":"9811122233","state_code":"24"}'::jsonb))->>'id' as v_unreg \gset
select t.eq('vendor code by category', (select code from vendors where id = :v_local), 'SV-PT-001');
select t.eq('second plain vendor gets the next number', (select code from vendors where id = :v_unreg), 'SV-PT-002');
select t.eq('DTF vendor code', (select code from vendors where id = :v_out), 'SV-DTF-001');
select t.eq('state and PAN read from the GSTIN', (select state_code || ' ' || pan from vendors where id = :v_out), '27 ABCDE1234F');
select t.expect_error('select save_vendor(''{"category":"plain","name":"Dup","phone":"9876543210","gstin":"24AAACZ1234A1Z1"}'')', 'already exists');

\echo '\n== 55. GST on the PO =='
select (save_po(jsonb_build_object('po_type', 'plain', 'vendor_id', :v_local, 'delivery_date', today_ist() + 10, 'freight', 200,
  'terms', '["Quote the PO number","Match the swatch"]'::jsonb,
  'items', jsonb_build_array(
    jsonb_build_object('description', 'Oversized tee 240 GSM · Black · L', 'hsn', '61091000', 'qty', 50, 'rate', 180, 'gst_rate', 5, 'colour', 'black', 'colour_hex', '#000000', 'size', 'l'),
    jsonb_build_object('description', 'Oversized tee 240 GSM · Black · XL', 'hsn', '61091000', 'qty', 30, 'rate', 190, 'gst_rate', 5, 'disc_pct', 10, 'colour', 'black', 'colour_hex', '#000000', 'size', 'xl')
  )))) as po1 \gset
select (:'po1'::jsonb)->>'id' as po1_id \gset
-- 50×180 = 9000; 30×190 = 5700 − 10% = 5130; taxable 14130; GST 5% = 706.50; freight 200 + 18% = 36; total 15072.50 → 15073
select t.eq('same state: CGST + SGST', (select tax_mode from purchase_orders where id = :po1_id), 'cgst_sgst');
select t.eq('taxable after discount', (select taxable from purchase_orders where id = :po1_id), 14130.00::numeric);
select t.eq('CGST and SGST split half-half', (select cgst || '/' || sgst from purchase_orders where id = :po1_id), '371.25/371.25');
select t.eq('grand total rounded', (select grand_total || ' ' || round_off from purchase_orders where id = :po1_id), '15073.00 0.50');
select t.eq('PO number by financial year', (select po_no ~ '^SC/PO/[0-9]{2}-[0-9]{2}/0001$' from purchase_orders where id = :po1_id), true);
select t.expect_error(format('select save_po(%L)', jsonb_build_object('po_type', 'plain', 'vendor_id', :v_local, 'terms', '[]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('description', 'Tee', 'qty', 1, 'rate', 100)))), 'Tick at least one');
:as_aaryak
select (save_po(jsonb_build_object('po_type', 'dtf', 'vendor_id', :v_out, 'terms', '["Original inks"]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('description', 'DTF A3 front · Z Basic', 'hsn', '4908', 'qty', 100, 'rate', 40, 'gst_rate', 18, 'product_id', :p_basic)))))->>'id' as po2 \gset
select t.eq('other state: IGST', (select tax_mode || ' ' || igst from purchase_orders where id = :po2), 'igst 720.00');
select (save_po(jsonb_build_object('po_type', 'other', 'vendor_id', :v_unreg, 'terms', '["As agreed"]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('description', 'Alteration', 'qty', 10, 'rate', 50, 'gst_rate', 18)))))->>'id' as po3 \gset
select t.eq('unregistered vendor: no GST', (select tax_mode || ' ' || grand_total from purchase_orders where id = :po3), 'none 500.00');

\echo '\n== 56. Approvals: partner needs 3 others, Mahendra needs all 4 =='
select submit_po(:po2);
select t.eq('partner PO waits for the other 3', (select required_approvals || '/' || jsonb_array_length(votes) from po_board where id = :po2), '4/1');
:as_ayush
select cast_vote((select request_id from purchase_orders where id = :po2), 'approve');
:as_jigar
select cast_vote((select request_id from purchase_orders where id = :po2), 'approve');
:as_server
select t.eq('still pending after 2 of 3', (select status from purchase_orders where id = :po2), 'pending');
:as_devanshi
select cast_vote((select request_id from purchase_orders where id = :po2), 'approve');
:as_server
select t.eq('approved after the other 3 partners', (select status from purchase_orders where id = :po2), 'approved');
:as_mahendra
select submit_po(:po1_id);
select t.expect_error(format('select save_po(%L)', jsonb_build_object('id', :po1_id, 'po_type', 'plain', 'vendor_id', :v_local, 'terms', '["x"]'::jsonb,
  'items', jsonb_build_array(jsonb_build_object('description', 'Tee', 'qty', 1, 'rate', 100)))), 'Only a draft');
:as_aaryak
select cast_vote((select request_id from purchase_orders where id = :po1_id), 'approve');
:as_ayush
select cast_vote((select request_id from purchase_orders where id = :po1_id), 'approve');
:as_jigar
select cast_vote((select request_id from purchase_orders where id = :po1_id), 'approve');
:as_server
select t.eq('Mahendra''s PO not approved with 3', (select status from purchase_orders where id = :po1_id), 'pending');
:as_devanshi
select cast_vote((select request_id from purchase_orders where id = :po1_id), 'approve');
:as_server
select t.eq('Mahendra''s PO approved with all 4', (select status from purchase_orders where id = :po1_id), 'approved');
:as_aaryak
select submit_po(:po3);
:as_ayush
select cast_vote((select request_id from purchase_orders where id = :po3), 'reject', 'Too costly');
:as_server
select t.eq('one partner saying no rejects the PO', (select status from purchase_orders where id = :po3), 'rejected');

\echo '\n== 57. Sent and received into stock =='
:as_mahendra
select po_action(:po1_id, 'sent');
select coalesce((select qty from blank_stock where colour = 'Black' and size = 'L'), 0) as bl0 \gset
select po_action(:po1_id, 'receive', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', case when line_no = 1 then 50 else 10 end)) from po_items where po_id = :po1_id));
select t.eq('partly received', (select status from purchase_orders where id = :po1_id), 'partly_received');
select t.eq('received tees go into blank stock', (select qty from blank_stock where colour = 'Black' and size = 'L'), :bl0 + 50);
select t.expect_error(format('select po_action(%s, ''receive'', null, %L)', :po1_id, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 999)) from po_items where po_id = :po1_id and line_no = 2)), 'left to receive');
select po_action(:po1_id, 'receive', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 20)) from po_items where po_id = :po1_id and line_no = 2));
select t.eq('fully received', (select status from purchase_orders where id = :po1_id), 'received');
select t.expect_error(format('select po_action(%s, ''cancel'', ''oops'')', :po2), 'Only partners');
:as_server
select coalesce(sum(qty), 0) as dtf0 from dtf_moves where product_id = :p_basic \gset
:as_aaryak
select po_action(:po2, 'receive', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 100)) from po_items where po_id = :po2));
:as_server
select t.eq('received DTF prints go into DTF stock', (select coalesce(sum(qty), 0) from dtf_moves where product_id = :p_basic), (:dtf0 + 100)::bigint);
select t.expect_error('delete from purchase_orders', 'not allowed');
:as_guest
select t.expect_error('select save_vendor(''{}'')', 'permission denied');
\o
\echo '\nALL PURCHASE ORDER RULES PASSED ✅'
