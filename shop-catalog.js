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

const I = (id, kind, name, cost, currency, rarity, icon, img, folder) =>
  ({ id, kind, name, cost, currency, rarity, icon, img, folder });

// Bildpfad-Helfer fuer echte Grafiken (statt Emoji-Platzhalter).
const AV = (id) => `avatars/${id}.jpg`;
// Spielfeld-Hintergruende (Hochformat) dienen zugleich als Kachel-Bild UND als
// echter Tisch-Hintergrund im Spiel (background: cover).
const TBL = (id) => `lobby/themes/${id}.jpg`;

export const SHOP_SECTIONS = [
  {
    key: 'avatar', title: 'Avatare', items: [
      I('av_eule',          'avatar', 'Eule',           500,  'crystals', 'common',    '🦉',    AV('av_eule')),
      I('av_zauberer',      'avatar', 'Zauberer',       800,  'crystals', 'rare',      '🧙',    AV('av_zauberer')),
      I('av_hexe',          'avatar', 'Hexe',           800,  'crystals', 'rare',      '🧙‍♀️',   AV('av_hexe')),
      I('av_kristallgolem', 'avatar', 'Kristallgolem',  1000, 'crystals', 'epic',      '🗿',    AV('av_kristallgolem')),
      I('av_drache',        'avatar', 'Drache',         1200, 'crystals', 'epic',      '🐉',    AV('av_drache')),
      I('av_einhorn',       'avatar', 'Einhorn',        1200, 'crystals', 'epic',      '🦄',    AV('av_einhorn')),
      I('av_phoenix',       'avatar', 'Phönix',         1500, 'crystals', 'legendary', '🦅',    AV('av_phoenix')),
      I('av_schattenmagier','avatar', 'Schattenmagier', 1500, 'crystals', 'legendary', '🌑',    AV('av_schattenmagier')),
    ]
  },
  {
    key: 'deck', title: 'Kartendecks', items: [
      // Das Original-Deck – gratis, immer im Besitz, waehlbar (Standard).
      { id: 'deck_standard', kind: 'deck', name: 'Standard', cost: 0, currency: 'crystals',
        rarity: 'common', icon: '🎴', img: 'lobby/deck-standard.png', folder: '', isDefault: true, free: true },
      I('deck_kristall',  'deck', 'Arkanum',  800, 'crystals', 'rare',      '💎', 'lobby/deck-kristall.png', 'cards/decks/kristall'),
      I('deck_elemente',  'deck', 'Elemente',  800, 'crystals', 'epic',      '🌟', 'lobby/deck-elemente.jpg', 'cards/decks/elemente'),
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
      // Der Original-Haupttisch als teuerstes, legendäres Flaggschiff.
      I('table_waldlichtung',  'table', 'Waldlichtung',    2000, 'crystals', 'legendary', '🌌', 'lobby/table-bg.jpg'),
      // Der selbst konfigurierte Mystische Tisch (aus dem alten System) – legendär.
      I('table_mystic',        'table', 'Mystischer Tisch',1800, 'crystals', 'legendary', '🔮', 'lobby/themes/mystic.jpg'),
      I('table_zauberwald',    'table', 'Zauberwald',      800,  'crystals', 'rare',      '🌲', TBL('table_zauberwald')),
      I('table_magierturm',    'table', 'Magierturm',      800,  'crystals', 'rare',      '🗼', TBL('table_magierturm')),
      I('table_bibliothek',    'table', 'Bibliothek',      800,  'crystals', 'rare',      '📚', TBL('table_bibliothek')),
      I('table_kristallhoehle','table', 'Kristallhöhle',   1000, 'crystals', 'epic',      '💠', TBL('table_kristallhoehle')),
      I('table_vulkan',        'table', 'Vulkan',          1000, 'crystals', 'epic',      '🌋', TBL('table_vulkan')),
      I('table_eispalast',     'table', 'Eispalast',       1000, 'crystals', 'epic',      '🧊', TBL('table_eispalast')),
      I('table_himmelsschloss','table', 'Himmelsschloss',  1000, 'crystals', 'legendary', '🏰', TBL('table_himmelsschloss')),
      I('table_unterwasser',   'table', 'Unterwasser',     1000, 'crystals', 'legendary', '🌊', TBL('table_unterwasser')),
    ]
  },
  {
    key: 'title', title: 'Zubehör', items: [
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
  { id: 'crystals_100',  amount: 100,  bonus: 0,    priceEUR: '1,09 €',  img: 'lobby/pack_100.jpg' },
  { id: 'crystals_500',  amount: 500,  bonus: 50,   priceEUR: '4,49 €',  img: 'lobby/pack_500.jpg' },
  { id: 'crystals_1200', amount: 1200, bonus: 200,  priceEUR: '9,99 €',  tag: 'Beliebt',      img: 'lobby/pack_1200.jpg' },
  { id: 'crystals_2500', amount: 2500, bonus: 500,  priceEUR: '19,99 €', img: 'lobby/pack_2500.jpg' },
  { id: 'crystals_6000', amount: 6000, bonus: 1500, priceEUR: '49,99 €', tag: 'Bester Preis', img: 'lobby/pack_6000.jpg' },
];
