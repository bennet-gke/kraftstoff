/**
 * KRAFTSTOFF - Übergabe an Navigations-Apps (Standard: Apple Karten, alternativ Google Maps)
 *
 * Apple Karten: ab iOS 18.4 / macOS 15.4 die offiziellen "Unified Map URLs"
 * (https://maps.apple.com/directions?destination=…&waypoint=…&mode=driving) – sie übernehmen auch den
 * Tankstopp als Zwischenziel. Ältere iPhones bekommen das klassische Format (ohne Zwischenziel).
 * Quelle: Apple Developer Documentation "Adopting unified Maps URLs".
 *
 * Links werden über ein echtes <a target="_blank"> geöffnet: Das funktioniert auch in der
 * Home-Screen-App auf dem iPhone zuverlässig (window.open wird dort teils blockiert).
 */

export function isApplePlatform() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent || '');
}

/** iOS-Version aus dem User-Agent oder null (Mac, iPad im Desktop-Modus, andere Systeme). */
function iosVersion() {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (!/iPhone|iPod|iPad/.test(ua)) return null;
  const m = /OS (\d+)[_.](\d+)/.exec(ua);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** Apple Karten versteht Zwischenziele per Link (iOS 18.4+; unbekannte Version = aktuelles System). */
export function appleSupportsWaypoints() {
  const v = iosVersion();
  if (!v) return true;
  return v.major > 18 || (v.major === 18 && v.minor >= 4);
}

/** Bevorzugte App: Google Maps nur auf ausdrücklichen Wunsch, sonst Apple Karten. */
export function resolveNavApp(preference = 'apple') {
  return preference === 'google' ? 'google' : 'apple';
}

export function navAppLabel(app) {
  return app === 'google' ? 'Google Maps' : 'Apple Karten';
}

const valid = (p) => !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
const coord = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;

/**
 * Routen-Link vom aktuellen Standort zum Ziel, optional mit Zwischenziel (Tankstopp).
 * Kann Apple Karten (ältere iPhones) kein Zwischenziel, führt der Link zuerst zum Tankstopp.
 */
export function directionsUrl({ app = 'apple', destination, waypoint = null }) {
  if (!valid(destination)) return null;
  const stop = valid(waypoint) ? waypoint : null;
  if (app === 'google') {
    const wp = stop ? `&waypoints=${coord(stop)}` : '';
    return `https://www.google.com/maps/dir/?api=1&destination=${coord(destination)}&travelmode=driving${wp}`;
  }
  if (appleSupportsWaypoints()) {
    const wp = stop ? `&waypoint=${coord(stop)}` : '';
    return `https://maps.apple.com/directions?destination=${coord(destination)}${wp}&mode=driving`;
  }
  // Klassisches Format (vor iOS 18.4): kein Zwischenziel – dann direkt zum Tankstopp
  return `https://maps.apple.com/?daddr=${coord(stop || destination)}&dirflg=d`;
}

export function openExternal(url) {
  if (!url || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Navigation zu einer Tankstelle in der bevorzugten Karten-App starten. */
export function navigateToStation(station, preference = 'apple') {
  if (!station) return;
  openExternal(directionsUrl({ app: resolveNavApp(preference), destination: station }));
}
