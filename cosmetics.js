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
  if (_dev) return true;
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
// Setzt die CSS-Variablen für den Tisch-Hintergrund (von .wtable genutzt).
export function applyTableTheme() {
  const root = document.body; if (!root) return;
  let it = tableItem(getTableTheme());
  if (it && !it.free && !isOwned(it)) it = TABLE_ITEMS[0];   // nicht (mehr) besessen -> Standard
  if (!it || !it.bg) {
    root.style.removeProperty('--table-bg');
    root.style.removeProperty('--table-size');
    root.style.removeProperty('--table-pos');
    return;
  }
  root.style.setProperty('--table-bg', `url('${it.bg}?v=1')`);
  root.style.setProperty('--table-size', it.size || 'cover');
  root.style.setProperty('--table-pos', it.pos || 'center');
}
