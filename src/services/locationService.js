/**
 * KRAFTSTOFF - Standorte & Suchradius-Verwaltung
 * 
 * Verwaltet benutzerdefinierte Standorte (z.B. Zuhause, Büro, Eltern)
 * mit individuellem Suchradius in Kilometern.
 * Inklusive OpenStreetMap Nominatim Geocoding für jede deutsche Adresse/Stadt!
 */

const STORAGE_KEY = 'kraftstoff_user_locations';
const ACTIVE_LOCATION_KEY = 'kraftstoff_active_location_id';

// Standard-Standorte
// Neutraler Startpunkt bis der erste GPS-Standort oder ein eigener Ort angelegt ist
export const INITIAL_LOCATIONS = [
  {
    id: 'loc-home-mitte',
    name: 'Startpunkt (Berlin Mitte)',
    address: 'Wird beim ersten Start durch deinen GPS-Standort ersetzt',
    lat: 52.5200,
    lng: 13.4050,
    radiusKm: 6.0,
    isDefault: true,
  },
];

// Vorab-definierte Schnellstart-Städte zur 1-Klick-Auswahl
export const QUICK_CITIES = [
  { id: 'quick-hh', name: 'Hamburg', lat: 53.5511, lng: 9.9937, address: 'Rathausmarkt, 20095 Hamburg' },
  { id: 'quick-m', name: 'München', lat: 48.1351, lng: 11.5820, address: 'Marienplatz, 80331 München' },
  { id: 'quick-k', name: 'Köln', lat: 50.9375, lng: 6.9603, address: 'Domkloster 4, 50667 Köln' },
  { id: 'quick-f', name: 'Frankfurt', lat: 50.1109, lng: 8.6821, address: 'Römerberg, 60311 Frankfurt' },
  { id: 'quick-s', name: 'Stuttgart', lat: 48.7758, lng: 9.1829, address: 'Schlossplatz, 70173 Stuttgart' },
  { id: 'quick-d', name: 'Düsseldorf', lat: 51.2277, lng: 6.7735, address: 'Marktplatz, 40213 Düsseldorf' },
  { id: 'quick-b', name: 'Berlin', lat: 52.5200, lng: 13.4050, address: 'Alexanderplatz, 10178 Berlin' },
];

// Offline Fallback-Koordinaten für über 40 deutsche Städte & Regionen
const CITY_COORDINATES = {
  hamburg: { lat: 53.5511, lng: 9.9937, city: 'Hamburg' },
  münchen: { lat: 48.1351, lng: 11.5820, city: 'München' },
  muenchen: { lat: 48.1351, lng: 11.5820, city: 'München' },
  köln: { lat: 50.9375, lng: 6.9603, city: 'Köln' },
  koeln: { lat: 50.9375, lng: 6.9603, city: 'Köln' },
  frankfurt: { lat: 50.1109, lng: 8.6821, city: 'Frankfurt am Main' },
  stuttgart: { lat: 48.7758, lng: 9.1829, city: 'Stuttgart' },
  düsseldorf: { lat: 51.2277, lng: 6.7735, city: 'Düsseldorf' },
  duesseldorf: { lat: 51.2277, lng: 6.7735, city: 'Düsseldorf' },
  leipzig: { lat: 51.3397, lng: 12.3731, city: 'Leipzig' },
  dortmund: { lat: 51.5136, lng: 7.4653, city: 'Dortmund' },
  essen: { lat: 51.4556, lng: 7.0116, city: 'Essen' },
  bremen: { lat: 53.0793, lng: 8.8017, city: 'Bremen' },
  dresden: { lat: 51.0504, lng: 13.7373, city: 'Dresden' },
  hannover: { lat: 52.3759, lng: 9.7320, city: 'Hannover' },
  nürnberg: { lat: 49.4521, lng: 11.0767, city: 'Nürnberg' },
  nuernberg: { lat: 49.4521, lng: 11.0767, city: 'Nürnberg' },
  duisburg: { lat: 51.4344, lng: 6.7623, city: 'Duisburg' },
  bochum: { lat: 51.4818, lng: 7.2162, city: 'Bochum' },
  wuppertal: { lat: 51.2562, lng: 7.1508, city: 'Wuppertal' },
  bielefeld: { lat: 52.0302, lng: 8.5325, city: 'Bielefeld' },
  bonn: { lat: 50.7374, lng: 7.0982, city: 'Bonn' },
  münster: { lat: 51.9607, lng: 7.6261, city: 'Münster' },
  muenster: { lat: 51.9607, lng: 7.6261, city: 'Münster' },
  kiel: { lat: 54.3233, lng: 10.1228, city: 'Kiel' },
  mannheim: { lat: 49.4875, lng: 8.4660, city: 'Mannheim' },
  karlsruhe: { lat: 49.0069, lng: 8.4037, city: 'Karlsruhe' },
  augsburg: { lat: 48.3705, lng: 10.8978, city: 'Augsburg' },
  wiesbaden: { lat: 50.0782, lng: 8.2398, city: 'Wiesbaden' },
  freiburg: { lat: 47.9990, lng: 7.8421, city: 'Freiburg im Breisgau' },
  mönchengladbach: { lat: 51.1805, lng: 6.4428, city: 'Mönchengladbach' },
  braunschweig: { lat: 52.2689, lng: 10.5268, city: 'Braunschweig' },
  chemnitz: { lat: 50.8278, lng: 12.9214, city: 'Chemnitz' },
  aachen: { lat: 50.7753, lng: 6.0839, city: 'Aachen' },
  halle: { lat: 51.4828, lng: 11.9698, city: 'Halle (Saale)' },
  magdeburg: { lat: 52.1205, lng: 11.6276, city: 'Magdeburg' },
  erfurt: { lat: 50.9848, lng: 11.0299, city: 'Erfurt' },
  mainz: { lat: 49.9929, lng: 8.2473, city: 'Mainz' },
  lübeck: { lat: 53.8655, lng: 10.6866, city: 'Lübeck' },
  rostock: { lat: 54.0924, lng: 12.0991, city: 'Rostock' },
  kassel: { lat: 51.3127, lng: 9.4797, city: 'Kassel' },
  potsdam: { lat: 52.3906, lng: 13.0645, city: 'Potsdam' },
  berlin: { lat: 52.5200, lng: 13.4050, city: 'Berlin' },
  wannsee: { lat: 52.4200, lng: 13.1400, city: 'Berlin-Wannsee' },
};

/**
 * Haversine-Distanzberechnung zwischen zwei Koordinaten in Kilometern.
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Erdradius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
}

const GPS_ERROR_TEXT = {
  1: 'Standortzugriff nicht erlaubt. Bitte in den Einstellungen (Safari → Standort) freigeben.',
  2: 'Standort konnte nicht bestimmt werden (kein GPS-/WLAN-Signal).',
  3: 'Standortbestimmung dauert zu lange. Bitte erneut versuchen.',
};

/**
 * Aktuelle Position mit verständlichen Fehlermeldungen. Versucht erst genau (GPS), bei Zeitüberschreitung
 * noch einmal mit geringerer Genauigkeit. Positionen bis 1 Minute alt werden wiederverwendet.
 * @returns {Promise<{lat:number, lng:number, accuracy:number}>}
 */
export function getCurrentPosition({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new Error('Standort ist nur über eine sichere Verbindung (https) verfügbar.'));
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Dieses Gerät bzw. dieser Browser unterstützt keine Standortbestimmung.'));
      return;
    }
    const ok = (pos) => resolve({
      lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
      lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
      accuracy: pos.coords.accuracy,
    });
    const fail = (err) => reject(new Error(GPS_ERROR_TEXT[err?.code] || err?.message || 'Standort nicht verfügbar.'));
    navigator.geolocation.getCurrentPosition(
      ok,
      (err) => {
        if (err?.code === 3 || err?.code === 2) {
          navigator.geolocation.getCurrentPosition(ok, fail, { timeout: timeoutMs, enableHighAccuracy: false, maximumAge: 5 * 60 * 1000 });
        } else {
          fail(err);
        }
      },
      { timeout: timeoutMs, enableHighAccuracy: true, maximumAge: 60 * 1000 }
    );
  });
}

class LocationService {
  constructor() {
    this.locations = this.loadLocations();
    this.activeLocationId = this.loadActiveLocationId();
  }

  loadLocations() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((loc, idx) => ({
            ...loc,
            id: loc.id || `loc-stored-${idx}`,
            name: loc.name || 'Standort',
            address: loc.address || '',
            lat: typeof loc.lat === 'number' && !isNaN(loc.lat) ? loc.lat : parseFloat(loc.lat) || 52.5200,
            lng: typeof loc.lng === 'number' && !isNaN(loc.lng) ? loc.lng : parseFloat(loc.lng) || 13.4050,
            radiusKm: typeof loc.radiusKm === 'number' && !isNaN(loc.radiusKm) ? loc.radiusKm : parseFloat(loc.radiusKm) || 5.0,
          }));
        }
      }
    } catch (e) {
      console.warn('Error reading stored locations, using defaults:', e);
    }
    return [...INITIAL_LOCATIONS];
  }

  loadActiveLocationId() {
    try {
      const stored = localStorage.getItem(ACTIVE_LOCATION_KEY);
      if (stored && this.locations.some((l) => l.id === stored)) return stored;
    } catch {}
    return this.locations[0]?.id || INITIAL_LOCATIONS[0].id;
  }

  saveLocations(newLocations) {
    const sanitized = (Array.isArray(newLocations) && newLocations.length > 0 ? newLocations : INITIAL_LOCATIONS).map((loc, idx) => ({
      ...loc,
      id: loc.id || `loc-${idx}`,
      name: loc.name || 'Standort',
      address: loc.address || '',
      lat: typeof loc.lat === 'number' && !isNaN(loc.lat) ? loc.lat : parseFloat(loc.lat) || 52.5200,
      lng: typeof loc.lng === 'number' && !isNaN(loc.lng) ? loc.lng : parseFloat(loc.lng) || 13.4050,
      radiusKm: typeof loc.radiusKm === 'number' && !isNaN(loc.radiusKm) ? loc.radiusKm : parseFloat(loc.radiusKm) || 5.0,
    }));
    this.locations = sanitized;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch (e) {
      console.warn('Could not persist locations:', e);
    }
    return this.locations;
  }

  getActiveLocation() {
    const found = this.locations.find((l) => l.id === this.activeLocationId);
    return found || this.locations[0] || INITIAL_LOCATIONS[0];
  }

  setActiveLocationId(id) {
    this.activeLocationId = id || (this.locations[0]?.id || INITIAL_LOCATIONS[0].id);
    try {
      localStorage.setItem(ACTIVE_LOCATION_KEY, this.activeLocationId);
      localStorage.setItem('kraftstoff_custom_location_set', 'true');
    } catch (e) {
      console.warn('Could not persist active location ID:', e);
    }
    return this.getActiveLocation();
  }

  /**
   * Multi-Provider Geocoding:
   * 1. Photon by Komoot (blitzschnell, Straßen- & PLZ-genau, ohne API-Key, kein User-Agent Zwang)
   * 2. Open-Meteo Geocoding (extrem schnell für alle deutschen Städte und Gemeinden)
   * 3. OpenStreetMap Nominatim
   * 4. Smart Offline-Lexikon für 40+ deutsche Städte
   */
  async geocodeAddress(query, { bias = null } = {}) {
    if (!query || query.trim() === '') return null;
    const clean = query.trim().toLowerCase();
    const biasParams = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
      ? `&lat=${bias.lat.toFixed(4)}&lon=${bias.lng.toFixed(4)}`
      : '&lat=51.1657&lon=10.4515'; // Mitte Deutschlands

    // 1. Photon by Komoot API (Weltweit, auf OpenStreetMap-Basis, keine restriktiven Browser-Limits)
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1${biasParams}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.features && data.features.length > 0) {
          const feat = data.features[0];
          const coords = feat.geometry?.coordinates;
          if (coords && coords.length >= 2) {
            const lng = parseFloat(coords[0]);
            const lat = parseFloat(coords[1]);
            const props = feat.properties || {};
            const displayName = [props.name, props.street, props.city || props.town, props.state]
              .filter(Boolean)
              .join(', ') || query;
            return {
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6)),
              displayName,
            };
          }
        }
      }
    } catch (err) {
      console.warn('Photon Komoot lookup notice:', err);
    }

    // 2. Open-Meteo Geocoding API (Hochverfügbar, unbeschränkt für Browser)
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=de&format=json`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.results && data.results.length > 0) {
          const r = data.results[0];
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            return {
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6)),
              displayName: `${r.name}, ${r.admin1 || ''} (${r.country || 'Deutschland'})`,
            };
          }
        }
      }
    } catch (err) {
      console.warn('Open-Meteo lookup notice:', err);
    }

    // 3. OpenStreetMap Nominatim API
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'de,en' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          if (!isNaN(lat) && !isNaN(lng)) {
            return {
              lat: parseFloat(lat.toFixed(6)),
              lng: parseFloat(lng.toFixed(6)),
              displayName: data[0].display_name,
            };
          }
        }
      }
    } catch (err) {
      console.warn('Nominatim network notice:', err);
    }

    // 4. Intelligentes Offline-Matching für alle deutschen Städte
    // a) Exakter Treffer
    if (CITY_COORDINATES[clean]) {
      const c = CITY_COORDINATES[clean];
      return { lat: c.lat, lng: c.lng, displayName: c.city };
    }
    // b) Enthaltenes Wort (z.B. "Köln Ehrenfeld" oder "Hamburg Altona")
    for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
      if (clean.includes(key) || clean.includes(coords.city.toLowerCase())) {
        return {
          lat: coords.lat,
          lng: coords.lng,
          displayName: coords.city,
        };
      }
    }

    return null;
  }

  /**
   * Reverse Geocoding: Ermittelt Ort und Straße zu Koordinaten
   */
  async reverseGeocode(lat, lng) {
    // 1. Nominatim Reverse
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'de,en' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          const address = data.address || {};
          const cityOrTown = address.city || address.town || address.village || address.suburb || 'Aktueller Standort';
          return {
            displayName: data.display_name,
            shortName: cityOrTown,
            road: address.road || '',
          };
        }
      }
    } catch (e) {
      console.warn('Reverse geocode Nominatim notice:', e);
    }

    // 2. Photon Reverse Fallback
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.features?.[0]?.properties) {
          const p = data.features[0].properties;
          const town = p.city || p.town || p.district || 'Mein Standort';
          return {
            displayName: `${p.name || ''} ${p.street || ''}, ${town}`.trim(),
            shortName: town,
            road: p.street || '',
          };
        }
      }
    } catch {}

    return {
      displayName: `GPS-Position (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      shortName: 'Mein Standort',
      road: '',
    };
  }

  /**
   * Erstellt oder aktualisiert einen dedizierten GPS-Standort und aktiviert ihn sofort.
   */
  async createOrUpdateGpsLocation(lat, lng) {
    const geo = await this.reverseGeocode(lat, lng);
    const existing = this.locations.find((l) => l.id === 'loc-current-gps');
    const locData = {
      id: 'loc-current-gps',
      name: `GPS: ${geo.shortName}`,
      address: geo.displayName,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      radiusKm: existing?.radiusKm || 6.0,
      isDefault: true,
    };
    let updated;
    if (existing) {
      updated = this.locations.map((l) => (l.id === 'loc-current-gps' ? { ...l, ...locData } : l));
    } else {
      updated = [locData, ...this.locations.filter((l) => l.id !== 'loc-home-mitte')];
    }
    this.saveLocations(updated);
    this.setActiveLocationId('loc-current-gps');
    return { location: locData, locations: updated };
  }

  /**
   * 1-Klick-Wechsel zu einer Schnellstart-Stadt
   */
  switchToQuickCity(cityConfig) {
    const locId = `loc-${cityConfig.id}`;
    const existing = this.locations.find((l) => l.id === locId);
    let updated;
    const locData = {
      id: locId,
      name: `${cityConfig.name} Zentrum`,
      address: cityConfig.address,
      lat: cityConfig.lat,
      lng: cityConfig.lng,
      radiusKm: 6.0,
      isDefault: false,
    };
    if (existing) {
      updated = this.locations;
    } else {
      updated = [locData, ...this.locations];
    }
    this.saveLocations(updated);
    this.setActiveLocationId(locId);
    return { location: existing || locData, locations: this.locations };
  }

  async addLocation(data) {
    let lat = parseFloat(data.lat);
    let lng = parseFloat(data.lng);

    // Falls Adresse vorhanden und keine exakten Koordinaten übergeben:
    if ((isNaN(lat) || isNaN(lng) || !lat || !lng) && data.address) {
      const geo = await this.geocodeAddress(data.address);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    // Wenn keine gültigen Koordinaten gefunden wurden, Fehlermeldung statt stummem Berlin-Fallback!
    if (isNaN(lat) || isNaN(lng) || !lat || !lng) {
      throw new Error(`Die Koordinaten für "${data.address || data.name}" konnten nicht ermittelt werden. Bitte prüfe die Eingabe oder gib die Koordinaten (Breite/Länge) direkt an.`);
    }

    const newLoc = {
      id: `loc-${Date.now()}`,
      name: data.name || 'Neuer Standort',
      address: data.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
      radiusKm: parseFloat(data.radiusKm) || 5.0,
      isDefault: false,
    };
    const updated = [...this.locations, newLoc];
    this.saveLocations(updated);
    this.setActiveLocationId(newLoc.id);
    return newLoc;
  }

  updateLocation(id, updates) {
    const updated = this.locations.map((l) => (l.id === id ? { ...l, ...updates } : l));
    this.saveLocations(updated);
    return updated;
  }

  deleteLocation(id) {
    if (this.locations.length <= 1) return this.locations;
    const updated = this.locations.filter((l) => l.id !== id);
    this.saveLocations(updated);
    if (this.activeLocationId === id) {
      this.setActiveLocationId(updated[0].id);
    }
    return updated;
  }

  /**
   * Filtert Tankstellen basierend auf dem aktiven Standort und Radius.
   * Aktualisiert zudem das distanceKm-Attribut bezogen auf diesen Standort.
   */
  filterStationsByRadius(stations, location = this.getActiveLocation()) {
    if (!stations || !Array.isArray(stations) || stations.length === 0) return [];
    const loc = location || this.getActiveLocation();
    const locLat = parseFloat(loc?.lat);
    const locLng = parseFloat(loc?.lng);
    const radius = parseFloat(loc?.radiusKm) || 6.0;

    if (isNaN(locLat) || isNaN(locLng)) {
      return stations;
    }

    // Abstand immer neu zum gewählten Ort berechnen; kleine Toleranz für Rundungen der API
    const out = [];
    for (const station of stations) {
      const stLat = parseFloat(station.lat);
      const stLng = parseFloat(station.lng);
      if (isNaN(stLat) || isNaN(stLng)) continue;
      const dist = calculateHaversineDistance(locLat, locLng, stLat, stLng);
      if (!Number.isFinite(dist) || dist > radius + 0.1) continue;
      out.push({ ...station, distanceKm: dist, isWithinRadius: true });
    }
    return out;
  }
}

export const locationService = new LocationService();
