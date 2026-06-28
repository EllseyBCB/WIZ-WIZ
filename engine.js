// Lokale Wizard-Spiel-Engine (reine Logik, kein Netzwerk).
// Spiegelt exakt die Regeln aus supabase/wizard_schema.sql wider – genutzt
// fuer den Solo-Modus gegen Computer-Gegner.

function deck() {
  const out = [];
  for (const c of ['R', 'Y', 'G', 'B']) for (let r = 1; r <= 13; r++) out.push(c + r);
  out.push('Z1', 'Z2', 'Z3', 'Z4', 'N1', 'N2', 'N3', 'N4');
  return out;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rank(card) { return parseInt(card.slice(1), 10); }
const isWizard = c => c.startsWith('Z');
const isJester = c => c.startsWith('N');
const colorOf  = c => (isWizard(c) || isJester(c)) ? null : c[0];
// Farbe des aufgedeckten Zauberers = Trumpf (Z1 Blau, Z2 Rot, Z3 Gelb, Z4 Gruen).
const WIZ_COLOR = { Z1: 'B', Z2: 'R', Z3: 'Y', Z4: 'G' };

// Anspielfarbe eines (Teil-)Stichs: erste Nicht-Narr-Karte; null bei Zauberer/leer.
export function leadOf(trick) {
  const first = trick.find(p => !isJester(p.card));
  if (!first || isWizard(first.card)) return null;
  return first.card[0];
}

// Index der aktuell fuehrenden Karte im Stich (gleiche Regeln wie im SQL).
export function winnerIndex(trick, trump) {
  const wiz = trick.findIndex(p => isWizard(p.card));
  if (wiz >= 0) return wiz;                                   // erster Zauberer
  if (trick.every(p => isJester(p.card))) return 0;           // nur Narren
  const led = leadOf(trick);
  let best = -1, bestVal = -1;
  trick.forEach((p, i) => {
    if (isJester(p.card) || isWizard(p.card)) return;
    const col = p.card[0];
    let val = -1;
    if (trump && col === trump) val = 100 + rank(p.card);     // Trumpf schlaegt
    else if (col === led)       val = rank(p.card);           // Anspielfarbe
    if (val > bestVal) { bestVal = val; best = i; }
  });
  return best;
}

// Welche Handkarten darf `seat` gerade legal spielen?
export function legalCards(G, seat) {
  const hand = G.hands[seat];
  const led = leadOf(G.trick);
  if (led === null) return hand.slice();
  const hasLed = hand.some(c => colorOf(c) === led);
  if (!hasLed) return hand.slice();
  return hand.filter(c => isWizard(c) || isJester(c) || colorOf(c) === led);
}

// --- Spielaufbau -----------------------------------------------------------
export function newGame(names) {
  const np = names.length;
  const G = {
    numPlayers: np, totalRounds: Math.floor(60 / np),
    roundNo: 0, cardsThisRound: 0, dealerSeat: 0,
    trumpColor: null, trumpCard: null, trumpPending: false,
    phase: 'bidding', status: 'running',
    currentSeat: 0, leadSeat: 0, ledColor: null, trickNo: 0,
    players: names.map((name, seat) => ({
      seat, name, isHuman: seat === 0, bid: null, tricksWon: 0, totalScore: 0
    })),
    hands: {}, trick: [], scores: [], playedThisRound: []
  };
  dealRound(G);
  return G;
}

// Volles 60er-Deck als Hilfsfunktion fuer das Kartenmitzaehlen der KI.
export function fullDeck() { return deck(); }

export function dealRound(G) {
  const np = G.numPlayers;
  const n = G.roundNo + 1;
  G.dealerSeat = G.roundNo === 0 ? G.dealerSeat : (G.dealerSeat + 1) % np;
  G.players.forEach(p => { p.bid = null; p.tricksWon = 0; });

  const d = shuffle(deck());
  for (let s = 0; s < np; s++) {
    G.hands[s] = d.slice(s * n, s * n + n)
      .sort((a, b) => sortKey(a) - sortKey(b));
  }
  const dealt = np * n;

  if (dealt >= 60) {                       // letzte Runde: kein Trumpf
    G.trumpColor = null; G.trumpCard = null; G.trumpPending = false;
  } else {
    const flip = d[dealt];
    G.trumpCard = flip;
    // Zauberer aufgedeckt: Trumpf ist die FARBE des Zauberers (kein Waehlen mehr).
    if (isWizard(flip))      { G.trumpColor = WIZ_COLOR[flip] || null; G.trumpPending = false; }
    else if (isJester(flip)) { G.trumpColor = null; G.trumpPending = false; }
    else                     { G.trumpColor = flip[0]; G.trumpPending = false; }
  }

  G.roundNo = n; G.cardsThisRound = n; G.trickNo = 0;
  G.trick = []; G.ledColor = null; G.playedThisRound = [];
  G.leadSeat = (G.dealerSeat + 1) % np;
  if (G.trumpPending) { G.phase = 'trumpselect'; G.currentSeat = G.dealerSeat; }
  else                { G.phase = 'bidding';     G.currentSeat = (G.dealerSeat + 1) % np; }
}

// Sortierschluessel fuer huebsche Handanzeige (Farben gruppiert, Spezial hinten).
function sortKey(c) {
  if (isWizard(c)) return 900;
  if (isJester(c)) return 800;
  return { R: 0, Y: 100, G: 200, B: 300 }[c[0]] + rank(c);
}

export function chooseTrump(G, color) {
  G.trumpColor = color; G.trumpPending = false;
  G.phase = 'bidding'; G.currentSeat = (G.dealerSeat + 1) % G.numPlayers;
}

export function placeBid(G, seat, bid) {
  G.players[seat].bid = bid;
  if (G.players.every(p => p.bid != null)) {
    G.phase = 'playing'; G.trickNo = 1;
    G.leadSeat = (G.dealerSeat + 1) % G.numPlayers;
    G.currentSeat = G.leadSeat; G.ledColor = null; G.trick = [];
  } else {
    G.currentSeat = (G.currentSeat + 1) % G.numPlayers;
  }
}

// Hook-/Vorhand-Regel: die/der letzte Bietende darf die Ansagesumme nicht der
// Stichzahl gleichmachen. Liefert den gesperrten Gebotswert oder null.
export function forbiddenBid(G) {
  const placed = G.players.filter(p => p.bid != null);
  if (placed.length !== G.numPlayers - 1) return null;   // nur letzte:r Bietende:r
  const sum = placed.reduce((a, p) => a + p.bid, 0);
  const f = G.cardsThisRound - sum;
  return (f >= 0 && f <= G.cardsThisRound) ? f : null;
}

// Spielt eine Karte. Gibt { trickDone, resolved } zurueck; `resolved` ist der
// fertige Stich (mit Gewinner-Markierung) zur kurzen Anzeige.
export function playCard(G, seat, card) {
  G.hands[seat] = G.hands[seat].filter(c => c !== card);
  G.trick.push({ play_order: G.trick.length, seat, card, is_winner: false });
  G.playedThisRound.push(card);
  G.ledColor = leadOf(G.trick);

  if (G.trick.length < G.numPlayers) {
    G.currentSeat = (G.currentSeat + 1) % G.numPlayers;
    return { trickDone: false, resolved: null };
  }

  // Stich komplett -> Gewinner.
  const wi = winnerIndex(G.trick, G.trumpColor);
  G.trick[wi].is_winner = true;
  const winnerSeat = G.trick[wi].seat;
  G.players[winnerSeat].tricksWon += 1;
  const resolved = G.trick.map(p => ({ ...p }));

  if (G.trickNo >= G.cardsThisRound) {
    scoreRound(G);
    if (G.roundNo >= G.totalRounds) {
      G.status = 'finished'; G.phase = 'finished'; G.currentSeat = null;
    } else {
      dealRound(G);
    }
  } else {
    G.trickNo += 1; G.leadSeat = winnerSeat;
    G.currentSeat = winnerSeat; G.ledColor = null; G.trick = [];
  }
  return { trickDone: true, resolved };
}

function scoreRound(G) {
  G.players.forEach(p => {
    const score = p.tricksWon === p.bid
      ? 20 + 10 * p.bid
      : -10 * Math.abs(p.tricksWon - p.bid);
    p.totalScore += score;
    G.scores.push({
      round_no: G.roundNo, seat: p.seat, round_score: score, total_after: p.totalScore
    });
  });
}
