# Wiz Wiz – Online-Kartenspiel (Wizard-Klon)

Eigenständige Web-App (Vanilla HTML/JS, kein Build-Schritt) mit Supabase-Backend.
Spielbar **solo gegen Computer-Gegner** oder **online mit Freunden** (jeder am
eigenen Gerät, server-autoritativ über Postgres-Funktionen + Realtime).

## Projektstruktur

- **index.html, app.js, game.js, table.js, local.js, engine.js, ai.js,
  cards.js, ui.js, audio.js, ads.js, db.js** – die App (ES-Module, per `?v=N`
  cache-gebustet).
- **cards/** – 60 Kartenbilder (R1..R13, Y.., G.., B.., Z1..Z4, N1..N4) +
  **back.png** (Kartenrückseite).
- **lobby/** – Banner-/Header-Grafiken; **icon-*.png**,
  **manifest.webmanifest** (PWA).
- **config.sample.js** → kopieren nach **config.js** und Supabase-URL +
  Publishable-Key eintragen (CARD_IMAGE_BASE = './cards').
- **supabase/** – komplettes SQL: wizard_schema.sql (Tabellen, RLS, RPCs) plus
  Migrationen (Profile/Avatare, Freunde, Gruppen, Einladungen, Avatar-Storage,
  Account-Löschung).
- **wizapp/** – Capacitor-Gerüst für die native App-Store-Version
  (de.alphablueprint.wizwiz).

## Setup

1. Supabase: wizard_schema.sql im SQL-Editor ausführen, danach die
   Migrationsdateien. Anonyme Anmeldung aktivieren (Authentication → Providers →
   Anonymous). Storage-Bucket "avatars" anlegen (siehe wizard_avatars_storage.sql).
2. Config: config.sample.js → config.js, SUPABASE_URL + SUPABASE_KEY
   (Publishable Key) eintragen.
3. Deployen: als statische Seite hosten (z. B. GitHub Pages auf main). Bei
   GitHub Pages läuft die App dann unter …github.io/WIZ-WIZ/.

## Features (Stand dieses Backups)

- Offizielle Wizard-Regeln inkl. Hook-/Vorhand-Regel (Ansagesumme ≠ Stichzahl).
- Zauberer als Trumpf = Farbe des Zauberers (Z1 Blau, Z2 Rot, Z3 Gelb, Z4 Grün).
- Tisch mit Spielern rundherum, Profilbildern/Avataren (Solo + Online),
  Austeil-Animation (Karten erscheinen erst nach dem Austeilen),
  "Alle Karten"-Vollbildansicht, Sound/Haptik/Konfetti, Pause & Rejoin.
- Rechtliches (Impressum/Datenschutz/AGB/Consent), Account-Löschung,
  Datenauskunft, Werbung (AdMob) + Werbefrei-Kauf (Mock).

Hinweis: config.js enthält nur den Publishable/anon-Key (für den Client
gedacht, durch RLS geschützt) – kein Geheimnis.
