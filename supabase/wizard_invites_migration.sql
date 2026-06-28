-- Wizard – Freunde direkt ins Spiel einladen
-- =============================================================================
-- Einladungen: ein Spiel-Mitglied laedt eine:n Freund:in in ein Lobby-Spiel ein.
-- Die/der Eingeladene sieht die Einladung per Realtime und kann beitreten.
-- Idempotent.

create table if not exists public.wizard_invites (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.wizard_games (id) on delete cascade,
  code       text not null,
  from_uid   uuid not null references auth.users (id) on delete cascade,
  from_name  text not null,
  to_uid     uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending',   -- pending | accepted | declined
  created_at timestamptz not null default now(),
  unique (game_id, to_uid)
);
create index if not exists idx_wizard_invites_to on public.wizard_invites (to_uid, status);

alter table public.wizard_invites enable row level security;
drop policy if exists wz_invites_select on public.wizard_invites;
create policy wz_invites_select on public.wizard_invites
  for select using (to_uid = auth.uid() or from_uid = auth.uid());

-- Realtime: Eingeladene werden sofort benachrichtigt.
do $$
begin
  begin alter publication supabase_realtime add table public.wizard_invites; exception when duplicate_object then null; end;
end $$;

-- RPC: Freund:in in das eigene Lobby-Spiel einladen.
create or replace function public.wizard_invite_friend(p_game uuid, p_friend uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_game public.wizard_games%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  select * into v_game from public.wizard_games where id = p_game;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if not exists (select 1 from public.wizard_players where game_id = p_game and uid = v_uid) then
    raise exception 'Du bist nicht in diesem Spiel'; end if;
  if v_game.status <> 'lobby' then raise exception 'Das Spiel laeuft schon'; end if;
  if not exists (select 1 from public.wizard_friends where uid = v_uid and friend_uid = p_friend) then
    raise exception 'Das ist keine Freundin/kein Freund'; end if;
  if exists (select 1 from public.wizard_players where game_id = p_game and uid = p_friend) then
    raise exception 'Ist schon im Spiel'; end if;
  if v_game.num_players >= v_game.max_players then raise exception 'Spiel ist voll'; end if;

  select name into v_name from public.wizard_players where game_id = p_game and uid = v_uid;

  insert into public.wizard_invites (game_id, code, from_uid, from_name, to_uid, status)
  values (p_game, v_game.join_code, v_uid, coalesce(v_name, 'Jemand'), p_friend, 'pending')
  on conflict (game_id, to_uid) do update
    set status = 'pending', created_at = now(), from_name = excluded.from_name, code = excluded.code;
end;
$$;

-- RPC: meine offenen Einladungen (nur noch laufende Lobby-Spiele, in denen ich
-- noch nicht bin).
create or replace function public.wizard_pending_invites()
returns json
language sql security definer
set search_path = public as $$
  select coalesce(json_agg(j order by (j->>'created_at') desc), '[]'::json)
  from (
    select json_build_object(
      'id', iv.id, 'game_id', iv.game_id, 'code', iv.code,
      'from_name', iv.from_name, 'from_uid', iv.from_uid, 'created_at', iv.created_at
    ) as j
    from public.wizard_invites iv
    join public.wizard_games gm on gm.id = iv.game_id
    where iv.to_uid = auth.uid() and iv.status = 'pending' and gm.status = 'lobby'
      and not exists (select 1 from public.wizard_players p where p.game_id = iv.game_id and p.uid = auth.uid())
  ) s;
$$;

-- RPC: Einladung ablehnen.
create or replace function public.wizard_decline_invite(p_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  update public.wizard_invites set status = 'declined' where id = p_id and to_uid = v_uid;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_invite_friend(uuid,uuid)', 'wizard_pending_invites()', 'wizard_decline_invite(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
