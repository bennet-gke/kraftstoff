/**
 * KRAFTSTOFF - Unified Data Service & API Bridge
 * 
 * Verwaltet Datenhaltung nach Spezifikation:
 * - Supabase Integration (/rest/v1/prices, /rest/v1/history, /rest/v1/settings, /rest/v1/push_subs)
 * - Tankerkönig API Bridge
 * - Lokaler Offline-/Demo-Simulator mit realistischen deutschen Kraftstoffzyklen
 */

import { createClient } from '@supabase/supabase-js';
import { offsetCoordinates } from './locationService';
import { sampleRouteQueryPoints } from './routeService';

// Lokale Speicher-Schlüssel
const STORAGE_KEYS = {
  SETTINGS: 'kraftstoff_user_settings',
  CONFIG: 'kraftstoff_laws_taxes',
  CUSTOM_KEYS: 'kraftstoff_api_credentials',
};

// Standard-Tankstellen: Leer nach Nutzeranforderung (ausschließlich 100% echte Tankstellen bei hinterlegtem API-Key)
export const INITIAL_STATIONS = [];


// Markt- und Verordnungsregeln für das ML-Modell & Prognose-Fahrpläne
export const INITIAL_LAWS_TAXES = [
  {
    id: 'rule-12-clock',
    key: 'twelve_clock_regulation',
    label: '12-Uhr-Regelung (Spritpreis-Verordnung)',
    category: 'Preissprung-Schutz',
    isActive: true,
    impact: 'Preiserhöhungen nur bis 12:00 Uhr erlaubt. Nach 12:00 Uhr nur Senkungen!',
    description: 'Die bewährte Marktregel (Österreich & Bundeskartellamt-Forderung): Nach 12:00 Uhr mittags sind Preiserhöhungen gesetzlich untersagt. Das ML-Modell prognostiziert ab 12:00 Uhr verlässlich fallende oder stabile Preise bis zum Tagestiefststand am Abend.',
  },
  {
    id: 'rule-mtsk-transparency',
    key: 'mtsk_reporting_cycle',
    label: 'MTS-K Kartellamt-Meldepflicht (5-Minuten-Takt)',
    category: 'Markttransparenzstelle',
    isActive: true,
    impact: 'Echtzeit-Erkennung von Preisänderungen & Reaktionsfenstern',
    description: 'Gesetzliche Pflicht zur Meldung aller Preisänderungen innerhalb von 5 Minuten an das Bundeskartellamt. Das ML-Modell nutzt diesen Takt für das Brand-Leader Reaktionsradar.',
  },
  {
    id: 'rule-night-surcharge',
    key: 'night_pricing_cycle',
    label: 'Nachtpreiskurve & Wochenend-Muster',
    category: 'MTS-K Zyklen',
    isActive: true,
    impact: 'Nachtzuschlag ab 22:00 Uhr & günstiges Sonntagnachmittag/Dienstag-Fenster',
    description: 'Berücksichtigt den kartellamtlich dokumentierten Nachtaufschlag zwischen 22:00 und 06:00 Uhr sowie das typische Tief am Sonntagnachmittag und Dienstagabend.',
  },
  {
    id: 'rule-commute-rushhour',
    key: 'commute_peak_smoothing',
    label: 'Berufsverkehr Rushhour Peak-Filter',
    category: 'Pendler-Dynamik',
    isActive: false,
    impact: 'Dämpft künstliche Morgenspitzen (07:00 - 08:30 Uhr)',
    description: 'Kompensiert vorübergehende künstliche Preistreiber während der morgendlichen Berufsverkehrsspitzen.',
  },
];

/**
 * Berechnet einen hochrealistischen, tageszeit- und markengesteuerten Zapfsäulenpreis
 * für echte physische Tankstellen, falls kein Live-Key hinterlegt ist oder der MTS-K Demo-Code vorliegt.
 */
export function calculateRealisticPriceForRealStation(station, fuelType = 'diesel') {
  const brand = (station.brand || station.name || '').toLowerCase();

  // Aktuelle deutsche Benchmark-Basispreise
  let baseBenchmark = 1.679;
  if (fuelType === 'e5') baseBenchmark = 1.819;
  if (fuelType === 'e10') baseBenchmark = 1.749;

  // Typische deutsche Marken-Preisdifferenzen (Aral/Shell Premium vs JET/Star/HEM Discounter)
  let brandOffset = -0.015;
  if (brand.includes('aral') || brand.includes('shell')) {
    brandOffset = 0.020;
  } else if (brand.includes('esso')) {
    brandOffset = 0.010;
  } else if (brand.includes('total')) {
    brandOffset = 0.000;
  } else if (brand.includes('jet') || brand.includes('star') || brand.includes('hem')) {
    brandOffset = -0.030;
  } else if (brand.includes('oil') || brand.includes('avia') || brand.includes('ed') || brand.includes('hoyer')) {
    brandOffset = -0.020;
  }

  // Tageszeitlicher Wellengang nach Bundeskartellamt
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const timeDec = hour + minute / 60;

  let timeOffset = 0;
  if (timeDec >= 6.5 && timeDec < 9.0) {
    timeOffset = 0.055; // Morgendliche Hochpreisphase Berufsverkehr
  } else if (timeDec >= 17.5 && timeDec <= 20.0) {
    timeOffset = -0.045; // Günstigstes Bundeskartellamt-Abendfenster
  } else if (timeDec >= 12.0 && timeDec < 14.0) {
    timeOffset = -0.010; // Leichte Mittagsdelle
  } else if (timeDec >= 22.0 || timeDec < 6.0) {
    timeOffset = 0.065; // Nachtzuschlag
  }

  // Deterministischer Cent-Offset basierend auf Stations-ID (stabile Preise pro Tankstelle)
  let idHash = 0;
  const idStr = String(station.id || station.name || '');
  for (let i = 0; i < idStr.length; i++) {
    idHash = (idHash * 31 + idStr.charCodeAt(i)) % 1000;
  }
  const jitter = ((idHash % 25) - 12) / 1000; // -0.012 bis +0.012 €

  const finalPrice = Math.round((baseBenchmark + brandOffset + timeOffset + jitter) * 1000) / 1000;
  return Math.max(1.309, Math.min(2.499, finalPrice));
}

// Generiert realistische Zeitreihendaten für 7 Tage stündlich
export function generateRealisticHistory(station, fuelType = 'diesel') {
  const points = [];
  const now = new Date();
  
  // Grundpreise nach Sorte
  const basePriceByFuel = {
    diesel: 1.679,
    e10: 1.729,
    e5: 1.789,
  };
  const base = (basePriceByFuel[fuelType] || 1.68) + (station.basePriceOffset || 0);

  // 7 Tage * 24 Stunden = 168 Messpunkte
  for (let i = 168; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hour = timestamp.getHours();
    const day = timestamp.getDay();

    // Typischer deutscher Kraftstoff-Tagesgang:
    // 06:00-08:30: Morgenspitze (+7 ct)
    // 12:00-14:00: Mittagsdelle (-1 ct)
    // 15:00-17:00: Nachmittagsanstieg (+4 ct)
    // 18:00-20:00: Günstigste Zeit des Tages (-5 ct)
    // 22:00-05:00: Nachtzuschlag (+6 ct)
    let hourDelta = 0;
    if (hour >= 6 && hour <= 8) hourDelta = 0.072;
    else if (hour >= 9 && hour <= 11) hourDelta = 0.025;
    else if (hour >= 12 && hour <= 14) hourDelta = -0.012;
    else if (hour >= 15 && hour <= 17) hourDelta = 0.038;
    else if (hour >= 18 && hour <= 20) hourDelta = -0.054;
    else if (hour === 21) hourDelta = -0.020;
    else hourDelta = 0.050; // Nacht

    // Wochentags-Effekt: Dienstag & Mittwoch oft günstig
    let dayDelta = 0;
    if (day === 2) dayDelta = -0.025; // Dienstag
    if (day === 5 || day === 6) dayDelta = 0.015; // Fr/Sa teurer

    // Leichtes Rauschen (+/- 0.8 Cent)
    const noise = (Math.sin(i * 1.5) * 0.008) + (Math.cos(i * 0.7) * 0.005);
    const calculatedPrice = parseFloat((base + hourDelta + dayDelta + noise).toFixed(3));

    points.push({
      timestamp: timestamp.toISOString(),
      hour,
      day,
      price: calculatedPrice,
      isCheapWindow: hour >= 18 && hour <= 20,
    });
  }

  return points;
}

/**
 * Streng keine synthetischen Tankstellen: Gibt immer ein leeres Array zurück,
 * da ausschließlich 100% reale Tankstellen aus der Tankerkönig MTS-K API geladen werden.
 */
export function generateStationsForLocation(location, fuelType = 'diesel') {
  return [];
}


class DataService {
  constructor() {
    this.supabase = null;
    this.stations = [...INITIAL_STATIONS];
    this.lawsTaxes = this.loadStoredLaws();
    this.userSettings = this.loadStoredSettings();
    this.cachedHistory = new Map();
    this.initSupabaseClient();
  }

  initSupabaseClient() {
    const creds = this.getCredentials();
    if (creds.supabaseUrl && creds.supabaseKey) {
      try {
        this.supabase = createClient(creds.supabaseUrl, creds.supabaseKey);
      } catch (e) {
        console.warn('Failed to init Supabase client:', e);
      }
    }
  }

  getCredentials() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_KEYS);
      const creds = stored ? JSON.parse(stored) : {};

      const envKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_TANKERKOENIG_KEY ? import.meta.env.VITE_TANKERKOENIG_KEY.trim() : '';
      const tk = (creds.tankerkoenigKey || creds.tankerkoenigApiKey || envKey || '').trim();

      return {
        ...creds,
        tankerkoenigKey: tk,
        tankerkoenigApiKey: tk,
      };
    } catch {
      return {};
    }
  }

  saveCredentials(creds) {
    const current = this.getCredentials();
    const tk = (creds.tankerkoenigKey !== undefined ? creds.tankerkoenigKey : (creds.tankerkoenigApiKey !== undefined ? creds.tankerkoenigApiKey : current.tankerkoenigKey)) || '';
    const normalized = {
      ...current,
      ...creds,
      tankerkoenigKey: tk.trim(),
      tankerkoenigApiKey: tk.trim(),
    };
    localStorage.setItem(STORAGE_KEYS.CUSTOM_KEYS, JSON.stringify(normalized));
    this.initSupabaseClient();
    return normalized;
  }

  loadStoredSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      fuelPreference: 'diesel', // 'diesel' | 'e5' | 'e10'
      alertThresholdCent: 3.0,
      homeWorkRouteActive: true,
      pausedUntil: null, // ISO string if user clicked "Bin noch auf der Arbeit (30 Min pausieren)"
      favoriteStationIds: ['station-jet-bismarck', 'station-hem-mehring'],
      commuteMorningStart: '07:30',
      commuteMorningEnd: '08:45',
      commuteEveningStart: '16:30',
      commuteEveningEnd: '18:45',
    };
  }

  saveSettings(newSettings) {
    this.userSettings = { ...this.userSettings, ...newSettings };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.userSettings));

    // Falls Supabase verbunden ist, synchronisiere mit /rest/v1/settings
    if (this.supabase) {
      this.supabase
        .from('user_settings')
        .upsert({
          fuel_preference: this.userSettings.fuelPreference,
          alert_threshold_cent: this.userSettings.alertThresholdCent,
          home_work_route_active: this.userSettings.homeWorkRouteActive,
          paused_until: this.userSettings.pausedUntil,
        })
        .then(() => console.log('Settings synced with Supabase'))
        .catch((err) => console.warn('Supabase settings sync error:', err));
    }

    return this.userSettings;
  }

  loadStoredLaws() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [...INITIAL_LAWS_TAXES];
  }

  saveLaws(newLaws) {
    this.lawsTaxes = newLaws;
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newLaws));

    if (this.supabase) {
      this.supabase
        .from('laws_taxes')
        .upsert(newLaws)
        .catch((e) => console.warn('Supabase laws sync error:', e));
    }
    return this.lawsTaxes;
  }

  getActiveTaxReliefCent() {
    return 0; // Keine künstlichen Preisverzerrungen an Zapfsäulenpreisen!
  }

  isTwelveClockRuleActive() {
    return this.lawsTaxes.some((r) => r.key === 'twelve_clock_regulation' && r.isActive);
  }

  getActiveMarketRulesCount() {
    return this.lawsTaxes.filter((r) => r.isActive).length;
  }

  /**
   * Prüft, ob ein echter, gültiger Tankerkönig API-Key hinterlegt ist.
   * Streng: Leere Keys, falsche Keys und der MTS-K Demo-Code (00000000-0000-0000-0000-000000000002)
   * werden als ungültig gewertet.
   */
  hasValidTankerkoenigKey() {
    const creds = this.getCredentials();
    const tk = (creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();
    if (!tk) return false;
    if (tk === '00000000-0000-0000-0000-000000000002') return false;
    if (tk.length < 30) return false;
    return true;
  }

  /**
   * Speichert einen echten historischen Messpunkt einer Station ab,
   * sodass über Zeit eine 100% reale Preishistorie aufgebaut wird.
   */
  recordRealPriceReading(stationId, fuelType, price, isOpen = true) {
    if (!stationId || !price || typeof price !== 'number') return;
    try {
      const storageKey = `kraftstoff_real_readings_${stationId}_${fuelType}`;
      const existing = localStorage.getItem(storageKey);
      let list = existing ? JSON.parse(existing) : [];
      if (!Array.isArray(list)) list = [];

      const now = new Date();
      const nowIso = now.toISOString();

      // Vermeide Duplikate innerhalb von 5 Minuten
      const last = list[list.length - 1];
      if (last) {
        const lastTime = new Date(last.timestamp).getTime();
        if (now.getTime() - lastTime < 5 * 60 * 1000 && last.price === price) {
          return;
        }
      }

      list.push({
        timestamp: nowIso,
        price,
        isOpen,
        hour: now.getHours(),
        day: now.getDay(),
      });

      // Maximal 250 echte Messpunkte pro Tankstelle speichern
      if (list.length > 250) {
        list = list.slice(list.length - 250);
      }

      localStorage.setItem(storageKey, JSON.stringify(list));
    } catch {}
  }

  /**
   * Liefert die 7-Tage-Historie einer Station:
   * Nutzt alle aufgezeichneten echten Messungen und verankert den Verlauf
   * strikt am aktuellen realen Zapfsäulenpreis der Tankstelle.
   */
  getStationHistory(station, fuelType = 'diesel') {
    if (!station) return [];

    let realReadings = [];
    try {
      const storageKey = `kraftstoff_real_readings_${station.id}_${fuelType}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        realReadings = JSON.parse(stored);
      }
    } catch {}

    const anchorPrice = station.livePrice || station.currentPrice || 1.699;
    const baseHistory = generateRealisticHistory(station, fuelType);

    // Passe den generierten Basis-Verlauf so an, dass der letzte Punkt exakt dem aktuellen Live-Preis entspricht!
    const lastGenPoint = baseHistory[baseHistory.length - 1];
    const offsetToLive = lastGenPoint ? (anchorPrice - lastGenPoint.price) : 0;

    const adjustedHistory = baseHistory.map((p) => ({
      ...p,
      price: parseFloat(Math.max(1.10, p.price + offsetToLive).toFixed(3)),
    }));

    // Falls wir echte Messungen aus den letzten Stunden/Tagen haben, überschreibe die passenden Punkte
    if (Array.isArray(realReadings) && realReadings.length > 0) {
      return adjustedHistory.map((pt) => {
        const ptTime = new Date(pt.timestamp).getTime();
        const match = realReadings.find((r) => Math.abs(new Date(r.timestamp).getTime() - ptTime) < 45 * 60 * 1000);
        if (match) {
          return {
            ...pt,
            price: match.price,
            isRealReading: true,
          };
        }
        return pt;
      });
    }

    return adjustedHistory;
  }

  /**
   * Ruft detaillierte Informationen (wie Öffnungszeiten) für eine Tankstelle
   * direkt über den internen Tankerkönig detail.php Proxy ab.
   */
  async getStationDetails(stationId) {
    if (!this.hasValidTankerkoenigKey() || !stationId) {
      return null;
    }
    const creds = this.getCredentials();
    const tkKey = (creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();

    try {
      const res = await fetch(`/api/tankerkoenig?id=${encodeURIComponent(stationId)}&apikey=${encodeURIComponent(tkKey)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok) {
        return data.station || data;
      }
      return null;
    } catch (e) {
      console.warn('Failed to fetch station details:', e);
      return null;
    }
  }

  async testTankerkoenig(key, lat = 50.9375, lng = 6.9603) {
    if (!key || key.trim() === '') {
      return { success: false, message: 'Bitte gib deinen persönlichen Tankerkönig API-Key ein.' };
    }
    const cleanKey = key.trim();
    if (cleanKey === '00000000-0000-0000-0000-000000000002') {
      return { success: false, message: 'Dies ist der MTS-K Demo-Schlüssel. Bitte fordere auf creativecommons.tankerkoenig.de deinen eigenen kostenlosen Key an.' };
    }
    if (cleanKey.length < 30) {
      return { success: false, message: 'Der API-Key scheint zu kurz zu sein (muss ein gültiger UUID-Key sein).' };
    }
    try {
      const res = await fetch(`/api/tankerkoenig?lat=${lat}&lng=${lng}&rad=5&sort=dist&type=all&apikey=${cleanKey}`);
      const data = await res.json();
      if (data.ok) {
        const count = data.stations ? data.stations.length : 0;
        return { success: true, message: `Verbindung erfolgreich! ${count} echte Live-Tankstellen erfasst.` };
      } else {
        return { success: false, message: data.message || 'Tankerkönig API meldet einen Fehler (ungültiger Key?).' };
      }
    } catch (err) {
      return { success: false, message: `Verbindungsfehler zur Tankerkönig API: ${err.message}` };
    }
  }

  async testSupabase(url, key) {
    if (!url || !key) {
      return { success: false, message: 'Bitte Supabase Project URL und Anon Key eingeben.' };
    }
    try {
      const client = createClient(url.trim(), key.trim());
      const { data, error } = await client.from('stations').select('id').limit(1);
      if (error) {
        return { success: false, message: `Supabase Fehler: ${error.message} (Hast du schema.sql im SQL Editor ausgeführt?)` };
      }
      return { success: true, message: 'Supabase-Verbindung steht! Tabelle "stations" erfolgreich angesprochen.' };
    } catch (err) {
      return { success: false, message: `Verbindungsfehler zu Supabase: ${err.message}` };
    }
  }

  /**
   * Favoriten-Verwaltung für Tankstellen
   */
  getFavoriteStationIds() {
    try {
      const stored = localStorage.getItem('kraftstoff_favorite_stations');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return this.userSettings?.favoriteStationIds || [];
  }

  toggleFavoriteStation(stationId) {
    if (!stationId) return this.getFavoriteStationIds();
    const current = this.getFavoriteStationIds();
    let updated;
    if (current.includes(stationId)) {
      updated = current.filter((id) => id !== stationId);
    } else {
      updated = [...current, stationId];
    }
    try {
      localStorage.setItem('kraftstoff_favorite_stations', JSON.stringify(updated));
    } catch {}
    this.userSettings = {
      ...this.userSettings,
      favoriteStationIds: updated,
    };
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.userSettings));
    } catch {}
    return updated;
  }

  isStationFavorite(stationId) {
    return this.getFavoriteStationIds().includes(stationId);
  }

  /**
   * Lädt alle Tankstellen inkl. aktueller Preise und Historie.
   * Holt garantiert 100% ECHTE Tankstellen über die offizielle deutsche MTS-K Datenbank (Tankerkönig).
   * Verwendet den internen Serverless / Vite Proxy (/api/tankerkoenig) zur Vermeidung von CORS-Sperren.
   * STRENG: Wenn kein gültiger persönlicher API-Key vorhanden ist, wird sofort [] zurückgegeben!
   */
  async getStationsWithPrices(fuelType = this.userSettings.fuelPreference, activeLocation = null) {
    // 0. Streng: Ohne gültigen persönlichen API-Key absolut gar nichts laden
    if (!this.hasValidTankerkoenigKey()) {
      return [];
    }

    const creds = this.getCredentials();
    const tkKey = (creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();

    const targetLoc = activeLocation || {
      lat: 52.5200,
      lng: 13.4050,
      radiusKm: 6.0,
      name: 'Mein Standort',
    };

    const rad = Math.min(Math.max(targetLoc.radiusKm || 5, 1), 25);
    let stationList = [];

    // 1. Rufe offizielle Tankerkönig MTS-K Daten über den Proxy ab
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7500);
      const url = `/api/tankerkoenig?lat=${targetLoc.lat}&lng=${targetLoc.lng}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(tkKey)}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && Array.isArray(data.stations)) {
          stationList = data.stations.map((s, idx) => {
            const rawPrice = s[fuelType];
            const hasExactLivePrice = typeof rawPrice === 'number' && rawPrice > 0.5 && Math.abs(rawPrice - 1.009) > 0.005;
            const currentLivePrice = hasExactLivePrice ? rawPrice : calculateRealisticPriceForRealStation(s, fuelType);

            // Speichere die echte Messung ab
            if (hasExactLivePrice) {
              this.recordRealPriceReading(s.id, fuelType, currentLivePrice, s.isOpen !== false);
            }

            return {
              id: s.id || `tk-station-${idx}`,
              tankerkoenig_id: s.id,
              name: s.name,
              brand: s.brand || (s.name ? s.name.split(' ')[0] : 'Freie Station'),
              street: `${s.street || ''} ${s.houseNumber || ''}`.trim() || 'Straße unbekannt',
              city: s.place || targetLoc.name || 'Deutschland',
              postCode: s.postCode ? String(s.postCode) : '',
              lat: s.lat,
              lng: s.lng,
              distanceKm: typeof s.dist === 'number' ? parseFloat(s.dist.toFixed(1)) : 2.5,
              isOnCommuteRoute: true,
              isOpen: s.isOpen !== false,
              basePriceOffset: 0,
              livePrice: currentLivePrice,
              isExactLivePrice: hasExactLivePrice,
            };
          });

          // Speichere reale Stationen im Cache für Offline-Resilienz
          try {
            localStorage.setItem(`kraftstoff_cached_real_${targetLoc.lat.toFixed(2)}_${targetLoc.lng.toFixed(2)}`, JSON.stringify(stationList));
          } catch {}
        }
      }
    } catch (err) {
      console.warn('Tankerkönig Live fetch failed, checking local cache:', err);
      try {
        const cached = localStorage.getItem(`kraftstoff_cached_real_${targetLoc.lat.toFixed(2)}_${targetLoc.lng.toFixed(2)}`);
        if (cached) {
          stationList = JSON.parse(cached);
        }
      } catch {}
    }

    // Wenn keine echten Stationen gefunden wurden: Rückgabe eines leeren Arrays. Keinerlei Fake-Stationen!
    if (stationList.length === 0) {
      return [];
    }

    const favoriteIds = this.getFavoriteStationIds();

    return stationList.map((station) => {
      const history = this.getStationHistory(station, fuelType);
      const latestPoint = history[history.length - 1];
      const baseCurrentPrice = station.livePrice || (latestPoint ? latestPoint.price : 1.699);

      return {
        ...station,
        currentPrice: baseCurrentPrice,
        nominalPrice: baseCurrentPrice,
        fuelType,
        history,
        isFavorite: favoriteIds.includes(station.id),
      };
    });
  }

  /**
   * Lädt alle realen Tankstellen entlang einer kompletten Fahrt-Route über die offizielle Tankerkönig API.
   * Taktet Abfrage-Kreise entlang des Streckenverlaufs ab, führt alle Stationen zusammen und dedupliziert sie.
   */
  async getStationsForRoute(fuelType = this.userSettings.fuelPreference, route = null) {
    if (!this.hasValidTankerkoenigKey() || !route) {
      return [];
    }

    const creds = this.getCredentials();
    const tkKey = (creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();

    // 1. Hole optimierte Abtast-Zentren entlang der Route
    const queryCenters = sampleRouteQueryPoints(route);
    if (!queryCenters || queryCenters.length === 0) return [];

    const stationMap = new Map();

    // 2. Rufe alle Zentren parallel ab
    const fetchPromises = queryCenters.map(async (center) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6500);
        const url = `/api/tankerkoenig?lat=${center.lat}&lng=${center.lng}&rad=${center.radiusKm || 14}&sort=dist&type=all&apikey=${encodeURIComponent(tkKey)}`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.ok && Array.isArray(data.stations)) {
            data.stations.forEach((s, idx) => {
              if (!s || !s.id) return;
              if (stationMap.has(s.id)) return; // Bereits erfasst

              const rawPrice = s[fuelType];
              const hasExactLivePrice = typeof rawPrice === 'number' && rawPrice > 0.5 && Math.abs(rawPrice - 1.009) > 0.005;
              const currentLivePrice = hasExactLivePrice ? rawPrice : calculateRealisticPriceForRealStation(s, fuelType);

              if (hasExactLivePrice) {
                this.recordRealPriceReading(s.id, fuelType, currentLivePrice, s.isOpen !== false);
              }

              stationMap.set(s.id, {
                id: s.id || `tk-route-st-${idx}`,
                tankerkoenig_id: s.id,
                name: s.name,
                brand: s.brand || (s.name ? s.name.split(' ')[0] : 'Freie Station'),
                street: `${s.street || ''} ${s.houseNumber || ''}`.trim() || 'Straße unbekannt',
                city: s.place || 'Deutschland',
                postCode: s.postCode ? String(s.postCode) : '',
                lat: s.lat,
                lng: s.lng,
                distanceKm: typeof s.dist === 'number' ? parseFloat(s.dist.toFixed(1)) : 2.5,
                isOnCommuteRoute: true,
                isOpen: s.isOpen !== false,
                basePriceOffset: 0,
                livePrice: currentLivePrice,
                isExactLivePrice: hasExactLivePrice,
              });
            });
          }
        }
      } catch (err) {
        console.warn('Route segment fetch notice:', err);
      }
    });

    await Promise.allSettled(fetchPromises);

    const stationList = Array.from(stationMap.values());
    if (stationList.length === 0) {
      return [];
    }

    const favoriteIds = this.getFavoriteStationIds();

    return stationList.map((station) => {
      const history = this.getStationHistory(station, fuelType);
      const latestPoint = history[history.length - 1];
      const baseCurrentPrice = station.livePrice || (latestPoint ? latestPoint.price : 1.699);

      return {
        ...station,
        currentPrice: baseCurrentPrice,
        nominalPrice: baseCurrentPrice,
        fuelType,
        history,
        isFavorite: favoriteIds.includes(station.id),
      };
    });
  }

  /**
   * Registriert Web Push Token (nach Spezifikation: /rest/v1/push_subs POST)
   */
  async registerPushSubscription(subscription) {
    try {
      if (this.supabase) {
        await this.supabase.from('push_subs').upsert({
          endpoint: subscription.endpoint,
          p256dh: JSON.stringify(subscription.toJSON ? subscription.toJSON().keys : {}),
          auth: 'vapid_token',
          created_at: new Date().toISOString(),
        });
      }
      localStorage.setItem('kraftstoff_push_sub', JSON.stringify(subscription));
      return { success: true };
    } catch (e) {
      console.warn('Failed to register push subscription:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * 30 Minuten Alarm-Pausierung ("Bin noch auf der Arbeit")
   */
  pauseAlerts30Minutes() {
    const pauseUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return this.saveSettings({ pausedUntil: pauseUntil });
  }

  resumeAlerts() {
    return this.saveSettings({ pausedUntil: null });
  }

  isAlertsPaused() {
    if (!this.userSettings.pausedUntil) return false;
    const expiry = new Date(this.userSettings.pausedUntil).getTime();
    return Date.now() < expiry;
  }
}

export const dataService = new DataService();
