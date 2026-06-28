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

## 4. Pflicht-Einträge in `ios/App/App/Info.plist`

Diese fügt Xcode **nicht** automatisch hinzu – ohne sie gibt es eine
App-Store-Ablehnung bzw. keine Werbung:

```xml
<!-- AdMob App-ID (Test-ID; spaeter durch eigene ersetzen) -->
<key>GADApplicationIdentifier</key>
<string>ca-app-pub-3940256099942544~1458002511</string>

<!-- App-Tracking-Transparency: Pflichttext fuer personalisierte Werbung -->
<key>NSUserTrackingUsageDescription</key>
<string>Wird genutzt, um dir relevantere Werbung anzuzeigen.</string>
```

Für die **„du bist dran"-Benachrichtigung** ist kein Plist-Eintrag nötig – die
Erlaubnis wird zur Laufzeit abgefragt (Einstellungen → Benachrichtigungen).

AdMob empfiehlt zusätzlich die **SKAdNetworkItems** in der Info.plist
(Liste der Werbe-Netzwerk-IDs) – siehe AdMob-Doku.

---

## 5. Echte Werbung aktivieren (optional)

1. In **AdMob** eine App + Ad-Units (Banner + Interstitial) anlegen.
2. In **`ads.js`** (Repo-Wurzel) im Objekt `AD_CONFIG` die echten Ad-Unit-IDs
   eintragen und **`testing: false`** setzen.
3. Die **AdMob-App-ID** in die `Info.plist` (`GADApplicationIdentifier`, s. o.).
4. `npm run ios` erneut ausführen.
5. EU-Einwilligung (UMP): in der AdMob-Konsole unter *Datenschutz & Mitteilungen*
   die Einwilligungsnachricht aktivieren – die App ruft beim Start automatisch
   `requestConsentInfo()`/`showConsentForm()` auf.

> Im Testbetrieb **niemals** auf echte Anzeigen klicken (Konto-Sperre). Dafür
> sind die voreingestellten Google-Test-IDs da.

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
