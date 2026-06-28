-- Wizard – Freunde + Spielverlauf / Punkte-System
-- =============================================================================
-- Diese Migration im Supabase-SQL-Editor ausfuehren (Projekt der Wizard-App).
-- Sie ergaenzt die bestehenden wizard_*-Tabellen um Profile, Freundschaften
-- und Lese-RPCs fuer Freundesliste + eigenen Spielverlauf. Idempotent
-- (create if not exists / create or replace) -> kann gefahrlos erneut laufen.

-- Profil je Nutzer:in: Anzeigename + eindeutiger Freundescode.
create table if not exists public.wizard_profiles (
  uid         uuid primary key references auth.users (id) on delete cascade,
  name        text not null default 'Spieler',
  friend_code text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Freundschaften (beidseitig gespeichert: je Richtung eine Zeile).
create table if not exists public.wizard_friends (
  uid        uuid not null references auth.users (id) on delete cascade,
  friend_uid uuid not null references auth.users (id) on delete cascade,
  since      timestamptz not null default now(),
  primary key (uid, friend_uid)
);
create index if not exists idx_wizard_friends_uid on public.wizard_friends (uid);

alter table public.wizard_profiles enable row level security;
alter table public.wizard_friends  enable row level security;

-- Lesen: eigenes Profil + Profile eigener Freunde. Schreiben nur ueber RPCs.
drop policy if exists wz_profiles_select on public.wizard_profiles;
create policy wz_profiles_select on public.wizard_profiles
  for select using (
    uid = auth.uid()
    or exists (select 1 from public.wizard_friends f
               where f.uid = auth.uid() and f.friend_uid = wizard_profiles.uid)
  );

drop policy if exists wz_friends_select on public.wizard_friends;
create policy wz_friends_select on public.wizard_friends
  for select using (uid = auth.uid());

-- RPC: eigenes Profil anlegen/aktualisieren (Freundescode einmalig erzeugt).
create or replace function public.wizard_upsert_profile(p_name text default null)
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
        insert into public.wizard_profiles (uid, name, friend_code)
        values (v_uid, coalesce(nullif(btrim(p_name), ''), 'Spieler'), v_code)
        returning * into v_row;
        exit;
      exception when unique_violation then
        if exists (select 1 from public.wizard_profiles where uid = v_uid) then
          select * into v_row from public.wizard_profiles where uid = v_uid;
          exit;
        end if;
      end;
    end loop;
  elsif p_name is not null and btrim(p_name) <> '' and btrim(p_name) <> v_row.name then
    update public.wizard_profiles set name = btrim(p_name), updated_at = now()
    where uid = v_uid returning * into v_row;
  end if;

  return json_build_object('uid', v_row.uid, 'name', v_row.name, 'code', v_row.friend_code);
end;
$$;

-- RPC: Freund:in per Code hinzufuegen (beidseitig).
create or replace function public.wizard_add_friend(p_code text)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_friend uuid;
  v_name   text;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  perform public.wizard_upsert_profile(null);

  select uid, name into v_friend, v_name
  from public.wizard_profiles where friend_code = upper(btrim(p_code));
  if v_friend is null then raise exception 'Kein Spieler mit diesem Code gefunden'; end if;
  if v_friend = v_uid then raise exception 'Das ist dein eigener Code'; end if;

  insert into public.wizard_friends (uid, friend_uid) values (v_uid, v_friend)
    on conflict do nothing;
  insert into public.wizard_friends (uid, friend_uid) values (v_friend, v_uid)
    on conflict do nothing;

  return json_build_object('uid', v_friend, 'name', v_name);
end;
$$;

-- RPC: Freund:in entfernen (beidseitig).
create or replace function public.wizard_remove_friend(p_friend uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  delete from public.wizard_friends
  where (uid = v_uid and friend_uid = p_friend)
     or (uid = p_friend and friend_uid = v_uid);
end;
$$;

-- RPC: Freundesliste inkl. gemeinsamer Spiele + Siege.
create or replace function public.wizard_list_friends()
returns json
language sql security definer
set search_path = public as $$
  select coalesce(json_agg(j order by lower(j->>'name')), '[]'::json)
  from (
    select json_build_object(
      'uid',   fr.friend_uid,
      'name',  pr.name,
      'code',  pr.friend_code,
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

-- RPC: eigener Spielverlauf (abgeschlossene Online-Spiele, Sieger:in zuerst).
create or replace function public.wizard_match_history()
returns json
language sql security definer
set search_path = public as $$
  select coalesce(json_agg(g order by g.updated_at desc), '[]'::json)
  from (
    select
      gm.id,
      gm.updated_at,
      gm.status,
      gm.num_players,
      (
        select json_agg(json_build_object('uid', p.uid, 'name', p.name, 'score', p.total_score)
                        order by p.total_score desc, p.seat)
        from public.wizard_players p where p.game_id = gm.id
      ) as players
    from public.wizard_games gm
    where gm.status = 'finished'
      and exists (select 1 from public.wizard_players me where me.game_id = gm.id and me.uid = auth.uid())
  ) g;
$$;

-- Rechte: nur angemeldete Nutzer:innen duerfen die RPCs aufrufen.
do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_upsert_profile(text)', 'wizard_add_friend(text)',
    'wizard_remove_friend(uuid)', 'wizard_list_friends()',
    'wizard_match_history()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
