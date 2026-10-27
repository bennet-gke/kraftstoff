/**
 * KRAFTSTOFF - Import des Tankerkönig-Preisarchivs
 *
 * Tankerkönig veröffentlicht für registrierte Nutzer je Tag eine CSV-Datei mit allen Preisänderungen
 * (prices/JJJJ/MM/JJJJ-MM-TT-prices.csv, Lizenz CC BY-NC-SA 4.0). Spalten:
 *   date, station_uuid, diesel, e5, e10, dieselchange, e5change, e10change
 * Importiert werden nur Tankstellen, die die App bereits kennt (Bereich, Favoriten, eigene Messreihen),
 * und nur die letzten 28 Tage (so lange hält die App ihre Historie).
 *
 * Die Datei enthält nur Änderungen. Damit die App weiß, dass ein Preis dazwischen galt, werden – wie bei
 * der eigenen Aufzeichnung – stündliche "Heartbeat"-Punkte mit demselben echten Preis ergänzt, allerdings
 * nur innerhalb lückenlos importierter Tage. Es werden keine Preise erfunden.
 */

import { priceHistoryService, FUEL_TYPES } from './priceHistoryService';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const IMPORT_RETENTION_MS = 28 * DAY_MS;
const DEFAULT_COLUMNS = ['date', 'station_uuid', 'diesel', 'e5', 'e10'];

/** "2026-10-26 00:00:41+01" → Millisekunden (NaN bei ungültigem Wert). */
export function parseTkDate(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*([+-]\d{2})(?::?(\d{2}))?$/.exec(s);
  if (m) return Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${m[3]}:${m[4] || '00'}`);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function nextDay(t) {
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Sammelt Zeilen einer oder mehrerer Dateien.
 * @param {{stationIds:Set<string>, minT:number}} opts
 */
export function createCollector({ stationIds, minT = 0 }) {
  const raw = new Map(); // "uuid|fuel" -> [{t,p}]
  const coveredDays = new Set();
  let columns = DEFAULT_COLUMNS;
  let idx = null;
  const stats = { rows: 0, matchedRows: 0, tooOld: 0, invalid: 0 };

  const setColumns = (cols) => {
    columns = cols;
    idx = {
      date: cols.indexOf('date'),
      id: cols.indexOf('station_uuid'),
      fuels: FUEL_TYPES.map((f) => [f, cols.indexOf(f)]).filter(([, i]) => i >= 0),
    };
  };
  setColumns(columns);

  return {
    stats,
    coveredDays,
    raw,
    /** Eine Zeile der CSV-Datei verarbeiten. */
    line(rawLine) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line) return;
      if (line.startsWith('date,') || line.startsWith('"date"')) {
        setColumns(line.split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase()));
        return;
      }
      stats.rows += 1;
      const parts = line.split(',');
      const id = (parts[idx.id] || '').replace(/"/g, '').trim().toLowerCase();
      const t = parseTkDate((parts[idx.date] || '').replace(/"/g, ''));
      if (!Number.isFinite(t)) {
        stats.invalid += 1;
        return;
      }
      coveredDays.add(dayKey(t));
      if (!stationIds.has(id)) return;
      if (t < minT) {
        stats.tooOld += 1;
        return;
      }
      stats.matchedRows += 1;
      for (const [fuel, i] of idx.fuels) {
        const p = parseFloat(parts[i]);
        if (!Number.isFinite(p) || p < 0.5 || p > 4) continue;
        const key = `${id}|${fuel}`;
        let list = raw.get(key);
        if (!list) {
          list = [];
          raw.set(key, list);
        }
        list.push({ t, p: Math.round(p * 1000) / 1000 });
      }
    },
    /** Tag explizit als vollständig importiert markieren (z. B. aus dem Dateinamen). */
    coverDay(t) {
      coveredDays.add(dayKey(t));
    },
  };
}

/**
 * Aus den gesammelten Änderungen Messreihen im Format der App bauen: Änderungen plus stündliche
 * Heartbeats (gleicher Preis), aber nur innerhalb lückenlos importierter Tage.
 */
export function buildSeries(raw, coveredDays, { now = Date.now() } = {}) {
  const isCovered = (from, to) => {
    for (let d = startOfDay(from); d <= to; d = nextDay(d)) {
      if (!coveredDays.has(dayKey(d))) return false;
    }
    return true;
  };
  // Ende des lückenlosen Blocks ab Zeitpunkt t
  const blockEnd = (t) => {
    let d = startOfDay(t);
    while (coveredDays.has(dayKey(d))) d = nextDay(d);
    return d;
  };

  const out = new Map();
  for (const [key, list] of raw) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    const changes = [];
    for (const pt of sorted) {
      const last = changes[changes.length - 1];
      if (last && last.p === pt.p) continue; // reine Wiederholung
      if (last && pt.t === last.t) {
        last.p = pt.p;
        continue;
      }
      changes.push({ ...pt });
    }
    const pts = [];
    for (let i = 0; i < changes.length; i++) {
      const cur = changes[i];
      pts.push({ t: cur.t, p: cur.p, o: 1 });
      const until = i + 1 < changes.length ? changes[i + 1].t : Math.min(now, blockEnd(cur.t));
      if (i + 1 < changes.length && !isCovered(cur.t, changes[i + 1].t)) continue;
      for (let h = cur.t + HOUR_MS; h < until; h += HOUR_MS) pts.push({ t: h, p: cur.p, o: 1 });
    }
    if (pts.length > 0) out.set(key, pts);
  }
  return out;
}

/** Zeilenweise lesen (Streaming, damit auch 20–30 MB große Tagesdateien auf dem iPhone gehen). */
async function forEachLine(file, onLine) {
  if (typeof file.stream === 'function' && typeof TextDecoderStream !== 'undefined') {
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = rest + value;
      const lines = chunk.split('\n');
      rest = lines.pop();
      for (const l of lines) onLine(l);
    }
    if (rest) onLine(rest);
    return;
  }
  const text = await file.text();
  for (const l of text.split('\n')) onLine(l);
}

/**
 * Tagesdateien importieren.
 * @param {File[]} files
 * @param {{stationIds: Iterable<string>, onProgress?: Function, now?: number}} opts
 */
export async function importTankerkoenigFiles(files, { stationIds = [], onProgress = null, now = Date.now() } = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) throw new Error('Keine Datei ausgewählt.');
  const bad = list.find((f) => !/\.csv$/i.test(f.name));
  if (bad) throw new Error(`„${bad.name}“ ist keine CSV-Datei. ZIP-Archive bitte vorher entpacken (in der Dateien-App antippen).`);

  const known = new Set([...stationIds].map((s) => String(s).toLowerCase()));
  for (const key of priceHistoryService.series.keys()) known.add(key.slice(0, key.lastIndexOf('|')).toLowerCase());
  if (known.size === 0) throw new Error('Die App kennt noch keine Tankstellen. Öffne zuerst das Radar für deine Region, dann den Import.');

  const collector = createCollector({ stationIds: known, minT: now - IMPORT_RETENTION_MS });
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (onProgress) onProgress({ fileIndex: i, fileCount: list.length, name: file.name });
    const fromName = /(\d{4})-(\d{2})-(\d{2})-prices\.csv$/i.exec(file.name);
    if (fromName) collector.coverDay(new Date(Number(fromName[1]), Number(fromName[2]) - 1, Number(fromName[3]), 12).getTime());
    await forEachLine(file, (l) => collector.line(l));
  }

  const series = buildSeries(collector.raw, collector.coveredDays, { now });
  let points = 0;
  const stations = new Set();
  for (const [key, pts] of series) {
    // Station-IDs in der Schreibweise der App (Tankerkönig liefert Kleinbuchstaben)
    priceHistoryService.mergeSeries(key, pts);
    points += pts.length;
    stations.add(key.slice(0, key.lastIndexOf('|')));
  }
  if (points > 0) {
    priceHistoryService.scheduleFlush();
    priceHistoryService.notify();
  }
  return {
    files: list.length,
    rows: collector.stats.rows,
    matchedRows: collector.stats.matchedRows,
    tooOld: collector.stats.tooOld,
    days: collector.coveredDays.size,
    stations: stations.size,
    points,
  };
}
