/**
 * KRAFTSTOFF - Umweg- & Ersparnis-Rechner
 * 
 * Berechnet mathematisch präzise, ob sich die Fahrt zu einer günstigeren,
 * aber weiter entfernten Tankstelle wirtschaftlich lohnt.
 */

/**
 * @param {Object} params
 * @param {number} params.targetPrice - Preis an der Ziel-Tankstelle (€/L)
 * @param {number} params.targetDistanceKm - Distanz zur Ziel-Tankstelle (km)
 * @param {number} [params.basePrice] - Preis an der nächstgelegenen Tankstelle (€/L)
 * @param {number} [params.baseDistanceKm=0] - Distanz zur Basistankstelle (km)
 * @param {number} [params.fillLiters=40] - Zu tankende Kraftstoffmenge (Liter)
 * @param {number} [params.consumptionL100km=6.0] - Durchschnittsverbrauch des Fahrzeugs (L/100km)
 * @param {boolean} [params.isRoundtrip=true] - Hin- und Rückweg (true) oder Abstecher auf Route (false)
 * @param {string} [params.detourMode='local_roundtrip'] - 'local_roundtrip' (vom Ort aus) oder 'route_corridor' (an einer Strecke)
 * @param {number} [params.realAdditionalKm] - Exakter Mehrweg in km (z.B. Abstecher von der Route, hin und zurück)
 * @param {number} [params.baseAdditionalKm=0] - Abstecher der Vergleichsstation; gerechnet wird nur der Unterschied
 *   (kann negativ sein, wenn die Station näher an der Strecke liegt als die Vergleichsstation)
 * @param {number} [params.wearCostPerKm=0.08] - Zusätzliche Fahrzeug-Verschleißkosten (€/km, z.B. 0.08 €)
 * @returns {Object} Detaillierte Rentabilitäts-Rechnung
 */
const f1 = (v) => v.toFixed(1).replace('.', ',');
const f2 = (v) => v.toFixed(2).replace('.', ',');

export function calculateDetourProfitability({
  targetPrice,
  targetDistanceKm,
  basePrice = targetPrice, // ohne Vergleichsstation keine angenommene Preisdifferenz
  baseDistanceKm = 0,
  fillLiters = 40,
  consumptionL100km = 6.0,
  isRoundtrip = true,
  detourMode = 'local_roundtrip',
  realAdditionalKm = null,
  baseAdditionalKm = 0,
  wearCostPerKm = 0.05,
}) {
  const safeTargetPrice = Math.max(0.1, Number.isFinite(targetPrice) ? targetPrice : 1.7);
  const safeBasePrice = Math.max(0.1, Number.isFinite(basePrice) ? basePrice : safeTargetPrice);
  // 0 Liter (voller Tank) bleibt 0 – dann lohnt sich kein Umweg
  const safeLiters = Number.isFinite(fillLiters) ? Math.max(0, fillLiters) : 40;
  const safeConsumption = Math.max(1, Number.isFinite(consumptionL100km) ? consumptionL100km : 6.0);

  // 1. Berechnung des tatsächlichen Mehrwegs:
  // Option A: "An einer Strecke" (Korridor) -> Reale Zusatz-Kilometer durch Verlassen der Route
  // Option B: "Von einem Ort aus" (Sternfahrt) -> Hin- und Rückweg zur Tankstelle abzüglich Basistankstelle
  let totalDetourKm = 0;
  let oneWayExtraKm = 0;

  if (realAdditionalKm !== null && realAdditionalKm !== undefined) {
    const baseKm = Number.isFinite(baseAdditionalKm) ? Math.max(0, baseAdditionalKm) : 0;
    totalDetourKm = Math.max(0, realAdditionalKm) - baseKm;
    oneWayExtraKm = parseFloat((totalDetourKm / 2).toFixed(1));
  } else if (detourMode === 'route_corridor') {
    // Auf einer Route entspricht der Mehrweg typischerweise dem doppelten Abstand zur Fahrstrecke
    oneWayExtraKm = Math.max(0, targetDistanceKm || 0);
    totalDetourKm = parseFloat((oneWayExtraKm * 2).toFixed(1));
  } else {
    // Standard: Vom Ort aus (Hin- und Rückweg)
    oneWayExtraKm = Math.max(0, (targetDistanceKm || 0) - (baseDistanceKm || 0));
    totalDetourKm = isRoundtrip ? oneWayExtraKm * 2 : oneWayExtraKm;
  }

  // 2. Preisdifferenz pro Liter (positiv = Zieltankstelle ist günstiger)
  const priceDiffPerLiter = safeBasePrice - safeTargetPrice;
  const priceDiffCent = priceDiffPerLiter * 100;

  // 3. Brutto-Ersparnis an der Zapfsäule für die gesamte Tankfüllung
  const grossSavingsEuro = safeLiters * priceDiffPerLiter;

  // 4. Kraftstoffverbrauch für den Umweg
  const fuelUsedLiters = (totalDetourKm * safeConsumption) / 100;
  const fuelCostDetourEuro = fuelUsedLiters * safeTargetPrice;

  // 5. Verschleißkosten für den Umweg (Reifen, Bremsen, Wertverlust)
  const wearCostEuro = totalDetourKm * wearCostPerKm;

  // 6. Netto-Ersparnis (Reingewinn nach Sprit- und Verschleißkosten)
  const netSavingsEuro = grossSavingsEuro - fuelCostDetourEuro - wearCostEuro;

  // 7. Reiner Spritgewinn (ohne Verschleiß)
  const fuelOnlyNetSavingsEuro = grossSavingsEuro - fuelCostDetourEuro;

  // 8. Maximal lohnender Umweg (Break-Even-Distanz in km)
  // Ab wie vielen Kilometern Mehrweg kippt die Ersparnis ins Minus?
  const costPerKm = (safeConsumption / 100) * safeTargetPrice + wearCostPerKm;
  const maxDetourKm = costPerKm > 0 ? Math.max(0, grossSavingsEuro / costPerKm) : 0;

  // 9. Status & Bewertung
  let verdict = 'NEUTRAL';
  let verdictLabel = 'Kaum Unterschied';
  let badgeColor = 'neutral';
  let reasoning = '';
  const kmText = totalDetourKm >= 0 ? `${f1(totalDetourKm)} km Mehrweg` : `${f1(-totalDetourKm)} km weniger Umweg als die Vergleichsstation`;
  const travelCost = fuelCostDetourEuro + wearCostEuro;

  if (priceDiffPerLiter <= 0 && totalDetourKm > 0) {
    verdict = 'LOSS';
    verdictLabel = 'Lohnt sich nicht (Teurer & Weiter)';
    badgeColor = 'unfavorable';
    reasoning = `Preis ist gleich oder höher als an der Vergleichsstation, dazu ${kmText} (${f2(travelCost)} € Sprit & Verschleiß).`;
  } else if (netSavingsEuro > 1.20) {
    verdict = 'PROFIT';
    verdictLabel = 'Lohnt sich! (+ Ersparnis)';
    badgeColor = 'favorable';
    reasoning = totalDetourKm >= 0
      ? `Du sparst netto ${f2(netSavingsEuro)} € (Brutto: ${f2(grossSavingsEuro)} € abzüglich ${f2(travelCost)} € Sprit & Verschleiß für ${kmText}).`
      : `Du sparst netto ${f2(netSavingsEuro)} € – günstiger und dazu ${kmText}.`;
  } else if (netSavingsEuro >= 0.00) {
    verdict = 'MARGINAL';
    verdictLabel = 'Grenzfall (Minimale Ersparnis)';
    badgeColor = 'neutral';
    reasoning = totalDetourKm > 0
      ? `Geringer Netto-Gewinn von ${f2(netSavingsEuro)} €. Zeitaufwand und ${kmText} beachten.`
      : `Geringer Netto-Gewinn von ${f2(netSavingsEuro)} € (${kmText}).`;
  } else {
    verdict = 'LOSS';
    verdictLabel = 'Lohnt sich nicht (Verlust durch Mehrweg)';
    badgeColor = 'unfavorable';
    reasoning = `Der Umweg frisst die Ersparnis auf: Du zahlst ${f2(Math.abs(netSavingsEuro))} € drauf (${f2(travelCost)} € Sprit & Verschleiß für ${kmText}).`;
  }

  return {
    fillLiters: safeLiters,
    consumptionL100km: safeConsumption,
    basePrice: safeBasePrice,
    targetPrice: safeTargetPrice,
    priceDiffPerLiter: parseFloat(priceDiffPerLiter.toFixed(3)),
    priceDiffCent: parseFloat(priceDiffCent.toFixed(1)),
    totalDetourKm: parseFloat(totalDetourKm.toFixed(1)),
    oneWayExtraKm: parseFloat(oneWayExtraKm.toFixed(1)),
    grossSavingsEuro: parseFloat(grossSavingsEuro.toFixed(2)),
    fuelUsedLiters: parseFloat(fuelUsedLiters.toFixed(2)),
    fuelCostDetourEuro: parseFloat(fuelCostDetourEuro.toFixed(2)),
    wearCostEuro: parseFloat(wearCostEuro.toFixed(2)),
    netSavingsEuro: parseFloat(netSavingsEuro.toFixed(2)),
    fuelOnlyNetSavingsEuro: parseFloat(fuelOnlyNetSavingsEuro.toFixed(2)),
    maxDetourKm: parseFloat(maxDetourKm.toFixed(1)),
    isProfitable: netSavingsEuro > 0,
    verdict,
    verdictLabel,
    badgeColor,
    reasoning,
    formulaSummary: priceDiffPerLiter > 0
      ? `${f1(priceDiffCent)} ct/L günstiger × ${f1(safeLiters)} L = +${f2(grossSavingsEuro)} € an der Säule, ${travelCost >= 0 ? `abzüglich ${f2(travelCost)}` : `plus ${f2(-travelCost)}`} € Sprit & Verschleiß (${kmText}) = ${netSavingsEuro > 0 ? '+' : ''}${f2(netSavingsEuro)} € netto`
      : `${f1(Math.abs(priceDiffCent))} ct/L teurer, ${kmText} = ${netSavingsEuro >= 0 ? '+' : '−'}${f2(Math.abs(netSavingsEuro))} € ${netSavingsEuro >= 0 ? 'netto' : 'Mehrkosten'}`,
  };
}
