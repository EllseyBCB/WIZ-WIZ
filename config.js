// Supabase-Zugangsdaten fuer die Wizard-App (gleiches Projekt wie Kontoabgleich).
// Der Publishable-/anon-Key ist bewusst fuer den Client gedacht – die Daten
// werden serverseitig durch Row Level Security (RLS) geschuetzt.
export const SUPABASE_URL = 'https://mpvosmtsbvwasvnzjuwd.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_DGG2ulMkqrCUgUrwzy0KvQ_6pPlbqrq';

// Basis-Ordner fuer die Kartenbilder (Dateien als R1.png, B13.png, Z1.png, N4.png).
// './cards' = mitgeliefertes Deck. Leer = eingebaute SVG-Karten.
// Bei fehlendem/totem Bild greift automatisch die SVG-Karte.
export const CARD_IMAGE_BASE = './cards';

// In-App-Kauf "Werbefrei" via RevenueCat (nur native iOS-App).
// REVENUECAT_IOS_KEY = der oeffentliche Apple-SDK-Key aus dem RevenueCat-
// Dashboard (Project -> API keys, beginnt mit "appl_"). Leer lassen = IAP aus.
// IAP_ENTITLEMENT = Name des Entitlements in RevenueCat (z. B. "adfree").
// IAP_PRODUCT_ID  = Produkt-ID in App Store Connect (optional; sonst erstes Paket).
export const REVENUECAT_IOS_KEY = '';
export const IAP_ENTITLEMENT = 'adfree';
export const IAP_PRODUCT_ID = 'de.alphablueprint.zaubertisch.adfree';

// Weitere Shop-Angebote (alle Einmalkaeufe / Non-Consumables – kein Pay-to-Win,
// keine Zufallspakete). Das Magier-Bundle schaltet Werbefrei + alle Avatare frei.
// PRODUKT-ID je Avatar = IAP_AVATAR_PREFIX + <avatar-id> (in App Store Connect
// und RevenueCat unter diesen IDs anlegen). Entitlement je Avatar = 'av_<id>'.
export const IAP_AVATAR_PREFIX     = 'de.alphablueprint.zaubertisch.avatar.';
export const IAP_BUNDLE_PRODUCT_ID = 'de.alphablueprint.zaubertisch.bundle.magier';
export const IAP_BUNDLE_ENTITLEMENT = 'magier';

// --- AdMob (echte Werbung, nur native App) ----------------------------------
// Solange die Felder LEER sind, laufen automatisch Google-TEST-Anzeigen
// (kein Verdienst, aber gefahrlos). Nach dem Anlegen des AdMob-Kontos:
//   1. In der AdMob-Konsole App + zwei Anzeigenbloecke anlegen
//      (Banner + Interstitial) und die IDs hier eintragen.
//   2. Die App-ID (ca-app-pub-…~…) zusaetzlich in die Info.plist der
//      iOS-App eintragen (GADApplicationIdentifier – siehe wizapp/README.md).
//   3. app-ads.txt im Web-Root ausfuellen (siehe Datei app-ads.txt).
// Sobald hier echte IDs stehen, schaltet die App den Testmodus selbst ab.
// App-ID (fuer die Info.plist, GADApplicationIdentifier):
//   ca-app-pub-3811537285456646~2491168634
export const ADMOB = {
  bannerIos: 'ca-app-pub-3811537285456646/2063717240',
  interstitialIos: 'ca-app-pub-3811537285456646/1680573868',
  bannerAndroid: '',        // leer lassen, solange es keine Android-App gibt
  interstitialAndroid: '',
};
