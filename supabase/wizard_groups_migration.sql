-- Wizard – Gruppen mit Siege-Zaehlung + Rangliste
-- =============================================================================
-- Eine Gruppe ist eine benannte Runde aus Freund:innen. Spielen ausschliesslich
-- Gruppenmitglieder ein Online-Spiel zu Ende, zaehlt es fuer die Gruppe: pro
-- Mitglied werden Siege (= hoechste Punktzahl im Spiel) und Spiele gezaehlt und
-- als Rangliste (Platz 1..N) ausgegeben. Idempotent.

create table if not exists public.wizard_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_uid  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.wizard_group_members (
  group_id  uuid not null references public.wizard_groups (id) on delete cascade,
  uid       uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, uid)
);
create index if not exists idx_wizard_group_members_uid on public.wizard_group_members (uid);

-- Mitgliedschafts-Check (SECURITY DEFINER -> keine RLS-Rekursion)
create or replace function public.wizard_in_group(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.wizard_group_members where group_id = g and uid = auth.uid());
$$;

alter table public.wizard_groups        enable row level security;
alter table public.wizard_group_members enable row level security;
drop policy if exists wz_groups_select on public.wizard_groups;
create policy wz_groups_select on public.wizard_groups
  for select using (public.wizard_in_group(id));
drop policy if exists wz_gmembers_select on public.wizard_group_members;
create policy wz_gmembers_select on public.wizard_group_members
  for select using (public.wizard_in_group(group_id));

-- RPC: Gruppe erstellen (Ersteller wird Mitglied + Owner)
create or replace function public.wizard_create_group(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name fehlt'; end if;
  perform public.wizard_upsert_profile(null);
  insert into public.wizard_groups (name, owner_uid) values (btrim(p_name), v_uid) returning id into v_id;
  insert into public.wizard_group_members (group_id, uid) values (v_id, v_uid);
  return json_build_object('id', v_id, 'name', btrim(p_name));
end; $$;

-- RPC: Freund:in zur Gruppe hinzufuegen (nur eigene Freunde, nur als Mitglied)
create or replace function public.wizard_add_group_member(p_group uuid, p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if not exists (select 1 from public.wizard_group_members where group_id = p_group and uid = v_uid) then
    raise exception 'Du bist nicht in dieser Gruppe'; end if;
  if not exists (select 1 from public.wizard_friends where uid = v_uid and friend_uid = p_friend) then
    raise exception 'Das ist keine Freundin/kein Freund'; end if;
  insert into public.wizard_group_members (group_id, uid) values (p_group, p_friend)
    on conflict do nothing;
end; $$;

-- RPC: Gruppe verlassen (Owner gibt ab; letzte Person loescht die Gruppe)
create or replace function public.wizard_leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_new uuid; v_owner uuid;
begin
  delete from public.wizard_group_members where group_id = p_group and uid = v_uid;
  if not exists (select 1 from public.wizard_group_members where group_id = p_group) then
    delete from public.wizard_groups where id = p_group; return;
  end if;
  select owner_uid into v_owner from public.wizard_groups where id = p_group;
  if v_owner = v_uid then
    select uid into v_new from public.wizard_group_members where group_id = p_group order by joined_at limit 1;
    update public.wizard_groups set owner_uid = v_new where id = p_group;
  end if;
end; $$;

-- RPC: Mitglied entfernen (nur Owner, nicht sich selbst)
create or replace function public.wizard_remove_group_member(p_group uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.wizard_groups where id = p_group and owner_uid = v_uid) then
    raise exception 'Nur der Ersteller darf Mitglieder entfernen'; end if;
  if p_member = v_uid then raise exception 'Nutze "Gruppe verlassen"'; end if;
  delete from public.wizard_group_members where group_id = p_group and uid = p_member;
end; $$;

-- RPC: meine Gruppen (mit Mitgliederzahl)
create or replace function public.wizard_list_groups()
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(j order by lower(j->>'name')), '[]'::json)
  from (
    select json_build_object(
      'id', g.id, 'name', g.name,
      'owner', (g.owner_uid = auth.uid()),
      'members', (select count(*) from public.wizard_group_members m where m.group_id = g.id)
    ) as j
    from public.wizard_groups g
    where exists (select 1 from public.wizard_group_members m where m.group_id = g.id and m.uid = auth.uid())
  ) s;
$$;

-- RPC: Rangliste einer Gruppe (Siege + Spiele je Mitglied, Platz 1..N)
create or replace function public.wizard_group_standings(p_group uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_json json;
begin
  if not exists (select 1 from public.wizard_group_members where group_id = p_group and uid = v_uid) then
    raise exception 'Kein Mitglied dieser Gruppe'; end if;

  with grp as (
    select uid from public.wizard_group_members where group_id = p_group
  ),
  qual as (   -- abgeschlossene Spiele, in denen NUR Gruppenmitglieder mitspielten
    select g.id,
      (select max(p.total_score) from public.wizard_players p where p.game_id = g.id) as topscore
    from public.wizard_games g
    where g.status = 'finished'
      and (select count(*) from public.wizard_players p where p.game_id = g.id) >= 2
      and not exists (
        select 1 from public.wizard_players p
        where p.game_id = g.id and p.uid not in (select uid from grp)
      )
  ),
  stats as (
    select gm.uid,
      coalesce(pr.name, 'Spieler') as name,
      coalesce(pr.avatar, '🧙')    as avatar,
      (select count(*) from qual q join public.wizard_players p on p.game_id = q.id
         where p.uid = gm.uid and p.total_score = q.topscore) as wins,
      (select count(*) from qual q join public.wizard_players p on p.game_id = q.id
         where p.uid = gm.uid) as games
    from grp gm
    left join public.wizard_profiles pr on pr.uid = gm.uid
  )
  select coalesce(json_agg(
           json_build_object('uid', uid, 'name', name, 'avatar', avatar, 'wins', wins, 'games', games)
           order by wins desc, games desc, lower(name)
         ), '[]'::json) into v_json
  from stats;

  return v_json;
end; $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_create_group(text)', 'wizard_add_group_member(uuid,uuid)',
    'wizard_leave_group(uuid)', 'wizard_remove_group_member(uuid,uuid)',
    'wizard_list_groups()', 'wizard_group_standings(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
