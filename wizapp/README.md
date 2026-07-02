# Zaubertisch – native iOS-App (Xcode) via Capacitor

Diese Anleitung verpackt die bestehende Web-App (Repo-Wurzel) mit **Capacitor**
zu einer **echten iOS-App mit eigenem Xcode-Projekt** – mit **allen Funktionen**
(Solo gegen KI, Online über Supabase-Realtime, Sound, Vibration, „du bist
dran"-Benachrichtigung, Werbung über AdMob). Es wird **nichts neu in Swift**
geschrieben; die App läuft in einem nativen WebView und nutzt für die
gerätenahen Funktionen native Capacitor-Plugins.

> ⚠️ **Mac erforderlich.** Ein iOS-Build (Xcode-Projekt erzeugen, kompilieren,
> archivieren, hochladen) geht **ausschließlich auf macOS mit Xcode**. Unter
> Linux/Windows lässt sich das nicht bauen – das ist eine Vorgabe von Apple.

---

## Was du brauchst

- **Mac** mit aktuellem **Xcode** (aus dem Mac App Store)
- **Node.js** v18+ (`node -v`) und **CocoaPods** (`sudo gem install cocoapods`)
- **Apple-Developer-Account** (99 $/Jahr) zum Veröffentlichen
- **AdMob-Konto** (kostenlos) für echte Werbung – optional, Test-Anzeigen laufen sofort

---

## 1. Projekt holen & konfigurieren

```bash
git clone <REPO-URL>
cd <REPO>

# Supabase-Zugang eintragen (einmalig, liegt in der Repo-Wurzel):
cp config.sample.js config.js
#   -> SUPABASE_URL und SUPABASE_KEY (Publishable/anon-Key) eintragen

cd wizapp
npm install
```

## 2. App-Icon & Splash erzeugen

Quelle liegt unter `wizapp/assets/icon.png` (1024×1024) und `assets/splash.png`.
Du kannst beide durch eigene Grafiken ersetzen, dann:

```bash
npm run assets        # erzeugt alle iOS-Icon-/Splash-Größen
```

*(Tipp: Für den App-Store-Auftritt lohnt sich ein eigenständigeres, scharfes
1024er-Icon – das aktuelle ist aus dem 512er hochskaliert.)*

## 3. iOS-Projekt anlegen & in Xcode öffnen

```bash
npm run add:ios       # kopiert Web -> www/, legt das Xcode-Projekt unter ios/ an
npm run ios           # synct und öffnet Xcode
```

In Xcode:
1. **Signing & Capabilities** → dein **Team** wählen, **Bundle Identifier**
   ist `de.alphablueprint.zaubertisch` (bei Bedarf anpassen).
2. Gerät/Simulator wählen und auf **▶** drücken.

Nach **jeder** Änderung an den Web-Dateien (Repo-Wurzel) erneut `npm run ios`
ausführen – das kopiert und synct neu.

---

## 4. Pflicht-Einträge in `ios/App/App/Info.plist` (AUTOMATISCH)

Die AdMob-Pflichteinträge werden von **`patch-ios.mjs` automatisch** gesetzt –
das Skript läuft bei jedem `npm run ios` mit und trägt ein bzw. aktualisiert:

- `GADApplicationIdentifier` = `ca-app-pub-3811537285456646~2491168634`
  (echte App-ID; ersetzt auch eine evtl. vorhandene Test-ID)
- `NSUserTrackingUsageDescription` (Pflichttext für den iOS-Tracking-Dialog)
- `SKAdNetworkItems` (Werbe-Attribution, von AdMob empfohlen)

**Es muss also nichts von Hand in der Info.plist editiert werden.**

Für die **„du bist dran"-Benachrichtigung** ist kein Plist-Eintrag nötig – die
Erlaubnis wird zur Laufzeit abgefragt (Einstellungen → Benachrichtigungen).

---

## 5. Echte Werbung aktivieren = Geld verdienen (AdMob-Checkliste)

Die App zeigt bereits Werbung an den richtigen Stellen (Banner auf der
Startseite, Vollbild nach jedem Spielende), aktuell aber **Google-Test-
Anzeigen** – damit verdient man nichts. So stellst du auf echte Werbung um:

**A. AdMob-Konto (einmalig, kostenlos)**
1. Auf https://admob.google.com mit einem Google-Konto anmelden.
2. Unter *Zahlungen* Bankverbindung + Steuerdaten hinterlegen (Auszahlung ab
   70 € Guthaben, monatlich).
3. *Apps → App hinzufügen* → iOS → App ist (noch) nicht im Store? "Nein"
   wählen und später verknüpfen. Du erhältst die **App-ID**
   (`ca-app-pub-…~…`, mit Tilde).
4. Zwei **Anzeigenblöcke** anlegen: einen **Banner** und ein **Interstitial**.
   Jeder bekommt eine **Ad-Unit-ID** (`ca-app-pub-…/…`, mit Schrägstrich).

**B. IDs eintragen (zwei Stellen)**
1. **`config.js`** (Repo-Wurzel) → im Objekt `ADMOB` die beiden Ad-Unit-IDs
   bei `bannerIos` und `interstitialIos` eintragen. Mehr nicht – der
   Testmodus schaltet sich damit automatisch ab.
2. Die App-ID in der `Info.plist` setzt `patch-ios.mjs` automatisch
   (Abschnitt 4) – nichts zu tun.
3. `npm run ios` → in Xcode neu bauen.

**C. app-ads.txt (wichtig für volle Vergütung)**
1. In der AdMob-Konsole zeigt *Einstellungen → app-ads.txt* deine Zeile an
   (`google.com, pub-…, DIRECT, f08c47fec0942fa0`).
2. Diese Zeile in die Datei **`app-ads.txt`** in der Repo-Wurzel eintragen
   (Vorlage liegt bereit) und auf `main` pushen – GitHub Pages liefert sie
   dann unter `https://<deine-domain>/app-ads.txt` aus.
3. In App Store Connect als **Marketing-/Support-URL** dieselbe Domain
   angeben, damit AdMob die Datei deiner App zuordnen kann.

**D. Einwilligung & Datenschutz (Pflicht in der EU)**
1. AdMob-Konsole → *Datenschutz & Mitteilungen* → **DSGVO-Nachricht**
   erstellen/veröffentlichen. Die App ruft beim Start automatisch
   `requestConsentInfo()`/`showConsentForm()` auf – ohne veröffentlichte
   Nachricht erscheint kein Einwilligungsdialog und es gibt in der EU
   keine personalisierte Werbung (weniger Umsatz).
2. App Store Connect → *App-Datenschutz*: angeben, dass die App über
   Drittanbieter (Google AdMob) Daten für Werbung erhebt (Gerätekennung,
   Nutzungsdaten). Der ATT-Dialog ist schon eingebaut
   (`NSUserTrackingUsageDescription`, Abschnitt 4).

**E. Nach dem App-Store-Release**
1. AdMob → deine App → mit dem App-Store-Eintrag **verknüpfen**.
2. Erste echte Anzeigen erscheinen oft erst nach einigen Stunden bis
   ~1 Tag (Konto-/App-Prüfung durch Google).

> **Wichtig:** Im Testbetrieb und in der eigenen fertigen App **niemals
> selbst auf echte Anzeigen klicken** – das führt schnell zur Sperrung des
> AdMob-Kontos. Zum Ausprobieren sind die Test-IDs da (Felder in
> `config.js` einfach leer lassen).

**Wo die Werbung erscheint (bereits eingebaut):**
- Banner unten auf der Startseite (`showBanner()`), im Spiel ausgeblendet
- Vollbild-Werbung nach jedem Spielende (`gameOverAd()`, drosselbar über
  `EVERY_NTH_GAME` in `ads.js`)
- Käufer von „Werbefrei"/Magier-Bundle sehen automatisch keine Werbung

---

## 6. „Werbefrei"-Kauf (echter In-App-Purchase via RevenueCat)

Der Werbefrei-Kauf ist als **echter StoreKit-Kauf** über **RevenueCat**
implementiert (`iap.js`), inkl. **„Käufe wiederherstellen"** (von Apple
verlangt). Im Browser/PWA wird der Kauf-Bereich automatisch ausgeblendet (dort
gibt es keine Werbung). Damit der Kauf live funktioniert, ist eine einmalige
Einrichtung in **App Store Connect** und **RevenueCat** nötig:

1. **App Store Connect** → deine App → *In-App-Käufe* → ein
   **nicht-verbrauchbares** Produkt anlegen.
   - Produkt-ID: `de.alphablueprint.zaubertisch.adfree` (oder eigene – dann in
     `config.js` `IAP_PRODUCT_ID` anpassen), Preis 3,99 €.
   - Außerdem unter *App-Informationen* die **Paid-Apps-Vereinbarung** + Bankdaten
     hinterlegen, sonst sind Käufe nicht testbar.
2. **RevenueCat** (kostenloses Konto, https://www.revenuecat.com):
   - Projekt + **iOS-App** anlegen, Bundle-ID `de.alphablueprint.zaubertisch`,
     den App-Store-Connect-Zugang verbinden.
   - Ein **Entitlement** `adfree` anlegen und das o. g. Produkt zuordnen
     (über ein Offering/Package).
   - Den **öffentlichen Apple-SDK-Key** (Project → API keys, beginnt mit `appl_`)
     kopieren.
3. In **`config.js`** (Repo-Wurzel) eintragen:
   ```js
   export const REVENUECAT_IOS_KEY = 'appl_DEIN_KEY';
   export const IAP_ENTITLEMENT   = 'adfree';
   export const IAP_PRODUCT_ID    = 'de.alphablueprint.zaubertisch.adfree';
   ```
   Bleibt `REVENUECAT_IOS_KEY` leer, ist der Kauf deaktiviert und der Bereich
   ausgeblendet.
4. `npm install` (zieht `@revenuecat/purchases-capacitor`) und `npm run ios`.
5. Testen mit einem **Sandbox-Tester** (App Store Connect → Benutzer & Zugriff →
   Sandbox).

Die App ruft beim Start `initIAP()` auf (erkennt frühere Käufe automatisch),
beim Tippen auf „Werbefrei" `purchaseAdFree()` und bei „Käufe wiederherstellen"
`restorePurchases()`. Erfolgreicher Kauf/Entitlement `adfree` → Werbung dauerhaft aus.

---

## 7. Veröffentlichen

In Xcode: **Product → Archive → Distribute App → App Store Connect**.
Dort die **App-Privacy-Angaben** ausfüllen (Werbung/Tracking angeben) und die
**Datenschutz-URL** hinterlegen (die Datenschutzerklärung ist in der App unter
Einstellungen → Rechtliches enthalten).

---

## Funktionsumfang nativ (Feature-Parität)

| Funktion | nativ iOS |
|---|---|
| Solo gegen Computer, Online (Supabase-Realtime) | ✅ unverändert |
| Kartengrafiken, Animationen, Sound (Web Audio) | ✅ |
| **Vibration** | ✅ über `@capacitor/haptics` (Web nutzt `navigator.vibrate`) |
| **„du bist dran"-Benachrichtigung** | ✅ über `@capacitor/local-notifications` |
| Einladung teilen | ✅ über das native Teilen-Sheet |
| Werbung (Banner/Interstitial) + UMP-Consent + ATT | ✅ über `@capacitor-community/admob` |
| Werbefrei-Kauf + Wiederherstellen | ✅ echter StoreKit-IAP über RevenueCat (s. Abschnitt 6) |

Die Web-/PWA-Version (GitHub Pages) bleibt davon unberührt und **ohne** Werbung –
`ads.js` ist dort inaktiv, und die nativen Plugin-Aufrufe greifen nur, wenn die
App wirklich nativ läuft (sonst Web-Fallback).
