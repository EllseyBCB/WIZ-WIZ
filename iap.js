// In-App-Käufe direkt über Apple StoreKit (cordova-plugin-purchase, global
// window.CdvPurchase). Aktiv NUR in der nativen App; im Browser/PWA No-Op.
// KEIN RevenueCat, KEIN Server: alle Angebote sind Non-Consumables (Einmalkauf),
// das StoreKit-Plugin merkt sich den Besitz lokal und stellt ihn per
// restorePurchases() wieder her.
//
// Produkt-IDs + Entitlements kommen zentral aus cosmetics.js (eine Quelle).
// Aktive Käufe werden als Entitlement-Schlüssel nach 'wizard_owned' gespiegelt;
// den Besitz fragt cosmetics.js ab. Das Magier-Bundle schaltet alles frei.
//
// App Store Connect: jedes hier registrierte Produkt muss dort mit exakt
// dieser ID als "Non-Consumable" angelegt und freigegeben sein – sonst liefert
// StoreKit es nicht aus (kein Kauf möglich).
import { IAP_ENTITLEMENT, IAP_BUNDLE_ENTITLEMENT } from './config.js';
import { setAdFree } from './ads.js';
import { SHOP_ADFREE, SHOP_BUNDLE, AVATAR_ITEMS, TABLE_ITEMS } from './cosmetics.js?v=9';

const cap = () => window.Capacitor;
const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
const CDV = () => window.CdvPurchase || null;

const ENT = IAP_ENTITLEMENT || 'adfree';
const BUNDLE = IAP_BUNDLE_ENTITLEMENT || 'magier';
const LS_OWNED = 'wizard_owned';

// Alle kaufbaren Angebote (Gratis-Tische ausgenommen) -> {productId, entitlement}.
const CATALOG = [SHOP_ADFREE, SHOP_BUNDLE, ...AVATAR_ITEMS, ...TABLE_ITEMS.filter(t => !t.free)]
  .filter(i => i && i.productId && i.entitlement);

let initialized = false;

// Steht der echte Kauf zur Verfuegung? (native App + StoreKit-Plugin geladen)
export function iapAvailable() {
  return isNative() && !!CDV()?.store;
}

// Lokalisierter Live-Preis eines Produkts aus StoreKit (z. B. "3,99 €" / "$3.99").
// null, wenn (noch) nicht geladen oder Produkt in App Store Connect nicht da.
export function productPrice(productId) {
  if (!iapAvailable()) return null;
  try {
    const { store, Platform } = CDV();
    const p = store.get(productId, Platform.APPLE_APPSTORE);
    const offer = p && p.getOffer ? p.getOffer() : null;
    const ph = offer && offer.pricingPhases ? offer.pricingPhases[0] : null;
    return ph && ph.price ? ph.price : null;
  } catch (_) { return null; }
}

// --- Besitz aus dem Store lesen und als Entitlements abbilden ---------------
function storeOwned(productId) {
  try { return !!CDV()?.store?.owned(productId); } catch (_) { return false; }
}
function ownedEntitlements() {
  const out = [];
  for (const it of CATALOG) if (storeOwned(it.productId)) out.push(it.entitlement);
  return out;
}

// Aktive Entitlements lokal spiegeln (Besitz fuer cosmetics.js + Werbe-Status).
function mirror(keys) {
  try { localStorage.setItem(LS_OWNED, JSON.stringify([...new Set(keys)])); } catch (_) {}
  if (keys.includes(ENT) || keys.includes(BUNDLE)) setAdFree(true);
}

// --- Initialisierung (einmalig): Produkte registrieren + Store starten ------
export async function initIAP() {
  if (!iapAvailable() || initialized) return;
  const { store, ProductType, Platform, LogLevel } = CDV();
  try {
    store.verbosity = LogLevel ? LogLevel.WARNING : 1;
    store.register(CATALOG.map(it => ({
      id: it.productId,
      type: ProductType.NON_CONSUMABLE,
      platform: Platform.APPLE_APPSTORE,
    })));
    // Kein Server-Validator: genehmigte Transaktionen direkt abschliessen.
    // .updated feuert, sobald StoreKit Produktinfos (Preise!) laedt ODER sich
    // der Besitz aendert -> Besitz spiegeln + Shop zum Neu-Rendern anstossen.
    store.when()
      .approved(t => t.finish())
      .updated(() => {
        mirror(ownedEntitlements());
        try { window.dispatchEvent(new Event('iap-updated')); } catch (_) {}
      });
    await store.initialize([Platform.APPLE_APPSTORE]);
    initialized = true;
    mirror(ownedEntitlements());     // frueheren Kauf sofort spiegeln
  } catch (_) {}
}

// Liste aller aktiven Entitlement-Schluessel (Kompatibilitaet).
export async function activeEntitlements() {
  if (!iapAvailable()) return [];
  if (!initialized) await initIAP();
  return ownedEntitlements();
}

// Bei App-Start: aktive Kaeufe erkennen, Werbung/Besitz entsprechend setzen.
export async function syncEntitlement() {
  if (!iapAvailable()) return false;
  if (!initialized) await initIAP();
  const keys = ownedEntitlements();
  mirror(keys);
  return keys.includes(ENT) || keys.includes(BUNDLE);
}

// Kurz warten, bis der Store den Kauf als "owned" verbucht (Event-Kette laeuft
// asynchron nach order()). Bricht spaetestens nach ~2 s ab.
function waitOwned(productId, ms = 2000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const tick = () => {
      if (storeOwned(productId) || Date.now() - t0 > ms) return resolve(storeOwned(productId));
      setTimeout(tick, 120);
    };
    tick();
  });
}

// Beliebiges Produkt kaufen. Liefert { ok, cancelled, error, owned }.
export async function purchaseProduct(productId) {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  if (!initialized) await initIAP();
  const { store, Platform, ErrorCode } = CDV();
  const product = store.get(productId, Platform.APPLE_APPSTORE);
  const offer = product && product.getOffer ? product.getOffer() : null;
  if (!offer) return { ok: false, error: 'no-product' };   // ID fehlt in App Store Connect?
  try {
    const err = await offer.order();
    if (err) {
      const cancelled = ErrorCode && err.code === ErrorCode.PAYMENT_CANCELLED;
      return { ok: false, cancelled: !!cancelled, error: err.message || String(err.code || err) };
    }
    await waitOwned(productId);
    const keys = ownedEntitlements();
    mirror(keys);
    return { ok: storeOwned(productId), owned: keys };
  } catch (e) {
    const msg = String(e?.message || e?.code || e || '');
    return { ok: false, cancelled: /cancel/i.test(msg), error: msg };
  }
}

// Werbefrei – duenner Wrapper auf purchaseProduct (Rueckwaerts-Kompatibilitaet).
export async function purchaseAdFree() {
  const r = await purchaseProduct(SHOP_ADFREE.productId);
  return { ...r, ok: r.ok && (!r.owned || r.owned.includes(ENT) || r.owned.includes(BUNDLE)) };
}

// Von Apple verlangter "Kauf wiederherstellen"-Pfad.
export async function restorePurchases() {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  if (!initialized) await initIAP();
  try {
    await CDV().store.restorePurchases();
    const keys = ownedEntitlements();
    mirror(keys);
    return { ok: keys.length > 0, owned: keys };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || '') };
  }
}
