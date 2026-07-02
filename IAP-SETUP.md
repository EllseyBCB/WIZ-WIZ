# In-App-Käufe einrichten (App Store Connect) — Copy-&-Paste-Vorlage

Der Code ist fertig (StoreKit-Direktkauf). Sobald die Produkte unten in
App Store Connect **freigegeben** sind, funktioniert der Kauf automatisch.
Preise werden **live** aus App Store Connect gezogen — du setzt sie nur dort.

---

## Schritt 1 — Verträge & Bankdaten (einmalig, PFLICHT)

App Store Connect → **Verträge, Steuern und Bankverbindung**
1. **Paid Applications**-Vertrag akzeptieren
2. **Bankverbindung** eintragen
3. **Steuerdaten** ausfüllen

> ⚠️ Solange dieser Vertrag nicht „Aktiv" ist, liefert Apple KEINE Produkte aus
> und der Shop zeigt „nicht verfügbar".

---

## Schritt 2 — Die 13 Produkte anlegen

App Store Connect → App **Zaubertisch** → **In-App-Käufe** → **+**
→ Typ immer **Nicht-verbrauchbar (Non-Consumable)**.

Pro Produkt einzutragen:
- **Produkt-ID** (exakt, siehe Tabelle — NICHT änderbar!)
- **Referenzname** (intern; nimm den Namen aus der Tabelle)
- **Preis** (siehe Tabelle)
- unter **Lokalisierung (Deutsch)**: **Anzeigename** + **Beschreibung** (siehe unten)
- **Review-Screenshot** (1 Foto vom Shop reicht — für alle 13 dasselbe ok)

Status **„Bereit zum Einreichen"** genügt fürs Sandbox-Testen.

| Produkt-ID | Referenzname / Anzeigename | Preis |
|---|---|---|
| `de.alphablueprint.zaubertisch.adfree` | Werbefrei | 3,99 € |
| `de.alphablueprint.zaubertisch.bundle.magier` | Magier-Bundle | 9,99 € |
| `de.alphablueprint.zaubertisch.avatar.hourglass` | Zeitmanipulator | 2,99 € |
| `de.alphablueprint.zaubertisch.avatar.grimoire` | Verbotenes Grimoire | 1,99 € |
| `de.alphablueprint.zaubertisch.avatar.dragonegg` | Drachenei | 2,99 € |
| `de.alphablueprint.zaubertisch.avatar.wizardhat` | Zauberhut | 1,99 € |
| `de.alphablueprint.zaubertisch.avatar.compass` | Magischer Kompass | 1,99 € |
| `de.alphablueprint.zaubertisch.avatar.oracle` | Orakelkugel | 2,99 € |
| `de.alphablueprint.zaubertisch.avatar.phoenix` | Phönixfeder | 1,99 € |
| `de.alphablueprint.zaubertisch.avatar.shadowwolf` | Schattenwolf | 2,99 € |
| `de.alphablueprint.zaubertisch.avatar.fortress` | Schwebende Festung | 2,99 € |
| `de.alphablueprint.zaubertisch.avatar.chest` | Schatztruhe | 2,99 € |
| `de.alphablueprint.zaubertisch.table.mystic` | Mystischer Tisch | 2,99 € |

### Beschreibungen (Deutsch) zum Reinkopieren

- **Werbefrei** — Entfernt Banner- und Vollbildwerbung dauerhaft.
- **Magier-Bundle** — Werbefrei plus alle Avatare und Tisch-Designs. Der beste Preis.
- **Zeitmanipulator** — Profilbild: eine magische Sanduhr.
- **Verbotenes Grimoire** — Profilbild: ein uraltes Zauberbuch.
- **Drachenei** — Profilbild: ein schimmerndes Drachenei.
- **Zauberhut** — Profilbild: ein sternenbesetzter Zauberhut.
- **Magischer Kompass** — Profilbild: ein magischer Kompass.
- **Orakelkugel** — Profilbild: eine leuchtende Orakelkugel.
- **Phönixfeder** — Profilbild: eine glühende Phönixfeder.
- **Schattenwolf** — Profilbild: ein Schattenwolf.
- **Schwebende Festung** — Profilbild: eine schwebende Festung.
- **Schatztruhe** — Profilbild: eine funkelnde Schatztruhe.
- **Mystischer Tisch** — Spieltisch-Design „Mystischer Tisch".

> Hinweis: Das **Magier-Bundle** ist ein normales Non-Consumable — die App
> schaltet damit intern alles frei (Werbefrei + alle Avatare + Tische).

---

## Schritt 3 — Sandbox-Tester anlegen

App Store Connect → **Benutzer und Zugriff** → **Sandbox** → **Tester** → **+**
- Eine **fremde/neue** E-Mail nehmen (NICHT deine echte Apple-ID).

---

## Schritt 4 — Auf dem iPhone testen (Sandbox = kein echtes Geld)

1. Neuen Build aufspielen: im Ordner `wizapp/` → `npm run ios` → in Xcode ▶
2. Am iPhone: **Einstellungen → App Store** → mit deinem echten Account **abmelden**
3. Im Spiel: **Shop** → auf einen Preis tippen → mit dem **Sandbox-Tester** anmelden
4. Kauf sollte durchlaufen, Artikel wird freigeschaltet
5. **„Käufe wiederherstellen"** testen (Pflicht von Apple)

---

## Wenn etwas klemmt

- Shop zeigt „nicht verfügbar" / kein Preis → Vertrag (Schritt 1) noch nicht
  aktiv, oder Produkt-ID stimmt nicht exakt, oder Produkt noch nicht
  „Bereit zum Einreichen".
- Produkte erscheinen erst nach einigen Minuten bis Stunden nach dem Anlegen.
- Echte Preise erscheinen nur auf dem GERÄT (nicht im Simulator/Browser —
  dort zeigt die App die Platzhalterpreise).
