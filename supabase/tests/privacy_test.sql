-- Employee (Mahendra) must not see partner money or partner-only rules.
\set ON_ERROR_STOP 1
\set as_store 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''mahendra@example.com''), false); set role authenticated;'
\set as_aaryak 'reset role; select set_config(''request.jwt.claim.sub'', (select id::text from auth.users where email=''aaryak@example.com''), false); set role authenticated;'
:as_store
do $$ begin
  if (select count(*) from ledger) > 0 then raise exception 'employee sees ledger'; end if;
  if (select count(*) from partner_positions) > 0 then raise exception 'employee sees partner positions'; end if;
  if (select count(*) from monthly_report) > 0 then raise exception 'employee sees monthly report'; end if;
  if (select count(*) from cash_with_partners) > 0 then raise exception 'employee sees partner cash'; end if;
  if (select count(*) from product_costs) > 0 then raise exception 'employee sees cost sheet'; end if;
  if (select count(*) from fit_profit) > 0 or (select count(*) from product_profit) > 0 or (select count(*) from drop_profit) > 0 then raise exception 'employee sees profit'; end if;
  if (select count(*) from finance_inputs) > 0 then raise exception 'employee sees finance inputs'; end if;
  if (select count(*) from vendor_visits) > 0 then raise exception 'employee sees vendor visits'; end if;
  if (select count(*) from audit_log) > 0 or (select count(*) from change_log) > 0 then raise exception 'employee sees activity log'; end if;
  if (select business_result from business_summary) <> 0 or (select total_capital from business_summary) <> 0 then raise exception 'employee sees business totals'; end if;
  if exists (select 1 from settings where key in ('custom_split','profit_rule','loss_rule','income_tax_rate_pct','all_partner_limit','no_vote_below','max_partner_discount_pct')) then raise exception 'employee sees partner-only rules'; end if;
  if (select count(*) from employee_pay where member_id <> (current_member()).id) > 0 then raise exception 'employee sees other salaries'; end if;
  raise notice '  ✓ employee cannot see partner money, profit, costs, visits, logs or partner rules';
end $$;
:as_aaryak
do $$ begin
  if not exists (select 1 from settings where key = 'profit_rule') then raise exception 'partner lost rules'; end if;
  raise notice '  ✓ partners still see everything';
end $$;
reset role;
do $$ begin raise notice 'PRIVACY TEST PASSED'; end $$;
