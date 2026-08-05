-- ============================================================================
-- Magier-Bundle: Server-Inventar-Freischaltung
-- ----------------------------------------------------------------------------
-- Bug (siehe IAP-SETUP.md): das Magier-Bundle (Einmalkauf, 9,99 €) laeuft rein
-- lokal ueber StoreKit und setzt nur das lokale Entitlement 'magier'. Die NEUEN
-- Kristall-Shop-Kosmetika haengen aber am Server-Inventar (wizard_inventory,
-- sonst gekauft via wizard_buy_item) und wurden vom Bundle NICHT freigeschaltet.
-- Kaeufer bekamen also nicht, was das Bundle verspricht.
--
-- Diese Funktion traegt die Bundle-Inhalte serverseitig ins Inventar ein. Sie
-- ist SECURITY DEFINER (schreibt trotz RLS), idempotent (mehrfacher Aufruf ist
-- harmlos, on conflict do nothing) und kann daher sowohl direkt nach dem Kauf
-- als auch bei jedem "Kauf wiederherstellen"/App-Start gefahrlos gerufen werden.
--
-- WICHTIG – PRODUKTENTSCHEIDUNG (von Elia im Zweifel anpassbar):
-- Das Bundle vergibt hier NICHT den gesamten Katalog (das wuerde die
-- Kristall-Oekonomie sprengen und die Echtgeld-Kristallpakete entwerten),
-- sondern ein kuratiertes, thematisch passendes "Magier"-Set aus 5 Gegenstaenden:
--   * av_zauberer        (Avatar  "Zauberer",       rare,      800 Kristalle)
--   * av_schattenmagier  (Avatar  "Schattenmagier", legendary, 1500 Kristalle)
--   * deck_runen         (Deck    "Runen",          epic,      800 Kristalle)
--   * table_magierturm   (Tisch   "Magierturm",     rare,      1000 Kristalle)
--   * back_krone         (Rueckseite "Koenigskrone",epic,      600 Kristalle)
-- Gegenwert ~4700 Kristalle fuer 9,99 € (das gleich teure Kristallpaket gibt
-- 1400) -> starkes, aber begrenztes Bundle. Werbefrei kommt weiterhin ueber das
-- lokale Entitlement 'magier' (ads.js), NICHT ueber diese Funktion.
-- Zum Aendern des Bundle-Inhalts einfach das Array v_items unten anpassen; die
-- Liste im Client (app.js -> MAGIER_BUNDLE_ITEMS, nur fuer die Anzeige/Doku)
-- entsprechend mitziehen.
--
-- DEPLOY: neue Funktion, ersetzt nichts Bestehendes. Reihenfolge egal.
-- ============================================================================

create or replace function public.wizard_grant_bundle(p_bundle text default 'magier')
returns table(ok boolean, granted int, items text[], message text)
language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_items  text[];
  v_id     text;
  v_kind   text;
  v_grant  int := 0;
begin
  if v_uid is null then raise exception 'Nicht angemeldet'; end if;
  if p_bundle is distinct from 'magier' then
    return query select false, 0, array[]::text[], 'Unbekanntes Bundle'; return;
  end if;

  v_items := array['av_zauberer','av_schattenmagier','deck_runen',
                   'table_magierturm','back_krone'];

  foreach v_id in array v_items loop
    -- kind aus dem Katalog holen (falls ein Item mal umbenannt/deaktiviert wird,
    -- wird es einfach uebersprungen statt einen falschen Datensatz zu schreiben).
    select kind into v_kind from public.wizard_catalog
      where item_id = v_id and active;
    if v_kind is not null then
      insert into public.wizard_inventory(uid, item_id, kind)
        values (v_uid, v_id, v_kind)
        on conflict (uid, item_id) do nothing;
      if found then v_grant := v_grant + 1; end if;
    end if;
  end loop;

  return query select true, v_grant, v_items, 'ok';
end; $function$;

-- Rechte: nur angemeldete Nutzer (wie alle anderen wizard_-Funktionen).
revoke all on function public.wizard_grant_bundle(text) from public, anon;
grant execute on function public.wizard_grant_bundle(text) to authenticated;
