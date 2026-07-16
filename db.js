// Datenzugriff: Supabase-Client, anonyme Anmeldung, RPC-Wrapper, Realtime.
// Exakt gepinnte Version -> reproduzierbare Builds (kein ueberraschendes
// Update durch den CDN). Bei Bedarf bewusst hochziehen und testen.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// Ziel des E-Mail-Bestaetigungslinks:
//  - native App  -> URL-Schema zaubertisch:// (oeffnet die App wieder)
//  - Browser/Web -> zurueck auf die aktuelle Web-Seite
// Beide muessen in Supabase unter Authentication -> URL Configuration ->
// Redirect URLs erlaubt sein. Das Schema ist in der iOS-Info.plist registriert
// (siehe wizapp/patch-ios.mjs).
export function authRedirect() {
  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (native) return 'zaubertisch://auth-callback';
  try { return location.origin + location.pathname; } catch (_) { return 'zaubertisch://auth-callback'; }
}

// --- Auth: anonyme Sitzung sicherstellen (stabile uid je Geraet) -----------
export async function ensureAuth() {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  // Realtime-Auth explizit setzen, damit RLS-geschuetzte Channels sofort
  // autorisiert sind (sonst verpasst der erste Abonnent Events, weil der
  // Socket noch als 'anon' verbunden ist).
  if (session?.access_token) {
    try { await supabase.realtime.setAuth(session.access_token); } catch (_) {}
  }
  return session?.user ?? null;
}

export async function currentUid() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// --- E-Mail-Login (optional; Solo/Gast bleibt ohne Anmeldung moeglich) ------
// Aktuelle Anmelde-Info: ist es ein Gast (anonym) oder ein E-Mail-Konto?
export async function authInfo() {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  return {
    uid: u?.id ?? null,
    email: u?.email ?? null,
    newEmail: u?.new_email ?? null,       // bei ausstehender Bestaetigung gesetzt
    isAnonymous: !!u?.is_anonymous
  };
}

// Konto erstellen / sichern. Ist gerade ein Gast aktiv, wird DESSEN Konto per
// updateUser zu einem E-Mail-Konto umgewandelt -> gleiche uid, Profil/Freunde/
// Verlauf bleiben erhalten (Supabase schickt eine Bestaetigungs-Mail).
export async function signUpEmail(email, password) {
  const { data: { session } } = await supabase.auth.getSession();
  const u = session?.user;
  if (u && u.is_anonymous) {
    const { data, error } = await supabase.auth.updateUser(
      { email, password }, { emailRedirectTo: authRedirect() });
    if (error) throw new Error(error.message);
    return { converted: true, user: data?.user ?? null };
  }
  const { data, error } = await supabase.auth.signUp(
    { email, password, options: { emailRedirectTo: authRedirect() } });
  if (error) throw new Error(error.message);
  return { converted: false, user: data?.user ?? null };
}

// Nach Klick auf den Bestaetigungslink kehrt der Nutzer per Deep-Link
// (zaubertisch://auth-callback...) in die App zurueck. Diese Funktion setzt aus
// der URL die Session (Tokens im #Hash, PKCE-?code oder ?token_hash). Liefert
// true, wenn danach eine gueltige Session besteht.
export async function completeAuthFromUrl(url) {
  try {
    const u = new URL(url);
    const hash = new URLSearchParams((u.hash || '').replace(/^#/, ''));
    const at = hash.get('access_token');
    const rt = hash.get('refresh_token');
    if (at && rt) {
      const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
      if (error) throw error;
    } else if (u.searchParams.get('code')) {
      const { error } = await supabase.auth.exchangeCodeForSession(u.searchParams.get('code'));
      if (error) throw error;
    } else if (u.searchParams.get('token_hash') && u.searchParams.get('type')) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: u.searchParams.get('token_hash'),
        type: u.searchParams.get('type')
      });
      if (error) throw error;
    } else {
      return false;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      try { await supabase.realtime.setAuth(session.access_token); } catch (_) {}
    }
    return !!session;
  } catch (_) { return false; }
}

// In bestehendes E-Mail-Konto anmelden (z. B. auf einem neuen Geraet).
export async function signInEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (data.session?.access_token) {
    try { await supabase.realtime.setAuth(data.session.access_token); } catch (_) {}
  }
  return data;
}

// Abmelden -> beim naechsten Online-Zugriff wird wieder ein Gast-Konto erstellt.
export async function signOutEmail() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

// Konto + alle Daten unwiderruflich loeschen (DSGVO Art. 17 / Store-Pflicht).
// Serverseitige SECURITY-DEFINER-Funktion entfernt alle Zeilen der Person und
// das Auth-Konto; danach lokal abmelden.
export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw new Error(error.message);
  try { await supabase.auth.signOut(); } catch (_) {}
}

// Daten-Auskunft (DSGVO Art. 15): gespeicherte Daten der Person als Objekt.
export async function getMyData() {
  const [{ data, error }, info] = await Promise.all([
    supabase.rpc('get_my_data'),
    authInfo()
  ]);
  if (error) throw new Error(error.message);
  return { ...(data || {}), email: info.email, gast: info.isAnonymous };
}

// --- RPC-Wrapper (alle Aktionen laufen serverseitig) -----------------------
async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const createGame  = (name, max = 6)   => rpc('wizard_create_game', { p_name: name, p_max: max });
export const joinGame    = (code, name)      => rpc('wizard_join_game',   { p_code: code, p_name: name });
// Schnelle Runde (Matchmaking): offener Lobby beitreten oder neue eroeffnen.
export const quickMatch  = (name)            => rpc('wizard_quick_match', { p_name: name });
export const quickStart  = (gameId)          => rpc('wizard_quick_start', { p_game: gameId });
export const quickPing   = (gameId)          => rpc('wizard_quick_ping',  { p_game: gameId });
export const leaveGame   = (gameId)          => rpc('wizard_leave_game',  { p_game: gameId });
export const startGame   = (gameId)          => rpc('wizard_start_game',  { p_game: gameId });
export const chooseTrump = (gameId, color)   => rpc('wizard_choose_trump',{ p_game: gameId, p_color: color });
export const placeBid    = (gameId, bid)     => rpc('wizard_place_bid',   { p_game: gameId, p_bid: bid });
export const playCard    = (gameId, card)    => rpc('wizard_play_card',   { p_game: gameId, p_card: card });
export const abortGame   = (gameId)          => rpc('wizard_abort_game',  { p_game: gameId });
// Bots: Host fuegt in der Lobby Bot-Mitspieler hinzu; botAct stoesst den
// naechsten Bot-Zug an (Server denkt und spielt selbst).
export const addBot      = (gameId)          => rpc('wizard_add_bot',     { p_game: gameId });
export const removeBot   = (gameId, seat)    => rpc('wizard_remove_bot',  { p_game: gameId, p_seat: seat });
export const botAct      = (gameId)          => rpc('wizard_bot_act',     { p_game: gameId });

// --- Wirtschaft (Kristalle/Gold, serverseitig) -----------------------------
// Guthaben + Inventar holen. Liefert { crystals, gold, inventory:[item_id,...] }.
export async function getWallet() {
  const rows = await rpc('wizard_wallet');
  return rows?.[0] || { crystals: 0, gold: 0, inventory: [] };
}
// Kosmetik mit Waehrung kaufen (Preis kommt serverseitig aus dem Katalog).
// Liefert { ok, crystals, gold, message }.
export async function buyItem(itemId) {
  const rows = await rpc('wizard_buy_item', { p_item_id: itemId });
  return rows?.[0] || { ok: false, message: 'Fehler' };
}
// Verbrauchs-Notizblock-Paket kaufen (wiederholbar). { ok, crystals, gold, granted, message }.
export async function buyTokens(packId) {
  const rows = await rpc('wizard_buy_tokens', { p_pack_id: packId });
  return rows?.[0] || { ok: false, granted: 0, message: 'Fehler' };
}

// --- Truhen (Loot) ---------------------------------------------------------
// Ungeoeffnete Truhen: [{ id, rarity, source, ref, created_at }, ...].
export const listChests = () => rpc('wizard_list_chests');
// Taegliche Gratis-Truhe holen. { ok, chest_id, rarity, message }.
export async function claimDailyChest() {
  const rows = await rpc('wizard_claim_daily_chest');
  return rows?.[0] || { ok: false, message: 'Fehler' };
}
// Truhe drehen (Tipp): kleine Chance auf eine bessere Truhe.
// { ok, rarity, upgraded, spins }  (max. 3 Drehungen je Truhe)
export async function spinChest(chestId) {
  const rows = await rpc('wizard_spin_chest', { p_chest_id: chestId });
  return rows?.[0] || { ok: false, upgraded: false };
}
// Truhe oeffnen (v2: mehrere Drops).
// { ok, rewards:[{t:'crystals'|'gold'|'item', n?, item_id?, kind?}], new_crystals, new_gold, rarity, message }.
export async function openChest(chestId) {
  const rows = await rpc('wizard_open_chest', { p_chest_id: chestId });
  return rows?.[0] || { ok: false, rewards: [], message: 'Fehler' };
}
// Truhe mit Kristallen kaufen. { ok, chest_id, crystals, message }.
export async function buyChest(rarity) {
  const rows = await rpc('wizard_buy_chest', { p_rarity: rarity });
  return rows?.[0] || { ok: false, message: 'Fehler' };
}

// --- Profil / Freunde / Verlauf -------------------------------------------
export const upsertProfile = (name, avatar) =>
  rpc('wizard_upsert_profile', { p_name: name ?? null, p_avatar: avatar ?? null });

// Eigenes Profilbild hochladen (in den eigenen uid-Ordner) und oeffentliche
// URL zurueckgeben. blob = bereits zugeschnittenes JPEG.
export async function uploadAvatar(blob) {
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) throw new Error('Nicht angemeldet');
  const path = `${uid}/avatar.jpg`;
  const { error } = await supabase.storage.from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now();   // Cache-Buster nach Neu-Upload
}
export const addFriend     = (code)  => rpc('wizard_add_friend',     { p_code: code });
export const removeFriend  = (uid)   => rpc('wizard_remove_friend',  { p_friend: uid });
export const listFriends   = ()      => rpc('wizard_list_friends');
export const matchHistory  = ()      => rpc('wizard_match_history');
export const leaderboard   = ()      => rpc('wizard_leaderboard');

// --- Einladungen -----------------------------------------------------------
export const inviteFriend   = (gameId, friendUid) =>
  rpc('wizard_invite_friend', { p_game: gameId, p_friend: friendUid });
export const pendingInvites = ()   => rpc('wizard_pending_invites');
export const declineInvite  = (id) => rpc('wizard_decline_invite', { p_id: id });

// --- Gruppen ---------------------------------------------------------------
export const createGroup       = (name)           => rpc('wizard_create_group', { p_name: name });
export const addGroupMember    = (group, friend)  => rpc('wizard_add_group_member', { p_group: group, p_friend: friend });
export const leaveGroup        = (group)          => rpc('wizard_leave_group', { p_group: group });
export const removeGroupMember = (group, member)  => rpc('wizard_remove_group_member', { p_group: group, p_member: member });
export const listGroups        = ()               => rpc('wizard_list_groups');
export const groupStandings    = (group)          => rpc('wizard_group_standings', { p_group: group });

// Realtime: neue Einladungen an mich (to_uid) sofort empfangen.
export async function subscribeInvites(uid, onInvite) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await supabase.realtime.setAuth(session.access_token);
  } catch (_) {}
  const ch = supabase.channel('wizard:invites:' + uid);
  ch.on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'wizard_invites', filter: `to_uid=eq.${uid}` },
    (payload) => onInvite?.(payload.new));
  ch.on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'wizard_invites', filter: `to_uid=eq.${uid}` },
    (payload) => onInvite?.(payload.new));
  ch.subscribe();
  return () => supabase.removeChannel(ch);
}

// --- Lese-Helfer -----------------------------------------------------------
export async function loadGame(gameId) {
  const { data, error } = await supabase
    .from('wizard_games').select('*').eq('id', gameId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadPlayers(gameId) {
  const { data, error } = await supabase
    .from('wizard_players').select('*').eq('game_id', gameId).order('seat');
  if (error) throw new Error(error.message);
  return data;
}

// Profilbilder/Avatare aller Mitspieler eines Spiels (RPC umgeht die
// Profil-RLS sicher: nur Mitglieder desselben Spiels erhalten die Avatare).
export const memberAvatars = (gameId) => rpc('wizard_member_avatars', { p_game: gameId });

export async function loadHand(gameId, roundNo) {
  const { data, error } = await supabase
    .from('wizard_hands').select('card, played')
    .eq('game_id', gameId).eq('round_no', roundNo).order('card');
  if (error) throw new Error(error.message);
  return data;
}

export async function loadTrick(gameId, roundNo, trickNo) {
  const { data, error } = await supabase
    .from('wizard_plays').select('*')
    .eq('game_id', gameId).eq('round_no', roundNo).eq('trick_no', trickNo)
    .order('play_order');
  if (error) throw new Error(error.message);
  return data;
}

export async function loadScores(gameId) {
  const { data, error } = await supabase
    .from('wizard_round_scores').select('*')
    .eq('game_id', gameId).order('round_no').order('seat');
  if (error) throw new Error(error.message);
  return data;
}

// --- Realtime: oeffentliche Tabellen abonnieren ----------------------------
// handlers: { onGame, onPlayers, onPlays, onScores } – jeweils ohne Argument,
// der Aufrufer laedt die betroffenen Daten frisch nach.
export async function subscribe(gameId, handlers) {
  // Vor dem Abonnieren sicherstellen, dass der Realtime-Socket das aktuelle
  // Token nutzt – sonst werden RLS-geschuetzte Events nicht zugestellt.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) await supabase.realtime.setAuth(session.access_token);
  } catch (_) {}
  const ch = supabase.channel('wizard:' + gameId);
  const f = `game_id=eq.${gameId}`;
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'wizard_games', filter: `id=eq.${gameId}` },
        () => handlers.onGame?.());
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'wizard_players', filter: f },
        () => handlers.onPlayers?.());
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'wizard_plays', filter: f },
        () => handlers.onPlays?.());
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'wizard_round_scores', filter: f },
        () => handlers.onScores?.());
  ch.subscribe();
  return () => supabase.removeChannel(ch);
}
