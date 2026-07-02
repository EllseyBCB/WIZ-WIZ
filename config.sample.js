// Vorlage: nach `config.js` kopieren und mit den eigenen Werten fuellen.
// URL + Publishable-Key findest du im Supabase-Dashboard unter
// Project Settings -> API. Der Publishable-/anon-Key ist fuer den Client
// gedacht; die Daten sind serverseitig durch Row Level Security geschuetzt.
export const SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_DEIN_KEY';

// Basis-Ordner fuer die Kartenbilder, benannt nach Kartencode
// (R1.png, B13.png, Z1.png, N4.png ...). './cards' = mitgeliefertes Deck.
// Bleibt der Wert leer, werden die eingebauten SVG-Karten gezeichnet.
// Bei fehlendem/totem Bild wird automatisch auf SVG zurueckgefallen.
export const CARD_IMAGE_BASE = './cards';

// In-App-Kauf "Werbefrei" via RevenueCat (nur native iOS-App).
// REVENUECAT_IOS_KEY = oeffentlicher Apple-SDK-Key aus dem RevenueCat-Dashboard
// (Project -> API keys, beginnt mit "appl_"). Leer lassen = IAP aus.
// IAP_ENTITLEMENT = Entitlement-Name in RevenueCat (z. B. "adfree").
// IAP_PRODUCT_ID  = Produkt-ID in App Store Connect (optional; sonst erstes Paket).
export const REVENUECAT_IOS_KEY = '';
export const IAP_ENTITLEMENT = 'adfree';
export const IAP_PRODUCT_ID = 'de.alphablueprint.zaubertisch.adfree';

// Weitere Shop-Angebote (Einmalkaeufe): siehe config.js im Repo fuer die
// vollstaendigen Konstanten (Avatar-Pakete, Magier-Bundle).
export const IAP_AVATAR_PREFIX     = 'de.alphablueprint.zaubertisch.avatar.';
export const IAP_BUNDLE_PRODUCT_ID = 'de.alphablueprint.zaubertisch.bundle.magier';
export const IAP_BUNDLE_ENTITLEMENT = 'magier';

// --- AdMob (echte Werbung, nur native App) ----------------------------------
// Solange die Felder LEER sind, laufen automatisch Google-TEST-Anzeigen
// (kein Verdienst, aber gefahrlos). Echte IDs aus der AdMob-Konsole eintragen;
// die App-ID zusaetzlich in die Info.plist (siehe wizapp/README.md).
export const ADMOB = {
  bannerIos: '',
  interstitialIos: '',
  bannerAndroid: '',
  interstitialAndroid: '',
};
