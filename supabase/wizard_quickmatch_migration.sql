-- ============================================================================
-- Schnelle Runde (Matchmaking): oeffentliche Lobbys, denen Suchende
-- automatisch beitreten. Ab 3 Spielern laeuft ein Countdown (25 s), bei
-- voller Lobby (4) startet das Spiel sofort – ohne Host-Klick.
--
-- Ablauf: Client ruft wizard_quick_match(name) -> tritt der aeltesten offenen,
-- "frischen" Quick-Lobby bei oder erstellt eine neue. Waehrend des Wartens
-- pingt der Client (wizard_quick_ping), damit verwaiste Lobbys (App beendet)
-- nicht weiter vermittelt werden. Der Start erfolgt serverseitig beim
-- Volllaufen bzw. per wizard_quick_start, sobald der Countdown abgelaufen ist
-- (jeder Client darf ausloesen; Doppel-Aufrufe sind stille No-Ops).
-- ============================================================================

-- Spalten: Kennzeichnung + Countdown-Zeitpunkt
alter table public.wizard_games
  add column if not exists is_quick boolean not null default false;
alter table public.wizard_games
  add column if not exists starts_at timestamptz;

create index if not exists idx_wizard_games_quick_open
  on public.wizard_games (created_at)
  where is_quick and status = 'lobby';

-- ---------------------------------------------------------------------------
-- RPC: Schnelle Runde starten (ohne Host; Rennen mehrerer Clients unschaedlich)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_quick_start(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_game public.wizard_games%rowtype;
  v_np   int;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;

  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then return; end if;
  if not v_game.is_quick then raise exception 'Keine Schnelle Runde'; end if;
  if not exists (select 1 from public.wizard_players
                 where game_id = p_game and uid = v_uid) then
    raise exception 'Kein Mitglied dieses Spiels';
  end if;
  -- Schon gestartet (anderer Client war schneller) -> stiller Erfolg.
  if v_game.status <> 'lobby' then return; end if;
  -- Countdown (noch) nicht abgelaufen -> stiller No-Op.
  if v_game.starts_at is null or now() < v_game.starts_at then return; end if;

  select count(*) into v_np from public.wizard_players where game_id = p_game;
  if v_np < 3 or v_np > 6 then return; end if;

  -- identisch zu wizard_start_game: Sitze kompaktieren, starten, austeilen
  update public.wizard_players set seat = seat + 1000 where game_id = p_game;
  update public.wizard_players p set seat = o.ns
  from (
    select uid, (row_number() over (order by seat)) - 1 as ns
    from public.wizard_players where game_id = p_game
  ) o
  where p.game_id = p_game and p.uid = o.uid;

  update public.wizard_games set
    status = 'running', num_players = v_np, total_rounds = 60 / v_np,
    round_no = 0, dealer_seat = 0, updated_at = now()
  where id = p_game;

  perform public.wizard_deal_round(p_game);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Mitspieler suchen -> offener Lobby beitreten oder neue erstellen
-- ---------------------------------------------------------------------------
create or replace function public.wizard_quick_match(p_name text)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- ohne I,O,0,1
  v_code  text;
  v_game  public.wizard_games%rowtype;
  v_id    uuid;
  v_seat  int;
  v_np    int;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name fehlt'; end if;

  -- Verwaiste Quick-Lobbys aufraeumen (kein Heartbeat seit > 10 Minuten).
  delete from public.wizard_games
  where is_quick and status = 'lobby'
    and updated_at < now() - interval '10 minutes';

  -- Schon in einer offenen Schnellen Runde? -> dorthin zurueck (Reconnect).
  select g.id into v_id
  from public.wizard_games g
  join public.wizard_players p on p.game_id = g.id and p.uid = v_uid
  where g.is_quick and g.status = 'lobby'
  limit 1;
  if v_id is not null then
    update public.wizard_players set connected = true
    where game_id = v_id and uid = v_uid;
    update public.wizard_games set updated_at = now() where id = v_id;
    return v_id;
  end if;

  -- Aelteste offene, frische Lobby (Heartbeat < 60 s) suchen und sperren.
  select * into v_game
  from public.wizard_games
  where is_quick and status = 'lobby'
    and num_players < max_players
    and updated_at > now() - interval '60 seconds'
  order by created_at
  limit 1
  for update;

  if not found then
    -- Keine offene Lobby -> neue erstellen (max 4 fuer kurze Wartezeiten).
    loop
      v_code := (
        select string_agg(substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1), '')
        from generate_series(1, 6)
      );
      begin
        insert into public.wizard_games
          (join_code, host_uid, max_players, num_players, status, phase, is_quick)
        values (v_code, v_uid, 4, 1, 'lobby', 'lobby', true)
        returning id into v_id;
        exit;
      exception when unique_violation then
        -- Code-Kollision: neuen Code versuchen
      end;
    end loop;
    insert into public.wizard_players (game_id, uid, seat, name, is_host)
    values (v_id, v_uid, 0, btrim(p_name), true);
    return v_id;
  end if;

  -- Beitreten (wie wizard_join_game, plus Countdown-Logik).
  select coalesce(max(seat), -1) + 1 into v_seat
  from public.wizard_players where game_id = v_game.id;

  insert into public.wizard_players (game_id, uid, seat, name)
  values (v_game.id, v_uid, v_seat, btrim(p_name));

  v_np := v_game.num_players + 1;

  update public.wizard_games
  set num_players = v_np,
      updated_at  = now(),
      starts_at   = case
        when v_np >= max_players then now()                          -- voll -> sofort
        when v_np >= 3 and starts_at is null
          then now() + interval '25 seconds'                         -- Countdown ab 3
        else starts_at
      end
  where id = v_game.id;

  if v_np >= v_game.max_players then
    perform public.wizard_quick_start(v_game.id);                    -- sofort starten
  end if;

  return v_game.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Heartbeat aus dem Quick-Warteraum (haelt die Lobby "frisch")
-- ---------------------------------------------------------------------------
create or replace function public.wizard_quick_ping(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.wizard_games g
  set updated_at = now()
  where g.id = p_game and g.is_quick and g.status = 'lobby'
    and exists (select 1 from public.wizard_players p
                where p.game_id = p_game and p.uid = auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- wizard_join_game: Countdown-Logik auch fuer Code-Beitritte in Quick-Lobbys
-- (Freunde koennen den Warteraum-Code weiter nutzen). Rest unveraendert.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_join_game(p_code text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_game  public.wizard_games%rowtype;
  v_seat  int;
  v_np    int;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name fehlt'; end if;

  select * into v_game from public.wizard_games
  where join_code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;

  -- Bereits dabei? -> nur als Mitglied zurueckkehren (Reconnect).
  if exists (select 1 from public.wizard_players where game_id = v_game.id and uid = v_uid) then
    update public.wizard_players set connected = true
    where game_id = v_game.id and uid = v_uid;
    return v_game.id;
  end if;

  if v_game.status <> 'lobby' then raise exception 'Spiel laeuft bereits'; end if;
  if v_game.num_players >= v_game.max_players then raise exception 'Spiel ist voll'; end if;

  select coalesce(max(seat), -1) + 1 into v_seat
  from public.wizard_players where game_id = v_game.id;

  insert into public.wizard_players (game_id, uid, seat, name)
  values (v_game.id, v_uid, v_seat, btrim(p_name));

  v_np := v_game.num_players + 1;

  update public.wizard_games
  set num_players = v_np,
      updated_at  = now(),
      starts_at   = case
        when is_quick and v_np >= max_players then now()
        when is_quick and v_np >= 3 and starts_at is null
          then now() + interval '25 seconds'
        else starts_at
      end
  where id = v_game.id;

  if v_game.is_quick and v_np >= v_game.max_players then
    perform public.wizard_quick_start(v_game.id);
  end if;

  return v_game.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- wizard_leave_game: faellt eine Quick-Lobby unter 3 Spieler, stoppt der
-- Countdown. Rest unveraendert (Kopie der bestehenden Funktion + ein CASE).
-- ---------------------------------------------------------------------------
create or replace function public.wizard_leave_game(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_game   public.wizard_games%rowtype;
  v_player public.wizard_players%rowtype;
  v_new_host uuid;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then return; end if;

  select * into v_player from public.wizard_players where game_id = p_game and uid = v_uid;
  if not found then return; end if;

  if v_game.status = 'lobby' then
    delete from public.wizard_players where game_id = p_game and uid = v_uid;

    if not exists (select 1 from public.wizard_players where game_id = p_game) then
      delete from public.wizard_games where id = p_game;   -- letzter raus -> Spiel weg
      return;
    end if;

    if v_player.is_host then   -- Host neu vergeben
      select uid into v_new_host from public.wizard_players
      where game_id = p_game order by seat limit 1;
      update public.wizard_players set is_host = (uid = v_new_host) where game_id = p_game;
      update public.wizard_games set host_uid = v_new_host where id = p_game;
    end if;

    update public.wizard_games
    set num_players = num_players - 1,
        starts_at   = case when is_quick and num_players - 1 < 3 then null
                           else starts_at end,
        updated_at  = now()
    where id = p_game;
  else
    -- Als getrennt markieren.
    update public.wizard_players set connected = false where game_id = p_game and uid = v_uid;
    if v_game.status = 'running' then
      -- Wizard kann ohne den Spieler nicht fortgesetzt werden -> Spiel fuer alle beenden.
      update public.wizard_games
      set status = 'aborted', phase = 'finished', current_seat = null, updated_at = now()
      where id = p_game;
    else
      update public.wizard_games set updated_at = now() where id = p_game;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechte: nur angemeldete Nutzer (wie alle anderen wizard_-Funktionen)
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_quick_match(text)',
    'wizard_quick_start(uuid)',
    'wizard_quick_ping(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
