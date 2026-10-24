# KRAFTSTOFF ⚡ | Intelligenter Tankpreis-Radar & KI-Prädiktor

> **Progressive Web App (PWA)** zur KI-gestützten Analyse, dynamischen Bewertung und prädiktiven Vorhersage von Kraftstoffpreisen. Trainiert und inferiert zu 100% lokal im Browser mit **TensorFlow.js**, **D3.js** und **Leaflet**.

---

## ✨ Highlights & Kernfunktionen

### 1. 🧠 Kontinuierliches On-Device Machine Learning (TensorFlow.js)
* **Continuous On-Device Learning:** Das neuronale Netz (32 ➔ 16 ➔ 1 Neuronen mit Dropout) lernt kontinuierlich aus realen lokalen Tankstellen-Zeitreihen.
* **Permanente IndexedDB-Persistenz:** Das Modell sichert gelernte Gewichte dauerhaft im Browser-Speicher (`indexeddb://kraftstoff-tf-model`). Kein Wissensverlust bei Reloads oder Neustarts.
* **24h Neurale Preiskurve:** Stündliche Intraday-Kurvenvorhersage mit automatischer Detektion des besten Tank-Zeitfensters.
* **Kartellamt Reaktions-Radar:** Erkennt Preissprünge der Marktführer (Aral, Shell) und berechnet das Reaktionsfenster (z.B. noch 30 Minuten), bevor Discounter (JET, HEM, Total) nachziehen.
* **Personalisierter Tank-Strategie-Agent:** Optimal-Stopping-Algorithmus basierend auf Tankfüllstand (% des aktiven Fahrzeugs), Verbrauch und dem prognostizierten Wochentiefstpreis.

### 2. 🗺️ Immersive Vollbild-Karte & Multi-Provider Geocoding
* **100% Free & Keyless Tile-Engine:** Dynamischer Umschalter zwischen farbenfrohem **OpenStreetMap (OSM)**, modernem **Esri World Street Map** und echtem **Esri Satelliten-Luftbild** – komplett ohne Registrierung oder API-Key.
* **Apple-Design Vollbild:** Edler, weicher weißer Vignette-Verlauf an den Bildschirmrändern und schwebendes, transparentes Apple-Style Bedienpanel.
* **Touch-optimiert:** Gestengesteuertes Zoomen (Pinch-to-Zoom mit zwei Fingern) ohne störende Buttons.
* **Robuste Geocoding-Pipeline:** Tiered Geocoding über **Photon by Komoot**, **Open-Meteo**, **OpenStreetMap Nominatim** und integriertes Offline-Lexikon für über 40 deutsche Großstädte.
* **1-Klick GPS-Standort:** Erkennt deinen echten Standort sofort und generiert Tankstellen im gewählten Suchradius.
* **Fahrt-Routen & Korridor-Puffer:** Berechnung von Wegstrecken zwischen zwei Orten und automatische Filterung von Tankstellen entlang des Fahrtkorridors.
* **Realer Umweg-Rechner:** Berechnet die echte Netto-Ersparnis abzüglich des Spritverbrauchs für Hin- und Rückfahrt (`2 × Zusatz-km × Verbrauch × Preis`).

### 3. 📊 Dynamische Preis-Engine & D3-Visualisierungen
* **Adaptive Moving Average:** Gewichtete dynamische Durchschnitte mit Volatilitätskorrektur statt starrer Tagesmittel.
* **Die "Typische Woche":** D3-Wochenzyklus-Analyse zur Visualisierung von Hoch- und Tiefzeiten (z.B. Dienstagnachmittag vs. Montagmorgen).
* **7×24 Heatmap-Matrix:** Stunden- und Wochentagsmatrix zur sofortigen Identifikation günstiger Zeitfenster.
* **Gesetzes- & Steuermodifikator:** Simulation von temporären Rabatten (z.B. Tankrabatt, CO2-Stufen, Pendlerentlastung).

### 4. ☁️ 1-Klick iCloud Drive Datensynchronisation & Privacy
* **100% Privatsphäre:** Keine Zwangsregistrierung, keine externen Tracker.
* **Direkt-Sync:** Speichere und lade deine Fahrzeuge, Routen, Standorte und optionalen API-Keys direkt über deine iCloud Drive-Datei `kraftstoff_daten.json`.
* **Nahtlos zwischen Mac & iPhone:** Ein Klick auf "Aus iCloud laden" synchronisiert deinen Mac und dein Smartphone in unter 0,1 Sekunden.

---

## 🚀 Quickstart & Lokale Entwicklung

### Voraussetzungen
* [Node.js](https://nodejs.org/) (Version 18 oder neuer)
* npm (oder pnpm / yarn)

### Installation & Start
```bash
# 1. Repository klonen
git clone https://github.com/<DEIN-BENUTZERNAME>/kraftstoff.git
cd kraftstoff

# 2. Abhängigkeiten installieren
npm install

# 3. Lokalen Entwicklungsserver starten
npm run dev
```
Die Web-App öffnet sich unter `http://localhost:5173/`.

### Produktions-Build
```bash
npm run build
```
Erzeugt ein optimiertes Bundle im Ordner `dist/`.

---

## 🌐 Deployment (1-Klick auf Vercel)

Die App ist als moderne Single Page Application (PWA) konzipiert und kann ohne laufende Serverkosten kostenlos auf **Vercel** oder **Cloudflare Pages** gehostet werden:

### Vercel Deployment:
1. Pushe das Projekt auf GitHub.
2. Gehe auf [vercel.com](https://vercel.com) und klicke auf **"Add New Project"** ➔ **"Import Git Repository"**.
3. Vercel erkennt das Vite-Projekt automatisch (Build Command: `npm run build`, Output Directory: `dist`).
4. Klicke auf **"Deploy"**.
5. Deine App ist sofort unter `https://<dein-projekt>.vercel.app` mit vollem HTTPS-Zertifikat erreichbar.

---

## 📱 Installation als PWA auf dem iPhone & Mac

Dank des integrierten Service Workers und Web App Manifests kann die Anwendung nativ installiert werden:

* **Auf dem iPhone (Safari):**
  1. Rufe deine HTTPS-URL in Safari auf.
  2. Tippe auf den **Teilen**-Button (Viereck mit Pfeil nach oben).
  3. Wähle **"Zum Home-Bildschirm"**.
  4. Die App startet ab sofort ohne Browser-Leiste im Vollbildmodus.

* **Auf dem Mac (Safari oder Chrome):**
  1. Öffne die URL in Safari oder Chrome.
  2. Klicke im Menü auf *Ablage ➔ Zum Dock hinzufügen* (Safari) bzw. das Installations-Symbol in der Adressleiste (Chrome).

---

## 🛠️ Verwendete Technologien

* **Frontend:** React 19, Vite 8, Lucide React
* **Machine Learning:** TensorFlow.js (`@tensorflow/tfjs`) mit IndexedDB-Storage
* **Visualisierung:** D3.js (`d3`, `d3-scale`, `d3-shape`, `d3-time`)
* **Kartenmaterial:** Leaflet (OpenStreetMap Bunt, Esri Street, Esri Satellit), OpenStreetMap Nominatim, Photon by Komoot
* **Design & UI:** Modernes minimalistisches UI-System (Clean Slate Palette, Glassmorphism, Micro-Animations)
* **Backend (optional):** Supabase (PostgreSQL, Edge Functions, pg_cron)

---

## 📄 Lizenz

Open-Source lizenziert unter der [MIT License](LICENSE).
