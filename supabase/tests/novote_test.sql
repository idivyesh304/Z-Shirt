-- SINDIICAT · small changes without a vote
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'

\echo '\n== 75. Small price tweak applies at once, big one waits for votes =='
:as_aaryak
select id as pz, price as p0, mrp as m0 from products where name = 'Z Basic Tee' \gset
select raise_request('price_change', null, 'small tweak', null, jsonb_build_object('product_id', :pz, 'price', :p0 + 50, 'mrp', :m0));
select t.eq('₹50 change is live right away', (select price from products where id = :pz), (:p0 + 50)::numeric);
select raise_request('price_change', null, 'big sale', null, jsonb_build_object('product_id', :pz, 'price', :p0 - 200, 'mrp', :m0));
select t.eq('₹250 change waits for partners', (select price from products where id = :pz), (:p0 + 50)::numeric);
select t.eq('and it is pending', (select status::text from requests where type::text = 'price_change' order by id desc limit 1), 'pending');
select t.expect_error('select update_setting(''no_vote_below'', ''500'')', 'all of them must approve');
\o
\echo '\nALL NO-VOTE RULES PASSED ✅'
