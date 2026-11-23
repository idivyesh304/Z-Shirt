-- =====================================================================
-- SINDIICAT · 018 · Vendor visits
-- Notes from meeting t-shirt manufacturers (Ludhiana, Mumbai, Delhi…):
-- tick-box offerings, their numbers, our ratings, photos, verdict.
-- Partners only. A visit can later be turned into a PO vendor.
-- =====================================================================

create table if not exists vendor_visits (
  id             bigint generated always as identity primary key,
  city           text not null,
  trip           text,
  visited_on     date not null default (now() at time zone 'Asia/Kolkata')::date,
  name           text not null,
  kind           text,
  contact_person text,
  phone          text,
  whatsapp       text,
  email          text,
  address        text,
  website        text,
  ticks          text[] not null default '{}',
  facts          jsonb  not null default '{}',
  ratings        jsonb  not null default '{}',
  verdict        text check (verdict in ('shortlist', 'maybe', 'no')),
  follow_up      date,
  next_step      text,
  notes          text,
  photos         text[] not null default '{}',
  vendor_id      bigint references vendors(id),
  created_by     uuid references members(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references members(id),
  updated_at     timestamptz
);
alter table vendor_visits enable row level security;
drop policy if exists vendor_visits_read on vendor_visits;
create policy vendor_visits_read on vendor_visits for select to authenticated using (is_partner());
grant select on vendor_visits to authenticated;
drop trigger if exists audit_vendor_visits on vendor_visits;
create trigger audit_vendor_visits after insert or update or delete on vendor_visits for each row execute function write_audit();

create or replace function save_vendor_visit(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_name text := nullif(trim(p->>'name'), '');
  v_city text := nullif(trim(p->>'city'), '');
  v_verdict text := nullif(lower(trim(coalesce(p->>'verdict', ''))), '');
  v_ticks text[] := coalesce(array(select distinct trim(x) from jsonb_array_elements_text(coalesce(p->'ticks', '[]')) x where trim(x) <> ''), '{}');
  v_photos text[] := coalesce(array(select x from jsonb_array_elements_text(coalesce(p->'photos', '[]')) x where x <> ''), '{}');
  v_facts jsonb := case when jsonb_typeof(p->'facts') = 'object' then
      (select coalesce(jsonb_object_agg(k, val), '{}') from jsonb_each(p->'facts') e(k, val) where val not in ('""'::jsonb, 'null'::jsonb)) else '{}' end;
  v_ratings jsonb := case when jsonb_typeof(p->'ratings') = 'object' then
      (select coalesce(jsonb_object_agg(k, val), '{}') from jsonb_each(p->'ratings') e(k, val)
        where jsonb_typeof(val) = 'number' and (val::text)::numeric between 1 and 5) else '{}' end;
begin
  if m.id is null or m.role <> 'partner' then raise exception 'Only partners can record vendor visits.'; end if;
  if v_name is null then raise exception 'Write the vendor''s name.'; end if;
  if v_city is null then raise exception 'Pick the city.'; end if;
  if v_verdict is not null and v_verdict not in ('shortlist', 'maybe', 'no') then raise exception 'Unknown verdict.'; end if;
  if v_id is null then
    insert into vendor_visits (city, trip, visited_on, name, kind, contact_person, phone, whatsapp, email, address, website,
      ticks, facts, ratings, verdict, follow_up, next_step, notes, photos, created_by)
    values (v_city, nullif(trim(p->>'trip'), ''), coalesce(nullif(p->>'visited_on', '')::date, (now() at time zone 'Asia/Kolkata')::date),
      v_name, nullif(trim(p->>'kind'), ''), nullif(trim(p->>'contact_person'), ''), nullif(trim(p->>'phone'), ''), nullif(trim(p->>'whatsapp'), ''),
      nullif(trim(p->>'email'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'website'), ''),
      v_ticks, v_facts, v_ratings, v_verdict, nullif(p->>'follow_up', '')::date, nullif(trim(p->>'next_step'), ''), nullif(trim(p->>'notes'), ''),
      v_photos, m.id)
    returning id into v_id;
  else
    update vendor_visits set city = v_city, trip = nullif(trim(p->>'trip'), ''),
      visited_on = coalesce(nullif(p->>'visited_on', '')::date, visited_on), name = v_name, kind = nullif(trim(p->>'kind'), ''),
      contact_person = nullif(trim(p->>'contact_person'), ''), phone = nullif(trim(p->>'phone'), ''), whatsapp = nullif(trim(p->>'whatsapp'), ''),
      email = nullif(trim(p->>'email'), ''), address = nullif(trim(p->>'address'), ''), website = nullif(trim(p->>'website'), ''),
      ticks = v_ticks, facts = v_facts, ratings = v_ratings, verdict = v_verdict, follow_up = nullif(p->>'follow_up', '')::date,
      next_step = nullif(trim(p->>'next_step'), ''), notes = nullif(trim(p->>'notes'), ''), photos = v_photos,
      vendor_id = coalesce(nullif(p->>'vendor_id', '')::bigint, vendor_id),
      updated_by = m.id, updated_at = now()
    where id = v_id;
    if not found then raise exception 'Visit not found.'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function save_vendor_visit(jsonb) from public, anon;
grant execute on function save_vendor_visit(jsonb) to authenticated;

create or replace function delete_vendor_visit(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only partners can delete vendor visits.'; end if;
  delete from vendor_visits where id = p_id;
end $$;
revoke execute on function delete_vendor_visit(bigint) from public, anon;
grant execute on function delete_vendor_visit(bigint) to authenticated;

notify pgrst, 'reload schema';
