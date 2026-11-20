-- =====================================================================
-- SINDIICAT · 017 · brand renamed from Z-SHIRTS to SINDIICAT
-- Rewrites every customer- or team-facing text the database produces:
-- notifications, error messages, bill name, club name, PO terms.
-- Order numbers, SKUs and coupon codes keep their old format.
-- =====================================================================

-- functions: rebuild any function whose text mentions the old name
do $$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (p.prosrc like '%Z-SHIRTS%' or p.prosrc like '%Z-Club%') loop
    def := pg_get_functiondef(r.oid);
    def := replace(replace(def, 'Z-SHIRTS', 'SINDIICAT'), 'Z-Club', 'SINDIICAT Club');
    execute def;
  end loop;
end $$;

-- views: same for any view text
do $$
declare r record; def text;
begin
  for r in select c.oid, c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and (pg_get_viewdef(c.oid) like '%Z-SHIRTS%' or pg_get_viewdef(c.oid) like '%Z-Club%') loop
    def := replace(replace(pg_get_viewdef(r.oid), 'Z-SHIRTS', 'SINDIICAT'), 'Z-Club', 'SINDIICAT Club');
    execute format('create or replace view public.%I %s as %s', r.relname,
      case when r.reloptions is not null then 'with (' || array_to_string(r.reloptions, ', ') || ')' else '' end, def);
  end loop;
end $$;

-- stored texts
do $$ begin
  perform set_config('zs.internal', 'on', true);
  update settings set value = '"SINDIICAT"'::jsonb where key = 'business_name' and value = '"Z-SHIRTS"'::jsonb;
  update settings set grp = 'SINDIICAT Club' where grp = 'Z-Club';
  update settings set label = replace(replace(label, 'Z-SHIRTS', 'SINDIICAT'), 'Z-Club', 'SINDIICAT Club')
   where label like '%Z-SHIRTS%' or label like '%Z-Club%';
  update po_terms set body = replace(body, 'Z-SHIRTS', 'SINDIICAT') where body like '%Z-SHIRTS%';
end $$;

notify pgrst, 'reload schema';
