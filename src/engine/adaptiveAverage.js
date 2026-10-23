/**
 * KRAFTSTOFF - Mathematische Bewertungs-Engine & Adaptive Moving Average (AMA)
 * 
 * Implementiert die Spezifikationsrichtlinien:
 * 1. Berechnung der Standardabweichung (σ) über die letzten 24 Stunden.
 * 2. Dynamische Fensterbreite W_adj = W_base * (1 + (σ / σ_ref)).
 * 3. Gewichteter adaptiver Durchschnitt über das dynamische Zeitfenster.
 * 4. Schwellenwert-Klassifikation ("Günstig", "Neutral", "Teuer").
 */

// Referenz-Standardabweichung für deutsche Kraftstoffmärkte (typisch ~3.5 bis 4.5 Cent / Liter)
export const REFERENCE_SIGMA = 0.040; // 4.0 Cent

// Basis-Lookback Fensterbreite: 72 Stunden (3 Tage)
export const BASE_WINDOW_HOURS = 72;

// Standard Schwellenwert: 3 Cent unter Durchschnitt gilt als günstig
export const DEFAULT_THRESHOLD_CENT = 0.030; // 3.0 Cent

/**
 * Berechnet den arithmetischen Mittelwert eines Zahlen-Arrays.
 */
export function calculateMean(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Berechnet die empirische Standardabweichung (σ) einer Preisreihe.
 * @param {number[]} prices - Liste von Preisen in Euro (z.B. [1.749, 1.719, 1.769])
 * @returns {number} Standardabweichung σ
 */
export function calculateStandardDeviation(prices) {
  if (!prices || prices.length < 2) return 0;
  const mean = calculateMean(prices);
  const variance = prices.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / (prices.length - 1);
  return Math.sqrt(variance);
}

/**
 * Extrahiert die Preise der letzten 24 Stunden aus einer Zeitreihe.
 * @param {Array<{timestamp: string|number|Date, price: number}>} history
 * @param {Date} [currentTime=new Date()]
 * @returns {number[]} Preise der letzten 24h
 */
export function get24hPrices(history, currentTime = new Date()) {
  if (!history || history.length === 0) return [];
  const refTime = new Date(currentTime).getTime();
  const past24hTime = refTime - 24 * 60 * 60 * 1000;

  return history
    .filter((entry) => {
      const t = new Date(entry.timestamp).getTime();
      return t >= past24hTime && t <= refTime && typeof entry.price === 'number' && !isNaN(entry.price);
    })
    .map((entry) => entry.price);
}

/**
 * Skaliert die Fensterbreite W basierend auf der kurzfristigen Volatilität σ:
 * Neues Fenster = W * (1 + (σ / Referenz-σ))
 * 
 * - Hohe Volatilität: Fenster wächst (bis zu z.B. 144h), um hektische Preissprünge zu glätten.
 * - Geringe Volatilität: Fenster schrumpft (Richtung 36h-48h), um rasch auf neue echte Preistrends anzuspringen.
 */
export function calculateAdaptiveWindowHours(sigma, baseWindowHours = BASE_WINDOW_HOURS, refSigma = REFERENCE_SIGMA) {
  const safeSigma = Math.max(0, sigma || 0);
  const scaling = safeSigma / refSigma;
  // Bounded between 24 hours and 144 hours (6 days)
  const windowHours = baseWindowHours * (1 + scaling);
  return Math.min(144, Math.max(24, Math.round(windowHours)));
}

/**
 * Berechnet den Adaptive Moving Average (dynamischer Durchschnitt)
 * für den aktuellen Zeitpunkt unter Berücksichtigung des berechneten Fensters.
 * 
 * Verwendet exponentiell abklingende Gewichte (EMA-Hybrid), sodass nähere Zeitpunkte
 * höheres Gewicht haben, aber das Gesamtfenster W_adj die Dämpfung steuert.
 */
export function calculateAdaptiveMovingAverage(history, windowHours, currentTime = new Date()) {
  if (!history || history.length === 0) return null;

  const refTime = new Date(currentTime).getTime();
  const windowStart = refTime - windowHours * 60 * 60 * 1000;

  const validEntries = history.filter((entry) => {
    const t = new Date(entry.timestamp).getTime();
    return t >= windowStart && t <= refTime && typeof entry.price === 'number' && !isNaN(entry.price);
  });

  if (validEntries.length === 0) return null;

  // Gewichtung: Lineare / exponentielle Zeitgewichtung zur Dämpfung
  let totalWeight = 0;
  let weightedSum = 0;

  validEntries.forEach((entry) => {
    const t = new Date(entry.timestamp).getTime();
    const ageHours = (refTime - t) / (60 * 60 * 1000);
    // Exponentielles Gewicht: Neuere Werte wiegen mehr
    const lambda = 1.8 / windowHours;
    const weight = Math.exp(-lambda * ageHours);

    weightedSum += entry.price * weight;
    totalWeight += weight;
  });

  return weightedSum / totalWeight;
}

/**
 * Führt die vollständige Bewertung eines aktuellen Preises durch.
 * 
 * @param {Object} params
 * @param {number} params.currentPrice - Der aktuelle Preis in Euro
 * @param {Array<{timestamp: string, price: number}>} params.history - Historische Preise
 * @param {number} [params.thresholdCent=0.030] - Schwellenwert in Euro (z.B. 0.030 für 3 Cent)
 * @param {number} [params.taxReliefCent=0] - Aktiver gesetzlicher Rabatt/Aufschlag
 * @returns {Object} Bewertungsergebnis
 */
export function evaluatePriceEngine({
  currentPrice,
  history = [],
  thresholdCent = DEFAULT_THRESHOLD_CENT,
  taxReliefCent = 0,
  currentTime = new Date()
}) {
  // 1. Extrahiere Preise der letzten 24h
  const prices24h = get24hPrices(history, currentTime);
  
  // Falls keine oder wenig Historie, fallback auf den aktuellen Preis
  const fullPriceSeries = prices24h.length >= 2 ? prices24h : (history.map(h => h.price).concat([currentPrice]));
  
  // 2. Berechne Standardabweichung σ
  const sigma = calculateStandardDeviation(fullPriceSeries);

  // 3. Berechne adaptives Zeitfenster W_adj
  const adaptiveWindowHours = calculateAdaptiveWindowHours(sigma, BASE_WINDOW_HOURS, REFERENCE_SIGMA);

  // 4. Berechne dynamischen gleitenden Durchschnitt
  const dynAverageRaw = calculateAdaptiveMovingAverage(history, adaptiveWindowHours, currentTime) || currentPrice;
  
  // Berücksichtigung externer Gesetze & Steueranpassungen
  const effectiveDynAverage = dynAverageRaw + (taxReliefCent / 100);
  
  // 5. Differenz und Schwellenwert-Prüfung
  const delta = currentPrice - effectiveDynAverage; // Negativ = günstiger als Durchschnitt
  const deltaCent = delta * 100; // in Cent

  // Status Klassifizierung
  let verdict = 'NEUTRAL'; // 'CHEAP' | 'NEUTRAL' | 'EXPENSIVE'
  let label = 'Normaler Preis';
  let badgeColor = 'neutral'; // 'favorable' | 'neutral' | 'unfavorable'

  if (delta <= -thresholdCent) {
    verdict = 'CHEAP';
    label = 'Aktuell günstig';
    badgeColor = 'favorable';
  } else if (delta >= thresholdCent) {
    verdict = 'EXPENSIVE';
    label = 'Erhöhter Preis';
    badgeColor = 'unfavorable';
  }

  // Volatilitätsgrad
  let volatilityLevel = 'MODERAT';
  if (sigma < 0.02) {
    volatilityLevel = 'NIEDRIG (Stabiler Trend)';
  } else if (sigma > 0.055) {
    volatilityLevel = 'HOCH (Starke Preissprünge)';
  }

  // Statistische Basis-Score (0-100)
  // Günstiger Preis (-6 ct) -> ~90-100 Score. Teurer Preis (+6 ct) -> ~10-20 Score.
  const rawScore = 50 - (deltaCent * 8);
  const score = Math.max(1, Math.min(100, Math.round(rawScore)));

  return {
    currentPrice,
    effectiveDynAverage: parseFloat(effectiveDynAverage.toFixed(3)),
    sigma: parseFloat(sigma.toFixed(4)),
    sigmaCent: parseFloat((sigma * 100).toFixed(2)),
    adaptiveWindowHours,
    delta: parseFloat(delta.toFixed(3)),
    deltaCent: parseFloat(deltaCent.toFixed(1)),
    thresholdCent: parseFloat((thresholdCent * 100).toFixed(1)),
    isCheap: verdict === 'CHEAP',
    verdict,
    label,
    badgeColor,
    volatilityLevel,
    score
  };
}
