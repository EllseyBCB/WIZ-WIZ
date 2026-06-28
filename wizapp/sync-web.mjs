// Kopiert die Web-App (../wizard) in den Capacitor-Web-Ordner (www).
// Vor jedem Build ausfuehren (passiert automatisch via npm-Scripts).
import { cpSync, rmSync, mkdirSync, existsSync } from 'fs';

const SRC = '../wizard';
const DST = 'www';

if (!existsSync(SRC)) {
  console.error('Quelle nicht gefunden:', SRC, '– bitte aus dem Ordner wizapp/ ausfuehren.');
  process.exit(1);
}
if (existsSync(DST)) rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true });
console.log('Web-Dateien nach', DST + '/', 'kopiert.');
