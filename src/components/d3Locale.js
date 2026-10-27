import * as d3 from 'd3';
import { fmtNum, fmtSigned } from '../utils/format';

/** Deutsche Zeitformatierung für D3-Achsen. */
export const deTime = d3.timeFormatLocale({
  dateTime: '%A, der %e. %B %Y, %X',
  date: '%d.%m.%Y',
  time: '%H:%M:%S',
  periods: ['AM', 'PM'],
  days: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  shortDays: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  shortMonths: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
});

/** Tick-Format für Zeitachsen: nur Uhrzeit bei ≤ 24 h, bis 4 Tage Wochentag + Uhrzeit, sonst Datum. */
export function timeTickFormat(spanHours) {
  if (spanHours <= 24) return deTime.format('%H:%M');
  if (spanHours <= 96) return deTime.format('%a %H:%M');
  return deTime.format('%a %d.%m.');
}

/** Tick-Format für Preisachsen: drei Nachkommastellen bei sehr kleiner Spanne. */
export function euroTickFormat(spanEuro) {
  const digits = spanEuro < 0.06 ? 3 : 2;
  return (d) => `${fmtNum(d, digits)} €`;
}

/** Tick-Format für relative Cent-Werte. */
export function ctTickFormat() {
  return (d) => `${fmtSigned(d, 1)} ct`;
}

/** Gemeinsame Achsen-Optik. */
export function styleAxis(sel, { color = '#64748B', size = '10.5px' } = {}) {
  sel.selectAll('text').attr('fill', color).attr('font-size', size);
  sel.selectAll('.domain').attr('stroke', '#E2E8F0');
  sel.selectAll('.tick line').attr('stroke', '#E2E8F0');
  return sel;
}
