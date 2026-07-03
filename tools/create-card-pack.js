// Wiz-Wiz Studio — mehrere unterschiedliche Karten auf einmal (-> cards/).
// Anzahl wird aus dem Text gelesen (ohne Zahl: 5).
const { STYLE, slugify, parseCount, stripCount, generate } = require('./shared');

async function createCardPack(description) {
  const count = parseCount(description);
  const motiv = stripCount(description);
  const slug = slugify(motiv);

  console.log(`Erzeuge ${count} Karten … Motiv „${motiv}"\n`);

  let done = 0;
  for (let i = 1; i <= count; i++) {
    const prompt = `Sammelkarten-Artwork für ein Fantasy-Kartenspiel: ${motiv}. `
      + `Einzigartige Variante ${i} von ${count} – jede Karte deutlich unterschiedlich. `
      + `Hochkant-Spielkarte mit goldenem Rahmen, magischem Motiv und lila Leuchten. ${STYLE}`;
    const filename = `${slug}-${String(i).padStart(2, '0')}.png`;

    console.log(`— Karte ${i}/${count} —`);
    try {
      await generate({ label: 'card-pack', prompt, folderKey: 'cards', filename });
      done++;
    } catch (err) {
      console.error(`❌ Karte ${i}/${count} fehlgeschlagen:`, (err && err.message) || err);
    }
    console.log('');
  }
  console.log(`Fertig: ${done}/${count} Karten (Ordner "cards").`);
}

module.exports = { createCardPack };
