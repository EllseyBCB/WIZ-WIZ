// Spieltisch-Komponenten: Tisch, Mitspieler, Ablagestapel (Stich) und die
// gefaecherte Hand inkl. Interaktion (Doppelklick / Drag&Drop / Touch).
// Alles haengt am bestehenden State + actions.onPlay – keine Parallel-Logik.
import { renderCard, COLORS } from './cards.js?v=14';
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
    const delay = Math.max(0, (200 + i * 150) - elapsed);
    dealTimers.push(setTimeout(() => inner.classList.add('show'), delay));
  });
}
function stripCovers() {            // beim Ueberspringen: alle sofort aufdecken
  if (lastDockEl) lastDockEl.querySelectorAll('.flip-inner').forEach(inner => inner.classList.add('show'));
}

// Avatar: Bild-URL vs. Emoji unterscheiden (wie in app.js/game.js).
const isImg = v => typeof v === 'string' && /^https?:\/\//.test(v);

// Sitzpositionen (Prozent im Filz) je Gegnerzahl; ich sitze unten-Mitte.
const SEAT_SLOTS = {
  1: [{ t: 11, l: 50 }],
  2: [{ t: 13, l: 20 }, { t: 13, l: 80 }],
  3: [{ t: 38, l: 5 }, { t: 9, l: 50 }, { t: 38, l: 95 }],
  4: [{ t: 37, l: 5 }, { t: 10, l: 29 }, { t: 10, l: 71 }, { t: 37, l: 95 }],
  5: [{ t: 40, l: 5 }, { t: 14, l: 25 }, { t: 8, l: 50 }, { t: 14, l: 75 }, { t: 40, l: 95 }],
};
const ME_SLOT = { t: 87, l: 50 };
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

// ---------------------------------------------------------------------------
// Haupteinstieg: Tisch fuer ein laufendes/beendetes Spiel rendern.
// ---------------------------------------------------------------------------
export function renderTable(root, state, actions) {
  bindResize();
  const { game, players, uid } = state;
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
  felt.appendChild(buildSeats(state));      // Spieler:innen rund um den Tisch

  // Mittleres Band: Ablagestapel zentriert, Trumpf-Karte rechts daneben im
  // freien Bereich (nicht mehr oben rechts ueber den Spielernamen).
  const mid = document.createElement('div');
  mid.className = 'felt-mid';
  const pile = buildTrickPile(state);       // = Drop-Zone
  mid.appendChild(pile);
  felt.appendChild(mid);
  felt.appendChild(buildTrumpBadge(game));   // Trumpf unten rechts neben dem eigenen Platz
  table.appendChild(felt);

  // Aktionsbereich (Gebot/Trumpf/Hinweis) als Leiste zwischen Filz und Hand.
  const action = buildAction(state, actions, mySeat);
  if (action) {
    const ad = document.createElement('div');
    ad.className = 'action-dock';
    ad.appendChild(action);
    table.appendChild(ad);
  }

  // Eigene Hand als Faecher unten (an der Tischkante).
  const dock = document.createElement('div');
  dock.className = 'hand-dock';
  if (state.hand.some(h => !h.played)) {
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'hand-view-btn';
    viewBtn.innerHTML = '🔍 Alle Karten';
    viewBtn.setAttribute('aria-label', 'Alle Handkarten gross anzeigen');
    viewBtn.addEventListener('click', () => openHandViewer(state, actions));
    dock.appendChild(viewBtn);
  }
  dock.appendChild(buildHandFan(state, actions, pile));
  table.appendChild(dock);

  root.appendChild(table);
  root.appendChild(buildControls(game, actions));

  // Offene Vollbild-Ansicht nach einem Re-Render frisch aufbauen (Zug-/Legal-
  // Status aktuell halten); sonst stale schliessen, falls keine Karten mehr.
  if (handViewerOpen) {
    if (state.hand.some(h => !h.played)) openHandViewer(state, actions);
    else closeHandViewer();
  }

  // Austeil-Animation bei Rundenbeginn (laeuft als Overlay ueber dem Filz).
  maybeDealAnimation(state, felt, dock);

  // Eigene Karten erst zeigen, nachdem sie ausgeteilt wurden: waehrend der
  // Austeil-Animation die Hand-Leiste verbergen (Layout bleibt erhalten).
  if (Date.now() < dealEndsAt || dealPendingKey) { dock.style.visibility = 'hidden'; lastDockEl = dock; }
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

// --- Mitspieler als Sitzplaetze rund um den Tisch --------------------------
// Jede:r sitzt in der eigenen Ecke; ich unten-Mitte. Mit Profilbild/Avatar.
function buildSeats(state) {
  const { players, game, uid } = state;
  const me = players.find(p => p.uid === uid);
  const mySeat = me?.seat ?? (players[0]?.seat ?? 0);
  const layout = computeSeatLayout(players, mySeat);
  const wrap = document.createElement('div');
  wrap.className = 'seats';
  layout.forEach(({ player: p, pos, isMe }) => {
    const isTurn = p.seat === game.current_seat && game.status === 'running';
    const el = document.createElement('div');
    el.className = 'seat' + (isMe ? ' me' : '') + (isTurn ? ' turn' : '') + (p.connected ? '' : ' offline');
    el.style.top = pos.t + '%';
    // Randplaetze an der Kante verankern (sonst haengt die halbe Box ueber den
    // Filzrand und wird abgeschnitten); mittlere Plaetze bleiben zentriert.
    if (pos.l <= 22) { el.style.left = '6px'; el.style.transform = 'translateY(-50%)'; }
    else if (pos.l >= 78) { el.style.right = '6px'; el.style.transform = 'translateY(-50%)'; }
    else { el.style.left = pos.l + '%'; }   // CSS: transform translate(-50%,-50%)
    const av = p.avatar || '🧙';
    const avHtml = isImg(av) ? `<img class="av-img" src="${esc(av)}" alt="">` : `<span class="seat-emoji">${esc(av)}</span>`;
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
    dealRevealTimer = setTimeout(() => { dealEndsAt = 0; dealRevealTimer = null; revealHand(); }, 500);
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

  // Flieger erst planen, wenn die Hand fertig gelayoutet ist (Slot-Positionen
  // messbar; die Hand selbst bleibt bis zum Aufdecken via visibility verborgen).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dealOverlayNode !== overlay) return;            // schon uebersprungen
    const myTargets = Array.from(dockEl.querySelectorAll('.fan-card')).map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2,
               rot: parseFloat(el.style.getPropertyValue('--rot')) || 0 };
    });
    let myI = 0, idx = 0;
    for (let pass = 0; pass < cardsPer; pass++) {
      for (const seat of order) {
        if (seat === mySeat) {
          const tgt = myTargets[myI++] || { x: originX, y: rect.bottom, rot: 0 };
          dealTimers.push(setTimeout(() => flyToHand(overlay, originX, originY, tgt), idx * stagger));
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
    revealHand();                             // ... dann die echte Hand sichtbar machen
    if (dealOverlayNode === overlay) { overlay.remove(); dealOverlayNode = null; }  // Flieger weg
    dealTimers.push(setTimeout(() => { dealCoverActive = false; }, 200 + handCards * 150 + 700));
  }, totalMs);
  return true;
}

// Meine Karte: fliegt vom Deck an ihren Platz in der Hand und bleibt dort
// (verdeckt) liegen – die Hand baut sich so Karte fuer Karte auf.
function flyToHand(overlay, ox, oy, tgt) {
  const card = document.createElement('div');
  card.className = 'deal-card';
  card.appendChild(renderCard('Z1', { faceDown: true }));
  card.style.left = ox + 'px'; card.style.top = oy + 'px';
  overlay.appendChild(card);
  const dx = Math.round(tgt.x - ox), dy = Math.round(tgt.y - oy);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${tgt.rot}deg)`;
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
    // Je mehr Karten, desto staerker ueberlappen sie sich -> der Stich bleibt
    // in einer zentralen Zone und wandert nicht hinter die seitlichen Spieler.
    const ov = trick.length >= 6 ? 16 : trick.length === 5 ? 12 : trick.length === 4 ? 9 : 7;
    trick.forEach((p, i) => {
      const slot = document.createElement('div');
      slot.className = 'pile-slot' + (p.is_winner ? ' winner' : '');
      slot.style.margin = `0 -${ov}px`;
      // leichte Streuung wie ein echter Ablagestapel
      const ang = (i - (trick.length - 1) / 2) * 4.5;
      slot.style.transform = `rotate(${ang}deg)`;
      slot.appendChild(renderCard(p.card, { small: true }));
      const nm = document.createElement('div');
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
    return myTurn ? bidPicker(game, players, actions)
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

function bidPicker(game, players, actions) {
  const box = document.createElement('div');
  box.className = 'table-action parchment bid-picker';
  const forbidden = forbiddenBidUI(game, players);
  box.innerHTML = `<h3>Dein Gebot (0–${game.cards_this_round})</h3>`;
  if (forbidden !== null) {
    box.insertAdjacentHTML('beforeend',
      `<p class="muted">Als letzte:r Bietende:r nicht <b>${forbidden}</b> – die Summe der Ansagen darf nicht der Stichzahl entsprechen.</p>`);
  }
  const row = document.createElement('div');
  row.className = 'row bid-row';
  for (let i = 0; i <= game.cards_this_round; i++) {
    const b = document.createElement('button');
    b.className = 'btn bid-num';
    b.textContent = i;
    if (i === forbidden) { b.disabled = true; b.classList.add('disabled'); }
    else b.onclick = () => actions.onBid(i);
    row.appendChild(b);
  }
  box.appendChild(row);
  return box;
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
    fan.innerHTML = '<p class="muted">keine Karten</p>';
    activeRelayout = null;
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

// --- Verlassen / Zurueck ---------------------------------------------------
function buildControls(game, actions) {
  const ctl = document.createElement('div');
  ctl.className = 'row table-controls';
  if (game.status === 'running') {
    if (actions.onPause) {
      const p = document.createElement('button');
      p.className = 'btn small-btn';
      p.textContent = '⏸ Pausieren';
      p.onclick = () => actions.onPause();
      ctl.appendChild(p);
    }
    const b = document.createElement('button');
    b.className = 'btn sekundaer small-btn';
    b.textContent = 'Spiel verlassen';
    b.onclick = () => {
      if (confirm('Laufendes Spiel verlassen? Der Spielstand geht verloren.\n(Zum späteren Weiterspielen lieber „Pausieren".)')) actions.onLeave();
    };
    ctl.appendChild(b);
  } else if (game.status === 'finished' || game.status === 'aborted') {
    const b = document.createElement('button');
    b.className = 'btn small-btn';
    b.textContent = 'Zurück zur Startseite';
    b.onclick = () => actions.onLeave();
    ctl.appendChild(b);
  }
  return ctl;
}
