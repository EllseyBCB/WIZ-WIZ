// In-App-Kauf "Werbefrei" via RevenueCat (@revenuecat/purchases-capacitor).
// Aktiv NUR in der nativen App; im Browser/PWA No-Op (dort gibt es keine Werbung,
// also auch nichts zu kaufen). Zugriff ueber die globale Capacitor-Bruecke –
// es ist KEIN Bundler noetig.
import { REVENUECAT_IOS_KEY, IAP_ENTITLEMENT, IAP_PRODUCT_ID } from './config.js';
import { setAdFree } from './ads.js';

const cap = () => window.Capacitor;
const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
const plat = () => cap()?.getPlatform?.();
const Purchases = () => cap()?.Plugins?.Purchases || null;

const ENT = IAP_ENTITLEMENT || 'adfree';
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

async function entitlementActive() {
  const P = Purchases(); if (!P) return false;
  try {
    const res = await P.getCustomerInfo();
    const info = res?.customerInfo || res;
    return !!info?.entitlements?.active?.[ENT];
  } catch (_) { return false; }
}

// Bei App-Start: aktiven Kauf erkennen und Werbung entsprechend deaktivieren.
export async function syncEntitlement() {
  if (!iapAvailable()) return false;
  const active = await entitlementActive();
  if (active) setAdFree(true);
  return active;
}

// Kauf ausloesen. Liefert { ok, cancelled, error }.
export async function purchaseAdFree() {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  const P = Purchases();
  if (!configured) await initIAP();
  try {
    const off = await P.getOfferings();
    const current = off?.current || off?.offerings?.current;
    const pkgs = current?.availablePackages || [];
    let pkg = IAP_PRODUCT_ID ? pkgs.find(p => p?.product?.identifier === IAP_PRODUCT_ID) : null;
    pkg = pkg || pkgs[0] || null;
    if (!pkg) return { ok: false, error: 'no-package' };
    const res = await P.purchasePackage({ aPackage: pkg });
    const info = res?.customerInfo || res;
    const ok = !!info?.entitlements?.active?.[ENT];
    if (ok) setAdFree(true);
    return { ok };
  } catch (e) {
    const msg = String(e?.message || e?.code || e || '');
    const cancelled = e?.userCancelled === true || e?.code === '1' || /cancel/i.test(msg);
    return { ok: false, cancelled, error: msg };
  }
}

// Von Apple verlangter "Kauf wiederherstellen"-Pfad.
export async function restorePurchases() {
  if (!iapAvailable()) return { ok: false, error: 'unavailable' };
  const P = Purchases();
  if (!configured) await initIAP();
  try {
    const res = await P.restorePurchases();
    const info = res?.customerInfo || res;
    const ok = !!info?.entitlements?.active?.[ENT];
    if (ok) setAdFree(true);
    return { ok };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || '') };
  }
}
