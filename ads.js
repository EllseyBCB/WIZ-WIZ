// AdMob-Werbung – aktiv NUR in der nativen App (Capacitor).
// Im Browser/als PWA passiert hier nichts (No-Op), damit die Web-Version
// unveraendert laeuft. Der Zugriff erfolgt ueber die globale Capacitor-Bruecke
// (window.Capacitor.Plugins.AdMob) – es ist KEIN Bundler noetig.
//
// ECHTE Werbung (Verdienst): die eigenen Ad-Unit-IDs in config.js -> ADMOB
// eintragen. Solange dort nichts steht, laufen automatisch Google-TEST-
// Anzeigen (gefahrlos, aber ohne Einnahmen). Der Testmodus schaltet sich
// je Plattform selbst ab, sobald eine echte ID vorhanden ist.
import { ADMOB } from './config.js';

// Google-Test-IDs (funktionieren ohne eigenes Konto).
const TEST_IDS = {
  banner:       { ios: 'ca-app-pub-3940256099942544/2934735716', android: 'ca-app-pub-3940256099942544/6300978111' },
  interstitial: { ios: 'ca-app-pub-3940256099942544/4411468910', android: 'ca-app-pub-3940256099942544/1033173712' },
  rewarded:     { ios: 'ca-app-pub-3940256099942544/1712485313', android: 'ca-app-pub-3940256099942544/5224354917' },
};
// Vollbild-Werbung nur nach jedem N-ten Spiel. Bei kurzen Blitz-Partien (~4 Min)
// waere Werbung nach JEDEM Spiel (1) im Minutentakt -> schlecht fuer Retention
// und Bewertungen. 3 = deutlich seltener, aber weiterhin Einnahmen. Zusammen mit
// dem freiwilligen Rewarded-Video (Notizbloecke, siehe tokens.js) bleibt der
// Ertrag erhalten, ohne die Nutzer zu vergraulen.
const EVERY_NTH_GAME = 3;   // Vollbild-Werbung nach jedem N-ten Spiel (1 = jedes)

const cap = () => window.Capacitor;
export const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
const plat = () => (cap()?.getPlatform?.() === 'android' ? 'android' : 'ios');
const admob = () => cap()?.Plugins?.AdMob || null;

// --- Diagnose-Logging -------------------------------------------------------
// Sichtbar in der Xcode-Konsole und im Safari-Web-Inspector. Hilft zu sehen,
// ob AdMob initialisiert, welche Ad-Unit genutzt wird und warum ggf. nichts
// erscheint. Kann spaeter wieder entfernt werden.
const D = (...a) => { try { console.log('[ads]', ...a); } catch (_) {} };

// --- Sichtbarer Werbe-Status (fuer die Einstellungen) -----------------------
// Haelt die letzte aussagekraeftige Meldung fest, damit man OHNE Xcode-Konsole
// direkt in der App sehen kann, woran es haengt (Init, Consent, Ladefehler …).
let lastStatus = 'Noch nicht initialisiert.';
const statusListeners = [];
export function adsStatus() { return lastStatus; }
export function onAdsStatus(fn) { statusListeners.push(fn); }
function setStatus(s) {
  lastStatus = s; D('STATUS:', s);
  statusListeners.forEach(f => { try { f(s); } catch (_) {} });
}

// Test-Anzeigen erzwingen (sicher, klickbar ohne Konto-Risiko):
//   ?ads=test in der URL  ODER  localStorage wizard_adtest='1'.
// Nutzt dann Google-Test-IDs statt der echten -> garantierte Auslieferung.
let forceTest = false;
(function detectForceTest() {
  try {
    const u = new URLSearchParams(location.search);
    if (u.get('ads') === 'test') localStorage.setItem('wizard_adtest', '1');
    if (u.get('ads') === 'real') localStorage.removeItem('wizard_adtest');
    forceTest = localStorage.getItem('wizard_adtest') === '1';
  } catch (_) {}
})();

// Eigene ID aus config.js (falls gesetzt), sonst Test-ID + Testmodus.
// Config-Schluessel je Anzeigentyp: [iOS-Feld, Android-Feld].
const OWN_KEYS = {
  banner:       ['bannerIos',       'bannerAndroid'],
  interstitial: ['interstitialIos', 'interstitialAndroid'],
  rewarded:     ['rewardedIos',     'rewardedAndroid'],
};
function adUnit(kind) {
  const p = plat();
  if (forceTest) return { adId: TEST_IDS[kind][p], testing: true };
  const own = ADMOB?.[OWN_KEYS[kind][p === 'android' ? 1 : 0]];
  if (own) return { adId: own, testing: false };
  return { adId: TEST_IDS[kind][p], testing: true };
}

// "Werbefrei"-Status. Gekauft wird per echtem IAP in iap.js (RevenueCat);
// setAdFree() spiegelt das aktive Entitlement lokal, damit die Werbung sofort
// reagiert. Beim App-Start synchronisiert initIAP() den Status erneut.
const LS_ADFREE = 'wizard_adfree';
export function isAdFree() { return localStorage.getItem(LS_ADFREE) === '1'; }
// Werbung unterdrueckt? „Werbefrei" gilt – AUSSER der Testanzeigen-Schalter ist
// an. Der Schalter uebersteuert Werbefrei bewusst, denn das Inhaber-Konto
// schaltet Werbefrei automatisch frei und koennte sonst NIE Werbung testen.
const adsBlocked = () => isAdFree() && !forceTest;
export function setAdFree(on) {
  localStorage.setItem(LS_ADFREE, on ? '1' : '0');
  if (on) hideBanner();   // laufendes Banner sofort entfernen
}

let ready = false, bannerOn = false, gamesSinceAd = 0;
// Existiert bereits ein natives Banner-View (ggf. nur versteckt)? Dann muss
// showBanner() es per resumeBanner() fortsetzen statt neu zu erstellen.
let bannerCreated = false;
let lastBannerH = 0;   // zuletzt gemeldete Bannerhoehe (fuer --ad-h nach resume)

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
// Test-Anzeigen-Schalter (native App): erzwingt Google-Testanzeigen mit
// garantierter Auslieferung – auf dem echten Geraet sichtbar und gefahrlos
// klickbar. Zum Pruefen, dass die Werbung ankommt, bevor echte Ads ausgeliefert
// werden. Im Alltag AUS lassen (dann laufen die echten IDs aus config.js).
export function isForceTest() { return forceTest; }
export async function setForceTest(on) {
  forceTest = !!on;
  try { localStorage.setItem('wizard_adtest', forceTest ? '1' : '0'); } catch (_) {}
  D('setForceTest:', forceTest);
  // Banner KOMPLETT entfernen (removeBanner), nicht nur verstecken: das Plugin
  // uebernimmt eine neue Ad-Unit-ID (Test <-> echt) nur bei einem frisch
  // erstellten Banner. Nach hideBanner() wuerde showBanner() das alte,
  // versteckte Banner NICHT ersetzen -> es kaeme gar keine Werbung mehr.
  const AdMob = admob();
  try { if (AdMob?.removeBanner) await AdMob.removeBanner(); } catch (e) { D('setForceTest: removeBanner', e?.message || e); }
  bannerCreated = false; bannerOn = false; setAdVar(0);
  if (!ready) await initAds();        // falls noch nicht initialisiert
  await showBanner();                 // mit passender (Test-/Echt-)ID NEU erstellen
}

export function isPreview() { return preview; }
export function setPreview(on) {
  preview = !!on;
  localStorage.setItem('wizard_adpreview', preview ? '1' : '0');
  if (!preview) removePreviewBanner();
}
function showPreviewBanner() {
  if (adsBlocked() || document.getElementById('ad-preview-banner')) return;
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
  if (adsBlocked() || document.getElementById('ad-preview-full')) return;
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

// Bannerhoehe als CSS-Variable --ad-h setzen, damit Inhalt + untere Tab-Leiste
// genau um die Bannerhoehe nach oben ruecken und nichts verdeckt wird.
// (Der native Banner liegt sonst als Overlay ueber den Buttons.)
function setAdVar(px) {
  try {
    const on = px > 0;
    document.documentElement.style.setProperty('--ad-h', (on ? px : 0) + 'px');
    // Das native Banner sitzt an der Safe-Area-Kante, nicht am Bildschirmrand.
    // Nur wenn wirklich ein Banner laeuft, ruecken Tab-Leiste/Inhalt um den
    // zusaetzlichen Safe-Area-Reststreifen hoch und der Fueller wird sichtbar
    // (siehe html.has-ad-Regeln in index.html).
    document.documentElement.classList.toggle('has-ad', on);
  } catch (_) {}
}
let sizeListenerAdded = false;
function ensureSizeListener(AdMob) {
  if (sizeListenerAdded || !AdMob?.addListener) return;
  sizeListenerAdded = true;
  // Das Plugin meldet die tatsaechliche Bannerhoehe (adaptiv, geraeteabhaengig).
  try {
    AdMob.addListener('bannerAdSizeChanged', (size) => {
      const h = size && typeof size.height === 'number' ? size.height : 0;
      D('bannerAdSizeChanged: height=', h);
      if (h > 0) lastBannerH = h;
      setAdVar(bannerOn ? h : 0);
    });
  } catch (_) {}
  // Lade-Erfolg/-Fehler des Banners sichtbar machen: DAS ist die Stelle, an der
  // man erkennt, ob AdMob wirklich ausliefert oder warum nicht (Fehlercode).
  try {
    AdMob.addListener('bannerAdLoaded', () => {
      setStatus('Banner geladen ✓ (' + (adUnit('banner').testing ? 'Testanzeige' : 'echte Anzeige') + ')');
    });
    AdMob.addListener('bannerAdFailedToLoad', (err) => {
      const code = err?.code != null ? ' [Code ' + err.code + ']' : '';
      setStatus('Banner-Ladefehler' + code + ': ' + (err?.message || JSON.stringify(err || {})));
    });
  } catch (_) {}
}

// Einmalig initialisieren (inkl. iOS-Tracking-Abfrage + EU-Einwilligung/UMP).
export async function initAds() {
  D('initAds: native=', isNative(), 'adFree=', isAdFree(), 'forceTest=', forceTest, 'plugin=', !!admob());
  if (!isNative()) { setStatus('Nur in der iOS-App aktiv (im Browser gibt es keine AdMob-Werbung).'); return; }
  if (adsBlocked()) { setStatus('Werbefrei ist aktiv (z. B. Inhaber-Konto) – darum keine Werbung. Testanzeigen-Schalter AN zeigt trotzdem Testwerbung.'); return; }
  const AdMob = admob();
  if (!AdMob) { setStatus('AdMob-Plugin nicht gefunden – bitte App neu bauen (npm run ios).'); return; }
  ensureSizeListener(AdMob);
  try {
    const testing = adUnit('banner').testing;
    setStatus('Initialisiere AdMob (' + (testing ? 'Testmodus' : 'echte IDs') + ') …');
    // iOS-Tracking-Abfrage (ATT): neuere Plugin-Versionen ignorieren die
    // initialize-Option, deshalb zusaetzlich der direkte Aufruf.
    try { if (AdMob.requestTrackingAuthorization) await AdMob.requestTrackingAuthorization(); } catch (_) {}
    await AdMob.initialize({ requestTrackingAuthorization: true, initializeForTesting: testing });
    try {
      const info = await AdMob.requestConsentInfo();
      D('initAds: consent status=', info?.status, 'formAvailable=', info?.isConsentFormAvailable);
      if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') {
        D('initAds: zeige Consent-Formular');
        await AdMob.showConsentForm();
      } else if (info && info.status === 'REQUIRED' && !info.isConsentFormAvailable) {
        // Haeufigste Ursache fuer "gar keine Werbung" in der EU: die
        // DSGVO-Nachricht ist im AdMob-Konto nicht veroeffentlicht -> ohne
        // Einwilligung darf das SDK KEINE Anzeigen anfordern (auch keine Tests).
        setStatus('DSGVO-Einwilligung ERFORDERLICH, aber kein Formular verfügbar. '
          + 'Bitte im AdMob-Konto unter „Datenschutz & Mitteilungen" die DSGVO-Nachricht '
          + 'veröffentlichen – ohne sie liefert AdMob in der EU keine Anzeigen aus.');
      }
    } catch (e) { D('initAds: consent-Fehler', e?.message || e); }
    ready = true;
    D('initAds: fertig, ready=true');
  } catch (e) { setStatus('AdMob-Initialisierung fehlgeschlagen: ' + (e?.message || e)); }
}

// Banner unten einblenden (z. B. auf der Startseite).
export async function showBanner() {
  if (adsBlocked()) { D('showBanner: werbefrei'); return; }
  if (preview) { showPreviewBanner(); return; }        // Browser-Vorschau
  if (!ready || bannerOn) { D('showBanner: uebersprungen (ready=' + ready + ', bannerOn=' + bannerOn + ')'); return; }
  const AdMob = admob(); if (!AdMob) return;
  try {
    // Ein bereits erstelltes, nur verstecktes Banner wird fortgesetzt –
    // ein erneutes showBanner() wuerde es beim Plugin NICHT wieder einblenden.
    if (bannerCreated && AdMob.resumeBanner) {
      D('showBanner: resumeBanner (Banner existiert bereits)');
      await AdMob.resumeBanner();
      bannerOn = true;
      setAdVar(lastBannerH);
      setStatus('Banner wieder eingeblendet.');
      return;
    }
    const u = adUnit('banner');
    setStatus('Banner angefordert (' + (u.testing ? 'Testanzeige' : 'echte Anzeige') + ', ID …' + u.adId.slice(-10) + ') – warte auf Laden …');
    await AdMob.showBanner({
      adId: u.adId, adSize: 'ADAPTIVE_BANNER',
      position: 'BOTTOM_CENTER', margin: 0, isTesting: u.testing
    });
    bannerCreated = true;
    bannerOn = true;
    D('showBanner: OK');
  } catch (e) { setStatus('showBanner-Fehler: ' + (e?.message || e)); }
}

// Banner ausblenden (z. B. waehrend einer Partie, damit nichts verdeckt wird).
export async function hideBanner() {
  removePreviewBanner();                               // Browser-Vorschau
  setAdVar(0);                                         // Platz unten wieder freigeben
  if (!bannerOn) return;
  const AdMob = admob(); if (!AdMob) return;
  try { await AdMob.hideBanner(); } catch (_) {}
  bannerOn = false;
}

// Gemeinsamer Interstitial-Kern (Vollbild-Werbung), mit allen Guards.
async function showInterstitialNow() {
  if (adsBlocked()) return;
  if (preview) { showPreviewInterstitial(); return; }  // Browser-Vorschau
  if (!ready) return;
  const AdMob = admob(); if (!AdMob) return;
  try {
    const u = adUnit('interstitial');
    setStatus('Vollbild-Werbung angefordert (' + (u.testing ? 'Testanzeige' : 'echte Anzeige') + ') …');
    await AdMob.prepareInterstitial({ adId: u.adId, isTesting: u.testing });
    await AdMob.showInterstitial();
  } catch (e) { setStatus('Interstitial-Fehler: ' + (e?.message || e)); }
}

// Vor Runde 1 bzw. zur Spielhaelfte (nur Solo-Modus) gab es frueher jeweils eine
// Vollbild-Werbung. Beides ist bewusst DEAKTIVIERT (No-Op): eine Werbung, BEVOR
// man ueberhaupt spielt (preGameAd), und eine mitten in der kurzen Blitz-Partie
// (midGameAd) sind die groessten Retention-Killer. Die einzige verbleibende
// Vollbild-Werbung ist gameOverAd (gedrosselt: nur jedes 3. Spiel). Die Funktionen
// bleiben als leere Huellen erhalten, damit ihre Aufrufer (local.js) unveraendert
// laufen. Zum Reaktivieren: Rumpf wieder auf `await showInterstitialNow();` setzen.
export async function preGameAd() { /* deaktiviert – siehe Kommentar oben */ }
export async function midGameAd() { /* deaktiviert – siehe Kommentar oben */ }

// Vollbild-Werbung am Spielende (gedrosselt ueber everyNthGame).
export async function gameOverAd() {
  if (adsBlocked()) return;
  gamesSinceAd++;
  if (gamesSinceAd < EVERY_NTH_GAME) return;
  gamesSinceAd = 0;
  await showInterstitialNow();
}

// --- Rewarded-Video ("Werbung ansehen -> Belohnung") ------------------------
// Liefert true, wenn das Video bis zur Belohnung angesehen wurde.
let rewardListenersOn = false;
let rewardResolve = null;
let gotReward = false;

function resolveReward(ok) {
  const r = rewardResolve; rewardResolve = null;
  if (r) r(ok);
}
function ensureRewardListeners(AdMob) {
  if (rewardListenersOn || !AdMob?.addListener) return;
  rewardListenersOn = true;
  // Plugin-Versionen benennen die Events unterschiedlich (mit/ohne "on"-Praefix)
  // -> beide Varianten registrieren; doppelte Ausloesung ist unschaedlich.
  const on = (names, fn) => names.forEach(n => { try { AdMob.addListener(n, fn); } catch (_) {} });
  on(['onRewardedVideoAdReward', 'rewardedVideoAdReward'], () => {
    gotReward = true;
    setStatus('Belohnung erhalten ✓');
  });
  on(['onRewardedVideoAdDismissed', 'rewardedVideoAdDismissed'], () => resolveReward(gotReward));
  on(['onRewardedVideoAdFailedToLoad', 'rewardedVideoAdFailedToLoad',
      'onRewardedVideoAdFailedToShow', 'rewardedVideoAdFailedToShow'], (err) => {
    const code = err?.code != null ? ' [Code ' + err.code + ']' : '';
    setStatus('Video-Ladefehler' + code + ': ' + (err?.message || JSON.stringify(err || {})));
    resolveReward(false);
  });
}

export async function showRewardedAd() {
  if (preview) return showPreviewRewarded();           // Browser-Vorschau
  if (!isNative()) { setStatus('Videos gibt es nur in der iOS-App.'); return false; }
  if (!ready) await initAds();
  const AdMob = admob(); if (!AdMob || !ready) return false;
  ensureRewardListeners(AdMob);
  gotReward = false;
  const done = new Promise(res => { rewardResolve = res; });
  try {
    const u = adUnit('rewarded');
    setStatus('Video-Werbung angefordert (' + (u.testing ? 'Testanzeige' : 'echte Anzeige') + ') – warte auf Laden …');
    await AdMob.prepareRewardVideoAd({ adId: u.adId, isTesting: u.testing });
    const item = await AdMob.showRewardVideoAd();
    // Manche Plugin-Builds liefern die Belohnung direkt zurueck statt (nur)
    // per Event – beide Wege zaehlen.
    if (item && (item.type != null || item.amount != null)) { gotReward = true; setStatus('Belohnung erhalten ✓'); }
  } catch (e) {
    setStatus('Video-Fehler: ' + (e?.message || e));
    resolveReward(false);
  }
  // Sicherheitsnetz: falls das Dismiss-Event nie kommt, nach 120 s aufloesen.
  const timeout = new Promise(res => setTimeout(() => res(gotReward), 120000));
  return Promise.race([done, timeout]);
}

// Browser-Vorschau des Rewarded-Videos: Countdown, danach "Belohnung erhalten".
function showPreviewRewarded() {
  return new Promise((resolve) => {
    if (document.getElementById('ad-preview-reward')) { resolve(false); return; }
    const ov = document.createElement('div');
    ov.id = 'ad-preview-reward';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(6,4,16,.94);display:flex;'
      + 'flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px';
    ov.innerHTML = '<div style="font-size:11px;background:#c6a24c;color:#1a1033;padding:2px 9px;border-radius:5px;letter-spacing:.5px">ANZEIGE</div>'
      + '<div style="font-family:Cinzel,Georgia,serif;color:#e9c873;font-size:1.35rem">Beispiel-Videowerbung (Belohnung)</div>'
      + '<div style="color:rgba(255,255,255,.6);font-size:.85rem;max-width:300px;line-height:1.5">In der App läuft hier ein kurzes Werbevideo. Wer es zu Ende ansieht, bekommt die Belohnung.</div>';
    const btn = document.createElement('button');
    btn.disabled = true; btn.textContent = 'Belohnung in 5 …';
    btn.style.cssText = 'margin-top:8px;padding:11px 22px;border-radius:24px;border:1px solid #c6a24c;background:#a78bfa;'
      + 'color:#1a1033;font-weight:700;cursor:pointer;opacity:.45';
    const cancel = document.createElement('button');
    cancel.textContent = 'Abbrechen';
    cancel.style.cssText = 'padding:8px 18px;border-radius:24px;border:1px solid rgba(255,255,255,.25);background:transparent;'
      + 'color:rgba(255,255,255,.6);font-weight:600;cursor:pointer';
    ov.appendChild(btn); ov.appendChild(cancel);
    document.body.appendChild(ov);
    let n = 5;
    const t = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(t); btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '✕ Schließen (Belohnung erhalten)'; }
      else btn.textContent = 'Belohnung in ' + n + ' …';
    }, 1000);
    btn.onclick = () => { clearInterval(t); ov.remove(); resolve(true); };
    cancel.onclick = () => { clearInterval(t); ov.remove(); resolve(false); };
  });
}
