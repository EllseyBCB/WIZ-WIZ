// Spieltisch-Komponenten: Tisch, Mitspieler, Ablagestapel (Stich) und die
// gefaecherte Hand inkl. Interaktion (Doppelklick / Drag&Drop / Touch).
// Alles haengt am bestehenden State + actions.onPlay – keine Parallel-Logik.
import { renderCard, COLORS } from './cards.js?v=15';
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
function revealHand() { if (lastDockEl && lastDockEl.isConnected) lastDockEl.style.visibility = 'visible'; }

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
    const t = 200 + i * 150;               // Aufdeck-Zeitpunkt dieser Karte
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
    if (!gv.classList.contains('active')) setTableLock(false);
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

  // Austeil-Animation bei Rundenbeginn (laeuft als Overlay ueber dem Filz).
  maybeDealAnimation(state, felt, dock);

  // IMMER die aktuelle Hand-Leiste merken – sonst zeigen Aufdeck-/Sicherheitsnetz
  // (revealHand/stripCovers/coverAndScheduleFlip) auf eine alte, ersetzte Leiste
  // und die sichtbare Hand bleibt verdeckt (Karten als Rueckseite haengen).
  lastDockEl = dock;
  // Eigene Karten erst zeigen, nachdem sie ausgeteilt wurden: waehrend der
  // Austeil-Animation die Hand-Leiste verbergen (Layout bleibt erhalten).
  if (Date.now() < dealEndsAt || dealPendingKey) dock.style.visibility = 'hidden';
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

// --- Austeil-Animation -----------------------------------------------------
// Karten fliegen reihum vom Stapel in der Mitte zu jedem Sitzplatz. Overlay
// haengt an document.body (ueberlebt Re-Renders); Antippen ueberspringt.
function clearDeal() {
  if (dealTimers.length) { dealTimers.forEach(clearTimeout); dealTimers = []; }
  if (dealOverlayNode) { dealOverlayNode.remove(); dealOverlayNode = null; }
  if (dealRevealTimer) { clearTimeout(dealRevealTimer); dealRevealTimer = null; }
  dealEndsAt = 0; dealCoverActive = false; dealPendingKey = null; stripCovers(); revealHand();   // beim Ueberspringen Hand sofort zeigen
}

function maybeDealAnimation(state, feltEl, dockEl) {
  const { game } = state;
  if (game.status !== 'running') { lastDealKey = null; dealPendingKey = null; return; }
  const roundStart = game.round_no >= 1 && (game.trick_no ?? 0) <= 1 &&
    (state.trick?.length || 0) === 0 && (game.phase === 'bidding' || game.phase === 'trumpselect');
  if (!roundStart) { dealPendingKey = null; return; }
  const key = (game.join_code || 'solo') + '|' + game.round_no + '|' + game.num_players;
  if (key === lastDealKey) { dealPendingKey = null; return; }
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

  // Die eigene Zielposition wird PRO Karte erst beim Abflug an der aktuellen
  // (verborgenen, aber fertig gelayouteten) Hand gemessen -> die Karte landet
  // genau dort, wo sie danach liegt und sich umdreht.
  const meFallback = ptBySeat.get(mySeat) || { x: originX, y: rect.top + rect.height * 0.87 };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dealOverlayNode !== overlay) return;            // schon uebersprungen
    let myI = 0, idx = 0;
    for (let pass = 0; pass < cardsPer; pass++) {
      for (const seat of order) {
        if (seat === mySeat) {
          const ci = myI++;
          dealTimers.push(setTimeout(() => flyToHand(overlay, originX, originY, ci, meFallback), idx * stagger));
        } else {
          const pt = ptBySeat.get(seat) || { x: originX, y: originY };
          dealTimers.push(setTimeout(() => flyToSeat(overlay, originX, originY, pt), idx * stagger));
        }
        idx++;
      }
    }
  }));

  if (dealRevealTimer) clearTimeout(dealRevealTimer);
  dealRevealTimer = setTimeout(() => {
    dealEndsAt = 0; dealRevealTimer = null;
    dealCoverActive = true; dealRevealStart = Date.now();
    coverAndScheduleFlip(lastDockEl);         // erst verdeckt ...
    revealHand();                             // ... dann die (verdeckte) Hand sichtbar machen
    if (dealOverlayNode === overlay) { overlay.remove(); dealOverlayNode = null; }  // Flieger weg
    dealTimers.push(setTimeout(() => {
      dealCoverActive = false;
      stripCovers();   // Sicherheitsnetz: am Ende ALLE Handkarten aufgedeckt zeigen
    }, 200 + handCards * 150 + 700));
  }, totalMs);
  return true;
}

// Meine Karte: fliegt vom Deck an ihren Platz in der Hand und bleibt dort
// (verdeckt) liegen – die Hand baut sich so Karte fuer Karte auf. Die exakte
// Zielposition wird JETZT (beim Abflug) an der aktuellen Hand gemessen.
function flyToHand(overlay, ox, oy, cardIndex, fallback) {
  let tx = fallback.x, ty = fallback.y, rot = 0, targetH = 0, targetW = 0;
  const dock = lastDockEl;
  const el = dock && dock.querySelectorAll('.fan-card')[cardIndex];
  if (el) {
    const r = el.getBoundingClientRect();     // r-Mitte = geom. Mitte der gedrehten Karte
    if (r.width > 4 && r.height > 4) {
      tx = r.left + r.width / 2; ty = r.top + r.height / 2;
      rot = parseFloat(el.style.getPropertyValue('--rot')) || 0;
      // WICHTIG: echte (ungedrehte) Layout-Groesse nehmen, NICHT die Bounding-Box
      // der gedrehten Karte (die waere je nach Winkel groesser/ungleich).
      targetH = el.offsetHeight; targetW = el.offsetWidth;
    }
  }
  const card = document.createElement('div');
  card.className = 'deal-card';
  const back = renderCard('Z1', { faceDown: true });
  // Flieger exakt die Box der Zielkarte annehmen -> landet passgenau, gleich gross.
  if (targetH) { back.classList.add('deal-fill'); back.style.height = targetH + 'px'; back.style.width = targetW + 'px'; }
  card.appendChild(back);
  card.style.left = ox + 'px'; card.style.top = oy + 'px';
  overlay.appendChild(card);
  const dx = Math.round(tx - ox), dy = Math.round(ty - oy);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`;
  }));
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
function buildHandFan(state, actions, dropZone) {
  const { game, players, hand, trick, uid } = state;
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? -1;
  const myTurn = game.current_seat === mySeat;
  const canPlay = game.status === 'running' && game.phase === 'playing' && myTurn;
  const lead = leadColor(trick);
  const cards = hand.filter(h => !h.played);

  const fan = document.createElement('div');
  fan.className = 'hand-fan';
  if (!cards.length) {
    activeRelayout = null;          // leer lassen (kein "keine Karten"-Text)
    return fan;
  }

  const items = cards.map(h => {
    const legal = isLegal(h.card, hand, lead);
    const el = renderCard(h.card, { button: true });
    el.classList.add('fan-card');
    if (canPlay && legal) {
      el.classList.add('playable');
      makePlayable(el, h.card, () => actions.onPlay(h.card), dropZone);
    } else if (canPlay && !legal) {
      el.classList.add('illegal');
      el.disabled = true;
    } else {
      el.disabled = true;
    }
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

  const layout = () => layoutFan(fan, items);
  activeRelayout = layout;
  requestAnimationFrame(layout);
  return fan;
}

// Positioniert die Karten als Faecher (Bogen + Rotation), passt sich an
// Kartenzahl UND Breite an, sodass nichts aus dem Bild laeuft.
function layoutFan(fan, items) {
  const n = items.length;
  if (!n) return;
  const W = fan.clientWidth || fan.parentElement?.clientWidth || 360;
  const cardW = items[0].offsetWidth || 72;
  const cardH = items[0].offsetHeight || 124;

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
// Beide Wege rufen denselben play()-Callback (=> actions.onPlay).
function makePlayable(el, code, play, dropZone) {
  el.style.touchAction = 'none';
  let sx = 0, sy = 0, dragging = false, ghost = null, pid = null, lastTap = 0;

  el.addEventListener('dblclick', e => { e.preventDefault(); play(); });

  el.addEventListener('pointerdown', e => {
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
      dropZone.classList.toggle('drop-hot', overDrop(e, dropZone));
    }
  });

  const finish = (e, cancelled) => {
    if (e.pointerId !== pid) return;
    try { el.releasePointerCapture(pid); } catch (_) {}
    pid = null;
    if (dragging) {
      const over = !cancelled && overDrop(e, dropZone);
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('dragging-src');
      dropZone.classList.remove('drop-hot');
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
