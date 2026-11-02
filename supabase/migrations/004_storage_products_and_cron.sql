-- =====================================================================
-- Z-SHIRTS · Product photos + automatic clean-up of unpaid online orders
-- Run after 003 (Supabase only).
-- =====================================================================

-- Public bucket for product photos (shop visitors must see them)
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

create policy "team uploads product photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and (public.current_member()).id is not null);

create policy "anyone views product photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'products');

-- Every 5 minutes: online orders not paid within 30 minutes release their stock.
create extension if not exists pg_cron;
select cron.schedule('zshirts-release-unpaid', '*/5 * * * *', $$select public.release_unpaid_orders(30)$$);
