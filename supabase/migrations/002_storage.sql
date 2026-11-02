-- =====================================================================
-- Z-SHIRTS · Phase 1 · Private storage for bill photos and bank proofs
-- Run after 001. Photos can be uploaded but never replaced or deleted.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

-- Each member uploads only into their own folder: proofs/<their-login-id>/...
create policy "members upload own proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.current_member()).id is not null
  );

-- Partners can see every proof; the employee sees only their own uploads.
create policy "view proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'proofs'
    and (public.is_partner() or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- No update or delete policy on purpose: proofs are permanent.
