-- Konto-Löschung (Apple/Store-Pflicht) + Daten-Auskunft (DSGVO Art. 15/17).
-- Beide als SECURITY DEFINER, damit sie über RLS hinweg nur die EIGENEN Daten
-- der angemeldeten Person (auth.uid()) entfernen bzw. ausgeben.

-- Vollständige Löschung des eigenen Kontos und aller zugehörigen Daten.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet';
  end if;

  delete from public.wizard_friends       where uid = v_uid or friend_uid = v_uid;
  delete from public.wizard_invites        where from_uid = v_uid or to_uid = v_uid;
  delete from public.wizard_group_members  where uid = v_uid;
  delete from public.wizard_groups         where owner_uid = v_uid;   -- kaskadiert Mitglieder
  delete from public.wizard_games          where host_uid = v_uid;    -- kaskadiert Spieldaten
  delete from public.wizard_players        where uid = v_uid;
  delete from public.wizard_hands          where uid = v_uid;
  delete from public.wizard_plays          where uid = v_uid;
  delete from public.wizard_round_scores   where uid = v_uid;
  delete from public.wizard_profiles       where uid = v_uid;

  -- Avatar-Dateien im Storage (eigener Ordner) entfernen
  begin
    delete from storage.objects where bucket_id = 'avatars' and name like v_uid::text || '/%';
  exception when others then null;
  end;

  -- Auth-Konto entfernen (kaskadiert Identitäten/Sitzungen)
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- Auskunft: gibt die zur angemeldeten Person gespeicherten Daten als JSON zurück.
create or replace function public.get_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  select jsonb_build_object(
    'konto_id', v_uid,
    'profil', (select to_jsonb(p) - 'uid' from public.wizard_profiles p where p.uid = v_uid),
    'freunde', (select count(*) from public.wizard_friends where uid = v_uid or friend_uid = v_uid),
    'gruppen', (select count(*) from public.wizard_group_members where uid = v_uid),
    'gespielte_spiele', (select count(distinct game_id) from public.wizard_players where uid = v_uid)
  ) into v;
  return v;
end;
$$;

revoke all on function public.get_my_data() from public, anon;
grant execute on function public.get_my_data() to authenticated;
