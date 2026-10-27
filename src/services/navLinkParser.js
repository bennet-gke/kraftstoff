/**
 * KRAFTSTOFF - Navigations-Links aus Google Maps und Apple Karten verstehen
 *
 * Liest Start und Ziel aus geteilten Links ("Teilen" → "Link kopieren" in Google Maps / Apple Karten).
 * Kurzlinks (maps.app.goo.gl, maps.apple/p/…) werden über den eigenen Server (/api/resolve-link) aufgelöst,
 * weil Browser Weiterleitungen fremder Seiten nicht selbst verfolgen dürfen.
 */

const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.apple'];
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
// "Mein Standort", "My Location", "Aktueller Standort" … = GPS-Position, kein Ortsname
const CURRENT_LOC_RE = /^(mein(en)?|dein(en)?|ihr(en)?|aktuell(er|en)?)\s+(standort|ort)$|^(my|your|current)\s+location$|^standort$/i;
// Pfadteile, die keine Orte sind (z.B. "am=t", "data=…", "entry=ttu")
const PARAM_SEGMENT_RE = /^[a-z_]+=/i;

const empty = (error = null) => ({ provider: null, origin: null, destination: null, waypoints: [], error });

/** "52.52,13.405" → { lat, lng } oder null */
export function parseCoordinate(text) {
  const m = COORD_RE.exec(String(text || ''));
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function decodePlus(s) {
  const raw = String(s || '').replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** Ort aus Text (Name/Adresse oder "lat,lng") und optional bekannten Koordinaten. */
function makePlace(text, coords = null) {
  const label = decodePlus(text);
  const c = coords || parseCoordinate(label);
  if (!label && !c) return null;
  if (!c && CURRENT_LOC_RE.test(label)) return null;
  if (c) {
    const isCoordLabel = !label || COORD_RE.test(label);
    return { lat: c.lat, lng: c.lng, name: isCoordLabel ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : label, query: '' };
  }
  return { lat: null, lng: null, name: label, query: label };
}

/** Ersten http(s)-Link aus beliebigem Text herauslösen. */
export function extractUrl(text) {
  const m = /https?:\/\/[^\s"'<>]+/i.exec(String(text || ''));
  return m ? m[0].replace(/[),.;]+$/, '') : null;
}

export function isShortLink(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SHORT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Kurzlink über den Server zur vollständigen Karten-URL auflösen. */
export async function resolveShortLink(url) {
  let res;
  try {
    res = await fetch(`/api/resolve-link?url=${encodeURIComponent(url)}`);
  } catch {
    throw new Error('Keine Verbindung zum Server – der Kurzlink kann gerade nicht aufgelöst werden.');
  }
  const json = await res.json().catch(() => null);
  if (!json || !json.success || !json.finalUrl) {
    throw new Error(json?.error || 'Der Kurzlink konnte nicht aufgelöst werden. Bitte den vollständigen Link einfügen.');
  }
  return json.finalUrl;
}

function parseGoogle(u) {
  const sp = u.searchParams;
  const path = u.pathname;
  let origin = null;
  let destination = null;
  const waypoints = [];

  if (sp.get('destination')) {
    // https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b
    destination = makePlace(sp.get('destination'));
    if (sp.get('origin')) origin = makePlace(sp.get('origin'));
    String(sp.get('waypoints') || '').split('|').filter(Boolean).forEach((w) => waypoints.push(makePlace(w)));
  } else if (sp.get('daddr')) {
    // https://maps.google.com/?saddr=…&daddr=…
    destination = makePlace(sp.get('daddr'));
    if (sp.get('saddr')) origin = makePlace(sp.get('saddr'));
  } else if (path.includes('/maps/dir/')) {
    // https://www.google.com/maps/dir/Start/Ziel/@lat,lng,zoom/data=…  (leerer Start = aktueller Standort)
    const rest = path.split('/maps/dir/')[1] || '';
    const segs = rest.split('/').filter((s) => s && !s.startsWith('@') && !PARAM_SEGMENT_RE.test(s));
    if (segs.length >= 2) {
      origin = makePlace(segs[0]);
      destination = makePlace(segs[segs.length - 1]);
      segs.slice(1, -1).forEach((s) => waypoints.push(makePlace(s)));
    } else if (segs.length === 1) {
      destination = makePlace(segs[0]);
    }
  } else if (path.includes('/maps/place/')) {
    // https://www.google.com/maps/place/Name/@lat,lng,17z/data=…!3d<lat>!4d<lng>…
    const name = (path.split('/maps/place/')[1] || '').split('/')[0];
    const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u.href);
    const view = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
    const coords = pin ? { lat: parseFloat(pin[1]), lng: parseFloat(pin[2]) } : view ? { lat: parseFloat(view[1]), lng: parseFloat(view[2]) } : null;
    destination = makePlace(name, coords);
  } else if (sp.get('query')) {
    // https://www.google.com/maps/search/?api=1&query=…
    destination = makePlace(sp.get('query'));
  } else if (path.includes('/maps/search/')) {
    destination = makePlace((path.split('/maps/search/')[1] || '').split('/')[0]);
  } else if (sp.get('q')) {
    destination = makePlace(sp.get('q'));
  } else if (sp.get('ll')) {
    destination = makePlace('', parseCoordinate(sp.get('ll')));
  }

  return { provider: 'google', origin, destination, waypoints: waypoints.filter(Boolean), error: destination ? null : 'Im Google-Maps-Link wurde kein Ziel gefunden.' };
}

function parseApple(u) {
  const sp = u.searchParams;
  let origin = null;
  let destination = null;
  const coord = parseCoordinate(sp.get('coordinate') || sp.get('ll') || '');
  const name = sp.get('name') || sp.get('q') || sp.get('query') || sp.get('address') || '';
  const daddr = sp.get('daddr') || sp.get('destination');
  const saddr = sp.get('saddr') || sp.get('source');

  if (daddr) {
    // https://maps.apple.com/?saddr=…&daddr=…&dirflg=d  bzw. neu: /directions?source=…&destination=…&mode=driving
    // ("Current Location" = GPS)
    destination = makePlace(daddr);
    if (saddr) origin = makePlace(saddr);
  } else if (coord) {
    // https://maps.apple.com/place?coordinate=lat,lng&name=…  bzw. ?ll=lat,lng&q=…
    destination = makePlace(name, coord);
  } else if (name) {
    destination = makePlace(name);
  }

  return { provider: 'apple', origin, destination, waypoints: [], error: destination ? null : 'Im Apple-Karten-Link wurde kein Ziel gefunden.' };
}

/** Vollständige Karten-URL → { provider, origin, destination, waypoints, error } */
export function parseNavigationUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return empty('Das ist kein gültiger Link.');
  }
  const host = u.hostname.toLowerCase();
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return parseGoogle(u);
  if (host === 'maps.apple.com' || host === 'maps.apple') return parseApple(u);
  return empty('Nur Links aus Google Maps oder Apple Karten werden verstanden.');
}

/** Beliebiger Text mit Link → Kurzlink auflösen → Start/Ziel bestimmen. */
export async function parseNavigationText(text) {
  const url = extractUrl(text);
  if (!url) return empty('Kein Link gefunden. Bitte den geteilten Link aus Google Maps oder Apple Karten einfügen.');
  const target = isShortLink(url) ? await resolveShortLink(url) : url;
  return { ...parseNavigationUrl(target), url: target };
}
