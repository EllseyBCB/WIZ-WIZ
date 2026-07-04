# Inhalte hinzufügen (Decks, Avatare, Tische, Titel)

Kurz-Anleitung, wie neue Shop-Inhalte end-to-end integriert werden. Der Code ist
schon dafür gebaut – meist reicht **eine Katalog-Zeile + Assets + eine Server-
Katalog-Zeile**. Kein Build-Schritt, alles Vanilla-JS.

## Wie das System zusammenhängt

Es gibt zwei Katalog-Quellen, die zusammenpassen müssen:

| Ebene | Datei | Rolle |
|-------|-------|-------|
| **Client-Anzeige** | `shop-catalog.js` → `SHOP_SECTIONS` | Name, Bild, Seltenheit, Ordner. Steuert, was im Shop erscheint und wie es ausgerüstet wird. |
| **Server-Wahrheit** | Tabelle `wizard_catalog` (Supabase) | Preis + Währung. Beim Kauf entscheidet **immer** der Server. Seed: `supabase/wizard_catalog_seed.sql`. |

Der Client-Preis in `shop-catalog.js` ist nur Anzeige. Fehlt die Server-Zeile,
schlägt der echte Kauf mit „Artikel nicht gefunden" fehl (Ausnahme: Owner-/Dev-
Unlock, siehe unten).

Kauf-Ablauf: Shop-Kachel → `buyCurrencyItem(id)` (`app.js`) → `db.buyItem(id)` →
RPC `wizard_buy_item` prüft `wizard_catalog`, zieht Kristalle/Gold ab, schreibt
`wizard_inventory`. Besitz wird über `walletCache.inventory` bzw. `owned`-Set
gespiegelt.

---

## Neues Kartendeck hinzufügen

Ein Deck tauscht nur die **60 Vorderseiten** aus. Die Rückseite (`back.png`)
bleibt immer die des Standard-Decks (`CARD_IMAGE_BASE`).

### 1. Kartenbilder ablegen

Neuen Ordner `cards/decks/<name>/` anlegen mit **genau diesen 60 Dateien**:

```
R1.png … R13.png   (Rot)
Y1.png … Y13.png   (Gelb)
G1.png … G13.png   (Grün)
B1.png … B13.png   (Blau)
Z1.png … Z4.png    (Zauberer)
N1.png … N4.png    (Narren)
```

Kein `back.png` nötig. Dateinamen müssen exakt so heißen (siehe `cards.js`,
`allCardImageUrls()`). Format wie das Standard-Deck (Hochformat, gleiche
Proportionen). Bilder generieren geht mit dem Studio-Tool (siehe unten).

### 2. Deck-Vorschaubild ablegen

Ein Kachel-Bild für den Shop nach `lobby/deck-<name>.png` (Vorbild:
`lobby/deck-kristall.png`, `lobby/deck-standard.png`).

### 3. Katalog-Zeile im Client ergänzen

In `shop-catalog.js`, Sektion `deck`, eine Zeile hinzufügen. Wichtig ist das
**letzte Argument `folder`** – der Ordner aus Schritt 1:

```js
// I(id, kind, name, cost, currency, rarity, icon, img, folder)
I('deck_feuer', 'deck', 'Feuer', 800, 'crystals', 'rare',
  '🔥', 'lobby/deck-feuer.png', 'cards/decks/feuer'),
```

Ohne `folder` erscheint das Deck im Shop, lässt sich aber **nicht auswählen**
(`equipCatalogDeck` bricht ab). Das ist der Grund, warum aktuell nur „Arkanum"
(`deck_kristall`) wirklich funktioniert – die anderen 8 sind Platzhalter ohne
Ordner. Erst Ordner + `folder`-Feld = spielbar.

### 4. Server-Katalog-Zeile ergänzen

Damit auch echte Nutzer kaufen können, die Zeile in `wizard_catalog` einfügen –
am einfachsten in `supabase/wizard_catalog_seed.sql` ergänzen und im Supabase-
SQL-Editor ausführen (das Skript ist idempotent, `on conflict do update`):

```sql
insert into public.wizard_catalog (item_id, kind, cost, currency, rarity) values
  ('deck_feuer', 'deck', 800, 'crystals', 'rare')
on conflict (item_id) do update
  set kind=excluded.kind, cost=excluded.cost,
      currency=excluded.currency, rarity=excluded.rarity, active=true;
```

`item_id`, `cost`, `currency`, `rarity` müssen zur Client-Zeile passen.

### 5. Cache-Bust (nur bei Änderung bestehender Bilder)

Kartenbilder werden mit `?v=11` geladen (`cards.js`), das Vorschaubild mit
`?v=1` (`app.js`). Neue Dateien brauchen nichts; **überschriebene** Bilder erst
nach Hochzählen der Versionsnummer sichtbar.

Das war's – neu laden, das Deck steht im Shop unter „Kartendecks".

---

## Neuen Avatar hinzufügen

Zwei Wege je nach Bezahlung:

**A) Mit Kristallen (neuer Shop, empfohlen):**
1. Bild nach `avatars/<id>.jpg` (z. B. `avatars/av_eule.jpg`).
2. In `shop-catalog.js`, Sektion `avatar`, Zeile ergänzen:
   ```js
   I('av_greif', 'avatar', 'Greif', 1000, 'crystals', 'epic', '🦅', AV('av_greif')),
   ```
3. Server-Zeile in `wizard_catalog` (kind `avatar`).

**B) Mit Echtgeld (IAP, altes System):** Eintrag in `AVATAR_ITEMS` (Datei
`cosmetics.js`) + Produkt/Entitlement in App Store Connect. Siehe `IAP-SETUP.md`.

---

## Neues Spielfeld (Tisch) hinzufügen

Hochformat-Hintergrundbild dient zugleich als Kachel **und** als echter Tisch-
Hintergrund im Spiel (`background: cover`).

1. Bild nach `lobby/themes/<id>.jpg`.
2. In `shop-catalog.js`, Sektion `table`:
   ```js
   I('table_wueste', 'table', 'Wüstentempel', 1000, 'crystals', 'epic',
     '🏜️', TBL('table_wueste')),
   ```
   `TBL(id)` = `lobby/themes/<id>.jpg`. Das `img`-Feld ist zugleich der
   Hintergrund (`equipCatalogTable` setzt `wizard_table_bg`).
3. Server-Zeile in `wizard_catalog` (kind `table`).

---

## Neuen Titel / Zubehör hinzufügen

Reiner Katalog-Eintrag (kein Bild-Asset nötig, nur Emoji-Icon):

1. In `shop-catalog.js`, Sektion `title`:
   ```js
   I('title_meister', 'title', 'Meister', 5000, 'gold', 'rare', '🎓'),
   ```
2. Server-Zeile in `wizard_catalog` (kind `title`, currency `gold`).

---

## Bilder generieren – Wiz-Wiz Studio

Passende Artworks im einheitlichen Stil erzeugen (OpenAI `gpt-image-1`):

```bash
npm install openai
export OPENAI_API_KEY="sk-..."

node tools/wizstudio.js card      "Feuerdrache"        # -> cards/
node tools/wizstudio.js card-pack "60 Feuerkarten"     # -> cards/
node tools/wizstudio.js avatar    "Dunkler Magier"     # -> avatars/
node tools/wizstudio.js shop-item "Legendärer Kristall" # -> store-assets/

node tools/wizstudio.js card-pack "3 Eiskarten" --dry  # Test ohne Kosten/API
```

Hinweis: `card-pack` erzeugt Dateien mit dem Motiv-Namen (`feuerkarten-01.png`),
**nicht** direkt die 60 Deck-Dateinamen (`R1.png` …). Bilder danach passend
umbenennen/einsortieren in `cards/decks/<name>/`.

---

## Freischalten zum Testen (ohne Kauf)

- **Dev-Unlock (Browser):** URL mit `?shop=dev` öffnen → alles freigeschaltet,
  lokal in `localStorage` (`?shop=off` hebt es auf). Siehe `isDevUnlock()`.
- **Owner-Unlock (Konto):** E-Mails in `OWNER_EMAILS` (`shop-catalog.js`)
  bekommen alles gratis. Aktuell: `nedvidekelia@gmail.com`,
  `nancydehnert05@icloud.com`.

Mit einem dieser Unlocks steht bei kaufbaren Items direkt „Auswählen", ohne dass
die Server-Katalog-Zeile existieren muss. Für **echte** Nutzer ist die
Server-Zeile aber Pflicht.

---

## Checkliste „neues Deck"

- [ ] `cards/decks/<name>/` mit 60 PNGs (R/Y/G/B 1–13, Z1–4, N1–4)
- [ ] `lobby/deck-<name>.png` (Vorschaubild)
- [ ] Zeile in `shop-catalog.js` (Sektion `deck`) **mit `folder`**
- [ ] Zeile in `wizard_catalog` / `supabase/wizard_catalog_seed.sql`
- [ ] Getestet mit `?shop=dev` im Browser
