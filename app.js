// Einstieg: Routing, Solo-Modus, Online-Aktionen -> RPCs, Realtime -> Re-Render.
// Wichtig: db.js (laedt Supabase aus dem Netz) wird NUR bei Bedarf dynamisch
// importiert. So bleibt der Solo-Modus auch ohne Netz/Supabase voll spielbar.
import { render } from './game.js?v=52';
import { startLocal, resumeLocal, hasSoloSave } from './local.js?v=41';
import { preloadCards } from './cards.js?v=14';
import { initAds, showBanner, hideBanner, isAdFree, setAdFree, isPreview, setPreview } from './ads.js?v=3';
import { initIAP, purchaseAdFree, purchaseProduct, restorePurchases, iapAvailable } from './iap.js?v=2';
import { AVATAR_ITEMS, TABLE_ITEMS, SHOP_ADFREE, SHOP_BUNDLE, isOwned, avatarItem, avatarOwned,
         isDevUnlock, grantOwned, myAvatar,
         getTableTheme, setTableTheme, applyTableTheme,
         isOwnerEmail, ownerUnlock, setOwnerUnlock } from './cosmetics.js?v=4';
import { startMusic, setEnabled as setMusicEnabled, setVolume as setMusicVolume, isEnabled as musicEnabled, getVolume as musicVolume,
         sfxCard, sfxBid, sfxTrick, sfxDeal, sfxTurn, sfxTap, haptic, setSfx, sfxEnabled, setSfxVolume, getSfxVolume } from './audio.js?v=4';
import { $, showScreen, toast, esc } from './ui.js?v=2';

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
const db = async () => (DB ||= await import('./db.js?v=3'));

// --- Aktionen (an game.js uebergeben) --------------------------------------
const actions = {
  onStart:  () => guarded(async (m) => m.startGame(state.gameId)),
  onLeave:  () => guarded(async (m) => { await m.leaveGame(state.gameId); goHome(); }),
  onAbort:  () => guarded(async (m) => m.abortGame(state.gameId)),
  onTrump:  (c) => guarded(async (m) => m.chooseTrump(state.gameId, c)),
  onBid:    (n) => { sfxBid(); haptic(12); return guarded(async (m) => m.placeBid(state.gameId, n)); },
  onPlay:   (card) => { haptic(15); return guarded(async (m) => m.playCard(state.gameId, card)); },
  onPause:  () => pauseOnline(),
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
  if (myTurn && !myTurnPrev) { sfxTurn(); haptic(20); notifyYourTurn(); }
  myTurnPrev = myTurn;
}

function stateSig(game, players, hand, trick, scores) {
  return JSON.stringify([
    game.status, game.phase, game.current_seat, game.lead_seat, game.led_color,
    game.round_no, game.trick_no, game.trump_color, game.trump_card, game.trump_pending,
    game.num_players, game.total_rounds, game.dealer_seat, game.join_code,
    players.map(p => [p.seat, p.name, p.bid, p.tricks_won, p.total_score, p.connected, p.is_host]),
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
  const done = trickJustCompleted(game);
  if (done) { await showTrickResult(m, done); return; }

  prevSnap = { round: game.round_no, trick: game.trick_no, phase: game.phase };
  // Nur neu zeichnen, wenn sich wirklich etwas geaendert hat.
  const sig = stateSig(game, state.players, state.hand, state.trick, state.scores);
  if (sig === lastRenderSig) return;
  lastRenderSig = sig;
  render(state, actions);
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
  el.innerHTML = '🏆 <b>' + esc(name) + '</b><br>gewinnt den Stich';
  el.classList.add('show');
}
function hideTrickBanner() { const el = document.getElementById('trick-banner'); if (el) el.classList.remove('show'); }

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
  hideBanner();                                                  // im Spiel kein Banner
  localStorage.setItem(LS_GAME, gameId);
  if (unsubscribe) unsubscribe();
  unsubscribe = await m.subscribe(gameId, {
    onGame: scheduleReload, onPlayers: scheduleReload,
    onPlays: scheduleReload, onScores: scheduleReload
  });
  // Sicherheitsnetz: regelmaessig nachladen, falls ein Realtime-Event ausbleibt.
  clearInterval(pollTimer);
  pollTimer = setInterval(() => reloadAll().catch(() => {}), 5000);
  await reloadAll();
  showScreen('game-view');
}

function goHome() {
  clearInterval(pollTimer); pollTimer = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  lastRenderSig = null; prevSnap = null; holdingTrick = false;
  hideTrickBanner();
  state.gameId = null; state.game = null;
  state.players = []; state.hand = []; state.trick = []; state.scores = [];
  localStorage.removeItem(LS_GAME);
  showScreen('home-view');
  refreshResume();
  showBanner();
}

// Pausieren (Online): Verbindung trennen, ABER den Spielplatz merken, damit man
// ueber "Weiterspielen" zurueckkommt. Der Spielstand bleibt auf dem Server.
function pauseOnline() {
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
  $('#act-solo').onclick = () => { if (hasSoloSave()) resumeSoloUI(); else toast('Kein pausiertes Solo-Spiel.', 'info'); };
  $('#resume-big').onclick = () => {
    if (localStorage.getItem(LS_GAME)) resumeOnline();
    else if (hasSoloSave()) resumeSoloUI();
    else toast('Kein pausiertes Spiel vorhanden.', 'info');
  };
  // Avatar in der Namensbox: zeigt das eigene Bild, Tipp führt ins Profil.
  const homeAv = $('#home-avatar');
  if (homeAv) {
    const av = localStorage.getItem('wizard_my_avatar');
    if (av && /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(av)) homeAv.innerHTML = `<img src="${esc(avV(av))}" alt="">`;
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

  // Solo: braucht WEDER Anmeldung NOCH Supabase.
  $('#local-btn').onclick = () => {
    clearInterval(pollTimer); pollTimer = null;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const name = nameInput.value.trim() || 'Du';
    const bots = parseInt($('#bot-count').value, 10);
    closeLobbyModals();
    startLocal(bots, name, $('#difficulty').value);
  };

  $('#create-btn').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    m.upsertProfile(name).catch(() => {});   // Profilname fuer die Freundesliste pflegen
    const max = parseInt($('#max-players').value, 10);
    try {
      const code = await m.createGame(name, max);
      const gameId = await m.joinGame(code, name);   // eigene Spiel-ID holen
      closeLobbyModals();
      await enterGame(gameId);
      toast('Spiel erstellt – Code: ' + code, 'ok');
    } catch (e) { toast(e.message || 'Fehler', 'err'); }
  };

  $('#join-btn').onclick = async () => {
    const name = nameInput.value.trim();
    const code = $('#code-input').value.trim().toUpperCase();
    if (!name) { toast('Bitte Namen eingeben', 'err'); return; }
    if (!code) { toast('Bitte Code eingeben', 'err'); return; }
    const m = await ensureOnline();
    if (!m) return;
    m.upsertProfile(name).catch(() => {});   // Profilname fuer die Freundesliste pflegen
    try {
      const gameId = await m.joinGame(code, name);
      closeLobbyModals();
      await enterGame(gameId);
    } catch (e) { toast(e.message || 'Fehler', 'err'); }
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
    ? 'In-App-Käufe sind in dieser Version noch nicht freigeschaltet (RevenueCat-Einrichtung nötig) – hier siehst du die Vorschau.'
    : 'Käufe sind nur in der App möglich – hier siehst du die Vorschau.';
}

// Shop: Werbefrei + Magier-Bundle + Premium-Avatare. Echte Käufe per IAP nur in
// der nativen App; im Browser Vorschau + Hinweis (mit ?shop=dev zum Testen frei).
function loadShop() {
  const grid = document.getElementById('shop-grid');
  const hint = document.getElementById('shop-hint');
  if (!grid) return;
  checkOwnerUnlock();   // Inhaber-Konto ggf. freischalten (rendert danach neu)
  const canBuy = iapAvailable() || isDevUnlock() || ownerUnlock();
  if (hint) hint.textContent = canBuy ? '' : iapUnavailableHint();

  const equipped = myAvatar();
  const curTable = getTableTheme();
  const cardAdfree = shopFeatureCard(SHOP_ADFREE);
  const cardBundle = shopFeatureCard(SHOP_BUNDLE);
  const avatarCards = AVATAR_ITEMS.map(it => shopAvatarCard(it, equipped)).join('');
  const tableCards = TABLE_ITEMS.map(it => shopTableCard(it, curTable)).join('');

  grid.innerHTML =
    `<div class="shop-sub">✦ Vorteile</div>` +
    `<div class="shop-feature">${cardAdfree}${cardBundle}</div>` +
    `<div class="shop-sub">✦ Tisch-Designs</div>` +
    `<div class="shop-tables">${tableCards}</div>` +
    `<div class="shop-sub">✦ Profilbilder</div>` +
    `<div class="shop-items">${avatarCards}</div>`;

  // Knöpfe verdrahten.
  grid.querySelectorAll('[data-buy]').forEach(b => {
    b.onclick = () => buyShopItem(b.dataset.buy);
  });
  grid.querySelectorAll('[data-equip]').forEach(b => {
    b.onclick = () => equipAvatar(b.dataset.equip);
  });
  grid.querySelectorAll('[data-equip-table]').forEach(b => {
    b.onclick = () => equipTable(b.dataset.equipTable);
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

function shopFeatureCard(item) {
  const owned = isOwned(item);
  const btn = owned
    ? `<button class="btn sekundaer" disabled>✓ Im Besitz</button>`
    : `<button class="btn" data-buy="${item.id}">${esc(item.price)}</button>`;
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
    btn = `<button class="btn" data-buy="${item.id}">${esc(item.price)}</button>`;
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
    btn = `<button class="btn" data-buy="${item.id}">${esc(item.price)}</button>`;
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
    toast('Kauf nicht möglich. Bitte später erneut versuchen.', 'err');
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
  try {
    let gid = state.gameId;
    const inLobby = gid && state.game && state.game.status === 'lobby';
    if (!inLobby) {
      const code = await m.createGame(name, 6);
      gid = await m.joinGame(code, name);
      await enterGame(gid);              // -> Warteraum
    }
    await m.inviteFriend(gid, f.uid);
    toast('Einladung an ' + (f.name || 'Freund:in') + ' gesendet', 'ok');
  } catch (e) {
    toast(e.message || 'Einladen fehlgeschlagen', 'err');
    if (btn) btn.disabled = false;
  }
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
  try {
    const gid = await m.joinGame(inv.code, currentName() || 'Spieler');
    await enterGame(gid);
  } catch (e) { toast(e.message || 'Beitreten fehlgeschlagen', 'err'); }
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

  // Werbefrei: echter In-App-Kauf via RevenueCat (nur native App). Im Browser/
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
        title: 'Zaubertisch – du bist dran! 🧙',
        body: 'Tippe, um weiterzuspielen.'
      }] }).catch(() => {});
    } catch (_) {}
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Zaubertisch – du bist dran! 🧙', { body: 'Tippe, um weiterzuspielen.', tag: 'wiz-turn', icon: './icon-192.png' });
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

async function init() {
  // Buttons sofort verdrahten – der Solo-Modus braucht keine Anmeldung.
  applyTableTheme();   // gewähltes Tisch-Design auf den Spieltisch anwenden
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

  // In-App-Kauf (RevenueCat) initialisieren – erkennt einen frueheren Werbefrei-
  // Kauf, BEVOR Werbung geladen wird. Danach Werbung + Banner (nur native App).
  initIAP().finally(() => initAds().then(showBanner));

  // Inhaber-Konto (eingeloggt) ggf. komplett freischalten.
  checkOwnerUnlock();

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
