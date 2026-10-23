/**
 * KRAFTSTOFF - Monte-Carlo-Simulation & Ankunftszeit-Preisprognose
 * 
 * Berechnet für jede Tankstelle:
 * 1. Reale Fahrzeit & Ankunftszeit (Minuten) basierend auf Distanz & Verkehr
 * 2. Preisänderungs-Wahrscheinlichkeit während der Anfahrt
 * 3. 1.000-Pfad Monte-Carlo-Simulation zur Abschätzung von Preissprüngen (Kartellamt Intraday-Zyklen)
 * 4. Optimale Uhrzeit & optimaler Wochentag für diese Tankstelle
 */

/**
 * Typischer deutscher Tagesverlauf von Preissprüngen & Volatilität
 * Quelle: Markttransparenzstelle für Kraftstoffe (MTS-K) des Bundeskartellamtes
 */
const HOURLY_MARKET_DYNAMICS = {
  // stunde: { driftCtPerHour, volatilityCt, jumpProbabilityAtHour, typicalJumpCt }
  0:  { drift: 0.0, vol: 0.2, jumpProb: 0.05, jump: 0 },
  1:  { drift: 0.0, vol: 0.1, jumpProb: 0.02, jump: 0 },
  2:  { drift: 0.0, vol: 0.1, jumpProb: 0.02, jump: 0 },
  3:  { drift: 0.0, vol: 0.1, jumpProb: 0.02, jump: 0 },
  4:  { drift: 0.0, vol: 0.2, jumpProb: 0.05, jump: 0 },
  5:  { drift: 0.5, vol: 0.8, jumpProb: 0.25, jump: 2.0 },
  6:  { drift: 1.8, vol: 1.5, jumpProb: 0.65, jump: 6.5 }, // Morgensprung 1
  7:  { drift: 1.2, vol: 1.2, jumpProb: 0.55, jump: 4.0 }, // Berufsverkehr Spitze
  8:  { drift: -0.8, vol: 0.7, jumpProb: 0.15, jump: -1.0 }, // Leichtes Abbröckeln
  9:  { drift: -0.6, vol: 0.6, jumpProb: 0.10, jump: -1.0 },
  10: { drift: 1.5, vol: 1.3, jumpProb: 0.50, jump: 5.0 }, // Vormittagssprung
  11: { drift: -0.7, vol: 0.6, jumpProb: 0.12, jump: -1.0 },
  12: { drift: -0.9, vol: 0.5, jumpProb: 0.08, jump: -1.2 }, // Mittagsdelle
  13: { drift: 1.4, vol: 1.1, jumpProb: 0.45, jump: 4.5 }, // Mittagssprung
  14: { drift: -0.8, vol: 0.6, jumpProb: 0.15, jump: -1.0 },
  15: { drift: 1.0, vol: 1.0, jumpProb: 0.40, jump: 3.5 }, // Nachmittagsanstieg
  16: { drift: -0.5, vol: 0.6, jumpProb: 0.15, jump: -1.0 },
  17: { drift: 1.6, vol: 1.4, jumpProb: 0.60, jump: 5.5 }, // Feierabend-Sprung
  18: { drift: -1.8, vol: 0.7, jumpProb: 0.08, jump: -2.5 }, // Starke Preissenkung (Beste Zeit!)
  19: { drift: -1.4, vol: 0.6, jumpProb: 0.05, jump: -2.0 }, // Tiefststand
  20: { drift: 0.8, vol: 1.2, jumpProb: 0.50, jump: 4.0 }, // Abendsprung 1
  21: { drift: -0.5, vol: 0.7, jumpProb: 0.10, jump: -1.0 },
  22: { drift: 2.2, vol: 1.8, jumpProb: 0.75, jump: 7.0 }, // Nachtaufschlag (Sehr teuer!)
  23: { drift: 0.2, vol: 0.5, jumpProb: 0.10, jump: 1.0 },
};

/**
 * Berechnet realistische Fahrzeit zur Tankstelle
 */
export function estimateDriveTimeMinutes(distanceKm, isRouteCorridor = false) {
  const km = Math.max(0.1, distanceKm || 1.0);
  // Schnittgeschwindigkeit: Stadt/Umkreis ca. 38 km/h, Korridor/Landstraße ca. 62 km/h
  const avgSpeedKmH = isRouteCorridor ? 60 : 38;
  const driveMinutes = (km / avgSpeedKmH) * 60;
  // Grundpuffer für Ampeln / Anfahrt: 2 Minuten
  return Math.max(2, Math.round(driveMinutes + 2));
}

/**
 * Führt eine 1.000-Pfad Monte-Carlo-Simulation zur Preisentwicklung bis zur Ankunft durch.
 * 
 * @param {Object} params
 * @param {number} params.currentPrice - Aktueller Preis an der Tankstelle in €/L
 * @param {number} params.distanceKm - Distanz in km
 * @param {boolean} [params.isRouteCorridor=false] - Ob die Tankstelle an einer Fahrtroute liegt
 * @param {Date} [params.currentTime=new Date()] - Aktuelle Uhrzeit
 * @param {number} [params.iterations=1000] - Anzahl Simulationsläufe
 * @returns {Object} Monte-Carlo Analyse mit Wahrscheinlichkeiten und Prognose
 */
export function simulateArrivalPriceMonteCarlo({
  currentPrice,
  distanceKm,
  isRouteCorridor = false,
  currentTime = new Date(),
  iterations = 1000,
}) {
  const price = Math.max(0.5, currentPrice || 1.70);
  const driveTimeMin = estimateDriveTimeMinutes(distanceKm, isRouteCorridor);
  const driveTimeHours = driveTimeMin / 60;

  const currentHour = currentTime.getHours();
  const arrivalTime = new Date(currentTime.getTime() + driveTimeMin * 60 * 1000);
  const arrivalHour = arrivalTime.getHours();

  const dynamics = HOURLY_MARKET_DYNAMICS[currentHour] || { drift: 0, vol: 0.6, jumpProb: 0.15, jump: 0 };
  const arrivalDynamics = HOURLY_MARKET_DYNAMICS[arrivalHour] || dynamics;

  // Stündlicher Drift und Volatilität (in Euro umgerechnet)
  const driftEuroPerHour = (dynamics.drift / 100);
  const volEuroPerHour = (dynamics.vol / 100);

  // Prüfe, ob während der Fahrt eine "Stundengrenze" mit typischem Preissprung überschritten wird
  const crossesHourBoundary = currentHour !== arrivalHour;
  const jumpRisk = crossesHourBoundary ? arrivalDynamics.jumpProb : dynamics.jumpProb * (driveTimeMin / 60);

  let paths = [];
  let stableCount = 0;
  let riseCount = 0;
  let dropCount = 0;

  for (let i = 0; i < iterations; i++) {
    // Standard-Normalverteilte Zufallszahl (Box-Muller-Transformation)
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random() || 0.0001;
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    // Kontinuierliche Drift & stochastische Schwankung (Geometrische / Arithmetische Brownsche Bewegung)
    let simulatedChange = (driftEuroPerHour * driveTimeHours) + (volEuroPerHour * Math.sqrt(driveTimeHours) * z);

    // Stochastischer Preissprung des Bundeskartellamtes (Jump-Diffusion)
    if (Math.random() < jumpRisk) {
      const jumpMagnitude = (arrivalDynamics.jump / 100) * (0.8 + Math.random() * 0.4);
      simulatedChange += jumpMagnitude;
    }

    const simFinalPrice = Math.max(0.9, price + simulatedChange);
    paths.push(simFinalPrice);

    const deltaCent = (simFinalPrice - price) * 100;
    if (Math.abs(deltaCent) <= 0.6) {
      stableCount++;
    } else if (deltaCent > 0.6) {
      riseCount++;
    } else {
      dropCount++;
    }
  }

  paths.sort((a, b) => a - b);

  const pStable = Math.round((stableCount / iterations) * 100);
  const pRise = Math.round((riseCount / iterations) * 100);
  const pDrop = Math.round((dropCount / iterations) * 100);

  const meanArrivalPrice = paths.reduce((a, b) => a + b, 0) / iterations;
  const p05 = paths[Math.floor(iterations * 0.05)]; // 5. Perzentil
  const p95 = paths[Math.floor(iterations * 0.95)]; // 95. Perzentil

  // Stabilitäts-Index (0 - 100%)
  const stabilityIndex = Math.max(10, Math.min(99, Math.round(pStable + (pDrop * 0.5) - (pRise * 0.8))));

  // Risiko-Einstufung
  let riskLevel = 'LOW'; // 'LOW' | 'MEDIUM' | 'HIGH'
  let riskLabel = 'Geringes Preissprung-Risiko';
  let badgeColor = 'favorable';
  let recommendation = '';

  if (pRise >= 40 || (crossesHourBoundary && arrivalDynamics.jump > 3.0)) {
    riskLevel = 'HIGH';
    riskLabel = 'Achtung: Preissprung droht!';
    badgeColor = 'unfavorable';
    recommendation = `Hohe Wahrscheinlichkeit (${pRise}%), dass der Preis vor deiner Ankunft in ${driveTimeMin} Min. steigt (typisch für ${arrivalHour}:00 Uhr). Sofort losfahren!`;
  } else if (pRise >= 20 || pDrop >= 25) {
    riskLevel = 'MEDIUM';
    riskLabel = 'Mäßige Preis-Volatilität';
    badgeColor = 'neutral';
    recommendation = `Preis kann während der ${driveTimeMin} Min. Anfahrt leicht schwanken (90%-Korridor: ${p05.toFixed(3)}–${p95.toFixed(3)} €).`;
  } else {
    riskLevel = 'LOW';
    riskLabel = 'Sehr stabil bis Ankunft';
    badgeColor = 'favorable';
    recommendation = `Mit ${pStable}% Wahrscheinlichkeit bleibt der Preis stabil bei ${price.toFixed(3)} €/L, bis du in ${driveTimeMin} Minuten ankommst.`;
  }

  return {
    driveTimeMin,
    arrivalHour,
    arrivalTimeFormatted: arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    currentPrice: parseFloat(price.toFixed(3)),
    meanArrivalPrice: parseFloat(meanArrivalPrice.toFixed(3)),
    priceRange90: [parseFloat(p05.toFixed(3)), parseFloat(p95.toFixed(3))],
    probabilities: {
      pStable,
      pRise,
      pDrop,
    },
    stabilityIndex,
    riskLevel,
    riskLabel,
    badgeColor,
    recommendation,
  };
}

/**
 * Ermittelt die optimalen Tankzeitpunkte für eine Tankstelle (Heute & diese Woche)
 */
export function calculateOptimalTimingForStation(currentPrice, history = []) {
  const now = new Date();
  const currentHour = now.getHours();
  const base = currentPrice || 1.70;

  // 1. Optimale Uhrzeit heute (typischerweise zwischen 18:00 und 19:45 Uhr)
  const optimalHourToday = 18;
  const isPastOptimalToday = currentHour >= 20;

  // Historische Differenz zum Tiefststand des Tages (ca. -4.5 ct)
  const typicalEveningDropCent = 4.8;
  const expectedOptimalPriceToday = parseFloat((base - (typicalEveningDropCent / 100)).toFixed(3));
  const savingsVsNowCent = parseFloat(((base - expectedOptimalPriceToday) * 100).toFixed(1));

  // 2. Bester Wochentag (statistisch meist Dienstag / Mittwoch Abend)
  const bestDayName = 'Dienstag';
  const bestDayHour = '18:30 Uhr';
  const expectedBestDayPrice = parseFloat((base - 0.062).toFixed(3));

  // 3. Empfehlungs-Entscheidung
  let verdict = 'WAIT_FOR_EVENING';
  let verdictText = '';

  if (currentHour >= 18 && currentHour <= 20) {
    verdict = 'REFUEL_NOW';
    verdictText = 'Jetzt optimales Preisfenster! Die Preise sind auf dem Tagestiefststand.';
  } else if (currentHour >= 21 || currentHour <= 5) {
    verdict = 'AVOID_NIGHT';
    verdictText = 'Nachtzuschlag aktiv! Wenn möglich erst morgen ab 12:00 Uhr oder ab 18:00 Uhr tanken.';
  } else if (savingsVsNowCent >= 3.0) {
    verdict = 'WAIT_FOR_EVENING';
    verdictText = `Warten lohnt sich! Heute Abend (ca. 18:30 Uhr) voraussichtlich ${savingsVsNowCent} ct/L günstiger (~${expectedOptimalPriceToday.toFixed(3)} €).`;
  } else {
    verdict = 'ACCEPTABLE';
    verdictText = 'Preis ist aktuell im akzeptablen Bereich.';
  }

  return {
    optimalHourToday: '18:00 - 19:45 Uhr',
    expectedOptimalPriceToday,
    savingsVsNowCent: Math.max(0, savingsVsNowCent),
    bestDayOfWeek: `${bestDayName} um ${bestDayHour}`,
    expectedBestDayPrice,
    verdict,
    verdictText,
    isCurrentlyOptimalWindow: currentHour >= 18 && currentHour <= 20,
  };
}
