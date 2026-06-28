-- Wizard – Profilbilder per Upload (Supabase Storage)
-- =============================================================================
-- Oeffentlicher Bucket "avatars": jede:r kann die Bilder LESEN (damit Freunde
-- dein Foto sehen), aber nur SELBST in den eigenen Ordner schreiben/loeschen.
-- Pfad-Konvention: avatars/<uid>/avatar.jpg  -> erster Ordner = eigene uid.
-- Idempotent.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- Oeffentlich lesbar.
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- Nur ins eigene uid-Verzeichnis schreiben/aktualisieren/loeschen.
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
