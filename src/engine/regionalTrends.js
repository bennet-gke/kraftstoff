/**
 * KRAFTSTOFF - Regionale Trend-Engine
 *
 * Bildet aus den echten Messwerten ALLER Tankstellen eines Bereichs
 * (Umkreis um einen Ort oder Korridor entlang einer Route) einen Spiegel der Region:
 *
 * 1. Regionsprofil 7 Tage × 24 Stunden: typische relative Preislage (ct/L) je Wochentag & Stunde.
 *    - Abtastung zur Stundenmitte (HH:30): eine Preisänderung zur vollen Stunde landet in der richtigen Stunde.
 *    - Werte gelten nur bis 75 Minuten nach dem letzten echten Messwert (keine erfundenen Werte über App-Pausen).
 *    - Normierung je Station auf ihr gleitendes 24-h-Niveau (bereinigt um die erwartete Tageszeit):
 *      Marken­unterschiede und mehrtägige Markttrends verfälschen den Tageszyklus nicht.
 *    - Je Kalendertag zählt eine Beobachtung (Stationen einer Region bewegen sich gemeinsam),
 *      geglättet gegen Erfahrungswerte des deutschen Marktes; Konfidenz nach Beobachtungstagen.
 *    - Wochentagsspezifische Werte erst ab 2 beobachteten Tagen dieses Wochentags.
 * 2. Regionaler Preisindex über die Zeit (Median/Min/Max aller Stationen) mit Lücken.
 * 3. Momentaufnahme der Region (günstigste, teuerste, Spanne, Markenniveau).
 * 4. Beste Tank-Zeitfenster heute & in den nächsten Tagen.
 * 5. Erkennung aktueller Preisbewegungen (Erhöhungs-/Senkungswelle) – nur mit bekanntem Zeitpunkt.
 * Gesetzliche Regeln (z.B. 12-Uhr-Regel) wählen die Erfahrungswerte und markieren unerlaubte Erhöhungen.
 */

import { priceAt, median } from '../services/priceHistoryService';
import { DEFAULT_RULES, activeIncreaseRules, isRestrictedAt, increaseCouldBeAllowed, describeRuleState } from './priceRules';

export const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HALF_HOUR_MS = HOUR_MS / 2;

/**
 * Erfahrungswerte des deutschen Kraftstoffmarktes, relativ zum Tagesmittel in ct/L. Sie gelten nur, bis
 * genug eigene Messwerte der Region vorliegen. Welcher Verlauf gilt, hängt von den aktiven Gesetzen ab.
 *
 * Mit 12-Uhr-Regel (seit 1. April 2026), nach Auswertungen von Bundeskartellamt und ADAC (Mai 2026):
 * am günstigsten kurz vor 12 Uhr, um 12 Uhr ein Sprung um 15–18 ct, danach langsames Abschmelzen,
 * gegen 17:30 Uhr unter dem Tagesmittel, abends leichte Anstiege, nachts stabil, ab 5 Uhr fallend.
 */
export const PRIOR_NOON_CT = [
  0.1, 0.1, 0.1, 0.0, -0.1, -0.5, // 00-05 Uhr
  -1.3, -2.1, -2.7, -3.3, -3.9, -4.7, // 06-11 Uhr
  9.3, 6.8, 4.8, 3.1, 1.5, -0.1, // 12-17 Uhr
  -1.1, -1.6, -1.8, -1.7, -1.1, -0.3, // 18-23 Uhr
];

/**
 * Ohne Erhöhungsbeschränkung (freie Preisbildung wie bis März 2026): mehrere Erhöhungen am Tag,
 * morgens am teuersten, abends zwischen 18 und 22 Uhr am günstigsten.
 */
export const PRIOR_FREE_CT = [
  1.2, 1.4, 1.6, 1.8, 2.2, 3.0, // 00-05 Uhr
  3.6, 3.4, 2.6, 1.9, 1.3, 0.8, // 06-11 Uhr
  0.2, 0.0, 0.1, -0.1, -0.4, -0.9, // 12-17 Uhr
  -1.8, -2.6, -3.0, -2.9, -2.2, -1.4, // 18-23 Uhr
];

/** Standard (geltende Rechtslage), falls kein Regelwerk übergeben wird. */
export const PRIOR_HOURLY_CT = PRIOR_NOON_CT;

/**
 * Erfahrungswerte passend zu den aktiven Gesetzen: ohne Erhöhungsregel der freie Verlauf, mit der
 * 12-Uhr-Regel deren Verlauf; andere Uhrzeiten verschieben den 12-Uhr-Verlauf auf die erlaubten Zeitpunkte.
 */
export function priorForRules(rules, now = Date.now()) {
  const act = activeIncreaseRules(rules, now);
  if (act.length === 0) return PRIOR_FREE_CT;
  const mins = act[0].minutes;
  if (mins.length === 1 && mins[0] === 12 * 60) return PRIOR_NOON_CT;
  const out = new Array(24).fill(0);
  for (const m of mins) {
    const shift = Math.round(m / 60) - 12;
    for (let h = 0; h < 24; h++) out[h] += PRIOR_NOON_CT[(((h - shift) % 24) + 24) % 24] / mins.length;
  }
  return out.map((v) => Math.round(v * 100) / 100);
}

/** Gültigkeit eines Messwerts: Heartbeat (60 min) + Abrufintervall (10 min) + Reserve */
export const MAX_HOLD_MS = 75 * 60 * 1000;
// Glättung in "Beobachtungstagen"
const PRIOR_DAYS = 3;
const HOUR_LEVEL_DAYS = 2;
const MIN_WEEKDAY_DAYS = 2;
const LEVEL_WINDOW_MS = 12 * HOUR_MS; // ±12 h = gleitendes 24-h-Niveau
const MIN_LEVEL_SAMPLES = 2;
const MIN_LEVEL_SPAN_MS = 2 * HOUR_MS;

/** JS-Wochentag (0 = So) -> Index mit Montag = 0 */
export function toMondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

function dateKeyOf(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Stündliche Abtastung einer Messreihe zur Stundenmitte (HH:30), nur wo ein echter Messwert
 * höchstens 75 Minuten zurückliegt.
 */
export function sampleHourly(pts, fromMs, toMs) {
  const out = [];
  if (!pts || pts.length === 0) return out;
  const start = Math.max(fromMs, pts[0].t);
  for (let t = Math.ceil((start - HALF_HOUR_MS) / HOUR_MS) * HOUR_MS + HALF_HOUR_MS; t <= toMs; t += HOUR_MS) {
    const p = priceAt(pts, t, MAX_HOLD_MS);
    if (p === null) continue;
    const d = new Date(t);
    out.push({ t, p, hour: d.getHours(), day: toMondayIndex(d.getDay()), dateKey: dateKeyOf(d) });
  }
  return out;
}

/**
 * Relative Lage (ct) jeder Abtastung zu ihrem gleitenden 24-h-Niveau. Das Niveau ist um die
 * erwartete Tageszeit bereinigt (estFn), damit eine nur abends beobachtete Station nicht als
 * "billig" gilt. Abtastungen ohne genug Umfeld (z.B. ein einzelner Messwert am Tag) entfallen.
 */
export function relativeSamples(samples, estFn) {
  const out = [];
  const n = samples.length;
  if (n === 0) return out;
  const adj = samples.map((s) => s.p - estFn(s.hour, s.day) / 100);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const t = samples[i].t;
    while (lo < n && samples[lo].t < t - LEVEL_WINDOW_MS) lo++;
    while (hi < n && samples[hi].t <= t + LEVEL_WINDOW_MS) hi++;
    const count = hi - lo;
    if (count < MIN_LEVEL_SAMPLES || samples[hi - 1].t - samples[lo].t < MIN_LEVEL_SPAN_MS) continue;
    const level = median(adj.slice(lo, hi));
    out.push({ ...samples[i], level, rel: (samples[i].p - level) * 100 });
  }
  return out;
}

/** Robustes Niveau einer Station zum Zeitpunkt t (bereinigt um die erwartete Tageszeit) oder null. */
export function stationLevelAt(pts, t, estFn = (h) => PRIOR_HOURLY_CT[h], windowMs = 24 * HOUR_MS) {
  const samples = sampleHourly(pts, t - windowMs, t);
  if (samples.length < MIN_LEVEL_SAMPLES || samples[samples.length - 1].t - samples[0].t < MIN_LEVEL_SPAN_MS) return null;
  return median(samples.map((s) => s.p - estFn(s.hour, s.day) / 100));
}

function aggregateDaily(relSamples) {
  // (Kalendertag, Stunde) -> Mittel über alle Stationen dieser Stunde an diesem Tag
  const buckets = new Map();
  for (const s of relSamples) {
    const key = `${s.dateKey}|${s.hour}`;
    let b = buckets.get(key);
    if (!b) {
      b = { dateKey: s.dateKey, hour: s.hour, day: s.day, sum: 0, n: 0 };
      buckets.set(key, b);
    }
    b.sum += s.rel;
    b.n += 1;
  }
  return Array.from(buckets.values()).map((b) => ({ ...b, mean: b.sum / b.n }));
}

function buildFromRelative(relByStation, prior = PRIOR_HOURLY_CT) {
  const all = [];
  for (const list of relByStation) all.push(...list);
  const daily = aggregateDaily(all);

  const hourDays = Array.from({ length: 24 }, () => []);
  const cellDays = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  const cellSamples = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const weekdayDates = Array.from({ length: 7 }, () => new Set());
  for (const b of daily) {
    hourDays[b.hour].push(b.mean);
    cellDays[b.day][b.hour].push(b.mean);
    cellSamples[b.day][b.hour] += b.n;
    weekdayDates[b.day].add(b.dateKey);
  }

  const hourOfDay = hourDays.map((means, h) => {
    const d = means.length;
    const sum = means.reduce((a, v) => a + v, 0);
    const est = (sum + PRIOR_DAYS * prior[h]) / (d + PRIOR_DAYS);
    return { hour: h, n: d, days: d, est: Math.round(est * 100) / 100, conf: Math.round((d / (d + PRIOR_DAYS)) * 100) / 100 };
  });

  const resolvedWeekdays = [];
  const cells = [];
  for (let day = 0; day < 7; day++) {
    const resolved = weekdayDates[day].size >= MIN_WEEKDAY_DAYS;
    if (resolved) resolvedWeekdays.push(day);
    const row = [];
    for (let h = 0; h < 24; h++) {
      const means = cellDays[day][h];
      const d = means.length;
      const base = hourOfDay[h];
      let est = base.est;
      let conf = base.conf * 0.6;
      let mean = null;
      let sd = null;
      if (d > 0) {
        mean = means.reduce((a, v) => a + v, 0) / d;
        if (d > 1) sd = Math.sqrt(means.reduce((a, v) => a + (v - mean) ** 2, 0) / (d - 1));
      }
      if (resolved && d > 0) {
        est = (d * mean + HOUR_LEVEL_DAYS * base.est) / (d + HOUR_LEVEL_DAYS);
        conf = Math.min(1, d / (d + PRIOR_DAYS) + (1 - d / (d + PRIOR_DAYS)) * base.conf * 0.6);
      }
      row.push({
        day,
        hour: h,
        n: cellSamples[day][h],
        days: d,
        mean: mean === null ? null : Math.round(mean * 100) / 100,
        sd: sd === null ? null : Math.round(sd * 100) / 100,
        est: Math.round(est * 100) / 100,
        conf: Math.round(conf * 100) / 100,
        observed: d > 0,
      });
    }
    cells.push(row);
  }
  return { cells, hourOfDay, resolvedWeekdays, distinctDays: new Set(daily.map((b) => b.dateKey)).size };
}

/**
 * Regionsprofil aus den Messreihen aller Stationen im Bereich.
 * @param {Map<string, Array<{t,p,o}>>} readingsMap  stationId -> Messpunkte
 * @param {{now?:number, lookbackDays?:number, prior?:number[]}} [opts]  prior = Erfahrungswerte (priorForRules)
 */
export function buildRegionalProfile(readingsMap, opts = {}) {
  const now = opts.now || Date.now();
  const lookbackDays = opts.lookbackDays || 28;
  const priorCt = Array.isArray(opts.prior) && opts.prior.length === 24 ? opts.prior : PRIOR_HOURLY_CT;
  const fromMs = now - lookbackDays * DAY_MS;

  const sampled = [];
  let firstAt = null;
  let lastAt = null;
  if (readingsMap && readingsMap.size > 0) {
    for (const [stationId, pts] of readingsMap) {
      if (!pts || pts.length === 0) continue;
      const samples = sampleHourly(pts, fromMs, now);
      if (samples.length === 0) continue;
      sampled.push({ stationId, samples });
      if (firstAt === null || samples[0].t < firstAt) firstAt = samples[0].t;
      if (lastAt === null || samples[samples.length - 1].t > lastAt) lastAt = samples[samples.length - 1].t;
    }
  }

  // Zwei Durchgänge: Niveau zuerst mit Erfahrungswerten bereinigen, dann mit dem gelernten Stundenprofil
  const prior = (h) => priorCt[h];
  let rel = sampled.map((s) => relativeSamples(s.samples, prior));
  let built = buildFromRelative(rel, priorCt);
  const firstPass = built.hourOfDay;
  rel = sampled.map((s) => relativeSamples(s.samples, (h) => firstPass[h].est));
  built = buildFromRelative(rel, priorCt);

  const levels = new Map();
  let totalSamples = 0;
  let stationsUsed = 0;
  sampled.forEach((s, i) => {
    const list = rel[i];
    if (list.length === 0) return;
    stationsUsed += 1;
    totalSamples += list.length;
    levels.set(s.stationId, Math.round(list[list.length - 1].level * 1000) / 1000);
  });

  const daysCovered = firstAt !== null ? Math.max(0, (lastAt - firstAt) / DAY_MS) : 0;
  const distinctDays = built.distinctDays;
  let dataQuality = 'none';
  if (distinctDays >= 10 && totalSamples >= 1000) dataQuality = 'good';
  else if (distinctDays >= 3 && totalSamples >= 200) dataQuality = 'ok';
  else if (totalSamples > 0) dataQuality = 'thin';

  // Amplitude (typische Spanne zwischen teuerster und günstigster Stunde eines Tages)
  const hourEst = built.hourOfDay.map((h) => h.est);
  const amplitudeCt = Math.round((Math.max(...hourEst) - Math.min(...hourEst)) * 10) / 10;

  return {
    cells: built.cells,
    hourOfDay: built.hourOfDay,
    resolvedWeekdays: built.resolvedWeekdays,
    weekdaysResolved: built.resolvedWeekdays.length === 7,
    distinctDays,
    totalSamples,
    stationsUsed,
    daysCovered: Math.round(daysCovered * 10) / 10,
    firstAt,
    lastAt,
    dataQuality,
    amplitudeCt,
    levels,
    prior: priorCt,
  };
}

/** Geschätzte relative Preislage (ct/L) zu einem Zeitpunkt laut Profil (Zelle mit est, conf, n, days). */
export function profileEstimateAt(profile, dateOrMs) {
  const d = new Date(dateOrMs);
  if (!profile) return { est: PRIOR_HOURLY_CT[d.getHours()], conf: 0, n: 0, days: 0, hour: d.getHours(), day: toMondayIndex(d.getDay()) };
  return profile.cells[toMondayIndex(d.getDay())][d.getHours()];
}

/**
 * Absoluter Bezugspreis für Profilwerte: Der aktuelle Median enthält bereits die Lage der aktuellen
 * Stunde, daher Anker = Median − est(jetzt). Preis zur Zeit t ≈ Anker + est(t)/100.
 */
export function profileAnchorPrice(profile, regionMedian, now = Date.now()) {
  if (!Number.isFinite(regionMedian)) return null;
  return regionMedian - profileEstimateAt(profile, now).est / 100;
}

/**
 * Regionaler Preisindex über die Zeit: Median/Min/Max aller Stationen je Zeitschritt.
 * Punkte nach einer Datenlücke tragen gapBefore: true (Diagramme unterbrechen dort die Linie).
 */
export function buildRegionalIndexSeries(readingsMap, { fromMs, toMs = Date.now(), stepMinutes = 30 } = {}) {
  if (!readingsMap || readingsMap.size === 0 || !fromMs) return [];
  const step = stepMinutes * 60 * 1000;
  const series = [];
  const start = Math.ceil(fromMs / step) * step;
  let lastT = null;
  for (let t = start; t <= toMs; t += step) {
    const prices = [];
    for (const pts of readingsMap.values()) {
      const p = priceAt(pts, t, MAX_HOLD_MS);
      if (p !== null) prices.push(p);
    }
    if (prices.length === 0) continue;
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const med = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    series.push({
      t,
      date: new Date(t),
      median: Math.round(med * 1000) / 1000,
      min: prices[0],
      max: prices[prices.length - 1],
      count: prices.length,
      gapBefore: lastT !== null && t - lastT > step * 1.5,
    });
    lastT = t;
  }
  return series;
}

/**
 * Querschnitts-Momentaufnahme: Wie steht die Region JETZT da?
 * Erwartet Stationen mit currentPrice, brand, isOpen.
 */
export function summarizeRegionNow(stations) {
  const open = (stations || []).filter((s) => s && Number.isFinite(s.currentPrice) && s.isOpen !== false);
  const all = (stations || []).filter((s) => s && Number.isFinite(s.currentPrice));
  const base = open.length > 0 ? open : all;
  if (base.length === 0) {
    return { count: 0, openCount: 0, median: null, mean: null, min: null, max: null, spreadCent: 0, cheapest: null, dearest: null, brands: [] };
  }
  const prices = base.map((s) => s.currentPrice);
  const med = median(prices);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sorted = [...base].sort((a, b) => a.currentPrice - b.currentPrice);

  const brandMap = new Map();
  for (const s of base) {
    const b = (s.brand || 'Frei').trim();
    const entry = brandMap.get(b) || { brand: b, count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += s.currentPrice;
    brandMap.set(b, entry);
  }
  const brands = Array.from(brandMap.values())
    .map((b) => ({ brand: b.brand, count: b.count, avg: b.sum / b.count, deltaCent: Math.round((b.sum / b.count - med) * 1000) / 10 }))
    .sort((a, b) => a.avg - b.avg);

  return {
    count: all.length,
    openCount: open.length,
    median: Math.round(med * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    min: sorted[0].currentPrice,
    max: sorted[sorted.length - 1].currentPrice,
    spreadCent: Math.round((sorted[sorted.length - 1].currentPrice - sorted[0].currentPrice) * 1000) / 10,
    cheapest: sorted[0],
    dearest: sorted[sorted.length - 1],
    brands,
  };
}

/**
 * Beste Zeitfenster laut Regionsprofil.
 * Liefert die aktuelle relative Lage, das Tief im Rest des Tages und das Tief im Horizont.
 * Stunde 0 (= jetzt) zählt beim nächsten günstigen Fenster mit, damit "jetzt günstig" erkannt wird.
 */
export function findBestWindows(profile, { now = Date.now(), horizonHours = 72 } = {}) {
  if (!profile) return null;
  const nowDate = new Date(now);
  const nowCell = profileEstimateAt(profile, now);
  const hoursLeftToday = 23 - nowDate.getHours();

  const points = [];
  for (let h = 0; h <= horizonHours; h++) {
    const t = now + h * HOUR_MS;
    const cell = profileEstimateAt(profile, t);
    const d = new Date(t);
    points.push({ hoursAhead: h, t, hour: d.getHours(), dayIndex: toMondayIndex(d.getDay()), est: cell.est, conf: cell.conf, n: cell.n, days: cell.days, observed: cell.observed });
  }

  const pickMin = (arr) => arr.reduce((best, p) => (best === null || p.est < best.est ? p : best), null);
  const todayPts = points.filter((p) => p.hoursAhead >= 1 && p.hoursAhead <= hoursLeftToday);
  const todayMin = pickMin(todayPts);
  const horizonMin = pickMin(points.filter((p) => p.hoursAhead >= 1));
  const next24Min = pickMin(points.filter((p) => p.hoursAhead <= 24));
  const next24Max = points.filter((p) => p.hoursAhead <= 24).reduce((b, p) => (b === null || p.est > b.est ? p : b), null);

  // Nächstes günstiges Fenster: zusammenhängende Stunden nahe am Tief der nächsten 24 h
  let nextWindow = null;
  if (next24Min) {
    const threshold = next24Min.est + 0.6;
    let startIdx = next24Min.hoursAhead;
    while (startIdx > 0 && points[startIdx - 1].est <= threshold) startIdx--;
    let endIdx = next24Min.hoursAhead;
    while (endIdx < 24 && points[endIdx + 1] && points[endIdx + 1].est <= threshold) endIdx++;
    nextWindow = { start: points[startIdx], end: points[endIdx], est: next24Min.est, isNow: startIdx === 0 };
  }

  // Phase jetzt (relativ zur Spanne der nächsten 24h)
  const span = next24Max && next24Min ? next24Max.est - next24Min.est : 0;
  let phase = 'MITTEL';
  if (span > 0.8) {
    const pos = (nowCell.est - next24Min.est) / span;
    if (pos >= 0.66) phase = 'TEUER';
    else if (pos <= 0.33) phase = 'GÜNSTIG';
  }

  return {
    nowRel: nowCell.est,
    nowConf: nowCell.conf,
    phase,
    todayMin,
    horizonMin,
    next24Min,
    next24Max,
    nextWindow,
    points,
  };
}

function dayLabelFor(t, now) {
  const d = new Date(t);
  const nowD = new Date(now);
  if (d.toDateString() === nowD.toDateString()) return 'heute';
  if (new Date(nowD.getTime() + DAY_MS).toDateString() === d.toDateString()) return 'morgen';
  return DAY_NAMES[toMondayIndex(d.getDay())];
}

/** Formatierte Beschriftung "heute 19:00 Uhr" / "morgen 20:00 Uhr" / "Dienstag 19:00 Uhr". */
export function describeWindowTime(point, now = Date.now()) {
  if (!point) return '';
  return `${dayLabelFor(point.t, now)} ${new Date(point.t).getHours()}:00 Uhr`;
}

/** Zeitfenster-Beschriftung "heute 19:00–22:00 Uhr" (Ende = Beginn der Stunde nach dem Fenster). */
export function describeWindowRange(start, end, now = Date.now()) {
  if (!start) return '';
  const endHour = ((end ? end.hour : start.hour) + 1) % 24;
  if (start.hoursAhead === 0) return `jetzt bis ${endHour}:00 Uhr`;
  return `${dayLabelFor(start.t, now)} ${start.hour}:00–${endHour}:00 Uhr`;
}

/**
 * Aktuelle Preisbewegungen in der Region (letzte Preisänderung je Station).
 * Nur Änderungen mit bekanntem Zeitpunkt (Abstand zum vorherigen Messwert ≤ 75 min) zählen für die
 * Wellenerkennung. Änderungen nach einer App-Pause werden mit Zeitraum gemeldet (timingKnown: false).
 * Mit Erhöhungs-Regel (rules) werden Erhöhungen zur erlaubten Zeit und außerhalb davon markiert.
 */
export function detectRecentPriceMoves(stations, readingsMap, { now = Date.now(), windowMinutes = 180, rules = DEFAULT_RULES } = {}) {
  const windowMs = windowMinutes * 60 * 1000;
  const moves = [];
  let considered = 0;
  for (const st of stations || []) {
    const pts = readingsMap?.get(st.id);
    if (!pts || pts.length < 2) continue;
    // Nur Stationen mit aktuellem Messwert sind für eine Welle aussagekräftig
    if (now - pts[pts.length - 1].t > MAX_HOLD_MS) continue;
    considered += 1;
    // Letzte echte Preisänderung finden (Heartbeats überspringen)
    let i = pts.length - 1;
    while (i > 0 && pts[i].p === pts[i - 1].p) i--;
    if (i === 0) continue;
    const changeAt = pts[i].t;
    const prevAt = pts[i - 1].t;
    if (now - changeAt > windowMs) continue;
    const deltaCent = Math.round((pts[i].p - pts[i - 1].p) * 1000) / 10;
    // Echte Preisschritte im deutschen Markt sind ≥ 1 ct; kleinere Sprünge sind Rauschen
    if (Math.abs(deltaCent) < 0.9) continue;
    const timingKnown = changeAt - prevAt <= MAX_HOLD_MS;
    // Erhöhungs-Regel: Bei unbekanntem Zeitpunkt nur markieren, wenn der gesamte mögliche Zeitraum
    // außerhalb der erlaubten Zeiten liegt.
    const isUp = deltaCent > 0;
    const restricted = isUp && isRestrictedAt(rules, changeAt);
    const couldBeAllowed = restricted && increaseCouldBeAllowed(rules, prevAt, changeAt);
    const ruleIncrease = restricted && couldBeAllowed;
    const outsideRule = restricted && !couldBeAllowed;
    moves.push({
      stationId: st.id,
      name: st.name,
      brand: st.brand,
      deltaCent,
      direction: deltaCent > 0 ? 'UP' : 'DOWN',
      minutesAgo: Math.max(0, Math.round((now - changeAt) / 60000)),
      timingKnown,
      fromT: timingKnown ? null : prevAt,
      toT: timingKnown ? null : changeAt,
      price: pts[i].p,
      ruleIncrease,
      outsideRule,
    });
  }
  moves.sort((a, b) => (a.timingKnown === b.timingKnown ? a.minutesAgo - b.minutesAgo : a.timingKnown ? -1 : 1));
  const recent = moves.filter((m) => m.timingKnown && m.minutesAgo <= 90);
  const ups = recent.filter((m) => m.direction === 'UP').length;
  const downs = recent.filter((m) => m.direction === 'DOWN').length;
  let wave = 'NONE';
  if (considered >= 3) {
    if (ups >= 2 && ups >= Math.ceil(considered * 0.3) && ups > downs * 2) wave = 'UP';
    else if (downs >= 2 && downs >= Math.ceil(considered * 0.3) && downs > ups * 2) wave = 'DOWN';
  }
  // Welle aus Erhöhungen zur erlaubten Zeit: danach dürfen die übrigen Stationen erst zur nächsten erlaubten Zeit nachziehen
  const recentUps = recent.filter((m) => m.direction === 'UP');
  const ruleWave = wave === 'UP' && recentUps.length > 0 && recentUps.filter((m) => m.ruleIncrease).length >= Math.ceil(recentUps.length * 0.7);
  const ruleState = describeRuleState(rules, now);
  return {
    moves,
    ups,
    downs,
    considered,
    wave,
    ruleWave,
    outsideRuleCount: moves.filter((m) => m.outsideRule).length,
    ruleName: ruleState.active ? ruleState.name : null,
    ruleTimesLabel: ruleState.active ? ruleState.timesLabel : null,
  };
}

/**
 * Ersparnis durch Verlagerung des Tankens vom Morgen- in das Abendfenster (ct/L) laut Profil.
 */
export function computeCommuteShiftSavings(profile, settings) {
  if (!profile) return null;
  // Minutengenau: "07:30" bis "08:45" gewichtet 7 Uhr mit 30 und 8 Uhr mit 45 Minuten
  const toMin = (s, fallback) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return fallback;
    const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return v >= 0 && v < 1440 ? v : fallback;
  };
  const avg = (from, to) => {
    const end = to > from ? to : to + 1440;
    let sum = 0;
    let weight = 0;
    for (let m0 = Math.floor(from / 60) * 60; m0 < end; m0 += 60) {
      const w = Math.min(end, m0 + 60) - Math.max(from, m0);
      if (w <= 0) continue;
      sum += w * profile.hourOfDay[(m0 / 60) % 24].est;
      weight += w;
    }
    return weight ? sum / weight : 0;
  };
  const morning = avg(toMin(settings?.commuteMorningStart, 450), toMin(settings?.commuteMorningEnd, 525));
  const evening = avg(toMin(settings?.commuteEveningStart, 990), toMin(settings?.commuteEveningEnd, 1125));
  return {
    morningRelCt: Math.round(morning * 10) / 10,
    eveningRelCt: Math.round(evening * 10) / 10,
    savingsCentPerLiter: Math.round((morning - evening) * 10) / 10,
  };
}

/**
 * Top-Zeitfenster (günstig & teuer) für die Wochenübersicht.
 * Wochentage werden nur genannt, wenn sie wirklich beobachtet wurden (je mindestens 2 Tage) UND sich die
 * Stunde zwischen den Wochentagen spürbar unterscheidet – sonst "täglich 20:00–21:00 Uhr", damit nicht
 * zufällig ein Wochentag durch die Sortierung "gewinnt".
 */
export function deriveTopWindows(profile, limit = 2) {
  if (!profile) return { cheap: [], expensive: [], byWeekday: false };
  const weekdaysResolved = !!profile.weekdaysResolved;
  const flat = [];
  for (let h = 0; h < 24; h++) {
    const dayVals = profile.cells.map((row) => row[h].est);
    const spread = Math.max(...dayVals) - Math.min(...dayVals);
    if (weekdaysResolved && spread >= 0.8) {
      for (let d = 0; d < 7; d++) {
        const c = profile.cells[d][h];
        flat.push({ day: d, hour: h, est: c.est, conf: c.conf, n: c.n, days: c.days });
      }
    } else {
      const hd = profile.hourOfDay[h];
      flat.push({ day: null, hour: h, est: hd.est, conf: hd.conf, n: hd.n, days: hd.days });
    }
  }
  const byEst = [...flat].sort((a, b) => a.est - b.est);
  const group = (list) => {
    const out = [];
    for (const c of list) {
      if (out.length >= limit) break;
      if (out.some((o) => (o.day === c.day || o.day === null || c.day === null) && Math.abs(o.hour - c.hour) <= 2)) continue;
      out.push(c);
    }
    return out.map((c) => ({
      ...c,
      label: `${c.day === null ? 'täglich' : DAY_NAMES[c.day]}, ${c.hour}:00–${(c.hour + 1) % 24}:00 Uhr`,
    }));
  };
  return { cheap: group(byEst), expensive: group([...byEst].reverse()), byWeekday: flat.some((c) => c.day !== null) };
}
