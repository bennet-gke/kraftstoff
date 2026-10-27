# KRAFTSTOFF ⚡ | Tankradar, Regions-Trends & der weise Tankwart

> **Progressive Web App (PWA)** für Mac & iPhone: ausschließlich echte Tankstellen und Zapfsäulenpreise der
> Markttransparenzstelle (Tankerkönig/MTS-K), regionale Trend-Analysen und ein lernender „Tankwart“,
> der dir sagt, **wo** und **wann** du tanken solltest. Deine Daten liegen in deinem eigenen iCloud-Ordner – kein Konto, kein Tracking.

---

## ✨ Was die App kann

### 1. 🎯 Radar
* **Echte Tankstellen** im Umkreis eines Ortes (1–25 km), im **Korridor entlang einer Route** (±1–5 km, reale OSRM-Fahrstrecke) oder deine **Favoriten** (mit aktuellen Preisen, egal wo du gerade bist).
* **Umwegrechner**: Netto-Ersparnis einer Tankfüllung abzüglich Sprit- und Verschleißkosten für den Mehrweg – auf einer Strecke zählt nur der Abstecher gegenüber der Vergleichsstation.
* **Sortierung „Empfehlung“**: zuerst die Wahl des Tankwarts (geringste Kosten der Füllung inkl. Anfahrt), danach der Score aus Regionsvergleich, üblichem Preis zur Uhrzeit und Umweg. Geschlossene Stationen stehen hinten und zeigen nur den letzten Preis.
* **Fahrzeug & Tankmenge**: Garage mit Verbrauch, Tankgröße und Tankstand – daraus ergeben sich Tankmenge und Reichweite.

### 2. 🗺️ Karte
* Vollbild-Karte mit OSM-, Esri- und Satelliten-Kacheln (ohne API-Key).
* **Preis-Chips in Ampelfarben**: grün = günstiger als der Median des Bereichs, rot = teurer, weiß = Mittelfeld, grau = geschlossen.
* **Erkunden-Modus**: alle Tankstellen im sichtbaren Kartenausschnitt (bis 25 km um die Bildmitte), einfach verschieben und zoomen.
* Das Menü lässt sich komplett ausblenden – mehr Platz auf dem iPhone.

### 3. 🧭 Fahrt planen – Tankstellen entlang deiner Navigation
* Knopf **„Fahrt“** (Header und Karte): Ziel eingeben **oder** in Google Maps / Apple Karten „Teilen → Link kopieren“ und in KRAFTSTOFF **„Aus Zwischenablage“** tippen. Start und Ziel werden übernommen, Kurzlinks (`maps.app.goo.gl`, `maps.apple/p/…`) löst der Server auf.
* Start ist dein GPS-Standort, der Start aus dem Link oder ein gespeicherter Ort. Alle Tankstellen im Korridor erscheinen im Radar **in Fahrtrichtung** mit Kilometerstand, Abstecher, Umwegrechnung und Tankwart-Tipp.
* Übergabe an die Navigation: **Apple Karten (Standard) mit dem Tankstopp als Zwischenziel** über Apples offizielle neue Karten-Links (ab iOS 18.4 / macOS 15.4; ältere iPhones navigieren zuerst zur Tankstelle). Alternativ Google Maps, einstellbar in den Einstellungen.
* Unterwegs: „Meine Position“ blendet bereits passierte Tankstellen aus und zeigt „in X km“. Eine Fahrt lässt sich unter „Orte & Routen“ dauerhaft als Route behalten (z. B. den Arbeitsweg).
* Direkt-Links (z.B. für Kurzbefehle oder Lesezeichen): `/?action=trip`, `/?ziel=Hamburg`, `/?share=<Karten-Link>`, `/?tab=map`.

### 4. 📊 Trends – ein Spiegel der Region
Alle Auswertungen beziehen sich auf **alle Tankstellen im gewählten Bereich** (Radius oder Routen-Korridor):
* **Preisverlauf der Region** (Median, günstigste, teuerste Station), **typische Woche** (7 × 24 h, normiert je Station, mit Konfidenz), **Heatmap**, **günstige/teure Fenster**, **Preisbewegungen** der letzten Stunden und **Pendler-Vergleich**.
* Zeiten, in denen die App nicht geöffnet war, bleiben im Verlauf als **Lücke** sichtbar – nichts wird überbrückt oder erfunden. Euro-Werte der typischen Woche sind am aktuellen Regionsmedian verankert.
* Alle Diagramme lassen sich auf dem iPhone per Finger antippen und wischen.

### 5. ⛽ Der weise Tankwart (KI)
* Verbindet Reichweite, Tankbedarf, tägliche Fahrstrecke, Regionsprofil, Marktbewegung und Umwegrechner zu **einer klaren Empfehlung**: *Jetzt tanken*, *heute später*, *noch warten* oder *dringend*.
* **TensorFlow.js-Prognose** direkt auf dem Gerät, trainiert **ausschließlich auf echten Messwerten** (ab ~150 Beispielen aus mindestens 3 Tagen). Sie fließt nur ein, wenn sie im Test nachweislich genauer ist als das Regionsprofil. Lernstand und Gewichte liegen in IndexedDB und in deiner Datenbank-Datei.

### 6. ⚖️ Gesetze & Regeln (Waagen-Symbol)
* Gesetzliche Rahmenbedingungen sind **gespeicherte Einträge**, die du ein- und ausschalten, ändern, löschen und ergänzen kannst – Gesetze ändern sich. Sie werden wie Fahrzeuge und Routen in der Datenbank-Datei zwischen Mac und iPhone abgeglichen.
* Vorlage: die **12-Uhr-Regel** (Kraftstoffpreisanpassungsgesetz, seit 1. April 2026): E5, E10 und Diesel dürfen nur einmal täglich um 12 Uhr teurer werden, Senkungen sind jederzeit erlaubt.
* Zwei Arten von Einträgen:
  * **Erhöhungszeiten** – Erhöhungen nur zu festen Uhrzeiten (eine oder mehrere, mit Toleranz für Meldeverzug).
  * **Stichtag (Steuer/Abgabe)** – ab einem Datum ± x ct/L, optional befristet (z. B. CO₂-Preis, Steueränderung, Tankrabatt).
* Jeder Eintrag hat Gültigkeitszeitraum, Sorten, Notiz und Quelle.
* **Die Mechaniken bleiben dieselben** – Warten auf „heute später“ oder „in ein paar Tagen“, Prognosen, Ankunftsausblick, Wellen-Erkennung. Aktive Gesetze setzen ihnen nur Grenzen: Zwischen zwei erlaubten Erhöhungszeiten kann ein Preis nur fallen, Stichtage verschieben das erwartete Preisniveau. Der Tankwart sagt dazu, ob Warten risikolos ist oder ob eine erlaubte Erhöhung dazwischen liegt.
* Der Start-Tagesverlauf (vor eigenen Messwerten) passt sich an: mit 12-Uhr-Regel nach Bundeskartellamt und ADAC (am günstigsten kurz vor 12, um 12 ein Sprung um 15–18 ct), ohne Regel der frühere freie Verlauf.
* Erhöhungen außerhalb der erlaubten Zeiten werden bei den Preisbewegungen markiert.

### 7. 🔔 Preisalarme
* Signalton und Mitteilung, wenn die günstigste geöffnete Station mindestens X ct unter ihrem üblichen Preis für diese Uhrzeit oder unter dem Regionsmedian liegt (Schwelle in den Einstellungen, Pause 30 Min.).
* Ehrlich gesagt: Das funktioniert, **solange die App geöffnet ist** (auf dem Mac auch im Hintergrund-Tab). Für Hinweise bei geschlossener App gibt es im Alarm-Dialog einen fertigen **Apple-Kurzbefehl**-Link.

### 8. 🗄️ Der Datenbank-Ordner (iCloud)
* **Erster Start = Ordner festlegen.** Danach erst API-Key, Fahrzeuge, Orte und Routen.
* **Jedes Speichern legt eine neue Datei an**: `kraftstoff_daten_<JJJJ-MM-TT>_<hh-mm-ss>.json` – nichts wird überschrieben. Beim Öffnen wird die **neueste** Datei gelesen und mit offenen lokalen Änderungen zusammengeführt.
* **Zusammenführen pro Eintrag**: Fahrzeuge, Orte, Routen, Gesetze, Einstellungen und Favoriten tragen Zeitstempel – die neuere Änderung gewinnt, Gelöschtes bleibt gelöscht, unberührte Standardwerte eines neuen Geräts überschreiben nie deine Daten. Gerätebezogenes (gewählter Ort, laufende Fahrt, GPS-Standort, Kraftstoffwahl, Alarm-Pause) bleibt auf dem jeweiligen Gerät.
* **Inhalt**: API-Key, Fahrzeuge, Orte, Routen, Gesetze, Einstellungen, Favoriten, Preishistorie (14 Tage) und KI-Modell.
* **Drei Zugriffsarten** – Mac und iPhone teilen sich denselben iCloud-Ordner:
  | Gerät | Zugriff | Speichern | Laden |
  |---|---|---|---|
  | Mac mit `npm run dev` / `npm run preview` | Ordnerpfad über den lokalen Server | automatisch; die 20 neuesten Stände und 14 Tage lang je ein Stand pro Tag bleiben | automatisch |
  | Chrome / Edge (auch auf Vercel) | Ordner einmal im Browser freigeben | automatisch | automatisch |
  | iPhone / Safari | Dateien-App | „Jetzt sichern“ → Teilen-Dialog „In Dateien sichern“ oder Download | neueste Datei in der Dateien-App wählen (mehrere erlaubt) |
* Tipp für Safari: Den Download-Ordner in den Einstellungen auf den iCloud-Ordner `KRAFTSTOFF` legen, dann landet jeder Download direkt dort.

### 9. 📚 Historische Preise
* Die kostenlose Tankerkönig-Schnittstelle liefert nur **aktuelle** Preise. Die App baut ihre Historie deshalb selbst auf: bei jedem Öffnen und alle 10 Minuten, solange sie offen ist.
* Das Tankerkönig-Archiv (Tagesdateien `JJJJ-MM-TT-prices.csv`, Lizenz CC BY-NC-SA 4.0) gibt es nur für registrierte, geprüfte Nutzer über onboarding.tankerkoenig.de. Wer die Dateien hat, importiert sie unter **Menü → Datenbank → Tankerkönig-Archiv importieren**: übernommen werden die letzten 28 Tage für alle Tankstellen, die die App kennt.

### 10. 📱 Für das iPhone gebaut
* Kompakte Kopfzeile mit Fahrt, Datenbank und Menü, große Tippflächen, Dialoge als Bottom-Sheets zum Wegwischen, **Ziehen zum Aktualisieren** im Radar, Trends und Tankwart.

### Schonender Umgang mit der Tankerkönig-API
Tankerkönig bittet App-Entwickler um Abfragen auf Nutzeraktion, keine runden Abfragezeiten und keine Massenabfragen. Die App aktualisiert daher automatisch nur bei geöffneter App mit zufälligem Versatz, stoppt nach Fehlern mit dem Key, lädt lange Strecken nur auf Wunsch neu und fragt Korridor-Abschnitte nacheinander mit kleinen Pausen ab.

---

## 🚀 Lokal starten

```bash
npm install
npm run dev        # http://localhost:5173 – im Heimnetz auch vom iPhone erreichbar
npm run check      # Lint + Produktions-Build
npm run preview    # Produktions-Build lokal testen (inkl. Service Worker / Offline)
```

* **Anderer Port**: `npm run dev -- --port 5190`
* **Tankerkönig API-Key** (kostenlos): https://creativecommons.tankerkoenig.de/ → in der App unter Einstellungen eintragen. Ohne Key zeigt die App bewusst **keine** Tankstellen und **keine** Preise.
* **iPhone im Heimnetz** (`http://<Mac-IP>:5173`): GPS, Zwischenablage und Teilen-Dialog verlangen HTTPS. Für den vollen Funktionsumfang auf dem iPhone die Vercel-Version nutzen.
* Der lokale Server legt bei jedem Speichern zusätzlich eine Sicherheitskopie `kraftstoff_daten.json` im Projektordner ab (steht in `.gitignore`, wird von der App nicht gelesen).

---

## 🌐 Deployment auf Vercel

Das Projekt ist eine Vite-SPA mit zwei Serverless-Functions:
* `api/tankerkoenig.js` – Proxy zur Tankerkönig-API (Umkreissuche, Stationsdetails), mit Eingabeprüfung und Timeout.
* `api/resolve-link.js` – löst Kurzlinks aus Google Maps / Apple Karten auf.
* Gemeinsame Logik in `api/_lib/` (wird auch vom lokalen Dev-Server benutzt; Dateien mit `_` werden von Vercel nicht als eigene Funktion veröffentlicht).

**Schritte**
1. Repository auf GitHub pushen.
2. In Vercel „Add New → Project“, Repository importieren. Framework „Vite“ wird erkannt (Build `npm run build`, Output `dist`, Node ≥ 20) – alles steht bereits in `vercel.json`.
3. Deploy. HTTPS ist inklusive. Funktionen laufen in Frankfurt (`fra1`), nah an der Tankerkönig-API.
4. Optional: Umgebungsvariable `TANKERKOENIG_API_KEY` als serverseitiger Ersatz-Key (siehe `.env.example`). `VITE_TANKERKOENIG_KEY` auf Vercel **nicht** setzen – `VITE_`-Variablen landen öffentlich im JavaScript.

**Was `vercel.json` regelt**: SPA-Fallback auf `index.html`, unveränderliches Caching für `/assets/*`, kein Caching für `sw.js`, `index.html` und Manifest (Updates kommen sofort an), Sicherheits-Header (nosniff, Referrer-Policy, Frame-Schutz, Geolocation nur für die eigene Seite).

**Updates**: Jeder Build trägt eine neue Build-ID in den Service Worker ein. Geöffnete Apps zeigen „Neue Version verfügbar – Aktualisieren“; beim nächsten Start wird die neue Version ohnehin aktiv.

---

## 📱 Als App installieren
* **iPhone (Safari)**: Teilen → „Zum Home-Bildschirm“. Mitteilungen funktionieren nur in dieser Home-Screen-Variante (ab iOS 16.4).
* **Mac**: Safari → Ablage → „Zum Dock hinzufügen“ bzw. Chrome → Installations-Symbol in der Adressleiste.
* Die App startet nach dem ersten Besuch auch offline (zuletzt geladene Preise aus dem Gerätespeicher).

## 🧯 Wenn etwas hakt
* **Fehlerseite**: „Neu laden“ hilft meistens. „Ohne automatisches Laden der Datei starten“ öffnet die App einmal ohne Datenbank-Datei (falls eine Datei das Problem ist) – danach den Ordner neu verbinden.
* **Komplett zurücksetzen** (nur auf diesem Gerät): ebenfalls auf der Fehlerseite, mit Rückfrage. Die Dateien im iCloud-Ordner bleiben erhalten; anschließend einfach die neueste Datei wieder laden.
* **Neue Version**: Hinweis „Neue Version verfügbar – Aktualisieren“ antippen.

---

## 🧩 Architektur

```
api/
  tankerkoenig.js · resolve-link.js     Vercel-Funktionen
  _lib/tankerkoenig.js · resolveLink.js gemeinsame Server-Logik (Vercel + lokaler Dev-Server)
public/
  sw.js                                 Service Worker (Build-ID + Precache werden beim Build eingetragen)
  manifest.json · icons/                PWA-Manifest, App-Icons
src/
  pwa.js                                Service-Worker-Registrierung, Update-Hinweis
  services/
    priceHistoryService.js   echte Messreihen (IndexedDB), Export/Import, Statistik
    dataService.js           Tankerkönig-Bridge, Normalisierung, Einstellungen, Favoriten, API-Key
    backupService.js         Datenbank-Ordner: Zeitstempel-Dateien, neueste laden, Server / Browser-Ordner / Dateien-App
    locationService.js       Orte, Geocoding (Photon, Open-Meteo, Nominatim), Radiusfilter
    routeService.js          Routen & Fahrten (OSRM), Korridor-Geometrie, Abfragepunkte
    navLinkParser.js         Start/Ziel aus Google-Maps- und Apple-Karten-Links
    navHandoff.js            Übergabe an Apple Karten / Google Maps (bevorzugte App aus den Einstellungen)
    launchParams.js          Direkt-Links (?action=trip, ?ziel=, ?share=, ?tab=)
    vehicleService.js        Fahrzeuge
    notificationService.js   Preisalarme (respektiert Pause, merkt sich Gemeldetes 24 h)
  engine/
    regionalTrends.js        Regionsprofil 7×24, Preisindex, Zeitfenster, Preisbewegungen
    advisor.js               Empfehlungs-Score & Tankwart-Entscheidung (wo & wann)
    mlModel.js               TensorFlow.js-Forecaster (wird erst nach dem Start nachgeladen)
    adaptiveAverage.js · arrivalOutlook.js · detourCalculator.js · vehicleMath.js
  utils/format.js            deutsche Zahlen-, Preis- und Zeitformate
  components/                Radar, Karte, Trends, Tankwart, Dialoge (Diagramme mit Touch- und Größenanpassung)
```

**Grundsatz:** Es gibt keine synthetischen Preise. Was die App nicht gemessen hat, zeigt sie als „Erfahrungswert“ mit niedriger Konfidenz an – und ersetzt es Stück für Stück durch eigene Daten.

---

## 🛠️ Technologien
React 19 · Vite 8 · TensorFlow.js · D3.js · Leaflet · Lucide Icons · IndexedDB · Service Worker (PWA) · Vercel Functions

## 📄 Lizenz
MIT – siehe [LICENSE](LICENSE).
