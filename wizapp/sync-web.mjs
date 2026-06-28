// Kopiert die Web-App (Repo-Wurzel, eine Ebene ueber wizapp/) in den
// Capacitor-Web-Ordner (www). Laeuft automatisch vor jedem Build via npm-Scripts.
// Es werden NUR die echten Web-Dateien kopiert – kein wizapp/, supabase/, .git ...
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve('..');   // Repo-Wurzel
const DST = 'www';

const FILES = [
  'index.html', 'manifest.webmanifest',
  'app.js', 'ads.js', 'ai.js', 'audio.js', 'cards.js', 'config.js',
  'db.js', 'engine.js', 'game.js', 'iap.js', 'local.js', 'table.js', 'ui.js',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
];
const DIRS = ['cards', 'lobby'];

if (!existsSync(`${ROOT}/index.html`)) {
  console.error('Repo-Wurzel nicht gefunden – bitte aus dem Ordner wizapp/ ausfuehren.');
  process.exit(1);
}
if (!existsSync(`${ROOT}/config.js`)) {
  console.error('config.js fehlt in der Repo-Wurzel.');
  console.error('Bitte zuerst config.sample.js -> config.js kopieren und die Supabase-Werte eintragen.');
  process.exit(1);
}

if (existsSync(DST)) rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });

for (const f of FILES) {
  if (existsSync(`${ROOT}/${f}`)) cpSync(`${ROOT}/${f}`, `${DST}/${f}`);
  else console.warn('  (uebersprungen, fehlt):', f);
}
for (const d of DIRS) {
  if (existsSync(`${ROOT}/${d}`)) cpSync(`${ROOT}/${d}`, `${DST}/${d}`, { recursive: true });
}
console.log('Web-Dateien nach', DST + '/', 'kopiert.');
