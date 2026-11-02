-- =====================================================================
-- Z-SHIRTS · rules test. Every check raises an error if a rule is broken.
-- Run with: bash supabase/tests/run_tests.sh
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- ---------- assertion helpers ----------
create schema t;
create function t.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_BUT_SUCCEEDED: %', p_sql;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_BUT_SUCCEEDED%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'WRONG ERROR for [%]: got "%", wanted /%/', p_sql, sqlerrm, p_pattern;
  end if;
  raise notice '  ✓ blocked: %', sqlerrm;
end $$;
create function t.eq(p_label text, p_got anyelement, p_want anyelement) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL %: got %, wanted %', p_label, p_got, p_want;
  end if;
  raise notice '  ✓ %', p_label;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ---------- logins ----------
insert into auth.users (email) values
  ('aaryak@example.com'), ('ayush@example.com'), ('devanshi@example.com'),
  ('jigar@example.com'), ('mahendra@example.com'), ('stranger@example.com');

select t.eq('all 5 members linked to their logins',
            (select count(*) from members where auth_user_id is not null), 5::bigint);

select id as aaryak from members where email = 'aaryak@example.com' \gset
select id as ayush  from members where email = 'ayush@example.com' \gset
select id as devanshi from members where email = 'devanshi@example.com' \gset
select id as jigar  from members where email = 'jigar@example.com' \gset

\set as_aaryak   'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
\set as_ayush    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''ayush@example.com''), false); set role authenticated;'
\set as_devanshi 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''devanshi@example.com''), false); set role authenticated;'
\set as_jigar    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''jigar@example.com''), false); set role authenticated;'
\set as_store    'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_stranger 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''stranger@example.com''), false); set role authenticated;'
\set as_owner    'reset role; select set_config(''request.jwt.claim.sub'', '''', false);'

\echo '\n== 1. Nobody can write to the books directly =='
:as_owner
select t.expect_error($$insert into ledger (kind, amount, description) values ('income', 100, 'sneaky')$$, 'Direct changes');
:as_aaryak
select t.expect_error($$insert into ledger (kind, amount, description) values ('income', 100, 'sneaky')$$, 'permission denied');
select t.expect_error($$update settings set value = '99999' where key = 'employee_petty_limit'$$, 'permission denied');

\echo '\n== 2. A stranger who signs up gets nothing =='
:as_stranger
select t.eq('stranger sees no members', (select count(*) from members), 0::bigint);
select t.expect_error($$select raise_request('expense', 500, 'test expense', 'x/bill.jpg')$$, 'not registered');

\echo '\n== 3. Capital: needs all 4 partners =='
:as_aaryak
select raise_request('capital_in', 200000, 'Aaryak initial investment', 'p/aaryak.jpg',
                     jsonb_build_object('partner_id', :'aaryak')) as r_cap_a \gset
select t.eq('capital pending after 1 of 4', (select status from requests where id = :r_cap_a)::text, 'pending');
select t.expect_error(format('select cast_vote(%s, ''approve'')', :r_cap_a), 'already voted');
:as_ayush
select cast_vote(:r_cap_a, 'approve');
:as_devanshi
select cast_vote(:r_cap_a, 'approve');
select t.eq('still pending after 3 of 4', (select status from requests where id = :r_cap_a)::text, 'pending');
:as_jigar
select t.eq('approved after 4 of 4', cast_vote(:r_cap_a, 'approve')::text, 'approved');
select t.eq('ledger shows +2,00,000 for Aaryak',
            (select amount from ledger where request_id = :r_cap_a), 200000.00::numeric);

-- the other three partners put in 1,00,000 each
:as_ayush
select raise_request('capital_in', 100000, 'Ayush initial investment', 'p/ayush.jpg', jsonb_build_object('partner_id', :'ayush')) as r \gset
:as_aaryak
select cast_vote(:r, 'approve');
:as_devanshi
select cast_vote(:r, 'approve');
:as_jigar
select cast_vote(:r, 'approve');
select raise_request('capital_in', 100000, 'Jigar initial investment', 'p/jigar.jpg', jsonb_build_object('partner_id', :'jigar')) as r \gset
:as_aaryak
select cast_vote(:r, 'approve');
:as_ayush
select cast_vote(:r, 'approve');
:as_devanshi
select cast_vote(:r, 'approve');
select raise_request('capital_in', 100000, 'Devanshi initial investment', 'p/dev.jpg', jsonb_build_object('partner_id', :'devanshi')) as r \gset
:as_aaryak
select cast_vote(:r, 'approve');
:as_ayush
select cast_vote(:r, 'approve');
:as_jigar
select cast_vote(:r, 'approve');
select t.eq('total capital 5,00,000', (select total_capital from business_summary), 500000.00::numeric);
select t.expect_error($$select raise_request('capital_in', 5000, 'no proof', null, '{}')$$, 'bank transfer screenshot');

\echo '\n== 4. Employee spending rules =='
:as_store
select t.expect_error($$select raise_request('expense', 1500, 'Packing tape', null)$$, 'photo of the bill');
select raise_request('expense', 1500, 'Packing tape and poly bags', 's/tape.jpg') as r_petty \gset
select t.eq('₹1,500 (under ₹2,000) approved instantly', (select status from requests where id = :r_petty)::text, 'approved');
select raise_request('expense', 5000, 'Printing ink', 's/ink.jpg') as r_mid \gset
select t.eq('₹5,000 needs 2 partners', (select required_approvals from requests where id = :r_mid), 2);
select t.expect_error($$select raise_request('partner_payout', 1000, 'pay me', 's/x.jpg', '{}')$$, 'only record expenses');
select t.expect_error(format('select cast_vote(%s, ''approve'')', :r_mid), 'Only partners');
select t.eq('employee cannot see the ledger', (select count(*) from ledger), 0::bigint);
select t.eq('employee cannot see partner positions', (select count(*) from partner_positions), 0::bigint);
select t.eq('employee cannot read the audit log', (select count(*) from audit_log), 0::bigint);
select t.eq('employee sees only own requests', (select count(*) from requests where raised_by <> (current_member()).id), 0::bigint);
:as_aaryak
select cast_vote(:r_mid, 'approve');
select t.eq('still pending after 1 of 2', (select status from requests where id = :r_mid)::text, 'pending');
:as_ayush
select t.eq('approved after 2 of 2', cast_vote(:r_mid, 'approve')::text, 'approved');

\echo '\n== 5. Big expense: one NO from any partner stops it =='
:as_jigar
select raise_request('expense', 20000, 'Photoshoot props', 'j/props.jpg') as r_big \gset
select t.eq('₹20,000 needs all 4', (select required_approvals from requests where id = :r_big), 4);
:as_ayush
select t.expect_error(format('select cast_vote(%s, ''reject'')', :r_big), 'write a reason');
select t.eq('rejected by one partner', cast_vote(:r_big, 'reject', 'Too costly for now')::text, 'rejected');
select t.expect_error(format('select cast_vote(%s, ''approve'')', :r_big), 'already rejected');
select t.eq('rejected expense never touched the books', (select count(*) from ledger where request_id = :r_big), 0::bigint);

\echo '\n== 6. Mid expense: rejected once approval is impossible =='
:as_store
select raise_request('expense', 10000, 'New display rack', 's/rack.jpg') as r_rack \gset
:as_ayush
select cast_vote(:r_rack, 'reject', 'Not needed');
:as_devanshi
select t.eq('2 NOs: 2 YES still possible, stays pending', cast_vote(:r_rack, 'reject', 'Agree')::text, 'pending');
:as_jigar
select t.eq('3 NOs: rejected', cast_vote(:r_rack, 'reject', 'No')::text, 'rejected');

\echo '\n== 7. Entries can never be edited or deleted =='
:as_owner
select id as e_petty from ledger where request_id = :r_petty \gset
select set_config('zs.internal', 'on', false);
select t.expect_error(format('update ledger set amount = -1 where id = %s', :e_petty), 'permanent');
select t.expect_error(format('delete from ledger where id = %s', :e_petty), 'permanent');
select t.expect_error('delete from audit_log', 'permanent');
select t.expect_error('delete from votes', 'permanent');
select t.expect_error('delete from requests', 'permanent');
select set_config('zs.internal', 'off', false);
:as_aaryak
select t.expect_error(format('delete from ledger where id = %s', :e_petty), 'permission denied');

\echo '\n== 8. Mistakes are fixed by a reversal (all 4 approve) =='
:as_aaryak
select raise_request('reversal', null, 'Tape was returned to shop', null, jsonb_build_object('entry_id', :e_petty)) as r_rev \gset
select t.expect_error(format($$select raise_request('reversal', null, 'again', null, '{"entry_id": %s}')$$, :e_petty), 'already waiting');
:as_ayush
select cast_vote(:r_rev, 'approve');
:as_devanshi
select cast_vote(:r_rev, 'approve');
:as_jigar
select cast_vote(:r_rev, 'approve');
select t.eq('reversal entry is +1,500', (select amount from ledger where reverses_entry = :e_petty), 1500.00::numeric);
select t.eq('original entry is still there', (select amount from ledger where id = :e_petty), -1500.00::numeric);
select t.expect_error(format($$select raise_request('reversal', null, 'again', null, '{"entry_id": %s}')$$, :e_petty), 'already been reversed');

\echo '\n== 9. Changing the limits needs all 4 =='
:as_jigar
select t.expect_error($$select raise_request('setting_change', null, 'raise limit', null, '{"key":"employee_petty_limit","value":20000}')$$, 'must stay below');
select raise_request('setting_change', null, 'Employee limit to 3000', null, '{"key":"employee_petty_limit","value":3000}') as r_set \gset
:as_aaryak
select cast_vote(:r_set, 'approve');
:as_ayush
select cast_vote(:r_set, 'approve');
select t.eq('limit unchanged with 3 of 4', setting_num('employee_petty_limit'), 2000::numeric);
:as_devanshi
select cast_vote(:r_set, 'approve');
select t.eq('limit is now 3000', setting_num('employee_petty_limit'), 3000::numeric);

\echo '\n== 10. Profit / loss sharing =='
:as_aaryak
select t.eq('default rule: every partner shares 25%',
            (select count(*) from partner_positions where result_share = 0.25), 4::bigint);
-- Option B: profit by investment, loss equal
select raise_request('share_rule', null, 'Profit by investment, loss equal', null,
                     '{"profit_rule":"investment","loss_rule":"equal"}') as r_rule \gset
:as_ayush
select cast_vote(:r_rule, 'approve');
:as_devanshi
select cast_vote(:r_rule, 'approve');
:as_jigar
select cast_vote(:r_rule, 'approve');
-- books now: capital 5,00,000; expenses 5,000 (ink) ; 1,500 tape reversed → loss of 5,000
select t.eq('business result is −5,000', (select business_result from business_summary), -5000.00::numeric);
select t.eq('loss shared equally: Aaryak −1,250',
            (select result_amount from partner_positions where name = 'Aaryak Patel'), -1250.00::numeric);
select t.eq('Aaryak settlement 1,98,750',
            (select settlement_balance from partner_positions where name = 'Aaryak Patel'), 198750.00::numeric);
select t.eq('settlements add up to cash in business',
            (select sum(settlement_balance) from partner_positions), (select cash_balance from business_summary));

\echo '\n== 11. Your example: business loses all 5 lakh, loss shared equally =='
:as_owner
select set_config('zs.internal', 'on', false);
insert into ledger (kind, amount, description) values ('expense', -495000, 'TEST: everything lost');
select set_config('zs.internal', 'off', false);
:as_aaryak
select t.eq('cash left is 0', (select cash_balance from business_summary), 0.00::numeric);
select t.eq('Aaryak should get back 75,000',
            (select settlement_balance from partner_positions where name = 'Aaryak Patel'), 75000.00::numeric);
select t.eq('Jigar owes 25,000',
            (select settlement_balance from partner_positions where name = 'Jigar Panchal'), -25000.00::numeric);
:as_owner
select set_config('zs.internal', 'on', false);
insert into ledger (kind, amount, description) values ('income', 495000, 'TEST: undo');
select set_config('zs.internal', 'off', false);

\echo '\n== 12. Month close locks the books =='
:as_owner
select set_config('zs.internal', 'on', false);
insert into ledger (entry_date, kind, amount, description) values ('2026-10-20', 'expense', -800, 'October courier');
select set_config('zs.internal', 'off', false);
:as_aaryak
select t.expect_error($$select sign_month_close(date_trunc('month', now())::date, 1000)$$, 'after it has ended');
select sign_month_close('2026-10-01', -800, 'Matches bank');
select t.expect_error($$select sign_month_close('2026-10-01', -800)$$, 'already signed');
:as_store
select t.expect_error($$select sign_month_close('2026-10-01', -800)$$, 'Only partners');
:as_ayush
select sign_month_close('2026-10-01', -800);
:as_devanshi
select sign_month_close('2026-10-01', -800);
select t.eq('October not locked with 3 of 4', month_is_closed('2026-10-15'), false);
:as_jigar
select t.eq('4th signature', sign_month_close('2026-10-01', -800), 4);
select t.eq('October locked', month_is_closed('2026-10-15'), true);
:as_owner
select set_config('zs.internal', 'on', false);
select t.expect_error($$insert into ledger (entry_date, kind, amount, description) values ('2026-10-25', 'expense', -100, 'late entry')$$, 'closed and locked');
select set_config('zs.internal', 'off', false);

\echo '\n== 13. Cancelling and the audit trail =='
:as_store
select raise_request('expense', 4000, 'Hangers', 's/h.jpg') as r_h \gset
:as_aaryak
select t.expect_error(format('select cancel_request(%s)', :r_h), 'only cancel your own');
:as_store
select cancel_request(:r_h);
:as_aaryak
select t.eq('cancelled', (select status from requests where id = :r_h)::text, 'cancelled');
select t.eq('every vote is in the audit log',
            (select count(*) from audit_log where table_name = 'votes'), (select count(*) from votes));
select t.eq('owner''s direct test entries are flagged in the audit log',
            (select count(*) > 0 from audit_log where table_name = 'ledger' and actor_name = 'system / database owner'), true);
select t.eq('internal engine cannot be called from the app',
            has_function_privilege('authenticated', 'apply_request(bigint)', 'execute'), false);

\echo '\nALL RULES PASSED ✅'
