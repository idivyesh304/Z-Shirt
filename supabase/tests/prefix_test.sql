-- SINDIICAT · document numbers start with SC
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
\echo '\n== 76. New documents start with SC =='
select t.eq('new orders and bills start with SC', (select pg_get_expr(adbin, adrelid) like '%''SC''%' from pg_attrdef where adrelid = 'orders'::regclass
  and adnum = (select attnum from pg_attribute where attrelid = 'orders'::regclass and attname = 'order_no')), true);
select t.eq('no orders numbered ZS after the switch', (select count(*)::int from orders where order_no like 'ZS%' and created_at > now() - interval '1 second'), 0);
select t.eq('PO numbers start with SC/PO', (select next_po_no() like 'SC/PO/%'), true);
select t.eq('no numbering function still uses ZS', (select count(*)::int from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and (p.prosrc like '%''ZS-''%' or p.prosrc like '%''ZV-''%' or p.prosrc like '%''ZS/PO''%')), 0);
\o
\echo '\nALL SC NUMBERING RULES PASSED ✅'
