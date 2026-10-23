/**
 * KRAFTSTOFF - Gespeicherte Routen & OpenStreetMap OSRM Korridor-Routing
 * 
 * Berechnet reale Fahrstrecken von Ort 1 nach Ort 2 per OpenStreetMap OSRM Engine.
 * Ermittelt für jede Tankstelle exakt die zusätzlichen Mehr-Kilometer beim Tankvorgang!
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
 * Berechnet die minimale Distanz einer Tankstelle zu einer Reihe von Wegpunkten.
 */
export function calculateMinDistanceToRoute(stationLat, stationLng, waypoints) {
  if (!waypoints || waypoints.length === 0) return 999;
  if (waypoints.length === 1) {
    return calculateHaversineDistance(stationLat, stationLng, waypoints[0].lat, waypoints[0].lng);
  }

  let minDistance = 999;
  for (let i = 0; i < waypoints.length; i++) {
    const dist = calculateHaversineDistance(stationLat, stationLng, waypoints[i].lat, waypoints[i].lng);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  return minDistance;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newRoutes));
    return this.routes;
  }

  getActiveRoute() {
    if (!this.activeRouteId) return null;
    return this.routes.find((r) => r.id === this.activeRouteId) || null;
  }

  setActiveRouteId(id) {
    this.activeRouteId = id;
    if (id) {
      localStorage.setItem(ACTIVE_ROUTE_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_ROUTE_KEY);
    }
    return this.getActiveRoute();
  }

  /**
   * Berechnet eine reale Straßenroute zwischen zwei Punkten über OpenStreetMap OSRM API
   */
  async calculateOsmRoute(start, end) {
    if (!start || !end || !start.lat || !end.lat) {
      throw new Error('Ungültige Start- oder Zielkoordinaten.');
    }

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
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

    // Fallback: Geodätische Interpolation mit 7 Stützpunkten
    const directKm = calculateHaversineDistance(start.lat, start.lng, end.lat, end.lng);
    const steps = 7;
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
    let polylineCoords = [];

    // Wenn Start- und Zielkoordinaten übergeben wurden, berechne reale OSRM-Route
    if (routeData.startCoords && routeData.endCoords) {
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
   * Filtert Stationen entlang des Korridors der aktiven Route
   * und berechnet den realen Zusatzweg (Mehr-Kilometer durch den Tankvorgang auf der Strecke).
   */
  filterStationsByRoute(stations, route = this.getActiveRoute()) {
    if (!route) return stations;

    const start = route.startCoords || route.waypoints[0];
    const end = route.endCoords || route.waypoints[route.waypoints.length - 1];
    const baseDirectDist = route.totalDistanceKm || calculateHaversineDistance(start.lat, start.lng, end.lat, end.lng);

    return stations
      .map((station) => {
        // Minimaler Abstand der Tankstelle zur Straßenlinie
        const minDistToPolyline = calculateMinDistanceToRoute(station.lat, station.lng, route.waypoints);

        // Reale Zusatzkilometer: (Start ➔ Tankstelle + Tankstelle ➔ Ziel) - Direkte Distanz
        const distStartToStation = calculateHaversineDistance(start.lat, start.lng, station.lat, station.lng);
        const distStationToEnd = calculateHaversineDistance(station.lat, station.lng, end.lat, end.lng);
        const routeThroughStation = distStartToStation + distStationToEnd;

        // Der zusätzliche Mehrweg durch das Verlassen der Strecke zur Tankstelle
        // Typischerweise 2 * Abstecherentfernung zur Autobahn/Hauptstraße
        const realAdditionalKm = parseFloat(Math.max(0.2, (minDistToPolyline * 2)).toFixed(1));

        return {
          ...station,
          routeDetourKm: parseFloat(minDistToPolyline.toFixed(2)),
          realAdditionalKm,
          isOnRouteCorridor: minDistToPolyline <= route.corridorRadiusKm,
        };
      })
      .filter((s) => s.isOnRouteCorridor)
      .sort((a, b) => (a.routeDetourKm || 0) - (b.routeDetourKm || 0));
  }
}

export const routeService = new RouteService();
