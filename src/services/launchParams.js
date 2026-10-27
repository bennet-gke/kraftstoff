/**
 * KRAFTSTOFF - Start-Parameter aus der Adresszeile
 *
 * Unterstützt:
 *  - /?action=trip                 Fahrt-Planer öffnen
 *  - /?ziel=Hamburg  (oder ?dest=)  Fahrt-Planer mit Ziel öffnen
 *  - /?share=<Karten-Link>          Fahrt-Planer mit Link aus Google Maps / Apple Karten (z.B. aus einem iOS-Kurzbefehl)
 *  - /?url=…&text=…&title=…         Web Share Target (Android/Chrome: "Teilen" an die App)
 *  - /?tab=map|trends|tankwart|radar
 * Nach dem Lesen wird die Adresszeile bereinigt, damit ein Neuladen die Aktion nicht wiederholt.
 */

const TAB_ALIASES = {
  radar: 'stations',
  stations: 'stations',
  map: 'map',
  karte: 'map',
  trends: 'analytics',
  analytics: 'analytics',
  tankwart: 'ml',
  ki: 'ml',
  ml: 'ml',
};

const KNOWN_KEYS = ['action', 'ziel', 'dest', 'destination', 'share', 'link', 'url', 'text', 'title', 'tab'];

function findUrl(text) {
  const m = /https?:\/\/[^\s"'<>]+/i.exec(String(text || ''));
  return m ? m[0].replace(/[),.;]+$/, '') : null;
}

/**
 * @returns {{ tab: string|null, openTrip: boolean, link: string|null, destination: string|null } | null}
 */
export function readLaunchParams(search = typeof window !== 'undefined' ? window.location.search : '') {
  let sp;
  try {
    sp = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (!KNOWN_KEYS.some((k) => sp.has(k))) return null;

  const shared = [sp.get('share'), sp.get('link'), sp.get('url'), sp.get('text'), sp.get('title')].filter(Boolean);
  let link = null;
  for (const candidate of shared) {
    link = findUrl(candidate);
    if (link) break;
  }
  const destination = (sp.get('ziel') || sp.get('dest') || sp.get('destination') || '').trim() || null;
  // Geteilter Text ohne Link (z.B. eine Adresse) gilt als Ziel
  const sharedText = !link && !destination ? (sp.get('text') || sp.get('share') || '').trim() : '';
  const tab = TAB_ALIASES[String(sp.get('tab') || '').toLowerCase()] || null;
  const openTrip = sp.get('action') === 'trip' || !!link || !!destination || !!sharedText;

  return { tab, openTrip, link, destination: destination || sharedText || null };
}

/** Entfernt die Start-Parameter aus der Adresszeile (ohne Neuladen). */
export function clearLaunchParams() {
  try {
    const url = new URL(window.location.href);
    KNOWN_KEYS.forEach((k) => url.searchParams.delete(k));
    const next = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', next);
  } catch {}
}
