// Anzeige-Katalog des neuen Shops (Kristalle/Gold). Die PREISE sind serverseitig
// die Wahrheit (wizard_catalog); hier stehen nur Anzeige-Infos (Name, Seltenheit,
// Platzhalter-Symbol) sowie – zur schnellen Anzeige – dieselben Preise. Beim Kauf
// entscheidet immer der Server. Neue Ware: hier + im Server-Katalog eintragen.
//
// rarity: common | rare | epic | legendary | mythic
// icon:   Emoji als Platzhalter, bis echte Grafiken (img) hinterlegt sind.

export const RARITY = {
  common:    { label: 'Gewöhnlich', color: '#9aa4b2' },
  rare:      { label: 'Selten',     color: '#4aa3ff' },
  epic:      { label: 'Episch',     color: '#a855f7' },
  legendary: { label: 'Legendär',   color: '#f0b429' },
  mythic:    { label: 'Mythisch',   color: '#ff5470' },
};

const I = (id, kind, name, cost, currency, rarity, icon) =>
  ({ id, kind, name, cost, currency, rarity, icon });

export const SHOP_SECTIONS = [
  {
    key: 'avatar', title: 'Avatare', items: [
      I('av_eule',          'avatar', 'Eule',           500,  'crystals', 'common',    '🦉'),
      I('av_zauberer',      'avatar', 'Zauberer',       800,  'crystals', 'rare',      '🧙'),
      I('av_hexe',          'avatar', 'Hexe',           800,  'crystals', 'rare',      '🧙‍♀️'),
      I('av_kristallgolem', 'avatar', 'Kristallgolem',  1000, 'crystals', 'epic',      '🗿'),
      I('av_drache',        'avatar', 'Drache',         1200, 'crystals', 'epic',      '🐉'),
      I('av_einhorn',       'avatar', 'Einhorn',        1200, 'crystals', 'epic',      '🦄'),
      I('av_phoenix',       'avatar', 'Phönix',         1500, 'crystals', 'legendary', '🦅'),
      I('av_schattenmagier','avatar', 'Schattenmagier', 1500, 'crystals', 'legendary', '🌑'),
    ]
  },
  {
    key: 'deck', title: 'Kartendecks', items: [
      I('deck_kristall',  'deck', 'Kristall',  800, 'crystals', 'rare',      '💎'),
      I('deck_feuer',     'deck', 'Feuer',     800, 'crystals', 'rare',      '🔥'),
      I('deck_eis',       'deck', 'Eis',       800, 'crystals', 'rare',      '❄️'),
      I('deck_wald',      'deck', 'Wald',      800, 'crystals', 'rare',      '🌿'),
      I('deck_schatten',  'deck', 'Schatten',  800, 'crystals', 'epic',      '🖤'),
      I('deck_himmel',    'deck', 'Himmel',    800, 'crystals', 'epic',      '☁️'),
      I('deck_runen',     'deck', 'Runen',     800, 'crystals', 'epic',      '🔮'),
      I('deck_steampunk', 'deck', 'Steampunk', 800, 'crystals', 'epic',      '⚙️'),
      I('deck_galaxie',   'deck', 'Galaxie',   800, 'crystals', 'legendary', '🌌'),
    ]
  },
  {
    key: 'table', title: 'Spielfelder', items: [
      I('table_zauberwald',    'table', 'Zauberwald',      800,  'crystals', 'rare',      '🌲'),
      I('table_magierturm',    'table', 'Magierturm',      800,  'crystals', 'rare',      '🗼'),
      I('table_bibliothek',    'table', 'Bibliothek',      800,  'crystals', 'rare',      '📚'),
      I('table_kristallhoehle','table', 'Kristallhöhle',   1000, 'crystals', 'epic',      '💠'),
      I('table_vulkan',        'table', 'Vulkan',          1000, 'crystals', 'epic',      '🌋'),
      I('table_eispalast',     'table', 'Eispalast',       1000, 'crystals', 'epic',      '🧊'),
      I('table_himmelsschloss','table', 'Himmelsschloss',  1000, 'crystals', 'legendary', '🏰'),
      I('table_unterwasser',   'table', 'Unterwasser',     1000, 'crystals', 'legendary', '🌊'),
    ]
  },
  {
    key: 'title', title: 'Titel', items: [
      I('title_erzmagier',    'title', 'Erzmagier',    5000,  'gold', 'rare',      '👑'),
      I('title_kartenkoenig', 'title', 'Kartenkönig',  5000,  'gold', 'rare',      '🃏'),
      I('title_unbesiegbar',  'title', 'Unbesiegbar',  10000, 'gold', 'epic',      '🛡️'),
      I('title_legendaer',    'title', 'Legendär',     20000, 'gold', 'legendary', '⭐'),
    ]
  },
];

// Kristall-Pakete (Echtgeld). Werden in Phase 2 an echte IAP-Produkte gekoppelt;
// bis dahin nur Anzeige. amount = Kristalle, priceEUR = Anzeigepreis.
export const CRYSTAL_PACKS = [
  { id: 'crystals_100',  amount: 100,  bonus: 0,    priceEUR: '1,09 €' },
  { id: 'crystals_500',  amount: 500,  bonus: 50,   priceEUR: '4,49 €' },
  { id: 'crystals_1200', amount: 1200, bonus: 200,  priceEUR: '9,99 €',  tag: 'Beliebt' },
  { id: 'crystals_2500', amount: 2500, bonus: 500,  priceEUR: '19,99 €' },
  { id: 'crystals_6000', amount: 6000, bonus: 1500, priceEUR: '49,99 €', tag: 'Bester Preis' },
];
