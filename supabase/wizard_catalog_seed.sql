-- ---------------------------------------------------------------------------
-- Seed fuer public.wizard_catalog – die "Preis-Wahrheit" fuer Kristall-/Gold-
-- Kaeufe. Muss zu shop-catalog.js (SHOP_SECTIONS) passen: item_id, kind, cost,
-- currency, rarity sind identisch. Ohne passende Zeile hier schlaegt der echte
-- Kauf mit "Artikel nicht gefunden" fehl (Ausnahme: Owner-/Dev-Unlock).
--
-- Voraussetzung: wizard_economy_migration.sql wurde ausgefuehrt (Tabelle existiert).
-- Idempotent: erneut ausfuehrbar (on conflict do update). Im Supabase-SQL-Editor
-- ausfuehren. Neue Ware: hier UND in shop-catalog.js eintragen.
--
-- Nicht enthalten: kostenlose/Standard-Items (deck_standard) – die werden nie
-- ueber den Server gekauft.
-- ---------------------------------------------------------------------------

insert into public.wizard_catalog (item_id, kind, cost, currency, rarity) values
  -- Avatare (Kristalle)
  ('av_eule',            'avatar', 500,   'crystals', 'common'),
  ('av_zauberer',        'avatar', 800,   'crystals', 'rare'),
  ('av_hexe',            'avatar', 800,   'crystals', 'rare'),
  ('av_kristallgolem',   'avatar', 1000,  'crystals', 'epic'),
  ('av_drache',          'avatar', 1200,  'crystals', 'epic'),
  ('av_einhorn',         'avatar', 1200,  'crystals', 'epic'),
  ('av_phoenix',         'avatar', 1500,  'crystals', 'legendary'),
  ('av_schattenmagier',  'avatar', 1500,  'crystals', 'legendary'),

  -- Kartendecks (Kristalle).  ACHTUNG: nur Decks mit fertigem Bild-Ordner
  -- (folder in shop-catalog.js) sind auch auswaehlbar. Aktuell nur deck_kristall
  -- ("Arkanum"). Die uebrigen sind Platzhalter – Kauf moeglich, Auswahl (noch)
  -- nicht. Zeile erst freigeben, wenn der Ordner cards/decks/<name>/ existiert.
  ('deck_kristall',      'deck', 800,  'crystals', 'rare'),
  ('deck_feuer',         'deck', 800,  'crystals', 'rare'),
  ('deck_eis',           'deck', 800,  'crystals', 'rare'),
  ('deck_wald',          'deck', 800,  'crystals', 'rare'),
  ('deck_schatten',      'deck', 800,  'crystals', 'epic'),
  ('deck_himmel',        'deck', 800,  'crystals', 'epic'),
  ('deck_runen',         'deck', 800,  'crystals', 'epic'),
  ('deck_steampunk',     'deck', 800,  'crystals', 'epic'),
  ('deck_galaxie',       'deck', 800,  'crystals', 'legendary'),

  -- Spielfelder (Kristalle)
  ('table_waldlichtung',  'table', 2000, 'crystals', 'legendary'),
  ('table_mystic',        'table', 1800, 'crystals', 'legendary'),
  ('table_zauberwald',    'table', 800,  'crystals', 'rare'),
  ('table_magierturm',    'table', 800,  'crystals', 'rare'),
  ('table_bibliothek',    'table', 800,  'crystals', 'rare'),
  ('table_kristallhoehle','table', 1000, 'crystals', 'epic'),
  ('table_vulkan',        'table', 1000, 'crystals', 'epic'),
  ('table_eispalast',     'table', 1000, 'crystals', 'epic'),
  ('table_himmelsschloss','table', 1000, 'crystals', 'legendary'),
  ('table_unterwasser',   'table', 1000, 'crystals', 'legendary'),

  -- Titel / Zubehoer (Gold)
  ('title_erzmagier',     'title', 5000,  'gold', 'rare'),
  ('title_kartenkoenig',  'title', 5000,  'gold', 'rare'),
  ('title_unbesiegbar',   'title', 10000, 'gold', 'epic'),
  ('title_legendaer',     'title', 20000, 'gold', 'legendary')
on conflict (item_id) do update
  set kind     = excluded.kind,
      cost     = excluded.cost,
      currency = excluded.currency,
      rarity   = excluded.rarity,
      active   = true;
