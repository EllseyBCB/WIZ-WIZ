// Notizblöcke (Spiel-Tokens): Jedes Spiel (Solo + Online) kostet 1 Notizblock.
// Gratis pro Tag = die freigeschalteten Slots (Standard 1, per Slot-Upgrade im
// Shop auf 2/3/5 erhoehbar), TAEGLICH wieder aufgefuellt (Lokalzeit).
// Ohne Notizbloecke: 2 Rewarded-Videos ansehen -> 1 Notizblock; oder Pakete
// mit Kristallen kaufen (im Shop).
//
// Gilt NUR in der nativen App (im Browser ist alles frei – die Web-Version ist
// die Vorschau). Mit ?ads=preview laesst sich der komplette Ablauf auch im
// Browser durchspielen (Platzhalter-Videos). Werbefrei-Kaeufer, Inhaber-Konto
// und ?shop=dev spielen unbegrenzt.
//
// Hinweis: die Notizblock-Zahl liegt bewusst nur im localStorage (kein Server) –
// bekannte v1-Abwaegung. Kristalle/Truhen sind dagegen serverseitig sicher.
import { isNative, isPreview, isForceTest, isAdFree, showRewardedAd } from './ads.js?v=8';
import { isDevUnlock, ownerUnlock } from './cosmetics.js?v=10';
import { toast } from './ui.js?v=2';

const DAILY_DEFAULT = 1;              // Gratis-Notizbloecke pro Tag ohne Upgrade
const TOKENS_HARD_CAP = 99;           // absoluter Deckel (gekaufte Pakete stapeln)
const ADS_PER_UNLOCK = 2;             // so viele Videos schalten 1 Notizblock frei
const LS_TOKENS = 'wizard_tokens';    // JSON {n, day}   day = 'YYYY-MM-DD' Lokalzeit
const LS_UNLOCK = 'wizard_adunlock';  // JSON {c, day}   Teilfortschritt (1/2) ueberlebt Neustart
const LS_SLOTS  = 'wizard_dailyslots';// Zahl: freigeschaltete Gratis-Slots pro Tag
const LS_FREE   = 'wizard_free_until';// ISO-Zeit: Ende des Gratismonats (server-abgeleitet)

// --- Gratismonat: erste 30 Tage nach Kontoerstellung komplett frei ----------
// Das Enddatum leiten wir aus dem SERVER-Erstellungsdatum ab (RPC
// wizard_free_period -> auth.users.created_at). Der Cache im localStorage ist
// nur eine Beschleunigung/Offline-Reserve: bei jedem Start holt app.js den Wert
// neu vom Server, ein Zuruecksetzen des localStorage verschafft also keinen
// neuen Gratismonat (der Server liefert dasselbe created_at). Fehlt jede Info
// (offline + kein Cache), gilt sicherheitshalber die normale Sperre.
const FREE_DAYS = 30;
let freeUntilMem = null;   // In-Memory-Spiegel (localStorage evtl. nicht schreibbar)

// Serverantwort von db.freePeriod() uebernehmen ({ free, created_at, days_left }).
export function applyFreePeriod(info) {
  let untilMs = null;
  if (info && info.created_at) {
    const t = Date.parse(info.created_at);
    if (!isNaN(t)) untilMs = t + FREE_DAYS * 86400000;
  } else if (info && info.free === false) {
    untilMs = 0;   // Server sagt eindeutig: kein Gratismonat mehr
  }
  if (untilMs === null) return;   // keine verwertbare Antwort -> Cache unveraendert
  freeUntilMem = untilMs;
  try {
    if (untilMs > 0) localStorage.setItem(LS_FREE, new Date(untilMs).toISOString());
    else localStorage.removeItem(LS_FREE);
  } catch (_) {}
  notify();
}

function freeUntilMs() {
  if (typeof freeUntilMem === 'number') return freeUntilMem;
  try {
    const s = localStorage.getItem(LS_FREE);
    if (s) { const t = Date.parse(s); if (!isNaN(t)) return t; }
  } catch (_) {}
  return null;
}
export function freeMonthActive() {
  const t = freeUntilMs();
  return t != null && t > 0 && Date.now() < t;
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Ist das Token-System gerade aktiv?
export function tokenGateActive() {
  // Testanzeigen-Schalter: aktiviert das Gate auch fuer Inhaber/Werbefrei,
  // damit der komplette Ablauf auf dem Geraet testbar ist (wie adsBlocked()).
  if (isForceTest()) return isNative() || isPreview();
  if (isAdFree() || isDevUnlock() || ownerUnlock()) return false;   // unbegrenzt
  if (freeMonthActive()) return false;   // erster Monat nach Kontoerstellung: alles frei
  return isNative() || isPreview();   // Browser ohne Vorschau: frei
}

// --- Taegliche Slots (Gratis-Notizbloecke pro Tag) -------------------------
export function getDailySlots() {
  let n = parseInt(localStorage.getItem(LS_SLOTS), 10);
  if (![1, 2, 3, 5].includes(n)) n = DAILY_DEFAULT;
  return n;
}
export function setDailySlots(n) {
  const v = [1, 2, 3, 5].includes(n) ? n : DAILY_DEFAULT;
  try { localStorage.setItem(LS_SLOTS, String(v)); } catch (_) {}
  notify();
}
// Aus dem Server-Inventar die hoechste gekaufte Slot-Stufe ableiten + spiegeln.
export function deriveDailySlots(inventory) {
  const map = { slots_5: 5, slots_3: 3, slots_2: 2 };
  let s = DAILY_DEFAULT;
  for (const id of (inventory || [])) if (map[id]) s = Math.max(s, map[id]);
  if (s !== getDailySlots()) setDailySlots(s);
  return s;
}

// In-Memory-Spiegel: haelt den Stand auch, wenn localStorage nicht schreibbar
// ist (Safari-Privatmodus / WKWebView ohne persistenten Speicher / ITP-Loeschung).
// Ohne diesen Spiegel schluckt save() den Schreibfehler und load() rechnet bei
// JEDEM Lesen wieder den Tages-Default (1) aus -> ein gekauftes Notizblock-Paket
// zieht serverseitig Kristalle ab, die Zahl auf der Startseite bleibt aber bei 1.
let mem = null;

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_TOKENS)); } catch (_) {}
  // localStorage leer/kaputt -> auf den In-Memory-Spiegel zurueckgreifen, damit
  // ein fehlgeschlagener Schreibversuch nicht jede Gutschrift wieder verwirft.
  if ((!s || typeof s.n !== 'number') && mem && typeof mem.n === 'number') s = mem;
  if (!s || typeof s.n !== 'number' || s.day !== today()) {
    // Neuer Tag: mind. auf die Tages-Slots auffuellen, gekaufte Extra-Pakete
    // aber NICHT wegwerfen (max), und der Gratis-Grant ueberfuellt nicht.
    const prev = (s && typeof s.n === 'number') ? s.n : 0;
    s = { n: Math.max(prev, getDailySlots()), day: today() };
    save(s);
  }
  mem = s;
  return s;
}
function save(s) {
  mem = s;   // Spiegel immer aktuell halten, auch wenn das Schreiben scheitert.
  try { localStorage.setItem(LS_TOKENS, JSON.stringify(s)); } catch (_) {}
}
function notify() { try { window.dispatchEvent(new Event('wiz-tokens-changed')); } catch (_) {} }

export function getTokens() { return load().n; }

export function spendToken() {
  const s = load();
  if (s.n <= 0) return false;
  s.n -= 1; save(s); notify();
  return true;
}

// Erstattung (z. B. Online-Spiel kam nicht zustande / RPC-Fehler).
export function refundToken() {
  const s = load();
  s.n = Math.min(TOKENS_HARD_CAP, s.n + 1); save(s); notify();
}

// Notizbloecke gutschreiben (Paket-Kauf, Video-Belohnung).
export function grantTokens(n) {
  const s = load();
  s.n = Math.max(0, Math.min(TOKENS_HARD_CAP, s.n + (n | 0))); save(s); notify();
}

// Nur zum Testen: Notizblock-Zahl direkt setzen (z. B. auf 0).
export function setTokensForTest(n) {
  const s = load();
  s.n = Math.max(0, Math.min(TOKENS_HARD_CAP, n | 0));
  save(s); notify();
}

// Zentrales Gate fuer alle "Spiel starten"-Knoepfe: zieht einen Notizblock ab
// und ruft onProceed, oder oeffnet das "2 Videos ansehen"-Fenster.
export function requireToken(onProceed) {
  if (!tokenGateActive()) { onProceed(); return; }
  if (spendToken()) { onProceed(); return; }
  openTokenModal(onProceed);
}

// Shop-Einstieg: 2 Videos ansehen -> 1 Notizblock gutschreiben (ohne Spielstart).
export function watchAdForToken(onGranted) {
  openTokenModal(null, { grantOnly: true, onGranted });
}

// --- "Keine Notizblöcke mehr"-Fenster --------------------------------------
function unlockProgress() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(LS_UNLOCK)); } catch (_) {}
  return (u && u.day === today() && typeof u.c === 'number') ? u.c : 0;
}
function setUnlockProgress(c) {
  try {
    if (c > 0) localStorage.setItem(LS_UNLOCK, JSON.stringify({ c, day: today() }));
    else localStorage.removeItem(LS_UNLOCK);
  } catch (_) {}
}

// onProceed: Spielstart nach Freischaltung (requireToken-Weg).
// opts.grantOnly: nur 1 Notizblock gutschreiben (Shop-Weg), opts.onGranted danach.
function openTokenModal(onProceed, opts = {}) {
  const grantOnly = !!opts.grantOnly;
  document.getElementById('token-modal')?.remove();
  let seen = unlockProgress();

  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'token-modal';
  const NOTE = '<img class="note-ic" src="lobby/ic-notizbuch.png?v=1" alt="">';
  const head = grantOnly ? NOTE + ' Notizblock verdienen' : NOTE + ' Keine Notizblöcke mehr';
  wrap.innerHTML = `
    <div class="modal-card token-card">
      <button class="modal-x" type="button" aria-label="Schließen">✕</button>
      <h2>${head}</h2>
      <p class="muted" style="margin:6px 0 12px">Jeden Tag gibt es gratis Notizblöcke.
        Oder schau ${ADS_PER_UNLOCK} kurze Werbevideos und bekomme sofort einen Notizblock.</p>
      <div class="tok-dots" aria-hidden="true">
        ${Array.from({ length: ADS_PER_UNLOCK }, (_, i) => `<span class="tok-dot${i < seen ? ' done' : ''}"></span>`).join('')}
      </div>
      <button class="btn" id="tok-watch" type="button">Werbung ansehen (${seen + 1}/${ADS_PER_UNLOCK})</button>
      <button class="btn sekundaer" id="tok-later" type="button" style="margin-top:8px">Später</button>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal-x').onclick = close;
  wrap.querySelector('#tok-later').onclick = close;

  const watchBtn = wrap.querySelector('#tok-watch');
  const dots = wrap.querySelectorAll('.tok-dot');
  watchBtn.onclick = async () => {
    watchBtn.disabled = true;
    const ok = await showRewardedAd();
    if (!ok) {
      watchBtn.disabled = false;
      toast('Video gerade nicht verfügbar – bitte später erneut versuchen.', 'err');
      return;
    }
    seen += 1;
    dots.forEach((d, i) => d.classList.toggle('done', i < seen));
    if (seen < ADS_PER_UNLOCK) {
      setUnlockProgress(seen);
      watchBtn.textContent = `Werbung ansehen (${seen + 1}/${ADS_PER_UNLOCK})`;
      watchBtn.disabled = false;
      return;
    }
    // Beide Videos gesehen.
    setUnlockProgress(0);
    if (grantOnly) {
      grantTokens(1);
      close();
      toast('Notizblock gutgeschrieben! 🎉', 'ok');
      opts.onGranted?.();
    } else {
      // 1 Spiel frei: Notizblock gutschreiben + sofort einloesen.
      grantTokens(1);
      spendToken();
      close();
      toast('Viel Spaß! 🎉', 'ok');
      onProceed?.();
    }
  };
}
