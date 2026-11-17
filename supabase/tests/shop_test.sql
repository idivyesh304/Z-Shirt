-- Z-SHIRTS · phase 10 test: wishlist, addresses, reviews, offers, prepaid / COD pricing
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_neha     'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''neha@gmail.com''), false); set role authenticated;'
\set as_karan    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''karan@gmail.com''), false); set role authenticated;'
\set as_guest    'reset role; select set_config(''request.jwt.claim.sub'', '''', false); set role anon;'
\set as_server   'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'
\set guest '''{"name":"Ria Shah","phone":"9844455566","address":{"line1":"12 CG Road","city":"Ahmedabad","state":"Gujarat","pincode":"380009"}}'''
:as_server
select id as p_basic from products where name = 'Z Basic Tee' \gset
select pv.id as bl from product_variants pv where pv.product_id = :p_basic and pv.size = 'L' \gset

\echo '\n== 58. Wishlist and saved addresses =='
:as_neha
select t.eq('heart a tee', toggle_wishlist(:p_basic), true);
select t.eq('it is in the wishlist', (my_wishlist())[1], :p_basic::bigint);
select t.eq('tap again removes it', toggle_wishlist(:p_basic), false);
select t.eq('guest wishlist merges on sign-in', cardinality(merge_wishlist(array[:p_basic, 999999]::bigint[])), 1);
select t.eq('first address becomes default', ((save_address('{"label":"Home","name":"Neha Joshi","phone":"9811122233","line1":"4 Lake View","city":"Ahmedabad","state":"Gujarat","pincode":"380015"}'::jsonb))->0->>'is_default'), 'true');
select t.expect_error('select save_address(''{"name":"N","phone":"1","line1":"x","city":"y","state":"z","pincode":"12"}'')', 'Enter the name');
select save_address('{"label":"Work","name":"Neha Joshi","phone":"9811122233","line1":"Titanium Park","city":"Ahmedabad","state":"Gujarat","pincode":"380051","is_default":true}'::jsonb);
select t.eq('new default moves to the top', (my_addresses())->0->>'label', 'Work');
select t.eq('account carries addresses and wishlist', jsonb_array_length((my_account())->'addresses') || '/' || jsonb_array_length((my_account())->'wishlist'), '2/1');
:as_karan
select t.eq('others cannot see Neha''s addresses', my_addresses(), '[]'::jsonb);
:as_guest
select t.expect_error('select my_wishlist()', 'permission denied');

\echo '\n== 59. Reviews only from buyers =='
:as_neha
select t.expect_error(format('select add_review(%L)', jsonb_build_object('product_id', :p_basic, 'rating', 9)), 'Tap the stars');
select add_review(jsonb_build_object('product_id', :p_basic, 'rating', 5, 'title', 'Perfect oversized fit', 'body', 'Thick fabric, no shrink.', 'fit', 'true'));
select add_review(jsonb_build_object('product_id', :p_basic, 'rating', 4, 'title', 'Still great', 'fit', 'large'));
:as_guest
select t.eq('one review per buyer (edited, not doubled)', (select count(*) from public_reviews where product_id = :p_basic), 1::bigint);
select t.eq('shows first name + initial and verified', (select author || ' ' || verified from public_reviews where product_id = :p_basic), 'Neha J. true');
select t.eq('catalogue shows the rating', (select rating || '/' || rating_count || '/' || fit_large from catalog where id = :p_basic), '4.0/1/1');
:as_karan
select save_my_profile('Karan Mehta', '9877766655');
select t.expect_error(format('select add_review(%L)', jsonb_build_object('product_id', :p_basic, 'rating', 1)), 'once it has been delivered');
:as_aaryak
select set_review_status((select id from product_reviews where product_id = :p_basic), 'hidden');
:as_guest
select t.eq('partner can hide a review', (select count(*) from public_reviews where product_id = :p_basic), 0::bigint);

\echo '\n== 60. Indian checkout: prepaid offer and COD fee =='
:as_server
alter table settings disable trigger user;
update settings set value = '5' where key = 'prepaid_discount_pct';
update settings set value = '40' where key = 'prepaid_discount_max';
update settings set value = '49' where key = 'cod_fee';
alter table settings enable trigger user;
:as_guest
select (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"pay":"online"}'))->>'total' as t_on \gset
select (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), '{"pay":"cod"}'))->>'total' as t_cod \gset
select (quote_cart(jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1))))->>'prepaid_offer' as offer \gset
select t.eq('5% off online, capped at ₹40 (₹499 → 25)', :'offer'::numeric, 25::numeric);
select t.eq('COD costs ₹49 + ₹25 more than paying online', :'t_cod'::numeric - :'t_on'::numeric, 74::numeric);
select (place_web_order(:guest, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'cod'))->>'total' as cod_total \gset
select t.eq('COD order charged the fee', :'cod_total'::numeric, :'t_cod'::numeric);
select (place_web_order(:guest, jsonb_build_array(jsonb_build_object('variant_id', :bl, 'qty', 1)), 'online'))->>'order_no' as on_no \gset
:as_server
select t.eq('online order keeps the prepaid discount', (select total from orders where order_no = :'on_no'), :'t_on'::numeric);
select t.eq('books: discount includes the prepaid offer', (select discount >= 25 from orders where order_no = :'on_no'), true);
alter table settings disable trigger user;
update settings set value = '0' where key in ('prepaid_discount_pct', 'cod_fee');
alter table settings enable trigger user;

\echo '\n== 61. Offers and also-bought =='
:as_guest
select t.eq('general coupons show as offers', (select count(*) > 0 from public_offers), true);
select t.eq('influencer and partner codes stay hidden', (select count(*) from public_offers where code in ('ROHAN10', 'AARYAK10')), 0::bigint);
select t.eq('also-bought has no personal data', (select count(*) from information_schema.columns where table_name = 'also_bought'), 3::bigint);
\o
\echo '\nALL SHOP RULES PASSED ✅'
