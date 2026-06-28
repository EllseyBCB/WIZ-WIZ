-- Wizard – Profil erweitern: Avatar (Profilbild) + Benutzername
-- =============================================================================
-- Ergaenzt wizard_profiles um eine avatar-Spalte und erweitert die RPCs, sodass
-- Benutzername UND Avatar gesetzt und an Freunde ausgeliefert werden.
-- Idempotent -> kann mehrfach laufen.

alter table public.wizard_profiles add column if not exists avatar text;

-- alte Signatur (nur p_name) entfernen, neue mit p_avatar anlegen.
drop function if exists public.wizard_upsert_profile(text);

create or replace function public.wizard_upsert_profile(p_name text default null, p_avatar text default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_row   public.wizard_profiles%rowtype;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;

  select * into v_row from public.wizard_profiles where uid = v_uid;
  if not found then
    loop
      v_code := (
        select string_agg(substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1), '')
        from generate_series(1, 6)
      );
      begin
        insert into public.wizard_profiles (uid, name, friend_code, avatar)
        values (v_uid,
                coalesce(nullif(btrim(p_name), ''), 'Spieler'),
                v_code,
                coalesce(nullif(p_avatar, ''), '🧙'))
        returning * into v_row;
        exit;
      exception when unique_violation then
        if exists (select 1 from public.wizard_profiles where uid = v_uid) then
          select * into v_row from public.wizard_profiles where uid = v_uid;
          exit;
        end if;
      end;
    end loop;
  else
    if p_name is not null and btrim(p_name) <> '' and btrim(p_name) <> v_row.name then
      update public.wizard_profiles set name = btrim(p_name), updated_at = now() where uid = v_uid;
    end if;
    if p_avatar is not null and p_avatar <> '' and p_avatar is distinct from v_row.avatar then
      update public.wizard_profiles set avatar = p_avatar, updated_at = now() where uid = v_uid;
    end if;
    select * into v_row from public.wizard_profiles where uid = v_uid;
  end if;

  return json_build_object('uid', v_row.uid, 'name', v_row.name,
                           'code', v_row.friend_code, 'avatar', coalesce(v_row.avatar, '🧙'));
end;
$$;

-- Freundesliste: Avatar mit ausliefern.
create or replace function public.wizard_list_friends()
returns json
language sql security definer
set search_path = public as $$
  select coalesce(json_agg(j order by lower(j->>'name')), '[]'::json)
  from (
    select json_build_object(
      'uid',    fr.friend_uid,
      'name',   pr.name,
      'code',   pr.friend_code,
      'avatar', coalesce(pr.avatar, '🧙'),
      'games', (
        select count(*) from public.wizard_games gm
        where gm.status = 'finished'
          and exists (select 1 from public.wizard_players a where a.game_id = gm.id and a.uid = auth.uid())
          and exists (select 1 from public.wizard_players b where b.game_id = gm.id and b.uid = fr.friend_uid)
      ),
      'wins', (
        select count(*) from public.wizard_games gm
        where gm.status = 'finished'
          and exists (select 1 from public.wizard_players a where a.game_id = gm.id and a.uid = auth.uid())
          and exists (
            select 1 from public.wizard_players b
            where b.game_id = gm.id and b.uid = fr.friend_uid
              and b.total_score = (select max(c.total_score) from public.wizard_players c where c.game_id = gm.id)
          )
      )
    ) as j
    from public.wizard_friends fr
    join public.wizard_profiles pr on pr.uid = fr.friend_uid
    where fr.uid = auth.uid()
  ) s;
$$;

-- Rechte fuer die neue Funktions-Signatur.
do $$
begin
  execute 'revoke all on function public.wizard_upsert_profile(text,text) from public, anon';
  execute 'grant execute on function public.wizard_upsert_profile(text,text) to authenticated';
end $$;
