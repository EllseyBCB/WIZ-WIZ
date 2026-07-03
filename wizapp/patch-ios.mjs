// Traegt die AdMob-Pflichteintraege automatisch in die Info.plist des
// iOS-Projekts ein (laeuft via npm-Script nach `cap sync`). Idempotent:
// vorhandene Eintraege werden aktualisiert, nichts wird doppelt angelegt.
// So muss auf dem Mac NICHTS von Hand in Xcode editiert werden.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const PLIST = 'ios/App/App/Info.plist';
const PODFILE = 'ios/App/Podfile';
const PODLOCK = 'ios/App/Podfile.lock';

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

// 3b) URL-Schema fuer Deep-Links: nach der E-Mail-Bestaetigung kehrt der Nutzer
//     ueber zaubertisch://auth-callback zurueck in die App (statt Fehlerseite).
if (!s.includes('<key>CFBundleURLTypes</key>')) {
  s = s.replace(/<\/dict>\s*<\/plist>\s*$/,
    `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n` +
    `\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>de.alphablueprint.zaubertisch</string>\n` +
    `\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>zaubertisch</string>\n\t\t\t</array>\n` +
    `\t\t</dict>\n\t</array>\n</dict>\n</plist>\n`);
}

// 3c) Nur Hochformat erlauben (kein Querformat) – iPhone: Portrait; iPad:
//     Portrait + Portrait-Upside-Down (beides "hochkant"). Idempotent.
const PORTRAIT_PHONE = `\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n`
  + `\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>`;
const PORTRAIT_PAD = `\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n`
  + `\t\t<string>UIInterfaceOrientationPortrait</string>\n`
  + `\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t</array>`;
s = s.replace(/\t<key>UISupportedInterfaceOrientations<\/key>\s*<array>[\s\S]*?<\/array>/, PORTRAIT_PHONE);
s = s.replace(/\t<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>/, PORTRAIT_PAD);

if (s !== before) {
  writeFileSync(PLIST, s);
  console.log('patch-ios: Info.plist aktualisiert (AdMob-App-ID, ATT-Text, SKAdNetworkItems, URL-Schema, nur Hochformat).');
} else {
  console.log('patch-ios: Info.plist ist bereits aktuell.');
}

// 4) GoogleUserMessagingPlatform (UMP) auf 2.x pinnen.
//    @capacitor-community/admob 6.2.0 nutzt die alte UMP*-API (UMPConsentStatus
//    usw.). UMP 3.0 hat diese Symbole umbenannt -> Build-Fehler
//    "'UMPConsentStatus' has been renamed to 'ConsentStatus'". Der Pin auf ~> 2.0
//    haelt die kompatible SDK-Version (Google-Mobile-Ads-SDK verlangt nur >= 1.1).
//    Laeuft nach `cap sync` (also nach dem ersten pod install), deshalb ziehen
//    wir bei Bedarf einen `pod install`/`pod update` selbst nach. Idempotent.
if (existsSync(PODFILE)) {
  const UMP_PIN = "  pod 'GoogleUserMessagingPlatform', '~> 2.0'";
  let pf = readFileSync(PODFILE, 'utf8');
  let podfileChanged = false;

  if (!pf.includes("pod 'GoogleUserMessagingPlatform'")) {
    // In den `target 'App' do`-Block einfuegen (nach `capacitor_pods`).
    if (/^\s*capacitor_pods\s*$/m.test(pf)) {
      pf = pf.replace(/^(\s*capacitor_pods\s*)$/m, `$1\n${UMP_PIN}`);
    } else {
      pf = pf.replace(/(target 'App' do\s*\n)/, `$1${UMP_PIN}\n`);
    }
    writeFileSync(PODFILE, pf);
    podfileChanged = true;
    console.log('patch-ios: UMP-Pin (~> 2.0) in Podfile eingetragen.');
  }

  // Prueft, ob die Lock-Datei noch auf UMP 3.x steht (oder fehlt).
  const lockOnV3 = !existsSync(PODLOCK) ||
    /GoogleUserMessagingPlatform \(3\./.test(readFileSync(PODLOCK, 'utf8'));

  if (podfileChanged || lockOnV3) {
    const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
    // Homebrew-CocoaPods sicher auf den PATH.
    env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;
    console.log('patch-ios: pod update GoogleUserMessagingPlatform (UMP 2.x wird gezogen)...');
    try {
      execSync('pod update GoogleUserMessagingPlatform', {
        cwd: 'ios/App', env, stdio: 'inherit',
      });
    } catch (e) {
      console.warn('patch-ios: pod update fehlgeschlagen – bitte manuell `pod install` in ios/App ausfuehren.');
    }
  } else {
    console.log('patch-ios: UMP-Pin bereits aktiv, Podfile.lock ok.');
  }
}
