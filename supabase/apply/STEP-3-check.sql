-- STEP 3: check which updates are in the database, and refresh the app's connection to it.
notify pgrst, 'reload schema';
select
  to_regclass('public.sales_targets')            is not null as "007 targets + sold by",
  to_regprocedure('public.my_welcome()')         is not null as "008 welcome + best sellers",
  to_regprocedure('public.cash_handover(numeric,uuid,text,text)') is not null as "009 store cash",
  to_regprocedure('public.finance_statement(date,date)')          is not null as "010 finance",
  to_regclass('public.product_costs')            is not null as "011 settings + GST + targets";
