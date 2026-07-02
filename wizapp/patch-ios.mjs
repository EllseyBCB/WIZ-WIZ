// Traegt die AdMob-Pflichteintraege automatisch in die Info.plist des
// iOS-Projekts ein (laeuft via npm-Script nach `cap sync`). Idempotent:
// vorhandene Eintraege werden aktualisiert, nichts wird doppelt angelegt.
// So muss auf dem Mac NICHTS von Hand in Xcode editiert werden.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const PLIST = 'ios/App/App/Info.plist';

// Echte AdMob-App-ID (aus der AdMob-Konsole; muss zur ID in config.js passen).
const ADMOB_APP_ID = 'ca-app-pub-3811537285456646~2491168634';
const ATT_TEXT = 'Wird genutzt, um dir relevantere Werbung anzuzeigen.';
// SKAdNetwork-IDs (Google + gaengige Partner-Netzwerke laut AdMob-Doku).
const SKAD_IDS = [
  'cstr6suwn9.skadnetwork', '4fzdc2evr5.skadnetwork', '2fnua5tdw4.skadnetwork',
  'ydx93a7ass.skadnetwork', 'p78axxw29g.skadnetwork', 'v72qych5uu.skadnetwork',
  'ludvb6z3bs.skadnetwork', 'cp8zw746q7.skadnetwork', '3sh42y64q3.skadnetwork',
  'c6k4g5qg8m.skadnetwork', 's39g8k73mm.skadnetwork', '3qy4746246.skadnetwork',
  'hs6bdukanm.skadnetwork', 'mlmmfzh3r3.skadnetwork', 'v4nxqhlyqp.skadnetwork',
  'wzmmz9fp6w.skadnetwork', 'su67r6k2v3.skadnetwork', 'yclnxrl5pm.skadnetwork',
  't38b2kh725.skadnetwork', '7ug5zh24hu.skadnetwork', 'gta9lk7p23.skadnetwork',
  'vutu7akeur.skadnetwork', 'y5ghdn5j9k.skadnetwork', 'n6fk4nfna4.skadnetwork',
  'v9wttpbfk9.skadnetwork', 'n38lu8286q.skadnetwork', '47vhws6wlr.skadnetwork',
  'kbd757ywx3.skadnetwork', '9t245vhmpl.skadnetwork', 'eh6m2bh4zr.skadnetwork',
  'a2p9lx4jpn.skadnetwork', '22mmun2rn5.skadnetwork', '4468km3ulz.skadnetwork',
  '2u9pt9hc89.skadnetwork', '8s468mfl3y.skadnetwork', 'klf5c3l5u5.skadnetwork',
  'ppxm28t8ap.skadnetwork', 'ecpz2srf59.skadnetwork', 'uw77j35x4d.skadnetwork',
  'pwa73g5rt2.skadnetwork', 'mtkv5xtk9e.skadnetwork', '4pfyvq9l8r.skadnetwork',
  'tl55sbb4fm.skadnetwork', '32z4fx6l9h.skadnetwork', 'rx5hdcabgc.skadnetwork',
];

if (!existsSync(PLIST)) {
  console.log('patch-ios: ios/-Projekt (noch) nicht vorhanden – zuerst `npm run add:ios`.');
  process.exit(0);
}

let s = readFileSync(PLIST, 'utf8');
const before = s;

// 1) GADApplicationIdentifier setzen bzw. auf die echte App-ID aktualisieren.
if (s.includes('<key>GADApplicationIdentifier</key>')) {
  s = s.replace(
    /(<key>GADApplicationIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${ADMOB_APP_ID}$2`
  );
} else {
  s = s.replace(/<\/dict>\s*<\/plist>\s*$/,
    `\t<key>GADApplicationIdentifier</key>\n\t<string>${ADMOB_APP_ID}</string>\n</dict>\n</plist>\n`);
}

// 2) App-Tracking-Transparency-Text (Pflicht fuer personalisierte Werbung).
if (!s.includes('<key>NSUserTrackingUsageDescription</key>')) {
  s = s.replace(/<\/dict>\s*<\/plist>\s*$/,
    `\t<key>NSUserTrackingUsageDescription</key>\n\t<string>${ATT_TEXT}</string>\n</dict>\n</plist>\n`);
}

// 3) SKAdNetworkItems (Attribution ohne Tracking; von AdMob empfohlen).
if (!s.includes('<key>SKAdNetworkItems</key>')) {
  const items = SKAD_IDS.map(id =>
    `\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>${id}</string>\n\t\t</dict>`
  ).join('\n');
  s = s.replace(/<\/dict>\s*<\/plist>\s*$/,
    `\t<key>SKAdNetworkItems</key>\n\t<array>\n${items}\n\t</array>\n</dict>\n</plist>\n`);
}

if (s !== before) {
  writeFileSync(PLIST, s);
  console.log('patch-ios: Info.plist aktualisiert (AdMob-App-ID, ATT-Text, SKAdNetworkItems).');
} else {
  console.log('patch-ios: Info.plist ist bereits aktuell.');
}
