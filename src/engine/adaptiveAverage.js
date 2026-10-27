/**
 * KRAFTSTOFF - Bewertungs-Engine & Adaptive Moving Average (AMA)
 *
 * Bewertet den aktuellen Preis einer Tankstelle gegen ihre EIGENE echte Historie:
 * 1. Standardabweichung (σ) über die letzten 24 Stunden.
 * 2. Dynamische Fensterbreite W_adj = W_base * (1 + σ / σ_ref).
 * 3. Zeitgewichteter adaptiver Durchschnitt über das dynamische Zeitfenster.
 * 4. Schwellenwert-Klassifikation ("Günstig", "Neutral", "Teuer").
 *
 * Messpunkte werden im Format { t: ms, p: €/L } erwartet (ältere { timestamp, price } werden akzeptiert).
 *
 * Für Aussagen wie "günstiger als sonst" wird – sofern ein Regionsprofil vorliegt – nicht gegen den
 * Durchschnitt aller Stunden verglichen (der abends fast immer unterboten wird), sondern gegen das,
 * was die Station UM DIESE UHRZEIT üblicherweise kostet: gleitendes Niveau + Profilwert der Stunde.
 */

import { stationLevelAt, profileEstimateAt } from './regionalTrends';

export const REFERENCE_SIGMA = 0.040; // 4,0 Cent typische Volatilität im deutschen Markt
export const BASE_WINDOW_HOURS = 72;
export const DEFAULT_THRESHOLD_CENT = 0.030; // 3,0 Cent

const HOUR_MS = 60 * 60 * 1000;

function pointTime(e) {
  if (typeof e.t === 'number') return e.t;
  return new Date(e.timestamp).getTime();
}

function pointPrice(e) {
  return typeof e.p === 'number' ? e.p : e.price;
}

export function calculateMean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function calculateStandardDeviation(prices) {
  if (!prices || prices.length < 2) return 0;
  const mean = calculateMean(prices);
  const variance = prices.reduce((acc, p) => acc + (p - mean) ** 2, 0) / (prices.length - 1);
  return Math.sqrt(variance);
}

/** Preise der letzten 24 Stunden aus einer Messreihe. */
export function get24hPrices(history, currentTime = Date.now()) {
  if (!history || history.length === 0) return [];
  const refTime = new Date(currentTime).getTime();
  const past = refTime - 24 * HOUR_MS;
  const out = [];
  for (const e of history) {
    const t = pointTime(e);
    const p = pointPrice(e);
    if (t >= past && t <= refTime && Number.isFinite(p)) out.push(p);
  }
  return out;
}

/** Adaptive Fensterbreite: wächst bei hoher Volatilität (glättet), schrumpft bei ruhigem Markt. */
export function calculateAdaptiveWindowHours(sigma, baseWindowHours = BASE_WINDOW_HOURS, refSigma = REFERENCE_SIGMA) {
  const safeSigma = Math.max(0, sigma || 0);
  const windowHours = baseWindowHours * (1 + safeSigma / refSigma);
  return Math.min(144, Math.max(24, Math.round(windowHours)));
}

/**
 * Zeitgewichteter Durchschnitt (exponentiell abklingende Gewichte) über das Fenster.
 * Da Tankpreise Treppenfunktionen sind, wird jeder Messpunkt mit der Dauer gewichtet,
 * für die er gültig war (bis zum nächsten Punkt, maximal 3 Stunden).
 */
export function calculateAdaptiveMovingAverage(history, windowHours, currentTime = Date.now()) {
  if (!history || history.length === 0) return null;
  const refTime = new Date(currentTime).getTime();
  const windowStart = refTime - windowHours * HOUR_MS;
  const lambda = 1.8 / windowHours;

  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < history.length; i++) {
    const t = pointTime(history[i]);
    const p = pointPrice(history[i]);
    if (!Number.isFinite(p) || t > refTime) continue;
    const next = i + 1 < history.length ? Math.min(refTime, pointTime(history[i + 1])) : refTime;
    const validUntil = Math.min(next, t + 3 * HOUR_MS);
    if (validUntil < windowStart) continue;
    const from = Math.max(t, windowStart);
    const durationH = Math.max(0.25, (validUntil - from) / HOUR_MS);
    const ageHours = (refTime - (from + validUntil) / 2) / HOUR_MS;
    const weight = Math.exp(-lambda * Math.max(0, ageHours)) * durationH;
    weightedSum += p * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

/**
 * Vollständige Bewertung eines aktuellen Preises gegen die eigene Historie.
 * @returns {Object} u.a. effectiveDynAverage, deltaCent, verdict, isCheap, sampleCount, hasHistory
 */
export function evaluatePriceEngine({
  currentPrice,
  history = [],
  thresholdCent = DEFAULT_THRESHOLD_CENT,
  currentTime = Date.now(),
  profile = null,
}) {
  const safePrice = Number.isFinite(currentPrice) ? currentPrice : 0;
  const sampleCount = Array.isArray(history) ? history.length : 0;

  const prices24h = get24hPrices(history, currentTime);
  const series = prices24h.length >= 2 ? prices24h : history.map(pointPrice).concat([safePrice]).filter(Number.isFinite);
  const sigma = calculateStandardDeviation(series);
  const adaptiveWindowHours = calculateAdaptiveWindowHours(sigma);

  const dynAverageRaw = calculateAdaptiveMovingAverage(history, adaptiveWindowHours, currentTime);
  const hasAmaHistory = dynAverageRaw !== null && sampleCount >= 3;
  const effectiveDynAverage = hasAmaHistory ? dynAverageRaw : safePrice;

  // Erwartung für genau diese Uhrzeit: gleitendes 48-h-Niveau der Station + Profilwert der aktuellen Stunde
  let expectedNow = null;
  if (profile && sampleCount >= 3 && typeof history[0]?.t === 'number') {
    const estFn = (h) => profile.hourOfDay?.[h]?.est ?? 0;
    const level = stationLevelAt(history, currentTime, estFn, 48 * HOUR_MS);
    if (level !== null) expectedNow = level + profileEstimateAt(profile, currentTime).est / 100;
  }
  const hasHistory = expectedNow !== null;
  const reference = hasHistory ? expectedNow : effectiveDynAverage;

  const delta = safePrice - reference;
  const deltaCent = delta * 100;

  let verdict = 'NEUTRAL';
  let label = hasHistory ? 'Üblich für diese Uhrzeit' : 'Noch zu wenig eigene Daten';
  let badgeColor = 'neutral';
  if (hasHistory && delta <= -thresholdCent) {
    verdict = 'CHEAP';
    label = 'Günstiger als sonst um diese Zeit';
    badgeColor = 'favorable';
  } else if (hasHistory && delta >= thresholdCent) {
    verdict = 'EXPENSIVE';
    label = 'Teurer als sonst um diese Zeit';
    badgeColor = 'unfavorable';
  }

  let volatilityLevel = 'MODERAT';
  if (sigma < 0.02) volatilityLevel = 'NIEDRIG';
  else if (sigma > 0.055) volatilityLevel = 'HOCH';

  return {
    currentPrice: safePrice,
    expectedNow: expectedNow === null ? null : Math.round(expectedNow * 1000) / 1000,
    basis: hasHistory ? 'hourly' : 'none',
    hasAmaHistory,
    effectiveDynAverage: Math.round(effectiveDynAverage * 1000) / 1000,
    sigma: Math.round(sigma * 10000) / 10000,
    sigmaCent: Math.round(sigma * 10000) / 100,
    adaptiveWindowHours,
    delta: Math.round(delta * 1000) / 1000,
    deltaCent: Math.round(deltaCent * 10) / 10,
    thresholdCent: Math.round(thresholdCent * 1000) / 10,
    isCheap: verdict === 'CHEAP',
    verdict,
    label,
    badgeColor,
    volatilityLevel,
    sampleCount,
    hasHistory,
  };
}
