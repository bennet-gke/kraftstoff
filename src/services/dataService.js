/**
 * KRAFTSTOFF - Daten-Service & Tankerkönig-Bridge
 *
 * - Lädt ausschließlich echte Tankstellen & Zapfsäulenpreise über den internen Proxy
 *   (/api/tankerkoenig -> Tankerkönig MTS-K). Keine synthetischen Preise, keine Demo-Daten.
 * - Zeichnet jeden frischen Live-Preis in der Preishistorie (IndexedDB) auf.
 * - Zwischengespeicherte Antworten (IndexedDB, max. 24 h) dienen nur als Offline-Notlösung und sind gekennzeichnet.
 * - Verwaltet Nutzereinstellungen, Favoriten (inkl. Stammdaten für den Abruf überall) und API-Zugangsdaten.
 */

import { planRouteQueries } from './routeService';
import { idbGet, idbSet } from './indexedDbStorage';
import { priceHistoryService, FUEL_TYPES } from './priceHistoryService';
import { calculateHaversineDistance } from './locationService';

const STORAGE_KEYS = {
  SETTINGS: 'kraftstoff_user_settings',
  CUSTOM_KEYS: 'kraftstoff_api_credentials',
  LEGACY_FAVORITES: 'kraftstoff_favorite_stations',
  LEGACY_LAWS: 'kraftstoff_laws_taxes',
  LEGACY_LIST_CACHE_PREFIX: 'kraftstoff_cached_tk_',
};

const IDB_CREDENTIALS_KEY = 'kraftstoff_api_credentials';
const IDB_LIST_CACHE_KEY = 'kraftstoff_tk_list_cache';
const DEMO_KEY = '00000000-0000-0000-0000-000000000002';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST_KNOWN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_CACHE_MAX_ENTRIES = 24;
const LIST_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTE_CONCURRENCY = 2;
const ROUTE_REQUEST_GAP_MS = 250;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_SETTINGS = {
  fuelPreference: 'diesel', // 'diesel' | 'e5' | 'e10'
  alertThresholdCent: 3.0,
  pausedUntil: null,
  favoriteStationIds: [],
  favoriteStations: {}, // id -> { name, brand, street, city, postCode, lat, lng } für den Abruf außerhalb des Bereichs
  commuteMorningStart: '07:30',
  commuteMorningEnd: '08:45',
  commuteEveningStart: '16:30',
  commuteEveningEnd: '18:45',
  dailyCommuteKm: 30,
  navApp: 'apple', // 'apple' (Standard) | 'google'
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`Konnte ${key} nicht speichern:`, e);
    return false;
  }
}

/** Führt asynchrone Aufgaben mit begrenzter Parallelität aus (Reihenfolge der Ergebnisse bleibt erhalten). */
async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

/** Nur die Felder, die die App braucht (spart Speicher im Offline-Cache). */
function compactRawStation(s) {
  return {
    id: s.id,
    name: s.name,
    brand: s.brand,
    street: s.street,
    houseNumber: s.houseNumber,
    postCode: s.postCode,
    place: s.place,
    lat: s.lat,
    lng: s.lng,
    dist: s.dist,
    isOpen: s.isOpen,
    diesel: s.diesel,
    e5: s.e5,
    e10: s.e10,
  };
}

class DataService {
  constructor() {
    this.userSettings = this.loadStoredSettings();
    /** Letzter Fehler der Tankerkönig-Anbindung ({ message, kind: 'api'|'network'|'key', at }) oder null */
    this.lastApiError = null;
    /** Herkunft der zuletzt geladenen Daten (für Hinweise "zwischengespeichert", "Strecke nur teilweise") */
    this.lastFetchInfo = { fromCache: false, cachedAt: null, partial: false, truncated: false, coveredKm: null, totalKm: null };
    /** Der Server hat einen eigenen Key (TANKERKOENIG_API_KEY) */
    this.serverKeyAvailable = false;
    this.listCache = null;
    this.listCacheLoading = null;
    try { localStorage.removeItem(STORAGE_KEYS.LEGACY_LAWS); } catch {}
    this.purgeLegacyListCache();
  }

  // ---------------------------------------------------------------------
  // Zugangsdaten
  // ---------------------------------------------------------------------

  getCredentials() {
    const creds = readJson(STORAGE_KEYS.CUSTOM_KEYS, {}) || {};
    const envKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_TANKERKOENIG_KEY
      ? String(import.meta.env.VITE_TANKERKOENIG_KEY).trim()
      : '';
    const tk = String(creds.tankerkoenigKey || creds.tankerkoenigApiKey || envKey || '').trim();
    return { ...creds, tankerkoenigKey: tk, tankerkoenigApiKey: tk };
  }

  getTankerkoenigKey() {
    return this.getCredentials().tankerkoenigKey;
  }

  /** Nur der vom Nutzer gespeicherte Key (ohne Entwicklungs-Umgebungsvariable) – für die Datenbank-Datei. */
  getStoredKey() {
    const creds = readJson(STORAGE_KEYS.CUSTOM_KEYS, {}) || {};
    return String(creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();
  }

  saveCredentials(creds = {}) {
    const current = this.getCredentials();
    const incoming = creds.tankerkoenigKey !== undefined
      ? creds.tankerkoenigKey
      : creds.tankerkoenigApiKey !== undefined
        ? creds.tankerkoenigApiKey
        : current.tankerkoenigKey;
    const tk = String(incoming || '').trim();
    const normalized = { tankerkoenigKey: tk, tankerkoenigApiKey: tk };
    writeJson(STORAGE_KEYS.CUSTOM_KEYS, normalized);
    idbSet(IDB_CREDENTIALS_KEY, normalized).catch(() => {});
    return normalized;
  }

  /** Stellt den API-Key aus IndexedDB wieder her, falls localStorage geleert wurde. */
  async restoreFromIndexedDb() {
    try {
      if (!this.hasPersonalKey()) {
        const idbCreds = await idbGet(IDB_CREDENTIALS_KEY);
        const tk = String(idbCreds?.tankerkoenigKey || idbCreds?.tankerkoenigApiKey || '').trim();
        if (tk) {
          writeJson(STORAGE_KEYS.CUSTOM_KEYS, { tankerkoenigKey: tk, tankerkoenigApiKey: tk });
          return { hasKey: this.hasValidTankerkoenigKey(), restored: true };
        }
      }
    } catch {}
    return { hasKey: this.hasValidTankerkoenigKey(), restored: false };
  }

  /** Eigener, formal gültiger Key (UUID, nicht der öffentliche Demo-Key). */
  hasPersonalKey() {
    const tk = this.getTankerkoenigKey();
    return !!tk && tk !== DEMO_KEY && UUID_RE.test(tk);
  }

  /** Abfragen möglich: eigener Key oder ein Key auf dem Server (Vercel-Umgebungsvariable). */
  hasValidTankerkoenigKey() {
    return this.hasPersonalKey() || this.serverKeyAvailable;
  }

  /** Fragt einmalig nach, ob der Server einen eigenen Key hat. */
  async probeServerKey() {
    try {
      const res = await fetch('/api/tankerkoenig?probe=1');
      const json = await res.json();
      this.serverKeyAvailable = !!(json && json.ok && json.serverKey);
    } catch {
      this.serverKeyAvailable = false;
    }
    return this.serverKeyAvailable;
  }

  /** Key-Parameter für den Proxy (leer = Server-Key verwenden). */
  keyParam() {
    return this.hasPersonalKey() ? encodeURIComponent(this.getTankerkoenigKey()) : '';
  }

  async testTankerkoenig(key, lat = 50.9375, lng = 6.9603) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return { success: false, message: 'Bitte gib deinen persönlichen Tankerkönig API-Key ein.' };
    if (cleanKey === DEMO_KEY) return { success: false, message: 'Dies ist der öffentliche Demo-Schlüssel. Bitte fordere auf creativecommons.tankerkoenig.de deinen eigenen kostenlosen Key an.' };
    if (!UUID_RE.test(cleanKey)) return { success: false, message: 'Der Key hat nicht das erwartete Format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.' };
    try {
      const res = await fetch(`/api/tankerkoenig?lat=${lat}&lng=${lng}&rad=5&type=all&apikey=${encodeURIComponent(cleanKey)}`);
      const data = await res.json();
      if (data.ok) {
        const n = data.stations?.length || 0;
        return { success: true, message: `Verbindung erfolgreich – ${n} ${n === 1 ? 'Tankstelle' : 'Tankstellen'} im Testgebiet gefunden.` };
      }
      return { success: false, message: String(data.message || 'Tankerkönig meldet einen Fehler (ungültiger Key?).').replace(/^ERROR:\s*/i, '') };
    } catch (err) {
      return { success: false, message: `Verbindungsfehler zur Tankerkönig API: ${err.message}` };
    }
  }

  // ---------------------------------------------------------------------
  // Einstellungen & Favoriten
  // ---------------------------------------------------------------------

  loadStoredSettings() {
    const stored = readJson(STORAGE_KEYS.SETTINGS, null);
    const merged = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
    // Einmalige Migration der alten separaten Favoritenliste
    const legacyFavs = readJson(STORAGE_KEYS.LEGACY_FAVORITES, null);
    if (Array.isArray(legacyFavs)) {
      const set = new Set([...(merged.favoriteStationIds || []), ...legacyFavs]);
      merged.favoriteStationIds = Array.from(set);
      try { localStorage.removeItem(STORAGE_KEYS.LEGACY_FAVORITES); } catch {}
      writeJson(STORAGE_KEYS.SETTINGS, merged);
    }
    if (!Array.isArray(merged.favoriteStationIds)) merged.favoriteStationIds = [];
    if (!merged.favoriteStations || typeof merged.favoriteStations !== 'object') merged.favoriteStations = {};
    if (!FUEL_TYPES.includes(merged.fuelPreference)) merged.fuelPreference = 'diesel';
    // Frühere Einstellung "automatisch" = Apple Karten
    if (merged.navApp !== 'google') merged.navApp = 'apple';
    return merged;
  }

  saveSettings(newSettings = {}) {
    this.userSettings = { ...this.userSettings, ...newSettings };
    writeJson(STORAGE_KEYS.SETTINGS, this.userSettings);
    return this.userSettings;
  }

  getFavoriteStationIds() {
    return Array.isArray(this.userSettings.favoriteStationIds) ? this.userSettings.favoriteStationIds : [];
  }

  getFavoriteMeta() {
    const meta = this.userSettings.favoriteStations;
    return meta && typeof meta === 'object' ? meta : {};
  }

  saveFavoriteStationIds(ids) {
    if (!Array.isArray(ids)) return this.getFavoriteStationIds();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const meta = { ...this.getFavoriteMeta() };
    Object.keys(meta).forEach((id) => { if (!unique.includes(id)) delete meta[id]; });
    this.saveSettings({ favoriteStationIds: unique, favoriteStations: meta });
    return this.getFavoriteStationIds();
  }

  /** Stammdaten einer Station für den späteren Abruf per ID (Favoriten außerhalb des Bereichs). */
  static metaOf(station) {
    if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;
    return {
      name: station.name || 'Tankstelle',
      brand: station.brand || '',
      street: station.street || '',
      city: station.city || '',
      postCode: station.postCode || '',
      lat: station.lat,
      lng: station.lng,
    };
  }

  /** Favorit umschalten. Akzeptiert die Station (bevorzugt, dann werden Stammdaten gemerkt) oder nur die ID. */
  toggleFavoriteStation(stationOrId) {
    const id = typeof stationOrId === 'string' ? stationOrId : stationOrId?.id;
    if (!id) return this.getFavoriteStationIds();
    const current = this.getFavoriteStationIds();
    const meta = { ...this.getFavoriteMeta() };
    let ids;
    if (current.includes(id)) {
      ids = current.filter((x) => x !== id);
      delete meta[id];
    } else {
      ids = [...current, id];
      const m = typeof stationOrId === 'object' ? DataService.metaOf(stationOrId) : null;
      if (m) meta[id] = m;
    }
    this.saveSettings({ favoriteStationIds: ids, favoriteStations: meta });
    return this.getFavoriteStationIds();
  }

  /** Ergänzt fehlende Stammdaten von Favoriten, sobald sie in einer Abfrage auftauchen. */
  rememberFavoriteMeta(stations) {
    const ids = this.getFavoriteStationIds();
    if (ids.length === 0 || !Array.isArray(stations)) return;
    const meta = { ...this.getFavoriteMeta() };
    let changed = false;
    for (const st of stations) {
      if (ids.includes(st.id) && !meta[st.id]) {
        const m = DataService.metaOf(st);
        if (m) {
          meta[st.id] = m;
          changed = true;
        }
      }
    }
    if (changed) this.saveSettings({ favoriteStations: meta });
  }

  pauseAlerts30Minutes() {
    return this.saveSettings({ pausedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
  }

  resumeAlerts() {
    return this.saveSettings({ pausedUntil: null });
  }

  isAlertsPaused() {
    if (!this.userSettings.pausedUntil) return false;
    return Date.now() < new Date(this.userSettings.pausedUntil).getTime();
  }

  // ---------------------------------------------------------------------
  // Offline-Cache der Umkreissuche (IndexedDB, LRU)
  // ---------------------------------------------------------------------

  purgeLegacyListCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_KEYS.LEGACY_LIST_CACHE_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  cacheKey(lat, lng, rad) {
    return `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}_${Math.round(rad)}`;
  }

  async loadListCache() {
    if (this.listCache) return this.listCache;
    if (!this.listCacheLoading) {
      this.listCacheLoading = idbGet(IDB_LIST_CACHE_KEY)
        .then((stored) => {
          const map = new Map();
          if (Array.isArray(stored)) stored.forEach((e) => { if (e && e.key && Array.isArray(e.stations)) map.set(e.key, e); });
          this.listCache = map;
          return map;
        })
        .catch(() => {
          this.listCache = new Map();
          return this.listCache;
        });
    }
    return this.listCacheLoading;
  }

  async readListCache(key) {
    const map = await this.loadListCache();
    const entry = map.get(key);
    if (!entry || Date.now() - entry.at > LIST_CACHE_MAX_AGE_MS) return null;
    return entry;
  }

  async writeListCache(key, stations) {
    const map = await this.loadListCache();
    map.delete(key);
    map.set(key, { key, at: Date.now(), stations: stations.map(compactRawStation) });
    while (map.size > LIST_CACHE_MAX_ENTRIES) map.delete(map.keys().next().value);
    idbSet(IDB_LIST_CACHE_KEY, Array.from(map.values())).catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Tankerkönig: Stationen & Preise
  // ---------------------------------------------------------------------

  /**
   * Rohe Tankerkönig-Stationen um einen Punkt (bei Netzfehlern Rückfall auf den Offline-Cache).
   * @returns {{stations:Array, fromCache:boolean, cachedAt:number|null, error:Object|null}}
   */
  async fetchStationsAround(lat, lng, radiusKm, { timeoutMs = 8000, cache = true } = {}) {
    const rad = Math.min(Math.max(Number(radiusKm) || 5, 1), 25);
    const key = this.cacheKey(lat, lng, rad);
    let error = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `/api/tankerkoenig?lat=${Number(lat).toFixed(5)}&lng=${Number(lng).toFixed(5)}&rad=${rad}&type=all&apikey=${this.keyParam()}`;
      const res = await fetch(url, { signal: controller.signal });
      let data = null;
      try { data = await res.json(); } catch {}
      if (data && data.ok && Array.isArray(data.stations)) {
        if (cache) this.writeListCache(key, data.stations).catch(() => {});
        return { stations: data.stations, fromCache: false, cachedAt: null, error: null };
      }
      const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      const isKeyProblem = !!data?.needsApiKey || res.status === 401 || /api-?key/i.test(msg);
      error = { kind: isKeyProblem ? 'key' : 'api', message: String(msg).replace(/^ERROR:\s*/i, ''), at: Date.now() };
      console.warn('Tankerkönig:', msg);
    } catch (err) {
      error = { kind: 'network', message: err?.name === 'AbortError' ? 'Zeitüberschreitung beim Abruf' : (err?.message || 'Netzwerkfehler'), at: Date.now() };
      console.warn('Tankerkönig-Abruf fehlgeschlagen:', error.message);
    } finally {
      clearTimeout(timeoutId);
    }
    // Bei falschem Key keine alten Daten vortäuschen; bei Netzproblemen den Cache als Notlösung zeigen
    if (cache && error?.kind !== 'key') {
      const cached = await this.readListCache(key).catch(() => null);
      if (cached) return { stations: cached.stations, fromCache: true, cachedAt: cached.at, error };
    }
    return { stations: [], fromCache: false, cachedAt: null, error };
  }

  /**
   * Normalisiert eine Tankerkönig-Station für eine Kraftstoffsorte.
   * Gibt null zurück, wenn die Station die Sorte nicht anbietet oder kein Preis bekannt ist.
   */
  normalizeStation(s, fuelType, fallbackCity = 'Deutschland') {
    if (!s || !s.id) return null;
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const rawPrice = s[fuelType];
    // 1,009 € ist ein bekannter Platzhalterwert der MTS-K, kein echter Preis
    const hasExactLivePrice = typeof rawPrice === 'number' && rawPrice > 0.5 && Math.abs(rawPrice - 1.009) > 0.005;
    const isOpen = s.isOpen !== false;

    let livePrice = null;
    let priceSource = null;
    let lastPriceAt = null;
    if (hasExactLivePrice) {
      livePrice = rawPrice;
      priceSource = 'live';
    } else {
      // Geöffnet ohne Preis = Sorte wird nicht angeboten. Geschlossen: letzten echten Messwert nutzen.
      if (isOpen) return null;
      const last = priceHistoryService.getLastReading(s.id, fuelType);
      if (!last || Date.now() - last.t > LAST_KNOWN_MAX_AGE_MS) return null;
      livePrice = last.p;
      priceSource = 'last_known';
      lastPriceAt = last.t;
    }

    return {
      id: s.id,
      name: s.name || 'Tankstelle',
      brand: (s.brand && String(s.brand).trim()) || (s.name ? String(s.name).split(' ')[0] : 'Frei'),
      street: `${s.street || ''} ${s.houseNumber || ''}`.trim() || 'Straße unbekannt',
      city: s.place || fallbackCity,
      postCode: s.postCode ? String(s.postCode) : '',
      lat,
      lng,
      distanceKm: typeof s.dist === 'number' ? Math.round(s.dist * 10) / 10 : null,
      isOpen,
      livePrice,
      isExactLivePrice: hasExactLivePrice,
      priceSource,
      lastPriceAt,
    };
  }

  /** Ergänzt Anzeigefelder. Frische Live-Preise werden in der Preishistorie aufgezeichnet. */
  finalizeStations(list, fuelType, { fromCache = false, cachedAt = null, record = !fromCache } = {}) {
    if (record) priceHistoryService.recordReadings(list, fuelType);
    const favoriteIds = this.getFavoriteStationIds();
    return list.map((st) => ({
      ...st,
      currentPrice: st.livePrice,
      fuelType,
      isFavorite: favoriteIds.includes(st.id),
      isFromCache: !!(st.isFromCache || fromCache),
      cachedAt: st.cachedAt || cachedAt || null,
    }));
  }

  setFetchInfo(info) {
    this.lastFetchInfo = { fromCache: false, cachedAt: null, partial: false, truncated: false, coveredKm: null, totalKm: null, ...info };
  }

  /** Alle echten Tankstellen im Umkreis eines Standorts. */
  async getStationsWithPrices(fuelType = this.userSettings.fuelPreference, activeLocation = null) {
    if (!this.hasValidTankerkoenigKey() || !activeLocation) {
      this.setFetchInfo({});
      return [];
    }
    const loc = activeLocation;
    const { stations, fromCache, cachedAt, error } = await this.fetchStationsAround(loc.lat, loc.lng, loc.radiusKm || 5);
    this.lastApiError = error;
    this.setFetchInfo({ fromCache, cachedAt });
    this.rememberFavoriteMeta(stations.map((s) => ({ ...s, city: s.place })));
    const normalized = stations.map((s) => this.normalizeStation(s, fuelType, loc.name)).filter(Boolean);
    return this.finalizeStations(normalized, fuelType, { fromCache, cachedAt });
  }

  /**
   * Alle echten Tankstellen um einen beliebigen Punkt (Karte erkunden) – unabhängig vom aktiven Bereich,
   * ohne Offline-Cache (sonst füllt jedes Verschieben der Karte den Speicher).
   * @returns {{stations:Array, fromCache:boolean, error:Object|null}}
   */
  async getStationsAroundPoint(fuelType = this.userSettings.fuelPreference, lat, lng, radiusKm = 10) {
    if (!this.hasValidTankerkoenigKey()) return { stations: [], fromCache: false, error: null };
    const { stations, error } = await this.fetchStationsAround(lat, lng, radiusKm, { cache: false });
    const normalized = stations.map((s) => this.normalizeStation(s, fuelType)).filter(Boolean);
    return { stations: this.finalizeStations(normalized, fuelType, { fromCache: false }), fromCache: false, error };
  }

  /**
   * Alle echten Tankstellen entlang einer Route: Abfragekreise lückenlos entlang der Strecke,
   * höchstens 4 gleichzeitig, frische Ergebnisse vor zwischengespeicherten.
   */
  async getStationsForRoute(fuelType = this.userSettings.fuelPreference, route = null) {
    if (!this.hasValidTankerkoenigKey() || !route) {
      this.setFetchInfo({});
      return [];
    }
    const plan = planRouteQueries(route);
    if (plan.centers.length === 0) {
      this.setFetchInfo({});
      return [];
    }

    const results = await runLimited(plan.centers, ROUTE_CONCURRENCY, async (c, i) => {
      if (i >= ROUTE_CONCURRENCY) await pause(ROUTE_REQUEST_GAP_MS);
      return this.fetchStationsAround(c.lat, c.lng, c.radiusKm, { timeoutMs: 9000 });
    });

    const fresh = new Map();
    const cached = new Map();
    let anyFreshSuccess = false;
    let failed = 0;
    let firstError = null;
    let oldestCache = null;
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        failed += 1;
        continue;
      }
      const { stations, fromCache, cachedAt, error } = r.value;
      if (error) {
        failed += 1;
        if (!firstError) firstError = error;
      } else {
        anyFreshSuccess = true;
      }
      for (const s of stations) {
        if (!s || !s.id) continue;
        if (fromCache) {
          if (!cached.has(s.id)) cached.set(s.id, { raw: s, cachedAt });
          if (cachedAt && (!oldestCache || cachedAt < oldestCache)) oldestCache = cachedAt;
        } else if (!fresh.has(s.id)) {
          fresh.set(s.id, s);
        }
      }
    }

    const freshList = Array.from(fresh.values()).map((s) => this.normalizeStation(s, fuelType)).filter(Boolean);
    priceHistoryService.recordReadings(freshList, fuelType);
    const cachedList = [];
    for (const [id, { raw, cachedAt }] of cached) {
      if (fresh.has(id)) continue;
      const norm = this.normalizeStation(raw, fuelType);
      if (norm) cachedList.push({ ...norm, isFromCache: true, cachedAt });
    }
    this.rememberFavoriteMeta(Array.from(fresh.values()).map((s) => ({ ...s, city: s.place })));

    this.lastApiError = anyFreshSuccess ? null : firstError;
    this.setFetchInfo({
      fromCache: cachedList.length > 0,
      cachedAt: oldestCache,
      partial: failed > 0 && anyFreshSuccess,
      truncated: plan.truncated,
      coveredKm: plan.coveredKm,
      totalKm: plan.totalKm,
    });
    return this.finalizeStations([...freshList, ...cachedList], fuelType, { record: false });
  }

  /**
   * Favoriten unabhängig vom aktuellen Bereich: Preise per prices.php (je 10 IDs),
   * fehlende Stammdaten einmalig per detail.php ergänzt.
   * @param {{lat:number,lng:number}|null} reference  Bezugspunkt für die Entfernung
   */
  async getFavoriteStations(fuelType = this.userSettings.fuelPreference, reference = null) {
    const ids = this.getFavoriteStationIds();
    if (!this.hasValidTankerkoenigKey() || ids.length === 0) {
      this.setFetchInfo({});
      return [];
    }
    const meta = { ...this.getFavoriteMeta() };

    // Stammdaten nachladen, wo sie fehlen (ältere Favoriten)
    const missing = ids.filter((id) => !meta[id]);
    if (missing.length > 0) {
      const details = await runLimited(missing.slice(0, 20), 3, (id) => this.getStationDetails(id));
      let changed = false;
      details.forEach((d, i) => {
        const st = d.status === 'fulfilled' ? d.value : null;
        const m = st ? DataService.metaOf({ ...st, street: `${st.street || ''} ${st.houseNumber || ''}`.trim(), city: st.place, lat: Number(st.lat), lng: Number(st.lng) }) : null;
        if (m) {
          meta[missing[i]] = m;
          changed = true;
        }
      });
      if (changed) this.saveSettings({ favoriteStations: meta });
    }

    const known = ids.filter((id) => meta[id]);
    const chunks = [];
    for (let i = 0; i < known.length; i += 10) chunks.push(known.slice(i, i + 10));
    let error = null;
    const priceMap = {};
    const results = await runLimited(chunks, 3, async (chunk) => {
      const res = await fetch(`/api/tankerkoenig?ids=${chunk.join(',')}&apikey=${this.keyParam()}`);
      const data = await res.json().catch(() => null);
      if (!data || !data.ok) throw new Error(String(data?.message || `HTTP ${res.status}`).replace(/^ERROR:\s*/i, ''));
      return data.prices || {};
    });
    for (const r of results) {
      if (r.status === 'fulfilled') Object.assign(priceMap, r.value);
      else if (!error) error = { kind: /api-?key/i.test(r.reason?.message) ? 'key' : 'network', message: r.reason?.message || 'Netzwerkfehler', at: Date.now() };
    }

    const list = [];
    for (const id of known) {
      const m = meta[id];
      const p = priceMap[id];
      if (!p) continue;
      const raw = {
        id,
        name: m.name,
        brand: m.brand,
        street: m.street,
        houseNumber: '',
        place: m.city,
        postCode: m.postCode,
        lat: m.lat,
        lng: m.lng,
        dist: reference ? calculateHaversineDistance(reference.lat, reference.lng, m.lat, m.lng) : null,
        isOpen: p.status === 'open',
        diesel: p.diesel,
        e5: p.e5,
        e10: p.e10,
      };
      const norm = this.normalizeStation(raw, fuelType, m.city);
      if (norm) list.push(norm);
    }
    this.lastApiError = list.length === 0 ? error : null;
    this.setFetchInfo({ partial: !!error && list.length > 0 });
    return this.finalizeStations(list, fuelType, { fromCache: false });
  }

  /** Details (Öffnungszeiten, Adresse) einer Station über detail.php. */
  async getStationDetails(stationId) {
    if (!this.hasValidTankerkoenigKey() || !stationId) return null;
    try {
      const res = await fetch(`/api/tankerkoenig?id=${encodeURIComponent(stationId)}&apikey=${this.keyParam()}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.ok ? (data.station || data) : null;
    } catch (e) {
      console.warn('Stationsdetails konnten nicht geladen werden:', e);
      return null;
    }
  }
}

export const dataService = new DataService();
