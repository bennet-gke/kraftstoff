/**
 * KRAFTSTOFF - Gesetzliche Preisregeln (Regelwerk)
 *
 * Gesetze ändern sich – deshalb sind die Regeln keine feste Programmlogik, sondern gespeicherte Einträge
 * (Bereich "Gesetze" mit dem Waagen-Symbol). Sie lassen sich ein- und ausschalten, ändern und ergänzen
 * und werden wie Fahrzeuge und Routen in der Datenbank-Datei abgeglichen.
 *
 * Zwei Arten von Regeln:
 *  - 'increase-times': Preiserhöhungen nur zu festen Uhrzeiten, Senkungen jederzeit.
 *    Beispiel: 12-Uhr-Regel des Kraftstoffpreisanpassungsgesetzes (KPAnG, seit 1. April 2026).
 *  - 'price-step':     Preisänderung um x ct/L ab einem Stichtag (Steuer, CO₂-Preis, befristeter Rabatt),
 *    optional mit Enddatum, ab dem sie wieder entfällt.
 *
 * Eine Regel wirkt nur, wenn sie eingeschaltet ist, für die gewählte Sorte gilt und der Zeitpunkt im
 * Gültigkeitszeitraum liegt. Die Mechaniken der App (Warten auf günstigere Zeitfenster, Prognosen,
 * Ankunftsprognose, Wellen-Erkennung) bleiben dieselben – die Regeln setzen ihnen nur Grenzen:
 *  - Zwischen zwei erlaubten Erhöhungszeitpunkten kann ein Preis nur gleich bleiben oder fallen.
 *  - Stichtags-Änderungen verschieben das erwartete Preisniveau ab dem Stichtag.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export const LAW_FUELS = ['diesel', 'e5', 'e10'];
export const LAW_KIND_LABELS = {
  'increase-times': 'Erhöhungszeiten',
  'price-step': 'Stichtag (Steuer/Abgabe)',
};
export const KPANG_LAW_ID = 'law-de-kpang-12-uhr';
export const KPANG_SOURCE = 'https://www.bundeskartellamt.de/DE/Aufgaben/MarkttransparenzstelleFuerKraftstoffe/12-Uhr-Regel/12-Uhr-Regel_node.html';

function normalizeTimes(times) {
  const set = new Set();
  for (const raw of Array.isArray(times) ? times : []) {
    const m = TIME_RE.exec(String(raw || '').trim());
    if (m) set.add(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  return Array.from(set).sort();
}

/** Bereinigt einen gespeicherten oder eingegebenen Regel-Eintrag (idempotent). */
export function normalizeLaw(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const kind = raw.kind === 'price-step' ? 'price-step' : 'increase-times';
  const fuels = Array.isArray(raw.fuels) ? LAW_FUELS.filter((f) => raw.fuels.includes(f)) : [];
  const tol = Math.round(Number(raw.toleranceMin));
  const step = Number(raw.stepCt);
  const source = String(raw.source || '').trim();
  return {
    id: String(raw.id),
    name: String(raw.name || '').trim().slice(0, 80) || 'Regel',
    kind,
    enabled: raw.enabled !== false,
    validFrom: DATE_RE.test(String(raw.validFrom || '')) ? String(raw.validFrom) : '',
    validUntil: DATE_RE.test(String(raw.validUntil || '')) ? String(raw.validUntil) : '',
    fuels: fuels.length > 0 ? fuels : [...LAW_FUELS],
    times: kind === 'increase-times' ? normalizeTimes(raw.times) : [],
    toleranceMin: kind === 'increase-times' ? (Number.isFinite(tol) ? Math.max(0, Math.min(60, tol)) : 10) : 0,
    stepCt: kind === 'price-step' && Number.isFinite(step) ? Math.round(step * 10) / 10 : 0,
    note: String(raw.note || '').trim().slice(0, 600),
    source: /^https?:\/\/\S+$/i.test(source) ? source.slice(0, 400) : '',
    builtIn: raw.builtIn === true,
  };
}

/** Vorlage: die geltende 12-Uhr-Regel (Kraftstoffpreisanpassungsgesetz). */
export const KPANG_LAW = normalizeLaw({
  id: KPANG_LAW_ID,
  name: '12-Uhr-Regel',
  kind: 'increase-times',
  enabled: true,
  validFrom: '2026-04-01',
  validUntil: '',
  fuels: LAW_FUELS,
  times: ['12:00'],
  toleranceMin: 10,
  note: 'Kraftstoffpreisanpassungsgesetz (KPAnG): Tankstellen dürfen die Preise für Super E5, E10 und Diesel nur einmal täglich um 12 Uhr erhöhen, Senkungen sind jederzeit erlaubt. Laut Bundeskartellamt liegen knapp 90 % der gemeldeten Abweichungen zwischen 11:50 und 12:10 Uhr (Meldeverzug) – daher ±10 Minuten Toleranz.',
  source: KPANG_SOURCE,
  builtIn: true,
});

export const DEFAULT_LAWS = [KPANG_LAW];

// ---------------------------------------------------------------------------- Datum & Uhrzeit

/** Tagesbeginn (Ortszeit) eines "JJJJ-MM-TT"-Datums, optional um Tage verschoben. */
export function dayStartMs(dateStr, addDays = 0) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d + addDays).getTime();
}

/** "2026-04-01" -> "01.04.2026" */
export function fmtLawDate(dateStr) {
  if (!DATE_RE.test(String(dateStr || ''))) return '';
  const [y, m, d] = String(dateStr).split('-');
  return `${d}.${m}.${y}`;
}

function toMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

function clockText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}`;
}

/** ["06:00","12:00","18:30"] -> "6, 12 und 18:30 Uhr" */
export function timesLabel(times) {
  const parts = (times || []).map((t) => clockText(typeof t === 'number' ? t : toMinutes(t)));
  if (parts.length === 0) return '';
  if (parts.length === 1) return `${parts[0]} Uhr`;
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]} Uhr`;
}

function clockLabelOf(ms) {
  const d = new Date(ms);
  return `${clockText(d.getHours() * 60 + d.getMinutes())} Uhr`;
}

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "12 Uhr" (heute), "morgen 12 Uhr", "Di 12 Uhr" */
function relativeClockLabel(ms, now) {
  if (sameDay(ms, now)) return clockLabelOf(ms);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(ms, tomorrow.getTime())) return `morgen ${clockLabelOf(ms)}`;
  return `${WEEKDAY_SHORT[new Date(ms).getDay()]} ${clockLabelOf(ms)}`;
}

/** "heute (Di 27.10.)", "morgen (Mi 28.10.)", "Fr 01.01. (in 5 Tagen)" */
function relativeDayLabel(ms, now) {
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);
  const d = new Date(ms);
  const date = `${WEEKDAY_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  if (days <= 0) return `heute (${date})`;
  if (days === 1) return `morgen (${date})`;
  return `${date} (in ${days} Tagen)`;
}

function fmtWait(min) {
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

function fmtCtSigned(ct) {
  const v = (Math.round(Math.abs(ct) * 10) / 10).toFixed(1).replace('.', ',');
  return `${ct >= 0 ? '+' : '−'}${v} ct/L`;
}

// ---------------------------------------------------------------------------- Regelwerk übersetzen

/**
 * Wirksame Regeln für eine Sorte (nur eingeschaltete). Das Ergebnis ist das "Regelwerk", das alle
 * Rechenfunktionen erwarten.
 * @param {Array} laws   gespeicherte Regel-Einträge
 * @param {string|null} [fuel]  'diesel' | 'e5' | 'e10' (null = alle)
 */
export function compileRules(laws, fuel = null) {
  const list = (Array.isArray(laws) ? laws : [])
    .map(normalizeLaw)
    .filter((l) => l && l.enabled && (!fuel || l.fuels.includes(fuel)));
  const span = (l) => ({
    fromMs: l.validFrom ? dayStartMs(l.validFrom) : -Infinity,
    untilMs: l.validUntil ? dayStartMs(l.validUntil, 1) : Infinity,
  });
  const increase = list
    .filter((l) => l.kind === 'increase-times' && l.times.length > 0)
    .map((l) => ({ law: l, ...span(l), minutes: l.times.map(toMinutes), tolMs: l.toleranceMin * 60 * 1000 }));
  const steps = list
    .filter((l) => l.kind === 'price-step' && l.stepCt !== 0 && l.validFrom)
    .map((l) => ({ law: l, ...span(l), stepCt: l.stepCt }));
  return { fuel, laws: list, increase, steps };
}

/** Keine Regeln (freie Preisbildung). */
export const NO_RULES = compileRules([]);
/** Regelwerk der Vorlage (12-Uhr-Regel) – Standard, wenn ein Aufrufer kein Regelwerk übergibt. */
export const DEFAULT_RULES = compileRules(DEFAULT_LAWS);

// ---------------------------------------------------------------------------- Erhöhungszeitpunkte

function slotAt(t, minutes, dayOffset = 0) {
  const d = new Date(t);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** Erster erlaubter Erhöhungszeitpunkt einer Regel strikt nach t. */
function nextSlot(rule, t) {
  for (let off = 0; off <= 1; off++) {
    for (const m of rule.minutes) {
      const s = slotAt(t, m, off);
      if (s > t) return s;
    }
  }
  return slotAt(t, rule.minutes[0], 2);
}

/** Letzter erlaubter Erhöhungszeitpunkt einer Regel bis einschließlich t. */
function prevSlot(rule, t) {
  for (let off = 0; off >= -1; off--) {
    for (let i = rule.minutes.length - 1; i >= 0; i--) {
      const s = slotAt(t, rule.minutes[i], off);
      if (s <= t) return s;
    }
  }
  return slotAt(t, rule.minutes[rule.minutes.length - 1], -2);
}

/** Zum Zeitpunkt t wirksame Erhöhungs-Regeln. */
export function activeIncreaseRules(rules, t = Date.now()) {
  return (rules?.increase || []).filter((r) => t >= r.fromMs && t < r.untilMs);
}

/** Sind Erhöhungen zum Zeitpunkt t zeitlich beschränkt? */
export function isRestrictedAt(rules, t = Date.now()) {
  return activeIncreaseRules(rules, t).length > 0;
}

/** Nächster Zeitpunkt nach t, ab dem eine Erhöhung erlaubt ist – null = jederzeit erlaubt. */
export function nextIncreaseAt(rules, t = Date.now()) {
  const act = activeIncreaseRules(rules, t);
  if (act.length === 0) return null;
  return Math.max(...act.map((r) => Math.min(nextSlot(r, t), r.untilMs)));
}

/** Ist im Intervall (from, to] eine Erhöhung erlaubt? */
export function increaseAllowedBetween(rules, from, to) {
  if (!(to > from)) return false;
  const next = nextIncreaseAt(rules, from);
  return next === null || next <= to;
}

/** Liegt t im Toleranzfenster eines erlaubten Erhöhungszeitpunkts (bzw. gilt keine Beschränkung)? */
export function isIncreaseWindow(rules, t = Date.now()) {
  const act = activeIncreaseRules(rules, t);
  if (act.length === 0) return true;
  return act.every((r) => t - prevSlot(r, t) <= r.tolMs || nextSlot(r, t) - t <= r.tolMs);
}

/**
 * Kann eine Erhöhung, die irgendwann in (from, to] passiert ist, zu einer erlaubten Zeit gewesen sein?
 * (Bei Messlücken ist der genaue Zeitpunkt unbekannt.)
 */
export function increaseCouldBeAllowed(rules, from, to) {
  const start = Number.isFinite(from) ? Math.min(from, to) : to;
  if (!isRestrictedAt(rules, start) || !isRestrictedAt(rules, to)) return true;
  if (to - start >= DAY_MS) return true;
  return activeIncreaseRules(rules, to).every((r) => nextSlot(r, start - r.tolMs - 1) - r.tolMs <= to);
}

// ---------------------------------------------------------------------------- Stichtags-Änderungen

/** Summe der zum Zeitpunkt t geltenden Stichtags-Änderungen (ct/L). */
export function stepOffsetCt(rules, t) {
  let sum = 0;
  for (const st of rules?.steps || []) if (t >= st.fromMs && t < st.untilMs) sum += st.stepCt;
  return sum;
}

/** Erwartete Preisänderung durch Stichtags-Regeln zwischen from und to (ct/L). */
export function stepChangeCt(rules, from, to) {
  return Math.round((stepOffsetCt(rules, to) - stepOffsetCt(rules, from)) * 10) / 10;
}

/** Stichtage (Beginn und Ende) im Zeitraum (now, now + horizonMs], aufsteigend. */
export function upcomingSteps(rules, now = Date.now(), horizonMs = 7 * DAY_MS) {
  const out = [];
  for (const st of rules?.steps || []) {
    if (st.fromMs > now && st.fromMs <= now + horizonMs) out.push({ at: st.fromMs, ct: st.stepCt, law: st.law, ends: false });
    if (Number.isFinite(st.untilMs) && st.untilMs > now && st.untilMs <= now + horizonMs) out.push({ at: st.untilMs, ct: -st.stepCt, law: st.law, ends: true });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "Ab morgen (Fr 01.01.) voraussichtlich +3,0 ct/L teurer." bzw. "Läuft aus – ab … wieder …" */
export function describeStepEvent(ev, now = Date.now()) {
  const when = relativeDayLabel(ev.at, now);
  const dir = ev.ct > 0 ? 'teurer' : 'günstiger';
  return ev.ends
    ? `Läuft aus – ab ${when} voraussichtlich wieder ${fmtCtSigned(ev.ct)} ${dir}.`
    : `Ab ${when} voraussichtlich ${fmtCtSigned(ev.ct)} ${dir}.`;
}

// ---------------------------------------------------------------------------- Prognosen begrenzen

/**
 * Hält eine Preisprognose (aufsteigende Zeitpunkte) an das Regelwerk: Stichtags-Änderungen verschieben
 * das Niveau, Anstiege gibt es nur, wenn seit dem vorherigen Punkt eine Erhöhung erlaubt war.
 * Liefert neue Objekte; der erste Punkt (jetzt) bleibt unverändert.
 */
export function applyRulesToForecast(points, rules, { priceKey = 'price' } = {}) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const base = stepOffsetCt(rules, points[0].t);
  const out = [];
  let cap = null;
  for (let i = 0; i < points.length; i++) {
    const p = { ...points[i] };
    if (i > 0 && Number.isFinite(p[priceKey])) {
      const shift = stepOffsetCt(rules, p.t) - base;
      if (shift) p[priceKey] = Math.round((p[priceKey] + shift / 100) * 1000) / 1000;
      const prevT = points[i - 1].t;
      const allowed = increaseAllowedBetween(rules, prevT, p.t) || isIncreaseWindow(rules, prevT);
      if (!allowed && Number.isFinite(cap) && p[priceKey] > cap) p[priceKey] = cap;
    }
    cap = p[priceKey];
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------- Beschreibungen

/**
 * Lage im Rhythmus der wirksamen Erhöhungs-Regel – für Hinweise in Radar, Tankwart und Prognosen.
 */
export function describeRuleState(rules, now = Date.now()) {
  const act = activeIncreaseRules(rules, now);
  if (act.length === 0) {
    return { active: false, law: null, name: '', timesLabel: '', slotLabel: '', nextLabel: '', nextIncreaseMs: null, minutesToNext: null, nextToday: false, inWindow: false, justAfter: false, headline: '', text: '', short: '', urgent: false, endsBeforeNext: false };
  }
  const r = act[0];
  const law = r.law;
  const next = nextIncreaseAt(rules, now);
  const endsBeforeNext = Number.isFinite(r.untilMs) && r.untilMs <= next;
  const prev = prevSlot(r, now);
  const justAfter = now - prev <= r.tolMs;
  const inWindow = isIncreaseWindow(rules, now);
  const minutesToNext = Math.max(0, Math.round((next - now) / 60000));
  const nextToday = sameDay(next, now);
  const slotLabel = clockLabelOf(next);
  const nextLabel = relativeClockLabel(next, now);
  const times = timesLabel(r.minutes);

  let headline;
  let text;
  let short;
  let urgent = false;
  if (endsBeforeNext) {
    const endLabel = relativeDayLabel(r.untilMs - 1, now);
    headline = `${law.name} gilt nur noch bis ${endLabel}`;
    text = 'Bis zum Ende der Regel dürfen die Preise nur fallen. Danach sind Erhöhungen wieder jederzeit erlaubt.';
    short = `${law.name} gilt nur noch bis ${endLabel} – bis dahin keine Erhöhung.`;
  } else if (justAfter) {
    headline = `Erhöhungszeit ${clockLabelOf(prev)} läuft`;
    text = `Um ${clockLabelOf(prev)} dürfen die Tankstellen ihre Preise erhöhen – danach bis ${nextLabel} nur noch senken.`;
    short = `Erhöhungszeit ${clockLabelOf(prev)} läuft – danach bis ${nextLabel} nur noch Senkungen.`;
  } else if (nextToday) {
    urgent = minutesToNext <= 120;
    headline = urgent ? `Noch ${fmtWait(minutesToNext)} bis ${slotLabel}` : `Bis ${slotLabel} können die Preise nur fallen`;
    text = `Bis ${slotLabel} dürfen die Preise nur fallen. Um ${slotLabel} ist die nächste Erhöhung erlaubt – wer heute tankt, tankt am besten kurz davor.`;
    short = urgent ? `Noch ${fmtWait(minutesToNext)} bis ${slotLabel} – dann dürfen die Preise steigen.` : `Bis ${slotLabel} können die Preise nur fallen.`;
  } else {
    headline = `Bis ${nextLabel} keine Erhöhung`;
    text = `Die nächste erlaubte Erhöhung ist ${nextLabel}. Bis dahin dürfen die Preise nur fallen – Warten ist ohne Risiko.`;
    short = `Bis ${nextLabel} dürfen die Preise nur fallen.`;
  }
  return { active: true, law, name: law.name, timesLabel: times, slotLabel, nextLabel, nextIncreaseMs: next, minutesToNext, nextToday, inWindow, justAfter, headline, text, short, urgent, endsBeforeNext };
}

/** Status eines Eintrags: in Kraft, ausgeschaltet, angekündigt oder abgelaufen. */
export function lawStatus(law, now = Date.now()) {
  const l = normalizeLaw(law);
  if (!l) return { state: 'off', label: 'Ungültig' };
  if (!l.enabled) return { state: 'off', label: 'Ausgeschaltet' };
  if (l.kind === 'increase-times' && l.times.length === 0) return { state: 'off', label: 'Keine Uhrzeit' };
  if (l.validFrom && now < dayStartMs(l.validFrom)) return { state: 'upcoming', label: `Ab ${fmtLawDate(l.validFrom)}` };
  if (l.validUntil && now >= dayStartMs(l.validUntil, 1)) return { state: 'expired', label: `Abgelaufen (${fmtLawDate(l.validUntil)})` };
  return { state: 'active', label: 'In Kraft' };
}

/** Kurzbeschreibung der Wirkung eines Eintrags. */
export function describeLawEffect(law) {
  const l = normalizeLaw(law);
  if (!l) return '';
  const fuels = l.fuels.length < LAW_FUELS.length ? ` • nur ${l.fuels.map((f) => (f === 'diesel' ? 'Diesel' : f.toUpperCase())).join(', ')}` : '';
  const period = `${l.validFrom ? `ab ${fmtLawDate(l.validFrom)}` : 'ohne Beginn'}${l.validUntil ? ` bis ${fmtLawDate(l.validUntil)}` : ''}`;
  if (l.kind === 'price-step') {
    return `${fmtCtSigned(l.stepCt)} (${l.stepCt >= 0 ? 'teurer' : 'günstiger'}) ${period}${fuels}`;
  }
  if (l.times.length === 0) return `Keine Uhrzeit festgelegt${fuels}`;
  return `Erhöhungen nur um ${timesLabel(l.times)}${l.toleranceMin ? ` (±${l.toleranceMin} Min.)` : ''}, Senkungen jederzeit • ${period}${fuels}`;
}
