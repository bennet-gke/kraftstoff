/**
 * KRAFTSTOFF - Datenbank-Ordner mit Zeitstempel-Dateien
 *
 * Alle Daten der App liegen als JSON-Dateien in EINEM Ordner in iCloud Drive. Jedes Speichern legt
 * eine neue Datei "kraftstoff_daten_<Datum>_<Uhrzeit>.json" ab (nichts wird in-place bearbeitet),
 * beim Öffnen wird die neueste Datei gelesen. Gibt es noch keine Datei, entsteht sie beim ersten
 * Speichern. Mac und iPhone teilen sich über iCloud denselben Ordner.
 *
 * Zusammenführen ohne Datenverlust ("neuere Änderung gewinnt" je Eintrag):
 *  - Jedes Fahrzeug, jeder Ort, jede Route, jedes Gesetz, jede Einstellung, jeder Favorit und der API-Key tragen einen
 *    Änderungszeitpunkt; Gelöschtes hinterlässt eine Löschmarke. Diese Metadaten stehen in jeder Datei.
 *  - Beim Laden wird pro Eintrag die neuere Fassung übernommen – egal in welcher Reihenfolge Geräte
 *    speichern oder laden, und auch beim Laden einer älteren Datei geht nichts Neueres verloren.
 *  - Unberührte Standardwerte eines neuen Geräts haben den Zeitpunkt 0 und überschreiben nie echte Daten.
 *  - Vor jedem Schreiben (Mac-Server, Browser-Ordner) wird geprüft, ob ein anderes Gerät inzwischen eine
 *    neuere Datei abgelegt hat; sie wird zuerst eingearbeitet.
 *  - Gerätebezogenes bleibt lokal: aktives Fahrzeug/Ort/Route, geplante Fahrt, GPS-Standort, Sorte, Alarm-Pause.
 *
 * Drei Zugriffsarten, je nach Gerät:
 *  - 'server'    Mac mit lokalem Vite-Server: Ordnerpfad, direktes Lesen/Schreiben, automatisches Speichern.
 *  - 'fs-access' Chrome/Edge: Ordner einmal im Browser freigeben (File System Access API).
 *  - 'manual'    Safari auf iPhone/Mac: Speichern per Teilen-Dialog ("In Dateien sichern") bzw. Download,
 *                Laden über die Dateien-App (neueste Datei).
 */

import { vehicleService, INITIAL_VEHICLES, LEGACY_DEFAULT_VEHICLES } from './vehicleService';
import { locationService, INITIAL_LOCATIONS } from './locationService';
import { routeService } from './routeService';
import { lawService } from './lawService';
import { DEFAULT_LAWS } from '../engine/priceRules';
import { dataService, DEFAULT_SETTINGS } from './dataService';
import { priceHistoryService } from './priceHistoryService';
import { idbGet, idbSet, idbDelete } from './indexedDbStorage';
import { getModelSnapshot, loadModelSnapshot, getMLStatus } from '../engine/mlModel';

export const DEFAULT_DB_DIR = '~/Library/Mobile Documents/com~apple~CloudDocs/KRAFTSTOFF';
export const SNAPSHOT_PREFIX = 'kraftstoff_daten_';

const LS_DIR_KEY = 'kraftstoff_db_dir';
const LS_MODE_KEY = 'kraftstoff_db_mode';
const LS_EXPORT_METHOD_KEY = 'kraftstoff_db_export_method';
const LEDGER_KEY = 'kraftstoff_sync_ledger';
const DEVICE_ID_KEY = 'kraftstoff_device_id';
export const SAFE_MODE_KEY = 'kraftstoff_safe_mode';
const IDB_DIR_KEY = 'kraftstoff_db_dir';
const IDB_MODE_KEY = 'kraftstoff_db_mode';
const IDB_HANDLE_KEY = 'kraftstoff_db_dir_handle';
const IDB_WORKING_COPY_KEY = 'kraftstoff_full_database';
const IDB_UNSAVED_KEY = 'kraftstoff_db_unsaved_since';
const IDB_LAST_FILE_KEY = 'kraftstoff_db_last_file';
const IDB_OWN_NAMES_KEY = 'kraftstoff_db_own_files';
const EXPORT_VERSION = 3;
const STATE_SYNC_DEBOUNCE_MS = 2500;
const HISTORY_SYNC_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;
const VISIBLE_CHECK_THROTTLE_MS = 30 * 1000;
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const KEEP_NEWEST = 20;
const KEEP_DAILY_DAYS = 14;
const GPS_LOCATION_ID = 'loc-current-gps';
const LISTS = ['vehicles', 'locations', 'routes', 'laws'];
// Gerätebezogene Einstellungen bleiben lokal (Sorte, Alarm-Pause); Favoriten werden separat abgeglichen
const LOCAL_SETTING_KEYS = ['pausedUntil', 'fuelPreference', 'favoriteStationIds', 'favoriteStations'];
const SNAPSHOT_RE = /^kraftstoff_daten(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})?( ?\(?\d{1,3}\)?)?\.json$/i;
const TIMESTAMPED_RE = /^kraftstoff_daten_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/i;

// ---------------------------------------------------------------------------- Hilfsfunktionen

export function makeSnapshotName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${SNAPSHOT_PREFIX}${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}.json`;
}

export function isSnapshotName(name) {
  return SNAPSHOT_RE.test(String(name || ''));
}

/** Zeitpunkt einer Datei: "exportedAt" aus dem Inhalt, sonst aus dem Namen, sonst Änderungsdatum. */
function snapshotTime(name, exportedAt, lastModified) {
  const e = exportedAt ? Date.parse(exportedAt) : NaN;
  if (Number.isFinite(e)) return e;
  const m = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(String(name || ''));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number(lastModified) || 0;
}

/** Einheitliche Rückmeldung zu einem Speichervorgang. */
export function describeSaveResult(res) {
  if (!res) return 'Speichern fehlgeschlagen.';
  if (!res.success) return res.message || 'Speichern fehlgeschlagen.';
  switch (res.method) {
    case 'server':
    case 'fs-access':
      return `✓ Neue Datei gespeichert: ${res.name}${res.mergedForeign ? ' (Änderungen vom anderen Gerät eingearbeitet)' : ''}`;
    case 'share':
      return `✓ ${res.name} bereitgestellt – bitte „In Dateien sichern“ → Ordner KRAFTSTOFF wählen.`;
    case 'download':
      return `✓ ${res.name} heruntergeladen – im Download-Ordner bzw. direkt in deinem iCloud-Ordner.`;
    case 'unchanged':
      return '✓ Keine Änderungen seit dem letzten Stand.';
    default:
      return `✓ ${res.message || 'Lokal gesichert.'}`;
  }
}

/** "3 Fahrzeuge, 1 Ort, 0 Routen" */
export function describeCounts(res) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return `${n(res?.vehicleCount || 0, 'Fahrzeug', 'Fahrzeuge')}, ${n(res?.locationCount || 0, 'Ort', 'Orte')}, ${n(res?.routeCount || 0, 'Route', 'Routen')}`;
}

export const supportsFsAccess = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
export const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const MODE_LABELS = {
  server: 'Ordner über den Mac',
  'fs-access': 'Ordner im Browser freigegeben',
  manual: 'Dateien-App / Download',
};

export function describeMode(mode) {
  return MODE_LABELS[mode] || 'Nicht verbunden';
}

/** "27.10., 12:53" */
export function fmtWhen(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'Gerät';
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}

function readLs(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLs(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function hashOf(v) {
  const s = stableStringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}:${s.length}`;
}

const DEFAULT_HASHES = {
  vehicles: new Map([...LEGACY_DEFAULT_VEHICLES, ...INITIAL_VEHICLES].map((v) => [v.id, hashOf(v)])),
  locations: new Map(INITIAL_LOCATIONS.map((l) => [l.id, hashOf(l)])),
  routes: new Map(),
  laws: new Map(DEFAULT_LAWS.map((l) => [l.id, hashOf(l)])),
};

function syncedSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) if (!LOCAL_SETTING_KEYS.includes(k)) out[k] = v;
  return out;
}

/** Lesbar, aber kompakt: große Teile (Historie, KI-Modell, Routen-Linien) ohne Einrückung. */
export function serializeSnapshot(data) {
  const heavy = new Set(['priceHistory', 'mlModel', 'routes', 'sync']);
  const lines = Object.entries(data || {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${heavy.has(k) ? JSON.stringify(v) : JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

function parseSnapshotText(text, name = '') {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`„${name}“ ist kein gültiges JSON: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || data.appName !== 'KRAFTSTOFF') {
    throw new Error(`„${name}“ ist keine KRAFTSTOFF-Datenbank.`);
  }
  return data;
}

// ---------------------------------------------------------------------------- Zusammenführen (LWW)

/** Normalisiert eine Datei (auch ältere Versionen ohne Zeitstempel je Eintrag) in die Vergleichsform. */
export function normalizeFileData(data) {
  const d = data && typeof data === 'object' ? data : {};
  const fallbackAt = Date.parse(d.exportedAt) || 1;
  const sync = d.sync && typeof d.sync === 'object' ? d.sync : null;
  const listOf = (name) => (Array.isArray(d[name]) ? d[name] : [])
    .filter((x) => x && x.id && !(name === 'locations' && x.id === GPS_LOCATION_ID) && !(name === 'routes' && x.isTrip));
  const settings = syncedSettings(d.userSettings);
  const favorites = Array.isArray(d.favoriteStationIds) ? d.favoriteStationIds : Array.isArray(d.userSettings?.favoriteStationIds) ? d.userSettings.favoriteStationIds : [];
  const favoriteMeta = d.userSettings?.favoriteStations && typeof d.userSettings.favoriteStations === 'object' ? d.userSettings.favoriteStations : {};
  const creds = d.credentials && typeof d.credentials === 'object' ? d.credentials : {};
  const apiKey = String(d.apiKey || creds.tankerkoenigKey || creds.tankerkoenigApiKey || '').trim();
  const out = {
    vehicles: listOf('vehicles'),
    locations: listOf('locations'),
    routes: listOf('routes'),
    laws: listOf('laws'),
    settings,
    favorites,
    favoriteMeta,
    apiKey,
    sync: { items: {}, tomb: {}, settings: {}, favorites: {}, apiKeyAt: 0 },
  };
  for (const name of LISTS) {
    out.sync.items[name] = {};
    out.sync.tomb[name] = { ...(sync?.tomb?.[name] || {}) };
    for (const item of out[name]) out.sync.items[name][item.id] = Number(sync?.items?.[name]?.[item.id] ?? fallbackAt) || 0;
  }
  out.sync.tomb.favorites = { ...(sync?.tomb?.favorites || {}) };
  for (const k of Object.keys(settings)) out.sync.settings[k] = Number(sync?.settings?.[k] ?? fallbackAt) || 0;
  for (const id of favorites) out.sync.favorites[id] = Number(sync?.favorites?.[id] ?? fallbackAt) || 0;
  out.sync.apiKeyAt = apiKey ? Number(sync?.apiKeyAt ?? fallbackAt) || 0 : 0;
  return out;
}

/**
 * Führt Datei- und lokalen Stand zusammen: je Eintrag gewinnt der neuere Änderungszeitpunkt,
 * eine neuere Löschmarke entfernt den Eintrag. Bei Gleichstand bleibt der vorhandene Eintrag erhalten.
 * @returns {{merged: Object, changedVsLocal: boolean, changedVsFile: boolean}}
 */
export function mergeSnapshots(file, local, now = Date.now()) {
  const merged = {
    sync: { items: {}, tomb: {}, settings: {}, favorites: {}, apiKeyAt: 0 },
  };
  for (const name of LISTS) {
    const fileList = Array.isArray(file[name]) ? file[name] : [];
    const localList = Array.isArray(local[name]) ? local[name] : [];
    const F = new Map(fileList.map((x) => [x.id, x]));
    const L = new Map(localList.map((x) => [x.id, x]));
    const fAt = file.sync.items[name] || {};
    const lAt = local.sync.items[name] || {};
    const fTomb = file.sync.tomb[name] || {};
    const lTomb = local.sync.tomb[name] || {};
    const order = [...localList.map((x) => x.id), ...fileList.map((x) => x.id).filter((id) => !L.has(id))];
    const ids = new Set([...order, ...Object.keys(fTomb), ...Object.keys(lTomb)]);
    const list = [];
    merged.sync.items[name] = {};
    merged.sync.tomb[name] = {};
    for (const id of ids) {
      const tomb = Math.max(Number(fTomb[id]) || 0, Number(lTomb[id]) || 0);
      const lItemAt = L.has(id) ? Number(lAt[id]) || 0 : -1;
      const fItemAt = F.has(id) ? Number(fAt[id]) || 0 : -1;
      let pick = null;
      let pickAt = -1;
      if (lItemAt >= 0 && lItemAt >= fItemAt) { pick = L.get(id); pickAt = lItemAt; }
      else if (fItemAt >= 0) { pick = F.get(id); pickAt = fItemAt; }
      // Unberührte Standardeinträge eines neu eingerichteten Geräts (Zeitstempel 0) nicht in eine
      // bestehende Datenbank übernehmen – sonst tauchen Beispielauto/Startort plötzlich überall auf
      if (pick && lItemAt === 0 && fItemAt < 0 && F.size > 0) pick = null;
      if (pick && (tomb === 0 || pickAt >= tomb)) {
        merged.sync.items[name][id] = pickAt;
      } else if (tomb > 0 && now - tomb < TOMBSTONE_TTL_MS) {
        merged.sync.tomb[name][id] = tomb;
        pick = null;
      } else {
        pick = null;
      }
      if (pick) list.push(pick);
    }
    // Reihenfolge: lokale Reihenfolge, neue Einträge der Datei hinten an
    const pos = new Map(order.map((id, i) => [id, i]));
    merged[name] = list.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }

  // Einstellungen je Schlüssel
  merged.settings = {};
  for (const k of new Set([...Object.keys(file.settings), ...Object.keys(local.settings)])) {
    const inF = k in file.settings;
    const inL = k in local.settings;
    const fa = inF ? Number(file.sync.settings[k]) || 0 : -1;
    const la = inL ? Number(local.sync.settings[k]) || 0 : -1;
    if (la >= fa) { merged.settings[k] = local.settings[k]; merged.sync.settings[k] = Math.max(0, la); }
    else { merged.settings[k] = file.settings[k]; merged.sync.settings[k] = fa; }
  }

  // Favoriten je Station (an/aus mit Zeitpunkt)
  const fFav = new Map(file.favorites.map((id) => [id, Number(file.sync.favorites[id]) || 0]));
  const lFav = new Map(local.favorites.map((id) => [id, Number(local.sync.favorites[id]) || 0]));
  const fFavTomb = file.sync.tomb.favorites || {};
  const lFavTomb = local.sync.tomb.favorites || {};
  merged.favorites = [];
  merged.sync.tomb.favorites = {};
  const favOrder = [...local.favorites, ...file.favorites.filter((id) => !lFav.has(id))];
  for (const id of new Set([...favOrder, ...Object.keys(fFavTomb), ...Object.keys(lFavTomb)])) {
    const onAt = Math.max(fFav.has(id) ? fFav.get(id) : -1, lFav.has(id) ? lFav.get(id) : -1);
    const offAt = Math.max(Number(fFavTomb[id]) || 0, Number(lFavTomb[id]) || 0);
    if (onAt >= 0 && onAt >= offAt) {
      merged.favorites.push(id);
      merged.sync.favorites[id] = onAt;
    } else if (offAt > 0 && now - offAt < TOMBSTONE_TTL_MS) {
      merged.sync.tomb.favorites[id] = offAt;
    }
  }
  merged.favoriteMeta = {};
  for (const id of merged.favorites) {
    const m = local.favoriteMeta[id] || file.favoriteMeta[id];
    if (m) merged.favoriteMeta[id] = m;
  }

  // API-Key: neuerer gewinnt, ein vorhandener Key wird nie durch "leer" ersetzt
  if (local.sync.apiKeyAt >= file.sync.apiKeyAt) {
    merged.apiKey = local.apiKey || file.apiKey;
    merged.sync.apiKeyAt = local.apiKey ? local.sync.apiKeyAt : file.sync.apiKeyAt;
  } else {
    merged.apiKey = file.apiKey || local.apiKey;
    merged.sync.apiKeyAt = file.apiKey ? file.sync.apiKeyAt : local.sync.apiKeyAt;
  }

  const stateHash = (x) => hashOf([...LISTS.map((name) => x[name] || []), x.settings, [...x.favorites].sort(), x.apiKey]);
  const mh = stateHash(merged);
  return { merged, changedVsLocal: mh !== stateHash(local), changedVsFile: mh !== stateHash(file) };
}

// ---------------------------------------------------------------------------- Service

class BackupService {
  constructor() {
    this.dir = null;
    this.mode = null; // 'server' | 'fs-access' | 'manual' | null
    this.isConnected = false;
    this.booted = false;
    this.serverAvailable = false;
    this.dirHandle = null;
    this.permission = null; // fs-access: 'granted' | 'prompt' | 'denied'
    this.fileCount = null;
    this.currentName = null; // Datei, die dem aktuellen Datenstand zugrunde liegt (geladen oder gespeichert)
    this.currentAt = null;
    this.currentSource = null; // 'load' | 'save' | null
    this.lastLoadedName = null;
    this.unsavedSince = null;
    this.lastSaveAt = 0;
    this.lastSaveName = null;
    this.lastSaveResult = null;
    this.savedRev = 0;
    this.savedExtra = null;
    this.ownNames = [];
    this.isArmed = false;
    this.isSaving = false;
    this.stateTimer = null;
    this.historyTimer = null;
    this.lastVisibleCheck = 0;
    this.listeners = new Set();
    this.dataListeners = new Set();
    this.exportMethod = isIOS ? 'share' : 'download'; // manueller Modus: 'share' (Teilen-Dialog) | 'download'
    this.ledger = null;
    this.deviceId = null;
    try {
      this.dir = localStorage.getItem(LS_DIR_KEY) || null;
      this.mode = localStorage.getItem(LS_MODE_KEY) || null;
      const em = localStorage.getItem(LS_EXPORT_METHOD_KEY);
      if (em === 'share' || em === 'download') this.exportMethod = em;
      this.deviceId = localStorage.getItem(DEVICE_ID_KEY);
      if (!this.deviceId) {
        this.deviceId = `dev-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_ID_KEY, this.deviceId);
      }
    } catch {}
  }

  setExportMethod(method) {
    this.exportMethod = method === 'share' ? 'share' : 'download';
    try { localStorage.setItem(LS_EXPORT_METHOD_KEY, this.exportMethod); } catch {}
    this.notify();
  }

  // ------------------------------------------------------------------ Konfiguration & Status
  async restoreConfigFromIdb() {
    try {
      if (!this.dir) {
        const d = await idbGet(IDB_DIR_KEY);
        if (d && typeof d === 'string') this.dir = d;
      }
      if (!this.mode) {
        const m = await idbGet(IDB_MODE_KEY);
        if (m && typeof m === 'string') this.mode = m;
      }
      if (this.mode === 'fs-access') {
        const h = await idbGet(IDB_HANDLE_KEY);
        if (h) this.dirHandle = h;
      }
      this.unsavedSince = (await idbGet(IDB_UNSAVED_KEY)) || null;
      const last = await idbGet(IDB_LAST_FILE_KEY);
      if (last && typeof last === 'object') {
        this.currentName = last.name || null;
        this.currentAt = last.at || null;
        this.currentSource = last.source || null;
        this.savedRev = Number(last.savedRev) || 0;
        this.savedExtra = last.savedExtra || null;
        if (last.source === 'load') this.lastLoadedName = last.name || null;
        if (last.source === 'save' && last.at) {
          this.lastSaveAt = new Date(last.at).getTime() || 0;
          this.lastSaveName = last.name || null;
        }
      }
      const own = await idbGet(IDB_OWN_NAMES_KEY);
      if (Array.isArray(own)) this.ownNames = own.slice(-40);
      this.persistConfig();
    } catch {}
    return { dir: this.dir, mode: this.mode };
  }

  persistConfig() {
    try {
      if (this.dir) localStorage.setItem(LS_DIR_KEY, this.dir); else localStorage.removeItem(LS_DIR_KEY);
      if (this.mode) localStorage.setItem(LS_MODE_KEY, this.mode); else localStorage.removeItem(LS_MODE_KEY);
    } catch {}
    (this.dir ? idbSet(IDB_DIR_KEY, this.dir) : idbDelete(IDB_DIR_KEY)).catch(() => {});
    (this.mode ? idbSet(IDB_MODE_KEY, this.mode) : idbDelete(IDB_MODE_KEY)).catch(() => {});
  }

  setConfig({ dir, mode }) {
    if (dir !== undefined) this.dir = dir ? String(dir).trim() : null;
    if (mode !== undefined) this.mode = mode || null;
    this.persistConfig();
  }

  getStatus() {
    return {
      dir: this.dir,
      mode: this.mode,
      isConnected: this.isConnected,
      booted: this.booted,
      serverAvailable: this.serverAvailable,
      permission: this.permission,
      fileCount: this.fileCount,
      currentName: this.currentName,
      currentAt: this.currentAt,
      currentSource: this.currentSource,
      lastLoadedName: this.lastLoadedName,
      unsavedSince: this.unsavedSince,
      lastSaveAt: this.lastSaveAt,
      lastSaveName: this.lastSaveName,
      lastSaveResult: this.lastSaveResult,
      isSaving: this.isSaving,
      exportMethod: this.exportMethod,
      modeLabel: describeMode(this.mode),
      supportsFsAccess,
      isIOS,
    };
  }

  /** Vorhandene Dateien im Ordner (neueste zuerst, max. 10); im manuellen Modus leer. */
  async listFiles() {
    try {
      if (this.mode === 'server') {
        const c = await this.checkServer();
        if (Number.isFinite(c.fileCount)) this.fileCount = c.fileCount;
        return Array.isArray(c.files) ? c.files : [];
      }
      if (this.mode === 'fs-access' && this.dirHandle && (await this.fsQueryPermission(false)) === 'granted') {
        const list = await this.fsListSnapshots();
        this.fileCount = list.length;
        return list.slice(0, 10).map(({ name, lastModified, size, at }) => ({ name, mtime: lastModified, size, exportedAt: new Date(at).toISOString() }));
      }
    } catch {}
    return [];
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => {
      try { fn(status); } catch {}
    });
  }

  /** Meldet übernommene Daten (z.B. neuere Datei eines anderen Geräts), damit die App ihren Zustand auffrischt. */
  subscribeData(fn) {
    this.dataListeners.add(fn);
    return () => this.dataListeners.delete(fn);
  }

  emitData(info) {
    this.dataListeners.forEach((fn) => {
      try { fn(info); } catch {}
    });
  }

  async markUnsaved() {
    if (!this.unsavedSince) {
      this.unsavedSince = new Date().toISOString();
      await idbSet(IDB_UNSAVED_KEY, this.unsavedSince).catch(() => {});
    }
  }

  async clearUnsaved() {
    this.unsavedSince = null;
    await idbDelete(IDB_UNSAVED_KEY).catch(() => {});
  }

  async persistLastFile() {
    await idbSet(IDB_LAST_FILE_KEY, {
      name: this.currentName || null,
      at: this.currentAt || null,
      source: this.currentName ? this.currentSource : null,
      savedRev: this.savedRev,
      savedExtra: this.savedExtra,
    }).catch(() => {});
  }

  async rememberFile(name, at, source = null) {
    this.currentName = name || null;
    this.currentAt = at || null;
    this.currentSource = name ? source : null;
    if (source === 'load') this.lastLoadedName = name || null;
    await this.persistLastFile();
  }

  async rememberOwnName(name) {
    if (!name) return;
    this.ownNames = [...this.ownNames.filter((n) => n !== name), name].slice(-40);
    await idbSet(IDB_OWN_NAMES_KEY, this.ownNames).catch(() => {});
  }

  // ------------------------------------------------------------------ Änderungsprotokoll (Zeitstempel je Eintrag)
  currentLocalState() {
    return {
      vehicles: vehicleService.vehicles.filter((x) => x && x.id),
      locations: locationService.locations.filter((l) => l && l.id && l.id !== GPS_LOCATION_ID),
      routes: routeService.routes.filter((r) => r && r.id && !r.isTrip),
      laws: lawService.laws.filter((l) => l && l.id),
      settings: syncedSettings(dataService.userSettings),
      favorites: dataService.getFavoriteStationIds(),
      favoriteMeta: dataService.getFavoriteMeta(),
      apiKey: dataService.getStoredKey(),
    };
  }

  isDefaultValue(kind, key, value) {
    if (kind === 'settings') return stableStringify(value) === stableStringify(DEFAULT_SETTINGS[key]);
    return DEFAULT_HASHES[kind]?.get(key) === hashOf(value);
  }

  loadLedger() {
    const l = readLs(LEDGER_KEY);
    if (l && l.v === 1 && l.items) {
      // Später hinzugekommene Listen (z.B. Gesetze) aufnehmen: unberührte Vorlagen = 0, sonst Stand der letzten Änderung
      const missing = LISTS.filter((name) => !l.items[name]);
      if (missing.length > 0) {
        const st = this.currentLocalState();
        for (const name of missing) {
          l.items[name] = {};
          for (const item of st[name]) l.items[name][item.id] = { h: hashOf(item), at: this.isDefaultValue(name, item.id, item) ? 0 : l.lastChangeAt || 1 };
        }
      }
      l.tomb = l.tomb || { favorites: {} };
      for (const name of LISTS) if (!l.tomb[name]) l.tomb[name] = {};
      this.ledger = l;
      if (missing.length > 0) this.saveLedger();
      return true;
    }
    return false;
  }

  saveLedger() {
    writeLs(LEDGER_KEY, this.ledger);
  }

  /** Neues Protokoll aus dem vorhandenen Stand: Standardwerte = 0, sonst initialAt. */
  createLedger(initialAt) {
    const st = this.currentLocalState();
    const ledger = { v: 1, rev: 1, lastChangeAt: 0, items: {}, tomb: { favorites: {} }, settings: {}, favorites: {}, apiKey: { h: hashOf(st.apiKey), at: st.apiKey ? initialAt : 0 } };
    for (const name of LISTS) {
      ledger.items[name] = {};
      ledger.tomb[name] = {};
      for (const item of st[name]) {
        ledger.items[name][item.id] = { h: hashOf(item), at: this.isDefaultValue(name, item.id, item) ? 0 : initialAt };
      }
    }
    for (const [k, v] of Object.entries(st.settings)) ledger.settings[k] = { h: hashOf(v), at: this.isDefaultValue('settings', k, v) ? 0 : initialAt };
    for (const id of st.favorites) ledger.favorites[id] = initialAt;
    this.ledger = ledger;
    this.saveLedger();
  }

  ensureLedger() {
    if (this.ledger || this.loadLedger()) return;
    // Bestehende Daten gelten als so alt wie der letzte bekannte Abgleich (sonst als sehr alt)
    const initialAt = Date.parse(this.unsavedSince) || Date.parse(this.currentAt) || 1;
    this.createLedger(initialAt);
  }

  /** Vergleicht den aktuellen Stand mit dem Protokoll und stempelt Änderungen. @returns {boolean} geändert */
  refreshLedger(now = Date.now()) {
    if (!this.ledger) return false;
    const st = this.currentLocalState();
    const L = this.ledger;
    let changed = false;
    for (const name of LISTS) {
      const seen = new Set();
      for (const item of st[name]) {
        seen.add(item.id);
        const h = hashOf(item);
        const prev = L.items[name][item.id];
        if (!prev || prev.h !== h) {
          L.items[name][item.id] = { h, at: now };
          delete L.tomb[name][item.id];
          changed = true;
        }
      }
      for (const id of Object.keys(L.items[name])) {
        if (!seen.has(id)) {
          delete L.items[name][id];
          L.tomb[name][id] = now;
          changed = true;
        }
      }
    }
    for (const [k, v] of Object.entries(st.settings)) {
      const h = hashOf(v);
      if (!L.settings[k] || L.settings[k].h !== h) {
        L.settings[k] = { h, at: now };
        changed = true;
      }
    }
    const favSet = new Set(st.favorites);
    for (const id of st.favorites) {
      if (!(id in L.favorites)) {
        L.favorites[id] = now;
        delete L.tomb.favorites[id];
        changed = true;
      }
    }
    for (const id of Object.keys(L.favorites)) {
      if (!favSet.has(id)) {
        delete L.favorites[id];
        L.tomb.favorites[id] = now;
        changed = true;
      }
    }
    const kh = hashOf(st.apiKey);
    if (L.apiKey.h !== kh) {
      L.apiKey = { h: kh, at: st.apiKey ? now : L.apiKey.at };
      changed = true;
    }
    if (changed) {
      L.rev += 1;
      L.lastChangeAt = now;
      this.saveLedger();
    }
    return changed;
  }

  /** Lokaler Stand in Vergleichsform inkl. Zeitstempeln. */
  localNormalized() {
    const st = this.currentLocalState();
    const L = this.ledger;
    const sync = { items: {}, tomb: {}, settings: {}, favorites: {}, apiKeyAt: L.apiKey.at || 0 };
    for (const name of LISTS) {
      sync.items[name] = Object.fromEntries(Object.entries(L.items[name]).map(([id, e]) => [id, e.at]));
      sync.tomb[name] = { ...L.tomb[name] };
    }
    sync.tomb.favorites = { ...L.tomb.favorites };
    sync.settings = Object.fromEntries(Object.entries(L.settings).map(([k, e]) => [k, e.at]));
    sync.favorites = { ...L.favorites };
    return { ...st, sync };
  }

  /** Protokoll nach dem Übernehmen eines zusammengeführten Stands neu aufbauen. */
  adoptLedger(merged) {
    const L = { v: 1, rev: (this.ledger?.rev || 0) + 1, lastChangeAt: this.ledger?.lastChangeAt || 0, items: {}, tomb: { favorites: { ...merged.sync.tomb.favorites } }, settings: {}, favorites: { ...merged.sync.favorites }, apiKey: { h: hashOf(merged.apiKey), at: merged.sync.apiKeyAt } };
    for (const name of LISTS) {
      L.items[name] = {};
      L.tomb[name] = { ...merged.sync.tomb[name] };
      for (const item of merged[name]) L.items[name][item.id] = { h: hashOf(item), at: merged.sync.items[name][item.id] ?? 0 };
    }
    for (const [k, v] of Object.entries(merged.settings)) L.settings[k] = { h: hashOf(v), at: merged.sync.settings[k] ?? 0 };
    this.ledger = L;
    this.saveLedger();
  }

  // ------------------------------------------------------------------ Datei erzeugen / übernehmen
  historyExtraKey() {
    const stats = priceHistoryService.getStats();
    return `h${stats.points}|m${getMLStatus().samplesLearned || 0}`;
  }

  async buildFilePayload() {
    this.ensureLedger();
    this.refreshLedger();
    const local = this.localNormalized();
    let mlModel = null;
    try { mlModel = await getModelSnapshot(); } catch { mlModel = null; }
    const activeLocationId = locationService.activeLocationId !== GPS_LOCATION_ID ? locationService.activeLocationId : undefined;
    return {
      appName: 'KRAFTSTOFF',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      savedBy: deviceLabel(),
      deviceId: this.deviceId,
      basedOn: this.currentName || null,
      apiKey: local.apiKey,
      credentials: { tankerkoenigKey: local.apiKey, tankerkoenigApiKey: local.apiKey },
      vehicles: local.vehicles,
      activeVehicleId: vehicleService.activeVehicleId,
      locations: local.locations,
      activeLocationId,
      routes: local.routes,
      laws: local.laws,
      userSettings: { ...local.settings, favoriteStationIds: local.favorites, favoriteStations: local.favoriteMeta },
      favoriteStationIds: local.favorites,
      sync: local.sync,
      priceHistory: priceHistoryService.exportCompact(14),
      mlModel: mlModel || undefined,
    };
  }

  /** Lokale Arbeitskopie (falls der Browser-Speicher geleert wird). */
  persistWorkingCopy() {
    try {
      const local = this.localNormalized();
      idbSet(IDB_WORKING_COPY_KEY, {
        appName: 'KRAFTSTOFF',
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        apiKey: local.apiKey,
        vehicles: local.vehicles,
        activeVehicleId: vehicleService.activeVehicleId,
        locations: local.locations,
        activeLocationId: locationService.activeLocationId,
        routes: local.routes,
        laws: local.laws,
        userSettings: { ...local.settings, favoriteStationIds: local.favorites, favoriteStations: local.favoriteMeta },
        favoriteStationIds: local.favorites,
        sync: local.sync,
      }).catch(() => {});
    } catch {}
  }

  /** Zusammengeführten Stand in die Dienste schreiben (gerätebezogene Auswahl bleibt erhalten). */
  applyMergedState(merged, hints = {}) {
    const gps = locationService.locations.find((l) => l.id === GPS_LOCATION_ID);
    const trips = routeService.routes.filter((r) => r.isTrip);
    const prevVehicle = vehicleService.activeVehicleId;
    const prevLocation = locationService.activeLocationId;
    const prevRoute = routeService.activeRouteId;

    if (merged.vehicles.length > 0) {
      vehicleService.saveVehicles(merged.vehicles);
      const keep = merged.vehicles.some((v) => v.id === prevVehicle) ? prevVehicle
        : merged.vehicles.some((v) => v.id === hints.activeVehicleId) ? hints.activeVehicleId : merged.vehicles[0].id;
      vehicleService.setActiveVehicleId(keep);
    }
    const locs = [...(gps ? [gps] : []), ...merged.locations];
    if (locs.length > 0) {
      locationService.saveLocations(locs);
      const keep = locs.some((l) => l.id === prevLocation) ? prevLocation
        : locs.some((l) => l.id === hints.activeLocationId) ? hints.activeLocationId : locs[0].id;
      // setActiveLocationId nur bei Änderung (setzt sonst unnötig "eigener Ort gewählt")
      if (keep !== locationService.activeLocationId || !locationService.locations.some((l) => l.id === locationService.activeLocationId)) {
        locationService.setActiveLocationId(keep);
      }
    }
    routeService.saveRoutes([...merged.routes, ...trips]);
    if (prevRoute && routeService.routes.some((r) => r.id === prevRoute)) routeService.setActiveRouteId(prevRoute);
    else routeService.setActiveRouteId(null);
    lawService.saveLaws(merged.laws);

    dataService.saveSettings({ ...merged.settings, favoriteStationIds: merged.favorites, favoriteStations: merged.favoriteMeta });
    if (merged.apiKey && merged.apiKey !== dataService.getStoredKey()) dataService.saveCredentials({ tankerkoenigKey: merged.apiKey });
    this.adoptLedger(merged);
  }

  /**
   * Datei übernehmen: mit dem lokalen Stand zusammenführen ("neuere Änderung gewinnt"), anwenden,
   * Historie und KI-Modell einarbeiten.
   */
  async applyFile(fileData, { name = null, at = null, background = false } = {}) {
    this.ensureLedger();
    this.refreshLedger();
    const file = normalizeFileData(fileData);
    const local = this.localNormalized();
    const { merged, changedVsLocal, changedVsFile } = mergeSnapshots(file, local);
    if (changedVsLocal) this.applyMergedState(merged, { activeVehicleId: fileData.activeVehicleId, activeLocationId: fileData.activeLocationId });

    let mergedReadings = 0;
    if (fileData.priceHistory) mergedReadings = priceHistoryService.importCompact(fileData.priceHistory);
    let modelAdopted = false;
    if (fileData.mlModel) {
      try { modelAdopted = await loadModelSnapshot(fileData.mlModel); } catch { modelAdopted = false; }
    }

    await this.rememberFile(name, at || fileData.exportedAt || null, 'load');
    if (changedVsFile) {
      // Lokal gab es Neueres: als ungesichert markieren, damit es in eine neue Datei geschrieben wird
      await this.markUnsaved();
    } else {
      this.savedRev = this.ledger.rev;
      this.savedExtra = this.historyExtraKey();
      await this.persistLastFile();
      await this.clearUnsaved();
    }
    this.persistWorkingCopy();
    const info = {
      success: true,
      loaded: true,
      background,
      fileName: name,
      changed: changedVsLocal,
      merged: changedVsFile && changedVsLocal,
      keptLocalChanges: changedVsFile,
      hasKey: dataService.hasValidTankerkoenigKey(),
      exportedAt: fileData.exportedAt,
      savedBy: fileData.savedBy || null,
      vehicleCount: vehicleService.vehicles.length,
      locationCount: locationService.locations.filter((l) => l.id !== GPS_LOCATION_ID).length,
      routeCount: routeService.routes.filter((r) => !r.isTrip).length,
      mergedReadings,
      modelAdopted,
    };
    this.emitData(info);
    return info;
  }

  /** Arbeitskopie aus IndexedDB nur einspielen, wenn der Browser-Speicher geleert wurde. */
  async restoreWorkingCopyIfNeeded() {
    let hasLocal = false;
    try { hasLocal = !!(localStorage.getItem('kraftstoff_user_vehicles') || localStorage.getItem('kraftstoff_user_locations')); } catch {}
    if (hasLocal) return false;
    const copy = await idbGet(IDB_WORKING_COPY_KEY).catch(() => null);
    if (!copy || typeof copy !== 'object') return false;
    this.ensureLedger();
    const file = normalizeFileData(copy);
    const { merged } = mergeSnapshots(file, this.localNormalized());
    this.applyMergedState(merged, { activeVehicleId: copy.activeVehicleId, activeLocationId: copy.activeLocationId });
    return true;
  }

  // ------------------------------------------------------------------ Server (Mac)
  async checkServer(dir = this.dir) {
    try {
      const res = await fetch(`/api/icloud-sync/check?dir=${encodeURIComponent(dir || '')}`);
      if (!res.ok) return { isAvailable: false };
      const data = await res.json();
      if (!data || data.isAvailable !== true) return { isAvailable: false };
      return { isAvailable: true, ...data };
    } catch (e) {
      return { isAvailable: false, error: e.message };
    }
  }

  async serverReadNewest(dir = this.dir) {
    const res = await fetch(`/api/icloud-sync?dir=${encodeURIComponent(dir || '')}`);
    const json = await res.json().catch(() => null);
    if (!json || json.success === false) throw new Error(json?.error || `Ordner konnte nicht gelesen werden (HTTP ${res.status}).`);
    return json;
  }

  async serverWrite(payload, dir = this.dir) {
    const res = await fetch('/api/icloud-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload, dir }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  /** Ordner auf dem Mac verbinden: neueste Datei laden oder (noch leer) nur verbinden. */
  async connectServer(dir) {
    const clean = String(dir || '').trim() || DEFAULT_DB_DIR;
    const check = await this.checkServer(clean);
    this.serverAvailable = !!check.isAvailable;
    if (!check.isAvailable) return { success: false, reason: 'no-server', message: 'Kein Mac-Server erreichbar. Öffne die App über den Mac oder wähle eine andere Zugriffsart.' };
    if (check.pathOk === false) return { success: false, reason: 'invalid-path', message: check.error || 'Ungültiger Ordner.' };
    try {
      const json = await this.serverReadNewest(clean);
      this.setConfig({ dir: clean, mode: 'server' });
      this.isConnected = true;
      this.fileCount = json.fileCount ?? 0;
      if (json.exists && json.data) {
        const applied = await this.applyFile(json.data, { name: json.name, at: json.exportedAt || json.lastModified });
        this.notify();
        return { ...applied, mode: 'server', dir: json.dir || clean, legacy: !!json.legacy, fileCount: json.fileCount || 1, skipped: json.skipped || [] };
      }
      this.ensureLedger();
      await this.rememberFile(null, null);
      this.notify();
      return { success: true, mode: 'server', dir: json.dir || clean, loaded: false, fileCount: 0, hasKey: dataService.hasValidTankerkoenigKey(), message: 'Ordner verbunden – noch keine Datei vorhanden. Sie wird beim ersten Speichern angelegt.' };
    } catch (e) {
      return { success: false, reason: 'read-failed', message: e.message };
    }
  }

  // ------------------------------------------------------------------ File System Access (Chrome/Edge)
  async fsQueryPermission(request = false) {
    if (!this.dirHandle) return 'prompt';
    try {
      let perm = await this.dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && request) perm = await this.dirHandle.requestPermission({ mode: 'readwrite' });
      this.permission = perm;
      return perm;
    } catch {
      this.permission = 'denied';
      return 'denied';
    }
  }

  async fsListSnapshots() {
    const out = [];
    if (!this.dirHandle) return out;
    for await (const [name, handle] of this.dirHandle.entries()) {
      if (handle.kind !== 'file' || !isSnapshotName(name)) continue;
      try {
        const file = await handle.getFile();
        let exportedAt = null;
        try {
          const head = await file.slice(0, 400).text();
          exportedAt = /"exportedAt"\s*:\s*"([^"]+)"/.exec(head)?.[1] || null;
        } catch {}
        out.push({ name, handle, lastModified: file.lastModified, size: file.size, at: snapshotTime(name, exportedAt, file.lastModified) });
      } catch {}
    }
    out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
    return out;
  }

  /** Neueste lesbare Datei (leere oder beschädigte werden übersprungen). */
  async fsReadNewest() {
    const list = await this.fsListSnapshots();
    this.fileCount = list.length;
    for (const entry of list) {
      try {
        const file = await entry.handle.getFile();
        const data = parseSnapshotText(await file.text(), entry.name);
        return { exists: true, name: entry.name, at: entry.at, fileCount: list.length, data };
      } catch (e) {
        console.warn('Datei übersprungen:', entry.name, e?.message || e);
      }
    }
    return { exists: false, fileCount: list.length };
  }

  async fsWrite(payload) {
    const content = serializeSnapshot(payload);
    let when = new Date();
    let name = makeSnapshotName(when);
    for (let attempt = 0; attempt < 10; attempt++) {
      let exists = false;
      try {
        await this.dirHandle.getFileHandle(name);
        exists = true;
      } catch {}
      if (!exists) break;
      when = new Date(when.getTime() + 1000);
      name = makeSnapshotName(when);
    }
    const fh = await this.dirHandle.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
    await this.fsPrune();
    return { name, lastModified: Date.now() };
  }

  /** Aufräumen wie auf dem Mac: neueste 20 plus je Tag der letzte Stand der vergangenen 14 Tage. */
  async fsPrune() {
    try {
      const files = (await this.fsListSnapshots()).filter((f) => TIMESTAMPED_RE.test(f.name));
      const keep = new Set(files.slice(0, KEEP_NEWEST).map((f) => f.name));
      const days = new Set();
      const minAt = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
      for (const f of files) {
        if (f.at < minAt) continue;
        const day = new Date(f.at).toDateString();
        if (!days.has(day)) {
          days.add(day);
          keep.add(f.name);
        }
      }
      for (const f of files) {
        if (!keep.has(f.name)) {
          try { await this.dirHandle.removeEntry(f.name); } catch {}
        }
      }
    } catch {}
  }

  /** Ordner im Browser auswählen (Chrome/Edge) und neueste Datei laden. */
  async connectFsAccess() {
    if (!supportsFsAccess) return { success: false, reason: 'unsupported', message: 'Dieser Browser kann keine Ordner freigeben. Nutze Chrome/Edge, den Mac-Server oder die Dateien-App.' };
    try {
      const handle = await window.showDirectoryPicker({ id: 'kraftstoff-db', mode: 'readwrite', startIn: 'documents' });
      this.dirHandle = handle;
      await idbSet(IDB_HANDLE_KEY, handle).catch(() => {});
      this.permission = 'granted';
      this.setConfig({ dir: handle.name, mode: 'fs-access' });
      this.isConnected = true;
      const read = await this.fsReadNewest();
      if (read.exists) {
        const applied = await this.applyFile(read.data, { name: read.name, at: read.at });
        this.notify();
        return { ...applied, mode: 'fs-access', dir: handle.name, fileCount: read.fileCount };
      }
      this.ensureLedger();
      await this.rememberFile(null, null);
      this.notify();
      return { success: true, mode: 'fs-access', dir: handle.name, loaded: false, fileCount: 0, hasKey: dataService.hasValidTankerkoenigKey(), message: `Ordner „${handle.name}“ freigegeben – noch keine Datei vorhanden. Sie wird beim ersten Speichern angelegt.` };
    } catch (e) {
      if (e?.name === 'AbortError') return { success: false, reason: 'cancelled', message: 'Ordnerauswahl abgebrochen.' };
      return { success: false, reason: 'error', message: e.message };
    }
  }

  // ------------------------------------------------------------------ Manuell (Dateien-App / Teilen)
  /**
   * Aus einer oder mehreren ausgewählten Dateien die neueste bestimmen und übernehmen.
   * Ältere Dateien sind unkritisch: Neuere lokale Änderungen bleiben beim Zusammenführen erhalten.
   */
  async connectWithFiles(fileList, { mode = null } = {}) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) throw new Error('Keine Datei ausgewählt.');
    const candidates = [];
    const errors = [];
    for (const file of files) {
      try {
        const data = parseSnapshotText(await file.text(), file.name);
        candidates.push({ file, data, at: snapshotTime(file.name, data.exportedAt, file.lastModified) });
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (candidates.length === 0) throw new Error(errors[0] || 'Keine gültige KRAFTSTOFF-Datei dabei.');
    candidates.sort((a, b) => b.at - a.at);
    const newest = candidates[0];
    if (mode) this.setConfig({ mode, dir: mode === 'manual' ? null : this.dir });
    else if (!this.mode) this.setConfig({ mode: 'manual', dir: null });
    this.isConnected = true;
    const applied = await this.applyFile(newest.data, { name: newest.file.name, at: newest.at });
    this.notify();
    return { ...applied, mode: this.mode, fileCount: candidates.length, skippedFiles: errors.length };
  }

  /** Ohne vorhandene Datei beginnen (die erste Datei entsteht beim ersten Speichern). */
  async connectFresh() {
    this.setConfig({ mode: 'manual', dir: null });
    this.isConnected = true;
    await this.restoreWorkingCopyIfNeeded();
    this.ensureLedger();
    this.notify();
    return { success: true, mode: 'manual', loaded: false, fileCount: 0, hasKey: dataService.hasValidTankerkoenigKey(), message: 'Bereit – die erste Datei entsteht beim ersten Speichern.' };
  }

  /** Datei herausgeben: Teilen-Dialog ("In Dateien sichern") oder Download. */
  async exportSnapshot(payload, name = makeSnapshotName()) {
    const json = serializeSnapshot(payload);
    const file = new File([json], name, { type: 'application/json' });
    let canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { canShare = false; }
    if (this.exportMethod === 'share' && canShare) {
      try {
        await navigator.share({ files: [file], title: 'KRAFTSTOFF Datenbank' });
        return { method: 'share', name };
      } catch (e) {
        if (e?.name === 'AbortError') return { method: 'cancelled', name };
        // NotAllowedError o.ä.: auf Download ausweichen
      }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { method: 'download', name };
  }

  // ------------------------------------------------------------------ Start & Laden
  /** Beim Start: gespeicherte Zugriffsart wiederherstellen und die neueste Datei laden. */
  async autoConnect() {
    await this.restoreConfigFromIdb();
    let safeMode = false;
    try {
      safeMode = localStorage.getItem(SAFE_MODE_KEY) === '1';
      if (safeMode) localStorage.removeItem(SAFE_MODE_KEY);
    } catch {}
    await this.restoreWorkingCopyIfNeeded().catch(() => false);
    this.ensureLedger();
    try {
      if (safeMode) return { success: false, reason: 'safe-mode' };
      if (!this.mode) return { success: false, reason: 'not-configured' };

      if (this.mode === 'server') {
        const res = await this.connectServer(this.dir || DEFAULT_DB_DIR);
        if (res.success) return res;
        // Server gerade nicht erreichbar: lokal weiterarbeiten, später schreiben
        this.isConnected = true;
        return { success: true, mode: 'server', loaded: false, offline: true, message: res.message };
      }

      if (this.mode === 'fs-access') {
        this.isConnected = true;
        const perm = await this.fsQueryPermission(false);
        if (perm === 'granted') {
          try {
            const read = await this.fsReadNewest();
            if (read.exists) {
              const applied = await this.applyFile(read.data, { name: read.name, at: read.at });
              return { ...applied, mode: 'fs-access', fileCount: read.fileCount };
            }
          } catch (e) {
            console.warn('Ordner konnte nicht gelesen werden:', e);
          }
        }
        return { success: true, mode: 'fs-access', loaded: false, needsPermission: perm !== 'granted' };
      }

      // manual
      this.isConnected = true;
      return { success: true, mode: 'manual', loaded: false };
    } finally {
      this.booted = true;
      this.notify();
    }
  }

  /** Neueste Datei erneut laden (Server / freigegebener Ordner). Manuell: Dateiauswahl nötig. */
  async loadNewest() {
    if (this.mode === 'server') return this.connectServer(this.dir || DEFAULT_DB_DIR);
    if (this.mode === 'fs-access') {
      if (!this.dirHandle) return this.connectFsAccess();
      const perm = await this.fsQueryPermission(true);
      if (perm !== 'granted') return { success: false, reason: 'permission', message: 'Zugriff auf den Ordner wurde nicht freigegeben.' };
      try {
        const read = await this.fsReadNewest();
        this.isConnected = true;
        if (!read.exists) {
          this.notify();
          return { success: true, mode: 'fs-access', loaded: false, fileCount: 0, message: 'Im Ordner liegt noch keine Datei.' };
        }
        const applied = await this.applyFile(read.data, { name: read.name, at: read.at });
        this.notify();
        return { ...applied, mode: 'fs-access', fileCount: read.fileCount };
      } catch (e) {
        return { success: false, reason: 'read-failed', message: e.message };
      }
    }
    return { success: false, reason: 'needs-picker', message: 'Bitte die neueste Datei aus der Dateien-App auswählen.' };
  }

  /**
   * Hat ein anderes Gerät inzwischen eine neuere Datei abgelegt? Dann zuerst einarbeiten.
   * @returns {Promise<Object|null>} Ergebnis der Übernahme oder null
   */
  async mergeNewerForeignFile() {
    try {
      let newestName = null;
      let read = null;
      if (this.mode === 'server') {
        const check = await this.checkServer();
        this.serverAvailable = !!check.isAvailable;
        if (!check.isAvailable || check.pathOk === false) return null;
        this.fileCount = check.fileCount ?? this.fileCount;
        newestName = check.newest?.name || null;
        if (!newestName || newestName === this.currentName || this.ownNames.includes(newestName)) return null;
        const json = await this.serverReadNewest();
        if (!json.exists || !json.data || json.name === this.currentName) return null;
        read = { name: json.name, at: json.exportedAt || json.lastModified, data: json.data };
      } else if (this.mode === 'fs-access') {
        if (!this.dirHandle || (await this.fsQueryPermission(false)) !== 'granted') return null;
        const list = await this.fsListSnapshots();
        this.fileCount = list.length;
        newestName = list[0]?.name || null;
        if (!newestName || newestName === this.currentName || this.ownNames.includes(newestName)) return null;
        const r = await this.fsReadNewest();
        if (!r.exists || r.name === this.currentName) return null;
        read = r;
      } else {
        return null;
      }
      return await this.applyFile(read.data, { name: read.name, at: read.at, background: true });
    } catch (e) {
      console.warn('Abgleich mit neuerer Datei fehlgeschlagen:', e);
      return null;
    }
  }

  // ------------------------------------------------------------------ Speichern
  /**
   * Speichert den aktuellen Stand als neue Datei mit Zeitstempel.
   * explicit=true: vom Nutzer ausgelöst (nötig für Teilen-Dialog/Download im manuellen Modus).
   * reason='state': nur bei geänderten Daten; reason='history': auch bei gewachsener Historie/Modell.
   */
  async saveToDatabase({ explicit = false, force = false, reason = 'state' } = {}) {
    if (this.isSaving) return { success: false, method: 'busy', message: 'Speichern läuft bereits.' };
    this.isSaving = true;
    this.notify();
    let res;
    try {
      res = await this.saveInternal({ explicit, force, reason });
    } catch (e) {
      res = { success: false, method: this.mode || 'unknown', message: e?.message || String(e) };
    } finally {
      this.isSaving = false;
    }
    if (res.method !== 'unchanged' && res.method !== 'busy') this.lastSaveResult = { ...res, reason, explicit, at: Date.now() };
    this.notify();
    return res;
  }

  async saveInternal({ explicit, force, reason }) {
    this.ensureLedger();
    if (this.refreshLedger()) await this.markUnsaved();
    this.persistWorkingCopy();

    const stateChanged = this.ledger.rev !== this.savedRev || !!this.unsavedSince;
    const extraChanged = this.historyExtraKey() !== this.savedExtra;
    if (!force && !explicit) {
      const needed = reason === 'history' ? stateChanged || extraChanged : stateChanged;
      if (!needed) return { success: true, method: 'unchanged', message: 'Keine Änderungen seit dem letzten Stand.' };
    }

    const finishSave = async (name, at, method, extra = {}) => {
      this.savedRev = this.ledger.rev;
      this.savedExtra = this.historyExtraKey();
      this.lastSaveAt = Date.now();
      this.lastSaveName = name;
      await this.rememberOwnName(name);
      await this.rememberFile(name, at, 'save');
      await this.clearUnsaved();
      return { success: true, method, name, ...extra };
    };

    if (this.mode === 'server' || this.mode === 'fs-access') {
      if (this.mode === 'fs-access' && (await this.fsQueryPermission(explicit)) !== 'granted') {
        await this.markUnsaved();
        return { success: true, method: 'local-copy', needsPermission: true, message: 'Zugriff auf den Ordner noch nicht freigegeben – Änderungen werden lokal gehalten.' };
      }
      if (this.mode === 'server') {
        const check = await this.checkServer();
        this.serverAvailable = !!check.isAvailable;
        if (!check.isAvailable || check.pathOk === false) {
          await this.markUnsaved();
          return { success: true, method: 'local-copy', message: 'Mac-Server gerade nicht erreichbar – Änderungen bleiben lokal und werden beim nächsten Speichern geschrieben.' };
        }
      }
      // Zuerst eine neuere Datei eines anderen Geräts einarbeiten (verhindert verlorene Änderungen)
      const foreign = await this.mergeNewerForeignFile();
      try {
        const payload = await this.buildFilePayload();
        if (this.mode === 'server') {
          const w = await this.serverWrite(payload);
          this.fileCount = w.kept ?? this.fileCount;
          return await finishSave(w.name, payload.exportedAt, 'server', { path: w.path, dir: w.dir, mergedForeign: !!foreign?.changed });
        }
        const w = await this.fsWrite(payload);
        return await finishSave(w.name, payload.exportedAt, 'fs-access', { dir: this.dir, mergedForeign: !!foreign?.changed });
      } catch (e) {
        await this.markUnsaved();
        return { success: false, method: this.mode, message: `Datei konnte nicht geschrieben werden: ${e.message}` };
      }
    }

    // manual: nur auf ausdrücklichen Wunsch (Teilen-Dialog/Download brauchen eine Nutzeraktion)
    if (!explicit) {
      return { success: true, method: 'local-copy', message: 'Lokal gesichert – mit „Jetzt sichern“ entsteht die Datei in iCloud.' };
    }
    const payload = await this.buildFilePayload();
    const exp = await this.exportSnapshot(payload);
    if (exp.method === 'cancelled') {
      await this.markUnsaved();
      return { success: false, method: 'cancelled', message: 'Speichern abgebrochen.' };
    }
    return finishSave(exp.name, payload.exportedAt, exp.method);
  }

  /** Kompatibilitäts-Aliase */
  directSyncToICloud() {
    return this.saveToDatabase({ explicit: false });
  }

  directSyncFromICloud() {
    return this.loadNewest();
  }

  // ------------------------------------------------------------------ Auto-Speichern
  arm() {
    if (this.isArmed) return;
    this.isArmed = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushPending();
        else this.onVisible();
      });
      window.addEventListener('pagehide', () => this.flushPending());
    }
  }

  /** Beim Verlassen der App ausstehendes Speichern sofort ausführen (Mac-Server / Browser-Ordner). */
  flushPending() {
    this.persistWorkingCopy();
    if (this.stateTimer && (this.mode === 'server' || this.mode === 'fs-access')) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
      this.runAutoSync('state');
    }
  }

  /** Beim Zurückkehren in die App: neuere Datei eines anderen Geräts übernehmen. */
  async onVisible() {
    if (!this.isConnected || (this.mode !== 'server' && this.mode !== 'fs-access')) return;
    if (Date.now() - this.lastVisibleCheck < VISIBLE_CHECK_THROTTLE_MS || this.isSaving) return;
    this.lastVisibleCheck = Date.now();
    const res = await this.mergeNewerForeignFile();
    if (res) {
      this.notify();
      if (res.keptLocalChanges) this.scheduleSync('state');
    }
  }

  /** Nach dem Wechsel in einem anderen Tab: Protokoll neu einlesen. */
  reloadLedger() {
    this.loadLedger();
  }

  /**
   * Von der App bei jeder Datenänderung aufgerufen: Änderung sofort protokollieren und lokal sichern,
   * das Schreiben der Datei erfolgt entprellt (Mac-Server / Browser-Ordner) bzw. auf Knopfdruck (manuell).
   */
  scheduleSync(reason = 'state') {
    if (!this.ledger || !this.isConnected) return;
    if (reason === 'state') {
      if (this.refreshLedger()) {
        this.markUnsaved().then(() => this.notify());
        this.persistWorkingCopy();
      } else if (!this.unsavedSince) {
        return;
      }
    }
    if (!this.isArmed || (this.mode !== 'server' && this.mode !== 'fs-access')) return;
    if (reason === 'history') {
      if (this.historyTimer) return;
      const lastWrite = Math.max(this.lastSaveAt || 0, Date.parse(this.currentAt) || 0);
      const wait = Math.max(STATE_SYNC_DEBOUNCE_MS, HISTORY_SYNC_MIN_INTERVAL_MS - (Date.now() - lastWrite));
      this.historyTimer = setTimeout(() => {
        this.historyTimer = null;
        this.runAutoSync('history');
      }, wait);
      return;
    }
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.runAutoSync('state');
    }, STATE_SYNC_DEBOUNCE_MS);
  }

  async runAutoSync(reason) {
    if (this.isSaving) {
      this.scheduleSync(reason);
      return;
    }
    const res = await this.saveToDatabase({ explicit: false, reason });
    if (res.method === 'busy') this.scheduleSync(reason);
  }
}

export const backupService = new BackupService();
