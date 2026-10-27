/**
 * Deutsche Zahlen- und Preisformate (Komma, echtes Minuszeichen) – einheitlich in der ganzen App.
 */

export const FUEL_LABELS = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };

export function fuelLabel(fuel) {
  return FUEL_LABELS[fuel] || String(fuel || '').toUpperCase();
}

/** Zahl mit fester Nachkommastelle, deutsches Komma, "−" statt "-"; ungültig → "–". */
export function fmtNum(value, digits = 1) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '–';
  const abs = Math.abs(n).toFixed(digits);
  const isZero = Number(abs) === 0;
  return `${n < 0 && !isZero ? '−' : ''}${abs.replace('.', ',')}`;
}

/** Mit Vorzeichen (+1,2 / −0,8 / 0,0). */
export function fmtSigned(value, digits = 1) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '–';
  if (Number(Math.abs(n).toFixed(digits)) === 0) return fmtNum(0, digits);
  return `${n > 0 ? '+' : '−'}${fmtNum(Math.abs(n), digits)}`;
}

/** Literpreis "1,749 €". */
export function fmtPrice(value) {
  return Number.isFinite(Number(value)) && value !== null ? `${fmtNum(value, 3)} €` : '–';
}

/** Geldbetrag "12,40 €". */
export function fmtEuro(value) {
  return Number.isFinite(Number(value)) && value !== null ? `${fmtNum(value, 2)} €` : '–';
}

/** Cent-Differenz mit Vorzeichen "+1,2 ct". */
export function fmtCt(value, digits = 1) {
  return `${fmtSigned(value, digits)} ct`;
}

/** Kilometer: unter 10 km mit einer Nachkommastelle, sonst gerundet. */
export function fmtKm(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '–';
  return `${n < 10 ? fmtNum(n, 1) : Math.round(n)} km`;
}

/** Dauer in Minuten → "45 Min." / "1 Std. 20 Min.". */
export function fmtDuration(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} Min.`;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

/** Uhrzeit "14:05". */
export function fmtClock(t) {
  if (!t) return '';
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Wochentag + Datum + Uhrzeit "Di., 27.10., 14:05". */
export function fmtDayTime(t) {
  if (!t) return '';
  return new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** "vor 5 Min." / "vor 1 Std. 20 Min." */
export function agoText(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `vor ${h} Std. ${rest} Min.` : `vor ${h} Std.`;
}

/** Zeitangabe einer Preisänderung: exakt oder – nach einer App-Pause – als Zeitraum. */
export function moveTimeText(move) {
  if (!move) return '';
  if (move.timingKnown) return agoText(move.minutesAgo);
  return `zwischen ${fmtClock(move.fromT)} und ${fmtClock(move.toT)} Uhr`;
}
