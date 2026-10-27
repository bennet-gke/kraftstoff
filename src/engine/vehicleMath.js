/**
 * KRAFTSTOFF - Fahrzeug-Kennzahlen (eine Quelle für Radar, Umwegrechner, Tankwart und Prognose)
 */

/** Zahl oder Ersatzwert (0 bleibt 0 – anders als bei "|| 20"). */
export function num(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Füllstand in Prozent (0–100), Standard 20 %. */
export function fuelLevelPct(vehicle) {
  return Math.min(100, Math.max(0, num(vehicle?.currentFuelLevelPct, 20)));
}

/** Benötigte Liter bis voll: 0 % Füllstand = ganzer Tank, 100 % = 0 Liter. */
export function neededLitersFor(vehicle) {
  if (!vehicle) return 40;
  const capacity = Math.max(1, num(vehicle.tankCapacityL, 50));
  return Math.round(capacity * (1 - fuelLevelPct(vehicle) / 100) * 10) / 10;
}

/** Reichweite in km mit dem aktuellen Tankinhalt. */
export function rangeKmFor(vehicle) {
  if (!vehicle) return 0;
  const capacity = Math.max(1, num(vehicle.tankCapacityL, 50));
  const consumption = Math.max(1, num(vehicle.consumptionL100km, 6.5));
  return Math.round(((capacity * fuelLevelPct(vehicle)) / 100 / consumption) * 100);
}
