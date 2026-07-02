// Computer-Gegner mit drei Schwierigkeitsgraden:
//   'easy'   – grobe Schaetzung, spielt zufaellig legal
//   'normal' – solide Heuristik (Stich holen/vermeiden je nach Gebot)
//   'hard'   – wie normal, plus Kartenmitzaehlen (garantierte Sticher erkennen,
//              Zauberer/Top-Trumpf nicht verschwenden, genaueres Gebot)
import { leadOf, winnerIndex, legalCards, fullDeck, forbiddenBid } from './engine.js?v=3';

const rank = c => parseInt(c.slice(1), 10);
const isWizard = c => c.startsWith('Z');
const isJester = c => c.startsWith('N');
const colorOf  = c => (isWizard(c) || isJester(c)) ? null : c[0];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Noch nicht gesehene Karten (in fremden Haenden) – Basis fuers Mitzaehlen.
function unseen(G, seat) {
  const seen = new Set([...G.hands[seat], ...G.playedThisRound]);
  return fullDeck().filter(c => !seen.has(c));
}

// --- Gebot -----------------------------------------------------------------
export function botBid(G, seat, diff = 'normal') {
  const hand = G.hands[seat];
  const trump = G.trumpColor;
  const n = G.cardsThisRound;
  let bid;

  if (diff === 'easy') {
    let est = 0;
    for (const c of hand) {
      if (isWizard(c)) est += 1;
      else if (!isJester(c) && trump && colorOf(c) === trump && rank(c) >= 11) est += 1;
    }
    bid = Math.max(0, Math.min(n, est + (Math.random() < 0.3 ? 1 : 0)));
  } else {
    // normal & hard nutzen dieselbe bewaehrte Gebots-Heuristik; die Mehrstaerke
    // von 'hard' kommt aus dem kartenzaehlenden Kartenspiel (botCard).
    let est = 0;
    for (const c of hand) {
      if (isWizard(c)) { est += 1; continue; }
      if (isJester(c)) continue;
      const r = rank(c);
      if (trump && colorOf(c) === trump) est += r >= 11 ? 0.85 : r >= 8 ? 0.55 : r >= 5 ? 0.3 : 0.12;
      else est += r === 13 ? 0.6 : r === 12 ? 0.4 : r >= 11 ? 0.22 : 0.04;
    }
    bid = Math.max(0, Math.min(n, Math.round(est)));
  }

  // Hook-Regel: letzte:r Bietende:r darf die Summe nicht = Stichzahl machen.
  if (bid === forbiddenBid(G)) bid = bid > 0 ? bid - 1 : bid + 1;
  return bid;
}

// --- Trumpfwahl (Geber) ----------------------------------------------------
export function botChooseTrump(G, seat) {
  const score = { R: 0, Y: 0, G: 0, B: 0 };
  for (const c of G.hands[seat]) {
    const col = colorOf(c);
    if (col) score[col] += 1 + rank(c) / 20;
  }
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
}

// --- Kartenspiel -----------------------------------------------------------
export function botCard(G, seat, diff = 'normal') {
  const legal = legalCards(G, seat);
  if (legal.length === 1) return legal[0];
  if (diff === 'easy') return pick(legal);

  const p = G.players[seat];
  const trump = G.trumpColor;
  const wants = p.tricksWon < (p.bid ?? 0);
  const led = leadOf(G.trick);

  const strength = c => {
    if (isWizard(c)) return 1000;
    if (isJester(c)) return -1;
    if (trump && colorOf(c) === trump) return 200 + rank(c);
    if (G.trick.length === 0 || colorOf(c) === led) return 100 + rank(c);
    return rank(c);
  };
  const wouldWin = c => {
    const hypo = [...G.trick, { seat, card: c }];
    return winnerIndex(hypo, trump) === hypo.length - 1;
  };
  const asc  = [...legal].sort((a, b) => strength(a) - strength(b));
  const desc = [...asc].reverse();

  // Garantierter Sticher beim Anspielen (nur 'hard'): Zauberer, oder hoechster
  // Trumpf ohne hoehere unbekannte Trumpf-/Zauberer-Karte.
  if (diff === 'hard' && G.trick.length === 0) {
    const out = unseen(G, seat);
    const noWizOut = !out.some(isWizard);
    const guaranteed = c => {
      if (isWizard(c)) return true;
      if (trump && colorOf(c) === trump)
        return noWizOut && !out.some(x => colorOf(x) === trump && rank(x) > rank(c));
      return false;
    };
    if (wants) {
      const sure = asc.filter(guaranteed);     // billigsten sicheren Sticher anspielen
      if (sure.length) return sure[0];
    }
  }

  if (wants) {
    const winners = asc.filter(wouldWin);       // schwaechste gewinnende Karte
    if (winners.length) return winners[0];
    return asc[0];                              // kann nicht gewinnen -> abwerfen
  } else {
    const losers = desc.filter(c => !wouldWin(c)); // hohe Karte sicher loswerden
    if (losers.length) return losers[0];
    return asc[0];                              // muss gewinnen -> minimal opfern
  }
}
