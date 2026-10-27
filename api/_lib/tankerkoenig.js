/**
 * KRAFTSTOFF - Tankerkönig-Proxy (gemeinsam für Vercel-Funktion und lokalen Vite-Server)
 *
 * Reicht list.php (Umkreissuche), prices.php (Preise per ID, z.B. Favoriten) und detail.php
 * (Stationsdetails) an die Tankerkönig-API
 * (MTS-K, creativecommons.tankerkoenig.de) durch. Prüft alle Parameter, setzt Timeouts und
 * liefert verständliche Fehlermeldungen. Dateien in /api/_lib werden von Vercel nicht als
 * eigene Funktion veröffentlicht.
 */

const BASE_URL = 'https://creativecommons.tankerkoenig.de/json';
const DEMO_KEY = '00000000-0000-0000-0000-000000000002';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUEL_TYPES = ['all', 'diesel', 'e5', 'e10'];
const TIMEOUT_MS = 9000;

const first = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * @param {Record<string, string|string[]>} query  Anfrage-Parameter (lat, lng, rad, type, sort, id, ids, apikey, probe)
 * @param {Record<string, string|undefined>} env  Umgebungsvariablen (optional TANKERKOENIG_API_KEY)
 * @returns {Promise<{status:number, body:object, cacheControl?:string}>}
 */
export async function proxyTankerkoenig(query = {}, env = {}) {
  const q = (k) => {
    const v = first(query[k]);
    return v === undefined || v === null ? '' : String(v).trim();
  };
  const serverKey = String(env.TANKERKOENIG_API_KEY || env.VITE_TANKERKOENIG_KEY || '').trim();
  // Hat der Server einen eigenen Key? (ohne Abfrage bei Tankerkönig, Key wird nie herausgegeben)
  if (q('probe')) {
    return { status: 200, body: { ok: true, serverKey: UUID_RE.test(serverKey) && serverKey !== DEMO_KEY }, cacheControl: 'no-store' };
  }
  const key = q('apikey') || serverKey;

  if (!key || key === DEMO_KEY) {
    return {
      status: 401,
      body: { ok: false, needsApiKey: true, message: 'Tankerkönig API-Key erforderlich. Bitte trage deinen persönlichen API-Key in den Einstellungen ein.' },
    };
  }
  if (!UUID_RE.test(key)) {
    return {
      status: 400,
      body: { ok: false, needsApiKey: true, message: 'Der API-Key hat nicht das erwartete Format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).' },
    };
  }

  let url;
  let cacheControl;
  const id = q('id');
  const ids = q('ids');
  if (ids) {
    const list = ids.split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length === 0 || list.length > 10 || !list.every((x) => UUID_RE.test(x))) {
      return { status: 400, body: { ok: false, message: 'Ungültige Stations-IDs (höchstens 10).' } };
    }
    url = `${BASE_URL}/prices.php?ids=${list.map(encodeURIComponent).join(',')}&apikey=${encodeURIComponent(key)}`;
    cacheControl = 'public, s-maxage=60, stale-while-revalidate=120';
  } else if (id) {
    if (!UUID_RE.test(id)) return { status: 400, body: { ok: false, message: 'Ungültige Stations-ID.' } };
    url = `${BASE_URL}/detail.php?id=${encodeURIComponent(id)}&apikey=${encodeURIComponent(key)}`;
    cacheControl = 'public, s-maxage=300, stale-while-revalidate=600';
  } else {
    const lat = Number(q('lat'));
    const lng = Number(q('lng'));
    if (!q('lat') || !q('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { status: 400, body: { ok: false, message: 'Fehlende oder ungültige Koordinaten (lat, lng).' } };
    }
    const rad = Math.min(Math.max(Number(q('rad')) || 5, 1), 25);
    const type = FUEL_TYPES.includes(q('type')) ? q('type') : 'all';
    // Tankerkönig erlaubt sort=price nur für eine einzelne Sorte
    const sort = type !== 'all' && q('sort') === 'price' ? 'price' : 'dist';
    url = `${BASE_URL}/list.php?lat=${lat}&lng=${lng}&rad=${rad}&sort=${sort}&type=${type}&apikey=${encodeURIComponent(key)}`;
    cacheControl = 'public, s-maxage=60, stale-while-revalidate=120';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { status: 502, body: { ok: false, message: `Tankerkönig antwortete unerwartet (HTTP ${response.status}).` } };
    }
    return { status: 200, body: data, cacheControl: data && data.ok ? cacheControl : 'no-store' };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return {
      status: timedOut ? 504 : 502,
      body: { ok: false, message: timedOut ? 'Tankerkönig antwortet nicht (Zeitüberschreitung).' : `Tankerkönig nicht erreichbar: ${err && err.message}` },
    };
  } finally {
    clearTimeout(timer);
  }
}
