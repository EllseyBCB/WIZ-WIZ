# Zaubertisch – App-Store-Version mit AdMob-Werbung

Diese Anleitung verpackt die Web-App (`../wizard`) mit **Capacitor** zu einer
echten iOS-/Android-App und blendet **AdMob-Werbung** ein. Die Werbe-Logik
steckt bereits in `wizard/ads.js` und ist im Browser inaktiv – sie läuft nur in
der nativen App. Standardmäßig sind **Google-Test-Anzeigen** aktiv, du kannst
also sofort testen, ohne ein AdMob-Konto.

## Was du brauchst
- **Mac** mit **Xcode** (für iOS) – bzw. **Android Studio** (für Android)
- **Node.js** (v18+)
- **Apple-Developer-Account** (99 $/Jahr) zum Veröffentlichen im App Store
- **AdMob-Konto** (kostenlos) für echte Werbung: https://admob.google.com

## 1. Einrichten (einmalig)
```bash
cd wizapp
npm install
npm run add:ios       # erzeugt das iOS-Projekt (oder: npm run add:android)
```
`add:ios` kopiert zuerst die Web-App nach `www/` und legt dann das native
Xcode-Projekt an.

## 2. In Xcode öffnen & auf dem iPhone testen
```bash
npm run ios           # kopiert Web -> sync -> öffnet Xcode
```
In Xcode dein Gerät wählen und auf ▶ drücken. Du solltest unten ein
**Test-Banner** sehen und nach einem beendeten Spiel eine **Vollbild-Test-Werbung**.

## 3. AdMob richtig konfigurieren (für echte Werbung)
1. In AdMob eine **App anlegen** und **Ad-Units** erstellen (Banner + Interstitial).
2. Die **AdMob-App-ID** und die **Ad-Unit-IDs** eintragen:
   - **App-ID** in die native Konfiguration:
     - **iOS** – `ios/App/App/Info.plist`:
       ```xml
       <key>GADApplicationIdentifier</key>
       <string>ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY</string>
       ```
     - **Android** – `android/app/src/main/AndroidManifest.xml` (in `<application>`):
       ```xml
       <meta-data
         android:name="com.google.android.gms.ads.APPLICATION_ID"
         android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
       ```
   - **Ad-Unit-IDs** in `wizard/ads.js` → Objekt `AD_CONFIG` (Banner + Interstitial,
     je iOS/Android) und dann **`testing: false`** setzen.
3. **iOS App-Tracking-Transparency** (Pflicht, sonst Ablehnung): in `Info.plist`
   ```xml
   <key>NSUserTrackingUsageDescription</key>
   <string>Wird genutzt, um dir relevantere Werbung anzuzeigen.</string>
   ```
   (Die App fragt die Erlaubnis beim Start automatisch ab.)
4. Nach Änderungen an `wizard/ads.js`: erneut `npm run ios` (kopiert + synct).

## 4. Veröffentlichen
- **iOS**: in Xcode `Product → Archive → Distribute App` → App Store Connect.
  Dort die **Datenschutz-Angaben (App Privacy)** ausfüllen (Werbung/Tracking
  angeben) und die **Datenschutz-URL** hinterlegen.
- **Android**: in Android Studio ein signiertes **AAB** bauen → Play Console.

## Wo die Werbung erscheint (anpassbar in `wizard/ads.js`)
- **Banner**: unten auf der Startseite (während einer Partie ausgeblendet).
- **Vollbild (Interstitial)**: nach Spielende, ~3 s nach der Konfetti-Feier.
  Häufigkeit über `AD_CONFIG.everyNthGame` (z. B. `2` = nur jedes 2. Spiel).
- **Belohnte Werbung (Rewarded)** ließe sich ergänzen (z. B. „Video ansehen für
  einen Bonus") – sag Bescheid, dann baue ich das ein.

## Hinweise
- Die Web-/PWA-Version (GitHub Pages) bleibt unverändert und **ohne** Werbung –
  `ads.js` ist dort komplett inaktiv.
- In der EU verlangt Google für personalisierte Werbung eine **UMP-Einwilligung**;
  die App ruft beim Start `requestConsentInfo()`/`showConsentForm()` auf. In der
  AdMob-Konsole unter *Datenschutz & Mitteilungen* die Einwilligungsnachricht
  aktivieren.
- Test-IDs sind die offiziellen Google-Test-Ad-Units – im Testbetrieb **niemals**
  auf echte Ads klicken (Konto-Sperre), dafür sind die Test-IDs da.
