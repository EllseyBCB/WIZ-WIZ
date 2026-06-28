-- Wizard – Online-Multiplayer: Supabase-Schema
-- =============================================================================
-- Server-autoritatives Design: Clients schreiben den Spielzustand NIE direkt,
-- sondern rufen ausschliesslich die RPC-Funktionen (SECURITY DEFINER) auf.
-- Diese pruefen Mitgliedschaft, Zugreihenfolge und Spielregeln in SQL.
-- Fremde Haende und das ungemischte Deck sind per Row Level Security fuer
-- Clients unsichtbar; oeffentlicher Zustand wird per Realtime verteilt.
--
-- Anwenden:
--   * per MCP `apply_migration`, oder
--   * im Supabase-SQL-Editor dieses Skript ausfuehren.
-- Zusaetzlich noetig: Authentication -> Anonymous Sign-In aktivieren.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

-- Spiele: Lobby + oeffentlicher Rundenzustand (von Mitgliedern lesbar)
create table if not exists public.wizard_games (
  id               uuid primary key default gen_random_uuid(),
  join_code        text not null unique,            -- 6-stelliger Lobby-Code
  status           text not null default 'lobby',   -- lobby | running | finished | aborted
  host_uid         uuid not null,
  max_players      int  not null default 6,
  num_players      int  not null default 0,
  total_rounds     int,                             -- = 60 / num_players (bei Start)
  round_no         int  not null default 0,         -- aktuelle Runde (1..total_rounds)
  cards_this_round int  not null default 0,         -- = round_no
  dealer_seat      int,                             -- Sitz des Gebers dieser Runde
  trump_color      text,                            -- 'R'|'Y'|'G'|'B' | null (kein Trumpf)
  trump_card       text,                            -- aufgedeckte Karte | null (letzte Runde)
  trump_pending    boolean not null default false,  -- true: Zauberer aufgedeckt, Geber waehlt
  phase            text not null default 'lobby',   -- lobby|trumpselect|bidding|playing|scoring|finished
  current_seat     int,                             -- wer ist am Zug (Gebot oder Karte)
  lead_seat        int,                             -- wer hat den aktuellen Stich angespielt
  led_color        text,                            -- Anspielfarbe | null
  trick_no         int  not null default 0,         -- 1..cards_this_round
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Spieler: Sitz, Identitaet, laufende Werte (von Mitgliedern lesbar)
create table if not exists public.wizard_players (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.wizard_games (id) on delete cascade,
  uid         uuid not null references auth.users (id) on delete cascade,
  seat        int  not null,                        -- 0-basiert, feste Zugreihenfolge
  name        text not null,
  is_host     boolean not null default false,
  connected   boolean not null default true,
  total_score int  not null default 0,
  bid         int,                                  -- Gebot der aktuellen Runde
  tricks_won  int  not null default 0,              -- gewonnene Stiche der Runde
  joined_at   timestamptz not null default now(),
  unique (game_id, uid)
);
-- Sitz eindeutig je Spiel, aber DEFERRABLE: erlaubt das Umnummerieren bei Start.
alter table public.wizard_players
  drop constraint if exists wizard_players_game_seat_key;
alter table public.wizard_players
  add constraint wizard_players_game_seat_key unique (game_id, seat);

-- Haende: aktuelles Blatt je Spieler/Runde (RLS: nur eigene Zeilen)
create table if not exists public.wizard_hands (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.wizard_games (id) on delete cascade,
  round_no  int  not null,
  uid       uuid not null,
  seat      int  not null,
  card      text not null,
  played    boolean not null default false,
  unique (game_id, round_no, card)
);

-- Geheimnis: ungemischtes Restdeck (RLS aktiv, KEINE Policy -> nie lesbar)
create table if not exists public.wizard_secrets (
  game_id   uuid primary key references public.wizard_games (id) on delete cascade,
  round_no  int  not null,
  deck      text[] not null
);

-- Gespielte Karten / Stich-Historie (von Mitgliedern lesbar)
create table if not exists public.wizard_plays (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.wizard_games (id) on delete cascade,
  round_no    int  not null,
  trick_no    int  not null,
  play_order  int  not null,                        -- 0..num_players-1 im Stich
  seat        int  not null,
  uid         uuid not null,
  card        text not null,
  is_winner   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (game_id, round_no, trick_no, seat),
  unique (game_id, round_no, trick_no, play_order)
);

-- Wertungshistorie je Runde (von Mitgliedern lesbar)
create table if not exists public.wizard_round_scores (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.wizard_games (id) on delete cascade,
  round_no    int  not null,
  seat        int  not null,
  uid         uuid not null,
  bid         int  not null,
  tricks_won  int  not null,
  round_score int  not null,
  total_after int  not null,
  unique (game_id, round_no, seat)
);

-- ---------------------------------------------------------------------------
-- Indizes
-- ---------------------------------------------------------------------------
create index if not exists idx_wizard_players_game   on public.wizard_players (game_id);
create index if not exists idx_wizard_hands_game_uid  on public.wizard_hands (game_id, uid, round_no);
create index if not exists idx_wizard_plays_trick     on public.wizard_plays (game_id, round_no, trick_no);
create index if not exists idx_wizard_scores_game     on public.wizard_round_scores (game_id, round_no);

-- ---------------------------------------------------------------------------
-- Kartendeck: 60 Codes (R/Y/G/B 1-13 + Z1..Z4 + N1..N4)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_deck() returns text[]
language sql immutable as $$
  select (
    select array_agg(c || r::text)
    from unnest(array['R','Y','G','B']) as c
    cross join generate_series(1, 13) as r
  ) || array['Z1','Z2','Z3','Z4','N1','N2','N3','N4'];
$$;

-- ---------------------------------------------------------------------------
-- Mitgliedschafts-Check (SECURITY DEFINER -> umgeht RLS, keine Rekursion)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_is_member(g uuid) returns boolean
language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.wizard_players
    where game_id = g and uid = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.wizard_games        enable row level security;
alter table public.wizard_players      enable row level security;
alter table public.wizard_hands        enable row level security;
alter table public.wizard_secrets      enable row level security;
alter table public.wizard_plays        enable row level security;
alter table public.wizard_round_scores enable row level security;

-- Lesen: nur Mitglieder des Spiels; Schreiben: ausschliesslich ueber RPCs.
drop policy if exists wz_games_select   on public.wizard_games;
drop policy if exists wz_players_select on public.wizard_players;
drop policy if exists wz_hands_select   on public.wizard_hands;
drop policy if exists wz_plays_select   on public.wizard_plays;
drop policy if exists wz_scores_select  on public.wizard_round_scores;

create policy wz_games_select on public.wizard_games
  for select using (public.wizard_is_member(id));

create policy wz_players_select on public.wizard_players
  for select using (public.wizard_is_member(game_id));

-- Haende: jede:r sieht nur das EIGENE Blatt.
create policy wz_hands_select on public.wizard_hands
  for select using (uid = auth.uid());

create policy wz_plays_select on public.wizard_plays
  for select using (public.wizard_is_member(game_id));

create policy wz_scores_select on public.wizard_round_scores
  for select using (public.wizard_is_member(game_id));

-- wizard_secrets erhaelt BEWUSST keine Policy -> fuer alle Clients unsichtbar.

-- ---------------------------------------------------------------------------
-- Realtime: nur oeffentliche Tabellen publizieren (NICHT hands/secrets)
-- ---------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.wizard_games;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wizard_players;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wizard_plays;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wizard_round_scores; exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: Spiel erstellen
-- ---------------------------------------------------------------------------
create or replace function public.wizard_create_game(p_name text, p_max int default 6)
returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- ohne I,O,0,1
  v_code  text;
  v_game  uuid;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name fehlt'; end if;
  if p_max < 3 or p_max > 6 then raise exception 'Spielerzahl muss 3 bis 6 sein'; end if;

  loop
    v_code := (
      select string_agg(substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1), '')
      from generate_series(1, 6)
    );
    begin
      insert into public.wizard_games (join_code, host_uid, max_players, num_players, status, phase)
      values (v_code, v_uid, p_max, 1, 'lobby', 'lobby')
      returning id into v_game;
      exit;
    exception when unique_violation then
      -- Code-Kollision: neuen Code versuchen
    end;
  end loop;

  insert into public.wizard_players (game_id, uid, seat, name, is_host)
  values (v_game, v_uid, 0, btrim(p_name), true);

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Spiel beitreten (idempotent -> erlaubt Reconnect)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_join_game(p_code text, p_name text)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_game  public.wizard_games%rowtype;
  v_seat  int;
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

  update public.wizard_games
  set num_players = num_players + 1, updated_at = now()
  where id = v_game.id;

  return v_game.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Spiel verlassen
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
    set num_players = num_players - 1, updated_at = now()
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
-- intern: Runde austeilen + Trumpf bestimmen
-- ---------------------------------------------------------------------------
create or replace function public.wizard_deal_round(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_game  public.wizard_games%rowtype;
  v_deck  text[];
  v_n     int;
  v_np    int;
  v_dealt int;
  v_flip  text;
  v_trump text;
  v_pending boolean := false;
  v_phase text;
  v_dealer int;
  v_first  int;
  r record;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  v_np := v_game.num_players;
  v_n  := v_game.round_no + 1;          -- neue Rundennummer = Kartenzahl

  -- Geber: Runde 1 behaelt den gewaehlten Geber, danach reihum.
  if v_game.round_no = 0 then
    v_dealer := v_game.dealer_seat;
  else
    v_dealer := (v_game.dealer_seat + 1) % v_np;
  end if;

  -- Spielerwerte der Runde zuruecksetzen, altes Blatt loeschen.
  update public.wizard_players set bid = null, tricks_won = 0 where game_id = p_game;
  delete from public.wizard_hands where game_id = p_game;

  -- Mischen.
  select array_agg(c order by random()) into v_deck
  from unnest(public.wizard_deck()) as c;

  -- Austeilen: Sitze sind 0..np-1 (bei Start umnummeriert).
  for r in select seat, uid from public.wizard_players where game_id = p_game order by seat loop
    insert into public.wizard_hands (game_id, round_no, uid, seat, card)
    select p_game, v_n, r.uid, r.seat, unnest(v_deck[(r.seat*v_n + 1):(r.seat*v_n + v_n)]);
  end loop;

  v_dealt := v_np * v_n;

  -- Trumpf bestimmen.
  if v_dealt >= 60 then                 -- letzte Runde: alle Karten verteilt
    v_trump := null; v_flip := null; v_pending := false;
  else
    v_flip := v_deck[v_dealt + 1];
    if v_flip like 'Z%' then            -- Zauberer -> Trumpf = Farbe des Zauberers
      v_trump := case v_flip when 'Z1' then 'B' when 'Z2' then 'R' when 'Z3' then 'Y' when 'Z4' then 'G' else null end; v_pending := false;
    elsif v_flip like 'N%' then         -- Narr -> kein Trumpf
      v_trump := null; v_pending := false;
    else                                -- Farbkarte
      v_trump := substr(v_flip, 1, 1); v_pending := false;
    end if;
  end if;

  -- Restdeck wegschliessen (nur intern sichtbar).
  insert into public.wizard_secrets (game_id, round_no, deck)
  values (p_game, v_n, v_deck[(v_dealt + 1):60])
  on conflict (game_id) do update set round_no = excluded.round_no, deck = excluded.deck;

  -- Phase setzen: erst Trumpfwahl (falls Zauberer), sonst direkt Reizen.
  if v_pending then
    v_phase := 'trumpselect';
    v_first := v_dealer;                -- Geber waehlt Trumpf
  else
    v_phase := 'bidding';
    v_first := (v_dealer + 1) % v_np;   -- links vom Geber beginnt
  end if;

  update public.wizard_games set
    round_no = v_n, cards_this_round = v_n, dealer_seat = v_dealer,
    trump_color = v_trump, trump_card = v_flip, trump_pending = v_pending,
    phase = v_phase, current_seat = v_first, lead_seat = (v_dealer + 1) % v_np,
    led_color = null, trick_no = 0, updated_at = now()
  where id = p_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Spiel starten (nur Host, aus der Lobby)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_start_game(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_game public.wizard_games%rowtype;
  v_np  int;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.host_uid <> v_uid then raise exception 'Nur der Host darf starten'; end if;
  if v_game.status <> 'lobby' then raise exception 'Spiel laeuft bereits'; end if;

  select count(*) into v_np from public.wizard_players where game_id = p_game;
  if v_np < 3 or v_np > 6 then raise exception 'Es braucht 3 bis 6 Spieler'; end if;

  -- Sitze 0..np-1 zusammenhaengend machen (Lobby-Luecken bereinigen).
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

  perform public.wizard_deal_round(p_game);   -- Runde 1 austeilen
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Trumpf waehlen (nur Geber, wenn Zauberer aufgedeckt)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_choose_trump(p_game uuid, p_color text)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_game public.wizard_games%rowtype;
  v_seat int;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.phase <> 'trumpselect' then raise exception 'Keine Trumpfwahl faellig'; end if;

  select seat into v_seat from public.wizard_players where game_id = p_game and uid = v_uid;
  if v_seat is null or v_seat <> v_game.dealer_seat then
    raise exception 'Nur der Geber waehlt den Trumpf';
  end if;
  if p_color not in ('R','Y','G','B') then raise exception 'Ungueltige Farbe'; end if;

  update public.wizard_games set
    trump_color = p_color, trump_pending = false, phase = 'bidding',
    current_seat = (dealer_seat + 1) % num_players, updated_at = now()
  where id = p_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Gebot abgeben
-- ---------------------------------------------------------------------------
create or replace function public.wizard_place_bid(p_game uuid, p_bid int)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_game public.wizard_games%rowtype;
  v_seat int;
  v_placed int;
  v_already int;
  v_sum int;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.phase <> 'bidding' then raise exception 'Gerade kein Reizen'; end if;

  select seat into v_seat from public.wizard_players where game_id = p_game and uid = v_uid;
  if v_seat is null or v_seat <> v_game.current_seat then raise exception 'Nicht am Zug'; end if;
  if p_bid < 0 or p_bid > v_game.cards_this_round then raise exception 'Ungueltiges Gebot'; end if;

  -- Hook-/Vorhand-Regel: die/der letzte Bietende darf die Summe der Ansagen
  -- nicht der Stichzahl gleichmachen.
  select count(*), coalesce(sum(bid), 0) into v_already, v_sum
  from public.wizard_players where game_id = p_game and bid is not null;
  if v_already = v_game.num_players - 1 and v_sum + p_bid = v_game.cards_this_round then
    raise exception 'Summe der Ansagen darf nicht der Stichzahl (%) entsprechen', v_game.cards_this_round;
  end if;

  update public.wizard_players set bid = p_bid where game_id = p_game and uid = v_uid;

  select count(*) into v_placed from public.wizard_players
  where game_id = p_game and bid is not null;

  if v_placed >= v_game.num_players then
    -- Alle haben gereizt -> Stichspiel beginnt.
    update public.wizard_games set
      phase = 'playing', trick_no = 1,
      lead_seat = (dealer_seat + 1) % num_players,
      current_seat = (dealer_seat + 1) % num_players,
      led_color = null, updated_at = now()
    where id = p_game;
  else
    update public.wizard_games set
      current_seat = (current_seat + 1) % num_players, updated_at = now()
    where id = p_game;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- intern: Runde werten (Punkte vergeben + Historie schreiben)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_score_round(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_game public.wizard_games%rowtype;
  r record;
  v_score int;
  v_total int;
begin
  select * into v_game from public.wizard_games where id = p_game;
  for r in select * from public.wizard_players where game_id = p_game order by seat loop
    if r.tricks_won = coalesce(r.bid, -999) then
      v_score := 20 + 10 * r.bid;
    else
      v_score := -10 * abs(r.tricks_won - coalesce(r.bid, 0));
    end if;
    v_total := r.total_score + v_score;

    update public.wizard_players set total_score = v_total where id = r.id;

    insert into public.wizard_round_scores
      (game_id, round_no, seat, uid, bid, tricks_won, round_score, total_after)
    values
      (p_game, v_game.round_no, r.seat, r.uid, coalesce(r.bid,0), r.tricks_won, v_score, v_total);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Karte spielen (Herzstueck – Regeln, Stich-Aufloesung, Weiterschaltung)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_play_card(p_game uuid, p_card text)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_game  public.wizard_games%rowtype;
  v_seat  int;
  v_first_nonjester text;   -- erste Nicht-Narr-Karte im Stich (vor diesem Zug)
  v_lead  text;             -- geltende Anspielfarbe (vor diesem Zug)
  v_order int;
  v_count int;
  v_lead_after text;
  v_winner_seat int;
begin
  select * into v_game from public.wizard_games where id = p_game for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;
  if v_game.phase <> 'playing' then raise exception 'Gerade kein Stichspiel'; end if;

  select seat into v_seat from public.wizard_players where game_id = p_game and uid = v_uid;
  if v_seat is null or v_seat <> v_game.current_seat then raise exception 'Nicht am Zug'; end if;

  -- Besitzt der Spieler die Karte und ist sie noch nicht gespielt?
  if not exists (
    select 1 from public.wizard_hands
    where game_id = p_game and round_no = v_game.round_no
      and uid = v_uid and card = p_card and played = false
  ) then raise exception 'Karte nicht auf der Hand'; end if;

  -- Anspielfarbe aus bisherigen Stich-Karten ableiten (erste Nicht-Narr-Karte).
  select card into v_first_nonjester
  from public.wizard_plays
  where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
    and card not like 'N%'
  order by play_order limit 1;

  if v_first_nonjester is null or v_first_nonjester like 'Z%' then
    v_lead := null;                         -- noch keine Farbe / Zauberer angespielt
  else
    v_lead := substr(v_first_nonjester, 1, 1);
  end if;

  -- Bedien-Pflicht: nur Farbkarten betroffen; Zauberer/Narr sind immer erlaubt.
  if v_lead is not null and p_card not like 'Z%' and p_card not like 'N%'
     and substr(p_card, 1, 1) <> v_lead then
    if exists (
      select 1 from public.wizard_hands
      where game_id = p_game and round_no = v_game.round_no and uid = v_uid
        and played = false and card like v_lead || '%'
    ) then
      raise exception 'Farbe muss bedient werden';
    end if;
  end if;

  -- Zug verbuchen.
  select count(*) into v_order from public.wizard_plays
  where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no;

  insert into public.wizard_plays
    (game_id, round_no, trick_no, play_order, seat, uid, card)
  values (p_game, v_game.round_no, v_game.trick_no, v_order, v_seat, v_uid, p_card);

  update public.wizard_hands set played = true
  where game_id = p_game and round_no = v_game.round_no and uid = v_uid and card = p_card;

  -- Anspielfarbe nach diesem Zug fuer die Anzeige aktualisieren.
  select card into v_first_nonjester
  from public.wizard_plays
  where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
    and card not like 'N%'
  order by play_order limit 1;
  if v_first_nonjester is null or v_first_nonjester like 'Z%' then
    v_lead_after := null;
  else
    v_lead_after := substr(v_first_nonjester, 1, 1);
  end if;

  v_count := v_order + 1;   -- Karten in diesem Stich nach dem Zug

  if v_count < v_game.num_players then
    -- Stich laeuft weiter -> naechster Spieler.
    update public.wizard_games set
      current_seat = (current_seat + 1) % num_players,
      led_color = v_lead_after, updated_at = now()
    where id = p_game;
    return;
  end if;

  -- Stich komplett -> Gewinner ermitteln.
  -- 1) Erster Zauberer gewinnt.
  select seat into v_winner_seat from public.wizard_plays
  where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
    and card like 'Z%'
  order by play_order limit 1;

  if v_winner_seat is null then
    if not exists (
      select 1 from public.wizard_plays
      where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
        and card not like 'N%'
    ) then
      -- 2) Nur Narren -> erste Karte gewinnt.
      select seat into v_winner_seat from public.wizard_plays
      where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
      order by play_order limit 1;
    elsif v_game.trump_color is not null and exists (
      select 1 from public.wizard_plays
      where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
        and substr(card,1,1) = v_game.trump_color and card not like 'Z%' and card not like 'N%'
    ) then
      -- 3a) Hoechster Trumpf.
      select seat into v_winner_seat from public.wizard_plays
      where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
        and substr(card,1,1) = v_game.trump_color and card not like 'Z%' and card not like 'N%'
      order by substr(card,2)::int desc limit 1;
    else
      -- 3b) Hoechste Anspielfarbe.
      select seat into v_winner_seat from public.wizard_plays
      where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
        and substr(card,1,1) = v_lead_after and card not like 'Z%' and card not like 'N%'
      order by substr(card,2)::int desc limit 1;
    end if;
  end if;

  update public.wizard_plays set is_winner = true
  where game_id = p_game and round_no = v_game.round_no and trick_no = v_game.trick_no
    and seat = v_winner_seat;

  update public.wizard_players set tricks_won = tricks_won + 1
  where game_id = p_game and seat = v_winner_seat;

  if v_game.trick_no >= v_game.cards_this_round then
    -- Runde vorbei -> werten.
    perform public.wizard_score_round(p_game);
    if v_game.round_no >= v_game.total_rounds then
      update public.wizard_games set
        status = 'finished', phase = 'finished', current_seat = null, updated_at = now()
      where id = p_game;
    else
      perform public.wizard_deal_round(p_game);   -- naechste Runde
    end if;
  else
    -- Naechster Stich, Gewinner spielt an.
    update public.wizard_games set
      trick_no = trick_no + 1, lead_seat = v_winner_seat,
      current_seat = v_winner_seat, led_color = null, updated_at = now()
    where id = p_game;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: Spiel abbrechen (nur Host)
-- ---------------------------------------------------------------------------
create or replace function public.wizard_abort_game(p_game uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  update public.wizard_games set status = 'aborted', phase = 'finished', updated_at = now()
  where id = p_game and host_uid = v_uid;
  if not found then raise exception 'Nur der Host darf abbrechen'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechte: nur angemeldete Nutzer:innen duerfen die RPCs aufrufen
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_create_game(text,int)', 'wizard_join_game(text,text)',
    'wizard_leave_game(uuid)', 'wizard_start_game(uuid)',
    'wizard_choose_trump(uuid,text)', 'wizard_place_bid(uuid,int)',
    'wizard_play_card(uuid,text)', 'wizard_abort_game(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- =============================================================================
-- Freunde + Spielverlauf / Punkte-System
-- =============================================================================
-- Da die Anmeldung anonym ist (stabile uid je Geraet, aber kein Konto), finden
-- sich Freunde ueber einen kurzen, teilbaren Freundescode. Profile + Freund-
-- schaften liegen in eigenen Tabellen; der Verlauf wird aus den bestehenden
-- Spiel-Tabellen (status='finished') zusammengestellt. Zugriff ausschliesslich
-- ueber SECURITY-DEFINER-RPCs.

-- Profil je Nutzer:in: Anzeigename + eindeutiger Freundescode.
create table if not exists public.wizard_profiles (
  uid         uuid primary key references auth.users (id) on delete cascade,
  name        text not null default 'Spieler',
  friend_code text not null unique,
  avatar      text,                              -- gewaehlter Emoji-Avatar
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.wizard_profiles add column if not exists avatar text;

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

-- ---------------------------------------------------------------------------
-- RPC: eigenes Profil anlegen/aktualisieren (Freundescode wird einmalig erzeugt)
-- p_name = null -> Name unveraendert lassen (nur sicherstellen, dass es existiert)
-- ---------------------------------------------------------------------------
drop function if exists public.wizard_upsert_profile(text);
create or replace function public.wizard_upsert_profile(p_name text default null, p_avatar text default null)
returns json
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- ohne I,O,0,1
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
        -- uid bereits vorhanden (Race) -> bestehendes Profil nehmen
        if exists (select 1 from public.wizard_profiles where uid = v_uid) then
          select * into v_row from public.wizard_profiles where uid = v_uid;
          exit;
        end if;
        -- sonst Code-Kollision -> neuen Code versuchen
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

-- ---------------------------------------------------------------------------
-- RPC: Freund:in per Code hinzufuegen (beidseitig)
-- ---------------------------------------------------------------------------
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
  perform public.wizard_upsert_profile(null);   -- eigenes Profil sicherstellen

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

-- ---------------------------------------------------------------------------
-- RPC: Freund:in entfernen (beidseitig)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RPC: Freundesliste inkl. gemeinsamer Spiele + Siege der Freunde
-- ---------------------------------------------------------------------------
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
        -- Spiele, in denen die/der Freund:in (mit) die hoechste Punktzahl hatte
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

-- ---------------------------------------------------------------------------
-- RPC: Eigener Spielverlauf (abgeschlossene Online-Spiele)
-- Liefert je Spiel: Datum, Status und alle Teilnehmer mit Endpunktzahl
-- (absteigend sortiert -> erstes Element = Sieger:in).
-- ---------------------------------------------------------------------------
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

-- Rechte fuer die Freunde-/Verlauf-RPCs.
do $$
declare fn text;
begin
  foreach fn in array array[
    'wizard_upsert_profile(text,text)', 'wizard_add_friend(text)',
    'wizard_remove_friend(uuid)', 'wizard_list_friends()',
    'wizard_match_history()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;

-- =============================================================================
-- Einladungen: Freund:innen direkt ins Lobby-Spiel einladen (siehe auch
-- supabase/wizard_invites_migration.sql)
-- =============================================================================
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

do $$
begin
  begin alter publication supabase_realtime add table public.wizard_invites; exception when duplicate_object then null; end;
end $$;

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

-- =============================================================================
-- Gruppen + Rangliste (siehe supabase/wizard_groups_migration.sql)
-- =============================================================================
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

-- ---------------------------------------------------------------------------
-- RPC: Avatare aller Mitspieler eines Spiels (fuer die Tisch-Anzeige).
-- SECURITY DEFINER umgeht die Profil-RLS sicher: nur wer selbst Mitglied des
-- Spiels ist, erhaelt die Avatare der uebrigen Mitspieler.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_member_avatars(p_game uuid)
returns table(uid uuid, avatar text)
language sql security definer stable
set search_path = public as $$
  select pl.uid, coalesce(pr.avatar, '🧙') as avatar
  from public.wizard_players pl
  left join public.wizard_profiles pr on pr.uid = pl.uid
  where pl.game_id = p_game
    and public.wizard_is_member(p_game);
$$;

do $$
begin
  execute 'revoke all on function public.wizard_member_avatars(uuid) from public, anon;';
  execute 'grant execute on function public.wizard_member_avatars(uuid) to authenticated;';
end $$;
