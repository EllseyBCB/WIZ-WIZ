-- Wizard – Server-seitiger Namensfilter
-- =============================================================================
-- Verhindert, dass beleidigende/diskriminierende Spielernamen gespeichert
-- werden (Rangliste, Lobby, Multiplayer sind fuer andere sichtbar -> Apple
-- Guideline 1.2). Spiegelt die Client-Logik aus moderation.js, damit der Filter
-- nicht durch direkte API-Aufrufe umgangen werden kann.
-- Idempotent -> kann mehrfach laufen.

create or replace function public.wizard_name_blocked(p_name text)
returns boolean
language plpgsql
immutable
set search_path = public as $$
declare
  v_flat  text;
  v_coll  text;
  v_term  text;
  v_tok   text;
  v_slurs text[] := array[
    'nigger','nigga','niggr','negro','faggot','retard','wetback','sandnigger',
    'hurensohn','schwuchtel','schwuchtl','kanake','kanacke','missgeburt',
    'kinderficker','judensau','judenvergasen','hakenkreuz','heilhitler',
    'sieghail','untermensch','vergasen'
  ];
  -- Uebliche Schimpfwoerter: werden wie v_slurs als Teilzeichenkette gesucht
  -- (z. B. faengt 'hure' auch 'huren'/'hurensohn' ab), bewusst ohne
  -- Wortgrenzen-Pruefung -> Sicherheit vor vereinzelten Fehlalarmen.
  v_words text[] := array[
    'fuck','fucker','shit','bullshit','cunt','bitch','whore','slut',
    'pussy','asshole','bastard','wanker','twat','prick','fag','spic','kike',
    'coon','gook','paki','dyke','tranny','chink','nazi','hitler','neger','fotze',
    'nutte','nutten','schlampe','hure','arsch','arschloch','scheisse','scheiss',
    'kacke','wichser','wixer','spast','spasti','mongo','mongoloid','schwanz',
    'muschi','ficker','ficken','fick'
  ];
  -- Kurze/haeufige Fragmente: nur als eigenstaendiges Wort gesperrt, sonst
  -- blockt 'ass' auch 'Sascha'/'Klassik'/'Massimo'.
  v_boundary text[] := array['ass'];
begin
  if p_name is null or btrim(p_name) = '' then
    return false;
  end if;

  -- Leetspeak/Ersatzzeichen zurueckfuehren, dann nur Buchstaben behalten.
  v_flat := translate(lower(p_name), '01345789@$!|', 'oieastbgasii');
  v_flat := regexp_replace(v_flat, '[^a-z]', '', 'g');
  v_coll := regexp_replace(v_flat, '(.)\1+', '\1', 'g');   -- gestreckte Schreibweisen

  foreach v_term in array v_slurs || v_words loop
    if v_flat like '%' || v_term || '%'
       or v_coll like '%' || v_term || '%'
       or v_coll like '%' || regexp_replace(v_term, '(.)\1+', '\1', 'g') || '%' then
      return true;
    end if;
  end loop;

  for v_tok in
    select regexp_replace(
             translate(lower(t), '01345789@$!|', 'oieastbgasii'),
             '[^a-z]', '', 'g')
    from regexp_split_to_table(
           regexp_replace(p_name, '([a-z])([A-Z])', '\1 \2', 'g'),
           '[^A-Za-z0-9]+') as t
  loop
    if v_tok is null or v_tok = '' then continue; end if;
    if v_tok = any(v_boundary)
       or regexp_replace(v_tok, '(.)\1+', '\1', 'g') = any(v_boundary) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- wizard_upsert_profile neu: lehnt gesperrte Namen ab, bevor gespeichert wird.
-- (Signatur unveraendert -> ersetzt nur den Rumpf aus wizard_profiles_avatar.sql.)
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

  if p_name is not null and public.wizard_name_blocked(p_name) then
    raise exception 'Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.';
  end if;

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

-- Rechte fuer die Funktionen setzen.
do $$
begin
  execute 'revoke all on function public.wizard_upsert_profile(text,text) from public, anon';
  execute 'grant execute on function public.wizard_upsert_profile(text,text) to authenticated';
end $$;
