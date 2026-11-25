-- SINDIICAT · STEP 14 · files now live on DZYN LAB's own server.
-- Every saved link to a photo or file on the old Supabase project is pointed at
-- the same file on https://api.sindiicat.dzynlabpvtltd.com (copied there by server/install.sh).
-- Checks every text, list and JSON column; leaves anything else untouched.
do $$
declare r record; n int; total int := 0;
  old_base text := 'https://apmtzjniptpvksyrnhph.supabase.co/storage/v1/';
  new_base text := 'https://api.sindiicat.dzynlabpvtltd.com/storage/v1/';
begin
  perform set_config('zs.internal', 'on', true);
  for r in
    select c.table_name, c.column_name, c.data_type, c.udt_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and (c.data_type in ('text', 'character varying', 'jsonb', 'json') or c.udt_name = '_text')
  loop
    begin
      execute format('update public.%I set %I = replace(%I::text, %L, %L)::%s where %I::text like %L',
        r.table_name, r.column_name, r.column_name, old_base, new_base,
        case when r.udt_name = '_text' then 'text[]' when r.data_type = 'character varying' then 'varchar' else r.data_type end,
        r.column_name, '%' || old_base || '%');
      get diagnostics n = row_count;
      if n > 0 then total := total + n; raise notice '% . %: % rows', r.table_name, r.column_name, n; end if;
    exception when others then
      raise notice 'skipped % . % (%)', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;
  raise notice 'file links moved: %', total;
end $$;
