/**
 * KRAFTSTOFF - Kurzlinks aus Google Maps / Apple Karten auflösen (Vercel-Funktion und lokaler Server)
 *
 * Browser dürfen Weiterleitungen fremder Seiten nicht selbst verfolgen. Dieser Helfer folgt den
 * Weiterleitungen von Kurzlinks (maps.app.goo.gl, goo.gl, g.co, maps.apple/p/…) und hört auf, sobald
 * eine vollständige Karten-URL erreicht ist. Es werden ausschließlich Karten-Hosts angefragt.
 */

const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.apple'];
const MAX_HOPS = 6;
const TIMEOUT_MS = 6000;

const isShortHost = (host) => SHORT_HOSTS.includes(host);
const isGoogleHost = (host) => /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);

function isFullMapUrl(u) {
  const host = u.hostname.toLowerCase();
  if (host === 'maps.apple.com') return true;
  if (host.startsWith('maps.google.')) return isGoogleHost(host);
  return isGoogleHost(host) && u.pathname.startsWith('/maps');
}

/** Cookie-Hinweis von Google (consent.google.com/?continue=…) überspringen */
function unwrapConsent(u) {
  if (/^consent\.google\./.test(u.hostname.toLowerCase())) {
    const next = u.searchParams.get('continue');
    if (next) {
      try {
        return new URL(next);
      } catch {}
    }
  }
  return null;
}

function canonicalFromHtml(html) {
  const m = /(?:property="og:url"|rel="canonical")\s+(?:content|href)="([^"]+)"/i.exec(html)
    || /(?:content|href)="([^"]+)"\s+(?:property="og:url"|rel="canonical")/i.exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

/** @returns {Promise<{success:true, finalUrl:string, hops:number} | {success:false, status:number, error:string}>} */
export async function resolveNavigationLink(target) {
  let current;
  try {
    current = new URL(String(target || '').trim());
  } catch {
    return { success: false, status: 400, error: 'Ungültiger Link.' };
  }
  if (current.protocol !== 'https:' && current.protocol !== 'http:') {
    return { success: false, status: 400, error: 'Ungültiger Link.' };
  }

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const unwrapped = unwrapConsent(current);
    if (unwrapped) current = unwrapped;
    const host = current.hostname.toLowerCase();

    if (isFullMapUrl(current)) return { success: true, finalUrl: current.href, hops: hop };
    if (!isShortHost(host)) {
      return { success: false, status: 400, error: 'Nur Links aus Google Maps oder Apple Karten werden aufgelöst.' };
    }
    if (hop === MAX_HOPS) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KRAFTSTOFF/2.0', 'Accept-Language': 'de,en' },
      });
    } catch (err) {
      return { success: false, status: 502, error: err && err.name === 'AbortError' ? 'Der Kurzlink-Dienst antwortet nicht.' : 'Der Kurzlink konnte nicht abgerufen werden.' };
    } finally {
      clearTimeout(timer);
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    // Keine Weiterleitung: einige Kurzlink-Seiten nennen das Ziel nur im HTML
    const html = await res.text().catch(() => '');
    const canonical = canonicalFromHtml(html);
    if (canonical) {
      try {
        const next = new URL(canonical, current);
        if (!isShortHost(next.hostname.toLowerCase())) {
          current = next;
          continue;
        }
      } catch {}
    }
    return { success: false, status: 404, error: 'Der Kurzlink ist ungültig oder abgelaufen. Bitte den Link erneut aus der Karten-App kopieren.' };
  }
  return { success: false, status: 502, error: 'Zu viele Weiterleitungen.' };
}
