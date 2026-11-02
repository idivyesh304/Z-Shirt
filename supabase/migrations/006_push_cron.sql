-- =====================================================================
-- Z-SHIRTS · send phone notifications every minute (only when something waits)
-- Needs the 'push' Edge Function deployed with Verify JWT off.
-- =====================================================================
create extension if not exists pg_net;
create extension if not exists pgcrypto;

insert into app_secrets (key, value) values ('cron_key', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- the push function reports back which jobs went out and which phones are gone
create or replace function push_done(p_jobs bigint[], p_dead bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  update push_outbox set sent_at = now() where id = any (p_jobs) and sent_at is null;
  update push_subscriptions set failed_at = now() where id = any (coalesce(p_dead, '{}'));
end $$;
revoke execute on function push_done(bigint[], bigint[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_done(bigint[], bigint[]) to service_role;
  end if;
end $$;

-- clear sent jobs after a week so the table stays small
create or replace function push_cleanup() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  delete from push_outbox where sent_at < now() - interval '7 days';
end $$;
drop trigger if exists push_outbox_internal on push_outbox;
create trigger push_outbox_internal before insert or update or delete on push_outbox
  for each row execute function require_internal();

select cron.unschedule('zshirts-push') where exists (select 1 from cron.job where jobname = 'zshirts-push');
select cron.schedule('zshirts-push', '* * * * *', $job$
  select net.http_post(
    url := 'https://apmtzjniptpvksyrnhph.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-key', (select value from public.app_secrets where key = 'cron_key')),
    body := '{}'::jsonb)
  where exists (select 1 from public.push_outbox where sent_at is null);
  select public.push_cleanup() where extract(minute from now()) = 0;
$job$);
