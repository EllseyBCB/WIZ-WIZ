// Wiz-Wiz Studio — KOMPLETTES Kartendeck erzeugen (60 Karten -> cards/decks/<slug>/).
// Erzeugt alle Dateien direkt spielfertig benannt (R1..R13, Y.., G.., B.., Z1..Z4,
// N1..N4) im Hochformat. Bereits vorhandene Dateien werden uebersprungen – ein
// abgebrochener Lauf kann also einfach erneut gestartet werden.
//
//   node tools/wizstudio.js deck "Feuer"            -> cards/decks/feuer/
//   node tools/wizstudio.js deck "Eis" --dry        -> Vorschau ohne API/Kosten
//
// Danach (siehe INTEGRATION.md): Vorschaubild lobby/deck-<slug>.png ablegen,
// Katalog-Zeile in shop-catalog.js mit folder='cards/decks/<slug>' eintragen,
// Server-Zeile in supabase/wizard_catalog_seed.sql aktivieren.
const fs = require('fs');
const path = require('path');
const { ROOT, slugify, generate, isDryRun } = require('./shared');

// Farb-/Symbolwelt der App (passt zu cards.js: Rot=Flamme, Gelb=Sonne,
// Gruen=Blatt, Blau=Tropfen). Pro Farbe eine kurze Stimmungsbeschreibung.
const SUITS = {
  R: { name: 'Rot',  farbe: 'tiefrot',        symbol: 'stilisierte Flamme' },
  Y: { name: 'Gelb', farbe: 'goldgelb',       symbol: 'strahlende Sonne' },
  G: { name: 'Grün', farbe: 'smaragdgrün',    symbol: 'magisches Blatt' },
  B: { name: 'Blau', farbe: 'tiefblau',       symbol: 'leuchtender Wassertropfen' },
};

// Einheitlicher Deck-Stil. WICHTIG: Der Rahmen soll direkt an ALLEN vier
// Bildkanten liegen – so ist kein Nachschneiden noetig und alle Karten sind
// automatisch buendig und einheitlich.
function baseStyle(thema) {
  return `Hochformat-Spielkarte für ein magisches Fantasy-Kartenspiel, Thema „${thema}“. `
    + `Ein durchgehender, verzierter goldener Zierrahmen verläuft DIREKT entlang aller vier Bildkanten `
    + `(vollständig sichtbar, nichts abgeschnitten, kein Rand oder Hintergrund außerhalb des Rahmens). `
    + `Dunkler, edler Hintergrund mit feinen magischen Ornamenten und Sternenfunkeln. `
    + `Hochwertiges Mobile-Game-Asset, sauber, klar lesbar, einheitlicher Illustrationsstil.`;
}

function cardPrompt(thema, code) {
  const head = code[0];
  const style = baseStyle(thema);
  if (head === 'Z') {
    return `${style} Motiv: Porträt eines mächtigen Zauberers (Variante ${code[1]} von 4, jeweils andere Robenfarbe), `
      + `mit Zauberhut und leuchtendem Zauberstab. Oben links ein großes goldenes „Z“. Keine weiteren Zahlen oder Buchstaben.`;
  }
  if (head === 'N') {
    return `${style} Motiv: Porträt eines fröhlichen Hofnarren (Variante ${code[1]} von 4, jeweils andere Kostümfarbe), `
      + `mit Narrenkappe und Glöckchen. Oben links ein großes goldenes „N“. Keine weiteren Zahlen oder Buchstaben.`;
  }
  const s = SUITS[head];
  const rank = code.slice(1);
  return `${style} Farbwelt der Karte: ${s.farbe} (Spielfarbe ${s.name}). `
    + `Zentrales Emblem: ${s.symbol}, groß und mittig, im Stil des Themas „${thema}“. `
    + `Oben mittig eine große goldene Ziffer „${rank}“; unten rechts dieselbe Ziffer „${rank}“ klein. `
    + `Oben links und unten rechts ein kleines ${s.symbol}-Symbol als Eckzeichen. `
    + `WICHTIG: Die Ziffer „${rank}“ exakt so schreiben, keine anderen Zahlen auf der Karte.`;
}

// Alle 60 Codes in Spiel-Reihenfolge.
function allCodes() {
  const codes = [];
  for (const c of ['R', 'Y', 'G', 'B']) for (let r = 1; r <= 13; r++) codes.push(c + r);
  for (let i = 1; i <= 4; i++) codes.push('Z' + i);
  for (let i = 1; i <= 4; i++) codes.push('N' + i);
  return codes;
}

async function createDeck(description) {
  const thema = description.trim();
  const slug = slugify(thema);
  const folderKey = path.join('cards', 'decks', slug);   // generate() nutzt den Pfad direkt
  const dir = path.join(ROOT, folderKey);
  const codes = allCodes();

  const existing = codes.filter(c => fs.existsSync(path.join(dir, c + '.png')));
  const todo = codes.filter(c => !existing.includes(c));
  console.log(`Deck „${thema}“ -> ${folderKey}/  (${codes.length} Karten, `
    + `${existing.length} schon vorhanden, ${todo.length} zu erzeugen)\n`);

  let done = 0;
  for (const code of todo) {
    console.log(`— ${code}  (${done + existing.length + 1}/${codes.length}) —`);
    try {
      await generate({
        label: 'deck:' + slug,
        prompt: cardPrompt(thema, code),
        folderKey,
        filename: code + '.png',
        size: '1024x1536',
      });
      done++;
    } catch (err) {
      console.error(`❌ ${code} fehlgeschlagen:`, (err && err.message) || err);
    }
    console.log('');
  }

  console.log(`Fertig: ${done}/${todo.length} neu erzeugt (${existing.length} übersprungen).`);
  if (!isDryRun()) {
    console.log(`\nNächste Schritte (siehe INTEGRATION.md):`);
    console.log(`  1. Vorschaubild lobby/deck-${slug}.png ablegen (z. B. eine der Karten).`);
    console.log(`  2. shop-catalog.js, Sektion 'deck':`);
    console.log(`     I('deck_${slug}', 'deck', '${thema}', 800, 'crystals', 'rare', '🃏', 'lobby/deck-${slug}.png', '${folderKey}'),`);
    console.log(`  3. supabase/wizard_catalog_seed.sql: Zeile für 'deck_${slug}' aktivieren + ausführen.`);
  }
}

module.exports = { createDeck };
