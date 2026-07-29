// Einstieg: Routing, Solo-Modus, Online-Aktionen -> RPCs, Realtime -> Re-Render.
// Wichtig: db.js (laedt Supabase aus dem Netz) wird NUR bei Bedarf dynamisch
// importiert. So bleibt der Solo-Modus auch ohne Netz/Supabase voll spielbar.
import { render } from './game.js?v=88';
import { gameAssetUrls } from './table.js?v=80';
import { startLocal, resumeLocal, hasSoloSave } from './local.js?v=76';
import { preloadCards, allCardImageUrls } from './cards.js?v=20';
import { initAds, showBanner, hideBanner, isAdFree, setAdFree, isPreview, setPreview, isForceTest, setForceTest, adsStatus, onAdsStatus } from './ads.js?v=8';
import { requireToken, refundToken, getTokens, tokenGateActive, setTokensForTest,
         getDailySlots, deriveDailySlots, grantTokens, watchAdForToken } from './tokens.js?v=4';
import { initIAP, purchaseAdFree, purchaseProduct, purchaseConsumable, onConsumable, restorePurchases, iapAvailable, productPrice } from './iap.js?v=6';
import { AVATAR_ITEMS, TABLE_ITEMS, SHOP_ADFREE, SHOP_BUNDLE, isOwned, avatarItem, avatarOwned,
         isDevUnlock, grantOwned, myAvatar,
         getTableTheme, setTableTheme, applyTableTheme, setTableBg, getTableBg,
         setCardDeck, getCardDeck,
         setCardBack, getCardBack, applyCardBack,
         isOwnerEmail, ownerUnlock, setOwnerUnlock } from './cosmetics.js?v=10';
import { startMusic, setEnabled as setMusicEnabled, setVolume as setMusicVolume, isEnabled as musicEnabled, getVolume as musicVolume,
         sfxCard, sfxBid, sfxTrick, sfxDeal, sfxTurn, sfxTap, haptic, setSfx, sfxEnabled, setSfxVolume, getSfxVolume,
         sfxChestRumble, sfxChestImpact, sfxChestOpen, sfxDropReveal, sfxItemReveal } from './audio.js?v=5';
import { $, showScreen, toast, esc, confetti, showYourTurn } from './ui.js?v=2';
import { SHOP_SECTIONS, CRYSTAL_PACKS, RARITY, SLOT_TIERS, TOKEN_PACKS, CHEST_TIERS, CHEST_META } from './shop-catalog.js?v=19';

const LS_GAME = 'wizard_gameId';
const LS_NAME = 'wizard_name';

const state = {
  uid: null, gameId: null,
  game: null, players: [], hand: [], trick: [], scores: []
};
let unsubscribe = null;
let reloadTimer = null;
let pollTimer = null;
// Avatar-Cache je Spiel (uid -> Avatar), damit nicht bei jedem Update geladen wird.
let avatarMap = new Map();
let avatarGame = null;
async function ensureAvatars(m, gameId, players) {
  const missing = players.some(p => !avatarMap.has(p.uid));
  if (avatarGame === gameId && !missing) return;
  try {
    const rows = await m.memberAvatars(gameId);
    avatarMap = new Map((rows || []).map(r => [r.uid, r.avatar]));
    avatarGame = gameId;
  } catch (_) { /* Avatare sind optional – ohne sie wird Default gezeigt */ }
}

// db.js erst beim ersten Online-Zugriff laden und zwischenspeichern.
let DB = null;
const db = async () => (DB ||= await import('./db.js?v=14'));

// --- Aktionen (an game.js uebergeben) --------------------------------------
// Spiel-ID, fuer die DIESE Sitzung einen Spielstein bezahlt hat. Verlaesst man
// eine noch nicht gestartete Lobby wieder, gibt es den Stein zurueck – so
// kosten nur Spiele, die wirklich beginnen.
let tokenPaidFor = null;
function maybeRefundLobbyToken() {
  if (tokenPaidFor && tokenPaidFor === state.gameId
      && state.game?.status === 'lobby' && tokenGateActive()) refundToken();
  tokenPaidFor = null;
}

const actions = {
  onStart:  () => guarded(async (m) => m.startGame(state.gameId)),
  // Schnelle Runde: Countdown abgelaufen -> Start anstossen. Mehrere Clients
  // rufen gleichzeitig; der Server behandelt Doppel-Aufrufe als stille No-Ops.
  onQuickStart: async () => {
    try { await (await db()).quickStart(state.gameId); await reloadAll(); } catch (_) {}
  },
  onLeave:  () => guarded(async (m) => { maybeRefundLobbyToken(); await m.leaveGame(state.gameId); goHome(); }),
  // Warteraum: Bot-Mitspieler hinzufuegen/entfernen (nur Host).
  onAddBot:    () => guarded(async (m) => m.addBot(state.gameId)),
  onRemoveBot: (seat) => guarded(async (m) => m.removeBot(state.gameId, seat)),
  onAbort:  () => guarded(async (m) => { maybeRefundLobbyToken(); return m.abortGame(state.gameId); }),
  onTrump:  (c) => guarded(async (m) => m.chooseTrump(state.gameId, c)),
  onBid:    (n) => { sfxBid(); haptic(12); return guarded(async (m) => m.placeBid(state.gameId, n)); },
  onPlay:   (card) => { haptic(15); return guarded(async (m) => m.playCard(state.gameId, card)); },
  onPause:  () => pauseOnline(),
  // Endstand: "Truhen öffnen" -> in den Shop-Truhen-Tab wechseln.
  onChests: () => { showScreen('home-view'); shopCat = 'chests'; switchPane('shop'); },
  // Warteraum: Freunde laden + in dieses Spiel einladen.
  onLoadFriends: async () => { try { return await (await db()).listFriends(); } catch (_) { return []; } },
  onInvite: async (friendUid) => {
    try { await (await db()).inviteFriend(state.gameId, friendUid); toast('Einladung gesendet', 'ok'); }
    catch (e) { toast(e.message || 'Fehler', 'err'); }
  }
};

async function guarded(fn) {
  try { await fn(await db()); await reloadAll(); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// --- Zustand laden + rendern -----------------------------------------------
// Signatur des sichtbaren Zustands: nur wenn sie sich aendert, wird neu
// gerendert. So flackert der Tisch nicht bei jedem Poll/Doppel-Event.
let lastRenderSig = null;
let prevSnap = null;          // zuletzt gezeigter Stand (Runde/Stich/Phase)
let holdingTrick = false;     // true, waehrend der abgeschlossene Stich angezeigt wird
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Klangeffekte/Benachrichtigung anhand der Zustandsaenderung ausloesen.
let sfxTrickLen = 0, sfxRound = 0, myTurnPrev = false;
function soundForUpdate(game) {
  const me = state.players.find(p => p.uid === state.uid);
  const mySeat = me?.seat ?? -1;
  if (state.trick.length > sfxTrickLen) sfxCard();          // neue Karte im Stich
  sfxTrickLen = state.trick.length;
  if (game.round_no > sfxRound) { if (sfxRound > 0) sfxDeal(); sfxRound = game.round_no; }  // neue Runde
  const myTurn = game.status === 'running' &&
    ((game.phase === 'playing' || game.phase === 'bidding') && game.current_seat === mySeat
     || game.phase === 'trumpselect' && game.dealer_seat === mySeat);
  if (myTurn && !myTurnPrev) { showYourTurn(); sfxTurn(); haptic(20); notifyYourTurn(); }
  myTurnPrev = myTurn;
}

function stateSig(game, players, hand, trick, scores) {
  return JSON.stringify([
    game.status, game.phase, game.current_seat, game.lead_seat, game.led_color,
    game.round_no, game.trick_no, game.trump_color, game.trump_card, game.trump_pending,
    game.num_players, game.total_rounds, game.dealer_seat, game.join_code,
    game.is_quick, game.starts_at, game.paused_by,
    players.map(p => [p.seat, p.name, p.bid, p.tricks_won, p.total_score, p.connected, p.is_host, p.is_bot]),
    hand.map(h => [h.card, h.played]),
    trick.map(t => [t.play_order, t.seat, t.card, t.is_winner]),
    scores.length
  ]);
}

async function reloadAll() {
  if (!state.gameId || holdingTrick) return;   // waehrend Stich-Anzeige nicht stoeren
  const m = await db();
  const game = await m.loadGame(state.gameId);
  state.game = game;
  const [players, scores] = await Promise.all([
    m.loadPlayers(state.gameId), m.loadScores(state.gameId)
  ]);
  await ensureAvatars(m, state.gameId, players);
  players.forEach(p => { p.avatar = avatarMap.get(p.uid) || p.avatar || DEFAULT_AV; });
  state.players = players;
  state.scores = scores;
  if (game.round_no > 0) {
    const [hand, trick] = await Promise.all([
      m.loadHand(state.gameId, game.round_no),
      m.loadTrick(state.gameId, game.round_no, game.trick_no)
    ]);
    state.hand = hand;
    state.trick = trick;
  } else {
    state.hand = []; state.trick = [];
  }

  soundForUpdate(game);   // Klangeffekte / "du bist dran"

  // Wurde gerade ein Stich abgeschlossen? -> kurz anzeigen + Gewinner melden.
  // (Die Halbzeit-Ansage kommt erst DANACH – showTrickResult laedt erneut.)
  const done = trickJustCompleted(game);
  if (done) { await showTrickResult(m, done); return; }

  maybeAnnounceHalfway(game);   // "Karten werden wieder weniger"-Ansage
  maybeDriveBot(game);          // Bot am Zug? -> Server-Zug anstossen
  updateTurnTimer(game);        // 20-s-Zug-Timer anzeigen/antreiben

  prevSnap = { round: game.round_no, trick: game.trick_no, phase: game.phase };
  // Nur neu zeichnen, wenn sich wirklich etwas geaendert hat.
  const sig = stateSig(game, state.players, state.hand, state.trick, state.scores);
  if (sig === lastRenderSig) return;
  lastRenderSig = sig;
  render(state, actions);
}

// Bot-Zuege anstossen: Ist ein Bot am Zug, ruft der Client nach kurzer
// "Denkpause" wizard_bot_act - der Server waehlt und spielt den Zug selbst.
// Jedes menschliche Mitglied darf anstossen; Doppel-Aufrufe sind durch die
// serverseitige Zeilensperre + Zustandspruefung harmlos.
let lastBotKey = null, botTimer = null;
function maybeDriveBot(game) {
  if (!game || game.status !== 'running') { lastBotKey = null; return; }
  const seat = game.phase === 'trumpselect' ? game.dealer_seat : game.current_seat;
  const p = state.players.find(x => x.seat === seat);
  if (!p?.is_bot || !['trumpselect', 'bidding', 'playing'].includes(game.phase)) return;
  const key = [game.round_no, game.trick_no, game.phase, seat, state.trick.length].join(':');
  if (key === lastBotKey) return;
  lastBotKey = key;
  clearTimeout(botTimer);
  botTimer = setTimeout(async () => {
    try {
      const m = await db();
      if (await m.botAct(state.gameId)) await reloadAll();
    } catch (_) {}
  }, 1000 + Math.random() * 600);
}

// --- 20-s-Zug-Timer (online) -------------------------------------------------
// Anzeige laeuft clientseitig ab dem letzten Zustandswechsel; die ECHTE
// Pruefung macht der Server (updated_at >= 20 s), der Aufruf ist also
// gefahrlos. Bei Pause (game.paused_by) steht die Uhr fuer alle.
let turnDeadline = 0, turnTimerInt = null, lastTurnKey = null, autoActBusy = false;
function hideTurnTimer() {
  document.getElementById('turn-timer')?.remove();
  lastTurnKey = null;
  clearInterval(turnTimerInt); turnTimerInt = null;
}
function updateTurnTimer(game) {
  const active = state.gameId && game && game.status === 'running'
    && ['trumpselect', 'bidding', 'playing'].includes(game.phase);
  if (!active) { hideTurnTimer(); return; }
  let el = document.getElementById('turn-timer');
  if (!el) { el = document.createElement('div'); el.id = 'turn-timer'; document.body.appendChild(el); }
  if (game.paused_by) {
    el.textContent = '⏸ Pausiert';
    el.classList.remove('urgent');
    lastTurnKey = 'paused';
    clearInterval(turnTimerInt); turnTimerInt = null;
    return;
  }
  const seat = game.phase === 'trumpselect' ? game.dealer_seat : game.current_seat;
  const key = [game.round_no, game.trick_no, game.phase, seat, state.trick.length].join(':');
  if (key !== lastTurnKey) {
    lastTurnKey = key;
    turnDeadline = Date.now() + (game.turn_seconds || 20) * 1000;   // eingestellte Zugzeit
  }
  if (!turnTimerInt) turnTimerInt = setInterval(tickTurnTimer, 250);
  tickTurnTimer();
}
async function tickTurnTimer() {
  const el = document.getElementById('turn-timer');
  const game = state.game;
  if (!el || !game || !state.gameId) { hideTurnTimer(); return; }
  if (game.paused_by) return;
  const left = Math.ceil((turnDeadline - Date.now()) / 1000);
  if (left > 0) {
    el.textContent = `⏱ ${left}`;
    el.classList.toggle('urgent', left <= 5);
  } else {
    el.textContent = '⏱ 0';
    el.classList.add('urgent');
    if (!autoActBusy) {
      autoActBusy = true;
      try {
        const m = await db();
        if (await m.autoAct(state.gameId)) await reloadAll();
      } catch (_) {}
      setTimeout(() => { autoActBusy = false; }, 1500);   // sanft weiterprobieren
    }
  }
}

// Erkennt am Phasen-/Stich-Wechsel, dass der zuvor gezeigte Stich fertig ist.
function trickJustCompleted(game) {
  if (!prevSnap || prevSnap.phase !== 'playing') return null;
  if (game.status === 'aborted') return null;   // Abbruch -> keine Stich-Anzeige
  const same = game.round_no === prevSnap.round && game.trick_no === prevSnap.trick && game.phase === 'playing';
  if (same) return null;
  return { round: prevSnap.round, trick: prevSnap.trick };
}

// Zeigt den abgeschlossenen Stich (mit hervorgehobener Gewinnerkarte) + Banner
// fuer einen Moment an, bevor der naechste Zustand erscheint.
async function showTrickResult(m, done) {
  holdingTrick = true;
  try {
    const won = await m.loadTrick(state.gameId, done.round, done.trick);
    if (won && won.length) {
      const wp = won.find(p => p.is_winner) || won[won.length - 1];
      const name = state.players.find(p => p.seat === wp.seat)?.name || 'Niemand';
      const frozen = {
        ...state, trick: won,
        game: { ...state.game, phase: 'trickend', current_seat: null,
                trick_no: done.trick, round_no: done.round }
      };
      render(frozen, actions);
      sfxTrick(); haptic([30, 50, 30]);
      showTrickBanner(name);
      await delay(2500);
      hideTrickBanner();
    }
  } catch (_) {}
  holdingTrick = false;
  prevSnap = null;
  lastRenderSig = null;
  await reloadAll();           // jetzt den aktuellen Zustand zeigen
}

function showTrickBanner(name) {
  let el = document.getElementById('trick-banner');
  if (!el) { el = document.createElement('div'); el.id = 'trick-banner'; document.body.appendChild(el); }
  el.innerHTML = '🏆 <b>' + esc(name) + '</b><br>' + (name === 'Du' ? 'gewinnst' : 'gewinnt') + ' den Stich';
  el.classList.add('show');
}
function hideTrickBanner() { const el = document.getElementById('trick-banner'); if (el) el.classList.remove('show'); }

// Mittige Ansage (gleiche Optik wie das Stich-Banner), blendet sich selbst aus.
let announceTimer = null;
function announce(html, ms = 2500) {
  let el = document.getElementById('trick-banner');
  if (!el) { el = document.createElement('div'); el.id = 'trick-banner'; document.body.appendChild(el); }
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Ansage zur Spielhaelfte (Online): Ab jetzt sinkt die Kartenzahl je Runde.
// Erste "sinkende" Runde der Pyramide c=min(n, T-n+1) ist n = floor(T/2)+2.
// Einmal je Spiel (merkt sich die Spiel-ID); === verhindert ein Nachfeuern,
// wenn man erst spaeter wieder einsteigt.
const LS_HALF = 'wizard_halfseen';
const firstDecreasingRound = (t) => Math.floor(t / 2) + 2;
function maybeAnnounceHalfway(game) {
  if (!game || game.status !== 'running' || !game.total_rounds) return;
  if (game.short_cards) return;   // Kurzspiel: nur aufsteigend -> keine Halbzeit
  if (game.round_no !== firstDecreasingRound(game.total_rounds)) return;
  try {
    if (localStorage.getItem(LS_HALF) === String(state.gameId)) return;
    localStorage.setItem(LS_HALF, String(state.gameId));
  } catch (_) {}
  announce('🃏 <b>Ab jetzt werden die Karten wieder weniger!</b>');
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reloadAll().catch(() => {}), 120);
}

// --- Spiel betreten / verlassen --------------------------------------------
async function enterGame(gameId) {
  const m = await db();
  state.gameId = gameId;
  lastRenderSig = null; prevSnap = null; holdingTrick = false;   // neues Spiel
  sfxTrickLen = 0; sfxRound = 0; myTurnPrev = false;
  // Eigene Pause aufheben (Server ignoriert den Aufruf, wenn jemand anderes
  // pausiert hat) - die Zug-Uhr startet dabei neu.
  m.pauseGame(gameId, false).catch(() => {});
  hideBanner();                                                  // im Spiel kein Banner
  localStorage.setItem(LS_GAME, gameId);
  if (unsubscribe) unsubscribe();
  unsubscribe = await m.subscribe(gameId, {
    onGame: scheduleReload, onPlayers: scheduleReload,
    onPlays: scheduleReload, onScores: scheduleReload
  });
  // Sicherheitsnetz: regelmaessig nachladen, falls ein Realtime-Event ausbleibt.
  // In der Schnelle-Runde-Lobby zusaetzlich alle ~15 s ein Heartbeat, damit
  // die Lobby "frisch" bleibt und weiter vermittelt wird (verwaiste Lobbys
  // ohne Ping werden vom Matchmaking uebersprungen und aufgeraeumt).
  clearInterval(pollTimer);
  let pollTick = 0;
  pollTimer = setInterval(() => {
    reloadAll().catch(() => {});
    if (++pollTick % 3 === 0 && state.game?.is_quick && state.game.status === 'lobby') {
      db().then(m => m.quickPing(state.gameId)).catch(() => {});
    }
  }, 5000);
  await reloadAll();
  showScreen('game-view');
}

function goHome() {
  clearInterval(pollTimer); pollTimer = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  lastRenderSig = null; prevSnap = null; holdingTrick = false;
  hideTrickBanner();
  hideTurnTimer();
  state.gameId = null; state.game = null;
  state.players = []; state.hand = []; state.trick = []; state.scores = [];
  localStorage.removeItem(LS_GAME);
  showScreen('home-view');
  refreshResume();
  showBanner();
  refreshChestList();   // nach einem Online-Spiel ggf. neue Truhe -> Badge
}

// Pausieren (Online): Verbindung trennen, ABER den Spielplatz merken, damit man
// ueber "Weiterspielen" zurueckkommt. Der Spielstand bleibt auf dem Server.
function pauseOnline() {
  // Serverseitig pausieren: haelt den 20-s-Zug-Timer fuer ALLE an.
  if (state.gameId) {
    const gid = state.gameId;
    (async () => { try { (await db()).pauseGame(gid, true); } catch (_) {} })();
  }
  hideTurnTimer();
  clearInterval(pollTimer); pollTimer = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  hideTrickBanner();
  // LS_GAME bleibt erhalten -> "Online-Spiel fortsetzen" auf der Startseite
  state.game = null; state.players = []; state.hand = []; state.trick = []; state.scores = [];
  const id = state.gameId; state.gameId = null;
  showScreen('home-view');
  refreshResume();
  showBanner();
  if (id) toast('Spiel pausiert – über „Weiterspielen" kommst du zurück.', 'ok');
}

// --- Weiterspielen / Wiederaufnahme ----------------------------------------
async function resumeOnline() {
  const id = localStorage.getItem(LS_GAME);
  if (!id) { refreshResume(); return; }
  const m = await ensureOnline();
  if (!m) return;
  try {
    const g = await m.loadGame(id);
    if (!g || g.status === 'finished' || g.status === 'aborted') {
      localStorage.removeItem(LS_GAME); refreshResume();
      toast('Das Spiel ist bereits beendet.', 'info'); return;
    }
    try { await m.joinGame(g.join_code, currentName() || 'Spieler'); } catch (_) {}  // sauber wieder verbinden
    await enterGame(id);
  } catch (e) {
    localStorage.removeItem(LS_GAME); refreshResume();
    toast('Konnte nicht fortsetzen – das Spiel gibt es nicht mehr.', 'err');
  }
}

async function resumeSoloUI() {
  clearInterval(pollTimer); pollTimer = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const ok = await resumeLocal();
  if (!ok) { toast('Kein gespeichertes Solo-Spiel gefunden.', 'info'); refreshResume(); }
}

// Startseite: Solo-Karte + grossen "Weiterspielen"-Knopf je nach gespeichertem
// Spielstand aktivieren/deaktivieren.
function refreshResume() {
  const onlineId = localStorage.getItem(LS_GAME);
  const solo = hasSoloSave();
  const soloCard = document.getElementById('act-solo');
  if (soloCard) {
    soloCard.classList.toggle('is-disabled', !solo);
    const sub = soloCard.querySelector('.act-sub');
    if (sub) sub.textContent = solo ? 'Dein pausiertes Solo-Spiel wartet.' : 'Kein pausiertes Solo-Spiel.';
  }
  const big = document.getElementById('resume-big');
  const bigSub = document.getElementById('rb-sub');
  if (big) {
    big.classList.toggle('is-disabled', !(onlineId || solo));
    if (bigSub) bigSub.textContent = onlineId ? 'Online-Partie fortsetzen'
      : (solo ? 'Pausiertes Solo-Spiel fortsetzen' : 'Kein pausiertes Spiel');
  }
  refreshTokenPill();
}

// Spielsteine-Pille auf der Startseite (nur sichtbar, wenn das Gate aktiv ist).
function refreshTokenPill() {
  const pill = document.getElementById('token-pill');
  if (!pill) return;
  const active = tokenGateActive();
  pill.hidden = !active;
  if (active) {
    const n = document.getElementById('token-n');
    if (n) n.textContent = String(getTokens());
  }
}

// Lobby-Modals (Gegen Computer / Online / Beitreten) öffnen/schliessen.
function openLobbyModal(id) { const m = document.getElementById(id); if (m) m.hidden = false; }
function closeLobbyModals() { document.querySelectorAll('#pane-lobby .modal').forEach(m => m.hidden = true); }

// Statistik-Box (aus dem Online-Spielverlauf) füllen – nur wenn angemeldet.
async function loadHomeStats() {
  const g = $('#stat-games'), w = $('#stat-wins'), r = $('#stat-rate');
  if (!g) return;
  if (!state.uid) { g.textContent = '0'; w.textContent = '0'; r.textContent = '0%'; return; }
  try {
    const m = await ensureOnline(); if (!m) throw 0;
    const games = await m.matchHistory();
    const total = (games || []).length;
    const wins = (games || []).filter(x => x.players && x.players[0] && x.players[0].uid === state.uid).length;
    g.textContent = total; w.textContent = wins; r.textContent = (total ? Math.round(wins / total * 100) : 0) + '%';
  } catch (_) { g.textContent = '0'; w.textContent = '0'; r.textContent = '0%'; }
}

// --- Home-Formular ---------------------------------------------------------
function wireHome() {
  const nameInput = $('#name-input');
  nameInput.value = localStorage.getItem(LS_NAME) || '';
  nameInput.addEventListener('input', () => localStorage.setItem(LS_NAME, nameInput.value.trim()));

  // Kopf-Icons + Tab-Leiste (rein gestalterisch / Hilfe-Overlay).
  const helpModal = document.getElementById('help-modal');
  const helpBtn = document.getElementById('help-btn');
  const helpClose = document.getElementById('help-close');
  if (helpBtn && helpModal) helpBtn.onclick = () => helpModal.hidden = false;
  if (helpClose && helpModal) helpClose.onclick = () => helpModal.hidden = true;
  if (helpModal) helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.hidden = true; });
  // Beim allerersten Start (nachdem der Datenschutz-Hinweis bestaetigt wurde)
  // einmalig die Kurzregeln zeigen - Neulinge kennen Wizard sonst nicht.
  try {
    if (helpModal && localStorage.getItem('wizard_consent')
        && !localStorage.getItem('wizard_help_seen')) {
      localStorage.setItem('wizard_help_seen', '1');
      helpModal.hidden = false;
    }
  } catch (_) {}
  // Escape schliesst offene statische Modals (nicht das Consent – das muss
  // aktiv bestaetigt werden). Fuer Desktop-/Tastatur-Nutzung.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['help-modal', 'settings-modal', 'privacy-modal', 'terms-modal', 'imprint-modal',
     'mydata-modal', 'delete-modal', 'solo-modal', 'online-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m && !m.hidden) m.hidden = true;
    });
  });
  wireSettings();
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => handleNav(tab.dataset.nav, tab);
  });

  // --- Neue Startseite: Hero-Tippflächen, Aktionskarten, Weiterspielen -----
  const heroHelp = $('#hero-help'); if (heroHelp) heroHelp.onclick = () => $('#help-btn')?.click();
  const heroSet = $('#hero-settings'); if (heroSet) heroSet.onclick = () => $('#settings-btn')?.click();
  $('#act-comp').onclick = () => openLobbyModal('solo-modal');
  $('#act-online').onclick = () => openLobbyModal('online-modal');
  $('#act-join').onclick = () => openLobbyModal('join-modal');
  // Schnelle Runde: Matchmaking – offener Lobby beitreten oder neue eroeffnen.
  $('#act-quick').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    m.upsertProfile(name).catch(() => {});
    requireToken(async () => {
      try {
        const gameId = await m.quickMatch(name);
        tokenPaidFor = gameId;
        await enterGame(gameId);
        toast('Suche Mitspieler …', 'ok');
      } catch (e) {
        if (tokenGateActive()) refundToken();
        toast(e.message || 'Fehler', 'err');
      }
    });
  };
  $('#act-solo').onclick = () => { if (hasSoloSave()) resumeSoloUI(); else toast('Kein pausiertes Solo-Spiel.', 'info'); };
  $('#resume-big').onclick = () => {
    if (localStorage.getItem(LS_GAME)) resumeOnline();
    else if (hasSoloSave()) resumeSoloUI();
    else toast('Kein pausiertes Spiel vorhanden.', 'info');
  };
  // Avatar in der Namensbox: zeigt das eigene Bild, Tipp führt ins Profil.
  const homeAv = $('#home-avatar');
  if (homeAv) {
    // Immer ein echtes Bild zeigen – ohne gespeichertes Profil den Standard-
    // Zauberer (kein Emoji-Platzhalter mehr).
    const av = localStorage.getItem('wizard_my_avatar') || DEFAULT_AV;
    if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(av)) homeAv.innerHTML = `<img src="${esc(avV(av))}" alt="">`;
    homeAv.onclick = () => switchPane('profil');
  }
  // Lobby-Modals: Schließen per ✕ oder Klick auf den Hintergrund.
  document.querySelectorAll('#pane-lobby .modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
    m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.hidden = true);
  });

  // Profil-Aktionen.
  $('#copy-code').onclick = () => {
    const code = $('#my-code').textContent.trim();
    if (!code || code.startsWith('·')) return;
    navigator.clipboard?.writeText(code).then(
      () => toast('Code kopiert: ' + code, 'ok'),
      () => toast('Code: ' + code)
    );
  };
  // Identitaet: Avatar-Werkzeuge auf/zu, Benutzername speichern.
  $('#avatar-current').onclick = () => {
    const t = $('#avatar-tools');
    t.hidden = !t.hidden;
  };
  const histBtn = $('#history-btn'); if (histBtn) histBtn.onclick = () => switchPane('spiele');
  const histBack = $('#hist-back'); if (histBack) histBack.onclick = () => switchPane('profil');
  $('#save-username').onclick = saveUsername;
  $('#username-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveUsername(); });
  $('#upload-avatar').onclick = () => $('#avatar-file').click();
  $('#avatar-file').onchange = onAvatarFile;

  // Gruppen.
  $('#create-group-btn').onclick = createGroupUI;
  $('#group-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') createGroupUI(); });
  const gmodal = document.getElementById('group-modal');
  $('#gm-close').onclick = () => { gmodal.hidden = true; };
  gmodal.addEventListener('click', e => { if (e.target === gmodal) gmodal.hidden = true; });

  $('#add-friend-btn').onclick = async () => {
    const inp = $('#friend-code-input');
    const code = inp.value.trim().toUpperCase();
    if (!code) { toast('Bitte Code eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    try {
      const fr = await m.addFriend(code);
      inp.value = '';
      toast((fr?.name || 'Freund:in') + ' hinzugefügt', 'ok');
      await loadProfilePane(m);
    } catch (e) { toast(e.message || 'Fehler', 'err'); }
  };

  // Solo: braucht WEDER Anmeldung NOCH Supabase. Neues Spiel kostet 1 Spielstein.
  $('#local-btn').onclick = () => {
    clearInterval(pollTimer); pollTimer = null;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const name = nameInput.value.trim() || 'Du';
    const bots = parseInt($('#bot-count').value, 10);
    const diff = $('#difficulty').value;
    const shortCards = parseInt($('#solo-length')?.value, 10) || null;
    closeLobbyModals();
    requireToken(() => startLocal(bots, name, diff, shortCards));
  };

  $('#create-btn').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    m.upsertProfile(name).catch(() => {});   // Profilname fuer die Freundesliste pflegen
    const max = parseInt($('#max-players').value, 10);
    const shortCards = parseInt($('#game-length')?.value, 10) || null;
    const turnSecs = parseInt($('#turn-seconds')?.value, 10) || 20;
    requireToken(async () => {
      try {
        const code = await m.createGame(name, max, shortCards, turnSecs);
        const gameId = await m.joinGame(code, name);   // eigene Spiel-ID holen
        tokenPaidFor = gameId;
        closeLobbyModals();
        await enterGame(gameId);
        toast('Spiel erstellt – Code: ' + code, 'ok');
      } catch (e) {
        if (tokenGateActive()) refundToken();
        toast(e.message || 'Fehler', 'err');
      }
    });
  };

  $('#join-btn').onclick = async () => {
    const name = nameInput.value.trim();
    const code = $('#code-input').value.trim().toUpperCase();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    if (!code) { toast('Bitte Code eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    m.upsertProfile(name).catch(() => {});   // Profilname fuer die Freundesliste pflegen
    requireToken(async () => {
      try {
        const gameId = await m.joinGame(code, name);
        tokenPaidFor = gameId;
        closeLobbyModals();
        await enterGame(gameId);
      } catch (e) {
        if (tokenGateActive()) refundToken();
        toast(e.message || 'Fehler', 'err');
      }
    });
  };

  // Startseite initial befüllen.
  refreshResume();
  loadHomeStats();
  updateNavAvatar();
}

// --- Tabs: Lobby / Spiele / Profil -----------------------------------------
function switchPane(name) {
  const panes = { lobby: 'pane-lobby', spiele: 'pane-spiele', profil: 'pane-profil',
                  freunde: 'pane-freunde', shop: 'pane-shop', rangliste: 'pane-rangliste' };
  Object.entries(panes).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', k === name);
  });
  // Passenden Tab aktiv markieren.
  const navForPane = { profil: 'profil', freunde: 'freunde', shop: 'shop', rangliste: 'rangliste', lobby: 'start' };
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.nav === navForPane[name]));
  window.scrollTo(0, 0);
  if (name === 'spiele') loadHistoryPane();
  else if (name === 'profil' || name === 'freunde') loadProfilePane();
  else if (name === 'rangliste') loadLeaderboard();
  else if (name === 'shop') loadShop();
  else if (name === 'lobby') { refreshResume(); loadHomeStats(); }
}

// Untere Navigationsleiste: Solo/Gegen/Neues Spiel sind Aktionen (öffnen das
// passende Fenster auf der Lobby), Freunde/Profil wechseln zur Profilseite.
function setActiveTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === el));
}
function handleNav(nav, el) {
  if (nav === 'profil') { switchPane('profil'); setActiveTab(el); return; }
  if (nav === 'freunde') { switchPane('freunde'); setActiveTab(el); return; }
  if (nav === 'shop') { switchPane('shop'); setActiveTab(el); return; }
  if (nav === 'rangliste') { switchPane('rangliste'); setActiveTab(el); return; }
  // "Neues Spiel" (start) führt zur Startseite – dort wählt man Solo/Online/Beitreten.
  switchPane('lobby'); setActiveTab(el);
}

// Globale Rangliste: alle Spieler nach gewonnenen Spielen, Bester oben.
async function loadLeaderboard() {
  const list = document.getElementById('rank-list');
  if (!list) return;
  list.innerHTML = '<p class="empty-note">Lädt…</p>';
  const m = await ensureOnline();
  if (!m) { offlineNote(list); return; }
  try {
    const rows = await m.leaderboard();
    if (!rows || !rows.length) {
      list.innerHTML = '<p class="empty-note">Noch keine abgeschlossenen Spiele.<br>Spielt eine Online-Partie zu Ende – dann erscheint ihr hier.</p>';
      return;
    }
    list.innerHTML = rows.map((r, i) => {
      const me = r.uid === state.uid;
      const av = r.avatar || DEFAULT_AV;
      const avHtml = isImg(av) ? `<img class="av-img" src="${esc(avV(av))}" alt="">` : esc(av);
      const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
      return `<div class="rank-row${me ? ' me' : ''}${i === 0 ? ' top' : ''}">
        <span class="rank-pos">${pos}</span>
        <span class="rank-av">${avHtml}</span>
        <span class="rank-name">${esc(r.name)}${me ? ' (Du)' : ''}<br><span class="rank-sub">${r.games} Spiele · ${r.points} Pkt.</span></span>
        <span class="rank-wins">${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'}</span>
      </div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<p class="empty-note">Rangliste konnte nicht geladen werden.</p>'; }
}

// Läuft die App nativ (Capacitor) oder im Browser/PWA?
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// Inhaber-Konten (z. B. Entwickler) bekommen alles freigeschaltet. Prüft die
// eingeloggte E-Mail und setzt/entfernt die Freischaltung; aktualisiert sichtbare
// Bereiche. Nur für Online-/eingeloggte Nutzer (lädt sonst Supabase nicht).
async function checkOwnerUnlock() {
  if (!localStorage.getItem('wizard_online')) return;
  let info;
  try { info = await (await db()).authInfo(); } catch (_) { return; }
  const owner = isOwnerEmail(info && info.email);
  if (owner === ownerUnlock()) { if (owner) setAdFree(true); return; }
  setOwnerUnlock(owner);
  if (owner) setAdFree(true);
  applyTableTheme();
  refreshAvatarPicker();
  updateNavAvatar();
  if (document.getElementById('pane-shop')?.classList.contains('active')) loadShop();
}
// Passende Erklärung, warum gerade nicht gekauft werden kann.
function iapUnavailableHint() {
  return isNativeApp()
    ? 'Käufe werden gerade vorbereitet (App-Store-Produkte noch nicht freigegeben) – hier siehst du die Vorschau.'
    : 'Käufe sind nur in der App möglich – hier siehst du die Vorschau.';
}

// Shop: Werbefrei + Magier-Bundle + Premium-Avatare. Echte Käufe per IAP nur in
// der nativen App; im Browser Vorschau + Hinweis (mit ?shop=dev zum Testen frei).
// Zuletzt geladenes Guthaben (fuer sofortiges Rendern der Kopfzeile).
let walletCache = { crystals: 0, gold: 0, inventory: [] };
// Zuletzt geladene ungeoeffnete Truhen (fuer den Truhen-Tab + Lobby-Badge).
let chestCache = [];
// Aktuell gewaehlte Shop-Kategorie (Tab-Filter statt aller Sektionen untereinander).
let shopCat = 'chests';
// Aktiver Seltenheits-Filter der Kategorie ('all' = alles zeigen).
let shopRar = 'all';
const nf = (n) => (n || 0).toLocaleString('de-DE');

async function loadShop() {
  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  checkOwnerUnlock();   // Inhaber-Konto ggf. freischalten (rendert danach neu)

  // Guthaben + Inventar + Truhen EINMAL laden (stellt leise die anonyme
  // Anmeldung sicher). Der Kategoriewechsel danach rendert nur neu.
  try {
    const m = await db(); await m.ensureAuth();
    const [w, ch] = await Promise.all([m.getWallet(), m.listChests().catch(() => [])]);
    walletCache = w; chestCache = ch || [];
    deriveDailySlots(walletCache.inventory);   // gekaufte Slot-Stufe spiegeln
  } catch (_) { walletCache = { crystals: 0, gold: 0, inventory: [] }; chestCache = []; }
  renderShop();
  refreshChestBadge();
}

// Rendert Kopf + NUR die aktive Kategorie (Tab-Filter). Wird bei jedem Tab-Wechsel
// erneut aufgerufen; nutzt das bereits geladene walletCache (kein Netz-Reload).
function renderShop() {
  const grid = document.getElementById('shop-grid');
  const hint = document.getElementById('shop-hint');
  if (!grid) return;
  const owned = new Set(walletCache.inventory || []);

  const canBuy = iapAvailable() || isDevUnlock() || ownerUnlock();
  if (hint) hint.textContent = canBuy ? '' : iapUnavailableHint();

  // Inhalt der aktiven Kategorie zusammenbauen. Jede Kategorie beginnt mit
  // einem mittigen Zier-Titel („✦ Kartendecks ✦" wie im Design-Mockup).
  const CAT_TITLES = {
    chests: 'Truhen', tokens: 'Notizblöcke',
    avatar: 'Avatare', deck: 'Kartendecks', table: 'Spielfelder',
    back: 'Kartenrückseiten', crystals: 'Kristalle', vorteile: 'Angebote',
  };
  const head = `<div class="sec-head">✦&nbsp;&nbsp;${esc(CAT_TITLES[shopCat] || '')}&nbsp;&nbsp;✦</div>`;
  let body;
  if (shopCat === 'chests') {
    body = head + chestPane();
  } else if (shopCat === 'tokens') {
    body = head + tokenPane(owned);
  } else if (shopCat === 'crystals') {
    body = head + crystalPacksRow();
  } else if (shopCat === 'vorteile') {
    body = head + `<div class="shop-feature">${shopFeatureCard(SHOP_ADFREE)}${shopFeatureCard(SHOP_BUNDLE)}</div>`;
  } else {
    const sec = SHOP_SECTIONS.find(s => s.key === shopCat);
    const all = sortItems(visibleItems(sec ? sec.items : []), owned);
    const items = shopRar === 'all' ? all : all.filter(it => it.rarity === shopRar);
    const gridHtml = items.length
      ? `<div class="shop-cat-grid">${items.map(it => shopCatalogTile(it, owned)).join('')}</div>`
      : `<p class="muted" style="text-align:center;margin:20px 0">Keine Artikel dieser Seltenheit.</p>`;
    body = head + rarityRow() + gridHtml;
  }

  grid.innerHTML = shopHeader() + `<div class="shop-body">${body}</div>`;

  // Kategorie-Tabs: Filter statt Scroll (Seltenheits-Filter dabei zuruecksetzen).
  grid.querySelectorAll('[data-cat]').forEach(b => {
    b.onclick = () => { shopCat = b.dataset.cat; shopRar = 'all'; renderShop(); };
  });
  // Seltenheits-Filterleiste.
  grid.querySelectorAll('[data-rarf]').forEach(b => {
    b.onclick = () => { shopRar = b.dataset.rarf; renderShop(); };
  });
  // Kauf-/Auswahl-Knöpfe verdrahten (unveraenderte Handler).
  grid.querySelectorAll('[data-buy]').forEach(b => { b.onclick = () => buyShopItem(b.dataset.buy); });
  grid.querySelectorAll('[data-cbuy]').forEach(b => { b.onclick = () => buyCurrencyItem(b.dataset.cbuy); });
  grid.querySelectorAll('[data-ctable]').forEach(b => { b.onclick = () => equipCatalogTable(b.dataset.ctable); });
  grid.querySelectorAll('[data-cdeck]').forEach(b => { b.onclick = () => equipCatalogDeck(b.dataset.cdeck); });
  grid.querySelectorAll('[data-cback]').forEach(b => { b.onclick = () => equipCatalogBack(b.dataset.cback); });
  grid.querySelectorAll('[data-cavatar]').forEach(b => { b.onclick = () => equipCatalogAvatar(b.dataset.cavatar); });
  // Kristall-Pakete: echter StoreKit-Kauf (Konsumierbar). Die Gutschrift kommt
  // asynchron ueber den onConsumable-Handler (Server, mit Transaktions-Dedupe).
  grid.querySelectorAll('[data-pack]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.pack;
      if (id === 'open') { shopCat = 'crystals'; renderShop(); return; }
      const pack = CRYSTAL_PACKS.find(p => p.id === id);
      if (!pack || !pack.productId) return;
      if (!iapAvailable()) { toast(iapUnavailableHint(), 'info'); return; }
      const r = await purchaseConsumable(pack.productId);
      if (!r.ok && !r.cancelled) {
        toast(r.error === 'no-product'
          ? 'Paket ist im App Store noch nicht freigegeben.'
          : 'Kauf fehlgeschlagen – bitte später erneut versuchen.', 'err');
      }
    };
  });
  // Notizblöcke: Paket kaufen / Video ansehen.
  grid.querySelectorAll('[data-tbuy]').forEach(b => { b.onclick = () => buyTokenPack(b.dataset.tbuy); });
  grid.querySelectorAll('[data-tokad]').forEach(b => { b.onclick = () => watchAdForToken(() => renderShop()); });
  // Truhen: tägliche holen / kaufen / öffnen.
  grid.querySelectorAll('[data-claimdaily]').forEach(b => { b.onclick = () => claimDailyFlow(); });
  grid.querySelectorAll('[data-buychest]').forEach(b => { b.onclick = () => buyChestFlow(b.dataset.buychest); });
  grid.querySelectorAll('[data-openchest]').forEach(b => {
    b.onclick = () => { const c = chestCache.find(x => x.id === b.dataset.openchest); if (c) openChestModal(c); };
  });

  const restore = document.getElementById('shop-restore');
  if (restore) {
    restore.hidden = false;
    restore.onclick = async () => {
      if (!iapAvailable()) { toast('Käufe sind nur in der iOS-App möglich.', 'info'); return; }
      restore.disabled = true;
      const r = await restorePurchases(); restore.disabled = false; loadShop();
      if (r.ok) { hideBanner(); toast('Käufe wiederhergestellt 🎉', 'ok'); }
      else toast('Keine früheren Käufe gefunden.', 'err');
    };
  }
}

// --- Zentrale Sortierung / Filter / Status --------------------------------
// Verbindliche Seltenheits-Reihenfolge (deutsche + englische Schluessel).
const RARITY_ORDER = {
  common: 0, gewöhnlich: 0, rare: 1, selten: 1, epic: 2, episch: 2,
  legendary: 3, legendär: 3, mythic: 4, mythisch: 4,
};
// Besitzt der Spieler den Artikel? (gratis/Standard/Inventar/Inhaber/Dev)
function itemHas(it, owned) {
  return it.free || it.isDefault || owned.has(it.id) || ownerUnlock() || isDevUnlock();
}
// Ist der Artikel gerade ausgeruestet/aktiv? (je Typ)
function itemActive(it) {
  if (it.kind === 'table')  return selectedCatalogTable() === it.id;
  if (it.kind === 'deck')   return selectedCatalogDeck() === it.id;
  if (it.kind === 'back')   return selectedCatalogBack() === it.id;
  if (it.kind === 'avatar') return myAvatar() === it.img;
  return false;
}
// Status-Rang: aktiv -> im Besitz -> kaufbar.
// Nur Produkte mit echtem Bild zeigen (bildlose Platzhalter ausblenden).
function visibleItems(items) { return items.filter(it => it.img || it.isDefault); }
// Zentrale Sortierung: Seltenheit -> Status -> Preis aufsteigend.
// FESTE Reihenfolge (Seltenheit, Preis, Name) - haengt bewusst NICHT vom
// Aktiv-/Besitz-Status ab, damit beim Auswaehlen nichts umherspringt.
function sortItems(items) {
  return [...items].sort((a, b) =>
    (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)
    || (a.cost || 0) - (b.cost || 0)
    || String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

// Kristall-Währungs-Icon (echtes Artwork statt blauem 💎-Emoji). Inline-Bild,
// per CSS-Klasse .cry an den jeweiligen Kontext angepasst.
const CRY = '<img class="cry" src="lobby/ic-crystal.png?v=1" alt="Kristalle">';

// Notizblock-Icon (Artwork des Users statt 📝-Emoji), Groesse per .note-ic.
const NOTE = '<img class="note-ic" src="lobby/ic-notizbuch.png?v=1" alt="Notizblock">';

// Shop-Kopf „Basar der Erzmagier": Banner-Artwork (Platzhalter-Gradient, bis
// lobby/shop-hero.jpg vorliegt) + echte dynamische Guthaben-Pillen + „+" +
// Kategorie-Navigation. Die Pillen zeigen das Server-Guthaben (nicht gefaked).
function shopHeader() {
  // Reihenfolge: Kosmetik zuerst, dann Kristalle + Angebote. "Zubehör" entfaellt
  // (keine Produkte); Kartenrueckseiten nutzen die vorhandene cat-title-Kachel.
  // 3. Element = Icon: PNG-Name (lobby/cat-*.png) ODER Emoji (fuer die neuen
  // Tabs, solange kein echtes Artwork vorliegt). Emoji werden per <span> gezeigt.
  const PNG_ICONS = ['avatar', 'deck', 'table', 'title', 'crystals', 'vorteile', 'chest', 'tokens'];
  const cats = [
    ['chests',   'Truhen',         'chest'],
    ['tokens',   'Notizblöcke',    'tokens'],
    ['avatar',   'Avatare',        'avatar'],
    ['deck',     'Kartendecks',    'deck'],
    ['table',    'Spielfelder',    'table'],
    ['back',     'Rückseiten',     'title'],
    ['crystals', 'Kristalle',      'crystals'],
    ['vorteile', 'Angebote',       'vorteile'],
  ];
  const catBtns = cats.map(([k, lbl, ic]) => {
    const inner = PNG_ICONS.includes(ic)
      ? `<img class="shopcat-ic" src="lobby/cat-${ic}.png?v=2" alt="" loading="lazy">`
      : `<span class="shopcat-emoji">${ic}</span>`;
    return `<button class="shopcat${shopCat === k ? ' active' : ''}" data-cat="${k}" type="button">
       <span class="shopcat-ring">${inner}</span>
       <span class="shopcat-lbl">${esc(lbl)}</span>
     </button>`;
  }).join('');
  return `<div class="basar">
      <div class="basar-top">
        <div class="basar-pills">
          <span class="bp"><span class="bp-ic">${CRY}</span><b>${nf(walletCache.crystals)}</b></span>
          <span class="bp"><span class="bp-ic">🪙</span><b>${nf(walletCache.gold)}</b></span>
          <button class="bp-plus" data-pack="open" type="button" aria-label="Kristalle kaufen">＋</button>
        </div>
        <span class="basar-crown"><img src="lobby/ic-crown.png?v=6" alt=""></span>
      </div>
      <div class="basar-shop"><span class="bs-star">✦</span>Shop<span class="bs-star">✦</span></div>
      <div class="basar-kicker">Willkommen im</div>
      <div class="basar-title">Basar der Erzmagier</div>
      <div class="basar-sub">Entdecke magische Gegenstände und passe dein Spielerlebnis an.</div>
    </div>
    <div class="shopcat-row">${catBtns}</div>`;
}

// Seltenheits-Filterleiste (Alle/Gewöhnlich/Selten/Episch/Legendär) – jede
// Pille traegt ihre Seltenheitsfarbe, die aktive ist gefuellt + leuchtet.
function rarityRow() {
  const opts = [
    ['all',       'Alle',                  '#b98cff'],
    ['common',    RARITY.common.label,     RARITY.common.color],
    ['rare',      RARITY.rare.label,       RARITY.rare.color],
    ['epic',      RARITY.epic.label,       RARITY.epic.color],
    ['legendary', RARITY.legendary.label,  RARITY.legendary.color],
  ];
  return `<div class="rar-row">${opts.map(([k, lbl, c]) =>
    `<button class="rar-pill${shopRar === k ? ' active' : ''}" data-rarf="${k}" style="--rc:${c}" type="button">${esc(lbl)}</button>`
  ).join('')}</div>`;
}

// Kristall-Pakete (Echtgeld – aktuell nur Anzeige, kommt mit der Store-Freigabe).
function crystalPacksRow() {
  const packs = CRYSTAL_PACKS.map(p => `
    <button class="pack-card${p.tag ? ' tagged' : ''}" data-pack="${esc(p.id)}" type="button">
      ${p.tag ? `<span class="pack-tag">${esc(p.tag)}</span>` : ''}
      ${p.img ? `<img class="pack-img" src="${esc(p.img)}?v=2" alt="" loading="lazy">` : ''}
      <div class="pack-amt">${CRY} ${nf(p.amount)}</div>
      ${p.bonus ? `<div class="pack-bonus">+${nf(p.bonus)} extra</div>` : '<div class="pack-bonus">&nbsp;</div>'}
      <div class="pack-price">${esc(p.priceEUR)}</div>
    </button>`).join('');
  return `<div class="pack-row">${packs}</div>`;
}

// Einzelne Kosmetik-Kachel mit Seltenheits-Rahmen (Platzhalter-Symbol).
// Aktuell gewaehltes Katalog-Spielfeld (fuer die „Aktiv"-Markierung).
function selectedCatalogTable() {
  return SHOP_SECTIONS.find(s => s.key === 'table')?.items
    .find(i => i.img && getTableBg() === i.img)?.id || '';
}
// Aktuell gewaehltes Katalog-Kartendeck (Standard = leerer Deck-Ordner).
function selectedCatalogDeck() {
  const cur = getCardDeck();
  const decks = SHOP_SECTIONS.find(s => s.key === 'deck')?.items || [];
  const hit = decks.find(i => i.folder && i.folder === cur);
  if (hit) return hit.id;
  const std = decks.find(i => i.isDefault);   // nichts gewaehlt -> Standard aktiv
  return std && !cur ? std.id : '';
}

// Aktuell gewaehlte Katalog-Rueckseite (Standard = kein Ruecken-Override).
function selectedCatalogBack() {
  const cur = getCardBack();
  const backs = SHOP_SECTIONS.find(s => s.key === 'back')?.items || [];
  const hit = backs.find(i => i.folder && i.folder === cur);
  if (hit) return hit.id;
  const std = backs.find(i => i.isDefault);
  return std && !cur ? std.id : '';
}

// data-Attribut fuer den Auswaehlen-Button je Produkttyp (dieselben Handler wie bisher).
const EQUIP_ATTR = { table: 'ctable', deck: 'cdeck', back: 'cback', avatar: 'cavatar' };

function shopCatalogTile(it, owned) {
  const has = itemHas(it, owned);
  const active = itemActive(it);
  const r = RARITY[it.rarity] || RARITY.common;
  const cur = it.currency === 'gold' ? '🪙' : CRY;

  // Statuszeile + Aktionsbutton klar getrennt:
  //  - kaufbar: Preis-Button; im Besitz: grüner Hinweis (+ ggf. Auswählen); aktiv: ✓ Aktiv.
  let state = '', btn = '';
  const equip = EQUIP_ATTR[it.kind];
  // Preis ist IMMER sichtbar - auch bei Besitz (kleiner, gedaempft).
  const price = `<span class="tile-price${has ? ' mini' : ''}">${cur} ${nf(it.cost)}</span>`;
  if (!has) {
    // Wie im Design-Mockup: Preiszeile (Kristall-Icon + Betrag) UEBER dem Knopf.
    state = price;
    btn = `<button class="tile-buy" data-cbuy="${esc(it.id)}" type="button">Kaufen</button>`;
  } else if (active) {
    state = `${price}<span class="tile-state active">✓ Aktiv</span>`;
  } else if (equip) {
    // Im Besitz, aber nicht aktiv: Besitz-Hinweis + Auswählen-Knopf.
    state = `${price}<span class="tile-state owned">✓ Im Besitz</span>`;
    btn = `<button class="tile-buy" data-${equip}="${esc(it.id)}" type="button">Auswählen</button>`;
  } else {
    state = `${price}<span class="tile-state owned">✓ Im Besitz</span>`;
  }

  const thumb = `<img class="cat-img" src="${esc(it.img)}?v=7" alt="" loading="lazy">`;
  return `<div class="cat-tile${active ? ' is-active' : ''}" data-kind="${esc(it.kind)}" data-rar="${esc(it.rarity)}" style="--r:${r.color}">
    <div class="cat-thumb">${thumb}</div>
    <div class="cat-name">${esc(it.name)}</div>
    <div class="cat-rarity">${r.label}</div>
    <div class="tile-foot">${state}${btn}</div>
  </div>`;
}

// Kauf mit Kristallen/Gold (serverseitig geprueft).
async function buyCurrencyItem(itemId) {
  let m;
  try { m = await db(); await m.ensureAuth(); } catch (_) { toast('Käufe nur online möglich.', 'err'); return; }
  try {
    const r = await m.buyItem(itemId);
    if (r.ok && r.message === 'Gekauft') toast('Gekauft! 🎉', 'ok');
    else if (r.message === 'Bereits im Besitz') toast('Schon im Besitz.', 'info');
    else toast(r.message || 'Kauf nicht möglich', 'err');
    walletCache = { crystals: r.crystals ?? walletCache.crystals, gold: r.gold ?? walletCache.gold, inventory: walletCache.inventory };
    loadShop();
  } catch (e) { toast('Kauf fehlgeschlagen.', 'err'); }
}

// --- Notizblöcke: Shop-Pane -------------------------------------------------
function tokenPane(owned) {
  const cur = getDailySlots();
  const status = `<div class="tok-shopstatus">Aktuell: <b>${getTokens()}</b> Notizblöcke · <b>${cur}</b>/Tag gratis</div>`;
  const slotTiles = SLOT_TIERS.map(t => {
    const r = RARITY[t.rarity] || RARITY.common;
    const active = t.slots === cur;
    const has = t.free || owned.has(t.id) || ownerUnlock() || isDevUnlock();
    let foot;
    const slotPrice = t.free ? '' : `<span class="tile-price${has ? ' mini' : ''}">${CRY} ${nf(t.cost)}</span>`;
    if (active) foot = `${slotPrice}<span class="tile-state active">✓ Aktiv</span>`;
    else if (has) foot = `${slotPrice}<span class="tile-state owned">✓ Im Besitz</span>`;
    else foot = slotPrice
      + `<button class="tile-buy" data-cbuy="${esc(t.id)}" type="button">Kaufen</button>`;
    return `<div class="cat-tile${active ? ' is-active' : ''}" data-rar="${t.rarity}" style="--r:${r.color}">
      <div class="slot-badge">${NOTE}×${t.slots}</div>
      <div class="cat-name">${t.slots} pro Tag</div>
      <div class="cat-rarity">${r.label}</div>
      <div class="tile-foot">${foot}</div>
    </div>`;
  }).join('');
  const packTiles = TOKEN_PACKS.map(p => {
    const r = RARITY[p.rarity] || RARITY.common;
    return `<button class="pack-card${p.tag ? ' tagged' : ''}" data-tbuy="${esc(p.id)}" type="button" style="--r:${r.color}">
      ${p.tag ? `<span class="pack-tag">${esc(p.tag)}</span>` : ''}
      <div class="pack-emoji">${NOTE}</div>
      <div class="pack-amt">${p.qty}× Notizblock</div>
      <div class="pack-price">${CRY} ${nf(p.cost)}</div>
    </button>`;
  }).join('');
  const vid = tokenGateActive()
    ? `<button class="btn sekundaer" data-tokad="1" type="button" style="width:100%;margin-top:8px">🎬 2 Videos ansehen → 1 Notizblock</button>`
    : '';
  return status
    + `<div class="tok-subhead">Slots · dauerhaft mehr pro Tag</div>`
    + `<div class="shop-cat-grid">${slotTiles}</div>`
    + `<div class="tok-subhead">Notizblöcke nachkaufen</div>`
    + `<div class="pack-row">${packTiles}</div>`
    + vid;
}

async function buyTokenPack(packId) {
  let m;
  try { m = await db(); await m.ensureAuth(); } catch (_) { toast('Käufe nur online möglich.', 'err'); return; }
  try {
    const r = await m.buyTokens(packId);
    if (r.ok) { grantTokens(r.granted || 0); toast(`+${r.granted} Notizblöcke 🎉`, 'ok'); }
    else toast(r.message || 'Kauf nicht möglich', 'err');
    walletCache = { crystals: r.crystals ?? walletCache.crystals, gold: r.gold ?? walletCache.gold, inventory: walletCache.inventory };
    renderShop();
  } catch (_) { toast('Kauf fehlgeschlagen.', 'err'); }
}

// --- Truhen: Shop-Pane ------------------------------------------------------
function findCatalogItem(id) {
  for (const s of SHOP_SECTIONS) { const it = s.items.find(i => i.id === id); if (it) return it; }
  return null;
}
function chestTile(c) {
  const m = CHEST_META[c.rarity] || {};
  const src = c.source === 'game' ? 'aus einem Spiel' : c.source === 'daily' ? 'Tagestruhe' : 'gekauft';
  return `<button class="chest-tile" data-openchest="${esc(c.id)}" type="button" style="--r:${m.color || '#888'}">
    <img class="chest-img" src="lobby/chest-${esc(c.rarity)}.png?v=2" alt="" loading="lazy">
    <span class="chest-lbl">${esc(m.label || c.rarity)}</span>
    <span class="chest-sub">${src}</span>
    <span class="chest-open">Öffnen</span>
  </button>`;
}
function chestPane() {
  const daily = `<button class="btn" data-claimdaily="1" type="button" style="width:100%">🎁 Tägliche Gratis-Truhe holen</button>`;
  const list = chestCache.length
    ? `<div class="chest-grid">${chestCache.map(chestTile).join('')}</div>`
    : `<p class="muted" style="text-align:center;margin:14px 0">Noch keine Truhen. Hol die Tagestruhe oder spiel eine Online-Runde!</p>`;
  const buy = CHEST_TIERS.map(t => `
    <button class="chest-buy" data-buychest="${t.rarity}" type="button" style="--r:${t.color}">
      <img class="chest-img sm" src="lobby/chest-${t.rarity}.png?v=2" alt="" loading="lazy">
      <span class="chest-lbl">${esc(t.label)}</span>
      <span class="chest-cost">${CRY} ${nf(t.price)}</span>
    </button>`).join('');
  return `<div class="tok-shopstatus">Öffne Truhen für Kristalle – mit Glück ist auch neue Kosmetik drin!</div>
    ${daily}
    <div class="tok-subhead">Deine Truhen</div>${list}
    <div class="tok-subhead">Truhe kaufen</div><div class="chest-buyrow">${buy}</div>`;
}

async function refreshChestList() {
  try { const m = await db(); await m.ensureAuth(); chestCache = await m.listChests() || []; }
  catch (_) {}
  refreshChestBadge();
}
function refreshChestBadge() {
  const tab = document.querySelector('.tab[data-nav="shop"]');
  if (!tab) return;
  let b = tab.querySelector('.chest-badge');
  const n = chestCache.length;
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'chest-badge'; tab.appendChild(b); }
    b.textContent = n > 9 ? '9+' : String(n);
  } else if (b) { b.remove(); }
}

async function claimDailyFlow() {
  let m;
  try { m = await db(); await m.ensureAuth(); } catch (_) { toast('Nur online möglich.', 'err'); return; }
  try {
    const r = await m.claimDailyChest();
    if (r.ok) { await refreshChestList(); renderShop(); toast('Tägliche Truhe erhalten! 🎁', 'ok'); }
    else toast(r.message || 'Nicht möglich', 'info');
  } catch (_) { toast('Fehler.', 'err'); }
}

async function buyChestFlow(rarity) {
  let m;
  try { m = await db(); await m.ensureAuth(); } catch (_) { toast('Nur online möglich.', 'err'); return; }
  try {
    const r = await m.buyChest(rarity);
    if (r.ok) { walletCache.crystals = r.crystals ?? walletCache.crystals; await refreshChestList(); renderShop(); toast('Truhe gekauft! 🎁', 'ok'); }
    else toast(r.message || 'Kauf nicht möglich', 'err');
  } catch (_) { toast('Kauf fehlgeschlagen.', 'err'); }
}

// Truhen-Öffnen mit Spannungs-Animation + Reveal (Kristalle + evtl. Item):
// eskalierendes Wackeln -> Lichtblitz + rotierende Strahlen + Funkenflug ->
// hochzaehlender Kristall-Zaehler, danach ggf. Item-Enthuellung.
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Funken/Kristalle aus der Truhenmitte in zufaellige Richtungen fliegen lassen.
function spawnChestParticles(stage, count) {
  if (REDUCED_MOTION || !stage) return;
  const glyphs = ['✨', '💎', '⭐', '🪙'];
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'chest-part';
    s.textContent = glyphs[i % glyphs.length];
    const ang = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 110;
    s.style.setProperty('--tx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--ty', Math.sin(ang) * dist - 30 + 'px');   // leicht nach oben
    s.style.setProperty('--rot', (Math.random() * 240 - 120) + 'deg');
    s.style.setProperty('--dur', (700 + Math.random() * 600) + 'ms');
    s.style.animationDelay = (Math.random() * 180) + 'ms';
    stage.appendChild(s);
    setTimeout(() => s.remove(), 1600);
  }
}

// Zaehler von 0 auf den Gewinn hochlaufen lassen (ease-out).
function countUpCrystals(el, target) {
  if (REDUCED_MOTION || target <= 0) { el.textContent = nf(target); return; }
  const dur = Math.min(1400, 500 + target * 4);
  const t0 = performance.now();
  (function tick() {
    const p = Math.min(1, (performance.now() - t0) / dur);
    el.textContent = nf(Math.round(target * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  })();
}

// Gestufte Loot-Visuals fuer Kristall-/Gold-Drops: je mehr, desto praechtiger.
//   Stufe 1 (<20): 1 offener Beutel      Stufe 2 (<50): 2 Beutel nebeneinander
//   Stufe 3 (<90): Truhe, wenig Inhalt   Stufe 4 (<150): gut gefuellte Truhe
//   Stufe 5 (ab 150): EPISCH - platzende Truhe + Legendaer-Animation
const LOOT_IMG_V = 2;   // v2 = echte OpenAI-Bilder statt Platzhalter
function lootTier(n) { return n < 20 ? 1 : n < 50 ? 2 : n < 90 ? 3 : n < 150 ? 4 : 5; }
function lootVisHtml(kind, n) {
  const t = lootTier(n);
  if (kind !== 'gold') {
    // Kristalle: 5 eigene Stufenbilder des Users (loot-kri-1..5, freigestellt)
    const img = `<img class="loot-img" src="lobby/loot-kri-${t}.png?v=${LOOT_IMG_V}" alt="" onerror="this.remove()">`;
    return `<div class="loot-vis kv k${t}">${t === 5 ? '<span class="loot-rays" aria-hidden="true"></span>' : ''}${img}</div>`;
  }
  const img = (f) => `<img class="loot-img" src="lobby/${f}-gold.png?v=${LOOT_IMG_V}" alt="" onerror="this.remove()">`;
  if (t === 1) return `<div class="loot-vis t1">${img('loot-beutel')}</div>`;
  if (t === 2) return `<div class="loot-vis t2">${img('loot-beutel')}${img('loot-beutel')}</div>`;
  if (t === 3) return `<div class="loot-vis t3">${img('loot-truhe-klein')}</div>`;
  if (t === 4) return `<div class="loot-vis t4">${img('loot-truhe-voll')}</div>`;
  return `<div class="loot-vis t5"><span class="loot-rays" aria-hidden="true"></span>${img('loot-truhe-episch')}</div>`;
}

// HTML fuer einen einzelnen Drop (Kristalle / Gold-Muenzen / Item).
function chestDropHtml(d) {
  if (d.t === 'item') {
    const it = findCatalogItem(d.item_id);
    return `<div class="drop-big item">
      <span class="drop-new">✨ NEU</span>
      ${it?.img ? `<img class="reveal-item-img" src="${esc(it.img)}?v=7" alt="">` : ''}
      <b>${esc(it?.name || d.item_id)}</b>
    </div>`;
  }
  const n = d.n | 0;
  const icon = d.t === 'gold' ? '🪙' : CRY;
  return `<div class="drop-big ${d.t === 'gold' ? 'goldc' : 'crystals'} loot">
    ${lootVisHtml(d.t, n)}
    <span class="loot-amt">${icon} +<b class="drop-n">0</b></span>
  </div>`;
}

// Legendaer-Explosion: Kristalle/Muenzen fliegen aus der Truhe ueber den
// GANZEN Bildschirm (in alle Ecken), in zwei Wellen.
function spawnLootBurst(stage, kind, count) {
  if (REDUCED_MOTION || !stage) return;
  const w = stage.clientWidth || 400, h = stage.clientHeight || 700;
  const bit = kind === 'gold' ? 'loot-muenze' : 'loot-kristall';
  const mk = () => {
    const s = document.createElement('span');
    s.className = 'loot-burst';
    s.innerHTML = `<img src="lobby/${bit}.png?v=${LOOT_IMG_V}" alt="">`;
    const ang = Math.random() * Math.PI * 2;
    const dist = 0.35 + Math.random() * 0.65;   // bis in die Ecken
    s.style.setProperty('--tx', Math.cos(ang) * w * 0.62 * dist + 'px');
    s.style.setProperty('--ty', (Math.sin(ang) * h * 0.45 - h * 0.22) * dist + 'px');
    s.style.setProperty('--rot', (Math.random() * 520 - 260) + 'deg');
    s.style.setProperty('--dur', (900 + Math.random() * 700) + 'ms');
    stage.appendChild(s);
    setTimeout(() => s.remove(), 1800);
  };
  for (let i = 0; i < count; i++) mk();
  setTimeout(() => { for (let i = 0; i < Math.floor(count * 0.6); i++) mk(); }, 260);
}

// Aufsteigende Ambient-Funken waehrend der Aufladephase.
function spawnRiseParticle(stage) {
  if (REDUCED_MOTION || !stage) return;
  const s = document.createElement('span');
  s.className = 'chest-rise';
  s.textContent = Math.random() < 0.5 ? '✨' : '·';
  s.style.left = (18 + Math.random() * 64) + '%';
  s.style.setProperty('--rx', (Math.random() * 30 - 15) + 'px');
  stage.appendChild(s);
  setTimeout(() => s.remove(), 1500);
}

const wait = (ms) => new Promise(res => setTimeout(res, ms));

// Truhen-Erlebnis: KEIN Knopf mehr – nur Tippen.
//   Tipp 1..3: Truhe DREHT sich (rotateY); dabei kleine Server-Chance, dass sie
//              zu einer besseren Truhe wird (Blitz + Artwork-Wechsel).
//   Nach dem 3. Tipp: Sprung, Aufprall, Bildschirmblitz, Deckel-Frames der
//   JEWEILIGEN Truhen-Sorte (chest-anim-<rarity>-4/5), dann Ruhebild (Frame 8);
//   Belohnungen springen einzeln heraus, Tipp holt die naechste.
const CHEST_FRAME = (r, n) => `lobby/chest-anim-${r}-${n}.png?v=1`;
const RARITY_CHAIN = ['holz', 'silber', 'gold', 'diamant'];

// Echte 3D-Truhe (Three.js, aus dem Truhen-Repo des Users). Wird erst beim
// ersten Truhen-Oeffnen nachgeladen (~600 KB), danach gecacht. Schlaegt das
// Laden fehl oder gibt es kein WebGL, laeuft der Bild-Frame-Fallback.
let chest3dLoad = null;
const add3dScript = (src) => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = rej;
  document.head.appendChild(s);
});
function loadChest3D() {
  if (chest3dLoad) return chest3dLoad;
  chest3dLoad = (async () => {
    await add3dScript('3d/three.min.js?v=1');
    await Promise.all([
      add3dScript('3d/RoomEnvironment.js?v=1'),
      add3dScript('3d/RoundedBoxGeometry.js?v=1'),
      add3dScript('3d/chest-model.js?v=1'),
      add3dScript('3d/GLTFLoader.js?v=1'),
    ]);
    await add3dScript('3d/chest-scene.js?v=8');
    return !!window.WizChest3D;
  })().catch(() => { chest3dLoad = null; return false; });
  return chest3dLoad;
}
// KI-Truhen des Users (Meshy, Base64-GLB in window.__CHESTS): je ~3,5 MB -
// deshalb wird NUR das Modell der jeweiligen Seltenheit geladen (nicht alle
// vier). Schlaegt ein Register fehl, laeuft die Stufe handgebaut weiter.
const CHEST_MODEL_SRC = {
  blau: '3d/chest-blau.js?v=1', silber: '3d/chest-silber.js?v=1',
  holz: '3d/chest-holz.js?v=1', gold: '3d/chest-gold.js?v=1',
};
const CHEST_MODEL_BY_RARITY = { diamant: 'blau', silber: 'silber', holz: 'holz', gold: 'gold' };
const chestModelLoads = {};
function loadChestModel(rarity) {
  const id = CHEST_MODEL_BY_RARITY[rarity];
  if (!id || (window.__CHESTS && window.__CHESTS[id])) return Promise.resolve();
  chestModelLoads[id] ||= add3dScript(CHEST_MODEL_SRC[id]).catch(() => {});
  return chestModelLoads[id];
}

async function openChestModal(chest) {
  let rarity = chest.rarity;
  const metaOf = (r) => CHEST_META[r] || {};
  document.getElementById('chest-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'modal'; wrap.id = 'chest-modal';
  wrap.innerHTML = `
    <div class="modal-card chest-card" style="--r:${metaOf(rarity).color || '#888'}">
      <div class="chest-anim">
        <div class="chest-stage">
          <div class="chest-rays" aria-hidden="true"></div>
          <div class="chest-beam" aria-hidden="true"></div>
          <div class="chest-flash" aria-hidden="true"></div>
          <div class="chest-shockwave" aria-hidden="true"></div>
          <div class="chest-ground" aria-hidden="true" hidden></div>
          <div class="chest-3d" id="chest-3d" hidden></div>
          <img class="chest-big-img" id="chest-anim-img" src="${CHEST_FRAME(rarity, 1)}" alt="" hidden>
          <div class="chest-sheen" aria-hidden="true"></div>
        </div>
      </div>
      <div id="chest-collect" class="chest-collect" aria-live="polite"></div>
      <div id="chest-upcap" class="chest-upcap" hidden>✨ Verbessert!</div>
      <h2 id="chest-title">${esc(metaOf(rarity).label || 'Truhe')}</h2>
      <div id="chest-reveal" class="chest-reveal"></div>
      <div id="chest-hint" class="drop-hint">👆 Tippen zum Drehen!</div>
      <div class="chest-whiteflash" aria-hidden="true"></div>
    </div>`;
  document.body.appendChild(wrap);
  const card = wrap.querySelector('.chest-card');
  const anim = wrap.querySelector('.chest-anim');
  const stage = wrap.querySelector('.chest-stage');
  const animImg = wrap.querySelector('#chest-anim-img');
  const beam = wrap.querySelector('.chest-beam');
  const shock = wrap.querySelector('.chest-shockwave');
  const flash = wrap.querySelector('.chest-flash');
  const whiteflash = wrap.querySelector('.chest-whiteflash');
  const titleEl = wrap.querySelector('#chest-title');
  const upcap = wrap.querySelector('#chest-upcap');
  const reveal = wrap.querySelector('#chest-reveal');
  const hintEl = wrap.querySelector('#chest-hint');
  let three = null;   // 3D-Szene (null = Bild-Frame-Fallback)
  const done = () => { try { three?.dispose(); } catch (_) {} wrap.remove(); };

  // Echte 3D-Truhe laden und einwechseln. Das 2D-Bild startet VERSTECKT und
  // erscheint nur, wenn 3D wirklich nicht verfuegbar ist (kein Aufblitzen mehr).
  const showFallbackArt = () => {
    animImg.hidden = false;
    wrap.querySelector('.chest-ground').hidden = false;
  };
  if (REDUCED_MOTION) {
    showFallbackArt();
  } else {
    loadChest3D().then(async ok => {
      if (!document.body.contains(wrap) || three) return;
      if (ok) await loadChestModel(rarity);   // nur das benoetigte Modell (~3,5 MB)
      if (!document.body.contains(wrap) || three) return;
      const holder = wrap.querySelector('#chest-3d');
      if (ok) {
        try { three = window.WizChest3D.create(holder, rarity); } catch (_) { three = null; }
      }
      if (three) {
        holder.hidden = false;
        stage.classList.add('three');
      } else {
        showFallbackArt();
      }
    }).catch(showFallbackArt);
  }

  // Frames vorladen: aktuelle Sorte komplett + Frame 1 aller besseren Sorten
  // (fuer den Upgrade-Wechsel mitten in der Drehung).
  for (let n = 1; n <= 8; n++) { const i = new Image(); i.src = CHEST_FRAME(rarity, n); }
  RARITY_CHAIN.slice(RARITY_CHAIN.indexOf(rarity) + 1).forEach(r => {
    [1, 4, 5, 8].forEach(n => { const i = new Image(); i.src = CHEST_FRAME(r, n); });
  });

  const SPINS_NEEDED = 3;
  let spins = 0, phase = 'spin', busy = false, m = null;
  let drops = [], idx = 0, finishing = null;

  const applyRarity = (r) => {
    rarity = r;
    card.style.setProperty('--r', metaOf(r).color || '#888');
    titleEl.textContent = metaOf(r).label || 'Truhe';
    // Upgrade-Modell bei Bedarf nachladen; bis dahin zeigt die Szene die
    // handgebaute Truhe in der neuen Farbe (chest-scene faengt das ab).
    loadChestModel(r).then(() => { try { three?.setRarity(r); } catch (_) {} });
  };

  // Gesammelte Belohnungen unter der Truhe: MINI-Ausgaben derselben Karten,
  // die oben herauskommen (gleiches Bild, gleicher Kartenrahmen).
  const collectEl = wrap.querySelector('#chest-collect');
  const chestChipHtml = (d) => {
    if (d.t === 'item') {
      const it = findCatalogItem(d.item_id);
      return `<span class="cchip item">
        ${it?.img ? `<img class="cc-img" src="${esc(it.img)}?v=7" alt="">` : '<span class="cc-emo">✨</span>'}
        <span class="cc-amt">${esc(it?.name || d.item_id)}</span></span>`;
    }
    const n = d.n | 0, t = lootTier(n);
    const img = d.t === 'gold'
      ? `lobby/loot-${t <= 2 ? 'beutel' : t === 3 ? 'truhe-klein' : t === 4 ? 'truhe-voll' : 'truhe-episch'}-gold.png?v=${LOOT_IMG_V}`
      : `lobby/loot-kri-${t}.png?v=${LOOT_IMG_V}`;
    return `<span class="cchip"><img class="cc-img" src="${img}" alt="">
      <span class="cc-amt">${d.t === 'gold' ? '🪙' : CRY} +${nf(n)}</span></span>`;
  };
  const addCollectChip = (d) => {
    collectEl.insertAdjacentHTML('beforeend', chestChipHtml(d));
    const c = collectEl.lastElementChild;
    requestAnimationFrame(() => c.classList.add('in'));
  };

  // --- Tipp-Phase 1: Drehen (mit kleiner Upgrade-Chance, serverseitig) -------
  const doSpin = async () => {
    busy = true;
    spins++;
    if (three) { three.spin(); }
    else { anim.classList.remove('spin'); void animImg.offsetWidth; anim.classList.add('spin'); }
    sfxChestRumble(); haptic?.(15);
    if (!three) spawnChestParticles(stage, 4);
    let up = null;
    try {
      if (!m) { m = await db(); await m.ensureAuth(); }
      [up] = await Promise.all([
        m.spinChest(chest.id).catch(() => null),
        REDUCED_MOTION ? Promise.resolve() : wait(380),   // Mitte der Drehung
      ]);
    } catch (_) {}
    if (up?.ok && up.upgraded && up.rarity) {
      // Upgrade! Mitten in der Drehung Blitz + bessere Truhe einwechseln.
      whiteflash.classList.remove('go'); void whiteflash.offsetWidth; whiteflash.classList.add('go');
      applyRarity(up.rarity);
      if (!three) animImg.src = CHEST_FRAME(rarity, Math.min(1 + spins, 3));
      for (let n = 1; n <= 8; n++) { const i = new Image(); i.src = CHEST_FRAME(rarity, n); }
      upcap.textContent = `✨ Zu ${metaOf(rarity).label || 'besserer Truhe'} verbessert!`;
      upcap.hidden = false;
      setTimeout(() => { upcap.hidden = true; }, 1800);
      sfxItemReveal(); confetti(1600); haptic?.([30, 40, 80]);
    } else {
      if (up?.ok && up.rarity) applyRarity(up.rarity);
      // Glow waechst mit jeder Drehung (Frame 2, dann 3 – nur Bild-Fallback).
      if (!three) animImg.src = CHEST_FRAME(rarity, Math.min(1 + spins, 3));
    }
    if (!REDUCED_MOTION) await wait(430);   // Drehung zu Ende
    anim.classList.remove('spin');
    if (spins >= SPINS_NEEDED) { phase = 'opening'; await startOpening(); }
    busy = false;
  };

  // --- Oeffnung: Sprung + Blitz + Deckel-Frames der eigenen Sorte ------------
  const startOpening = async () => {
    hintEl.hidden = true;
    if (!m) {
      try { m = await db(); await m.ensureAuth(); }
      catch (_) { toast('Nur online möglich.', 'err'); done(); return; }
    }
    const rp = m.openChest(chest.id).catch(() => ({ ok: false, rewards: [] }));
    if (three) {
      // 3D: Truhe wackelt heftig, waehrend der Server wuerfelt.
      three.shake(600); sfxChestRumble();
      if (!REDUCED_MOTION) await wait(600);
    } else if (!REDUCED_MOTION) {
      anim.classList.add('shake2');
      sfxChestRumble();
      await wait(500);
      anim.classList.remove('shake2');
      anim.classList.add('jump');
      await wait(280);
      anim.classList.remove('jump'); anim.classList.add('land');
      shock.classList.add('go');
      card.classList.add('quake');
      spawnChestParticles(stage, 10);
      sfxChestImpact();
      haptic?.([20, 30, 60]);
      await wait(300);
      card.classList.remove('quake');
    }
    const r = await rp;
    if (!r.ok) { toast(r.message || 'Fehler beim Öffnen', 'err'); done(); return; }
    if (r.rarity) applyRarity(r.rarity);   // Server ist die Wahrheit

    whiteflash.classList.remove('go'); void whiteflash.offsetWidth; whiteflash.classList.add('go');
    sfxChestOpen();
    haptic?.([30, 40, 30, 40, 120]);
    if (three) {
      // Echtes 3D-Oeffnen: Anticipation, Deckel mit Overshoot, Lichtsaeule,
      // Funken-Burst, Muenzen mit Bounce-Physik, Kamera-Punch (~1,6s).
      await three.open();
    } else {
      anim.classList.add('open-frames');
      if (!REDUCED_MOTION) {
        for (const f of [4, 5]) { animImg.src = CHEST_FRAME(rarity, f); await wait(130); }
      }
      animImg.src = CHEST_FRAME(rarity, 8);   // offene, ruhige Truhe
      anim.classList.add('burst');
      beam.classList.add('go');
    }
    if (!three) spawnChestParticles(stage, rarity === 'diamant' ? 26 : rarity === 'gold' ? 20 : 14);
    confetti(rarity === 'diamant' ? 3600 : 2200);
    walletCache.crystals = r.new_crystals ?? walletCache.crystals;
    walletCache.gold = r.new_gold ?? walletCache.gold;
    chestCache = chestCache.filter(c => c.id !== chest.id);
    refreshChestBadge();

    drops = Array.isArray(r.rewards) ? r.rewards : [];
    const gotItem = drops.some(d => d.t === 'item');
    // Ab jetzt bleibt es unter der Truhe CLEAN: nur die Sammel-Chips.
    titleEl.hidden = true;
    reveal.hidden = true;
    finishing = async () => {
      phase = 'done';
      hintEl.textContent = '👆 Tippen zum Schließen';
      hintEl.hidden = false;
      if (gotItem) { try { walletCache = await m.getWallet(); } catch (_) {} }
      renderShop();
    };
    if (!drops.length) { finishing(); return; }
    hintEl.textContent = '👆 Tippen zum Aufdecken';
    hintEl.hidden = false;
    phase = 'drops';
    if (!REDUCED_MOTION) await wait(350);
    await revealDrop();
  };

  // --- Belohnung springt aus der Truhe (wie gehabt) ---------------------------
  const revealDrop = async () => {
    if (idx >= drops.length) return;
    busy = true;
    const d = drops[idx];
    const isItem = d.t === 'item';
    const tier = isItem ? 0 : lootTier(d.n | 0);
    const big = isItem || tier >= 4;   // grosse Funde bekommen die Item-Dramaturgie
    // Aktuellen Drop nach unten in die Sammel-Reihe wandern lassen.
    const prev = stage.querySelector('.drop-float');
    if (prev) {
      if (!REDUCED_MOTION) { prev.classList.add('fly-down'); await wait(260); }
      prev.remove();
      if (idx > 0) addCollectChip(drops[idx - 1]);
    }
    if (big && !REDUCED_MOTION) {
      anim.classList.add('shake2');
      sfxChestRumble();
      spawnChestParticles(stage, 8);
      await wait(tier === 5 ? 750 : 550);
      anim.classList.remove('shake2');
    }
    // Erst fliegt nur eine ZAUBERKUGEL heraus (man sieht nicht, was drin ist),
    // dann zerplatzt sie und die Belohnungs-KARTE klappt auf.
    stage.insertAdjacentHTML('beforeend',
      `<div class="drop-float orb${isItem ? ' item-f' : ' loot-f'}">
         <div class="drop-card">${chestDropHtml(d)}</div>
         <span class="drop-orb" aria-hidden="true"></span>
       </div>`);
    const fl = stage.querySelector('.drop-float');
    spawnChestParticles(stage, big ? 12 : 6);
    if (!REDUCED_MOTION) await wait(big ? 950 : 720);
    flash.classList.remove('re'); void flash.offsetWidth; flash.classList.add('re');
    fl.classList.remove('orb');
    fl.classList.add('hover');
    if (d.t === 'crystals' || d.t === 'gold') {
      sfxDropReveal();
      countUpCrystals(fl.querySelector('.drop-n'), d.n | 0);
      if (tier === 5) {
        // EPISCH: Blitz, Beben, Legendaer-Banner, Loot platzt in alle Ecken.
        whiteflash.classList.remove('go'); void whiteflash.offsetWidth; whiteflash.classList.add('go');
        card.classList.add('quake');
        setTimeout(() => card.classList.remove('quake'), 350);
        sfxChestOpen(); sfxItemReveal();
        spawnLootBurst(stage, d.t, 26);
        const lg = document.createElement('div');
        lg.className = 'chest-legend';
        lg.innerHTML = '⚡ LEGENDÄRER FUND! ⚡';
        card.appendChild(lg);
        setTimeout(() => lg.remove(), 2700);
        confetti(4200);
      }
    }
    else { sfxItemReveal(); confetti(1800); }
    haptic?.(tier === 5 ? [40, 60, 40, 60, 160] : isItem ? [30, 40, 80] : 18);
    idx++;
    if (idx >= drops.length) {
      hintEl.hidden = true;
      if (!REDUCED_MOTION) await wait(1100);
      const last = stage.querySelector('.drop-float');
      if (last) {
        if (!REDUCED_MOTION) { last.classList.add('fly-down'); await wait(260); }
        last.remove();
        addCollectChip(d);
      }
      finishing?.();
    }
    busy = false;
  };

  // Ein Tipp irgendwo (ausser Knoepfe) treibt den Ablauf voran.
  card.addEventListener('click', (e) => {
    if (busy || e.target.closest('button')) return;
    if (phase === 'spin') doSpin();
    else if (phase === 'drops') revealDrop();
    else if (phase === 'done') done();
  });
}

// Anzeigepreis: bevorzugt der ECHTE Preis aus App Store Connect (StoreKit),
// sonst der Platzhalter aus cosmetics.js (Browser/Vorschau, bevor geladen).
function priceLabel(item) {
  return (item && productPrice(item.productId)) || item?.price || '';
}

function shopFeatureCard(item) {
  const owned = isOwned(item);
  const btn = owned
    ? `<button class="btn sekundaer" disabled>✓ Im Besitz</button>`
    : `<button class="btn" data-buy="${item.id}">${esc(priceLabel(item))}</button>`;
  const tag = item.type === 'bundle' ? '<span class="shop-tag">Bestpreis</span>' : '';
  const ic = item.type === 'bundle' ? './lobby/ic-crown.png?v=6' : './lobby/ic-stats.png?v=6';
  return `<div class="shop-card feat${owned ? ' owned' : ''}">
    ${tag}
    <img class="shop-ic" src="${ic}" alt="" aria-hidden="true">
    <div class="shop-name">${esc(item.name)}</div>
    <div class="shop-desc">${esc(item.desc || '')}</div>
    ${btn}
  </div>`;
}

function shopAvatarCard(item, equipped) {
  const owned = isOwned(item);
  let btn;
  if (!owned) {
    btn = `<button class="btn" data-buy="${item.id}">${esc(priceLabel(item))}</button>`;
  } else if (item.avatar === equipped) {
    btn = `<button class="btn sekundaer" disabled>✓ Aktiv</button>`;
  } else {
    btn = `<button class="btn" data-equip="${esc(item.avatar)}">Auswählen</button>`;
  }
  const lock = owned ? '' : '<span class="shop-lock">🔒</span>';
  return `<div class="shop-card${owned ? ' owned' : ''}">
    <div class="shop-ic-wrap">${lock}<img class="shop-ic" src="${esc(avV(item.avatar))}" alt=""></div>
    <div class="shop-name">${esc(item.name)}</div>
    ${btn}
  </div>`;
}

function shopTableCard(item, current) {
  const owned = isOwned(item);
  const active = item.id === current;
  let btn;
  if (!owned) {
    btn = `<button class="btn" data-buy="${item.id}">${esc(priceLabel(item))}</button>`;
  } else if (active) {
    btn = `<button class="btn sekundaer" disabled>✓ Aktiv</button>`;
  } else {
    btn = `<button class="btn" data-equip-table="${esc(item.id)}">Auswählen</button>`;
  }
  const lock = owned ? '' : '<span class="shop-lock">🔒</span>';
  const prev = item.bg ? `url('${item.bg}?v=1')` : "url('lobby/table-bg.jpg?v=2')";
  return `<div class="shop-card table${owned ? ' owned' : ''}${active ? ' active' : ''}">
    <div class="shop-table-prev" style="background-image:${prev}">${lock}</div>
    <div class="shop-name">${esc(item.name)}</div>
    ${btn}
  </div>`;
}

async function buyShopItem(id) {
  const item = id === SHOP_ADFREE.id ? SHOP_ADFREE
            : id === SHOP_BUNDLE.id ? SHOP_BUNDLE
            : AVATAR_ITEMS.find(i => i.id === id)
            || TABLE_ITEMS.find(i => i.id === id);
  if (!item) return;
  // Browser-/Dev-Vorschau: ohne echten Kauf freischalten.
  if (!iapAvailable()) {
    if (!isDevUnlock()) { toast(isNativeApp() ? 'In-App-Käufe sind noch nicht freigeschaltet.' : 'Käufe sind nur in der App möglich.', 'info'); return; }
    grantOwned(item.entitlement);
    if (item.type === 'adfree' || item.type === 'bundle') setAdFree(true);
    loadShop(); refreshAvatarPicker();
    toast('Freigeschaltet (Vorschau).', 'ok');
    return;
  }
  const r = await purchaseProduct(item.productId);
  if (r.ok) {
    if (item.type === 'adfree' || item.type === 'bundle') hideBanner();
    loadShop(); refreshAvatarPicker();
    toast('Freigeschaltet – danke! 🎉', 'ok');
  } else if (!r.cancelled) {
    toast(r.error === 'no-product'
      ? 'Dieses Angebot ist gerade nicht verfügbar.'
      : 'Kauf nicht möglich. Bitte später erneut versuchen.', 'err');
  }
}

// Premium-Avatar als Profilbild setzen (nur wenn im Besitz).
async function equipAvatar(path) {
  if (!avatarOwned(path)) { switchPane('shop'); return; }
  await pickAvatar(path);
  loadShop();
}

// Tisch-Design auswählen (nur wenn im Besitz oder gratis).
function equipTable(id) {
  const it = TABLE_ITEMS.find(t => t.id === id);
  if (it && !isOwned(it)) { toast('Dieses Tisch-Design ist im Shop erhältlich.', 'info'); return; }
  setTableTheme(id);
  loadShop();
  toast('Tisch-Design gewählt', 'ok');
}

// Neues Katalog-Spielfeld auswählen -> Hochformat-Bild wird echter Tisch-
// Hintergrund (über setTableBg-Override). Erneutes Antippen des aktiven Feldes
// schaltet zurück auf den Standard-Tisch.
function equipCatalogTable(id) {
  const it = SHOP_SECTIONS.find(s => s.key === 'table')?.items.find(i => i.id === id);
  if (!it || !it.img) return;
  const isActive = getTableBg() === it.img;
  setTableBg(isActive ? '' : it.img);
  loadShop();
  toast(isActive ? 'Standard-Tisch wiederhergestellt' : `Spielfeld „${it.name}" gewählt ✨`, 'ok');
}

// Kartendeck auswählen -> tauscht die Spielkarten-Vorderseiten aus.
// Standard-Deck (isDefault) setzt den Deck-Ordner zurueck auf leer = Original.
function equipCatalogDeck(id) {
  const it = SHOP_SECTIONS.find(s => s.key === 'deck')?.items.find(i => i.id === id);
  if (!it || (!it.folder && !it.isDefault)) return;
  setCardDeck(it.isDefault ? '' : it.folder);
  loadShop();
  toast(`Kartendeck „${it.name}" gewählt 🃏`, 'ok');
}

// Kartenrueckseite auswählen -> wechselt den Ruecken aller verdeckten Karten.
function equipCatalogBack(id) {
  const it = SHOP_SECTIONS.find(s => s.key === 'back')?.items.find(i => i.id === id);
  if (!it || (!it.folder && !it.isDefault)) return;
  setCardBack(it.isDefault ? '' : it.folder);
  loadShop();
  toast(`Kartenrückseite „${it.name}" gewählt 🂠`, 'ok');
}

// Shop-Avatar als Profilbild setzen (pickAvatar speichert lokal + im Profil).
async function equipCatalogAvatar(id) {
  const it = SHOP_SECTIONS.find(s => s.key === 'avatar')?.items.find(i => i.id === id);
  if (!it || !it.img) return;
  await pickAvatar(it.img);
  loadShop();
}

function offlineNote(el) {
  el.innerHTML = '<p class="empty-note">Dafür ist eine Internet-Verbindung nötig.<br>' +
    'Spiele online mit Freunden, dann erscheint hier dein Verlauf.</p>';
}

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleString('de-DE',
      { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
};

async function loadHistoryPane() {
  const list = $('#history-list');
  list.innerHTML = '<p class="empty-note">Lädt…</p>';
  const m = await ensureOnline();
  if (!m) { offlineNote(list); return; }
  try {
    const games = await m.matchHistory();
    if (!games || !games.length) {
      list.innerHTML = '<p class="empty-note">Noch keine abgeschlossenen Online-Spiele.<br>' +
        'Spiel ein Spiel mit Freunden zu Ende – danach steht es hier.</p>';
      return;
    }
    list.innerHTML = games.map(renderHistoryCard).join('');
  } catch (e) { list.innerHTML = '<p class="empty-note">Verlauf konnte nicht geladen werden.</p>'; }
}

function renderHistoryCard(g) {
  const players = g.players || [];
  const top = players.length ? players[0].score : null;
  const winner = players[0];
  const rows = players.map((p, i) => {
    const isMe = p.uid === state.uid;
    const isTop = p.score === top;
    return `<li class="${isTop ? 'top' : ''} ${isMe ? 'me' : ''}">
      <span class="rank">${i + 1}.</span>
      <span class="pname">${esc(p.name)}${isMe ? ' (Du)' : ''}</span>
      <span class="pscore">${p.score}</span>
    </li>`;
  }).join('');
  const winLine = winner
    ? `<span class="hist-winner"><span class="crown">👑</span>${esc(winner.name)}` +
      ` <span class="pts">${winner.score} Pkt.</span></span>`
    : '<span class="hist-winner">—</span>';
  return `<div class="hist">
    <div class="hist-head">${winLine}<span class="hist-date">${fmtDate(g.updated_at)}</span></div>
    <ul class="hist-players">${rows}</ul>
  </div>`;
}

async function loadProfilePane(mod) {
  const friends = $('#friends-list');
  const codeEl = $('#my-code');
  const m = mod || await ensureOnline();
  if (!m) {
    codeEl.textContent = '——';
    const box = $('#account-box');
    if (box) box.innerHTML = '<p class="muted">Für die Anmeldung ist eine Internet-Verbindung nötig.</p>';
    offlineNote(friends);
    return;
  }
  await renderAccount(m);
  try {
    const name = $('#name-input').value.trim();
    const prof = await m.upsertProfile(name || null);
    codeEl.textContent = prof?.code || '——';
    fillIdentity(prof);
  } catch (_) { codeEl.textContent = '——'; }
  loadGroups(m);
  friends.innerHTML = '<p class="empty-note">Lädt…</p>';
  try {
    const list = await m.listFriends();
    if (!list || !list.length) {
      friends.innerHTML = '<p class="empty-note">Noch keine Freunde.<br>' +
        'Gib oben den Code einer Freundin/eines Freundes ein.</p>';
      return;
    }
    friends.innerHTML = list.map(renderFriend).join('');
    list.forEach(f => {
      const rm = document.getElementById('rm-' + f.uid);
      if (rm) rm.onclick = () => removeFriendUI(f);
      const inv = document.getElementById('inv-' + f.uid);
      if (inv) inv.onclick = () => inviteFromList(f, inv);
    });
  } catch (e) { friends.innerHTML = '<p class="empty-note">Freunde konnten nicht geladen werden.</p>'; }
}

function renderFriend(f) {
  const avatar = f.avatar || DEFAULT_AV;
  const avHtml = isImg(avatar) ? `<img class="av-img" src="${esc(avV(avatar))}" alt="">` : esc(avatar);
  const games = f.games || 0, wins = f.wins || 0;
  const stat = games === 0 ? 'Noch kein gemeinsames Spiel'
    : `${games} ${games === 1 ? 'Spiel' : 'Spiele'} zusammen · ${wins} ${wins === 1 ? 'Sieg' : 'Siege'}`;
  return `<div class="friend">
    <div class="friend-av">${avHtml}</div>
    <div class="friend-main">
      <div class="friend-name">${esc(f.name)}</div>
      <div class="friend-stats">${stat}</div>
    </div>
    <button class="friend-invite" id="inv-${esc(f.uid)}" type="button" title="Zum Spiel einladen">Einladen</button>
    <button class="friend-rm" id="rm-${esc(f.uid)}" title="Entfernen" aria-label="Entfernen">✕</button>
  </div>`;
}

// --- Identitaet: Avatar + Benutzername -------------------------------------
// Themen-Avatare als Bilder (Reihenfolge = Dateien avatars/av01..av18.png).
const AVATARS = Array.from({ length: 18 }, (_, i) => `avatars/av${String(i + 1).padStart(2, '0')}.png`);
const DEFAULT_AV = AVATARS[0];   // Zauberer

// Avatar kann ein Emoji (alt) ODER ein Bild (Pfad/URL) sein.
const isImg = (v) => typeof v === 'string' && (/^https?:\/\//.test(v) || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(v));
// Cache-Bust nur für die mitgelieferten Avatar-Bilder (nicht für eigene Uploads).
const avV = (s) => (typeof s === 'string' && s.startsWith('avatars/')) ? s + '?v=7' : s;
function setAvatarDisplay(el, value) {
  if (!el) return;
  const v = value || DEFAULT_AV;
  if (isImg(v)) el.innerHTML = `<img class="av-img" src="${esc(avV(v))}" alt="">`;
  else el.textContent = v;
}
// Echtes Profilbild im unteren Profil-Tab anzeigen.
function updateNavAvatar() {
  const el = document.getElementById('nav-avatar');
  if (!el) return;
  let av; try { av = localStorage.getItem('wizard_my_avatar'); } catch (_) {}
  setAvatarDisplay(el, av || DEFAULT_AV);
}

function fillIdentity(prof) {
  if (!prof) return;
  try { localStorage.setItem('wizard_my_avatar', prof.avatar || DEFAULT_AV); } catch (_) {}
  const uname = $('#username-input');
  setAvatarDisplay($('#avatar-current'), prof.avatar || DEFAULT_AV);
  updateNavAvatar();
  if (uname && document.activeElement !== uname) uname.value = prof.name && prof.name !== 'Spieler' ? prof.name : '';
  renderAvatarPicker(prof.avatar || DEFAULT_AV);
}

function renderAvatarPicker(selected) {
  const grid = $('#avatar-picker');
  if (!grid) return;
  const free = AVATARS.map(a =>
    `<button type="button" class="avatar-opt ${a === selected ? 'sel' : ''}" data-av="${a}"><img class="av-img" src="${avV(a)}" alt=""></button>`);
  const prem = AVATAR_ITEMS.map(it => {
    const owned = avatarOwned(it.avatar);
    const sel = it.avatar === selected ? 'sel' : '';
    const lk = owned ? '' : '<span class="avatar-lock">🔒</span>';
    return `<button type="button" class="avatar-opt ${sel} ${owned ? '' : 'locked'}" data-av="${esc(it.avatar)}">${lk}<img class="av-img" src="${avV(it.avatar)}" alt=""></button>`;
  });
  grid.innerHTML = free.concat(prem).join('');
  grid.querySelectorAll('.avatar-opt').forEach(b => { b.onclick = () => pickAvatar(b.dataset.av); });
}
function refreshAvatarPicker() { renderAvatarPicker(myAvatar() || DEFAULT_AV); }

async function pickAvatar(emoji) {
  // Premium-Avatar nicht im Besitz -> in den Shop leiten statt setzen.
  if (!avatarOwned(emoji)) { toast('Dieser Avatar ist im Shop erhältlich.', 'info'); switchPane('shop'); return; }
  try { localStorage.setItem('wizard_my_avatar', emoji); } catch (_) {}
  setAvatarDisplay($('#avatar-current'), emoji);
  updateNavAvatar();
  $('#avatar-picker').querySelectorAll('.avatar-opt').forEach(b =>
    b.classList.toggle('sel', b.dataset.av === emoji));
  $('#avatar-tools').hidden = true;
  const m = await ensureOnline();
  if (!m) { toast('Für das Speichern ist Internet nötig.', 'err'); return; }
  try { await m.upsertProfile(null, emoji); toast('Avatar gespeichert', 'ok'); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// Bild auf ein quadratisches JPEG (mittig zugeschnitten) verkleinern.
function fileToSquareJpeg(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      c.toBlob(b => b ? resolve(b) : reject(new Error('Bild konnte nicht verarbeitet werden')), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = URL.createObjectURL(file);
  });
}

async function onAvatarFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Bitte ein Bild auswählen', 'err'); return; }
  const m = await ensureOnline();
  if (!m) { toast('Für den Upload ist Internet nötig.', 'err'); return; }
  try {
    toast('Bild wird hochgeladen…');
    const blob = await fileToSquareJpeg(file);
    const url = await m.uploadAvatar(blob);
    await m.upsertProfile(null, url);
    try { localStorage.setItem('wizard_my_avatar', url); } catch (_) {}
    setAvatarDisplay($('#avatar-current'), url);
    updateNavAvatar();
    $('#avatar-tools').hidden = true;
    toast('Profilbild gespeichert', 'ok');
  } catch (err) { toast(err.message || 'Upload fehlgeschlagen', 'err'); }
}

async function saveUsername() {
  const inp = $('#username-input');
  const name = inp.value.trim();
  if (!name) { toast('Bitte einen Benutzernamen eingeben', 'err'); return; }
  const m = await ensureOnline();
  if (!m) { toast('Für das Speichern ist Internet nötig.', 'err'); return; }
  try {
    const prof = await m.upsertProfile(name, null);
    // Mit dem Spiel-Namen synchron halten (so heisst du auch im Spiel so).
    localStorage.setItem(LS_NAME, name);
    const ni = $('#name-input'); if (ni) ni.value = name;
    if (prof?.code) $('#my-code').textContent = prof.code;
    toast('Benutzername gespeichert', 'ok');
  } catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// --- Gruppen ---------------------------------------------------------------
async function createGroupUI() {
  const inp = $('#group-name-input');
  const name = inp.value.trim();
  if (!name) { toast('Bitte einen Gruppennamen eingeben', 'err'); return; }
  const m = await ensureOnline();
  if (!m) return;
  try { await m.createGroup(name); inp.value = ''; toast('Gruppe erstellt', 'ok'); await loadGroups(m); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

async function loadGroups(m) {
  const list = $('#groups-list');
  if (!list) return;
  try {
    const groups = await m.listGroups();
    if (!groups || !groups.length) {
      list.innerHTML = '<p class="empty-note">Noch keine Gruppe – erstelle oben eine.</p>';
      return;
    }
    list.innerHTML = '';
    groups.forEach(g => {
      const el = document.createElement('div');
      el.className = 'group-item';
      el.innerHTML = `<span class="group-ic" aria-hidden="true">🏅</span>
        <div class="group-main">
          <div class="group-name">${esc(g.name)}</div>
          <div class="group-sub">${g.members} ${g.members === 1 ? 'Mitglied' : 'Mitglieder'}${g.owner ? ' · Ersteller' : ''}</div>
        </div><span class="group-chev" aria-hidden="true">›</span>`;
      el.onclick = () => openGroup(g);
      list.appendChild(el);
    });
  } catch (_) { list.innerHTML = '<p class="empty-note">Gruppen konnten nicht geladen werden.</p>'; }
}

async function openGroup(g) {
  const modal = $('#group-modal');
  $('#gm-title').textContent = g.name;
  const body = $('#gm-body');
  body.innerHTML = '<p class="empty-note">Lädt…</p>';
  modal.hidden = false;
  const m = await ensureOnline();
  if (!m) { body.innerHTML = '<p class="empty-note">Für die Rangliste ist Internet nötig.</p>'; return; }
  try {
    const [standings, friends] = await Promise.all([
      m.groupStandings(g.id), m.listFriends().catch(() => [])
    ]);
    renderGroupBody(g, standings || [], friends || []);
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message || 'Fehler')}</p>`; }
}

function renderGroupBody(g, standings, friends) {
  const body = $('#gm-body');
  const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
  const memberUids = new Set(standings.map(s => s.uid));
  const rows = standings.map((s, i) => {
    const isMe = s.uid === state.uid;
    const av = s.avatar || DEFAULT_AV;
    const avh = isImg(av) ? `<img class="av-img" src="${esc(avV(av))}" alt="">` : esc(av);
    const rm = (g.owner && !isMe) ? `<button class="st-rm" data-rm="${esc(s.uid)}" title="Entfernen">✕</button>` : '';
    return `<li><span class="place">${medal(i)}</span><span class="st-av">${avh}</span>` +
      `<span class="st-name ${isMe ? 'me' : ''}">${esc(s.name)}${isMe ? ' (Du)' : ''}</span>` +
      `<span class="st-wins">${s.wins} ${s.wins === 1 ? 'Sieg' : 'Siege'}</span>` +
      `<span class="st-games">${s.games} Sp.</span>${rm}</li>`;
  }).join('');
  const addable = friends.filter(f => !memberUids.has(f.uid));
  let addHtml;
  if (addable.length) {
    addHtml = `<div class="gm-add"><select id="gm-add-sel">` +
      addable.map(f => `<option value="${esc(f.uid)}">${esc(f.name)}</option>`).join('') +
      `</select><button class="btn small-btn" id="gm-add-btn" type="button">Hinzufügen</button></div>`;
  } else {
    addHtml = '<p class="muted" style="font-size:.82rem;margin:4px 0 12px">Alle deine Freunde sind schon dabei.</p>';
  }
  body.innerHTML =
    `<ul class="standings">${rows || '<li class="empty-note">Noch keine Mitglieder</li>'}</ul>` +
    addHtml +
    `<p class="muted" style="font-size:.78rem;margin-bottom:12px">Siege zählen, wenn ausschließlich Gruppenmitglieder ein Spiel zu Ende spielen.</p>` +
    `<div class="row"><button class="btn sekundaer small-btn" id="gm-leave" type="button">Gruppe verlassen</button></div>`;
  body.querySelectorAll('.st-rm').forEach(b => { b.onclick = () => removeMemberUI(g, b.dataset.rm); });
  const addBtn = document.getElementById('gm-add-btn');
  if (addBtn) addBtn.onclick = () => addMemberUI(g);
  document.getElementById('gm-leave').onclick = () => leaveGroupUI(g);
}

async function addMemberUI(g) {
  const sel = document.getElementById('gm-add-sel');
  const uid = sel && sel.value;
  if (!uid) return;
  const m = await ensureOnline();
  if (!m) return;
  try { await m.addGroupMember(g.id, uid); toast('Hinzugefügt', 'ok'); await openGroup(g); loadGroups(m); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

async function removeMemberUI(g, uid) {
  const m = await ensureOnline();
  if (!m) return;
  try { await m.removeGroupMember(g.id, uid); toast('Entfernt', 'ok'); await openGroup(g); loadGroups(m); }
  catch (e) { toast(e.message || 'Fehler', 'err'); }
}

async function leaveGroupUI(g) {
  const m = await ensureOnline();
  if (!m) return;
  try {
    await m.leaveGroup(g.id);
    toast('Gruppe verlassen', 'ok');
    $('#group-modal').hidden = true;
    loadGroups(m);
  } catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// --- Konto / E-Mail-Login --------------------------------------------------
async function renderAccount(m) {
  const box = $('#account-box');
  if (!box) return;
  let info;
  try { info = await m.authInfo(); } catch (_) { info = { isAnonymous: true }; }

  // Inhaber-Konto: alles freischalten (oder bei anderem Konto wieder entfernen).
  const owner = isOwnerEmail(info.email);
  if (owner !== ownerUnlock()) {
    setOwnerUnlock(owner);
    if (owner) setAdFree(true);
    applyTableTheme(); refreshAvatarPicker(); updateNavAvatar();
  } else if (owner) { setAdFree(true); }

  if (info.email && !info.isAnonymous) {
    box.innerHTML =
      `<div class="acct-status"><span class="dot on"></span>` +
      `<span>Eingeloggt – Login-E-Mail <b>${esc(info.email)}</b></span></div>` +
      `<p class="acct-note">Deine E-Mail ist privat. Andere sehen nur deinen Benutzernamen und Avatar.</p>` +
      `<div class="row"><button id="signout-btn" class="btn sekundaer small-btn" type="button">Abmelden</button></div>`;
    $('#signout-btn').onclick = signOutUI;
    return;
  }

  const pending = info.newEmail || info.email;
  box.innerHTML =
    `<div class="acct-status"><span class="dot off"></span><span>Du spielst als Gast</span></div>` +
    (pending
      ? `<div class="acct-pending">Bestätigung an <b>${esc(pending)}</b> gesendet – bitte den Link in der E-Mail öffnen.</div>`
      : '') +
    `<div class="auth-fields">
       <label class="field-label" for="auth-email">E-Mail</label>
       <input id="auth-email" type="email" autocomplete="email" autocapitalize="none" placeholder="du@beispiel.de">
       <label class="field-label" for="auth-pass">Passwort</label>
       <input id="auth-pass" type="password" autocomplete="current-password" placeholder="mind. 6 Zeichen">
       <div class="row">
         <button id="signup-btn" class="btn small-btn" type="button">Konto erstellen</button>
         <button id="signin-btn" class="btn sekundaer small-btn" type="button">Anmelden</button>
       </div>
       <p class="acct-note">„Konto erstellen" sichert dein jetziges Profil (Freunde &amp; Verlauf) per E-Mail. Auf neuen Geräten meldest du dich mit denselben Daten an.</p>
     </div>`;
  $('#signup-btn').onclick = () => authSubmit('signup');
  $('#signin-btn').onclick = () => authSubmit('signin');
}

async function authSubmit(mode) {
  const email = ($('#auth-email')?.value || '').trim();
  const pass  = $('#auth-pass')?.value || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Bitte gültige E-Mail eingeben', 'err'); return; }
  if (pass.length < 6) { toast('Passwort: mindestens 6 Zeichen', 'err'); return; }
  const m = await ensureOnline();
  if (!m) return;
  try {
    if (mode === 'signup') {
      const res = await m.signUpEmail(email, pass);
      state.uid = await m.currentUid();
      toast(res.converted
        ? 'Bestätigungs-Mail gesendet – danach ist dein Konto gesichert.'
        : 'Konto erstellt – bitte E-Mail bestätigen.', 'ok');
    } else {
      await m.signInEmail(email, pass);
      state.uid = await m.currentUid();
      await m.upsertProfile($('#name-input').value.trim() || null);
      resetInviteWatch(); startInviteWatch();      // Einladungen fuer das neue Konto
      toast('Angemeldet', 'ok');
    }
    await loadProfilePane(m);
  } catch (e) { toast(e.message || 'Anmeldung fehlgeschlagen', 'err'); }
}

async function signOutUI() {
  const m = await ensureOnline();
  if (!m) return;
  try {
    await m.signOutEmail();
    resetInviteWatch();
    await m.ensureAuth();                 // neues Gast-Konto fuer weiteres Spielen
    state.uid = await m.currentUid();
    startInviteWatch();                   // Einladungen fuer das Gast-Konto
    toast('Abgemeldet', 'ok');
    await loadProfilePane(m);
  } catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// Aktuellen Namen fuer Online-Spiele ermitteln.
function currentName() {
  return ($('#username-input')?.value || '').trim()
      || ($('#name-input')?.value || '').trim()
      || (localStorage.getItem(LS_NAME) || '').trim();
}

// Freund:in direkt in ein Spiel einladen: vorhandenen Warteraum nutzen oder
// ein neues Online-Spiel erstellen, dann die Einladung senden.
async function inviteFromList(f, btn) {
  const name = currentName();
  if (!name) { toast('Bitte zuerst oben einen Benutzernamen speichern.', 'err'); return; }
  if (btn) btn.disabled = true;
  const m = await ensureOnline();
  if (!m) { if (btn) btn.disabled = false; return; }
  const inLobby = state.gameId && state.game && state.game.status === 'lobby';
  const doInvite = async (gid) => {
    await m.inviteFriend(gid, f.uid);
    toast('Einladung an ' + (f.name || 'Freund:in') + ' gesendet', 'ok');
  };
  if (inLobby) {
    try { await doInvite(state.gameId); }
    catch (e) { toast(e.message || 'Einladen fehlgeschlagen', 'err'); if (btn) btn.disabled = false; }
    return;
  }
  // Neues Spiel fuer die Einladung eroeffnen -> kostet einen Spielstein.
  requireToken(async () => {
    try {
      const code = await m.createGame(name, 6);
      const gid = await m.joinGame(code, name);
      tokenPaidFor = gid;
      await enterGame(gid);              // -> Warteraum
      await doInvite(gid);
    } catch (e) {
      if (tokenGateActive()) refundToken();
      toast(e.message || 'Einladen fehlgeschlagen', 'err');
      if (btn) btn.disabled = false;
    }
  });
}

// --- Eingehende Einladungen (Realtime) -------------------------------------
let inviteWatching = false;
let inviteUnsub = null;

function resetInviteWatch() {
  try { inviteUnsub && inviteUnsub(); } catch (_) {}
  inviteUnsub = null; inviteWatching = false;
  const el = $('#invite-banner'); if (el) el.hidden = true;
}

async function startInviteWatch() {
  if (inviteWatching) return;
  inviteWatching = true;
  const m = await ensureOnline();
  if (!m) { inviteWatching = false; return; }
  try {
    const pend = await m.pendingInvites();
    if (pend && pend.length) showInviteBanner(pend[0]);
  } catch (_) {}
  try {
    inviteUnsub = await m.subscribeInvites(state.uid, (row) => {
      if (row && row.status === 'pending') showInviteBanner(row);
    });
  } catch (_) {}
}

function showInviteBanner(inv) {
  const el = $('#invite-banner');
  if (!el || !inv) return;
  // Nicht einladen, wenn ich gerade in genau diesem Spiel bin.
  if (state.gameId && state.gameId === inv.game_id) return;
  el.innerHTML =
    `<div class="ib-text">🎮 <b>${esc(inv.from_name || 'Jemand')}</b> lädt dich zu Zaubertisch ein</div>` +
    `<div class="ib-actions">` +
    `<button class="btn small-btn" id="ib-join" type="button">Beitreten</button>` +
    `<button class="btn sekundaer small-btn" id="ib-no" type="button">Später</button></div>`;
  el.hidden = false;
  $('#ib-join').onclick = () => acceptInvite(inv);
  $('#ib-no').onclick = () => {
    el.hidden = true;
    ensureOnline().then(m => m && m.declineInvite(inv.id).catch(() => {}));
  };
}

async function acceptInvite(inv) {
  $('#invite-banner').hidden = true;
  const m = await ensureOnline();
  if (!m) return;
  requireToken(async () => {
    try {
      const gid = await m.joinGame(inv.code, currentName() || 'Spieler');
      tokenPaidFor = gid;
      await enterGame(gid);
    } catch (e) {
      if (tokenGateActive()) refundToken();
      toast(e.message || 'Beitreten fehlgeschlagen', 'err');
    }
  });
}

async function removeFriendUI(f) {
  const m = await ensureOnline();
  if (!m) return;
  try {
    await m.removeFriend(f.uid);
    toast((f.name || 'Freund:in') + ' entfernt', 'ok');
    await loadProfilePane(m);
  } catch (e) { toast(e.message || 'Fehler', 'err'); }
}

// Laedt db.js + stellt die anonyme Anmeldung sicher. Gibt das db-Modul zurueck
// oder null (+ Hinweis), falls Laden/Anmeldung fehlschlagen.
async function ensureOnline() {
  let m;
  try {
    m = await db();
  } catch (e) {
    toast('Online-Modus nicht erreichbar (keine Verbindung).', 'err');
    return null;
  }
  try {
    await m.ensureAuth();
    state.uid = await m.currentUid();
    localStorage.setItem('wizard_online', '1');   // merken: Nutzer ist online unterwegs
    startInviteWatch();                            // Einladungen empfangen (einmalig)
    return m;
  } catch (e) {
    toast('Online-Modus benötigt die aktivierte anonyme Anmeldung in Supabase.', 'err');
    return null;
  }
}

// --- Start -----------------------------------------------------------------
// Nach dem Klick auf den Bestätigungs-Link landet man hier mit einem Token in
// der URL (#access_token=...). db.js uebernimmt die Sitzung beim Laden des
// Clients; danach raeumen wir die Adresszeile auf und zeigen das Profil.
async function handleAuthRedirect() {
  const hash = location.hash || '';
  const hasToken = hash.includes('access_token=');
  const hasError = hash.includes('error_description=');
  if (!hasToken && !hasError) return;
  if (hasError) {
    const msg = decodeURIComponent((hash.split('error_description=')[1] || '').split('&')[0]).replace(/\+/g, ' ');
    history.replaceState(null, '', location.pathname);
    toast(msg || 'Bestätigung fehlgeschlagen', 'err');
    return;
  }
  try {
    const m = await db();                 // Client erstellen -> Sitzung aus URL uebernehmen
    state.uid = await m.currentUid();
    history.replaceState(null, '', location.pathname);   // Token aus der Adresszeile entfernen
    if (state.uid) { toast('E-Mail bestätigt – du bist angemeldet.', 'ok'); switchPane('profil'); }
  } catch (_) {
    history.replaceState(null, '', location.pathname);
  }
}

// Wurde die App ueber einen Einladungs-Link (?join=CODE) geoeffnet? Dann Code
// eintragen und – falls der Name schon bekannt ist – direkt beitreten.
async function handleJoinLink() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('join') || '').trim().toUpperCase();
  if (!code) return;
  history.replaceState(null, '', location.pathname);   // Param aus der Adresszeile entfernen
  const ci = $('#code-input'); if (ci) ci.value = code;
  const name = (localStorage.getItem(LS_NAME) || '').trim();
  if (name) {
    const ni = $('#name-input'); if (ni) ni.value = name;
    toast('Einladung erkannt – du trittst dem Spiel bei …', 'ok');
    $('#join-btn')?.click();
  } else {
    toast('Einladung erkannt! Gib deinen Namen ein und tippe auf „Beitreten".', 'info');
    const ni = $('#name-input'); if (ni) ni.focus();
    ci?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Einstellungen-Overlay: Musik an/aus + Lautstaerke.
function wireSettings() {
  const modal = document.getElementById('settings-modal');
  const btn = document.getElementById('settings-btn');
  const close = document.getElementById('settings-close');
  const toggle = document.getElementById('music-toggle');
  const vol = document.getElementById('music-volume');
  if (!modal || !btn) return;

  const syncToggle = () => toggle?.setAttribute('aria-checked', musicEnabled() ? 'true' : 'false');
  if (vol) vol.value = String(Math.round(musicVolume() * 100));
  syncToggle();

  btn.onclick = () => { modal.hidden = false; };
  if (close) close.onclick = () => { modal.hidden = true; };
  const xBtn = document.getElementById('settings-x');
  if (xBtn) xBtn.onclick = () => { modal.hidden = true; };
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });

  if (toggle) toggle.onclick = () => {
    const on = !(musicEnabled());
    setMusicEnabled(on);          // Klick ist eine Nutzergeste -> Start klappt
    syncToggle();
    toast(on ? 'Musik an' : 'Musik aus', 'ok');
  };
  if (vol) vol.addEventListener('input', () => setMusicVolume((parseInt(vol.value, 10) || 0) / 100));

  // Soundeffekte & Vibration
  const sfxT = document.getElementById('sfx-toggle');
  if (sfxT) {
    sfxT.setAttribute('aria-checked', sfxEnabled() ? 'true' : 'false');
    sfxT.onclick = () => {
      const on = !sfxEnabled();
      setSfx(on);
      sfxT.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) { sfxCard(); haptic(15); }     // kleine Hörprobe
      toast(on ? 'Effekte an' : 'Effekte aus', 'ok');
    };
  }
  // Effekt-Lautstärke
  const sfxVolEl = document.getElementById('sfx-volume');
  if (sfxVolEl) {
    sfxVolEl.value = String(Math.round(getSfxVolume() * 100));
    sfxVolEl.addEventListener('input', () => setSfxVolume((parseInt(sfxVolEl.value, 10) || 0) / 100));
    sfxVolEl.addEventListener('change', () => { if (sfxEnabled()) sfxCard(); });  // Hörprobe beim Loslassen
  }

  // Werbefrei: echter In-App-Kauf via StoreKit (nur native App). Im Browser/
  // PWA gibt es keine Werbung -> der Kauf-Bereich wird dort ausgeblendet.
  const adfreeBox = document.getElementById('adfree-box');
  const buyBtn = document.getElementById('buy-adfree');
  const restoreBtn = document.getElementById('restore-adfree');
  const adNote = document.getElementById('adfree-note');
  const syncAdfree = () => {
    if (adfreeBox && !iapAvailable() && !isAdFree()) { adfreeBox.hidden = true; return; }
    if (adfreeBox) adfreeBox.hidden = false;
    if (!buyBtn) return;
    if (isAdFree()) {
      buyBtn.textContent = '✓ Werbefrei aktiv';
      buyBtn.disabled = true; buyBtn.classList.add('sekundaer');
      if (restoreBtn) restoreBtn.hidden = true;
      if (adNote) adNote.textContent = 'Danke! Es wird keine Werbung mehr angezeigt.';
    } else {
      buyBtn.textContent = '✨ Werbefrei – 3,99 €';
      buyBtn.disabled = false; buyBtn.classList.remove('sekundaer');
      if (restoreBtn) restoreBtn.hidden = false;
      if (adNote) adNote.textContent = 'Entfernt Banner und Vollbild-Werbung dauerhaft.';
    }
  };
  syncAdfree();
  if (buyBtn) buyBtn.onclick = async () => {
    buyBtn.disabled = true;
    const r = await purchaseAdFree();
    syncAdfree();
    if (r.ok) { hideBanner(); toast('Werbefrei freigeschaltet – danke! 🎉', 'ok'); }
    else if (!r.cancelled) toast('Kauf nicht möglich. Bitte später erneut versuchen.', 'err');
  };
  if (restoreBtn) restoreBtn.onclick = async () => {
    restoreBtn.disabled = true;
    const r = await restorePurchases();
    restoreBtn.disabled = false;
    syncAdfree();
    if (r.ok) { hideBanner(); toast('Käufe wiederhergestellt – Werbefrei aktiv 🎉', 'ok'); }
    else toast('Kein früherer Werbefrei-Kauf gefunden.', 'err');
  };

  // Werbe-Vorschau (nur Test, im Browser)
  const prevT = document.getElementById('adpreview-toggle');
  if (prevT) {
    prevT.setAttribute('aria-checked', isPreview() ? 'true' : 'false');
    prevT.onclick = () => {
      const on = !isPreview();
      setPreview(on);
      prevT.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) showBanner(); else hideBanner();
      toast(on ? 'Werbe-Vorschau an' : 'Werbe-Vorschau aus', 'ok');
    };
  }

  // Test-Anzeigen erzwingen (native App): zeigt echte Google-Testanzeigen,
  // damit man auf dem Geraet sieht, dass Werbung ankommt (bevor das eigene
  // AdMob-Konto echte Ads ausliefert). Gefahrlos klickbar.
  const adtestT = document.getElementById('adtest-toggle');
  // Test-Knopf "Spielsteine auf 0" nur zeigen, wenn Testanzeigen aktiv sind.
  const syncTokTest = () => { const r = document.getElementById('tokentest-row'); if (r) r.hidden = !isForceTest(); };
  if (adtestT) {
    adtestT.setAttribute('aria-checked', isForceTest() ? 'true' : 'false');
    adtestT.onclick = async () => {
      const on = !isForceTest();
      adtestT.setAttribute('aria-checked', on ? 'true' : 'false');
      await setForceTest(on);
      syncTokTest();
      refreshTokenPill();   // Gate-Wechsel -> Pille ein-/ausblenden
      toast(on ? 'Testanzeigen an' : 'Testanzeigen aus (echte IDs)', 'ok');
    };
  }
  syncTokTest();
  const tokTestBtn = document.getElementById('tokentest-btn');
  if (tokTestBtn) tokTestBtn.onclick = () => { setTokensForTest(0); toast('Notizblöcke auf 0 gesetzt', 'ok'); };

  // Live-Werbe-Status unter dem Schalter: zeigt Init-/Consent-/Ladefehler
  // direkt in der App an (ohne Xcode-Konsole).
  const adsInfo = document.getElementById('ads-status');
  if (adsInfo) {
    const upd = (s) => { adsInfo.textContent = 'Werbe-Status: ' + s; };
    upd(adsStatus());
    onAdsStatus(upd);
  }

  // "Du bist dran"-Benachrichtigungen
  const notifT = document.getElementById('notif-toggle');
  if (notifT) {
    notifT.setAttribute('aria-checked', notifEnabled ? 'true' : 'false');
    notifT.onclick = async () => {
      const want = notifT.getAttribute('aria-checked') !== 'true';
      const ok = await enableNotifications(want);
      notifT.setAttribute('aria-checked', ok ? 'true' : 'false');
      if (want && ok) toast('Benachrichtigungen an', 'ok');
      else if (!want) toast('Benachrichtigungen aus', 'ok');
    };
  }
}

// --- Benachrichtigungen ("du bist dran") -----------------------------------
// Im nativen iOS/Android-WebView gibt es die Web-Notification-API nicht ->
// Capacitor LocalNotifications. Im Browser/PWA unveraendert ueber Notification.
let notifEnabled = localStorage.getItem('wizard_notif_on') === '1';
const capNative = () => { const c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); };
const localNotif = () => window.Capacitor?.Plugins?.LocalNotifications || null;

function notifyYourTurn() {
  if (!notifEnabled || !document.hidden) return;   // nur wenn die App im Hintergrund ist
  if (capNative()) {
    const LN = localNotif(); if (!LN) return;
    try {
      LN.schedule({ notifications: [{
        id: Date.now() % 100000,
        title: 'Zaubertisch – du bist dran!',
        body: 'Tippe, um weiterzuspielen.'
      }] }).catch(() => {});
    } catch (_) {}
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Zaubertisch – du bist dran!', { body: 'Tippe, um weiterzuspielen.', tag: 'wiz-turn', icon: './icon-192.png' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) {}
}
async function enableNotifications(on) {
  if (!on) { notifEnabled = false; localStorage.setItem('wizard_notif_on', '0'); return false; }
  if (capNative()) {
    const LN = localNotif();
    if (!LN) { toast('Benachrichtigungen werden hier nicht unterstützt', 'err'); return false; }
    try {
      const res = await LN.requestPermissions();
      if (res && res.display && res.display !== 'granted') { toast('Benachrichtigungen wurden blockiert', 'err'); return false; }
    } catch (_) {}
    notifEnabled = true; localStorage.setItem('wizard_notif_on', '1'); return true;
  }
  if (!('Notification' in window)) { toast('Benachrichtigungen werden hier nicht unterstützt', 'err'); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Benachrichtigungen wurden blockiert', 'err'); return false; }
  notifEnabled = true; localStorage.setItem('wizard_notif_on', '1'); return true;
}

// --- Rechtliches & Konto ---------------------------------------------------
const openModal = id => { const el = document.getElementById(id); if (el) el.hidden = false; };
const closeModal = el => { if (el) el.hidden = true; };

function wireLegal() {
  // Rechts-Texte aus den Einstellungen oeffnen
  const map = { 'open-privacy': 'privacy-modal', 'open-terms': 'terms-modal', 'open-imprint': 'imprint-modal' };
  Object.entries(map).forEach(([btn, modal]) => {
    const b = document.getElementById(btn);
    if (b) b.onclick = () => openModal(modal);
  });
  // Schliessen-Buttons + Klick auf den Hintergrund
  document.querySelectorAll('[data-close-legal]').forEach(b => { b.onclick = () => closeModal(b.closest('.modal')); });
  ['privacy-modal', 'terms-modal', 'imprint-modal', 'mydata-modal', 'delete-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m) m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
  });

  // Meine Daten (DSGVO-Auskunft)
  const myBtn = document.getElementById('open-mydata');
  if (myBtn) myBtn.onclick = async () => {
    openModal('mydata-modal');
    const body = document.getElementById('mydata-body');
    if (body) body.innerHTML = '<p class="muted">Lädt …</p>';
    const m = await ensureOnline();
    if (!m) { if (body) body.innerHTML = '<p class="muted">Dafür ist eine Internet-Verbindung nötig.</p>'; return; }
    try {
      const d = await m.getMyData();
      const name = d.profil?.name || (localStorage.getItem(LS_NAME) || '–');
      if (body) body.innerHTML = `<dl class="mydata-grid">
        <dt>Konto-Typ</dt><dd>${d.gast ? 'Gast (anonym)' : 'E-Mail-Konto'}</dd>
        <dt>E-Mail</dt><dd>${esc(d.email || '–')}</dd>
        <dt>Anzeigename</dt><dd>${esc(name)}</dd>
        <dt>Konto-ID</dt><dd>${esc(d.konto_id || '–')}</dd>
        <dt>Freunde</dt><dd>${d.freunde ?? 0}</dd>
        <dt>Gruppen</dt><dd>${d.gruppen ?? 0}</dd>
        <dt>Gespielte Spiele</dt><dd>${d.gespielte_spiele ?? 0}</dd>
      </dl>`;
    } catch (e) { if (body) body.innerHTML = `<p class="muted">Konnte nicht geladen werden: ${esc(e.message || '')}</p>`; }
  };

  // Konto loeschen
  const delModal = document.getElementById('delete-modal');
  const delBtn = document.getElementById('open-delete');
  if (delBtn) delBtn.onclick = () => openModal('delete-modal');
  const delCancel = document.getElementById('delete-cancel');
  if (delCancel) delCancel.onclick = () => closeModal(delModal);
  const delConfirm = document.getElementById('delete-confirm');
  if (delConfirm) delConfirm.onclick = async () => {
    delConfirm.disabled = true; delConfirm.textContent = 'Lösche …';
    const m = await ensureOnline();
    if (!m) { delConfirm.disabled = false; delConfirm.textContent = 'Endgültig löschen'; toast('Internet-Verbindung nötig', 'err'); return; }
    try {
      await m.deleteAccount();
      localStorage.removeItem(LS_NAME);
      localStorage.removeItem('wizard_online');
      localStorage.removeItem('wizard_consent');
      closeModal(delModal); closeModal(document.getElementById('settings-modal'));
      goHome();
      toast('Konto und alle Daten wurden gelöscht.', 'ok');
    } catch (e) {
      toast(e.message || 'Löschen fehlgeschlagen', 'err');
    } finally {
      delConfirm.disabled = false; delConfirm.textContent = 'Endgültig löschen';
    }
  };
}

// Einwilligung (Datenschutz/Nutzung) beim ersten Start einholen.
function showConsentIfNeeded() {
  if (localStorage.getItem('wizard_consent') === '1') return;
  const m = document.getElementById('consent-modal');
  if (!m) return;
  m.hidden = false;
  const accept = document.getElementById('consent-accept');
  if (accept) accept.onclick = () => { localStorage.setItem('wizard_consent', '1'); m.hidden = true; };
  const ct = document.getElementById('consent-terms');
  const cp = document.getElementById('consent-privacy');
  if (ct) ct.onclick = () => openModal('terms-modal');
  if (cp) cp.onclick = () => openModal('privacy-modal');
}

// Vorgeladene Bilder dauerhaft referenzieren (sonst GC -> Memory-Cache-Verlust
// -> sichtbares Nachladen spaeter im Spiel).
const bootWarm = [];

// Start-Ladebildschirm (statisch in index.html): alle Startseiten-Bilder,
// Avatare und das komplette Kartendeck vorladen; Balken zeigt den Fortschritt.
// Erst wenn alles bereit ist (mind. ~1s, max. 10s), wird er ausgeblendet.
function runBootLoader() {
  const ov = document.getElementById('boot-loader');
  if (!ov) return;
  const fill = ov.querySelector('.rl-fill'), pctEl = ov.querySelector('.rl-pct');
  const urls = new Set();
  // Alle bereits im HTML referenzierten Bilder (Startseiten-Kacheln, Icons …)
  document.querySelectorAll('img[src]').forEach(im => { const s = im.getAttribute('src'); if (s) urls.add(s); });
  // CSS-Hintergruende der Startseite + Ladebild selbst (URLs exakt wie im CSS)
  ['lobby/bg.jpg?v=2', 'lobby/home-hero.jpg', 'lobby/game-banner.jpg?v=1',
   'lobby/loading.jpg?v=2'].forEach(u => urls.add(u));
  // Spieltisch-Grafiken (Sitz-Rahmen, Buttons, Tisch, Kartenruecken) – damit
  // im Spiel selbst nichts mehr sichtbar nachlaedt.
  gameAssetUrls().forEach(u => urls.add(u));
  // Standard-Avatare (eigenes Profil + Computer-Gegner)
  for (let i = 1; i <= 18; i++) urls.add('avatars/av' + String(i).padStart(2, '0') + '.png?v=7');
  // Komplettes Kartendeck (60 Vorderseiten + Rueckseite)
  allCardImageUrls().forEach(u => urls.add(u));
  const list = [...urls];
  const t0 = Date.now(), MIN = 1000, MAX = 10000;
  const total = Math.max(1, list.length);
  let loaded = 0, finished = false, iv = null;
  const setPct = p => { if (fill) fill.style.width = p + '%'; if (pctEl) pctEl.textContent = p + '%'; };
  const finish = () => {
    if (finished) return;
    finished = true; clearInterval(iv);
    setPct(100);
    setTimeout(() => { ov.classList.add('out'); setTimeout(() => ov.remove(), 500); }, 200);
  };
  const tick = () => {
    if (finished) return;
    const real = loaded / total;
    const timed = Math.min(1, (Date.now() - t0) / MIN);
    setPct(Math.round(Math.min(real, timed) * 100));
    if (real >= 1 && timed >= 1) finish();
  };
  iv = setInterval(tick, 80);
  setTimeout(finish, MAX);
  list.forEach(u => { const im = new Image(); im.onload = im.onerror = () => { loaded++; tick(); }; im.src = u; bootWarm.push(im); });
}

async function init() {
  // Aktives Kartendeck, das nicht mehr im Katalog steht (z. B. entferntes
  // Arkanum), auf das Standard-Deck zuruecksetzen -> keine fehlenden Bilder.
  const deckFolders = new Set((SHOP_SECTIONS.find(s => s.key === 'deck')?.items || [])
    .map(i => i.folder).filter(Boolean));
  if (getCardDeck() && !deckFolders.has(getCardDeck())) setCardDeck('');
  // Buttons sofort verdrahten – der Solo-Modus braucht keine Anmeldung.
  applyTableTheme();   // gewähltes Tisch-Design auf den Spieltisch anwenden
  applyCardBack();     // gewählte Kartenrückseite (CSS-Ruecken) anwenden
  // Erst alles laden (Ladebildschirm mit Balken), dann die Startseite zeigen.
  // (Nach applyTableTheme, damit auch das aktive Tisch-Design vorgeladen wird.)
  runBootLoader();
  wireHome();
  wireLegal();
  showConsentIfNeeded();
  showScreen('home-view');
  await handleAuthRedirect();   // ggf. E-Mail-Bestätigung aus der URL verarbeiten
  await handleJoinLink();       // ggf. Einladungs-Link (?join=CODE) verarbeiten
  // Wer den Online-Modus schon genutzt hat, empfaengt Einladungen auch ohne
  // eigene Aktion (im Hintergrund, blockiert die Startseite nicht).
  if (localStorage.getItem('wizard_online')) startInviteWatch();
  // Keine Auto-Wiederaufnahme: man landet auf der Startseite, kann ein
  // pausiertes/offenes Spiel aber per "Weiterspielen" fortsetzen.
  refreshResume();
  window.addEventListener('wiz-resume-refresh', refreshResume);

  // Verpasste Realtime-Events nach Sichtbarkeit/Fokus nachziehen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleReload();
  });

  // Kartenbilder im Hintergrund vorladen (Bilder unveraendert), damit sie im
  // Spiel sofort erscheinen – ohne den Seitenstart zu blockieren.
  const warm = () => preloadCards();
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1500);

  // Kristall-Paket gekauft (StoreKit approved) -> Server schreibt gut (mit
  // Transaktions-Dedupe). Wirft die Gutschrift einen Fehler, bleibt die
  // Transaktion offen und StoreKit versucht es beim naechsten Start erneut.
  onConsumable(async (productId, txId) => {
    const m = await db();
    await m.ensureAuth();
    const r = await m.grantIapPack(productId, txId);
    if (!r?.ok) throw new Error(r?.message || 'Gutschrift fehlgeschlagen');
    walletCache.crystals = r.crystals ?? walletCache.crystals;
    if (!r.duplicate) toast(`+${nf(r.granted)} Kristalle 💎 Danke!`, 'ok');
    if (document.getElementById('pane-shop')?.classList.contains('active')) renderShop();
  });

  // In-App-Kauf (StoreKit) initialisieren – erkennt einen frueheren Werbefrei-
  // Kauf, BEVOR Werbung geladen wird. Danach Werbung + Banner (nur native App).
  initIAP().finally(() => initAds().then(showBanner));

  // Sobald StoreKit Produktinfos/Preise nachlaedt oder sich der Besitz aendert,
  // den Shop neu rendern (falls gerade offen) -> echte Preise erscheinen live.
  window.addEventListener('iap-updated', () => {
    if (document.getElementById('pane-shop')?.classList.contains('active')) loadShop();
  });

  // Inhaber-Konto (eingeloggt) ggf. komplett freischalten.
  checkOwnerUnlock();

  // Spielsteine-Pille aktuell halten (Verbrauch/Erstattung/Tageswechsel).
  window.addEventListener('wiz-tokens-changed', refreshTokenPill);
  refreshTokenPill();
  refreshChestList();   // Truhen-Badge in der unteren Leiste (best-effort)

  // E-Mail-Bestaetigung: klickt der Nutzer den Link, kehrt er per Deep-Link
  // (zaubertisch://auth-callback...) in die App zurueck. Session aus der URL
  // setzen, UI aktualisieren, auf die Startseite leiten – statt Fehlerseite.
  const CapApp = window.Capacitor?.Plugins?.App;
  if (CapApp?.addListener) {
    const handleAuthUrl = async (url) => {
      if (!url || !/(access_token|[?&]code=|token_hash|auth-callback)/.test(url)) return;
      try {
        const m = await db();
        if (!(await m.completeAuthFromUrl(url))) return;
        state.uid = await m.currentUid();
        try { await m.upsertProfile($('#name-input')?.value.trim() || null); } catch (_) {}
        resetInviteWatch(); startInviteWatch();
        try { await loadProfilePane(m); } catch (_) {}
        switchPane('lobby');
        toast('E-Mail bestätigt – du bist angemeldet! 🎉', 'ok');
      } catch (_) {}
    };
    CapApp.addListener('appUrlOpen', (data) => handleAuthUrl(data?.url || ''));
    // Kaltstart per Bestaetigungslink: die Start-URL nachreichen.
    CapApp.getLaunchUrl?.().then(res => { if (res?.url) handleAuthUrl(res.url); }).catch(() => {});
  }

  // Dezenter Klick-Sound für Lobby-Aktionen (nur auf der Startseite – im Spiel
  // sorgen die eigenen Spiel-Sounds für Rückmeldung).
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('button.btn, .tab, .icon-btn, .legal-link, .modal-x, .switch');
    if (!el) return;
    const home = document.getElementById('home-view');
    if (home && home.classList.contains('active')) sfxTap();
  }, true);

  // Hintergrundmusik erst nach der ersten Nutzer-Interaktion starten
  // (Browser-Autoplay-Regeln). Nur, wenn sie nicht ausgeschaltet wurde.
  const kick = () => { startMusic(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  window.addEventListener('pointerdown', kick, { once: false });
  window.addEventListener('keydown', kick, { once: false });
}

init();
