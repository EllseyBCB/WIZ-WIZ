// In-App-Käufe via RevenueCat (@revenuecat/purchases-capacitor).
// Aktiv NUR in der nativen App; im Browser/PWA No-Op (dort gibt es keine Käufe).
// Zugriff ueber die globale Capacitor-Bruecke – es ist KEIN Bundler noetig.
//
// Mehrere Produkte werden unterstuetzt: jedes Shop-Angebot hat eine Produkt-ID
// (App Store Connect) und ein Entitlement (RevenueCat). Aktive Entitlements
// werden lokal nach 'wizard_owned' gespiegelt; den Besitz fragt cosmetics.js ab.
import { REVENUECAT_IOS_KEY, IAP_ENTITLEMENT, IAP_PRODUCT_ID, IAP_BUNDLE_ENTITLEMENT } from './config.js';
import { setAdFree } from './ads.js';

const cap = () => window.Capacitor;
const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
const plat = () => cap()?.getPlatform?.();
const Purchases = () => cap()?.Plugins?.Purchases || null;

const ENT = IAP_ENTITLEMENT || 'adfree';
const BUNDLE = IAP_BUNDLE_ENTITLEMENT || 'magier';
const LS_OWNED = 'wizard_owned';
let configured = false;

// Steht der echte Kauf zur Verfuegung? (native App + Plugin + Key vorhanden)
export function iapAvailable() {
  return isNative() && !!Purchases() && (plat() === 'android' || !!REVENUECAT_IOS_KEY);
}

export async function initIAP() {
  if (!iapAvailable() || configured) return;
  const P = Purchases();
  const apiKey = plat() === 'android' ? '' : REVENUECAT_IOS_KEY;   // hier nur iOS
  if (!apiKey) return;
  try {
    await P.configure({ apiKey });
    configured = true;
    await syncEntitlement();        // frueheren Kauf wiederherstellen
  } catch (_) {}
}

// Liste aller aktiven Entitlement-Schluessel.
export async function activeEntitlements() {
  const P = Purchases(); if (!P) return [];
  try {
    const res = await P.getCustomerInfo();
    const info = res?.customerInfo || res;
    return Object.keys(info?.entitlements?.active || {});
  } catch (_) { return []; }
}

// Aktive Entitlements lokal spiegeln (Besitz fuer cosmetics.js + Werbe-Status).
function mirror(keys) {
  try { localStorage.setItem(LS_OWNED, JSON.stringify([...new Set(keys)])); } catch (_) {}
  if (keys.includes(ENT) || keys.includes(BUNDLE)) setAdFree(true);
}

// Bei App-Start: aktive Kaeufe erkennen, Werbung/Besitz entsprechend setzen.
export async function syncEntitlement() {
  if (!iapAvailable()) return false;
  const keys = await activeEntitlements();
  mirror(keys);
  return keys.includes(ENT) || keys.includes(BUNDLE);
}

// Beliebiges Produkt kaufen. Liefert { ok, cancelled, error, owned }.
export async function purchaseProduct(productId) {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  const P = Purchases();
  if (!configured) await initIAP();
  try {
    const off = await P.getOfferings();
    const current = off?.current || off?.offerings?.current;
    const pkgs = current?.availablePackages || [];
    let pkg = productId ? pkgs.find(p => p?.product?.identifier === productId) : null;
    pkg = pkg || (productId ? null : pkgs[0]);   // ohne ID: erstes Paket (Rueckwaerts-Kompat.)
    if (!pkg) return { ok: false, error: 'no-package' };
    const res = await P.purchasePackage({ aPackage: pkg });
    const info = res?.customerInfo || res;
    const keys = Object.keys(info?.entitlements?.active || {});
    mirror(keys);
    return { ok: true, owned: keys };
  } catch (e) {
    const msg = String(e?.message || e?.code || e || '');
    const cancelled = e?.userCancelled === true || e?.code === '1' || /cancel/i.test(msg);
    return { ok: false, cancelled, error: msg };
  }
}

// Werbefrei – duenner Wrapper auf purchaseProduct (Rueckwaerts-Kompatibilitaet).
export async function purchaseAdFree() {
  const r = await purchaseProduct(IAP_PRODUCT_ID);
  return { ...r, ok: r.ok && (!r.owned || r.owned.includes(ENT) || r.owned.includes(BUNDLE)) };
}

// Von Apple verlangter "Kauf wiederherstellen"-Pfad.
export async function restorePurchases() {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  const P = Purchases();
  if (!configured) await initIAP();
  try {
    const res = await P.restorePurchases();
    const info = res?.customerInfo || res;
    const keys = Object.keys(info?.entitlements?.active || {});
    mirror(keys);
    return { ok: keys.length > 0, owned: keys };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || '') };
  }
}
