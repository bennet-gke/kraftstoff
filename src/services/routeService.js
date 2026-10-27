/**
 * KRAFTSTOFF - Gespeicherte Routen, Fahrten & Korridor-Geometrie
 *
 * - Reale Straßenrouten über OSRM (zwei öffentliche Server, sonst ehrlich gekennzeichnete Luftlinie).
 * - Die Linienführung wird beim Anlegen vereinfacht (Douglas-Peucker, ~25 m), das spart Speicher und Rechenzeit.
 * - Korridor-Filter: Abstand jeder Tankstelle zur Strecke und Kilometerstand entlang der Route, mit
 *   vorberechneter Geometrie (flache km-Koordinaten + Abschnitts-Boxen) – schnell genug fürs iPhone.
 * - Abfrageplan: Kreise entlang der Strecke so gesetzt, dass der Korridor lückenlos abgedeckt ist.
 */

import { calculateHaversineDistance } from './locationService';

const STORAGE_KEY = 'kraftstoff_user_routes';
const ACTIVE_ROUTE_KEY = 'kraftstoff_active_route_id';
const EARTH_KM_PER_DEG = 111.32;
const SIMPLIFY_TOLERANCE_KM = 0.025;
const MAX_STORED_POINTS = 2500;
const CHUNK_SIZE = 48;
const OSRM_TIMEOUT_MS = 9000;
const OSRM_SERVERS = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];

// Keine vorgefertigten Demo-Routen: Routen legt der Nutzer selbst an.
export const INITIAL_ROUTES = [];
/** Wählbare Korridor-Breiten (±km) – 2,5 km ist der Standard. */
export const CORRIDOR_OPTIONS = [1, 2.5, 3.5, 5];
export const DEFAULT_CORRIDOR_KM = 2.5;
/** Abfrageplan deckt immer den breitesten Korridor ab, damit ein Wechsel keinen Neuabruf braucht. */
const PLAN_CORRIDOR_KM = 5;

// ---------------------------------------------------------------------------- Geometrie-Helfer

/**
 * Minimaler Abstand (km) eines Punktes P zu einem Segment A–B (lokale Projektion) inkl. Projektionsanteil.
 */
export function calculateDistancePointToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const cosLat = Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const bx = (bLng - aLng) * EARTH_KM_PER_DEG * cosLat;
  const by = (bLat - aLat) * EARTH_KM_PER_DEG;
  const px = (pLng - aLng) * EARTH_KM_PER_DEG * cosLat;
  const py = (pLat - aLat) * EARTH_KM_PER_DEG;
  const segLenSq = bx * bx + by * by;
  const t = segLenSq < 1e-10 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  const dx = px - t * bx;
  const dy = py - t * by;
  return {
    distanceKm: Math.sqrt(dx * dx + dy * dy),
    fraction: t,
    projLat: aLat + t * (bLat - aLat),
    projLng: aLng + t * (bLng - aLng),
    segLenKm: Math.sqrt(segLenSq),
  };
}

/** Linienführung einer Route als Liste {lat, lng}. */
export function getRoutePoints(route) {
  if (!route) return [];
  const toPt = (c) => (Array.isArray(c) ? { lat: Number(c[0]), lng: Number(c[1]) } : { lat: Number(c?.lat), lng: Number(c?.lng) });
  const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);
  if (Array.isArray(route.polylineCoords) && route.polylineCoords.length > 1) return route.polylineCoords.map(toPt).filter(valid);
  if (Array.isArray(route.waypoints) && route.waypoints.length > 1) return route.waypoints.map(toPt).filter(valid);
  const pts = [];
  if (route.startCoords) pts.push(toPt(route.startCoords));
  if (route.endCoords) pts.push(toPt(route.endCoords));
  return pts.filter(valid);
}

/** Douglas-Peucker-Vereinfachung einer [lat, lng]-Liste (iterativ, Toleranz in km). */
export function simplifyPolyline(coords, toleranceKm = SIMPLIFY_TOLERANCE_KM) {
  if (!Array.isArray(coords) || coords.length <= 2) return coords || [];
  const n = coords.length;
  const refLat = coords.reduce((s, c) => s + c[0], 0) / n;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = coords[i][1] * EARTH_KM_PER_DEG * cosLat;
    ys[i] = coords[i][0] * EARTH_KM_PER_DEG;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tolSq = toleranceKm * toleranceKm;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = xs[a];
    const ay = ys[a];
    const vx = xs[b] - ax;
    const vy = ys[b] - ay;
    const lenSq = vx * vx + vy * vy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      let dx = xs[i] - ax;
      let dy = ys[i] - ay;
      if (lenSq > 1e-12) {
        const t = Math.max(0, Math.min(1, (dx * vx + dy * vy) / lenSq));
        dx -= t * vx;
        dy -= t * vy;
      }
      const d = dx * dx + dy * dy;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > tolSq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([Math.round(coords[i][0] * 1e5) / 1e5, Math.round(coords[i][1] * 1e5) / 1e5]);
  // Sehr lange Strecken zusätzlich ausdünnen
  if (out.length > MAX_STORED_POINTS) return simplifyPolyline(out, toleranceKm * 2);
  return out;
}

// Vorberechnete Geometrie je Route (lokale km-Koordinaten, kumulierte km, Abschnitts-Boxen)
const geometryCache = new Map();

function getRouteGeometry(route) {
  const pts = getRoutePoints(route);
  if (pts.length < 2) return null;
  const key = `${route.id || ''}|${pts.length}|${pts[0].lat},${pts[0].lng}|${pts[pts.length - 1].lat},${pts[pts.length - 1].lng}`;
  const hit = geometryCache.get(key);
  if (hit) return hit;

  const n = pts.length;
  const refLat = pts.reduce((s, p) => s + p.lat, 0) / n;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].lng * EARTH_KM_PER_DEG * cosLat;
    ys[i] = pts[i].lat * EARTH_KM_PER_DEG;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  const chunks = [];
  for (let s = 0; s < n - 1; s += CHUNK_SIZE) {
    const e = Math.min(n - 1, s + CHUNK_SIZE);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = s; i <= e; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
    chunks.push({ s, e, minX, maxX, minY, maxY });
  }
  const geo = { pts, xs, ys, cum, cosLat, totalKm: cum[n - 1], chunks };
  geometryCache.set(key, geo);
  if (geometryCache.size > 12) geometryCache.delete(geometryCache.keys().next().value);
  return geo;
}

/**
 * Abstand einer Position zur Route und Kilometerstand entlang der Route (ab Start).
 * @returns {{minDistanceKm:number, kmAlongRoute:number, totalRouteKm:number, progressPct:number, segmentIndex:number}}
 */
export function findClosestPointOnRoute(stationLat, stationLng, route) {
  const geo = getRouteGeometry(route);
  if (!geo) {
    const pts = getRoutePoints(route);
    const d = pts[0] ? calculateHaversineDistance(stationLat, stationLng, pts[0].lat, pts[0].lng) : 999;
    return { minDistanceKm: d, kmAlongRoute: 0, totalRouteKm: 0, progressPct: 0, segmentIndex: 0 };
  }
  const { xs, ys, cum, cosLat, chunks } = geo;
  const px = stationLng * EARTH_KM_PER_DEG * cosLat;
  const py = stationLat * EARTH_KM_PER_DEG;

  let bestSq = Infinity;
  let bestKm = 0;
  let bestSeg = 0;
  // Abschnitte nach Box-Abstand sortieren, damit früh ein guter Kandidat feststeht
  const order = chunks
    .map((c, i) => {
      const dx = Math.max(c.minX - px, 0, px - c.maxX);
      const dy = Math.max(c.minY - py, 0, py - c.maxY);
      return { i, d: dx * dx + dy * dy };
    })
    .sort((a, b) => a.d - b.d);

  for (const { i, d } of order) {
    if (d > bestSq) break;
    const c = chunks[i];
    for (let k = c.s; k < c.e; k++) {
      const ax = xs[k];
      const ay = ys[k];
      const vx = xs[k + 1] - ax;
      const vy = ys[k + 1] - ay;
      const lenSq = vx * vx + vy * vy;
      let t = 0;
      if (lenSq > 1e-12) t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
      const dx = px - (ax + t * vx);
      const dy = py - (ay + t * vy);
      const dsq = dx * dx + dy * dy;
      if (dsq < bestSq) {
        bestSq = dsq;
        bestSeg = k;
        bestKm = cum[k] + t * Math.sqrt(lenSq);
      }
    }
  }

  const geoTotal = geo.totalKm || 1;
  // Kilometerangaben auf die echte Straßenlänge skalieren (falls bekannt)
  const total = Number(route.totalDistanceKm) > 0 ? Number(route.totalDistanceKm) : geoTotal;
  const kmAlongRoute = (bestKm / geoTotal) * total;
  return {
    minDistanceKm: Math.round(Math.sqrt(bestSq) * 100) / 100,
    kmAlongRoute: Math.round(kmAlongRoute * 10) / 10,
    totalRouteKm: Math.round(total * 10) / 10,
    progressPct: Math.min(100, Math.max(0, Math.round((kmAlongRoute / total) * 100))),
    segmentIndex: bestSeg,
  };
}

/**
 * Abfrageplan für die Tankerkönig-Umkreissuche entlang einer Route.
 * Kreise mit Radius R im Abstand s = 2·√(R² − (Korridor+1)²) decken den Korridor lückenlos ab.
 * @returns {{centers:Array<{lat:number,lng:number,radiusKm:number}>, totalKm:number, coveredKm:number, truncated:boolean}}
 */
export function planRouteQueries(route, { corridorKm = PLAN_CORRIDOR_KM, maxCalls = 30 } = {}) {
  const geo = getRouteGeometry(route);
  if (!geo) {
    const pts = getRoutePoints(route);
    return { centers: pts[0] ? [{ lat: pts[0].lat, lng: pts[0].lng, radiusKm: 10 }] : [], totalKm: 0, coveredKm: 0, truncated: false };
  }
  const { pts, cum, totalKm } = geo;
  const margin = corridorKm + 1;
  const spacingFor = (r) => 2 * Math.sqrt(Math.max(1, r * r - margin * margin));

  let rMax = 20;
  let n = Math.max(1, Math.ceil(totalKm / spacingFor(rMax)));
  if (n > maxCalls) {
    rMax = 25;
    n = Math.max(1, Math.ceil(totalKm / spacingFor(rMax)));
  }
  let truncated = false;
  let coveredKm = totalKm;
  if (n > maxCalls) {
    truncated = true;
    n = maxCalls;
    coveredKm = n * spacingFor(rMax);
  }
  const step = Math.min(totalKm, coveredKm) / n;
  // Kleinster Radius, der den eigenen Abschnitt samt Korridor abdeckt (weniger Daten bei kurzen Strecken)
  const radiusKm = Math.min(rMax, Math.max(5, Math.ceil(Math.sqrt((step / 2) ** 2 + margin * margin) + 0.5)));

  const centers = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (k + 0.5) * step;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    const a = pts[seg];
    const b = pts[seg + 1] || a;
    centers.push({
      lat: Math.round((a.lat + f * (b.lat - a.lat)) * 1e5) / 1e5,
      lng: Math.round((a.lng + f * (b.lng - a.lng)) * 1e5) / 1e5,
      radiusKm,
    });
  }
  const geoTotal = geo.totalKm || 1;
  const roadTotal = Number(route.totalDistanceKm) > 0 ? Number(route.totalDistanceKm) : geoTotal;
  const scale = roadTotal / geoTotal;
  return {
    centers,
    totalKm: Math.round(roadTotal * 10) / 10,
    coveredKm: Math.round(Math.min(totalKm, coveredKm) * scale * 10) / 10,
    truncated,
  };
}

/** Kompatibilität: nur die Abfragezentren. */
export function sampleRouteQueryPoints(route, options) {
  return planRouteQueries(route, options).centers;
}

/** Vereinfacht gespeicherte Routen älterer Versionen (riesige Linien, doppelte Wegpunkte). */
function compactRoute(r) {
  if (!r || typeof r !== 'object') return r;
  let changed = false;
  let polylineCoords = Array.isArray(r.polylineCoords) ? r.polylineCoords : [];
  if (polylineCoords.length > MAX_STORED_POINTS) {
    polylineCoords = simplifyPolyline(polylineCoords.map((c) => (Array.isArray(c) ? c : [c.lat, c.lng])));
    changed = true;
  }
  let waypoints = r.waypoints;
  if (Array.isArray(waypoints) && waypoints.length > 2 && polylineCoords.length > 1) {
    waypoints = [waypoints[0], waypoints[waypoints.length - 1]];
    changed = true;
  }
  return changed ? { ...r, polylineCoords, waypoints } : r;
}

class RouteService {
  constructor() {
    this.routes = this.loadRoutes();
    this.activeRouteId = this.loadActiveRouteId();
  }

  loadRoutes() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const compacted = parsed.map(compactRoute);
          if (compacted.some((r, i) => r !== parsed[i])) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted)); } catch {}
          }
          return compacted;
        }
      }
    } catch {}
    return [...INITIAL_ROUTES];
  }

  loadActiveRouteId() {
    try {
      const stored = localStorage.getItem(ACTIVE_ROUTE_KEY);
      if (stored && this.routes.some((r) => r.id === stored)) return stored;
    } catch {}
    return null;
  }

  saveRoutes(newRoutes) {
    this.routes = (Array.isArray(newRoutes) ? newRoutes : []).map(compactRoute);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.routes));
    } catch (e) {
      console.warn('Routen konnten nicht gespeichert werden:', e);
    }
    if (this.activeRouteId && !this.routes.some((r) => r.id === this.activeRouteId)) this.setActiveRouteId(null);
    return this.routes;
  }

  getActiveRoute() {
    if (!this.activeRouteId) return null;
    return this.routes.find((r) => r.id === this.activeRouteId) || null;
  }

  getRoute(id) {
    return this.routes.find((r) => r.id === id) || null;
  }

  setActiveRouteId(id) {
    this.activeRouteId = id && this.routes.some((r) => r.id === id) ? id : null;
    try {
      if (this.activeRouteId) localStorage.setItem(ACTIVE_ROUTE_KEY, this.activeRouteId);
      else localStorage.removeItem(ACTIVE_ROUTE_KEY);
    } catch (e) {
      console.warn('Aktive Route konnte nicht gespeichert werden:', e);
    }
    return this.getActiveRoute();
  }

  /** Ändert die Korridor-Breite einer Route und speichert sie. */
  updateRouteCorridorRadius(id, newRadiusKm) {
    const value = Math.min(10, Math.max(0.5, parseFloat(newRadiusKm) || DEFAULT_CORRIDOR_KM));
    return this.saveRoutes(this.routes.map((r) => (r.id === id ? { ...r, corridorRadiusKm: value } : r)));
  }

  /**
   * Reale Straßenroute zwischen zwei Punkten (OSRM). Fällt bei Ausfall beider Server auf eine
   * Luftlinie zurück und kennzeichnet das Ergebnis mit approximate: true.
   */
  async calculateOsmRoute(start, end) {
    if (!start || !end || !Number.isFinite(Number(start.lat)) || !Number.isFinite(Number(end.lat))) {
      throw new Error('Ungültige Start- oder Zielkoordinaten.');
    }
    for (const base of OSRM_SERVERS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
      try {
        const url = `${base}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) continue;
        const json = await res.json();
        if (json.code !== 'Ok' || !json.routes || json.routes.length === 0) continue;
        const r = json.routes[0];
        const coords = (r.geometry?.coordinates || []).map((c) => [c[1], c[0]]);
        if (coords.length < 2) continue;
        const polylineCoords = simplifyPolyline(coords);
        return {
          success: true,
          approximate: false,
          distanceKm: Math.round(r.distance / 100) / 10,
          durationMin: Math.round(r.duration / 60),
          waypoints: [
            { lat: polylineCoords[0][0], lng: polylineCoords[0][1], name: start.name || 'Start' },
            { lat: polylineCoords[polylineCoords.length - 1][0], lng: polylineCoords[polylineCoords.length - 1][1], name: end.name || 'Ziel' },
          ],
          polylineCoords,
        };
      } catch (err) {
        console.warn('Routing-Server nicht erreichbar:', base, err?.name === 'AbortError' ? 'Zeitüberschreitung' : err);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Fallback: Luftlinie (deutlich gekennzeichnet)
    const directKm = calculateHaversineDistance(start.lat, start.lng, end.lat, end.lng);
    const steps = Math.max(10, Math.min(200, Math.ceil(directKm / 2)));
    const polylineCoords = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      polylineCoords.push([
        Math.round((start.lat + (end.lat - start.lat) * f) * 1e5) / 1e5,
        Math.round((start.lng + (end.lng - start.lng) * f) * 1e5) / 1e5,
      ]);
    }
    const roadKm = Math.round(directKm * 1.25 * 10) / 10;
    return {
      success: true,
      approximate: true,
      distanceKm: roadKm,
      durationMin: Math.round((roadKm / 70) * 60),
      waypoints: [
        { lat: start.lat, lng: start.lng, name: start.name || 'Start' },
        { lat: end.lat, lng: end.lng, name: end.name || 'Ziel' },
      ],
      polylineCoords,
    };
  }

  async addRoute(routeData) {
    let polylineCoords = Array.isArray(routeData.polylineCoords) ? routeData.polylineCoords : [];
    let totalDistKm = Number(routeData.totalDistanceKm) || 0;
    let durationMin = routeData.durationMin || null;
    let approximate = !!routeData.approximate;

    if (routeData.startCoords && routeData.endCoords && polylineCoords.length < 2) {
      const osrm = await this.calculateOsmRoute(routeData.startCoords, routeData.endCoords);
      polylineCoords = osrm.polylineCoords;
      totalDistKm = osrm.distanceKm;
      durationMin = osrm.durationMin;
      approximate = osrm.approximate;
    }
    if (polylineCoords.length > MAX_STORED_POINTS) polylineCoords = simplifyPolyline(polylineCoords);

    const first = polylineCoords[0] || [routeData.startCoords?.lat, routeData.startCoords?.lng];
    const last = polylineCoords[polylineCoords.length - 1] || [routeData.endCoords?.lat, routeData.endCoords?.lng];
    const startCoords = routeData.startCoords || { lat: first[0], lng: first[1] };
    const endCoords = routeData.endCoords || { lat: last[0], lng: last[1] };

    const newRoute = {
      id: `route-${Date.now()}`,
      name: routeData.name || 'Neue Route',
      description: routeData.description || '',
      startName: routeData.startName || 'Start',
      startCoords,
      endName: routeData.endName || 'Ziel',
      endCoords,
      totalDistanceKm: totalDistKm || Math.round(calculateHaversineDistance(startCoords.lat, startCoords.lng, endCoords.lat, endCoords.lng) * 12.5) / 10,
      corridorRadiusKm: parseFloat(routeData.corridorRadiusKm) || DEFAULT_CORRIDOR_KM,
      durationMin,
      approximate,
      isTrip: !!routeData.isTrip,
      createdAt: Date.now(),
      waypoints: [
        { lat: startCoords.lat, lng: startCoords.lng, name: routeData.startName || 'Start' },
        { lat: endCoords.lat, lng: endCoords.lng, name: routeData.endName || 'Ziel' },
      ],
      polylineCoords,
    };

    this.saveRoutes([...this.routes, newRoute]);
    this.setActiveRouteId(newRoute.id);
    return newRoute;
  }

  /** Die aktuell geplante Fahrt (temporäre Route aus "Fahrt planen"), falls vorhanden. */
  getTripRoute() {
    return this.routes.find((r) => r.isTrip) || null;
  }

  /** Ersetzt die bisherige Fahrt durch eine neue und aktiviert sie. */
  async setTripRoute(routeData) {
    this.saveRoutes(this.routes.filter((r) => !r.isTrip));
    return this.addRoute({ ...routeData, isTrip: true });
  }

  /** Beendet die Fahrt: Fahrt-Route entfernen (gespeicherte Routen bleiben). */
  clearTripRoute() {
    const trip = this.getTripRoute();
    if (!trip) return this.routes;
    return this.deleteRoute(trip.id);
  }

  /** Name ändern bzw. eine geplante Fahrt dauerhaft als Route behalten. */
  updateRoute(id, patch = {}) {
    const allowed = {};
    if (typeof patch.name === 'string' && patch.name.trim()) allowed.name = patch.name.trim().slice(0, 80);
    if (patch.isTrip === false) allowed.isTrip = false;
    if (Object.keys(allowed).length === 0) return this.routes;
    return this.saveRoutes(this.routes.map((r) => (r.id === id ? { ...r, ...allowed } : r)));
  }

  deleteRoute(id) {
    const updated = this.saveRoutes(this.routes.filter((r) => r.id !== id));
    if (this.activeRouteId === id) this.setActiveRouteId(null);
    return updated;
  }

  /**
   * Stationen im Korridor der Route, in Fahrtrichtung sortiert.
   * distanceKm = Fahrstrecke ab Routenstart bis zur Station (für Fahrzeit & Ankunftsprognose),
   * queryDistanceKm = Abstand zum Abfragezentrum (Rohwert von Tankerkönig).
   */
  filterStationsByRoute(stations, route = this.getActiveRoute()) {
    if (!route || !Array.isArray(stations) || stations.length === 0) return [];
    const allowedCorridor = parseFloat(route.corridorRadiusKm) || DEFAULT_CORRIDOR_KM;
    const out = [];
    for (const station of stations) {
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) continue;
      const match = findClosestPointOnRoute(station.lat, station.lng, route);
      if (match.minDistanceKm > allowedCorridor) continue;
      // Zusatzweg: abfahren und zurück zur Strecke, mindestens 200 m
      const realAdditionalKm = Math.round(Math.max(0.2, match.minDistanceKm * 2) * 10) / 10;
      const detourMinutes = Math.max(1, Math.round(((match.minDistanceKm * 2) / 35) * 60 + 1));
      let routeSegmentLabel = 'Streckenmitte';
      if (match.progressPct < 25) routeSegmentLabel = 'Startphase';
      else if (match.progressPct > 75) routeSegmentLabel = 'Zielnähe';
      out.push({
        ...station,
        queryDistanceKm: station.queryDistanceKm ?? station.distanceKm,
        distanceKm: Math.round((match.kmAlongRoute + match.minDistanceKm) * 10) / 10,
        routeDetourKm: match.minDistanceKm,
        kmAlongRoute: match.kmAlongRoute,
        progressPct: match.progressPct,
        routeSegmentLabel,
        realAdditionalKm,
        detourMinutes,
        isOnRouteCorridor: true,
      });
    }
    return out.sort((a, b) => a.kmAlongRoute - b.kmAlongRoute);
  }
}

export const routeService = new RouteService();
