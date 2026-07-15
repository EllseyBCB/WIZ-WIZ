// Erzeugt die 8 Loot-Belohnungsbilder (Truhen-Drops) mit OpenAI (gpt-image-1)
// und ueberschreibt die Platzhalter in lobby/. Aufruf (auf dem Mac):
//
//   export OPENAI_API_KEY="sk-..."
//   node tools/create-loot-bilder.js            # alle 8 Bilder
//   node tools/create-loot-bilder.js beutel     # nur Dateien, deren Name das Wort enthaelt
//
// Wichtig: Die Dateinamen muessen exakt so bleiben - die App laedt sie unter
// lobby/loot-*.png. Nach dem Erzeugen committen/pushen und in app.js die
// Konstante LOOT_IMG_V um 1 erhoehen (Cache-Bust), damit alle die neuen sehen.

const fs = require('fs');
const path = require('path');
const { getClient, STYLE, ROOT } = require('./shared');

const BASE = 'Einzelnes Belohnungs-Asset fuer ein Fantasy-Kartenspiel, Ansicht '
  + 'frontal leicht von oben, komplett freigestellt auf transparentem Hintergrund, '
  + 'keine Schrift, kein Rahmen. ';

const MOTIVE = {
  'loot-kristall':
    'Ein einzelner leuchtend lilaner magischer Kristall-Splitter mit weichem Glimmen.',
  'loot-muenze':
    'Eine einzelne glaenzende Goldmuenze mit Stern-Praegung, leichtes Funkeln.',
  'loot-beutel':
    'Ein kleiner offener Lederbeutel mit Zugband, in dem wenige leuchtend lilane '
    + 'magische Kristalle liegen und oben herausschauen.',
  'loot-beutel-gold':
    'Ein kleiner offener Lederbeutel mit Zugband, gefuellt mit wenigen glaenzenden '
    + 'Goldmuenzen, die oben herausschauen.',
  'loot-truhe-klein':
    'Eine kleine geoeffnete Holztruhe mit Goldbeschlaegen, darin liegen nur wenige '
    + 'leuchtend lilane magische Kristalle.',
  'loot-truhe-klein-gold':
    'Eine kleine geoeffnete Holztruhe mit Goldbeschlaegen, darin liegt ein kleiner '
    + 'Haufen glaenzender Goldmuenzen.',
  'loot-truhe-voll':
    'Eine geoeffnete Holztruhe mit Goldbeschlaegen, prall gefuellt mit einem Haufen '
    + 'leuchtend lilaner magischer Kristalle, leichtes magisches Glimmen.',
  'loot-truhe-voll-gold':
    'Eine geoeffnete Holztruhe mit Goldbeschlaegen, prall gefuellt mit einem grossen '
    + 'Haufen glaenzender Goldmuenzen, leichtes goldenes Glimmen.',
  'loot-truhe-episch':
    'Eine Holztruhe, die EXPLOSIONSARTIG aufplatzt: Der Deckel fliegt weg, aus allen '
    + 'Ecken und Rissen bricht grelles Licht, ueberall fliegen leuchtend lilane '
    + 'magische Kristalle durch die Luft, epische Lichtexplosion.',
  'loot-truhe-episch-gold':
    'Eine Holztruhe, die EXPLOSIONSARTIG aufplatzt: Der Deckel fliegt weg, aus allen '
    + 'Ecken und Rissen bricht grelles goldenes Licht, ueberall fliegen Goldmuenzen '
    + 'durch die Luft, epische Lichtexplosion.',
};

(async () => {
  const filter = (process.argv[2] || '').toLowerCase();
  const openai = getClient();
  const dir = path.join(ROOT, 'lobby');
  for (const [name, motiv] of Object.entries(MOTIVE)) {
    if (filter && !name.includes(filter)) continue;
    process.stdout.write('🎨 ' + name + ' ... ');
    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt: BASE + motiv + ' ' + STYLE,
      size: '1024x1024',
      background: 'transparent',
      n: 1,
    });
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error('Keine Bilddaten fuer ' + name);
    fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
    console.log('✅ gespeichert: lobby/' + name + '.png');
  }
  console.log('Fertig. Jetzt in app.js LOOT_IMG_V um 1 erhoehen und committen.');
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
