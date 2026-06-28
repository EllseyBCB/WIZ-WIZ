// AdMob-Werbung – aktiv NUR in der nativen App (Capacitor).
// Im Browser/als PWA passiert hier nichts (No-Op), damit die Web-Version
// unveraendert laeuft. Der Zugriff erfolgt ueber die globale Capacitor-Bruecke
// (window.Capacitor.Plugins.AdMob) – es ist KEIN Bundler noetig.
//
// Standard: Google-TEST-Anzeigen. Nach dem Anlegen eines AdMob-Kontos die
// echten Ad-Unit-IDs unten eintragen und `testing` auf false setzen.

const AD_CONFIG = {
  // Google-Test-IDs (funktionieren ohne eigenes Konto).
  banner:       { ios: 'ca-app-pub-3940256099942544/2934735716', android: 'ca-app-pub-3940256099942544/6300978111' },
  interstitial: { ios: 'ca-app-pub-3940256099942544/4411468910', android: 'ca-app-pub-3940256099942544/1033173712' },
  testing: true,
  everyNthGame: 1,   // Vollbild-Werbung nach jedem N-ten Spiel (1 = jedes)
};

const cap = () => window.Capacitor;
const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
const plat = () => (cap()?.getPlatform?.() === 'android' ? 'android' : 'ios');
const admob = () => cap()?.Plugins?.AdMob || null;

// "Werbefrei"-Status. Gekauft wird per echtem IAP in iap.js (RevenueCat);
// setAdFree() spiegelt das aktive Entitlement lokal, damit die Werbung sofort
// reagiert. Beim App-Start synchronisiert initIAP() den Status erneut.
const LS_ADFREE = 'wizard_adfree';
export function isAdFree() { return localStorage.getItem(LS_ADFREE) === '1'; }
export function setAdFree(on) {
  localStorage.setItem(LS_ADFREE, on ? '1' : '0');
  if (on) hideBanner();   // laufendes Banner sofort entfernen
}

let ready = false, bannerOn = false, gamesSinceAd = 0;

// --- Werbe-Vorschau (nur Test, im Browser) ---------------------------------
// Zeigt Platzhalter, damit man im Browser sieht, WO/WIE die Werbung sitzt –
// ohne nativen Build. Aktivierbar per Schalter oder ?ads=preview.
let preview = false;
(function detectPreview() {
  try {
    const u = new URLSearchParams(location.search);
    if (u.get('ads') === 'preview') localStorage.setItem('wizard_adpreview', '1');
    preview = localStorage.getItem('wizard_adpreview') === '1';
  } catch (_) {}
})();
export function isPreview() { return preview; }
export function setPreview(on) {
  preview = !!on;
  localStorage.setItem('wizard_adpreview', preview ? '1' : '0');
  if (!preview) removePreviewBanner();
}
function showPreviewBanner() {
  if (isAdFree() || document.getElementById('ad-preview-banner')) return;
  const el = document.createElement('div');
  el.id = 'ad-preview-banner';
  el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(62px + env(safe-area-inset-bottom));z-index:39;'
    + 'height:54px;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:10px;'
    + 'background:linear-gradient(#1b1430,#120c24);border:1px solid #c6a24c;color:#e9c873;font:600 13px sans-serif;'
    + 'box-shadow:0 6px 18px rgba(0,0,0,.5)';
  el.innerHTML = '<span style="font-size:9px;background:#c6a24c;color:#1a1033;padding:2px 6px;border-radius:4px;letter-spacing:.5px">ANZEIGE</span>'
    + ' Beispiel-Werbebanner (AdMob)';
  document.body.appendChild(el);
}
function removePreviewBanner() { const e = document.getElementById('ad-preview-banner'); if (e) e.remove(); }
function showPreviewInterstitial() {
  if (isAdFree() || document.getElementById('ad-preview-full')) return;
  const ov = document.createElement('div');
  ov.id = 'ad-preview-full';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(6,4,16,.94);display:flex;'
    + 'flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px';
  ov.innerHTML = '<div style="font-size:11px;background:#c6a24c;color:#1a1033;padding:2px 9px;border-radius:5px;letter-spacing:.5px">ANZEIGE</div>'
    + '<div style="font-family:Cinzel,Georgia,serif;color:#e9c873;font-size:1.35rem">Beispiel-Vollbildwerbung</div>'
    + '<div style="color:rgba(255,255,255,.6);font-size:.85rem;max-width:300px;line-height:1.5">So erscheint im App-Store-Build nach dem Spiel die Interstitial-Werbung.</div>';
  const btn = document.createElement('button');
  btn.disabled = true; btn.textContent = 'Schließen';
  btn.style.cssText = 'margin-top:8px;padding:11px 22px;border-radius:24px;border:1px solid #c6a24c;background:#a78bfa;'
    + 'color:#1a1033;font-weight:700;cursor:pointer;opacity:.45';
  const cd = document.createElement('div');
  cd.style.cssText = 'color:rgba(255,255,255,.4);font-size:.78rem';
  ov.appendChild(btn); ov.appendChild(cd);
  document.body.appendChild(ov);
  let n = 3; cd.textContent = 'Schließen in ' + n + ' …';
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); cd.remove(); btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '✕ Schließen'; }
    else cd.textContent = 'Schließen in ' + n + ' …';
  }, 1000);
  btn.onclick = () => ov.remove();
}

// Einmalig initialisieren (inkl. iOS-Tracking-Abfrage + EU-Einwilligung/UMP).
export async function initAds() {
  if (!isNative() || isAdFree()) return;
  const AdMob = admob(); if (!AdMob) return;
  try {
    await AdMob.initialize({ requestTrackingAuthorization: true, initializeForTesting: AD_CONFIG.testing });
    try {
      const info = await AdMob.requestConsentInfo();
      if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') await AdMob.showConsentForm();
    } catch (_) {}
    ready = true;
  } catch (_) {}
}

// Banner unten einblenden (z. B. auf der Startseite).
export async function showBanner() {
  if (isAdFree()) return;
  if (preview) { showPreviewBanner(); return; }        // Browser-Vorschau
  if (!ready || bannerOn) return;
  const AdMob = admob(); if (!AdMob) return;
  try {
    await AdMob.showBanner({
      adId: AD_CONFIG.banner[plat()], adSize: 'ADAPTIVE_BANNER',
      position: 'BOTTOM_CENTER', margin: 0, isTesting: AD_CONFIG.testing
    });
    bannerOn = true;
  } catch (_) {}
}

// Banner ausblenden (z. B. waehrend einer Partie, damit nichts verdeckt wird).
export async function hideBanner() {
  removePreviewBanner();                               // Browser-Vorschau
  if (!bannerOn) return;
  const AdMob = admob(); if (!AdMob) return;
  try { await AdMob.hideBanner(); } catch (_) {}
  bannerOn = false;
}

// Vollbild-Werbung am Spielende (gedrosselt ueber everyNthGame).
export async function gameOverAd() {
  if (isAdFree()) return;
  if (preview) { showPreviewInterstitial(); return; }  // Browser-Vorschau
  if (!ready) return;
  const AdMob = admob(); if (!AdMob) return;
  gamesSinceAd++;
  if (gamesSinceAd < AD_CONFIG.everyNthGame) return;
  gamesSinceAd = 0;
  try {
    await AdMob.prepareInterstitial({ adId: AD_CONFIG.interstitial[plat()], isTesting: AD_CONFIG.testing });
    await AdMob.showInterstitial();
  } catch (_) {}
}
