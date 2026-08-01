-- Wizard – Gratismonat (erste 30 Tage nach Kontoerstellung frei)
-- =============================================================================
-- In den ersten 30 Tagen nach Kontoerstellung faellt die Notizblock-Sperre
-- komplett weg (unbegrenzt spielen). Ab Tag 31 gilt wieder die normale Logik
-- (tokens.js / requireToken).
--
-- WICHTIG – nicht durch localStorage-Reset umgehbar:
-- Das Konto-Alter kommt NICHT aus einem Client-Flag, sondern serverseitig aus
-- auth.users.created_at (die anonyme Sitzung wird beim ersten Start angelegt;
-- wandelt sie sich per updateUser in ein E-Mail-Konto, bleibt die uid – und
-- damit created_at – erhalten). Ein Zuruecksetzen des localStorage loescht nur
-- den Client-Cache; beim naechsten Start liefert der Server dasselbe
-- Erstellungsdatum -> kein neuer Gratismonat.
--
-- SECURITY DEFINER, damit die Funktion auth.users lesen darf (der aufrufende
-- authenticated/anon-Rolle fehlt dieses Recht). Liest ausschliesslich die EIGENE
-- Zeile (where id = auth.uid()). Idempotent -> kann mehrfach laufen.

create or replace function public.wizard_free_period()
returns json
language plpgsql
security definer
set search_path = public, auth as $$
declare
  v_uid      uuid := auth.uid();
  v_created  timestamptz;
  v_days     int;
  v_free_days constant int := 30;
begin
  if v_uid is null then
    return json_build_object('free', false, 'created_at', null, 'days_left', 0);
  end if;

  -- Massgeblich: Erstellungsdatum des Auth-Kontos.
  select created_at into v_created from auth.users where id = v_uid;
  -- Fallback (sollte auth.users unerwartet leer sein): Profil-Erstellung.
  if v_created is null then
    select created_at into v_created from public.wizard_profiles where uid = v_uid;
  end if;
  if v_created is null then
    return json_build_object('free', false, 'created_at', null, 'days_left', 0);
  end if;

  v_days := floor(extract(epoch from (now() - v_created)) / 86400.0)::int;

  return json_build_object(
    'free',       v_days < v_free_days,
    'created_at', v_created,
    'days_left',  greatest(0, v_free_days - v_days)
  );
end;
$$;

-- Rechte: nur angemeldete Sitzungen (auch anonyme -> Rolle authenticated).
do $$
begin
  execute 'revoke all on function public.wizard_free_period() from public';
  execute 'grant execute on function public.wizard_free_period() to authenticated, anon';
end $$;
