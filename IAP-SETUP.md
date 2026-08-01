# In-App-Käufe einrichten (App Store Connect) — Copy-&-Paste-Vorlage

Der Kauf-Code ist fertig (StoreKit-Direktkauf über `cordova-plugin-purchase`,
siehe `iap.js`). Sobald die Produkte unten in App Store Connect **freigegeben**
sind, funktioniert der Kauf automatisch. Preise werden **live** aus App Store
Connect gezogen — du setzt sie nur dort (die Euro-Beträge in dieser Datei /
im Code sind nur Platzhalter für Browser-Vorschau).

> WICHTIG: Diese Datei beschreibt die **tatsächlich im Live-Shop verkauften**
> Produkte. Der Shop verkauft echtes Geld ausschließlich als **Kristalle**
> (Verbrauchsprodukte) plus die beiden Einmalkäufe **Werbefrei** und
> **Magier-Bundle**. Alle Avatare, Decks, Tische und Kartenrückseiten werden
> **im Spiel mit Kristallen** gekauft (serverseitig, `wizard_buy_item`) —
> NICHT als eigene Apple-Produkte. Siehe Abschnitt „Veraltet" unten.

---

## Schritt 1 — Verträge & Bankdaten (einmalig, PFLICHT)

App Store Connect → **Verträge, Steuern und Bankverbindung**
1. **Paid Applications**-Vertrag akzeptieren
2. **Bankverbindung** eintragen
3. **Steuerdaten** ausfüllen

> ⚠️ Solange dieser Vertrag nicht „Aktiv" ist, liefert Apple KEINE Produkte aus
> und der Shop zeigt „nicht verfügbar".

---

## Schritt 2 — Die 7 Produkte anlegen

App Store Connect → App **Zaubertisch** → **In-App-Käufe** → **+**

Es gibt **zwei Produkttypen**:

### 2a) Kristall-Pakete — Typ **Verbrauchbar (Consumable)**

Diese sind mehrfach kaufbar. Die Gutschrift der Kristalle macht der **Server**
(`wizard_grant_iap_pack`) mit Transaktions-Dedupe; der Kauf wird erst
abgeschlossen, wenn die Gutschrift geklappt hat (nichts geht verloren).
Quelle im Code: `shop-catalog.js` → `CRYSTAL_PACKS`, Kauf über
`iap.js` → `purchaseConsumable`.

| Produkt-ID | Referenzname / Anzeigename | Kristalle (Basis + Bonus) | Preis (Platzhalter) |
|---|---|---|---|
| `de.alphablueprint.zaubertisch.kristalle.100`  | 100 Kristalle   | 100            | 1,09 €  |
| `de.alphablueprint.zaubertisch.kristalle.500`  | 500 Kristalle   | 500 + 50       | 4,49 €  |
| `de.alphablueprint.zaubertisch.kristalle.1200` | 1200 Kristalle  | 1200 + 200     | 9,99 €  |
| `de.alphablueprint.zaubertisch.kristalle.2500` | 2500 Kristalle  | 2500 + 500     | 19,99 € |
| `de.alphablueprint.zaubertisch.kristalle.6000` | 6000 Kristalle  | 6000 + 1500    | 49,99 € |

> Die tatsächliche Gutschrift (Basis + Bonus) ist serverseitig hinterlegt.
> Der **Preis** wird ausschließlich in App Store Connect gesetzt.

### 2b) Werbefrei & Bundle — Typ **Nicht-verbrauchbar (Non-Consumable)**

Einmalkäufe. Besitz wird lokal per StoreKit gemerkt und über
`restorePurchases()` wiederhergestellt. Quelle im Code: `cosmetics.js`
(`SHOP_ADFREE`, `SHOP_BUNDLE`), `config.js`, Kauf über `iap.js` →
`purchaseProduct` (aufgerufen aus `app.js` → `buyShopItem` im Tab „Angebote").

| Produkt-ID | Referenzname / Anzeigename | Preis (Platzhalter) |
|---|---|---|
| `de.alphablueprint.zaubertisch.adfree`        | Werbefrei     | 3,99 € |
| `de.alphablueprint.zaubertisch.bundle.magier` | Magier-Bundle | 9,99 € |

Pro Produkt einzutragen:
- **Produkt-ID** (exakt wie oben — NICHT änderbar!)
- **Referenzname** (intern)
- **Preis** (in App Store Connect)
- unter **Lokalisierung (Deutsch)**: **Anzeigename** + **Beschreibung** (siehe unten)
- **Review-Screenshot** (1 Foto vom Shop reicht — für alle dasselbe ok)

Status **„Bereit zum Einreichen"** genügt fürs Sandbox-Testen.

### Beschreibungen (Deutsch) zum Reinkopieren

- **100 / 500 / 1200 / 2500 / 6000 Kristalle** — Kristalle sind die Premium-Währung.
  Damit öffnest du Truhen und kaufst Avatare, Kartendecks, Spielfelder und
  Kartenrückseiten im Shop. (Größere Pakete enthalten Bonus-Kristalle.)
- **Werbefrei** — Entfernt Banner- und Vollbildwerbung dauerhaft.
- **Magier-Bundle** — Werbefrei plus zusätzliche Bonus-Inhalte. Der beste Preis.

---

## Schritt 3 — Sandbox-Tester anlegen

App Store Connect → **Benutzer und Zugriff** → **Sandbox** → **Tester** → **+**
- Eine **fremde/neue** E-Mail nehmen (NICHT deine echte Apple-ID).

---

## Schritt 4 — Auf dem iPhone testen (Sandbox = kein echtes Geld)

1. Neuen Build aufspielen: im iOS-Wrapper → `npm run ios` → in Xcode ▶
2. Am iPhone: **Einstellungen → App Store** → mit deinem echten Account **abmelden**
3. Im Spiel: **Shop → Kristalle** → auf einen Preis tippen → mit dem
   **Sandbox-Tester** anmelden → Kristalle sollten gutgeschrieben werden.
4. **Shop → Angebote**: Werbefrei bzw. Magier-Bundle testen.
5. **„Käufe wiederherstellen"** testen (Pflicht von Apple; im Shop unten).

---

## Schritt 5 — App-Privacy / Werbung in App Store Connect

Weil die App **Google AdMob** einbindet und (mit Einwilligung) die Werbe-ID
nutzen kann, müssen in App Store Connect unter **App-Datenschutz** die
Tracking-/Werbeangaben gesetzt werden (u. a. „Identifikatoren → Geräte-ID",
Verwendung „Drittanbieter-Werbung", und „Verwendet zur Nachverfolgung"
entsprechend dem ATT-Dialog). Der Datenschutztext in der App (`index.html`,
Abschnitt „Werbung (Google AdMob)") beschreibt das bereits korrekt.

---

## Veraltet — NICHT mehr im Einsatz (nicht als Apple-Produkte anlegen)

Ein **früheres** System verkaufte einzelne Avatare und einen Tisch als
Non-Consumables. Dieser Pfad ist im aktuellen Live-Shop **tot**:

- Betroffener Code: `cosmetics.js` → `AVATAR_ITEMS` (10 Avatar-Produkt-IDs
  `de.alphablueprint.zaubertisch.avatar.*`) und `TABLE_ITEMS`
  (`de.alphablueprint.zaubertisch.table.mystic`); `iap.js` registriert diese in
  `CATALOG` und bietet `purchaseProduct`; die Render-Funktionen
  `shopAvatarCard` / `shopTableCard` in `app.js` erzeugen dafür Kauf-Knöpfe.
- **Warum tot:** `shopAvatarCard` und `shopTableCard` werden von KEINER Stelle
  mehr aufgerufen (verifiziert per Suche). Der aktive Shop rendert Avatare/
  Decks/Tische/Rückseiten über `shopCatalogTile` und kauft sie mit **Kristallen**
  über `buyCurrencyItem` → `wizard_buy_item`. Der einzige noch erreichbare
  `purchaseProduct`-Aufruf (`buyShopItem`) betrifft nur **Werbefrei** und
  **Magier-Bundle**.
- **Empfehlung:** Diese 10 Avatar- und 1 Tisch-Produkte in App Store Connect
  **NICHT** anlegen. Der tote Registrierungs-Code in `iap.js` ist harmlos
  (nicht existierende Produkte werden von StoreKit einfach ignoriert) — er wurde
  bewusst **nicht** entfernt, weil es sich um Zahlungscode handelt und eine
  Entfernung sorgfältig separat getestet werden sollte.

### Bekannter Punkt: Magier-Bundle schaltet neue Kristall-Shop-Avatare nicht frei

Das Magier-Bundle setzt lokal das Entitlement `magier` (siehe `cosmetics.js`
→ `isOwned`: „Bundle schaltet alles frei"). Das wirkt aber nur auf die
**alten** cosmetics.js-Items (AVATAR_ITEMS/TABLE_ITEMS). Die **neuen**
Shop-Kosmetika (SHOP_SECTIONS) hängen am **Server-Inventar**
(`wizard_inventory`, gekauft via `wizard_buy_item`) und werden vom lokalen
Bundle-Flag NICHT freigeschaltet.

Eine saubere Lösung ist hier **nicht** eingebaut, weil der Bundle-Kauf rein
lokal über StoreKit läuft (kein Server-Call). Um die Bundle-Inhalte ins
Server-Inventar zu schreiben, bräuchte es:
1. eine neue serverseitige Funktion (z. B. `wizard_grant_bundle`), die die
   gewünschten Bundle-Items in `wizard_inventory` einträgt, und
2. einen Client-Aufruf dieser Funktion beim/nach dem Bundle-Kauf.

Das ist eine bewusste **offene Design-Entscheidung** (welche Items gehören ins
Bundle?) und sollte separat umgesetzt/getestet werden, bevor es live geht.
</content>
</invoke>
