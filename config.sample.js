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
