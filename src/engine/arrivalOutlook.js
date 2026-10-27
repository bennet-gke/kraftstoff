/**
 * KRAFTSTOFF - Ankunfts-Ausblick
 *
 * Schätzt deterministisch (ohne Zufall), wie lange die Anfahrt zu einer Tankstelle dauert
 * und ob sich der Preis bis zur Ankunft laut Regionsprofil und aktueller Marktbewegung
 * voraussichtlich ändert. Gesetze (z.B. 12-Uhr-Regel) begrenzen das: Steigen kann der Preis nur, wenn bis
 * zur Ankunft eine Erhöhung erlaubt ist; Stichtags-Änderungen fließen in die erwartete Änderung ein.
 */

import { profileEstimateAt } from './regionalTrends';
import { DEFAULT_RULES, describeRuleState, increaseAllowedBetween, isIncreaseWindow, stepChangeCt } from './priceRules';

/**
 * Realistische Fahrzeit: Stadt/Umkreis ~38 km/h, Routen-Korridor ~60 km/h oder die Reisegeschwindigkeit
 * der geplanten Route (OSRM), plus 2 Minuten Puffer.
 */
export function estimateDriveTimeMinutes(distanceKm, isRouteCorridor = false, avgSpeedKmH = null) {
  const km = Math.max(0.1, Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : 1.0);
  const speed = Number.isFinite(avgSpeedKmH) && avgSpeedKmH > 10 ? avgSpeedKmH : isRouteCorridor ? 60 : 38;
  return Math.max(2, Math.round((km / speed) * 60 + 2));
}

function fmtDuration(min) {
  if (min < 60) return `~${min} Min.`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `~${h} Std. ${m} Min.` : `~${h} Std.`;
}

/**
 * @param {Object} p
 * @param {number} p.currentPrice
 * @param {number} p.distanceKm
 * @param {boolean} [p.isRouteCorridor]
 * @param {Object} [p.profile]  Regionsprofil (buildRegionalProfile)
 * @param {'UP'|'DOWN'|'NONE'} [p.wave]  aktuelle Marktbewegung in der Region
 * @param {number} [p.avgSpeedKmH]  Reisegeschwindigkeit (z.B. aus der OSRM-Route)
 * @param {number} [p.now]
 * @param {Object} [p.rules]  wirksame Gesetze (compileRules)
 */
export function buildArrivalOutlook({ currentPrice, distanceKm, isRouteCorridor = false, profile = null, wave = 'NONE', avgSpeedKmH = null, now = Date.now(), rules = DEFAULT_RULES }) {
  const driveTimeMin = estimateDriveTimeMinutes(distanceKm, isRouteCorridor, avgSpeedKmH);
  const dur = fmtDuration(driveTimeMin);
  const arrivalMs = now + driveTimeMin * 60 * 1000;
  const arrival = new Date(arrivalMs);
  const price = Number.isFinite(currentPrice) ? currentPrice : null;

  let expectedChangeCent = 0;
  let confidence = 0;
  if (profile) {
    const nowCell = profileEstimateAt(profile, now);
    const arrCell = profileEstimateAt(profile, arrivalMs);
    expectedChangeCent = Math.round((arrCell.est - nowCell.est) * 10) / 10;
    confidence = Math.round(((nowCell.conf + arrCell.conf) / 2) * 100) / 100;
  }

  // Gesetze: Stichtags-Änderungen bis zur Ankunft, Erhöhungen nur zur erlaubten Zeit
  const stepCt = stepChangeCt(rules, now, arrivalMs);
  if (stepCt) expectedChangeCent = Math.round((expectedChangeCent + stepCt) * 10) / 10;
  const rule = describeRuleState(rules, now);
  const canRise = !rule.active || increaseAllowedBetween(rules, now, arrivalMs) || isIncreaseWindow(rules, now);
  if (!canRise) expectedChangeCent = Math.min(expectedChangeCent, 0);
  const arrivalTime = arrival.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const ctText = (v) => Math.abs(v).toFixed(1).replace('.', ',');

  let outlook = 'STABLE';
  let label = 'Preis bis Ankunft stabil';
  let text = `In ${dur} bist du da. Ich erwarte bis dahin keine Preisänderung.`;

  if (wave === 'UP' && canRise) {
    outlook = 'RISING';
    label = 'Erhöhungswelle in der Region';
    text = rule.active && rule.inWindow
      ? `Mehrere Tankstellen haben zur erlaubten Zeit erhöht. Diese Station darf in den nächsten Minuten noch nachziehen – danach bis ${rule.nextLabel} nicht mehr.`
      : `Mehrere Tankstellen im Bereich haben gerade erhöht. Du brauchst ${dur} – fahr direkt los, diese Station könnte nachziehen.`;
  } else if (wave === 'DOWN') {
    outlook = 'FALLING';
    label = 'Senkungswelle in der Region';
    text = `Die Preise im Bereich sinken gerade. Bis zur Ankunft (${dur}) kann es hier noch günstiger werden.`;
  } else if (expectedChangeCent >= 1.0) {
    outlook = 'RISING';
    if (rule.active) {
      label = `Ab ${rule.slotLabel} dürfen die Preise steigen`;
      text = `Du kommst erst gegen ${arrivalTime} Uhr an – nach ${rule.nextLabel}. Dann ist eine Erhöhung erlaubt (${rule.name}), laut Regionsprofil ~${ctText(expectedChangeCent)} ct mehr als jetzt. Wenn es geht, vorher tanken.`;
    } else {
      label = 'Eher steigend bis Ankunft';
      text = `Du bist in ${dur} dort (gegen ${arrival.getHours()}:00 Uhr). Laut Regionsprofil ist diese Stunde typischerweise ~${ctText(expectedChangeCent)} ct teurer als jetzt.`;
    }
    if (stepCt >= 1) text += ` Darin enthalten: ${ctText(stepCt)} ct durch einen Gesetzes-Stichtag.`;
  } else if (expectedChangeCent <= -1.0) {
    outlook = 'FALLING';
    label = 'Eher fallend bis Ankunft';
    text = `Du bist in ${dur} dort (gegen ${arrival.getHours()}:00 Uhr). Laut Regionsprofil ist diese Stunde typischerweise ~${ctText(expectedChangeCent)} ct günstiger als jetzt.`;
    if (!canRise) text += ` Steigen darf der Preis bis dahin nicht (${rule.name}).`;
  } else if (rule.active && !canRise) {
    text = `In ${dur} bist du da. Bis dahin darf der Preis nicht steigen (${rule.name}).`;
  } else if (rule.active && canRise && !rule.inWindow) {
    text = `In ${dur} bist du da. Ich erwarte bis dahin keine große Änderung – beachte aber: um ${rule.slotLabel} dürfen die Preise steigen.`;
  }

  return {
    driveTimeMin,
    arrivalHour: arrival.getHours(),
    arrivalTimeFormatted: arrival.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    currentPrice: price,
    expectedChangeCent,
    expectedArrivalPrice: price !== null ? Math.round((price + expectedChangeCent / 100) * 1000) / 1000 : null,
    outlook,
    label,
    text,
    confidence,
    badgeColor: outlook === 'RISING' ? 'unfavorable' : outlook === 'FALLING' ? 'favorable' : 'favorable',
  };
}
