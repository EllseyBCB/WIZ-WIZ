// Shop-Katalog + Besitz-Logik. Eine zentrale Quelle für Shop-Seite und
// Avatar-Picker. Besitz = aktives RevenueCat-Entitlement (von iap.js nach
// 'wizard_owned' gespiegelt). Das Magier-Bundle ('magier') schaltet alles frei.
//
// Neue Ware hinzufügen: Asset ablegen → hier einen Katalog-Eintrag mit
// productId/entitlement ergänzen → in App Store Connect + RevenueCat das
// Produkt/Entitlement anlegen. Der restliche Code braucht keine Änderung.
import { isAdFree } from './ads.js';
import { IAP_PRODUCT_ID, IAP_AVATAR_PREFIX, IAP_BUNDLE_PRODUCT_ID,
         IAP_BUNDLE_ENTITLEMENT } from './config.js';

const LS_OWNED = 'wizard_owned';
const LS_MY_AV = 'wizard_my_avatar';

// Premium-Avatare (Bilder = Shop-Icons zugleich). Preise sind Empfehlungen und
// hier leicht änderbar. id -> Datei avatars/sh-<id>.png, Entitlement 'av_<id>'.
const A = (id, name, price, tier) => ({
  id, type: 'avatar', name, price,
  avatar: `avatars/sh-${id}.png`,
  entitlement: `av_${id}`,
  productId: IAP_AVATAR_PREFIX + id,
  tier: tier || 1,
});

export const AVATAR_ITEMS = [
  A('hourglass',  'Zeitmanipulator',    '2,99 €', 2),
  A('grimoire',   'Verbotenes Grimoire','1,99 €', 1),
  A('dragonegg',  'Drachenei',          '2,99 €', 2),
  A('wizardhat',  'Zauberhut',          '1,99 €', 1),
  A('compass',    'Magischer Kompass',  '1,99 €', 1),
  A('oracle',     'Orakelkugel',        '2,99 €', 2),
  A('phoenix',    'Phönixfeder',        '1,99 €', 1),
  A('shadowwolf', 'Schattenwolf',       '2,99 €', 2),
  A('fortress',   'Schwebende Festung', '2,99 €', 2),
  A('chest',      'Schatztruhe',        '2,99 €', 2),
];

export const SHOP_ADFREE = {
  id: 'adfree', type: 'adfree', name: 'Werbefrei', price: '3,99 €',
  desc: 'Entfernt Banner- und Vollbild-Werbung dauerhaft.',
  entitlement: 'adfree', productId: IAP_PRODUCT_ID,
};

export const SHOP_BUNDLE = {
  id: 'magier', type: 'bundle', name: 'Magier-Bundle', price: '9,99 €',
  desc: 'Werbefrei + alle Avatare & Tische. Bester Preis.',
  entitlement: IAP_BUNDLE_ENTITLEMENT, productId: IAP_BUNDLE_PRODUCT_ID,
};

// Tisch-Designs. 'default' = mitgelieferte Waldlichtung (gratis). Premium-Tische
// nutzen ein eigenes Hintergrundbild (lobby/themes/<file>) und ein Entitlement.
const TABLE_PREFIX = 'de.alphablueprint.zaubertisch.table.';
const T = (id, name, price, file, size, pos, free) => ({
  id, type: 'table', name, price, free: !!free,
  bg: file ? `lobby/themes/${file}` : null,
  size: size || 'cover', pos: pos || 'center',
  entitlement: `tb_${id}`, productId: TABLE_PREFIX + id,
});
export const TABLE_ITEMS = [
  T('default', 'Waldlichtung', '', null, '100% auto', 'top center', true),
  T('mystic',  'Mystischer Tisch', '2,99 €', 'mystic.jpg', 'cover', 'center'),
];

// --- Entwickler-/Browser-Vorschau: ?shop=dev schaltet alles frei (nur lokal) --
let _dev = false;
try {
  const u = new URLSearchParams(location.search);
  if (u.get('shop') === 'dev') localStorage.setItem('wizard_shopdev', '1');
  if (u.get('shop') === 'off') localStorage.removeItem('wizard_shopdev');
  _dev = localStorage.getItem('wizard_shopdev') === '1';
} catch (_) {}
export const isDevUnlock = () => _dev;

// --- Inhaber-Freischaltung: bestimmte Konten bekommen alles gratis ----------
// (z. B. der Entwickler-Account – solange echte IAP noch nicht eingerichtet ist).
const LS_OWNER = 'wizard_owner_unlock';
const OWNER_EMAILS = ['nedvidekelia@gmail.com', 'nancydehnert05@icloud.com'];
export const isOwnerEmail = (e) => !!e && OWNER_EMAILS.includes(String(e).trim().toLowerCase());
export const ownerUnlock = () => { try { return localStorage.getItem(LS_OWNER) === '1'; } catch (_) { return false; } };
export const setOwnerUnlock = (on) => { try { localStorage.setItem(LS_OWNER, on ? '1' : '0'); } catch (_) {} };

// --- Besitz ----------------------------------------------------------------
export function ownedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_OWNED) || '[]')); }
  catch (_) { return new Set(); }
}
export function setOwned(keys) {
  try { localStorage.setItem(LS_OWNED, JSON.stringify([...new Set(keys)])); } catch (_) {}
}
// Einzelnes Entitlement lokal ergänzen (Dev-Vorschau-Kauf).
export function grantOwned(entitlement) {
  const o = ownedSet(); o.add(entitlement); setOwned([...o]);
}

export function isOwned(item) {
  if (!item) return true;
  if (item.free) return true;          // mitgelieferte Gratis-Inhalte
  if (_dev || ownerUnlock()) return true;
  if (item.type === 'adfree') return isAdFree();
  const o = ownedSet();
  if (o.has(IAP_BUNDLE_ENTITLEMENT)) return true;   // Bundle schaltet alles frei
  return o.has(item.entitlement);
}

// --- Avatare ---------------------------------------------------------------
export const PREMIUM_AVATARS = AVATAR_ITEMS.map(i => i.avatar);
export function avatarItem(path) {
  return AVATAR_ITEMS.find(i => i.avatar === path) || null;
}
// Ein Avatar-Pfad ist besessen, wenn er nicht-premium ist ODER das Item gehört.
export function avatarOwned(path) {
  const it = avatarItem(path);
  return it ? isOwned(it) : true;
}
export function myAvatar() {
  try { return localStorage.getItem(LS_MY_AV); } catch (_) { return null; }
}

// --- Tisch-Design ----------------------------------------------------------
const LS_TABLE = 'wizard_table';
export function tableItem(id) {
  return TABLE_ITEMS.find(t => t.id === id) || TABLE_ITEMS[0];
}
export function getTableTheme() {
  try { return localStorage.getItem(LS_TABLE) || 'default'; } catch (_) { return 'default'; }
}
export function setTableTheme(id) {
  try { localStorage.setItem(LS_TABLE, id); } catch (_) {}
  applyTableTheme();
}

// Direkter Hintergrund-Override fuer die neuen Katalog-Spielfelder (Hochformat-
// Bilder in lobby/themes/). bg = Pfad zum Bild, '' = zurueck auf Standard.
const LS_TABLE_BG = 'wizard_table_bg';
export function setTableBg(bg) {
  try {
    if (bg) localStorage.setItem(LS_TABLE_BG, bg);
    else localStorage.removeItem(LS_TABLE_BG);
  } catch (_) {}
  applyTableTheme();
}
export function getTableBg() {
  try { return localStorage.getItem(LS_TABLE_BG) || ''; } catch (_) { return ''; }
}

// --- Kartendeck (Vorderseiten) ---------------------------------------------
// folder = Ordner mit den Kartenbildern des Decks (z. B. 'cards/decks/kristall'),
// '' = Standard-Deck. cards.js liest denselben Schluessel beim Rendern.
const LS_DECK = 'wizard_deck_base';
export function getCardDeck() {
  try { return localStorage.getItem(LS_DECK) || ''; } catch (_) { return ''; }
}
export function setCardDeck(folder) {
  try {
    if (folder) localStorage.setItem(LS_DECK, folder);
    else localStorage.removeItem(LS_DECK);
  } catch (_) {}
}

// --- Kartenrueckseite --------------------------------------------------------
// img = voller Bildpfad (z. B. 'cards/backs/rubin.png'), '' = Standard-Ruecken.
// cards.js liest denselben Schluessel fuer <img>-Ruecken (backUrl); zusaetzlich
// wird hier ein <style> injiziert, damit auch die CSS-Ruecken mitwechseln
// (zugedeckte Handkarten .flip-back + Gegner-Mini-Faecher .seat-hand .hb).
const LS_BACK = 'wizard_back_img';
export function getCardBack() {
  try { return localStorage.getItem(LS_BACK) || ''; } catch (_) { return ''; }
}
export function setCardBack(img) {
  try {
    if (img) localStorage.setItem(LS_BACK, img);
    else localStorage.removeItem(LS_BACK);
  } catch (_) {}
  applyCardBack();
}
export function applyCardBack() {
  if (typeof document === 'undefined') return;
  const id = 'wiz-back-style';
  let el = document.getElementById(id);
  const img = getCardBack();
  if (!img) { if (el) el.remove(); return; }   // Standard -> Original-CSS greift
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  // background-size:100% 100% (fill) statt cover: das Ruecken-Artwork fuellt die
  // Kartenbox exakt, der komplette Goldrahmen bleibt sichtbar (kein Zuschnitt).
  el.textContent = `.flip-back,.seat-hand .hb{background-image:url('${img}?v=1');background-size:100% 100%;}`;
}
// Wendet den Tisch-Hintergrund an. WICHTIG: kein var() verwenden – Safari löst
// einen var()-Fallback mit zwei Werten in background-size nicht auf. Stattdessen
// wird für Premium-Tische ein <style> mit LITERALEN Werten injiziert; für den
// Standard wird es entfernt, sodass die literale .wtable-Regel greift.
export function applyTableTheme() {
  if (typeof document === 'undefined') return;
  const id = 'wiz-table-style';
  let el = document.getElementById(id);

  // Neuer Katalog-Tisch (Hochformat-Bild) hat Vorrang, falls gewaehlt.
  const override = getTableBg();
  if (override) {
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = `.wtable{` +
      `background-image:url('${override}?v=1');` +
      `background-size:cover;background-position:center;background-repeat:no-repeat;}`;
    return;
  }

  let it = tableItem(getTableTheme());
  if (it && !it.free && !isOwned(it)) it = TABLE_ITEMS[0];   // nicht (mehr) besessen -> Standard
  if (!it || !it.bg) { if (el) el.remove(); return; }   // Standard -> Original-CSS
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  el.textContent = `.wtable{` +
    `background-image:url('${it.bg}?v=2');` +
    `background-size:${it.size || 'cover'};` +
    `background-position:${it.pos || 'center'};` +
    `background-repeat:no-repeat;}`;
}
