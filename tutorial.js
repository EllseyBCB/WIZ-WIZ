// Geführtes Onboarding ("Tutorial") als echte Proberunde gegen Bots.
//
// Kein statisches Klick-durch: das Tutorial startet ein kurzes Solo-Spiel
// (local.js -> startTutorial) und legt Coachmarks (Glüh-Ring + Sprechblase +
// Pfeil) ueber die echten UI-Elemente. Die Schritte synchronisieren sich mit
// dem tatsaechlichen Spielverlauf ueber das 'wiz-solo-state'-Ereignis, das
// local.js bei jedem Neuzeichnen sendet (Phase, wer am Zug ist).
//
// Erster Start: app.js ruft beim allerersten Oeffnen (nach der Einwilligung)
// maybeStartTutorial(); das Flag liegt – wie 'wizard_help_seen' – im
// localStorage ('wizard_tutorial_done'). Ueber die Einstellungen laesst es sich
// jederzeit erneut abspielen.
//
// Bewusst OHNE Aenderungen an index.html: eigenes <style> und eigene Knoten
// werden zur Laufzeit eingehaengt.

const LS_DONE = 'wizard_tutorial_done';

export function tutorialDone() {
  try { return localStorage.getItem(LS_DONE) === '1'; } catch (_) { return false; }
}
function markDone() {
  // help_seen gleich mitsetzen: wer das Tutorial gesehen hat, braucht das
  // alte Kurzregeln-Fenster nicht mehr automatisch.
  try { localStorage.setItem(LS_DONE, '1'); localStorage.setItem('wizard_help_seen', '1'); } catch (_) {}
}

// --- Laufzeit-Zustand -------------------------------------------------------
let active = false;
let curState = { status: 'none' };
let currentTarget = null;      // CSS-Selektor des aktuell hervorgehobenen Elements (oder null = mittig)
let bubbleAnchor = 'center';   // Lage der ankerlosen Blase: 'center' oder 'bottom'
                               // ('bottom' fuer den Ansage-Schritt, damit die
                               //  Blase das mittige Bid-Fenster nicht verdeckt)
let rafId = 0;
let root = null, ring = null, arrow = null, bubble = null;
const waiters = new Set();      // offene waitFor-/Weiter-Aufloeser (fuer Abbruch)
// Halt-Steuerung fuer die Proberunde (local.setTutorialHold). Reicht app.js
// durch; ohne sie passiert nichts (Fallback = No-op), damit tutorial.js nicht
// hart an local.js gekoppelt ist.
let holdFn = () => {};
function hold(on) { try { holdFn(!!on); } catch (_) {} }

// local.js meldet den Spielstand.
window.addEventListener('wiz-solo-state', (e) => {
  curState = e.detail || { status: 'gone' };
  // Verlaesst der Nutzer die Proberunde, raeumen wir auf und merken sie als
  // gesehen (sonst startet sie beim naechsten Oeffnen erneut).
  if (active && curState.status === 'gone') finish();
});

// --- Styles + Knoten --------------------------------------------------------
function injectStyles() {
  if (document.getElementById('tut-style')) return;
  const s = document.createElement('style');
  s.id = 'tut-style';
  s.textContent = `
  #tut-root { position: fixed; inset: 0; z-index: 1500; pointer-events: none; }
  #tut-ring { position: absolute; border-radius: 16px; pointer-events: none;
    border: 3px solid #ffd76a; box-shadow: 0 0 0 4px rgba(255,215,106,.35),
      0 0 22px 6px rgba(255,215,106,.55), 0 0 0 4000px rgba(8,4,20,.55);
    transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease;
    animation: tutPulse 1.4s ease-in-out infinite; }
  #tut-ring.hidden { display: none; }
  @keyframes tutPulse { 0%,100% { box-shadow: 0 0 0 4px rgba(255,215,106,.30),
      0 0 18px 4px rgba(255,215,106,.45), 0 0 0 4000px rgba(8,4,20,.55); }
    50% { box-shadow: 0 0 0 6px rgba(255,215,106,.50),
      0 0 30px 10px rgba(255,215,106,.70), 0 0 0 4000px rgba(8,4,20,.55); } }
  #tut-bubble { position: fixed; z-index: 1502; pointer-events: auto;
    max-width: min(340px, 84vw); background: linear-gradient(180deg,#241a3d,#1a1230);
    color: #f4ecff; border: 1.5px solid rgba(255,215,106,.55); border-radius: 16px;
    padding: 15px 16px 13px; box-shadow: 0 14px 40px rgba(0,0,0,.6);
    font-size: .96rem; line-height: 1.4; transition: left .18s ease, top .18s ease; }
  #tut-bubble .tut-title { font-weight: 700; color: #ffd76a; margin-bottom: 5px; font-size: 1.02rem; }
  #tut-bubble .tut-text b { color: #ffe49a; }
  #tut-bubble .tut-foot { display: flex; align-items: center; justify-content: space-between;
    gap: 10px; margin-top: 12px; }
  #tut-bubble .tut-skip { background: none; border: none; color: #b9a9d8; font-size: .82rem;
    text-decoration: underline; cursor: pointer; padding: 4px 2px; }
  #tut-bubble .tut-next { background: linear-gradient(180deg,#ffd76a,#e6b23c); color: #2a1c05;
    border: none; border-radius: 10px; font-weight: 700; padding: 9px 16px; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,.35); }
  #tut-bubble .tut-hintwait { color: #b9a9d8; font-size: .82rem; font-style: italic; }
  #tut-arrow { position: fixed; z-index: 1501; width: 0; height: 0; pointer-events: none;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); transition: left .18s ease, top .18s ease; }
  `;
  document.head.appendChild(s);
}

function mountNodes() {
  root = document.createElement('div'); root.id = 'tut-root';
  ring = document.createElement('div'); ring.id = 'tut-ring'; ring.className = 'hidden';
  arrow = document.createElement('div'); arrow.id = 'tut-arrow';
  bubble = document.createElement('div'); bubble.id = 'tut-bubble';
  root.appendChild(ring);
  document.body.appendChild(root);
  document.body.appendChild(arrow);
  document.body.appendChild(bubble);
}

function teardown() {
  active = false;
  currentTarget = null;
  hold(false);   // etwaigen Bot-Halt in local.js sicher loesen
  if (rafId) cancelAnimationFrame(rafId), rafId = 0;
  root?.remove(); arrow?.remove(); bubble?.remove();
  root = ring = arrow = bubble = null;
  // offene Wartungen aufloesen, damit run() sauber endet
  for (const w of [...waiters]) w();
  waiters.clear();
}

function finish() {
  if (!active) return;
  markDone();
  teardown();
}
function skip() { finish(); }

// --- Positionierung (laeuft pro Frame, weil das Spiel bei jedem Zug neu
// zeichnet und Ziel-Elemente dabei neu entstehen) ---------------------------
function visibleTarget() {
  if (!currentTarget) return null;
  for (const sel of currentTarget.split(',')) {
    const el = document.querySelector(sel.trim());
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight) return r;
  }
  return null;
}

function place() {
  if (!active || !bubble) return;
  const r = visibleTarget();
  if (!r) {
    ring.className = 'hidden';
    arrow.style.display = 'none';
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    bubble.style.left = Math.round((innerWidth - bw) / 2) + 'px';
    if (bubbleAnchor === 'bottom') {
      // Unten am Bildschirmrand (mit Safe-Area-Reserve) – so bleibt das mittige
      // Ansage-Fenster mit seinen Zahlen-Knoepfen frei sichtbar.
      const safe = 24 + (parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--sat-bottom')) || 0);
      bubble.style.top = Math.round(innerHeight - bh - safe) + 'px';
    } else {
      // mittig
      bubble.style.top = Math.round((innerHeight - bh) / 2) + 'px';
    }
    rafId = requestAnimationFrame(place);
    return;
  }
  // Ring um das Ziel
  const pad = 8;
  ring.className = '';
  ring.style.left = Math.round(r.left - pad) + 'px';
  ring.style.top = Math.round(r.top - pad) + 'px';
  ring.style.width = Math.round(r.width + pad * 2) + 'px';
  ring.style.height = Math.round(r.height + pad * 2) + 'px';

  // Sprechblase ober- oder unterhalb des Ziels platzieren
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  const targetCenterY = r.top + r.height / 2;
  const below = targetCenterY < innerHeight * 0.5;   // Ziel oben -> Blase darunter
  let bx = Math.round(r.left + r.width / 2 - bw / 2);
  bx = Math.max(10, Math.min(bx, innerWidth - bw - 10));
  let by = below ? Math.round(r.bottom + pad + 14) : Math.round(r.top - pad - 14 - bh);
  by = Math.max(10, Math.min(by, innerHeight - bh - 10));
  bubble.style.left = bx + 'px';
  bubble.style.top = by + 'px';

  // kleiner Pfeil zwischen Blase und Ziel
  const ax = Math.max(r.left, Math.min(r.left + r.width / 2, r.right));
  arrow.style.display = 'block';
  if (below) {
    arrow.style.left = Math.round(ax - 9) + 'px';
    arrow.style.top = Math.round(by - 12) + 'px';
    arrow.style.borderLeft = '9px solid transparent';
    arrow.style.borderRight = '9px solid transparent';
    arrow.style.borderTop = 'none';
    arrow.style.borderBottom = '12px solid #ffd76a';
  } else {
    arrow.style.left = Math.round(ax - 9) + 'px';
    arrow.style.top = Math.round(by + bh) + 'px';
    arrow.style.borderLeft = '9px solid transparent';
    arrow.style.borderRight = '9px solid transparent';
    arrow.style.borderBottom = 'none';
    arrow.style.borderTop = '12px solid #ffd76a';
  }
  rafId = requestAnimationFrame(place);
}

// --- Blasen-Inhalt ----------------------------------------------------------
function setBubble({ title, text, btn, waitHint, skip: showSkip = true }) {
  bubble.innerHTML =
    (title ? `<div class="tut-title">${title}</div>` : '') +
    `<div class="tut-text">${text}</div>` +
    `<div class="tut-foot">` +
      (showSkip ? `<button class="tut-skip" type="button">Tutorial überspringen</button>` : `<span></span>`) +
      (btn ? `<button class="tut-next" type="button">${btn}</button>`
           : (waitHint ? `<span class="tut-hintwait">${waitHint}</span>` : ``)) +
    `</div>`;
  bubble.querySelector('.tut-skip')?.addEventListener('click', skip);
}

// Weiter-Schritt: wartet auf den Knopf.
function waitNext(opts) {
  return new Promise((resolve) => {
    const done = () => { waiters.delete(done); resolve(); };
    waiters.add(done);
    setBubble(opts);
    bubble.querySelector('.tut-next')?.addEventListener('click', done, { once: true });
  });
}

// Aktions-Schritt: zeigt einen Hinweis und wartet, bis der Spielstand die
// Bedingung erfuellt (der Nutzer also die richtige Aktion gemacht hat).
function showHint(opts) { setBubble({ ...opts, btn: null }); }
function waitFor(pred) {
  return new Promise((resolve) => {
    const done = () => { waiters.delete(done); window.removeEventListener('wiz-solo-state', h); resolve(curState); };
    const h = (e) => { if (!active || pred(e.detail)) done(); };
    waiters.add(done);
    if (pred(curState)) return done();
    window.addEventListener('wiz-solo-state', h);
  });
}

// --- Ablauf -----------------------------------------------------------------
// startGame: Callback aus app.js, startet die Proberunde (local.startTutorial).
// opts.setHold: local.setTutorialHold – haelt die Bots an, solange eine
// Erklaerblase offen ist (siehe Stich-/Wertung-Schritt).
export function beginTutorial(startGame, opts = {}) {
  if (active) return;
  holdFn = typeof opts.setHold === 'function' ? opts.setHold : () => {};
  active = true;
  bubbleAnchor = 'center';
  curState = { status: 'none' };
  injectStyles();
  mountNodes();
  rafId = requestAnimationFrame(place);
  run(startGame).catch(() => {}).finally(() => { if (active) finish(); });
}

async function run(startGame) {
  currentTarget = null;
  await waitNext({
    title: 'Willkommen bei Zaubertisch! 🪄',
    text: 'Ich führe dich einmal durch eine kurze Proberunde gegen Computer-Gegner. '
        + 'Das Ziel: Sag <b>genau voraus</b>, wie viele Stiche du holst.',
    btn: 'Los geht’s'
  });
  if (!active) return;

  // Proberunde starten (teilt Karten aus, zeigt den Tisch).
  try { startGame(); } catch (_) {}
  await waitFor(s => s.status === 'running' || s.status === 'gone');
  if (!active || curState.status !== 'running') return;

  // 1) Trumpf: als Geber selbst waehlen – sonst nur erklaeren.
  if (curState.phase === 'trumpselect' && curState.myTurn) {
    currentTarget = '.trump-row';
    showHint({
      text: 'Du bist der <b>Kartengeber</b>. Wähle eine Trumpffarbe – tippe unten auf eine Farbe.',
      waitHint: 'Wähle eine Farbe …'
    });
    await waitFor(s => s.phase !== 'trumpselect' || s.status !== 'running');
    if (!active || curState.status !== 'running') return;
  }

  // 2) Trumpf-Karte erklaeren.
  currentTarget = '.trump-badge';
  await waitNext({
    text: 'Das ist der <b>Trumpf</b>. Karten dieser Farbe stechen jede andere Farbe – '
        + 'die Zauberer (Z) gewinnen immer, die Narren (N) verlieren immer.',
    btn: 'Weiter'
  });
  if (!active) return;

  // 3) Eigene Hand.
  currentTarget = '.hand-dock';
  await waitNext({
    text: 'Das sind <b>deine Karten</b>. In der ersten Runde hat jede:r nur eine Karte.',
    btn: 'Weiter'
  });
  if (!active) return;

  // 4) Ansage (Gebot). Das Ansage-Fenster oeffnet sich automatisch mittig.
  await waitFor(s => (s.phase === 'bidding' && s.myTurn) || s.status !== 'running');
  if (!active || curState.status !== 'running') return;
  currentTarget = null;
  bubbleAnchor = 'bottom';   // Blase nach unten – das Ansage-Fenster liegt mittig
  showHint({
    title: 'Deine Ansage',
    text: 'Wie viele Stiche holst du? Tippe im Fenster eine Zahl – bei nur einer Karte '
        + 'meist <b>0</b> (du willst keinen Stich) oder <b>1</b>.',
    waitHint: 'Sag deine Stichzahl an …'
  });
  await waitFor(s => !(s.phase === 'bidding' && s.myTurn) || s.status !== 'running');
  bubbleAnchor = 'center';   // fuer folgende ankerlose Schritte wieder mittig
  if (!active || curState.status !== 'running') return;

  // 5) Ausspielen.
  await waitFor(s => (s.phase === 'playing' && s.myTurn) || s.status !== 'running');
  if (!active || curState.status !== 'running') return;
  currentTarget = '.hand-dock';
  showHint({
    text: 'Du bist am Zug: <b>spiel eine Karte aus</b> – tippe sie doppelt an oder zieh sie in die Mitte.',
    waitHint: 'Spiel eine Karte …'
  });
  await waitFor(s => !(s.phase === 'playing' && s.myTurn) || s.status !== 'running');
  if (!active || curState.status !== 'running') return;

  // 6) Stich. Sobald der Stich fertig ist (Ereignis 'trickend'), halten wir die
  //    Bots an: so friert local.js das Board auf dem gerade gespielten Stich ein
  //    (Stich-Stapel bleibt gefuellt) und Runde 2 startet NICHT im Hintergrund,
  //    solange die beiden Erklaerblasen offen sind.
  await waitFor(s => s.phase === 'trickend' || s.roundNo > 1 || s.status !== 'running');
  if (!active) return;
  if (curState.status === 'running') {
    hold(true);
    currentTarget = '.trick-pile';
    await waitNext({
      text: 'Das ist ein <b>Stich</b>. Es gewinnt die höchste Karte der angespielten Farbe – '
          + 'oder der höchste Trumpf.',
      btn: 'Weiter'
    });
    if (!active) return;

    // 7) Wertung.
    currentTarget = '.scoreboard';
    await waitNext({
      title: 'Die Wertung',
      text: 'Ansage <b>genau getroffen</b>: 20 Punkte + 10 je Stich. '
          + '<b>Daneben</b>: −10 für jeden Stich Unterschied.',
      btn: 'Weiter'
    });
    // Bots wieder laufen lassen – die Proberunde geht normal weiter.
    hold(false);
    if (!active) return;
  }

  // Abschluss.
  currentTarget = null;
  await waitNext({
    title: 'Geschafft! 🎉',
    text: 'Du kennst jetzt die Grundregeln. Spiel diese Proberunde in Ruhe zu Ende – '
        + 'danach warten echte Spiele und der Online-Modus.',
    btn: 'Weiterspielen',
    skip: false
  });
  finish();
}

// "Tutorial erneut anzeigen" in die Einstellungen einhaengen (ohne index.html
// anzufassen). onReplay wird beim Klick aufgerufen.
export function installSettingsButton(onReplay) {
  const modal = document.getElementById('settings-modal');
  if (!modal || modal.querySelector('#tut-replay-row')) return;
  const closeBtn = document.getElementById('settings-close');
  const row = document.createElement('div');
  row.id = 'tut-replay-row';
  row.innerHTML = `<h3 class="set-subtitle">Hilfe</h3>`
    + `<button class="btn sekundaer" id="tut-replay-btn" type="button">🎓 Tutorial erneut anzeigen</button>`;
  if (closeBtn && closeBtn.parentNode) closeBtn.parentNode.insertBefore(row, closeBtn);
  else modal.querySelector('.modal-card')?.appendChild(row);
  row.querySelector('#tut-replay-btn').onclick = () => { onReplay?.(); };
}
