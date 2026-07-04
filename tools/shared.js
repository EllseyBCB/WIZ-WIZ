// Wiz-Wiz Studio — gemeinsame Bausteine (OpenAI-Client, Stil, Dateinamen,
// Bild-Erzeugung). Wird von wizstudio.js und den create-*.js genutzt.
//
// Ziel-Ordner liegen in der Repo-WURZEL (tools/ liegt eine Ebene darunter):
//   cards/  avatars/  store-assets/  lobby/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');   // Repo-Wurzel

// Logische Ordner-Schluessel -> echter Ordnername (relativ zur Wurzel).
const FOLDERS = {
  cards:  'cards',
  avatars: 'avatars',
  store:  'store-assets',
  lobby:  'lobby',
};

// Einheitlicher Wiz-Wiz-Stil – wird IMMER an den Prompt angehaengt.
const STYLE = 'Stil: dunkler Fantasy-Look, lilane magische Kristalle, hochwertiges '
  + 'Mobile-Game-Asset, leuchtende Kanten, sauber freigestellt, moderner App-UI-Stil.';

// Test-Modus (kein echter API-Aufruf): per --dry oder WIZ_DRY_RUN=1.
function isDryRun() {
  return !!process.env.WIZ_DRY_RUN || process.argv.includes('--dry');
}

// Sauberer Dateiname: klein, Umlaute ausgeschrieben, Rest zu Bindestrichen.
function slugify(text) {
  return String(text).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // uebrige Akzente entfernen
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
}

// Anzahl aus dem Text lesen (erste Zahl). Ohne Zahl -> 5. Sicherheitslimit 50.
function parseCount(text) {
  const m = String(text).match(/\d+/);
  let n = m ? parseInt(m[0], 10) : 5;
  if (!Number.isFinite(n) || n < 1) n = 5;
  if (n > 50) n = 50;
  return n;
}

// Die (erste) Zahl aus dem Text entfernen -> uebrig bleibt das Motiv.
function stripCount(text) {
  const t = String(text).replace(/\d+/, '').trim();
  return t || String(text).trim();
}

// OpenAI-Client (lazy geladen, klare Fehlermeldungen).
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ist nicht gesetzt.  ->  export OPENAI_API_KEY="sk-..."');
  }
  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (_) { throw new Error('Paket "openai" fehlt.  ->  npm install openai'); }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Ein Bild erzeugen + speichern + Info-Zeilen ausgeben.
// Im --dry-Modus wird nichts erzeugt/gespeichert, nur die Vorschau gezeigt.
// size: '1024x1024' (Standard) oder '1024x1536' (Hochformat, z. B. Spielkarten).
// quality: 'low'|'medium'|'high' – Decks nutzen 'medium' (guenstig, fuer die
// Anzeigegroesse im Spiel voellig ausreichend).
async function generate({ label, prompt, folderKey, filename, size, quality }) {
  const dir = path.join(ROOT, FOLDERS[folderKey] || folderKey);
  const file = path.join(dir, filename);

  if (isDryRun()) {
    console.log('🧪 DRY-RUN – kein API-Aufruf, keine Datei geschrieben');
    console.log('✅ würde speichern unter: ' + file);
    console.log('🪄 Typ: ' + label);
    console.log('🎨 Prompt: ' + prompt);
    return file;
  }

  const openai = getClient();
  const req = { model: 'gpt-image-1', prompt, size: size || '1024x1024', n: 1 };
  if (quality) req.quality = quality;
  const result = await openai.images.generate(req);
  const b64 = result && result.data && result.data[0] && result.data[0].b64_json;
  if (!b64) throw new Error('Keine Bilddaten von der API erhalten.');

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));

  console.log('✅ gespeichert unter: ' + file);
  console.log('🪄 Typ: ' + label);
  console.log('🎨 Prompt: ' + prompt);
  return file;
}

module.exports = {
  ROOT, FOLDERS, STYLE,
  isDryRun, slugify, parseCount, stripCount, getClient, generate,
};
