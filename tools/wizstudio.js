// Wiz-Wiz Studio — zentrales CLI. Verteilt an die create-*.js-Werkzeuge.
//
// Vorbereitung (einmalig):
//   npm install openai
//   export OPENAI_API_KEY="sk-..."
//
// Nutzung:
//   node tools/wizstudio.js card      "Feuerdrache"
//   node tools/wizstudio.js card-pack "5 Feuerkarten"
//   node tools/wizstudio.js avatar    "Dunkler Magier"
//   node tools/wizstudio.js shop-item "Legendärer Kristall"
//
//   ... --dry   -> Test-Modus: zeigt Prompt + Zielpfad, ohne API-Aufruf.
//   node tools/wizstudio.js           -> Hilfe

const { createCard } = require('./create-card');
const { createCardPack } = require('./create-card-pack');
const { createAvatar } = require('./create-avatar');
const { createShopItem } = require('./create-shop-item');
const { createDeck } = require('./create-deck');
const { isDryRun } = require('./shared');

const COMMANDS = {
  'card':      createCard,
  'card-pack': createCardPack,
  'avatar':    createAvatar,
  'shop-item': createShopItem,
  'deck':      createDeck,
};

function help() {
  console.log(`
🪄  Wiz-Wiz Studio

Nutzung:
  node tools/wizstudio.js <befehl> "<beschreibung>"  [--dry]

Befehle:
  card       "<motiv>"        einzelne Karte            -> cards/
  card-pack  "<anzahl motiv>" mehrere Karten (Std. 5)   -> cards/
  avatar     "<motiv>"        Avatar-Portrait           -> avatars/
  shop-item  "<motiv>"        Shop-Item / Store-Asset   -> store-assets/
  deck       "<thema>"        KOMPLETTES Deck (60)      -> cards/decks/<slug>/

Beispiele:
  node tools/wizstudio.js card      "Feuerdrache"
  node tools/wizstudio.js card-pack "5 Feuerkarten"
  node tools/wizstudio.js avatar    "Dunkler Magier"
  node tools/wizstudio.js shop-item "Legendärer Kristall"
  node tools/wizstudio.js deck      "Feuer"

Test ohne Kosten:
  node tools/wizstudio.js card-pack "3 Eiskarten" --dry

Vorbereitung:
  npm install openai
  export OPENAI_API_KEY="sk-..."
`);
}

async function main() {
  // --dry aus den Argumenten herausfiltern (isDryRun liest process.argv direkt).
  const args = process.argv.slice(2).filter(a => a !== '--dry');
  const cmd = String(args[0] || '').trim().toLowerCase();
  const description = args.slice(1).join(' ').trim();

  if (!cmd) { help(); process.exit(0); }

  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`❌ Unbekannter Befehl "${args[0]}".`);
    console.error(`   Verfügbar: ${Object.keys(COMMANDS).join(', ')}`);
    help();
    process.exit(1);
  }
  if (!description) {
    console.error('❌ Bitte eine Beschreibung angeben, z. B.:');
    console.error(`   node tools/wizstudio.js ${cmd} "${cmd === 'card-pack' ? '5 ' : ''}deine Beschreibung"`);
    process.exit(1);
  }

  if (isDryRun()) console.log('🧪 Test-Modus (--dry): es wird nichts erzeugt.\n');

  await fn(description);
}

main().catch((err) => {
  console.error('❌ Fehler:', (err && err.message) || err);
  process.exit(1);
});
