-- =====================================================================
-- Z-SHIRTS · review photos (public bucket). Run after 014.
-- Shoppers upload into their own folder: reviews/<login-id>/...
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reviews', 'reviews', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "shoppers upload own review photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reviews' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "anyone sees review photos"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'reviews');
