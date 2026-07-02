// Spieltisch-Komponenten: Tisch, Mitspieler, Ablagestapel (Stich) und die
// gefaecherte Hand inkl. Interaktion (Doppelklick / Drag&Drop / Touch).
// Alles haengt am bestehenden State + actions.onPlay – keine Parallel-Logik.
import { renderCard, COLORS, allCardImageUrls } from './cards.js?v=16';
import { esc } from './ui.js?v=2';

// Hellere, gut lesbare Variante der Trumpf-Farbe fuer Text auf dunklem Grund.
const TRUMP_TEXT = { R: '#ff6f73', Y: '#ffd24d', G: '#5fe39b', B: '#8ab0ff' };
function statColor(game) { return TRUMP_TEXT[game.trump_color] || '#ffd66b'; }

// Kraeftige, etwas dunklere Trumpf-Farbe fuer Knoepfe (weisse Schrift lesbar);
// ohne Trumpf sattes Lila als Fallback.
const TRUMP_BTN = { R: '#c8323a', Y: '#b9791a', G: '#1f8f57', B: '#3f6fd0' };
function trumpBtnColor(game) { return TRUMP_BTN[game.trump_color] || '#5b4b8a'; }

// --- kleine Regel-/Anzeige-Helfer ------------------------------------------
function leadColor(trick) {
  const first = trick.find(p => !p.card.startsWith('N'));
  if (!first || first.card.startsWith('Z')) return null;
  return first.card[0];
}
function isLegal(card, hand, lead) {
  if (lead === null) return true;
  if (card.startsWith('Z') || card.startsWith('N')) return true;
  if (card[0] === lead) return true;
  return !hand.some(h => !h.played && h.card[0] === lead);
}
function nameOfSeat(players, seat) {
  return players.find(p => p.seat === seat)?.name ?? '';
}
function phaseText(game) {
  if (game.status === 'finished') return 'Beendet';
  if (game.status === 'aborted') return 'Abgebrochen';
  return { trumpselect: 'Trumpfwahl', bidding: 'Reizen', playing: 'Stich ' + game.trick_no,
           trickend: 'Stich', scoring: 'Wertung' }[game.phase] ?? game.phase;
}

// Aktuellen Fächer fürs Resize-Neulayout merken.
let activeRelayout = null;
let resizeBound = false;
// Vollbild-Kartenansicht ("Alle Karten"): offen-Zustand + montierter Knoten,
// damit das Overlay bei Realtime-Re-Renders frisch neu aufgebaut wird.
let handViewerOpen = false;
let handViewerNode = null;

// Austeil-Animation: zuletzt animierte Runde + aktives Overlay/Timers.
let lastDealKey = null;
let dealOverlayNode = null;
let dealTimers = [];
// Hand erst nach dem Austeilen zeigen: bis dahin verbergen.
let dealEndsAt = 0;
let dealRevealTimer = null;
let lastDockEl = null;
// Nach dem Austeilen: Hand zuerst verdeckt zeigen, dann Karten umdrehen.
let dealCoverActive = false;
let dealRevealStart = 0;
// Frische Runde erkannt, Animation aber noch nicht gestartet -> Hand verbergen,
// damit die Karten nicht eine Frame lang aufblitzen (z. B. Lobby -> Tisch).
let dealPendingKey = null;
// Flug der EIGENEN Karten: die echten Handkarten starten (verdeckt) an der
// Tischmitte und gleiten an ihren Faecherplatz. departs[i] = Abflugzeit der
// Handkarte i. Da das fliegende Element die Karte SELBST ist, landet sie
// konstruktionsbedingt exakt dort, wo sie sich spaeter umdreht.
let dealFlight = null;
// Handfaecher ueber Re-Renders hinweg WIEDERVERWENDEN (gleiche <img>-Elemente),
// damit die eigene Hand beim Legen anderer nicht sichtbar "neu laedt".
// Drop-Zone/Actions werden je Render aktualisiert (nicht in Closures eingefroren).
let lastFanEl = null;
let lastFanItems = [];
let lastFanCodes = [];
let lastFanRound = '';   // Wiederverwendung strikt auf dieselbe Runde begrenzen
let currentDropZone = null;
let currentActions = null;
// Runden-Ladebildschirm: VOR jedem Austeilen (und beim kalten Einstieg mitten
// in eine Runde) erst alle Bilder laden – mit Fortschrittsbalken –, dann erst
// das Spiel starten. loaderKey = gerade ladende Runde, loaderDoneKey = fertig.
let loaderKey = null;
let loaderDoneKey = null;
let loaderNode = null;
let assetsWarm = false;        // Deck in dieser Sitzung schon komplett geladen?
// Fuers Fortsetzen nach dem Laden: letzten Render-Kontext merken.
let lastState = null;
let lastFeltEl = null;
// Das Ladebildschirm-Artwork selbst frueh in den Cache holen.
try { const _la = new Image(); _la.src = 'lobby/loading.jpg?v=1'; } catch (_) {}
function revealHand() { if (lastDockEl && lastDockEl.isConnected) lastDockEl.style.visibility = 'visible'; }

// Noch nicht abgeflogene Handkarten an die Tischmitte versetzen (per-Karte
// Delta als CSS-Variablen; alles IN der Seite -> scroll-/layoutfest).
function applyDealFlight(dock) {
  if (!dealFlight || !dock) return;
  const felt = dock.closest('.felt');
  if (!felt) return;
  const fr = felt.getBoundingClientRect();
  const ox = fr.left + fr.width / 2, oy = fr.top + fr.height * 0.46;
  const now = Date.now();
  dock.querySelectorAll('.fan-card').forEach((el, i) => {
    // Bis zum Aufdecken verdeckt (Rueckseite) – auch beim ALLERERSTEN Render
    // der Runde, wo das Austeil-Fenster beim Handaufbau noch nicht gesetzt war.
    buildFlip(el);
    const t = dealFlight.departs[i];
    if (t === undefined || now >= t) return;      // schon unterwegs/gelandet
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ddx', Math.round(ox - (r.left + r.width / 2)) + 'px');
    el.style.setProperty('--ddy', Math.round(oy - (r.top + r.height / 2)) + 'px');
    el.classList.add('pre-deal');
  });
}

// Handkarte i "abfliegen" lassen: weiche Transition zum normalen Faecherplatz.
function releaseDealCard(i) {
  const el = lastDockEl && lastDockEl.querySelectorAll('.fan-card')[i];
  if (!el || !el.classList.contains('pre-deal')) return;
  el.classList.add('deal-fly');
  void el.offsetWidth;                            // Reflow -> Transition greift
  el.classList.remove('pre-deal');
  dealTimers.push(setTimeout(() => el.classList.remove('deal-fly'), 620));
}

// Baut um eine Handkarte eine Flip-Struktur: Vorderseite (vorhandenes Bild) +
// Rueckseite, beide uebereinander. Start = Rueckseite sichtbar.
function buildFlip(el) {
  let inner = el.querySelector('.flip-inner');
  if (inner) return inner;
  inner = document.createElement('div');
  inner.className = 'flip-inner';
  const front = document.createElement('div');
  front.className = 'flip-front';
  while (el.firstChild) front.appendChild(el.firstChild);   // vorhandene Vorderseite hinein
  const back = document.createElement('div');
  back.className = 'flip-back';
  inner.appendChild(back);
  inner.appendChild(front);
  el.appendChild(inner);
  return inner;
}
// Karten verdeckt vorbereiten und – relativ zum Aufdeck-Start – gestaffelt
// echt umdrehen (funktioniert auch ueber Re-Renders hinweg).
function coverAndScheduleFlip(scopeEl) {
  if (!scopeEl) return;
  const cards = scopeEl.querySelectorAll('.fan-card');
  const elapsed = Date.now() - dealRevealStart;
  cards.forEach((el, i) => {
    const inner = buildFlip(el);
    // Aufdeck-Zeitpunkt dieser Karte: ruhige Pause vor der ersten Karte,
    // dann gemaechlich gestaffelt (die Dreh-Animation selbst dauert ~.9s).
    const t = 550 + i * 190;
    if (elapsed >= t) {
      // Bereits aufgedeckt (z. B. Neu-Render durch ein Bot-Gebot): sofort und
      // OHNE Animation auf die Vorderseite setzen -> kein erneutes Umdrehen.
      inner.classList.add('no-anim', 'show');
      void inner.offsetWidth;              // Reflow erzwingen (Snap)
      inner.classList.remove('no-anim');
    } else {
      dealTimers.push(setTimeout(() => inner.classList.add('show'), t - elapsed));
    }
  });
}
function stripCovers() {            // beim Ueberspringen: alle sofort aufdecken
  if (lastDockEl) lastDockEl.querySelectorAll('.flip-inner').forEach(inner => inner.classList.add('show'));
}

// Avatar: Bild-URL vs. Emoji unterscheiden (wie in app.js/game.js).
const isImg = v => typeof v === 'string' && (/^https?:\/\//.test(v) || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(v));
const avV = s => (typeof s === 'string' && s.startsWith('avatars/')) ? s + '?v=7' : s;
const DEFAULT_AV = 'avatars/av01.png';

// Sitzpositionen (Prozent im Filz) je Gegnerzahl; ich sitze unten-Mitte.
const SEAT_SLOTS = {
  1: [{ t: 17, l: 50 }],
  2: [{ t: 17, l: 20 }, { t: 17, l: 80 }],
  3: [{ t: 40, l: 5 }, { t: 17, l: 50 }, { t: 40, l: 95 }],
  4: [{ t: 40, l: 5 }, { t: 17, l: 29 }, { t: 17, l: 71 }, { t: 40, l: 95 }],
  5: [{ t: 44, l: 12 }, { t: 15, l: 18 }, { t: 15, l: 50 }, { t: 15, l: 82 }, { t: 44, l: 88 }],
};
const ME_SLOT = { t: 68, l: 50 };
// Liefert je Spieler seine Sitz-Position; ich zuerst (unten), Rest reihum ab mir.
function computeSeatLayout(players, mySeat) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  const myIdx = sorted.findIndex(p => p.seat === mySeat);
  const layout = [];
  if (myIdx >= 0) layout.push({ player: sorted[myIdx], pos: ME_SLOT, isMe: true });
  const base = myIdx >= 0 ? myIdx : 0;
  const others = [];
  for (let i = 1; i < sorted.length; i++) others.push(sorted[(base + i) % sorted.length]);
  const slots = SEAT_SLOTS[others.length] || SEAT_SLOTS[2] || [];
  others.forEach((p, i) => layout.push({ player: p, pos: slots[i] || { t: 9, l: 50 }, isMe: false }));
  return layout;
}
function bindResize() {
  if (resizeBound) return;
  resizeBound = true;
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (activeRelayout) activeRelayout(); }, 80);
  });
}

// --- "Statische" Tischansicht ----------------------------------------------
// Tippt man auf den freien Tisch, wird die Ansicht fixiert: man kann nicht mehr
// (versehentlich) nach unten zum Punktestand scrollen. Ein kleiner Knopf hebt
// die Fixierung wieder auf.
function isTableLocked() { return document.body.classList.contains('table-locked'); }
function setTableLock(on) {
  if (on) window.scrollTo(0, 0);
  document.body.classList.toggle('table-locked', on);
}
// Kleinen "Ansicht lösen"-Knopf einmalig anlegen (nur im fixierten Zustand sichtbar).
function ensureLockExitButton() {
  let btn = document.getElementById('table-lock-exit');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'table-lock-exit';
    btn.type = 'button';
    btn.innerHTML = '🔓 Ansicht lösen';
    btn.setAttribute('aria-label', 'Statische Tischansicht verlassen');
    btn.addEventListener('click', (e) => { e.stopPropagation(); setTableLock(false); });
    document.body.appendChild(btn);
  }
  return btn;
}
// Fixierung sicher aufheben, sobald der Spiel-Screen verlassen wird (egal wie).
let lockCleanupBound = false;
function bindLockCleanup() {
  if (lockCleanupBound) return;
  const gv = document.getElementById('game-view');
  if (!gv) return;
  const obs = new MutationObserver(() => {
    if (!gv.classList.contains('active')) {
      setTableLock(false);
      // Spielansicht verlassen (Pause/Beenden): laufende Austeil-Animation
      // sauber beenden. Sonst haengt das fixierte Overlay ueber der Startseite
      // und blockiert Eingaben – und nach dem Fortsetzen bliebe die Hand
      // versteckt, wenn iOS die wartenden Timer verworfen hat.
      clearDeal();
      // Merker zuruecksetzen: Ein NEUES Spiel (Solo hat denselben Schluessel
      // 'solo|1|…') soll wieder mit Ladebildschirm + Austeil-Animation starten.
      lastDealKey = null; loaderDoneKey = null;
      lastFanEl = null; lastFanItems = []; lastFanCodes = [];   // keinen alten Faecher behalten
      document.getElementById('gameover-modal')?.remove();   // Endstand-Overlay weg
    }
  });
  obs.observe(gv, { attributes: true, attributeFilter: ['class'] });
  lockCleanupBound = true;
}

// ---------------------------------------------------------------------------
// Haupteinstieg: Tisch fuer ein laufendes/beendetes Spiel rendern.
// ---------------------------------------------------------------------------
export function renderTable(root, state, actions) {
  bindResize();
  ensureLockExitButton();
  bindLockCleanup();
  const { game, players, uid } = state;
  // Bei beendetem Spiel die Fixierung loesen, damit der Endstand scrollbar ist.
  if (game.status !== 'running') setTableLock(false);
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? -1;

  const table = document.createElement('div');
  table.className = 'wtable';
  table.style.setProperty('--stat', statColor(game));      // Werte in Trumpf-Farbe
  table.style.setProperty('--trumpcol', trumpBtnColor(game)); // Knoepfe in Trumpf-Farbe

  table.appendChild(buildTopBar(game));

  // Spielfilz mit Mitspielern, Trumpf, Ablagestapel und Aktionsbereich.
  const felt = document.createElement('div');
  felt.className = 'felt';
  // Tippen auf den freien Tisch fixiert die Ansicht (nicht bei Karten/Knoepfen).
  felt.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, .wcard, .wcard-img, .wcard-svg')) return;
    if (!isTableLocked()) setTableLock(true);
  });
  felt.appendChild(buildSeats(state));      // Spieler:innen rund um den Tisch

  // Mittleres Band: Ablagestapel zentriert, Trumpf-Karte rechts daneben im
  // freien Bereich (nicht mehr oben rechts ueber den Spielernamen).
  const mid = document.createElement('div');
  mid.className = 'felt-mid';
  const pile = buildTrickPile(state);       // = Drop-Zone
  mid.appendChild(pile);
  felt.appendChild(mid);

  // Der Filz ist die grosse Buehne (wie im Design-Entwurf). Aktion, Trumpf,
  // "Alle Karten" und die eigene Hand liegen als absolute Overlays auf dem Filz
  // (unten), sodass Groessen-Verhaeltnisse zum Entwurf passen.
  // Aktion links unten (Stiche ansagen / Hinweis).
  const lLeft = document.createElement('div');
  lLeft.className = 'tl-left';
  const action = buildAction(state, actions, mySeat);
  if (action) lLeft.appendChild(action);
  felt.appendChild(lLeft);

  // Trumpf-Karte + "Alle Karten" rechts unten (Trumpf oben, Button darunter).
  const lRight = document.createElement('div');
  lRight.className = 'tl-right';
  lRight.appendChild(buildTrumpBadge(game));
  if (state.hand.some(h => !h.played)) {
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'hand-view-btn';
    viewBtn.setAttribute('aria-label', 'Alle Handkarten gross anzeigen');   // Text ist Teil der Grafik
    viewBtn.addEventListener('click', () => openHandViewer(state, actions));
    lRight.appendChild(viewBtn);
  }
  felt.appendChild(lRight);

  // Eigene Hand als Faecher, ueberlagert die Unterkante des Filzes.
  const dock = document.createElement('div');
  dock.className = 'hand-dock';
  dock.appendChild(buildHandFan(state, actions, pile));
  felt.appendChild(dock);

  table.appendChild(felt);

  root.appendChild(table);
  root.appendChild(buildControls(game, actions));

  // Offene Vollbild-Ansicht nach einem Re-Render frisch aufbauen (Zug-/Legal-
  // Status aktuell halten); sonst stale schliessen, falls keine Karten mehr.
  if (handViewerOpen) {
    if (state.hand.some(h => !h.played)) openHandViewer(state, actions);
    else closeHandViewer();
  }

  // Handfaecher JETZT (synchron) auslegen, solange er im DOM haengt – sonst
  // lauefe die Austeil-Animation gegen noch nicht positionierte Karten und die
  // Flieger landen an der falschen Stelle (v. a. die frueh ausgeteilten Karten).
  if (activeRelayout) activeRelayout();

  // Render-Kontext fuer den Ladebildschirm merken (Fortsetzen nach dem Laden).
  lastState = state; lastFeltEl = felt;

  // Austeil-Animation bei Rundenbeginn (laeuft als Overlay ueber dem Filz).
  maybeDealAnimation(state, felt, dock);

  // Kalter Einstieg MITTEN in eine laufende Runde (Solo fortsetzen / Spiel
  // beitreten): auch hier erst alles laden – mit Ladebildschirm –, dann zeigen.
  if (game.status === 'running' && !assetsWarm && !loaderKey && !dealPendingKey) {
    startRoundLoader(state, 'cold|' + (game.join_code || 'solo'));
  }

  // IMMER die aktuelle Hand-Leiste merken – sonst zeigen Aufdeck-/Sicherheitsnetz
  // (revealHand/stripCovers/coverAndScheduleFlip) auf eine alte, ersetzte Leiste
  // und die sichtbare Hand bleibt verdeckt (Karten als Rueckseite haengen).
  lastDockEl = dock;

  // WATCHDOG gegen verworfene Timer (z. B. iOS friert die App beim Pausieren/
  // Wechseln ein und verwirft wartende Timeouts): Ist der Aufdeck-Zeitpunkt
  // laengst verstrichen, aber nie aufgedeckt worden, das Ende erzwingen –
  // sonst bliebe die Hand nach dem Fortsetzen dauerhaft versteckt/verdeckt.
  if (dealEndsAt && Date.now() >= dealEndsAt + 1500) clearDeal();
  // Ebenso eine Aufdeck-Phase, deren Karten-Flips laengst fertig sein muessten.
  if (dealCoverActive && Date.now() >= dealRevealStart + 6000) {
    dealCoverActive = false; stripCovers();
  }

  // Waehrend der Austeil-Animation: noch nicht abgeflogene Handkarten an der
  // Tischmitte platzieren (die Karten selbst fliegen -> Landeplatz exakt).
  applyDealFlight(dock);

  // Hand-Leiste nur verbergen, solange die Animation noch nicht laeuft
  // (dealPendingKey) oder ohne Karten-Flug gearbeitet wird (Reduced Motion);
  // waehrend des Karten-Flugs ist die Hand sichtbar (Karten starten verdeckt
  // an der Mitte).
  if (dealPendingKey || (Date.now() < dealEndsAt && !dealFlight)) dock.style.visibility = 'hidden';
}

// --- Vollbild-Kartenansicht ("Alle Karten") --------------------------------
// Zeigt das eigene Blatt ueberlappungsfrei in voller Groesse; antippen einer
// legalen Karte spielt sie direkt aus (wenn man am Zug ist).
function handViewerKey(e) { if (e.key === 'Escape') closeHandViewer(); }

function closeHandViewer() {
  handViewerOpen = false;
  document.removeEventListener('keydown', handViewerKey);
  if (handViewerNode) { handViewerNode.remove(); handViewerNode = null; }
}

function openHandViewer(state, actions) {
  document.removeEventListener('keydown', handViewerKey);
  if (handViewerNode) { handViewerNode.remove(); handViewerNode = null; }
  handViewerOpen = true;

  const { game, players, hand, trick, uid } = state;
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? -1;
  const myTurn = game.current_seat === mySeat;
  const canPlay = game.status === 'running' && game.phase === 'playing' && myTurn;
  const lead = leadColor(trick);
  const cards = hand.filter(h => !h.played);

  const overlay = document.createElement('div');
  overlay.className = 'modal hand-viewer';

  const card = document.createElement('div');
  card.className = 'modal-card';

  const x = document.createElement('button');
  x.type = 'button'; x.className = 'modal-x'; x.textContent = '✕';
  x.setAttribute('aria-label', 'Schliessen');
  x.addEventListener('click', closeHandViewer);
  card.appendChild(x);

  const title = document.createElement('h3');
  title.className = 'hand-viewer-title';
  title.textContent = canPlay ? 'Deine Karten – antippen zum Ausspielen' : 'Deine Karten';
  card.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'hand-grid';
  if (!cards.length) {
    grid.innerHTML = '<p class="muted">keine Karten</p>';
  } else {
    cards.forEach(hc => {
      const legal = isLegal(hc.card, hand, lead);
      const el = renderCard(hc.card, { button: true });
      if (canPlay && legal) {
        el.classList.add('playable');
        el.addEventListener('click', () => { closeHandViewer(); actions.onPlay(hc.card); });
      } else if (canPlay && !legal) {
        el.classList.add('illegal');
        el.disabled = true;
      } else {
        el.disabled = true;
      }
      grid.appendChild(el);
    });
  }
  card.appendChild(grid);
  overlay.appendChild(card);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeHandViewer(); });
  document.addEventListener('keydown', handViewerKey);

  document.body.appendChild(overlay);
  handViewerNode = overlay;
}

// --- Kopfzeile: Runde / Trumpf / Phase -------------------------------------
function buildTopBar(game) {
  const bar = document.createElement('div');
  bar.className = 'table-top';
  let trump;
  if (game.status === 'finished') trump = '<span class="muted">Spiel beendet</span>';
  else if (game.status === 'aborted') trump = '<span class="muted">Spiel abgebrochen</span>';
  else if (game.trump_pending) trump = 'Trumpf: <span class="muted">Geber wählt …</span>';
  else if (game.trump_color) {
    const c = COLORS[game.trump_color];
    trump = `Trumpf: <span class="swatch" style="background:${c.hex}"></span> ${c.name}`;
  } else trump = 'Trumpf: <span class="muted">kein</span>';
  bar.innerHTML = `
    <div>Runde <b>${game.round_no}</b>/${game.total_rounds ?? '–'}</div>
    <div>${trump}</div>
    <div class="phase-tag">${phaseText(game)}</div>`;
  return bar;
}

// Dekorativer Handkarten-Faecher (verdeckte Karten) hinter/ueber einem
// Gegner-Platz – zeigt, dass die Person Karten haelt (wie im Design-Entwurf).
function buildSeatHand(n) {
  const wrap = document.createElement('div');
  wrap.className = 'seat-hand';
  const count = Math.max(1, Math.min(n, 8));
  const spread = Math.min(7 * (count - 1), 34);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const rot = (t - 0.5) * spread;
    const lift = Math.abs(t - 0.5) * 9;
    const c = document.createElement('div');
    c.className = 'hb';
    c.style.transform = `rotate(${rot.toFixed(1)}deg) translateY(${lift.toFixed(1)}px)`;
    wrap.appendChild(c);
  }
  return wrap;
}

// --- Mitspieler als Sitzplaetze rund um den Tisch --------------------------
// Jede:r sitzt in der eigenen Ecke; ich unten-Mitte. Mit Profilbild/Avatar.
function buildSeats(state) {
  const { players, game, uid, trick } = state;
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? (players[0]?.seat ?? 0);
  const layout = computeSeatLayout(players, mySeat);
  // Verdeckte Handkarten-Faecher der Gegner (nur waehrend einer laufenden Runde).
  const cardsThisRound = game.cards_this_round || 0;
  const tricksDone = Math.max(0, (game.trick_no || 1) - 1);
  const showHands = game.status === 'running' &&
    (game.phase === 'bidding' || game.phase === 'playing' || game.phase === 'trumpselect');
  const wrap = document.createElement('div');
  wrap.className = 'seats np' + players.length;   // Groesse skaliert per CSS mit Spielerzahl
  // Platzierung (top/left/transform) – identisch fuer Sitz und Karten-Faecher.
  const placeAt = (node, pos) => {
    node.style.top = pos.t + '%';
    if (pos.l <= 22) { node.style.left = '6px'; node.style.transform = 'translateY(-50%)'; }
    else if (pos.l >= 78) { node.style.right = '6px'; node.style.transform = 'translateY(-50%)'; }
    else { node.style.left = pos.l + '%'; node.style.transform = 'translate(-50%, -50%)'; }
  };
  layout.forEach(({ player: p, pos, isMe }) => {
    const isTurn = p.seat === game.current_seat && game.status === 'running';
    // Verdeckter Handkarten-Faecher als eigenes Overlay (gleiche Box wie der
    // Sitz), damit er ueber den Platz hinausragen darf (Sitz hat overflow:hidden)
    // und HINTER dem Sitz einsortiert wird (davor im DOM).
    if (!isMe && showHands) {
      const played = trick && trick.some(t => t.seat === p.seat) ? 1 : 0;
      const rem = Math.max(0, Math.min(cardsThisRound, cardsThisRound - tricksDone - played));
      if (rem > 0) {
        const slot = document.createElement('div');
        slot.className = 'seat-slot';
        placeAt(slot, pos);
        slot.appendChild(buildSeatHand(rem));
        wrap.appendChild(slot);
      }
    }
    const el = document.createElement('div');
    el.className = 'seat' + (isMe ? ' me' : '') + (isTurn ? ' turn' : '') + (p.connected ? '' : ' offline');
    placeAt(el, pos);
    const av = p.avatar || DEFAULT_AV;
    const avHtml = isImg(av) ? `<img class="av-img" src="${esc(avV(av))}" alt="">` : `<span class="seat-emoji">${esc(av)}</span>`;
    const badges = (p.seat === game.dealer_seat ? ' 🂠' : '') + (p.is_host ? ' 👑' : '');
    el.innerHTML = `
      <div class="seat-av">${avHtml}</div>
      <div class="seat-name">${esc(p.name)}${badges}${isMe ? ' <span class="you">(du)</span>' : ''}</div>
      <div class="seat-stats">
        <span class="st-tb" title="Stiche gemacht / angesagt">${p.tricks_won}<span class="sep">/</span>${p.bid == null ? '–' : p.bid}</span>
        <span class="st-score" title="Punkte">${p.total_score} Pkt</span>
      </div>`;
    wrap.appendChild(el);
  });
  return wrap;
}

// --- Runden-Ladebildschirm ---------------------------------------------------
// Vollbild-Artwork mit Fortschrittsbalken unten. Erst wenn alle Bilder der
// Runde geladen sind (mind. ~1s, max. 12s), wird ausgeteilt bzw. gezeigt.
function showLoaderUI(game) {
  if (loaderNode) { loaderNode.remove(); loaderNode = null; }
  const ov = document.createElement('div');
  ov.id = 'round-loader';
  const txt = (game && game.round_no > 1)
    ? `Runde ${game.round_no} wird vorbereitet …`   // kalter Einstieg mitten im Spiel
    : 'Das Spiel wird vorbereitet …';
  ov.innerHTML = `
    <img class="rl-art" src="lobby/loading.jpg?v=1" alt="">
    <div class="rl-bottom">
      <div class="rl-text">${esc(txt)}</div>
      <div class="rl-bar"><div class="rl-fill" style="width:0%"></div></div>
      <div class="rl-pct">0%</div>
    </div>`;
  document.body.appendChild(ov);
  loaderNode = ov;
}
function setLoaderProgress(p) {
  if (!loaderNode) return;
  const f = loaderNode.querySelector('.rl-fill'); if (f) f.style.width = p + '%';
  const t = loaderNode.querySelector('.rl-pct'); if (t) t.textContent = p + '%';
}
function hideRoundLoader() {
  loaderKey = null;
  if (!loaderNode) return;
  const n = loaderNode; loaderNode = null;
  n.classList.add('out');                       // sanft ausblenden
  setTimeout(() => n.remove(), 500);
}

// Vorgeladene Bilder DAUERHAFT referenzieren: sonst raeumt der Garbage
// Collector die Image-Objekte ab, das Bild faellt aus dem Memory-Cache und
// wird beim ersten Ausspielen doch wieder nachgeladen (sichtbares Rendern).
const keptWarm = [];
const keptWarmUrls = new Set();

// Bilder mit Fortschritt vorladen. Balken zeigt min(echter Fortschritt,
// Mindestzeit-Fortschritt) – so ist er auch bei gefuelltem Cache sichtbar und
// laeuft fluessig durch. Haerte-Timeout, falls ein Bild nie ankommt.
function preloadWithProgress(urls, key, onDone) {
  const t0 = Date.now(), MIN = 1000, MAX = 12000;
  const total = Math.max(1, urls.length);
  let loaded = 0, finished = false, iv = null, hard = null;
  const finish = () => {
    if (finished) return;
    finished = true; clearInterval(iv); clearTimeout(hard);
    setLoaderProgress(100);
    setTimeout(onDone, 200);                    // vollen Balken kurz zeigen
  };
  const tick = () => {
    if (finished) return;
    if (loaderKey !== key) { finished = true; clearInterval(iv); clearTimeout(hard); return; }
    const real = loaded / total;
    const timed = Math.min(1, (Date.now() - t0) / MIN);
    setLoaderProgress(Math.round(Math.min(real, timed) * 100));
    if (real >= 1 && timed >= 1) finish();
  };
  iv = setInterval(tick, 80);
  hard = setTimeout(finish, MAX);
  urls.forEach(u => {
    const im = new Image();
    im.onload = im.onerror = () => { loaded++; tick(); };
    im.src = u;
    if (!keptWarmUrls.has(u)) { keptWarmUrls.add(u); keptWarm.push(im); }
  });
}

// Spieltisch-Grafiken (CSS-Hintergruende: Sitz-Rahmen, Buttons, Tisch, Karten-
// ruecken), die sonst erst beim ERSTEN Anzeigen im Spiel nachladen wuerden –
// sichtbares Nach-Rendern mitten in der Runde. Die URLs muessen exakt den
// url(...)-Angaben im CSS entsprechen, sonst trifft das Vorladen den Cache nicht.
export function gameAssetUrls() {
  const urls = [
    'lobby/table-bg.jpg?v=2', 'lobby/stars.jpg?v=2', 'cards/back.png?v=2',
    'lobby/ui-seat2.png?v=1', 'lobby/ui-allcards.png?v=1', 'lobby/ui-bid.png?v=1',
    'lobby/ui-leave.png?v=1', 'lobby/ui-pause.png?v=1',
    'lobby/nav-leave.png?v=1', 'lobby/nav-pause.png?v=1'
  ];
  // Aktives Premium-Tischdesign (von cosmetics.js injizierter Stil)
  const st = document.getElementById('wiz-table-style');
  const m = st && st.textContent.match(/url\('([^']+)'\)/);
  if (m) urls.push(m[1]);
  return urls;
}

// Alles, was das Spiel braucht: Deck + Rueckseite + Tisch-Grafiken + Avatare.
function collectRoundAssets(state) {
  const urls = allCardImageUrls().concat(gameAssetUrls());
  (state.players || []).forEach(p => {
    const av = p.avatar || DEFAULT_AV;
    if (isImg(av)) urls.push(avV(av));
  });
  return urls;
}

// Ladebildschirm fuer eine Runde starten (idempotent je key). Nach dem Laden
// wird der haengende Austeil-Start ueber den letzten Render-Kontext fortgesetzt.
function startRoundLoader(state, key) {
  if (loaderKey === key) return;
  loaderKey = key;
  showLoaderUI(state.game);
  preloadWithProgress(collectRoundAssets(state), key, () => {
    if (loaderKey !== key) return;              // inzwischen verlassen
    loaderDoneKey = key; assetsWarm = true;
    hideRoundLoader();
    retryPendingDeal();
  });
}

// Nach dem Laden: Austeil-Start mit dem letzten Render-Kontext nachholen
// (gleiche Schritte wie am Ende von renderTable).
function retryPendingDeal() {
  if (!lastState || !lastFeltEl || !lastFeltEl.isConnected || !lastDockEl) return;
  maybeDealAnimation(lastState, lastFeltEl, lastDockEl);
  applyDealFlight(lastDockEl);
  lastDockEl.style.visibility =
    (dealPendingKey || (Date.now() < dealEndsAt && !dealFlight)) ? 'hidden' : 'visible';
}

// --- Austeil-Animation -----------------------------------------------------
// Karten fliegen reihum vom Stapel in der Mitte zu jedem Sitzplatz. Overlay
// haengt an document.body (ueberlebt Re-Renders); Antippen ueberspringt.
function clearDeal() {
  if (dealTimers.length) { dealTimers.forEach(clearTimeout); dealTimers = []; }
  if (dealOverlayNode) { dealOverlayNode.remove(); dealOverlayNode = null; }
  if (dealRevealTimer) { clearTimeout(dealRevealTimer); dealRevealTimer = null; }
  dealEndsAt = 0; dealCoverActive = false; dealPendingKey = null; dealFlight = null;
  hideRoundLoader();   // laufender Ladebildschirm (Verlassen/Ueberspringen) weg
  // Eigene Karten sofort an ihren Faecherplatz setzen (ohne Animation).
  if (lastDockEl) lastDockEl.querySelectorAll('.fan-card').forEach(el => el.classList.remove('pre-deal', 'deal-fly'));
  stripCovers(); revealHand();   // beim Ueberspringen Hand sofort zeigen
}

function maybeDealAnimation(state, feltEl, dockEl) {
  const { game } = state;
  if (game.status !== 'running') { lastDealKey = null; dealPendingKey = null; hideRoundLoader(); return; }
  const roundStart = game.round_no >= 1 && (game.trick_no ?? 0) <= 1 &&
    (state.trick?.length || 0) === 0 && (game.phase === 'bidding' || game.phase === 'trumpselect');
  if (!roundStart) { dealPendingKey = null; if (loaderKey) hideRoundLoader(); return; }
  const key = (game.join_code || 'solo') + '|' + game.round_no + '|' + game.num_players;
  if (key === lastDealKey) { dealPendingKey = null; return; }
  // ERST LADEN, DANN SPIELEN – aber nur am ANFANG eines Spiels (Runde 1):
  // dort alle Bilder komplett vorladen (Ladebildschirm mit Balken). Ab Runde 2
  // ist alles im Cache und es wird ohne Ladebildschirm direkt ausgeteilt.
  if (game.round_no === 1 && loaderDoneKey !== key) {
    dealPendingKey = key;
    startRoundLoader(state, key);
    return;
  }
  const me = state.players.find(p => p.uid === state.uid);
  const mySeat = me?.seat ?? 0;
  // Runde NUR dann als "erledigt" merken, wenn die Animation wirklich starten
  // konnte – sonst beim naechsten Render erneut versuchen. Bis dahin bleibt die
  // Hand verborgen (dealPendingKey), damit die Karten nicht kurz aufblitzen.
  if (runDealAnimation(feltEl, dockEl, computeSeatLayout(state.players, mySeat), mySeat, game)) {
    lastDealKey = key; dealPendingKey = null;
  } else {
    dealPendingKey = key;
  }
}

function runDealAnimation(feltEl, dockEl, layout, mySeat, game) {
  clearDeal();
  const rect = feltEl.getBoundingClientRect();
  if (rect.width < 60) return false;                 // Filz (noch) nicht sichtbar -> spaeter erneut
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    // Reduzierte Bewegung: keine Flug-Animation, aber Hand kurz verborgen
    // halten, damit die Karten nicht schon vor dem Austeilen sichtbar sind.
    dealEndsAt = Date.now() + 500;
    dealRevealTimer = setTimeout(() => {
      dealEndsAt = 0; dealRevealTimer = null;
      stripCovers();      // evtl. verdeckt aufgebaute Karten direkt aufdecken
      revealHand();
    }, 500);
    return true;
  }

  // Vollbild-Overlay (fixed), damit Karten bis in die Hand unten fliegen koennen.
  const overlay = document.createElement('div');
  overlay.className = 'deal-overlay';
  overlay.style.left = '0px'; overlay.style.top = '0px';
  overlay.style.width = '100%'; overlay.style.height = '100%';
  document.body.appendChild(overlay);
  dealOverlayNode = overlay;
  overlay.addEventListener('pointerdown', clearDeal);   // Antippen = ueberspringen

  // Deck-Ursprung (Mitte des Filzes) in Viewport-Koordinaten.
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height * 0.46;

  // Sitzplatz-Ziele der Mitspieler (Filz-Prozente -> Viewport-Pixel).
  const ptBySeat = new Map();
  layout.forEach(l => ptBySeat.set(l.player.seat, {
    x: rect.left + rect.width * l.pos.l / 100,
    y: rect.top + rect.height * l.pos.t / 100,
  }));

  const np = layout.length;
  const order = [];
  for (let i = 0; i < np; i++) order.push(((game.dealer_seat ?? 0) + 1 + i) % np);

  const cardsPer = Math.max(1, game.cards_this_round || 1);
  const total = cardsPer * np;
  const stagger = Math.max(60, Math.min(120, 2800 / total));
  const totalMs = total * stagger + 760;
  dealEndsAt = Date.now() + totalMs;          // eigene Hand bis zum Aufdecken verborgen
  const handCards = cardsPer;

  // EIGENE Karten: kein separater Flieger mehr. Die echten Handkarten starten
  // (verdeckt) an der Tischmitte und gleiten an ihren Faecherplatz – das
  // fliegende Element IST die Karte, die sich spaeter umdreht. Landeplatz ==
  // Umdrehplatz ist damit konstruktionsbedingt garantiert (auch bei Scrollen,
  // Re-Layout oder spaet ladenden Bildern). Abfluege werden SOFORT verankert.
  const anchor = Date.now();
  const myDeparts = [];
  {
    let myI = 0, idx = 0;
    for (let pass = 0; pass < cardsPer; pass++) {
      for (const seat of order) {
        if (seat === mySeat) {
          const ci = myI++;
          myDeparts[ci] = anchor + idx * stagger;
          dealTimers.push(setTimeout(() => releaseDealCard(ci), idx * stagger));
        }
        idx++;
      }
    }
  }
  dealFlight = { departs: myDeparts };

  // MITSPIELER-Flieger + Aufdecken haengen am selben rAF-Zeit-Anker (sonst
  // wuerde bei verzoegertem rAF aufgedeckt, bevor alles geflogen ist).
  if (dealRevealTimer) clearTimeout(dealRevealTimer);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dealOverlayNode !== overlay) return;            // schon uebersprungen
    dealEndsAt = Date.now() + totalMs;                  // Anker praezisieren
    let idx = 0;
    for (let pass = 0; pass < cardsPer; pass++) {
      for (const seat of order) {
        if (seat !== mySeat) {
          const pt = ptBySeat.get(seat) || { x: originX, y: originY };
          dealTimers.push(setTimeout(() => flyToSeat(overlay, originX, originY, pt), idx * stagger));
        }
        idx++;
      }
    }
    dealRevealTimer = setTimeout(() => {
      dealEndsAt = 0; dealRevealTimer = null; dealFlight = null;
      dealCoverActive = true; dealRevealStart = Date.now();
      coverAndScheduleFlip(lastDockEl);         // erst verdeckt ...
      revealHand();                             // ... dann die (verdeckte) Hand sichtbar machen
      if (dealOverlayNode === overlay) { overlay.remove(); dealOverlayNode = null; }  // Flieger weg
      dealTimers.push(setTimeout(() => {
        dealCoverActive = false;
        stripCovers();   // Sicherheitsnetz: am Ende ALLE Handkarten aufgedeckt zeigen
      }, 550 + handCards * 190 + 1100));
    }, totalMs);
  }));
  return true;
}


// Mitspieler-Karte: fliegt zum Sitzplatz und verschwindet dort.
function flyToSeat(overlay, ox, oy, pt) {
  const card = document.createElement('div');
  card.className = 'deal-card';
  card.appendChild(renderCard('Z1', { faceDown: true, small: true }));
  card.style.left = ox + 'px'; card.style.top = oy + 'px';
  overlay.appendChild(card);
  const dx = Math.round(pt.x - ox), dy = Math.round(pt.y - oy);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.5)`;
    card.style.opacity = '0';
  }));
  dealTimers.push(setTimeout(() => card.remove(), 720));
}

// --- Trumpf-Karte als Badge ------------------------------------------------
function buildTrumpBadge(game) {
  const b = document.createElement('div');
  b.className = 'trump-badge';
  if (game.status === 'running' && game.trump_card && !game.trump_pending) {
    const c = renderCard(game.trump_card, { small: true });
    b.appendChild(c);
    const cap = document.createElement('div');
    cap.className = 'trump-cap';
    cap.textContent = 'Trumpf';
    b.appendChild(cap);
  } else {
    b.classList.add('empty');
  }
  return b;
}

// --- Ablagestapel / Stich (Drop-Zone) --------------------------------------
function buildTrickPile(state) {
  const { trick, players } = state;
  const pile = document.createElement('div');
  pile.className = 'trick-pile';
  const inner = document.createElement('div');
  inner.className = 'pile-cards';
  if (!trick.length) {
    inner.innerHTML = '<div class="pile-empty">Stich<br><small>Karte hierher ziehen</small></div>';
  } else {
    // Sauberer, symmetrischer Faecher (wie die Handkarten): Abstand + Drehung aus
    // --i/--n per CSS; der vertikale Bogen (--y, Raender tiefer) kommt aus JS.
    const n = trick.length;
    inner.classList.add('has-cards');
    inner.style.setProperty('--n', n);
    const half = (n - 1) / 2;
    const arcDepth = Math.min(18, 4 + n * 2);
    trick.forEach((p, i) => {
      const kn = half > 0 ? (i - half) / half : 0;       // -1 .. 1
      const yy = (kn * kn * arcDepth).toFixed(1);        // Raender tiefer (Bogen)
      const slot = document.createElement('div');
      slot.className = 'pile-slot' + (p.is_winner ? ' winner' : '');
      slot.style.setProperty('--i', i);
      slot.style.setProperty('--y', yy + 'px');
      const rotor = document.createElement('div');       // dreht nur die Karte
      rotor.className = 'pile-rot';
      rotor.appendChild(renderCard(p.card, { small: true }));
      slot.appendChild(rotor);
      const nm = document.createElement('div');          // Name aufrecht darunter
      nm.className = 'pile-name';
      nm.textContent = nameOfSeat(players, p.seat);
      slot.appendChild(nm);
      inner.appendChild(slot);
    });
  }
  pile.appendChild(inner);
  return pile;
}

// --- Aktionsbereich: Trumpfwahl / Gebot / Hinweis --------------------------
function buildAction(state, actions, mySeat) {
  const { game, players, uid } = state;
  if (game.status !== 'running') return null;
  const myTurn = game.current_seat === mySeat;

  if (game.phase === 'trumpselect') {
    return mySeat === game.dealer_seat ? trumpPicker(actions) : hint('Der Geber wählt den Trumpf …');
  }
  if (game.phase === 'bidding') {
    return myTurn ? bidOpenButton(game, players, actions)
                  : hint('Warte auf das Gebot von ' + nameOfSeat(players, game.current_seat) + ' …');
  }
  if (game.phase === 'playing') {
    return myTurn ? hint('Du bist am Zug – Doppelklick oder auf den Stapel ziehen.')
                  : hint(nameOfSeat(players, game.current_seat) + ' ist am Zug …');
  }
  return null;
}

function trumpPicker(actions) {
  const box = document.createElement('div');
  box.className = 'table-action parchment';
  box.innerHTML = '<h3>Trumpffarbe wählen</h3>';
  const row = document.createElement('div');
  row.className = 'row trump-row';
  Object.entries(COLORS).forEach(([code, col]) => {
    const b = document.createElement('button');
    b.className = 'btn trump-btn';
    b.style.background = col.hex;
    b.textContent = col.name;
    b.onclick = () => actions.onTrump(code);
    row.appendChild(b);
  });
  box.appendChild(row);
  return box;
}

function forbiddenBidUI(game, players) {
  const placed = players.filter(p => p.bid != null);
  if (placed.length !== game.num_players - 1) return null;
  const sum = placed.reduce((a, p) => a + p.bid, 0);
  const f = game.cards_this_round - sum;
  return (f >= 0 && f <= game.cards_this_round) ? f : null;
}

// Schmaler, themengerechter Button -> oeffnet das Gebots-Modal.
function bidOpenButton(game, players, actions) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn bid-open-btn';
  btn.setAttribute('aria-label', 'Stiche ansagen');   // Text ist Teil der Grafik
  btn.onclick = () => openBidModal(game, players, actions);
  return btn;
}

function closeBidModal() { const e = document.getElementById('bid-modal'); if (e) e.remove(); }

// Gebots-Fenster im Pergament-Design (zentriert, ueberlagert nichts dauerhaft).
function openBidModal(game, players, actions) {
  closeBidModal();
  const ov = document.createElement('div');
  ov.className = 'modal bid-modal';
  ov.id = 'bid-modal';
  ov.addEventListener('click', e => { if (e.target === ov) closeBidModal(); });

  const card = document.createElement('div');
  card.className = 'modal-card parchment bid-modal-card';

  const x = document.createElement('button');
  x.type = 'button'; x.className = 'modal-x'; x.setAttribute('aria-label', 'Schließen');
  x.textContent = '✕'; x.onclick = closeBidModal;
  card.appendChild(x);

  card.insertAdjacentHTML('beforeend',
    `<h3>Dein Gebot</h3><p class="bid-sub">Wie viele Stiche holst du? (0–${game.cards_this_round})</p>`);

  const forbidden = forbiddenBidUI(game, players);
  if (forbidden !== null) {
    card.insertAdjacentHTML('beforeend',
      `<p class="bid-forbidden">Als letzte:r Bietende:r nicht <b>${forbidden}</b> – die Summe der Ansagen darf nicht der Stichzahl entsprechen.</p>`);
  }

  const row = document.createElement('div');
  row.className = 'row bid-row';
  for (let i = 0; i <= game.cards_this_round; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn bid-num'; b.textContent = i;
    if (i === forbidden) { b.disabled = true; b.classList.add('disabled'); }
    else b.onclick = () => { closeBidModal(); actions.onBid(i); };
    row.appendChild(b);
  }
  card.appendChild(row);
  ov.appendChild(card);
  document.body.appendChild(ov);
}

function hint(text) {
  const p = document.createElement('div');
  p.className = 'table-action hint';
  p.textContent = text;
  return p;
}

// --- Gefaecherte Hand ------------------------------------------------------
// Spielbarkeits-Zustand einer Handkarte auffrischen (ohne DOM-Neuaufbau).
function patchFanCard(el, code, hand, lead, canPlay) {
  const legal = isLegal(code, hand, lead);
  el.classList.toggle('playable', canPlay && legal);
  el.classList.toggle('illegal', canPlay && !legal);
  el.disabled = !(canPlay && legal);
}

function buildHandFan(state, actions, dropZone) {
  const { game, players, hand, trick, uid } = state;
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? -1;
  const myTurn = game.current_seat === mySeat;
  const canPlay = game.status === 'running' && game.phase === 'playing' && myTurn;
  const lead = leadColor(trick);
  const cards = hand.filter(h => !h.played);
  currentDropZone = dropZone;     // Drag&Drop-Ziel dieses Renders (dynamisch)
  currentActions = actions;

  if (!cards.length) {
    activeRelayout = null;          // leer lassen (kein "keine Karten"-Text)
    lastFanEl = null; lastFanItems = []; lastFanCodes = [];
    const fan = document.createElement('div');
    fan.className = 'hand-fan';
    return fan;
  }

  const codes = cards.map(h => h.card);
  const fanRound = (game.join_code || 'solo') + '|' + game.round_no;
  const dealing = dealPendingKey || dealFlight || dealCoverActive || Date.now() < dealEndsAt;

  // WIEDERVERWENDEN statt neu bauen: Bleibt der Kartensatz gleich (Gegner hat
  // gelegt) oder wird er nur kleiner (eigene Karte gespielt), den bestehenden
  // Faecher behalten und nur die Spielbarkeit auffrischen. Sonst wuerden bei
  // JEDEM Zug frische <img>-Elemente entstehen, die der Browser neu dekodiert –
  // die eigene Hand "laedt" sichtbar neu. Waehrend des Austeilens immer neu
  // bauen (verdeckter Aufbau + Flug brauchen frische Struktur).
  if (!dealing && lastFanEl && lastFanRound === fanRound && lastFanItems.length >= codes.length) {
    let ci = 0;
    for (const oc of lastFanCodes) { if (ci < codes.length && oc === codes[ci]) ci++; }
    if (ci === codes.length) {                       // codes = Teilfolge der alten
      if (codes.length < lastFanCodes.length) {      // gespielte Karten entfernen
        const keep = [];
        let k = 0;
        lastFanItems.forEach((el, i) => {
          if (k < codes.length && lastFanCodes[i] === codes[k]) { keep.push(el); k++; }
          else el.remove();
        });
        lastFanItems = keep;
      }
      lastFanCodes = codes.slice();
      lastFanItems.forEach((el, i) => patchFanCard(el, codes[i], hand, lead, canPlay));
      const fan = lastFanEl, items = lastFanItems;
      const layout = () => layoutFan(fan, items);
      activeRelayout = layout;
      requestAnimationFrame(layout);   // nach Entfernen sanft zusammenruecken
      return fan;
    }
  }

  const fan = document.createElement('div');
  fan.className = 'hand-fan';

  const items = cards.map(h => {
    const el = renderCard(h.card, { button: true });
    el.classList.add('fan-card');
    makePlayable(el, h.card);
    patchFanCard(el, h.card, hand, lead, canPlay);
    fan.appendChild(el);
    return el;
  });

  // Waehrend der Aufdeck-Phase auch bei Neu-Render verdeckt halten + Flip nachholen.
  if (dealCoverActive) coverAndScheduleFlip(fan);
  // Waehrend des GESAMTEN Austeil-Fensters die Hand schon VERDECKT aufbauen
  // (Rueckseite als DOM-Zustand, nicht nur visibility:hidden). Selbst wenn der
  // Browser (Safari) einen Frame zu frueh malt, sieht man nur Rueckseiten –
  // nie kurz die Vorderseiten. Aufgedeckt wird wie gehabt beim Reveal.
  else if (Date.now() < dealEndsAt || dealPendingKey) {
    items.forEach(el => buildFlip(el));
  }

  lastFanEl = fan; lastFanItems = items; lastFanCodes = codes.slice(); lastFanRound = fanRound;

  const layout = () => layoutFan(fan, items);
  activeRelayout = layout;
  // Neu aufgebaute Karten sollen ihre Faecherposition OHNE Uebergang einnehmen
  // (starr bleiben), erst danach gelten die Hover-/Auswahl-Transitions wieder.
  fan.classList.add('fan-new');
  requestAnimationFrame(() => {
    layout();
    requestAnimationFrame(() => fan.classList.remove('fan-new'));
  });
  return fan;
}

// Positioniert die Karten als Faecher (Bogen + Rotation), passt sich an
// Kartenzahl UND Breite an, sodass nichts aus dem Bild laeuft.
function layoutFan(fan, items) {
  const n = items.length;
  if (!n) return;
  const W = fan.clientWidth || fan.parentElement?.clientWidth || 360;
  const cardH = items[0].offsetHeight || 124;
  // Kartenbreite DETERMINISTISCH aus der (per CSS festen) Hoehe ableiten –
  // NICHT aus offsetWidth: solange ein Kartenbild noch nicht geladen ist,
  // waere die 0/kleiner, und fruehe Austeil-Flieger wuerden eine andere
  // Faecher-Geometrie messen als spaete (verstreute Landung).
  const cardW = Math.round(cardH * 0.72);

  const spreadDeg = Math.min(5.5 * (n - 1), 26);         // Gesamt-Fächerwinkel
  const maxStep = cardW * 0.60;                          // Wunschabstand
  // Sicherheitsabstand (~32px je Seite) faengt die durch Rotation breitere
  // Bounding-Box der Randkarten ab, damit nichts aus dem Bild laeuft.
  const fitStep = n > 1 ? (W - cardW - 64) / (n - 1) : 0;
  const step = n > 1 ? Math.max(15, Math.min(maxStep, fitStep)) : 0;
  const arcDepth = Math.min(26, 5 + n * 1.4);

  items.forEach((el, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const x = (i - (n - 1) / 2) * step;
    const rot = (t - 0.5) * spreadDeg;
    const y = Math.pow((t - 0.5) * 2, 2) * arcDepth;     // Ränder leicht tiefer
    el.style.setProperty('--x', x.toFixed(1) + 'px');
    el.style.setProperty('--y', y.toFixed(1) + 'px');
    el.style.setProperty('--rot', rot.toFixed(2) + 'deg');
    el.style.zIndex = String(i + 1);
  });
  fan.style.height = (cardH + arcDepth + 8) + 'px';
}

// --- Interaktion: Doppelklick / Drag&Drop / Touch --------------------------
// Beide Wege spielen die Karte ueber currentActions.onPlay. Die Handler haengen
// an JEDER Handkarte (auch wiederverwendeten); ob sie greifen, entscheidet der
// AKTUELLE Zustand (.playable), und Drop-Zone/Actions kommen aus den je Render
// aktualisierten Modul-Variablen – nie aus einer veralteten Closure.
function makePlayable(el, code) {
  el.style.touchAction = 'none';
  let sx = 0, sy = 0, dragging = false, ghost = null, pid = null, lastTap = 0;
  const play = () => { if (currentActions) currentActions.onPlay(code); };
  const usable = () => el.classList.contains('playable') && !el.disabled;

  el.addEventListener('dblclick', e => { e.preventDefault(); if (usable()) play(); });

  el.addEventListener('pointerdown', e => {
    if (!usable()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; dragging = false;
    try { el.setPointerCapture(pid); } catch (_) {}
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.hypot(dx, dy) > 10) {
      dragging = true;
      ghost = makeGhost(el);
      el.classList.add('dragging-src');
    }
    if (dragging) {
      positionGhost(ghost, e.clientX, e.clientY);
      if (currentDropZone) currentDropZone.classList.toggle('drop-hot', overDrop(e, currentDropZone));
    }
  });

  const finish = (e, cancelled) => {
    if (e.pointerId !== pid) return;
    try { el.releasePointerCapture(pid); } catch (_) {}
    pid = null;
    if (dragging) {
      const over = !cancelled && currentDropZone && overDrop(e, currentDropZone);
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('dragging-src');
      if (currentDropZone) currentDropZone.classList.remove('drop-hot');
      dragging = false;
      if (over) play();                          // auf Stapel abgelegt -> ausspielen
    } else if (!cancelled) {
      const now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; play(); }   // Doppeltipp = ausspielen
      else { lastTap = now; el.classList.toggle('selected'); }
    }
  };
  el.addEventListener('pointerup', e => finish(e, false));
  el.addEventListener('pointercancel', e => finish(e, true));
}

function makeGhost(el) {
  const r = el.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.className = 'card-ghost';
  g.style.width = r.width + 'px';
  g.style.height = r.height + 'px';
  document.body.appendChild(g);
  return g;
}
function positionGhost(g, x, y) { g.style.left = x + 'px'; g.style.top = y + 'px'; }
function overDrop(e, dz) {
  const r = dz.getBoundingClientRect();
  const m = 30; // etwas Toleranz um den Stapel
  return e.clientX >= r.left - m && e.clientX <= r.right + m &&
         e.clientY >= r.top - m && e.clientY <= r.bottom + m;
}

// --- Untere Navigationsleiste: Menue / Pause -------------------------------
// Wie im Design-Entwurf: schlichte Leiste am unteren Rand mit "Menü" (Spiel
// verlassen, mit Rueckfrage) links und "Pause" rechts. Nach Spielende ein
// einzelner "Zurueck zur Startseite"-Knopf.
// Fertige Grafik-Buttons (Text ist Teil des Bildes): "Spiel verlassen" (links)
// und "Spiel pausieren" (rechts). Nach Spielende: "Spiel verlassen" -> Startseite.
function navBtn(key, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav-btn ' + key;
  b.setAttribute('aria-label', label);   // Beschriftung ist Teil der Grafik
  b.onclick = onClick;
  return b;
}
function buildControls(game, actions) {
  const ctl = document.createElement('div');
  ctl.className = 'table-nav';
  if (game.status === 'running') {
    ctl.appendChild(navBtn('nav-leave', 'Spiel verlassen', () => {
      if (confirm('Laufendes Spiel verlassen? Der Spielstand geht verloren.\n(Zum späteren Weiterspielen lieber „Pausieren".)')) actions.onLeave();
    }));
    if (actions.onPause) {
      ctl.appendChild(navBtn('nav-pause', 'Spiel pausieren', () => actions.onPause()));
    }
  } else if (game.status === 'finished' || game.status === 'aborted') {
    ctl.classList.add('single');
    ctl.appendChild(navBtn('nav-leave', 'Zur Startseite', () => actions.onLeave()));
  }
  return ctl;
}
