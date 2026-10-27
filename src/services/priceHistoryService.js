/**
 * KRAFTSTOFF - Preishistorie (100% echte Messwerte)
 *
 * Speichert jeden echten Zapfsäulenpreis, den die App von Tankerkönig erhält,
 * dauerhaft in IndexedDB. Daraus entstehen über Tage und Wochen die realen
 * Zeitreihen, auf denen Trends, Regionsprofil und das KI-Modell aufbauen.
 *
 * Datenformat pro Tankstelle & Kraftstoff: Array von Messpunkten
 *   { t: Zeitstempel (ms), p: Preis (€/L), o: 1 = geöffnet, 0 = geschlossen }
 *
 * Aufzeichnungsregel (Tankpreise sind Treppenfunktionen):
 *   - neuer Punkt bei jeder Preisänderung
 *   - zusätzlich ein "Heartbeat" spätestens alle 60 Minuten, damit bekannt ist,
 *     wie lange ein Preis tatsächlich gehalten wurde
 */

import { idbGetAllWithPrefix, idbSetMany, idbDelete } from './indexedDbStorage';

const IDB_PREFIX = 'ph:';
const LEGACY_LS_PREFIX = 'kraftstoff_real_readings_';
const RETENTION_MS = 28 * 24 * 60 * 60 * 1000; // 4 Wochen
const MAX_POINTS_PER_SERIES = 3000;
const HEARTBEAT_MS = 60 * 60 * 1000;
const FLUSH_DELAY_MS = 1500;

export const FUEL_TYPES = ['diesel', 'e5', 'e10'];

function seriesKey(stationId, fuelType) {
  return `${stationId}|${fuelType}`;
}

function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r) continue;
    let t;
    let p;
    let o = 1;
    if (Array.isArray(r)) {
      [t, p, o = 1] = r;
    } else {
      t = typeof r.t === 'number' ? r.t : new Date(r.timestamp).getTime();
      p = typeof r.p === 'number' ? r.p : r.price;
      o = r.o !== undefined ? r.o : (r.isOpen === false ? 0 : 1);
    }
    if (!Number.isFinite(t) || !Number.isFinite(p) || p < 0.5 || p > 4) continue;
    out.push({ t: Math.round(t), p: Math.round(p * 1000) / 1000, o: o ? 1 : 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function trimSeries(pts, now = Date.now()) {
  const minT = now - RETENTION_MS;
  let start = 0;
  while (start < pts.length && pts[start].t < minT) start++;
  let trimmed = start > 0 ? pts.slice(start) : pts;
  if (trimmed.length > MAX_POINTS_PER_SERIES) {
    trimmed = trimmed.slice(trimmed.length - MAX_POINTS_PER_SERIES);
  }
  return trimmed;
}

/**
 * Preis zu einem Zeitpunkt (Treppenfunktion): letzter bekannter Messwert vor t.
 * Gibt null zurück, wenn der letzte Messwert älter als maxHoldMs ist (Datenlücke).
 */
export function priceAt(pts, t, maxHoldMs = 3 * 60 * 60 * 1000) {
  if (!pts || pts.length === 0) return null;
  // Binäre Suche nach letztem Punkt mit pts[i].t <= t
  let lo = 0;
  let hi = pts.length - 1;
  if (pts[0].t > t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  const pt = pts[lo];
  if (t - pt.t > maxHoldMs) return null;
  return pt.p;
}

/** Median eines Zahlenarrays. */
export function median(values) {
  if (!values || values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

class PriceHistoryService {
  constructor() {
    /** @type {Map<string, Array<{t:number,p:number,o:number}>>} */
    this.series = new Map();
    this.dirtyKeys = new Set();
    this.flushTimer = null;
    this.isReady = false;
    this.initPromise = null;
    this.version = 0; // erhöht sich bei jeder Änderung (für React-Memos)
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.version += 1;
    this.listeners.forEach((fn) => {
      try { fn(this.version); } catch {}
    });
  }

  /** Lädt alle Serien aus IndexedDB und migriert alte localStorage-Messungen einmalig. */
  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const entries = await idbGetAllWithPrefix(IDB_PREFIX);
        for (const { key, value } of entries) {
          const k = String(key).slice(IDB_PREFIX.length);
          const pts = trimSeries(sanitizePoints(value));
          if (pts.length > 0) this.series.set(k, pts);
          else idbDelete(key).catch(() => {}); // vollständig abgelaufene Serie entfernen
        }
      } catch (e) {
        console.warn('Preishistorie konnte nicht geladen werden:', e);
      }
      this.migrateLegacyLocalStorage();
      this.isReady = true;
      this.notify();
    })();
    return this.initPromise;
  }

  migrateLegacyLocalStorage() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LEGACY_LS_PREFIX)) keys.push(k);
      }
      if (keys.length === 0) return;
      for (const k of keys) {
        const rest = k.slice(LEGACY_LS_PREFIX.length);
        const idx = rest.lastIndexOf('_');
        if (idx <= 0) continue;
        const stationId = rest.slice(0, idx);
        const fuelType = rest.slice(idx + 1);
        if (!FUEL_TYPES.includes(fuelType)) continue;
        let list = [];
        try { list = JSON.parse(localStorage.getItem(k) || '[]'); } catch {}
        this.mergeSeries(seriesKey(stationId, fuelType), sanitizePoints(list));
        localStorage.removeItem(k);
      }
      this.scheduleFlush();
    } catch {}
  }

  /**
   * Vereinigt Messpunkte in eine Serie (beide chronologisch sortiert, dedupliziert nach
   * gleichem Preis innerhalb ±60 s). Linear statt quadratisch – wichtig beim Import großer Dateien.
   */
  mergeSeries(key, incoming) {
    if (!incoming || incoming.length === 0) return;
    const existing = this.series.get(key) || [];
    const merged = [];
    let i = 0;
    let j = 0;
    const push = (pt) => {
      // Duplikat: gleicher Preis/Status kurz zuvor schon vorhanden (Rückblick über wenige Punkte genügt)
      for (let k = merged.length - 1; k >= 0 && pt.t - merged[k].t < 60 * 1000; k--) {
        if (merged[k].p === pt.p && merged[k].o === pt.o) return;
      }
      merged.push(pt);
    };
    while (i < existing.length || j < incoming.length) {
      if (j >= incoming.length || (i < existing.length && existing[i].t <= incoming[j].t)) push(existing[i++]);
      else push(incoming[j++]);
    }
    this.series.set(key, trimSeries(merged));
    this.dirtyKeys.add(key);
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  async flush() {
    if (this.dirtyKeys.size === 0) return;
    const entries = [];
    for (const key of this.dirtyKeys) {
      const pts = this.series.get(key);
      if (pts && pts.length > 0) {
        entries.push([IDB_PREFIX + key, pts.map((pt) => [pt.t, pt.p, pt.o])]);
      } else {
        idbDelete(IDB_PREFIX + key).catch(() => {});
      }
    }
    this.dirtyKeys.clear();
    await idbSetMany(entries);
  }

  /**
   * Zeichnet die aktuellen Live-Preise einer Stationsliste auf.
   * Erwartet Objekte mit { id, livePrice, isExactLivePrice, isOpen }.
   */
  recordReadings(stations, fuelType, now = Date.now()) {
    if (!Array.isArray(stations) || !FUEL_TYPES.includes(fuelType)) return 0;
    let added = 0;
    for (const st of stations) {
      if (!st || !st.id || !st.isExactLivePrice) continue;
      const price = st.livePrice;
      if (!Number.isFinite(price) || price < 0.5) continue;
      const key = seriesKey(st.id, fuelType);
      const pts = this.series.get(key) || [];
      const last = pts[pts.length - 1];
      const open = st.isOpen === false ? 0 : 1;
      const changed = !last || last.p !== price || last.o !== open;
      const stale = last && now - last.t >= HEARTBEAT_MS;
      if (changed || stale) {
        // Neues Array (copy-on-write), damit React-Memos die Änderung bemerken
        this.series.set(key, trimSeries([...pts, { t: now, p: price, o: open }], now));
        this.dirtyKeys.add(key);
        added += 1;
      }
    }
    if (added > 0) {
      this.scheduleFlush();
      this.notify();
    }
    return added;
  }

  /** Alle Messpunkte einer Station für einen Kraftstoff (chronologisch). */
  getReadings(stationId, fuelType) {
    return this.series.get(seriesKey(stationId, fuelType)) || [];
  }

  /** Letzter bekannter Messwert einer Station (oder null). */
  getLastReading(stationId, fuelType) {
    const pts = this.getReadings(stationId, fuelType);
    return pts.length > 0 ? pts[pts.length - 1] : null;
  }

  /** Map stationId -> Messpunkte für alle Stationen eines Kraftstoffs. */
  getFuelMap(fuelType) {
    const map = new Map();
    for (const [key, pts] of this.series) {
      const idx = key.lastIndexOf('|');
      if (key.slice(idx + 1) === fuelType && pts.length > 0) {
        map.set(key.slice(0, idx), pts);
      }
    }
    return map;
  }

  /** Kennzahlen zur gesammelten Datenbasis. */
  getStats(fuelType = null, stationIds = null) {
    let points = 0;
    let series = 0;
    let first = Infinity;
    let last = 0;
    const idSet = stationIds ? new Set(stationIds) : null;
    for (const [key, pts] of this.series) {
      const idx = key.lastIndexOf('|');
      if (fuelType && key.slice(idx + 1) !== fuelType) continue;
      if (idSet && !idSet.has(key.slice(0, idx))) continue;
      if (pts.length === 0) continue;
      series += 1;
      points += pts.length;
      if (pts[0].t < first) first = pts[0].t;
      if (pts[pts.length - 1].t > last) last = pts[pts.length - 1].t;
    }
    const daysCovered = points > 0 ? Math.max(0, (last - first) / (24 * 60 * 60 * 1000)) : 0;
    return {
      points,
      series,
      firstAt: points > 0 ? first : null,
      lastAt: points > 0 ? last : null,
      daysCovered: Math.round(daysCovered * 10) / 10,
    };
  }

  /** Kompakter Export für die iCloud-Datenbankdatei (nur letzte maxAgeDays Tage). */
  exportCompact(maxAgeDays = 14) {
    const minT = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const out = {};
    for (const [key, pts] of this.series) {
      const recent = pts.filter((pt) => pt.t >= minT).map((pt) => [pt.t, pt.p, pt.o]);
      if (recent.length > 0) out[key] = recent;
    }
    return { version: 1, exportedAt: Date.now(), series: out };
  }

  /** Importiert & vereinigt eine kompakte Historie (z.B. vom anderen Gerät). */
  importCompact(data) {
    if (!data || typeof data !== 'object' || !data.series) return 0;
    let merged = 0;
    for (const [key, raw] of Object.entries(data.series)) {
      const idx = key.lastIndexOf('|');
      if (idx <= 0 || !FUEL_TYPES.includes(key.slice(idx + 1))) continue;
      const pts = sanitizePoints(raw);
      if (pts.length === 0) continue;
      const before = (this.series.get(key) || []).length;
      this.mergeSeries(key, pts);
      merged += (this.series.get(key) || []).length - before;
    }
    if (merged > 0) {
      this.scheduleFlush();
      this.notify();
    }
    return merged;
  }

  /** Löscht die komplette Historie (z.B. auf Nutzerwunsch). */
  async clearAll() {
    const keys = Array.from(this.series.keys());
    this.series.clear();
    this.dirtyKeys.clear();
    await Promise.all(keys.map((k) => idbDelete(IDB_PREFIX + k)));
    this.notify();
  }
}

export const priceHistoryService = new PriceHistoryService();
