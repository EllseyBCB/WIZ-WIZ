// Spielsteine (Tokens): Jedes Spiel (Solo + Online) kostet 1 Stein.
// Maximal TOKENS_MAX gratis, TAEGLICH wieder aufgefuellt (Lokalzeit).
// Ohne Steine: 2 Rewarded-Videos ansehen -> 1 Spiel frei.
//
// Gilt NUR in der nativen App (im Browser ist alles frei – die Web-Version ist
// die Vorschau). Mit ?ads=preview laesst sich der komplette Ablauf auch im
// Browser durchspielen (Platzhalter-Videos). Werbefrei-Kaeufer, Inhaber-Konto
// und ?shop=dev spielen unbegrenzt.
//
// Hinweis: bewusst nur localStorage (kein Server) – wer seine Geraeteuhr
// verstellt, kann sich Steine erschummeln. Fuer v1 akzeptiert.
import { isNative, isPreview, isForceTest, isAdFree, showRewardedAd } from './ads.js?v=8';
import { isDevUnlock, ownerUnlock } from './cosmetics.js?v=10';
import { toast } from './ui.js?v=2';

export const TOKENS_MAX = 3;
const ADS_PER_UNLOCK = 2;             // so viele Videos schalten 1 Spiel frei
const LS_TOKENS = 'wizard_tokens';    // JSON {n, day}   day = 'YYYY-MM-DD' Lokalzeit
const LS_UNLOCK = 'wizard_adunlock';  // JSON {c, day}   Teilfortschritt (1/2) ueberlebt Neustart

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
  return isNative() || isPreview();   // Browser ohne Vorschau: frei
}

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_TOKENS)); } catch (_) {}
  if (!s || typeof s.n !== 'number' || s.day !== today()) {
    s = { n: TOKENS_MAX, day: today() };   // taeglicher Refill (lazy, Lokalzeit)
    save(s);
  }
  return s;
}
function save(s) { try { localStorage.setItem(LS_TOKENS, JSON.stringify(s)); } catch (_) {} }
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
  s.n = Math.min(TOKENS_MAX, s.n + 1); save(s); notify();
}

// Zentrales Gate fuer alle "Spiel starten"-Knoepfe: zieht einen Stein ab und
// ruft onProceed, oder oeffnet das "2 Videos ansehen"-Fenster.
export function requireToken(onProceed) {
  if (!tokenGateActive()) { onProceed(); return; }
  if (spendToken()) { onProceed(); return; }
  openTokenModal(onProceed);
}

// --- "Keine Spielsteine mehr"-Fenster ---------------------------------------
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

function openTokenModal(onProceed) {
  document.getElementById('token-modal')?.remove();
  let seen = unlockProgress();

  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'token-modal';
  wrap.innerHTML = `
    <div class="modal-card token-card">
      <button class="modal-x" type="button" aria-label="Schließen">✕</button>
      <h2>🎟 Keine Spielsteine mehr</h2>
      <p class="muted" style="margin:6px 0 12px">Du bekommst jeden Tag ${TOKENS_MAX} neue Spielsteine.
        Oder schau ${ADS_PER_UNLOCK} kurze Werbevideos und spiele sofort weiter.</p>
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
    // Beide Videos gesehen -> 1 Spiel frei (Stein gutschreiben + sofort einloesen).
    setUnlockProgress(0);
    refundToken();
    spendToken();
    close();
    toast('Viel Spaß! 🎉', 'ok');
    onProceed();
  };
}
