/**
 * KRAFTSTOFF - Der weise Tankwart (Beratungs-Engine)
 *
 * Verbindet alle Signale zu einer klaren Empfehlung: WO und WANN tanken?
 *  - Querschnitt: Wie steht jede Station JETZT gegen den Regionsschnitt? (funktioniert ab Minute 1)
 *  - Zeitreihe:   Liegt die Station unter dem, was sie um diese Uhrzeit üblicherweise kostet?
 *  - Regionsprofil: Ist gerade eine teure oder günstige Phase, wann kommt das nächste Tief?
 *  - Marktbewegung: Läuft eine Erhöhungs- oder Senkungswelle (nur mit bekanntem Zeitpunkt)?
 *  - Fahrzeug: Restreichweite, Tankbedarf, tägliche Fahrstrecke.
 *  - Umwegrechner: Was kostet die Fahrt zur Station wirklich?
 *  - Gesetze (Bereich "Gesetze"): Erhöhungszeiten wie die 12-Uhr-Regel und Stichtags-Änderungen setzen
 *    den Empfehlungen Grenzen, ersetzen aber keine Mechanik (Warten heute / in ein paar Tagen bleibt).
 * Aussagen werden an die Datenlage gekoppelt: wenig Daten = vorsichtige Formulierung, geringe Verlässlichkeit.
 */

import { describeWindowTime, describeWindowRange, DAY_NAMES, toMondayIndex } from './regionalTrends';
import { neededLitersFor, fuelLevelPct, rangeKmFor, num } from './vehicleMath';
import { DEFAULT_RULES, describeRuleState, isIncreaseWindow, stepChangeCt, upcomingSteps, describeStepEvent } from './priceRules';

/** Kosten einer Tankfüllung inkl. Anfahrt (Sprit + Verschleiß für den Umweg). */
export function totalFillCost(station, liters) {
  const detourCost = (station?.detour?.fuelCostDetourEuro || 0) + (station?.detour?.wearCostEuro || 0);
  return station.currentPrice * liters + detourCost;
}

/**
 * Stationen nach Gesamtkosten der Tankfüllung (geöffnete mit Preis), günstigste zuerst.
 * Grundlage für "Wo tanken?" – Tankwart-Empfehlung und Sortierung "Empfehlung" nutzen dieselbe Rechnung.
 */
export function rankByFillCost(stations, liters) {
  return (stations || [])
    .filter((s) => s && Number.isFinite(s.currentPrice) && s.isOpen !== false)
    .map((s) => {
      const detourCost = (s.detour?.fuelCostDetourEuro || 0) + (s.detour?.wearCostEuro || 0);
      return { station: s, totalCost: s.currentPrice * liters + detourCost, detourCost };
    })
    .sort((a, b) => a.totalCost - b.totalCost || a.station.currentPrice - b.station.currentPrice);
}

/**
 * Transparenter Empfehlungs-Score 1..100 für eine Station.
 * Rangiert Stationen untereinander (Querschnitt + eigene, uhrzeitbereinigte Historie + Umweg).
 */
export function scoreStation({ station, regionNow, evaluation, detour }) {
  let s = 50;
  const price = station?.currentPrice;
  const reasons = [];

  const hasDetour = !!detour && Number.isFinite(detour.netSavingsEuro);

  // Preisniveau gegenüber der Region. Mit Umwegrechnung nur schwach gewichtet: entscheidend ist,
  // was nach Sprit- und Verschleißkosten für die Anfahrt übrig bleibt.
  if (regionNow?.median && Number.isFinite(price)) {
    const dReg = (price - regionNow.median) * 100;
    const contrib = hasDetour ? Math.max(-10, Math.min(10, -dReg * 2)) : Math.max(-28, Math.min(28, -dReg * 5));
    s += contrib;
    if (dReg <= -1) reasons.push(`${fmtCt(Math.abs(dReg))} unter Regionsschnitt`);
    else if (dReg >= 1) reasons.push(`${fmtCt(dReg)} über Regionsschnitt`);
  }

  if (evaluation?.hasHistory) {
    const contrib = Math.max(-12, Math.min(12, -evaluation.deltaCent * 2.5));
    s += contrib;
    if (evaluation.deltaCent <= -2) reasons.push('günstiger als sonst um diese Uhrzeit');
    else if (evaluation.deltaCent >= 2) reasons.push('teurer als sonst um diese Uhrzeit');
  }

  // Netto-Ersparnis der Tankfüllung nach Umweg (je Euro ca. 8 Punkte)
  if (hasDetour) {
    s += Math.max(-20, Math.min(20, detour.netSavingsEuro * 8));
    if (detour.netSavingsEuro >= 0.5) reasons.push(`lohnt sich: ${fmtEuro(detour.netSavingsEuro)} netto`);
    else if (detour.netSavingsEuro <= -0.5) reasons.push(`der Umweg kostet ${fmtEuro(Math.abs(detour.netSavingsEuro))} mehr, als die Füllung spart`);
  }

  if (station?.isOpen === false) {
    s = s * 0.4;
    reasons.push('derzeit geschlossen');
  }

  const score = Math.max(1, Math.min(100, Math.round(s)));
  let label = 'Mittelfeld';
  let badgeClass = 'neutral';
  if (score >= 75) { label = 'Top-Wahl'; badgeClass = 'favorable'; }
  else if (score >= 58) { label = 'Gute Wahl'; badgeClass = 'favorable-subtle'; }
  else if (score < 40) { label = 'Eher nicht'; badgeClass = 'unfavorable'; }

  return { score, label, badgeClass, reasons };
}

function fmtEuro(v) {
  return `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} €`;
}

function fmtCt(v) {
  return `${(Math.round(v * 10) / 10).toFixed(1).replace('.', ',')} ct`;
}

function fmtPrice(v) {
  return `${Number(v).toFixed(3).replace('.', ',')} €`;
}

function fmtDays(v) {
  return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
}

function whereText(st) {
  if (st?.isOnRouteCorridor && Number.isFinite(st.kmAlongRoute)) return `bei km ${Math.round(st.kmAlongRoute)} der Strecke`;
  if (Number.isFinite(st?.distanceKm)) return `${String(st.distanceKm).replace('.', ',')} km entfernt`;
  return '';
}

/**
 * Kernfunktion: Erzeugt die Tankwart-Empfehlung.
 *
 * @param {Object} p
 * @param {Array} p.stations      bewertete Stationen (mit currentPrice, isOpen, evaluation, detour, distanceKm)
 * @param {Object} p.regionNow    summarizeRegionNow(...)
 * @param {Object} p.profile      buildRegionalProfile(...)
 * @param {Object} p.windows      findBestWindows(...)
 * @param {Object} p.moves        detectRecentPriceMoves(...)
 * @param {Object} p.vehicle      aktives Fahrzeug
 * @param {Object} p.settings     Nutzereinstellungen (dailyCommuteKm)
 * @param {number} [p.liters]     Tankmenge (z.B. manuell überschrieben); sonst aus dem Fahrzeug
 * @param {number} [p.now]
 * @param {Object} [p.forecast]   optionale 24h-Prognose der besten Station (forecastStationCurve)
 * @param {Object} [p.trip]       laufende Fahrt { remainingKm, durationMin }
 * @param {Object} [p.rules]      wirksame Gesetze (compileRules)
 */
export function buildTankwartAdvice({ stations = [], regionNow, profile, windows, moves, vehicle, settings, liters: litersOverride = null, now = Date.now(), forecast = null, trip = null, rules = DEFAULT_RULES }) {
  const cap = Math.max(1, num(vehicle?.tankCapacityL, 50));
  const level = fuelLevelPct(vehicle);
  const cons = Math.max(1, num(vehicle?.consumptionL100km, 6.5));
  const liters = Math.max(1, Math.round(Number.isFinite(litersOverride) && litersOverride > 0 ? litersOverride : neededLitersFor(vehicle)));
  const rangeKm = rangeKmFor(vehicle);
  const reserveKm = Math.round(((cap * 0.1) / cons) * 100);
  const usableKm = Math.max(0, rangeKm - reserveKm);
  const dailyKm = Math.max(5, num(settings?.dailyCommuteKm, 30));
  const daysOfRange = Math.round((usableKm / dailyKm) * 10) / 10;
  const waitHours = Math.max(0, daysOfRange * 24);

  const base = {
    liters,
    rangeKm,
    usableKm,
    daysOfRange,
    dailyKm,
    vehicleName: vehicle?.name || 'Dein Fahrzeug',
    reasons: [],
    confidence: { value: 0, label: 'gering' },
    dataNote: '',
  };

  // Datenbasis beschreiben
  const distinctDays = profile?.distinctDays || 0;
  if (profile && profile.totalSamples > 0) {
    base.dataNote = `Datenbasis: ${profile.stationsUsed} Tankstellen, ${profile.totalSamples.toLocaleString('de-DE')} Stundenwerte an ${distinctDays} ${distinctDays === 1 ? 'Tag' : 'Tagen'}`;
    if (profile.dataQuality === 'thin') base.dataNote += ' – noch dünn, ich lerne bei jedem Öffnen der App dazu.';
  } else {
    base.dataNote = 'Noch keine eigenen Messdaten – ich arbeite mit Erfahrungswerten des deutschen Marktes und lerne ab jetzt bei jedem Öffnen der App dazu.';
  }

  const priced = stations.filter((s) => s && Number.isFinite(s.currentPrice));
  const open = priced.filter((s) => s.isOpen !== false);

  if (priced.length === 0) {
    return {
      ...base,
      verdict: 'NO_STATIONS',
      title: 'Keine Tankstellen im Bereich',
      summary: 'Ich habe im gewählten Bereich keine Tankstellen mit Preisen gefunden. Vergrößere den Radius oder wähle einen anderen Ort bzw. eine Route.',
      bestStation: null,
      alternativeStation: null,
      bestWindow: null,
      expectedSavingsEuro: 0,
    };
  }

  if (open.length === 0) {
    return {
      ...base,
      verdict: 'NO_OPEN',
      title: 'Alle Tankstellen gerade geschlossen',
      summary: `Alle ${priced.length} Tankstellen im Bereich sind laut MTS-K derzeit geschlossen. Die angezeigten Preise sind die zuletzt gemeldeten – schau nach Öffnung noch einmal rein.`,
      bestStation: [...priced].sort((a, b) => a.currentPrice - b.currentPrice)[0],
      alternativeStation: null,
      bestWindow: null,
      expectedSavingsEuro: 0,
    };
  }

  // WO: minimale Gesamtkosten dieser Tankfüllung inkl. Anfahrt
  const costed = rankByFillCost(open, liters);

  const best = costed[0].station;
  const bestDetourCost = costed[0].detourCost;
  const alternative = costed.find((c) => c.station.id !== best.id)?.station || null;
  const bestVsRegionCt = regionNow?.median ? (best.currentPrice - regionNow.median) * 100 : 0;
  // Ersparnis gegenüber dem Regionsschnitt, abzüglich der Umwegkosten zur besten Station
  const bestVsMedianEuro = regionNow?.median ? (regionNow.median - best.currentPrice) * liters - bestDetourCost : 0;

  const reasons = [];

  // Reichweite
  reasons.push({
    icon: 'range',
    text: `${base.vehicleName}: ca. ${rangeKm} km Restreichweite (${Math.round(level)} %), Tankbedarf ${liters} L. Bei ${dailyKm} km/Tag reicht das noch etwa ${fmtDays(daysOfRange)} Tage.`,
  });

  // Querschnitt
  if (regionNow?.median) {
    const dir = bestVsRegionCt <= 0 ? 'unter' : 'über';
    const saving = bestVsMedianEuro > 0.05
      ? ` Gegenüber dem Regionsschnitt sparst du rund ${fmtEuro(bestVsMedianEuro)} pro Füllung${bestDetourCost > 0.05 ? ' (Umweg schon abgezogen)' : ''}.`
      : '';
    reasons.push({
      icon: 'price',
      text: `${best.name} ist mit ${fmtPrice(best.currentPrice)} die günstigste Gesamtlösung (${fmtCt(Math.abs(bestVsRegionCt))} ${dir} dem Regionsschnitt von ${fmtPrice(regionNow.median)}).${saving}`,
    });
  }

  // Zeitliche Lage laut Profil. Stichtags-Gesetze (Steuer, Abgabe) verschieben das erwartete Niveau ab dem Stichtag.
  const nowRel = windows?.nowRel ?? 0;
  const hasSteps = (rules?.steps?.length || 0) > 0;
  const points = (windows?.points || []).map((p) => (hasSteps ? { ...p, est: p.est + stepChangeCt(rules, now, p.t) } : p));
  const pickMin = (arr) => arr.reduce((b, p) => (b === null || p.est < b.est ? p : b), null);
  const hoursLeftToday = 23 - new Date(now).getHours();
  const todayCand = hasSteps ? pickMin(points.filter((p) => p.hoursAhead >= 1 && p.hoursAhead <= hoursLeftToday)) : windows?.todayMin || null;
  const horizonCand = hasSteps ? pickMin(points.filter((p) => p.hoursAhead >= 1)) : windows?.horizonMin || null;
  const reachable = (pt) => pt && pt.hoursAhead <= waitHours;
  const todayMin = reachable(todayCand) ? todayCand : null;
  let horizonMin = reachable(horizonCand) ? horizonCand : null;
  if (!horizonMin && points.length > 0) {
    horizonMin = pickMin(points.filter((p) => p.hoursAhead >= 1 && p.hoursAhead <= waitHours));
  }
  const todaySaveCt = todayMin ? nowRel - todayMin.est : 0;
  const horizonSaveCt = horizonMin ? nowRel - horizonMin.est : 0;
  const todaySaveEuro = (todaySaveCt * liters) / 100;
  const horizonSaveEuro = (horizonSaveCt * liters) / 100;

  // Verlässlichkeit: Konfidenz der Profilzellen (nach Beobachtungstagen), gedeckelt durch die Datenlage
  const confTarget = (todayMin || horizonMin)?.conf ?? 0;
  let confValue = Math.round((((windows?.nowConf ?? 0) + confTarget) / 2) * 100) / 100;
  if (!profile || profile.dataQuality === 'none') confValue = Math.min(confValue, 0.15);
  else if (profile.dataQuality === 'thin') confValue = Math.min(confValue, 0.45);
  base.confidence = {
    value: confValue,
    label: confValue < 0.3 ? (!profile || profile.dataQuality === 'none' ? 'gering (Erfahrungswerte)' : 'gering') : confValue < 0.6 ? 'mittel' : 'hoch',
  };

  // Marktbewegung (nur Änderungen mit bekanntem Zeitpunkt)
  const wave = moves?.wave || 'NONE';
  const bestRaisedRecently = moves?.moves?.some((m) => m.stationId === best.id && m.direction === 'UP' && m.timingKnown !== false && m.minutesAgo <= 60);
  // Schnäppchen nur gegenüber dem, was die Station um diese Uhrzeit üblicherweise kostet
  const bargain = !!best.evaluation?.hasHistory && best.evaluation.deltaCent <= -2.5;

  // Gesetze: Erhöhungs-Regel (z.B. 12-Uhr-Regel) – andere Stationen können nur zur erlaubten Zeit nachziehen
  const ruleState = describeRuleState(rules, now);
  const restricted = ruleState.active;
  const waveCanSpread = wave === 'UP' && (!restricted || isIncreaseWindow(rules, now));
  if (wave === 'UP' && restricted && moves?.ruleWave) {
    reasons.push({ icon: 'wave', text: `Erhöhung zur erlaubten Zeit: ${moves.ups} von ${moves.considered} Tankstellen haben gerade erhöht (${ruleState.name}: ${ruleState.timesLabel}).${waveCanSpread ? (bestRaisedRecently ? '' : ` ${best.name} hat noch nicht erhöht – das darf sie nur noch in den nächsten Minuten.`) : ` Bis ${ruleState.nextLabel} dürfen sie nur noch senken.`}` });
  } else if (wave === 'UP') {
    reasons.push({ icon: 'wave', text: `Achtung: ${moves.ups} von ${moves.considered} Tankstellen im Bereich haben in den letzten 90 Minuten erhöht.${waveCanSpread ? ` Eine Erhöhungswelle läuft.${bestRaisedRecently ? '' : ` ${best.name} hat noch nicht nachgezogen.`}` : ` Außerhalb von ${ruleState.timesLabel} ist das laut ${ruleState.name} nicht erlaubt.`}` });
  } else if (wave === 'DOWN') {
    reasons.push({ icon: 'wave', text: `${moves.downs} von ${moves.considered} Tankstellen haben in den letzten 90 Minuten gesenkt – die Preise in der Region sind gerade im Sinkflug.` });
  }
  if (bargain) {
    reasons.push({ icon: 'bargain', text: `${best.name} liegt gerade ${fmtCt(Math.abs(best.evaluation.deltaCent))} unter dem, was sie um diese Uhrzeit sonst kostet.` });
  }

  if (restricted) {
    reasons.push({ icon: 'rule', text: `${ruleState.name}: ${ruleState.text}` });
  }
  // Gesetze mit Stichtag (Steuer, Abgabe, Rabatt) in Reichweite
  const stepEvents = upcomingSteps(rules, now, Math.max(72, waitHours) * 60 * 60 * 1000);
  for (const ev of stepEvents.slice(0, 2)) {
    reasons.push({ icon: 'rule', text: `${ev.law.name}: ${describeStepEvent(ev, now)}` });
  }
  const stepUp = stepEvents.find((ev) => ev.ct >= 1 && ev.at - now <= waitHours * 60 * 60 * 1000) || null;

  const phase = windows?.phase || 'MITTEL';
  const phaseText = phase === 'TEUER' ? 'in einer teuren Phase' : phase === 'GÜNSTIG' ? 'in einer günstigen Phase' : 'im Mittelfeld ihres Tagesverlaufs';
  reasons.push({
    icon: 'trend',
    text: `Die Region ist gerade ${phaseText}${profile?.amplitudeCt ? ` (typische Tagesschwankung hier: ~${fmtCt(profile.amplitudeCt)})` : ''}.`,
  });

  // Hinweis zum Warten unter einer Erhöhungs-Regel: risikolos bis zur nächsten erlaubten Erhöhung
  const waitRuleNote = (target) => {
    if (!restricted || !target || !ruleState.nextIncreaseMs) return '';
    if (target.t < ruleState.nextIncreaseMs) return ` Bis ${ruleState.nextLabel} dürfen die Preise nur fallen (${ruleState.name}) – das Warten ist ohne Risiko.`;
    return ` Dazwischen liegt ${ruleState.nextLabel}: Dann dürfen die Preise steigen (${ruleState.name}). Die Ersparnis ist eine Erwartung aus dem Tagesverlauf.`;
  };

  // Entscheidung
  let verdict = 'FILL_NOW';
  let title = '';
  let summary = '';
  let bestWindow = null;
  let bestWindowText = null;
  let expectedSavingsEuro = 0;

  const minMeaningfulToday = Math.max(1.0, 0.015 * liters);
  const minMeaningfulDays = Math.max(2.0, 0.03 * liters);
  // Mehrtägiges Warten nur, wenn der Ziel-Wochentag wirklich beobachtet wurde
  const horizonDayResolved = !!(horizonMin && profile?.resolvedWeekdays?.includes(horizonMin.dayIndex) && (horizonMin.days || 0) >= 2);
  // ... oder ein Stichtags-Gesetz senkt den Preis bis dahin spürbar
  const horizonStepCt = horizonMin && hasSteps ? stepChangeCt(rules, now, horizonMin.t) : 0;

  if (rangeKm <= 50 || daysOfRange < 0.5) {
    verdict = 'URGENT';
    title = 'Jetzt tanken – die Reserve ist erreicht';
    summary = `Mit ${rangeKm} km Restreichweite würde ich nicht mehr auf bessere Preise warten. Am günstigsten kommst du bei ${best.name} weg (${fmtPrice(best.currentPrice)}, ${whereText(best)}).`;
  } else if (trip) {
    // Laufende Fahrt: entscheidend ist der beste Stopp auf dieser Strecke, nicht ein späterer Zeitpunkt
    verdict = 'TRIP';
    const remaining = Math.max(0, Number(trip.remainingKm) || 0);
    const reaches = usableKm > remaining * 1.1;
    title = reaches ? 'Der Tank reicht bis zum Ziel' : `Unterwegs tanken: ${best.name}`;
    summary = reaches
      ? `Mit ${rangeKm} km Reichweite kommst du ohne Stopp an. Wenn du trotzdem tankst, ist ${best.name} die günstigste Gesamtlösung auf der Strecke (${fmtPrice(best.currentPrice)}, ${whereText(best)}).`
      : `Auf dieser Fahrt ist ${best.name} die günstigste Gesamtlösung (${fmtPrice(best.currentPrice)}, ${whereText(best)}). Mit ${rangeKm} km Reichweite solltest du unterwegs tanken.`;
    if (restricted && ruleState.nextIncreaseMs && trip.durationMin && now + trip.durationMin * 60000 > ruleState.nextIncreaseMs) {
      summary += ` Die Fahrt geht über ${ruleState.nextLabel} – dann dürfen die Preise steigen (${ruleState.name}), also besser vorher tanken.`;
    }
  } else if (waveCanSpread && !bestRaisedRecently) {
    verdict = 'FILL_NOW';
    title = 'Jetzt losfahren – bevor die Welle ankommt';
    summary = `In der Region wird gerade erhöht, ${best.name} ist noch günstig (${fmtPrice(best.currentPrice)}). Warten kann dich hier ein paar Cent pro Liter kosten.`;
  } else if (bargain && todaySaveEuro < 2.0) {
    verdict = 'FILL_NOW';
    title = 'Zugreifen – ungewöhnlich günstig';
    summary = `${best.name} ist gerade günstiger als sonst um diese Uhrzeit. Auf ein späteres Tief zu warten brächte heute voraussichtlich nur noch ${fmtEuro(Math.max(0, todaySaveEuro))}.`;
  } else if (todayMin && todaySaveEuro >= minMeaningfulToday) {
    verdict = 'FILL_LATER_TODAY';
    bestWindow = todayMin;
    expectedSavingsEuro = todaySaveEuro;
    const nw = windows?.nextWindow;
    const useRange = !!(nw && nw.start.hoursAhead >= 1 && nw.start.hoursAhead <= todayMin.hoursAhead && nw.end.hoursAhead >= todayMin.hoursAhead);
    bestWindowText = useRange ? describeWindowRange(nw.start, nw.end, now) : describeWindowTime(todayMin, now);
    const windowText = useRange ? `${nw.start.hour}:00–${(nw.end.hour + 1) % 24}:00 Uhr` : `gegen ${todayMin.hour}:00 Uhr`;
    title = `Noch nicht – heute ${windowText} wird es günstiger`;
    summary = `Die Region ist gerade ${phaseText}. Heute ${windowText} erwarte ich etwa ${fmtCt(todaySaveCt)} weniger pro Liter – bei ${liters} L sind das rund ${fmtEuro(todaySaveEuro)}. Dein Tank reicht dafür locker (${rangeKm} km).${waitRuleNote(todayMin)}`;
  } else if (horizonMin && horizonMin.hoursAhead > 12 && (horizonDayResolved || horizonStepCt <= -1) && daysOfRange >= 2 && horizonSaveEuro >= minMeaningfulDays) {
    verdict = 'WAIT_DAYS';
    bestWindow = horizonMin;
    bestWindowText = describeWindowTime(horizonMin, now);
    expectedSavingsEuro = horizonSaveEuro;
    const dayName = DAY_NAMES[toMondayIndex(new Date(horizonMin.t).getDay())];
    title = `Lass den Tank noch zu – ${describeWindowTime(horizonMin, now)} ist günstiger`;
    if (horizonStepCt <= -1) {
      const lead = horizonDayResolved
        ? `${dayName} gegen ${horizonMin.hour}:00 Uhr ist es in deiner Region am günstigsten, und laut deinen Gesetzes-Einträgen`
        : 'Laut deinen Gesetzes-Einträgen';
      summary = `Du kommst noch etwa ${fmtDays(daysOfRange)} Tage weit. ${lead} wird es bis dahin um etwa ${fmtCt(-horizonStepCt)} günstiger – zusammen rund ${fmtCt(horizonSaveCt)} unter jetzt, also ${fmtEuro(horizonSaveEuro)} bei ${liters} L.`;
    } else {
      summary = `Du kommst noch etwa ${fmtDays(daysOfRange)} Tage weit. In deiner Region war es bisher ${dayName} gegen ${horizonMin.hour}:00 Uhr am günstigsten – etwa ${fmtCt(horizonSaveCt)} unter jetzt, also rund ${fmtEuro(horizonSaveEuro)} bei ${liters} L.`;
    }
    summary += waitRuleNote(horizonMin);
  } else {
    verdict = 'FILL_NOW';
    // Kurz vor der nächsten erlaubten Erhöhung (z.B. 12 Uhr): der wichtigste Grund ist der bevorstehende Sprung
    const nextInc = restricted ? ruleState.nextIncreaseMs : null;
    const jumpAhead = nextInc ? points.find((p) => p.hoursAhead >= 1 && p.t >= nextInc) : null;
    const expectedJumpCt = jumpAhead ? jumpAhead.est - nowRel : 0;
    if (restricted && ruleState.nextToday && ruleState.minutesToNext <= 120 && expectedJumpCt >= 3) {
      title = `Jetzt tanken – um ${ruleState.slotLabel} dürfen die Preise steigen`;
    } else if (stepUp) {
      title = 'Jetzt tanken – bald wird es teurer';
    } else {
      title = 'Jetzt ist ein guter Moment';
    }
    let waitNote;
    const unreachableMin = horizonCand && horizonCand.hoursAhead > waitHours ? horizonCand : null;
    if (todayMin && todaySaveCt > 0.3 && todaySaveEuro < minMeaningfulToday) {
      waitNote = `Warten brächte heute voraussichtlich nur noch ${fmtCt(todaySaveCt)} pro Liter (${fmtEuro(todaySaveEuro)}) – das lohnt den Aufwand kaum.`;
    } else if (unreachableMin && nowRel - unreachableMin.est >= 1) {
      waitNote = `Ein günstigeres Fenster käme erst ${describeWindowTime(unreachableMin, now)} – so lange reicht der Tank nicht sicher.`;
    } else {
      waitNote = 'Laut Regionsprofil wird es in den nächsten Stunden eher nicht günstiger.';
    }
    summary = `${best.name} liegt ${fmtCt(Math.abs(bestVsRegionCt))} ${bestVsRegionCt <= 0 ? 'unter' : 'über'} dem Schnitt der Region. ${waitNote}`;
    if (stepUp) summary += ` ${stepUp.law.name}: ${describeStepEvent(stepUp, now)}`;
  }

  // KI-Prognose der besten Station einbinden, wenn vorhanden
  if (forecast && forecast.lowest && forecast.lowest.hoursAhead >= 1 && forecast.sourceLabel) {
    const diffCt = (best.currentPrice - forecast.lowest.price) * 100;
    if (Math.abs(diffCt) >= 0.5) {
      reasons.push({
        icon: 'ai',
        text: `${forecast.sourceLabel}: Für ${best.name} wird das 24h-Tief ${describeWindowTime(forecast.lowest, now)} bei ca. ${fmtPrice(forecast.lowest.price)} erwartet (${diffCt > 0 ? '−' : '+'}${fmtCt(Math.abs(diffCt))} gegenüber jetzt).`,
      });
    }
  }

  return {
    ...base,
    verdict,
    title,
    summary,
    reasons,
    bestStation: best,
    alternativeStation: alternative,
    bestWindow,
    bestWindowLabel: bestWindowText || (bestWindow ? describeWindowTime(bestWindow, now) : null),
    expectedSavingsEuro: Math.round(expectedSavingsEuro * 100) / 100,
    bestVsRegionCt: Math.round(bestVsRegionCt * 10) / 10,
    bestVsMedianEuro: Math.round(bestVsMedianEuro * 100) / 100,
    wave,
    phase,
  };
}
