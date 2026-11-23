-- SINDIICAT · vendor visits test
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_mahendra 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'

\echo '\n== 70. Partner records a vendor visit =='
:as_aaryak
select save_vendor_visit(jsonb_build_object('city', 'Ludhiana', 'name', 'Punjab Knits', 'kind', 'Own factory', 'phone', '9876543210',
  'ticks', jsonb_build_array('Oversized tee', 'DTF', 'Oversized tee', ' '), 'facts', jsonb_build_object('moq_design', 100, 'rate_os', 185, 'blank', ''),
  'ratings', jsonb_build_object('quality', 4, 'price', 9), 'verdict', 'shortlist')) as v1 \gset
select t.eq('ticks saved once each', (select array_length(ticks, 1) from vendor_visits where id = :v1), 2);
select t.eq('empty numbers dropped', (select facts ? 'blank' from vendor_visits where id = :v1), false);
select t.eq('ratings outside 1-5 dropped', (select ratings::text from vendor_visits where id = :v1), '{"quality": 4}');
select save_vendor_visit(jsonb_build_object('id', :v1, 'city', 'Ludhiana', 'name', 'Punjab Knits', 'verdict', 'maybe'));
select t.eq('visit updated', (select verdict from vendor_visits where id = :v1), 'maybe');
select t.expect_error('select save_vendor_visit(''{"city":"Delhi"}'')', 'name');

\echo '\n== 71. Employee cannot see or add visits =='
:as_mahendra
select t.eq('employee sees no visits', (select count(*)::int from vendor_visits), 0);
select t.expect_error('select save_vendor_visit(''{"city":"Delhi","name":"X"}'')', 'Only partners');
:as_aaryak
select delete_vendor_visit(:v1);
select t.eq('partner can delete a visit', (select count(*)::int from vendor_visits where id = :v1), 0);
\o
\echo '\nALL VENDOR VISIT RULES PASSED ✅'
