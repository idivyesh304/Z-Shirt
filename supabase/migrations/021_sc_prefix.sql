-- =====================================================================
-- SINDIICAT · 021 · Documents start with "SC" instead of "ZS"
--   Orders / bills / invoices : ZS1042        → SC1043 (same running number)
--   Purchase orders           : ZS/PO/26-27/… → SC/PO/26-27/0001
--   Vendor codes              : ZV-PT-002     → SV-PT-003
--   New product SKUs          : ZS-OS-12-…    → SC-OS-…
-- Documents already issued keep their old numbers (they are on paper,
-- in customers' hands and in GST records). Old SKUs keep working.
-- =====================================================================

alter table orders alter column order_no set default ('SC' || nextval('order_no_seq'));

do $$ begin
  perform set_config('zs.internal', 'on', true);
  update settings set value = '"SC/PO"'::jsonb where key = 'po_prefix' and value = '"ZS/PO"'::jsonb;
end $$;

-- every function that builds a number or code with the old prefix
do $$
declare r record; def text; n int := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.prokind = 'f'
             and (p.prosrc like '%''ZS-''%' or p.prosrc like '%''ZV-''%' or p.prosrc like '%''ZS/PO''%') loop
    def := pg_get_functiondef(r.oid);
    def := replace(replace(replace(def, '''ZS-''', '''SC-'''), '''ZV-''', '''SV-'''), '''ZS/PO''', '''SC/PO''');
    execute def; n := n + 1;
  end loop;
  if n = 0 then raise exception 'No numbering functions found to update.'; end if;
end $$;

notify pgrst, 'reload schema';
