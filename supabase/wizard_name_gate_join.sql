-- Wizard – Namens-Sperre auch beim Spiel-Beitritt/-Erstellen
-- =============================================================================
-- Zusaetzliche Sicherheitsebene zum Namensfilter (siehe wizard_name_filter.sql).
-- Bisher wurde ein gesperrter Name nur beim SETZEN geprueft (wizard_upsert_profile
-- + Client). Falls trotzdem ein gesperrter Name im Profil landet (alter Client,
-- direkter API-Aufruf, Race Condition), soll dieser Spieler GAR NICHT erst ein
-- Spiel/eine Lobby erstellen oder ihr beitreten koennen. Deshalb pruefen die
-- Spiel-RPCs den Namen jetzt selbst noch einmal serverseitig.
-- Idempotent -> kann mehrfach laufen. Nutzt den bereits vorhandenen
-- public.wizard_name_blocked(text).

-- ---------------------------------------------------------------------------
-- Gemeinsame Hilfsfunktion: prueft den uebergebenen Namen UND den aktuell im
-- Profil gespeicherten Namen. Wirft, falls einer davon gesperrt ist.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_assert_name_allowed(p_name text)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid          uuid := auth.uid();
  v_profile_name text;
begin
  -- Der beim Aufruf uebergebene Name (landet in wizard_players.name).
  if p_name is not null and public.wizard_name_blocked(p_name) then
    raise exception 'Dein Spielername ist nicht erlaubt. Bitte ändere ihn zuerst in deinem Profil.';
  end if;

  -- Der gespeicherte Profilname (falls trotzdem ein gesperrter Name drin steckt).
  if v_uid is not null then
    select name into v_profile_name from public.wizard_profiles where uid = v_uid;
    if v_profile_name is not null and public.wizard_name_blocked(v_profile_name) then
      raise exception 'Dein Spielername ist nicht erlaubt. Bitte ändere ihn zuerst in deinem Profil.';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- wizard_create_game: Namens-Sperre vor dem Erstellen (Rest unveraendert).
-- Signatur exakt wie live: (text, int, int, int) returns text.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_create_game(p_name text, p_max integer default 6, p_cards integer default null::integer, p_turn integer default 20)
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
  perform public.wizard_assert_name_allowed(p_name);   -- Namens-Sperre (2. Ebene)
  if p_max < 3 or p_max > 6 then raise exception 'Spielerzahl muss 3 bis 6 sein'; end if;
  if p_cards is not null and p_cards not in (3, 5, 7) then
    raise exception 'Kurzspiel gibt es mit 3, 5 oder 7 Karten';
  end if;
  if p_turn is null or p_turn not in (10, 20, 30, 60) then
    raise exception 'Zugzeit muss 10, 20, 30 oder 60 Sekunden sein';
  end if;

  loop
    v_code := (
      select string_agg(substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1), '')
      from generate_series(1, 6)
    );
    begin
      insert into public.wizard_games
        (join_code, host_uid, max_players, num_players, status, phase, short_cards, turn_seconds)
      values (v_code, v_uid, p_max, 1, 'lobby', 'lobby', p_cards, p_turn)
      returning id into v_game;
      exit;
    exception when unique_violation then
    end;
  end loop;

  insert into public.wizard_players (game_id, uid, seat, name, is_host)
  values (v_game, v_uid, 0, btrim(p_name), true);

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- wizard_join_game: Namens-Sperre vor dem Beitreten (Rest unveraendert).
-- Signatur exakt wie live: (text, text) returns uuid.
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
  perform public.wizard_assert_name_allowed(p_name);   -- Namens-Sperre (2. Ebene)

  select * into v_game from public.wizard_games
  where join_code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Spiel nicht gefunden'; end if;

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
-- wizard_quick_match: Namens-Sperre vor Matchmaking (Rest unveraendert).
-- Signatur exakt wie live: (text) returns uuid.
-- ---------------------------------------------------------------------------
create or replace function public.wizard_quick_match(p_name text)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code  text;
  v_game  public.wizard_games%rowtype;
  v_id    uuid;
  v_seat  int;
  v_np    int;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Name fehlt'; end if;
  perform public.wizard_assert_name_allowed(p_name);   -- Namens-Sperre (2. Ebene)

  delete from public.wizard_games
  where is_quick and status = 'lobby'
    and updated_at < now() - interval '10 minutes';

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

  select * into v_game
  from public.wizard_games
  where is_quick and status = 'lobby'
    and num_players < max_players
    and updated_at > now() - interval '60 seconds'
  order by created_at
  limit 1
  for update;

  if not found then
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
      end;
    end loop;
    insert into public.wizard_players (game_id, uid, seat, name, is_host)
    values (v_id, v_uid, 0, btrim(p_name), true);
    return v_id;
  end if;

  select coalesce(max(seat), -1) + 1 into v_seat
  from public.wizard_players where game_id = v_game.id;

  insert into public.wizard_players (game_id, uid, seat, name)
  values (v_game.id, v_uid, v_seat, btrim(p_name));

  v_np := v_game.num_players + 1;

  update public.wizard_games
  set num_players = v_np,
      updated_at  = now(),
      starts_at   = case
        when v_np >= max_players then now()
        when v_np >= 3 and starts_at is null
          then now() + interval '25 seconds'
        else starts_at
      end
  where id = v_game.id;

  if v_np >= v_game.max_players then
    perform public.wizard_quick_start(v_game.id);
  end if;

  return v_game.id;
end;
$$;

-- Rechte fuer die Funktionen setzen (analog zu den bestehenden RPCs).
do $$
begin
  execute 'revoke all on function public.wizard_assert_name_allowed(text) from public, anon';
  execute 'grant execute on function public.wizard_assert_name_allowed(text) to authenticated';
end $$;
