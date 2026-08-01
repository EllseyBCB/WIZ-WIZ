// Namens-Moderation: verhindert beleidigende/diskriminierende Spielernamen,
// bevor sie gespeichert und fuer andere sichtbar werden (Rangliste, Lobby,
// Multiplayer). Wird client-seitig genutzt; die gleiche Logik gibt es zusaetzlich
// server-seitig als SQL-Funktion (siehe supabase/wizard_name_filter.sql).

export const NAME_REJECTED_MSG = 'Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.';

// Schwere, eindeutige Begriffe: werden als Teilzeichenkette im normalisierten
// Namen gesucht (auch mitten im Wort), da sie in echten Namen praktisch nie
// vorkommen. Deutsch + Englisch.
const SLUR_TERMS = [
  'nigger', 'nigga', 'niggr', 'negro', 'faggot', 'retard', 'wetback', 'sandnigger',
  'hurensohn', 'schwuchtel', 'schwuchtl', 'kanake', 'missgeburt', 'kinderficker',
  'judensau', 'judensau', 'judenvergasen', 'hakenkreuz', 'heilhitler', 'sieghail',
  'kanacke', 'untermensch', 'vergasen',
];

// Uebliche Schimpfwoerter/Slurs: werden wie SLUR_TERMS als Teilzeichenkette
// gesucht (z. B. faengt "hure" auch "huren"/"hurensohn" ab). Bewusste
// Entscheidung gegen Wortgrenzen-Pruefung, auch wenn dadurch vereinzelt
// harmlose Namen mit gleicher Buchstabenfolge (z. B. "Fagott") mitblockiert
// werden koennten -> Sicherheit geht hier vor.
const WORD_TERMS = [
  'fuck', 'fucker', 'shit', 'bullshit', 'cunt', 'bitch', 'whore', 'slut',
  'pussy', 'asshole', 'bastard', 'wanker', 'twat', 'prick', 'fag',
  'spic', 'kike', 'coon', 'gook', 'paki', 'dyke', 'tranny', 'chink', 'nazi', 'hitler',
  'neger', 'fotze', 'nutte', 'nutten', 'schlampe', 'hure', 'arsch', 'arschloch',
  'scheisse', 'scheiss', 'kacke', 'wichser', 'wixer', 'spast', 'spasti', 'mongo',
  'mongoloid', 'schwanz', 'schwuchtl', 'muschi', 'ficker', 'ficken', 'fick',
];

// Kurze/sehr haeufige Fragmente: nur als eigenstaendiges Wort gesperrt (nicht
// als Teilzeichenkette), sonst blockt "ass" auch "Sascha"/"Klassik"/"Massimo".
const WORD_BOUNDARY_TERMS = ['ass'];

// Leetspeak/Ersatzzeichen auf Buchstaben zurueckfuehren.
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '€': 'e', '!': 'i', '|': 'i' };

function normalize(s) {
  let out = '';
  for (const ch of String(s).toLowerCase()) {
    out += (LEET[ch] ?? ch);
  }
  // Nur Buchstaben behalten -> entfernt Leerzeichen/Sonderzeichen zwischen Buchstaben.
  return out.replace(/[^a-z]/g, '');
}

// Aufeinanderfolgende Wiederholungen daempfen (niiiigger -> niger / nigger),
// damit gestreckte Schreibweisen erkannt werden.
function collapse(s) {
  return s.replace(/(.)\1+/g, '$1');
}

// Name in normalisierte Einzelwoerter zerlegen (Wortgrenzen + camelCase) –
// nur noch fuer WORD_BOUNDARY_TERMS gebraucht.
function tokens(s) {
  return String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9@$€!|]+/)
    .map(normalize)
    .filter(Boolean);
}

// true = Name enthaelt einen gesperrten Begriff und ist NICHT erlaubt.
export function isNameBlocked(name) {
  if (!name) return false;
  const flat = normalize(name);
  if (!flat) return false;
  const flatC = collapse(flat);
  for (const t of [...SLUR_TERMS, ...WORD_TERMS]) {
    if (flat.includes(t) || flatC.includes(t) || flatC.includes(collapse(t))) return true;
  }
  const toks = tokens(name);
  const set = new Set(WORD_BOUNDARY_TERMS);
  for (const tok of toks) {
    if (set.has(tok) || set.has(collapse(tok))) return true;
  }
  return false;
}

// Bequemer Gegen-Check.
export const isNameAllowed = (name) => !isNameBlocked(name);
