-- Wizard – Bestehende beleidigende Namen bereinigen
-- =============================================================================
-- Ersetzt bereits gespeicherte Namen, die der Filter (wizard_name_blocked)
-- ablehnt, durch einen neutralen Platzhalter "Spieler <Kurz-ID>".
-- Voraussetzung: wizard_name_filter.sql wurde vorher eingespielt.
--
-- NICHT automatisch ausgefuehrt. Vor dem Ausfuehren zuerst die SELECT-Vorschau
-- laufen lassen, dann bei Bedarf das UPDATE.

-- 1) Vorschau: welche Namen wuerden ersetzt?
-- select uid, name, 'Spieler ' || upper(left(uid::text, 4)) as neuer_name
-- from public.wizard_profiles
-- where public.wizard_name_blocked(name);

-- 2) Ersetzen (Profile).
update public.wizard_profiles
set name = 'Spieler ' || upper(left(uid::text, 4)),
    updated_at = now()
where public.wizard_name_blocked(name);

-- 3) Optional: falls Spielernamen auch in wizard_players gespeichert sind und
--    dort sichtbar bleiben, analog bereinigen. Nur ausfuehren, wenn die
--    Spalte existiert (Vorschau vorher pruefen).
-- update public.wizard_players
-- set name = 'Spieler ' || upper(left(uid::text, 4))
-- where public.wizard_name_blocked(name);
