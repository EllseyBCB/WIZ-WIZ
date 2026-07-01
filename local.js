// Solo-Modus: lokales Spiel gegen Computer-Gegner.
// Verbindet engine.js + ai.js mit der vorhandenen Render-Logik (game.js).
import { newGame, chooseTrump, placeBid, playCard, legalCards, forbiddenBid } from './engine.js?v=2';
import { botBid, botChooseTrump, botCard } from './ai.js?v=2';
import { render } from './game.js?v=55';
import { showScreen, toast, esc } from './ui.js?v=2';
import { sfxCard, sfxBid, sfxTrick, sfxDeal, haptic } from './audio.js?v=4';
import { showBanner, hideBanner } from './ads.js?v=3';

const BOT_DELAY = 750;     // ms zwischen Bot-Aktionen
const TRICK_DELAY = 2500;  // ms, um den fertigen Stich + Gewinner zu zeigen
const BOT_NAMES = ['Merlin', 'Morgana', 'Gandalf', 'Zara', 'Balthasar', 'Circe'];
// Feste Emoji-"Profilbilder" fuer die Computer-Gegner (deterministisch je Sitz).
const BOT_AVATARS = ['avatars/av05.png', 'avatars/av06.png', 'avatars/av07.png', 'avatars/av08.png', 'avatars/av10.png', 'avatars/av11.png'];
// Mein eigenes Profilbild (vom Online-Profil zwischengespeichert), sonst Default.
function myAvatar() {
  try { return localStorage.getItem('wizard_my_avatar') || 'avatars/av01.png'; } catch (_) { return 'avatars/av01.png'; }
}

let G = null;
let DIFF = 'normal';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LS_SOLO = 'wizard_solo_save';

// Solo-Spielstand sichern (laeuft) bzw. loeschen (beendet) – so kann man die
// App schliessen und spaeter weiterspielen.
function saveSolo() {
  try {
    if (G && G.status === 'running') localStorage.setItem(LS_SOLO, JSON.stringify({ G, DIFF }));
    else localStorage.removeItem(LS_SOLO);
  } catch (_) {}
}
export function hasSoloSave() { return !!localStorage.getItem(LS_SOLO); }

// Engine-Zustand -> Render-Zustand (gleiche Form wie der Online-Modus).
function buildState(overrideTrick) {
  const trick = (overrideTrick || G.trick).map(p => ({
    seat: p.seat, card: p.card, play_order: p.play_order, is_winner: p.is_winner
  }));
  return {
    uid: 'me',
    game: {
      status: G.status, phase: G.phase, join_code: '', host_uid: 'me',
      round_no: G.roundNo, total_rounds: G.totalRounds, cards_this_round: G.cardsThisRound,
      dealer_seat: G.dealerSeat, trump_color: G.trumpColor, trump_card: G.trumpCard,
      trump_pending: G.trumpPending, current_seat: G.currentSeat, lead_seat: G.leadSeat,
      led_color: G.ledColor, trick_no: G.trickNo, num_players: G.numPlayers
    },
    players: G.players.map(p => ({
      seat: p.seat, name: p.name, uid: p.isHuman ? 'me' : 'bot' + p.seat,
      is_host: p.isHuman, connected: true,
      avatar: p.isHuman ? myAvatar() : BOT_AVATARS[(p.seat - 1) % BOT_AVATARS.length],
      bid: p.bid, tricks_won: p.tricksWon, total_score: p.totalScore
    })),
    hand: (G.hands[0] || []).map(c => ({ card: c, played: false })),
    trick,
    scores: G.scores.map(s => ({
      round_no: s.round_no, seat: s.seat, round_score: s.round_score, total_after: s.total_after
    }))
  };
}

const actions = {
  onStart: () => {},
  onLeave: () => quit(),
  onAbort: () => quit(),
  onPause: () => pauseSolo(),
  onTrump: (c) => humanTrump(c),
  onBid:   (n) => humanBid(n),
  onPlay:  (card) => humanPlay(card)
};

function paint(overrideTrick) { saveSolo(); render(buildState(overrideTrick), actions); }

// Pausieren: Stand ist gesichert, zurueck zur Startseite ("Solo fortsetzen").
function pauseSolo() {
  saveSolo();
  showScreen('home-view');
  showBanner();
  window.dispatchEvent(new Event('wiz-resume-refresh'));
}

// Pausiertes Solo-Spiel fortsetzen.
export async function resumeLocal() {
  const raw = localStorage.getItem(LS_SOLO);
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    G = data.G; DIFF = data.DIFF || 'normal';
  } catch (_) { localStorage.removeItem(LS_SOLO); return false; }
  if (!G || G.status !== 'running') { localStorage.removeItem(LS_SOLO); return false; }
  hideBanner();
  showScreen('game-view');
  paint();
  await drive();   // falls gerade Bots dran sind
  return true;
}

// Den fertigen Stich eingefroren zeigen (Gewinnerkarte hervorgehoben, kein
// "am Zug"-Hinweis) – wie im Online-Modus.
function paintTrickEnd(resolvedTrick) {
  const st = buildState(resolvedTrick);
  st.game = { ...st.game, phase: 'trickend', current_seat: null };
  // War das der letzte Stich der Runde, ist die neue Runde schon ausgeteilt.
  // Die neuen Handkarten waehrend des Gewinner-Banners NICHT offen zeigen –
  // sie werden direkt danach mit Animation ausgeteilt.
  if (G.phase === 'bidding' || G.phase === 'trumpselect') st.hand = [];
  render(st, actions);
}

// Banner "🏆 … gewinnt den Stich" (nutzt #trick-banner aus index.html).
function showTrickBanner(name) {
  let el = document.getElementById('trick-banner');
  if (!el) { el = document.createElement('div'); el.id = 'trick-banner'; document.body.appendChild(el); }
  el.innerHTML = '🏆 <b>' + esc(name) + '</b><br>gewinnt den Stich';
  el.classList.add('show');
}
function hideTrickBanner() { const el = document.getElementById('trick-banner'); if (el) el.classList.remove('show'); }

async function afterPlay(res) {
  if (res && res.trickDone) {
    // Stich abgeschlossen: letzte Karte sichtbar lassen + Gewinner melden.
    paintTrickEnd(res.resolved);
    const wp = res.resolved.find(p => p.is_winner) || res.resolved[res.resolved.length - 1];
    const name = G.players.find(p => p.seat === wp.seat)?.name || 'Niemand';
    sfxTrick(); haptic([30, 50, 30]);
    showTrickBanner(name);
    await sleep(TRICK_DELAY);
    hideTrickBanner();
  }
  paint();
}

// Bots ziehen lassen, bis der Mensch (Sitz 0) an der Reihe ist.
async function drive() {
  while (G.status === 'running') {
    const actor = G.phase === 'trumpselect' ? G.dealerSeat : G.currentSeat;
    if (actor === 0) break;
    await sleep(BOT_DELAY);
    if (G.phase === 'trumpselect') {
      chooseTrump(G, botChooseTrump(G, G.dealerSeat)); paint();
    } else if (G.phase === 'bidding') {
      placeBid(G, G.currentSeat, botBid(G, G.currentSeat, DIFF)); sfxBid(); paint();
    } else if (G.phase === 'playing') {
      sfxCard();
      await afterPlay(playCard(G, G.currentSeat, botCard(G, G.currentSeat, DIFF)));
    }
  }
  paint();
}

async function humanTrump(c) {
  if (G.phase !== 'trumpselect' || G.dealerSeat !== 0) return;
  chooseTrump(G, c); paint(); await drive();
}

async function humanBid(n) {
  if (G.phase !== 'bidding' || G.currentSeat !== 0) return;
  if (n === forbiddenBid(G)) {
    toast('Diese Ansage ist gesperrt – die Summe darf nicht der Stichzahl entsprechen', 'err');
    return;
  }
  placeBid(G, 0, n); sfxBid(); haptic(12); paint(); await drive();
}

async function humanPlay(card) {
  if (G.phase !== 'playing' || G.currentSeat !== 0) return;
  if (!legalCards(G, 0).includes(card)) { toast('Diese Karte ist nicht erlaubt', 'err'); return; }
  sfxCard(); haptic(15);
  await afterPlay(playCard(G, 0, card));
  await drive();
}

function quit() {
  G = null;
  localStorage.removeItem(LS_SOLO);
  hideTrickBanner();
  showScreen('home-view');
  showBanner();
  window.dispatchEvent(new Event('wiz-resume-refresh'));
}

// Solo-Spiel starten: numOpponents Bots (2–5) + Mensch, mit Schwierigkeitsgrad.
export async function startLocal(numOpponents, humanName, difficulty = 'normal') {
  DIFF = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
  const bots = [...BOT_NAMES].sort(() => Math.random() - 0.5).slice(0, numOpponents);
  G = newGame([humanName || 'Du', ...bots]);
  hideBanner();
  showScreen('game-view');
  sfxDeal();
  paint();
  await drive();
}
