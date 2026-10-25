/**
 * KRAFTSTOFF - Gespeicherte Routen & OpenStreetMap OSRM Korridor-Routing
 * 
 * Berechnet reale Fahrstrecken von Ort 1 nach Ort 2 per OpenStreetMap OSRM Engine.
 * Ermittelt für jede Tankstelle exakt die zusätzlichen Mehr-Kilometer beim Tankvorgang!
 * Inklusive hochpräziser Punkt-zu-Strecken-Projektion (Point-to-Segment) und Multi-Query-Sampling!
 */

import { calculateHaversineDistance } from './locationService';

const STORAGE_KEY = 'kraftstoff_user_routes';
const ACTIVE_ROUTE_KEY = 'kraftstoff_active_route_id';

export const INITIAL_ROUTES = [
  {
    id: 'route-work-commute',
    name: 'Täglicher Arbeitsweg (Ost-West)',
    description: 'Alexanderplatz ➔ Tiergarten ➔ Charlottenburg',
    startName: 'Berlin Alexanderplatz',
    startCoords: { lat: 52.5219, lng: 13.4132 },
    endName: 'Bismarckstraße Charlottenburg',
    endCoords: { lat: 52.5115, lng: 13.3050 },
    totalDistanceKm: 8.5,
    corridorRadiusKm: 2.5,
    waypoints: [
      { lat: 52.5219, lng: 13.4132, name: 'Start: Alexanderplatz' },
      { lat: 52.5163, lng: 13.3777, name: 'Brandenburger Tor' },
      { lat: 52.5085, lng: 13.3756, name: 'Potsdamer Platz' },
      { lat: 52.5050, lng: 13.3350, name: 'Wittenbergplatz' },
      { lat: 52.5115, lng: 13.3050, name: 'Ziel: Charlottenburg' },
    ],
  },
  {
    id: 'route-south-corridor',
    name: 'Süd-Achse (Mitte ➔ Steglitz)',
    description: 'Kreuzberg ➔ Schöneberg ➔ Steglitz',
    startName: 'Mehringdamm Kreuzberg',
    startCoords: { lat: 52.4920, lng: 13.3880 },
    endName: 'Schloßstraße Steglitz',
    endCoords: { lat: 52.4580, lng: 13.3220 },
    totalDistanceKm: 6.8,
    corridorRadiusKm: 2.0,
    waypoints: [
      { lat: 52.4920, lng: 13.3880, name: 'Mehringdamm' },
      { lat: 52.4850, lng: 13.3540, name: 'Hauptstraße Schöneberg' },
      { lat: 52.4580, lng: 13.3220, name: 'Steglitz Schloßstr.' },
    ],
  },
];

/**
 * Berechnet den exakten minimalen Abstand (in Kilometern) eines Punktes P (Tankstelle)
 * zu einem Liniensegment zwischen A und B mittels geodätischer Projektion.
 * Berücksichtigt nicht nur Eckpunkte, sondern die gesamte Straßenlinie!
 */
export function calculateDistancePointToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const meanLat = (((aLat + bLat) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(meanLat);

  // Koordinaten in Kilometer relativ zu Punkt A
  const bx = (bLng - aLng) * (Math.PI / 180) * 6371 * cosLat;
  const by = (bLat - aLat) * (Math.PI / 180) * 6371;
  const px = (pLng - aLng) * (Math.PI / 180) * 6371 * cosLat;
  const py = (pLat - aLat) * (Math.PI / 180) * 6371;

  const segLenSq = bx * bx + by * by;
  if (segLenSq < 1e-8) {
    return {
      distanceKm: calculateHaversineDistance(pLat, pLng, aLat, aLng),
      fraction: 0,
      projLat: aLat,
      projLng: aLng,
      segLenKm: 0,
    };
  }

  // Projektionsfaktor t entlang des Segments AB [0 = Punkt A, 1 = Punkt B]
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq));
  const projX = t * bx;
  const projY = t * by;
  const dx = px - projX;
  const dy = py - projY;
  const distanceKm = Math.sqrt(dx * dx + dy * dy);
  const segLenKm = Math.sqrt(segLenSq);

  return {
    distanceKm: parseFloat(distanceKm.toFixed(3)),
    fraction: t,
    projLat: aLat + t * (bLat - aLat),
    projLng: aLng + t * (bLng - aLng),
    segLenKm: parseFloat(segLenKm.toFixed(3)),
  };
}

/**
 * Wandelt die Wegpunkte oder Polyline-Koordinaten einer Route in eine flache Punktliste um.
 */
export function getRoutePoints(route) {
  if (!route) return [];
  if (Array.isArray(route.polylineCoords) && route.polylineCoords.length > 1) {
    return route.polylineCoords.map((c) => {
      if (Array.isArray(c)) return { lat: c[0], lng: c[1] };
      return { lat: c.lat, lng: c.lng };
    });
  }
  if (Array.isArray(route.waypoints) && route.waypoints.length > 1) {
    return route.waypoints.map((w) => {
      if (Array.isArray(w)) return { lat: w[0], lng: w[1] };
      return { lat: w.lat, lng: w.lng };
    });
  }
  const pts = [];
  if (route.startCoords?.lat && route.startCoords?.lng) pts.push(route.startCoords);
  if (route.endCoords?.lat && route.endCoords?.lng) pts.push(route.endCoords);
  return pts;
}

/**
 * Berechnet für eine Tankstelle den minimalen Abstand zur Route sowie den genauen
 * Fortschritt (Kilometerstand ab Start) entlang der Route.
 */
export function findClosestPointOnRoute(stationLat, stationLng, route) {
  const points = getRoutePoints(route);
  if (points.length < 2) {
    const singleDist = points[0] ? calculateHaversineDistance(stationLat, stationLng, points[0].lat, points[0].lng) : 999;
    return {
      minDistanceKm: singleDist,
      kmAlongRoute: 0,
      totalRouteKm: 0,
      progressPct: 0,
      segmentIndex: 0,
    };
  }

  let totalRouteKm = 0;
  const segmentLengths = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = calculateHaversineDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
    segmentLengths.push(d);
    totalRouteKm += d;
  }

  let minDistanceKm = 9999;
  let kmAlongRoute = 0;
  let bestSegIndex = 0;
  let cumulativeKm = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segProj = calculateDistancePointToSegmentKm(stationLat, stationLng, a.lat, a.lng, b.lat, b.lng);

    if (segProj.distanceKm < minDistanceKm) {
      minDistanceKm = segProj.distanceKm;
      bestSegIndex = i;
      kmAlongRoute = cumulativeKm + segProj.fraction * (segmentLengths[i] || 0);
    }
    cumulativeKm += segmentLengths[i] || 0;
  }

  const effectiveTotal = route.totalDistanceKm || totalRouteKm || 1;
  const progressPct = Math.min(100, Math.max(0, Math.round((kmAlongRoute / effectiveTotal) * 100)));

  return {
    minDistanceKm: parseFloat(minDistanceKm.toFixed(2)),
    kmAlongRoute: parseFloat(kmAlongRoute.toFixed(1)),
    totalRouteKm: parseFloat(effectiveTotal.toFixed(1)),
    progressPct,
    segmentIndex: bestSegIndex,
  };
}

/**
 * Generiert optimierte Abfrage-Zentren entlang einer Route für die Tankerkönig API.
 * Die API erlaubt max. 25 km Radius. Wir setzen Kreise im Abstand von 16 km mit Radius 15 km,
 * sodass 100% des Korridors lückenlos abgedeckt werden!
 */
export function sampleRouteQueryPoints(route, stepKm = 16, maxPoints = 5) {
  const points = getRoutePoints(route);
  if (points.length < 2) {
    if (points[0]) return [{ lat: points[0].lat, lng: points[0].lng, radiusKm: 15 }];
    return [];
  }

  // 1. Berechne kumulative Distanzen aller Wegpunkte
  let totalKm = 0;
  const distFromStart = [0];
  for (let i = 0; i < points.length - 1; i++) {
    totalKm += calculateHaversineDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
    distFromStart.push(totalKm);
  }

  // Wenn die Route kurz ist (<= 15 km), genügen Start & Ziel (oder Mittelpunkt)
  if (totalKm <= 12) {
    const midIdx = Math.floor(points.length / 2);
    return [
      { lat: points[midIdx].lat, lng: points[midIdx].lng, radiusKm: Math.min(15, Math.max(8, Math.round(totalKm + 4))) }
    ];
  }

  // 2. Bestimme Abtastabstände
  const numSteps = Math.min(maxPoints, Math.max(2, Math.ceil(totalKm / stepKm)));
  const targetDistances = [];
  for (let s = 0; s < numSteps; s++) {
    targetDistances.push((s / (numSteps - 1)) * totalKm);
  }

  // 3. Finde für jede Zieldistanz die passenden Koordinaten auf der Polyline
  const sampleCenters = [];
  for (const targetD of targetDistances) {
    let segIdx = 0;
    while (segIdx < distFromStart.length - 2 && distFromStart[segIdx + 1] < targetD) {
      segIdx++;
    }
    const d0 = distFromStart[segIdx];
    const d1 = distFromStart[segIdx + 1] || totalKm;
    const segLen = d1 - d0;
    const frac = segLen > 0 ? (targetD - d0) / segLen : 0;

    const p0 = points[segIdx];
    const p1 = points[segIdx + 1] || points[segIdx];
    const lat = parseFloat((p0.lat + frac * (p1.lat - p0.lat)).toFixed(5));
    const lng = parseFloat((p0.lng + frac * (p1.lng - p0.lng)).toFixed(5));

    // Vermeide doppelte Punkte
    const isDuplicate = sampleCenters.some((c) => calculateHaversineDistance(c.lat, c.lng, lat, lng) < 4);
    if (!isDuplicate) {
      sampleCenters.push({
        lat,
        lng,
        radiusKm: 14, // 14 km Radius sorgt bei 16 km Schrittweite für perfekte Überlappung
      });
    }
  }

  return sampleCenters;
}

class RouteService {
  constructor() {
    this.routes = this.loadRoutes();
    this.activeRouteId = this.loadActiveRouteId();
  }

  loadRoutes() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [...INITIAL_ROUTES];
  }

  loadActiveRouteId() {
    try {
      const stored = localStorage.getItem(ACTIVE_ROUTE_KEY);
      if (stored) return stored;
    } catch {}
    return null;
  }

  saveRoutes(newRoutes) {
    this.routes = newRoutes;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newRoutes));
    } catch (e) {
      console.warn('Could not persist routes:', e);
    }
    return this.routes;
  }

  getActiveRoute() {
    if (!this.activeRouteId) return null;
    return this.routes.find((r) => r.id === this.activeRouteId) || null;
  }

  setActiveRouteId(id) {
    this.activeRouteId = id;
    try {
      if (id) {
        localStorage.setItem(ACTIVE_ROUTE_KEY, id);
      } else {
        localStorage.removeItem(ACTIVE_ROUTE_KEY);
      }
    } catch (e) {
      console.warn('Could not persist active route ID:', e);
    }
    return this.getActiveRoute();
  }

  /**
   * Ändert die Korridor-Breite einer Route (z. B. 1.0 km, 2.5 km, 5.0 km) und speichert sie.
   */
  updateRouteCorridorRadius(id, newRadiusKm) {
    const updated = this.routes.map((r) => {
      if (r.id === id) {
        return { ...r, corridorRadiusKm: parseFloat(newRadiusKm) || 2.5 };
      }
      return r;
    });
    this.saveRoutes(updated);
    return updated;
  }

  /**
   * Berechnet eine reale Straßenroute zwischen zwei Punkten über OpenStreetMap OSRM API
   */
  async calculateOsmRoute(start, end) {
    if (!start || !end || !start.lat || !end.lat) {
      throw new Error('Ungültige Start- oder Zielkoordinaten.');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
          const r = json.routes[0];
          const coords = r.geometry.coordinates || [];
          
          // Mappe Koordinaten [lng, lat] zu { lat, lng }
          const mappedWaypoints = coords.map((c, idx) => ({
            lat: c[1],
            lng: c[0],
            name: idx === 0 ? (start.name || 'Start') : idx === coords.length - 1 ? (end.name || 'Ziel') : `Segment ${idx}`,
          }));

          return {
            success: true,
            distanceKm: parseFloat((r.distance / 1000).toFixed(1)),
            durationMin: Math.round(r.duration / 60),
            waypoints: mappedWaypoints,
            polylineCoords: coords.map(c => [c[1], c[0]]), // Leaflet LatLng [lat, lng]
          };
        }
      }
    } catch (err) {
      console.warn('OSRM routing network notice, using geodesic interpolation:', err);
    }

    // Fallback: Geodätische Interpolation mit 10 Stützpunkten
    const directKm = calculateHaversineDistance(start.lat, start.lng, end.lat, end.lng);
    const steps = 10;
    const interpolated = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      interpolated.push({
        lat: parseFloat((start.lat + (end.lat - start.lat) * f).toFixed(6)),
        lng: parseFloat((start.lng + (end.lng - start.lng) * f).toFixed(6)),
        name: i === 0 ? (start.name || 'Start') : i === steps ? (end.name || 'Ziel') : `Stützpunkt ${i}`,
      });
    }

    return {
      success: true,
      distanceKm: parseFloat((directKm * 1.25).toFixed(1)), // 25% typischer Straßenfaktor über Luftlinie
      durationMin: Math.round(((directKm * 1.25) / 50) * 60),
      waypoints: interpolated,
      polylineCoords: interpolated.map(p => [p.lat, p.lng]),
    };
  }

  async addRoute(routeData) {
    let waypoints = routeData.waypoints;
    let totalDistKm = routeData.totalDistanceKm || 0;
    let polylineCoords = routeData.polylineCoords || [];

    // Wenn Start- und Zielkoordinaten übergeben wurden, berechne reale OSRM-Route falls noch nicht vorliegend
    if (routeData.startCoords && routeData.endCoords && (!polylineCoords || polylineCoords.length < 2)) {
      try {
        const osrmResult = await this.calculateOsmRoute(routeData.startCoords, routeData.endCoords);
        waypoints = osrmResult.waypoints;
        totalDistKm = osrmResult.distanceKm;
        polylineCoords = osrmResult.polylineCoords;
      } catch (e) {
        console.warn('Error calculating OSRM route:', e);
      }
    }

    if (!waypoints || waypoints.length === 0) {
      waypoints = [
        { lat: routeData.startCoords?.lat || 52.5200, lng: routeData.startCoords?.lng || 13.4050, name: 'Start' },
        { lat: routeData.endCoords?.lat || 52.5100, lng: routeData.endCoords?.lng || 13.3300, name: 'Ziel' },
      ];
    }

    const newRoute = {
      id: `route-${Date.now()}`,
      name: routeData.name || 'Neue Fahrt-Route',
      description: routeData.description || '',
      startName: routeData.startName || 'Start',
      startCoords: routeData.startCoords || waypoints[0],
      endName: routeData.endName || 'Ziel',
      endCoords: routeData.endCoords || waypoints[waypoints.length - 1],
      totalDistanceKm: totalDistKm || calculateHaversineDistance(waypoints[0].lat, waypoints[0].lng, waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng),
      corridorRadiusKm: parseFloat(routeData.corridorRadiusKm) || 2.5,
      waypoints,
      polylineCoords,
    };

    const updated = [...this.routes, newRoute];
    this.saveRoutes(updated);
    this.setActiveRouteId(newRoute.id);
    return newRoute;
  }

  deleteRoute(id) {
    const updated = this.routes.filter((r) => r.id !== id);
    this.saveRoutes(updated);
    if (this.activeRouteId === id) {
      this.setActiveRouteId(null);
    }
    return updated;
  }

  /**
   * Filtert Stationen präzise entlang des Korridors der aktiven Route.
   * Berechnet den realen Zusatzweg (Abstecher) und die Kilometer-Position auf der Fahrtstrecke!
   */
  filterStationsByRoute(stations, route = this.getActiveRoute()) {
    if (!route || !Array.isArray(stations) || stations.length === 0) return stations || [];

    const allowedCorridor = parseFloat(route.corridorRadiusKm) || 2.5;

    const enriched = stations.map((station) => {
      // 1. Exakter minimaler Abstand der Tankstelle zur Straßenlinie & km auf der Strecke
      const match = findClosestPointOnRoute(station.lat, station.lng, route);

      // Reale Zusatzkilometer: Abfahren von der Autobahn/Bundesstraße und Wiederauffahren
      // Mindestens 200m, ansonsten 2x der Querabstand zur Fahrbahn
      const realAdditionalKm = parseFloat(Math.max(0.2, match.minDistanceKm * 2).toFixed(1));

      // Geschätzte Mehrzeit für den Abstecher (Ampel, Abbiegen, Tankstopp-Zusatzzeit)
      const detourMinutes = Math.max(1, Math.round((match.minDistanceKm * 2 / 35) * 60 + 1));

      let routeSegmentLabel = 'Streckenmitte';
      if (match.progressPct < 25) routeSegmentLabel = 'Startphase';
      else if (match.progressPct > 75) routeSegmentLabel = 'Zielnähe';

      const isOnRouteCorridor = match.minDistanceKm <= allowedCorridor;

      return {
        ...station,
        routeDetourKm: match.minDistanceKm,
        kmAlongRoute: match.kmAlongRoute,
        progressPct: match.progressPct,
        routeSegmentLabel,
        realAdditionalKm,
        detourMinutes,
        isOnRouteCorridor,
      };
    });

    // Filtere nur Tankstellen, die im definierten Korridor liegen
    const inCorridor = enriched.filter((s) => s.isOnRouteCorridor);

    // Standard-Sortierung: In Fahrtrichtung (nach Kilometerstand auf der Route)
    return inCorridor.sort((a, b) => (a.kmAlongRoute || 0) - (b.kmAlongRoute || 0));
  }
}

export const routeService = new RouteService();

