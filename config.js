// Supabase-Zugangsdaten fuer die Wizard-App (gleiches Projekt wie Kontoabgleich).
// Der Publishable-/anon-Key ist bewusst fuer den Client gedacht – die Daten
// werden serverseitig durch Row Level Security (RLS) geschuetzt.
export const SUPABASE_URL = 'https://mpvosmtsbvwasvnzjuwd.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_DGG2ulMkqrCUgUrwzy0KvQ_6pPlbqrq';

// Basis-Ordner fuer die Kartenbilder (Dateien als R1.png, B13.png, Z1.png, N4.png).
// './cards' = mitgeliefertes Deck. Leer = eingebaute SVG-Karten.
// Bei fehlendem/totem Bild greift automatisch die SVG-Karte.
export const CARD_IMAGE_BASE = './cards';
