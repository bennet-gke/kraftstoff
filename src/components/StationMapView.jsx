import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Navigation,
  Sparkles,
  MapPin,
  Sliders,
  LocateFixed,
  X,
  ChevronDown,
  ChevronUp,
  Car,
  Layers,
  Star,
  Key,
  Compass,
  Route as RouteIcon,
  RefreshCw,
  ChevronsUp,
} from 'lucide-react';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { QUICK_CITIES, calculateHaversineDistance } from '../services/locationService';
import { CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from '../services/routeService';
import { navigateToStation, resolveNavApp, navAppLabel } from '../services/navHandoff';
import { fmtNum } from '../utils/format';

// Karten-Modi: Ort / Route / Favoriten spiegeln den Radar, "Erkunden" zeigt alle Tankstellen im Kartenausschnitt
const MAP_MODES = [
  { id: 'location', label: 'Ort', Icon: MapPin, title: 'Standort-Modus' },
  { id: 'route', label: 'Route', Icon: Navigation, title: 'Routen-Modus' },
  { id: 'favorites', label: 'Favoriten', Icon: Star, title: 'Favoriten-Modus' },
  { id: 'explore', label: 'Erkunden', Icon: Compass, title: 'Alle Tankstellen im Kartenausschnitt – einfach umsehen' },
];
const EXPLORE_MAX_MARKERS = 220;
const EXPLORE_CACHE_MS = 5 * 60 * 1000;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Farbton eines Preis-Chips: Abstand zum Regionsmedian (ct). Grün = günstig, Rot = teuer, Weiß = Mittelfeld,
 * helle Varianten für leichte Abweichungen, Grau = geschlossen.
 */
function priceTone(st) {
  if (st.isOpen === false) return { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1', level: 'closed' };
  const delta = Number.isFinite(st.deltaToRegionCent) ? st.deltaToRegionCent : st.evaluation?.isCheap ? -2 : 0;
  if (delta <= -1.0) return { bg: '#059669', color: '#FFFFFF', border: '#FFFFFF', level: 'cheap' };
  if (delta >= 1.0) return { bg: '#DC2626', color: '#FFFFFF', border: '#FFFFFF', level: 'expensive' };
  if (delta <= -0.4) return { bg: '#D1FAE5', color: '#065F46', border: '#FFFFFF', level: 'slightly-cheap' };
  if (delta >= 0.4) return { bg: '#FEE2E2', color: '#991B1B', border: '#FFFFFF', level: 'slightly-expensive' };
  return { bg: '#FFFFFF', color: '#0F172A', border: '#FFFFFF', level: 'neutral' };
}

/**
 * Preis-Chip als Leaflet-DivIcon. Der Icon-Rahmen ist 0×0 und sitzt exakt auf der Station,
 * der Chip selbst zentriert sich per CSS darüber – so stimmt die Position auch bei langen Namen.
 */
function buildStationChipIcon(st, { isSelected = false, isFavorite = false } = {}) {
  const tone = priceTone(st);
  const isClosed = st.isOpen === false;
  const priceStr = Number.isFinite(st.currentPrice) ? fmtNum(st.currentPrice, 3) : '–';
  const brand = escapeHtml(st.brand || 'Frei');
  const bg = isSelected ? '#0F172A' : tone.bg;
  const color = isSelected ? '#FFFFFF' : tone.color;
  const border = isSelected ? '#38BDF8' : isFavorite ? '#F59E0B' : tone.border;
  return L.divIcon({
    className: 'station-price-chip-wrap',
    html: `
      <div class="station-chip${isSelected ? ' is-selected' : ''}${isClosed ? ' is-closed' : ''}" style="background:${bg};color:${color};border-color:${border};" title="${escapeHtml(st.name || '')}">
        <span class="station-chip-brand">${isFavorite ? '★ ' : ''}${brand}${isClosed ? ' (zu)' : ''}</span>
        <span class="station-chip-price">${priceStr} €</span>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function buildLocationIcon() {
  return L.divIcon({
    className: 'custom-loc-marker',
    html: `
      <div style="background: #0F172A; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(15,23,42,0.4); border: 2.5px solid white;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// 100% kostenlose, kartenstabile Tile-Provider ohne API-Key
const MAP_PROVIDERS = {
  osm: {
    id: 'osm',
    name: 'Bunt (OSM)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  esriStreet: {
    id: 'esriStreet',
    name: 'Clean (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  esriSat: {
    id: 'esriSat',
    name: 'Satellit',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Maxar, Earthstar',
    maxZoom: 19,
  },
};

export default function StationMapView({
  stations = [],
  locations = [],
  activeLocation,
  onSelectLocation,
  onSelectQuickCity,
  onUpdateRadius,
  onLocateGps,
  activeRoute,
  routes = [],
  onSelectRoute,
  onUpdateRouteCorridorRadius,
  filterMode = 'location',
  onSelectFilterMode,
  favoriteStationIds = [],
  onToggleFavorite,
  activeVehicle,
  vehicles = [],
  onSelectVehicle,
  fuelType = 'diesel',
  onSelectFuel,
  selectedStation,
  onSelectStation,
  onCloseSelectedStation,
  onOpenStationDetails,
  hasValidApiKey = true,
  onOpenSettings,
  onExploreArea,
  onPlanTrip,
  navApp = 'apple',
  fillLiters = null,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const tileLayerRef = useRef(null);
  // Zuletzt eingepasster Bereich – wird beim Neuanlegen der Karte zurückgesetzt
  const lastViewKeyRef = useRef(null);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const [isToolbarHidden, setIsToolbarHidden] = useState(false);
  const [mapMode, setMapMode] = useState(() => filterMode || (activeRoute ? 'route' : 'location'));

  // Erkunden-Modus: alle Tankstellen im Kartenausschnitt (eigener Datensatz, Radar/Trends bleiben unberührt)
  const [exploreStations, setExploreStations] = useState([]);
  const [exploreStatus, setExploreStatus] = useState({ loading: false, count: 0, total: 0, radiusKm: null, median: null, error: null, tooFar: false, capped: false });
  const mapModeRef = useRef(mapMode);
  const exploreRef = useRef(null);
  const exploreCacheRef = useRef(new Map());
  const exploreTimerRef = useRef(null);
  const exploreSeqRef = useRef(0);

  // Halte mapMode synchron mit filterMode (außer im Erkunden-Modus, der rein die Karte betrifft)
  useEffect(() => {
    setMapMode((prev) => (prev === 'explore' ? prev : filterMode || (activeRoute ? 'route' : 'location')));
  }, [filterMode, activeRoute]);

  const handleSelectMode = (id) => {
    setMapMode(id);
    if (id === 'explore') return;
    if (id === 'location') {
      if (onSelectFilterMode) onSelectFilterMode('location');
    } else if (id === 'route') {
      if (onSelectFilterMode) onSelectFilterMode('route');
    } else if (id === 'favorites') {
      if (onSelectFilterMode) onSelectFilterMode('favorites');
    }
  };

  const applyExplore = (list, { radiusKm, tooFar, center, error = null, fromCache = false }) => {
    const prices = list.map((st) => st.currentPrice).filter((p) => Number.isFinite(p)).sort((a, b) => a - b);
    const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    let enriched = list.map((st) => ({
      ...st,
      distanceKm: activeLocation?.lat && activeLocation?.lng
        ? Math.round(calculateHaversineDistance(activeLocation.lat, activeLocation.lng, st.lat, st.lng) * 10) / 10
        : st.distanceKm,
      exploreDistanceKm: Math.round(calculateHaversineDistance(center.lat, center.lng, st.lat, st.lng) * 10) / 10,
      deltaToRegionCent: median ? Math.round((st.currentPrice - median) * 1000) / 10 : 0,
    }));
    let capped = false;
    if (enriched.length > EXPLORE_MAX_MARKERS) {
      enriched = [...enriched].sort((a, b) => a.exploreDistanceKm - b.exploreDistanceKm).slice(0, EXPLORE_MAX_MARKERS);
      capped = true;
    }
    setExploreStations(enriched);
    setExploreStatus({ loading: false, count: enriched.length, total: list.length, radiusKm, median, error, tooFar, capped, fromCache, at: Date.now() });
  };

  // Tankstellen im aktuellen Kartenausschnitt laden (entprellt über moveend, 5 Minuten Cache je Ausschnitt)
  const runExplore = async (force = false) => {
    const map = mapInstanceRef.current;
    if (!map || !onExploreArea) return;
    const center = map.getCenter();
    const ne = map.getBounds().getNorthEast();
    const cornerKm = calculateHaversineDistance(center.lat, center.lng, ne.lat, ne.lng);
    const tooFar = cornerKm > 25;
    const radiusKm = Math.min(25, Math.max(2, Math.ceil(cornerKm)));
    const key = `${fuelType}_${center.lat.toFixed(2)}_${center.lng.toFixed(2)}_${radiusKm}`;
    const cached = exploreCacheRef.current.get(key);
    const seq = ++exploreSeqRef.current;
    if (!force && cached && Date.now() - cached.at < EXPLORE_CACHE_MS) {
      applyExplore(cached.stations, { radiusKm, tooFar, center, fromCache: true });
      return;
    }
    setExploreStatus((st) => ({ ...st, loading: true, tooFar, radiusKm, error: null }));
    try {
      const res = await onExploreArea(center.lat, center.lng, radiusKm);
      if (seq !== exploreSeqRef.current) return;
      const list = Array.isArray(res?.stations) ? res.stations : [];
      exploreCacheRef.current.set(key, { at: Date.now(), stations: list });
      applyExplore(list, { radiusKm, tooFar, center, error: res?.error || null });
    } catch (e) {
      if (seq === exploreSeqRef.current) setExploreStatus((st) => ({ ...st, loading: false, error: e?.message || String(e) }));
    }
  };
  // Aktuelle Werte für Leaflet-Ereignisse (moveend) bereithalten, ohne Listener neu zu registrieren
  useEffect(() => {
    mapModeRef.current = mapMode;
    exploreRef.current = runExplore;
  });

  useEffect(() => {
    if (mapMode !== 'explore') return undefined;
    const t = setTimeout(() => exploreRef.current && exploreRef.current(false), 60);
    return () => clearTimeout(t);
  }, [mapMode, fuelType]);

  // Im Erkunden-Modus folgt die Karte einem neu gewählten Standort (z.B. GPS), sonst übernimmt der Haupt-Effekt
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && mapModeRef.current === 'explore' && activeLocation?.lat && activeLocation?.lng) {
      map.setView([activeLocation.lat, activeLocation.lng], Math.max(map.getZoom(), 12));
    }
  }, [activeLocation?.id, activeLocation?.lat, activeLocation?.lng]);

  const [mapProvider, setMapProvider] = useState(() => {
    try {
      return localStorage.getItem('tank_app_map_style') || 'osm';
    } catch {
      return 'osm';
    }
  });

  const handleSelectMapProvider = (newProvider) => {
    setMapProvider(newProvider);
    try {
      localStorage.setItem('tank_app_map_style', newProvider);
    } catch {}
  };

  // Initialisiere Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const centerLat = activeLocation?.lat || 52.5200;
    const centerLng = activeLocation?.lng || 13.4050;

    const map = L.map(mapContainerRef.current, {
      center: [centerLat, centerLng],
      zoom: 12,
      zoomControl: false,
    });

    // Initialer Kachel-Layer: OpenStreetMap (Standard: 100% kostenlos, bunt, ohne API-Key)
    const initialProv = MAP_PROVIDERS[mapProvider] || MAP_PROVIDERS.osm;
    const tileLayer = L.tileLayer(initialProv.url, {
      attribution: initialProv.attribution,
      maxZoom: initialProv.maxZoom,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    // Erkunden: nach jedem Verschieben/Zoomen den Ausschnitt nachladen (entprellt)
    map.on('moveend', () => {
      if (mapModeRef.current !== 'explore') return;
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
      exploreTimerRef.current = setTimeout(() => exploreRef.current && exploreRef.current(false), 650);
    });

    // Erneute Größenberechnung nach Rendering & bei Window-Resize
    const handleResize = () => {
      if (map) map.invalidateSize();
    };
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 150);
    const timer2 = setTimeout(handleResize, 400);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      clearTimeout(timer2);
      if (exploreTimerRef.current) clearTimeout(exploreTimerRef.current);
      try {
        map.remove();
      } catch {}
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
      lastViewKeyRef.current = null;
    };
    // Karte nur einmal anlegen; Ansicht, Ebenen und Kartenstil folgen in eigenen Effekten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamischer Kartenstil-Wechsel (OSM Bunt / Esri Clean / Satellit)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      try {
        map.removeLayer(tileLayerRef.current);
      } catch {}
    }
    const prov = MAP_PROVIDERS[mapProvider] || MAP_PROVIDERS.osm;
    const newLayer = L.tileLayer(prov.url, {
      attribution: prov.attribution,
      maxZoom: prov.maxZoom,
    }).addTo(map);
    if (newLayer.bringToBack) {
      newLayer.bringToBack();
    }
    tileLayerRef.current = newLayer;
  }, [mapProvider]);

  // Kartenausschnitt nur anpassen, wenn sich der Bereich ändert (Modus, Ort/Radius, Route) – nicht beim
  // Antippen einer Station, bei neuen Preisen oder anderen Neuzeichnungen.
  const routeLatLngs = (r) => {
    if (!r) return null;
    if (Array.isArray(r.polylineCoords) && r.polylineCoords.length > 1) return r.polylineCoords;
    if (Array.isArray(r.waypoints) && r.waypoints.length > 1) return r.waypoints.map((wp) => [wp.lat, wp.lng]);
    return null;
  };
  const viewKey = mapMode === 'explore'
    ? 'explore'
    : mapMode === 'route' && activeRoute
      ? `route:${activeRoute.id}`
      : mapMode === 'favorites'
        ? `fav:${stations.length}`
        : `loc:${activeLocation?.id}:${activeLocation?.radiusKm}:${activeLocation?.lat}:${activeLocation?.lng}`;

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || lastViewKeyRef.current === viewKey) return undefined;
    lastViewKeyRef.current = viewKey;
    let cancelled = false;
    let tries = 0;
    let timer = null;
    const apply = () => {
      if (cancelled || mapInstanceRef.current !== map) return;
      map.invalidateSize();
      const size = map.getSize();
      // Container noch ohne Größe (z. B. direkt nach dem Nachladen): kurz warten statt falsch einzupassen
      if ((size.x < 50 || size.y < 50) && tries++ < 15) {
        timer = setTimeout(apply, 100);
        return;
      }
      if (mapMode === 'explore') return;
      const latlngs = mapMode === 'route' ? routeLatLngs(activeRoute) : null;
      if (latlngs) {
        try { map.fitBounds(L.latLngBounds(latlngs), { padding: [45, 45], maxZoom: 14 }); } catch {}
        return;
      }
      if (mapMode === 'favorites' && stations.length > 0) {
        try { map.fitBounds(L.latLngBounds(stations.map((st) => [st.lat, st.lng])), { padding: [40, 40], maxZoom: 14 }); } catch {}
        return;
      }
      if (activeLocation && activeLocation.lat && activeLocation.lng) {
        const rad = activeLocation.radiusKm || 5;
        const targetZoom = rad <= 3 ? 13 : rad <= 7 ? 12 : rad <= 14 ? 11 : 10;
        map.setView([activeLocation.lat, activeLocation.lng], targetZoom);
      }
    };
    apply();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // Ebenen zeichnen: Standort, Route, Preis-Chips
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    const isExplore = mapMode === 'explore';
    const drawStations = isExplore ? exploreStations : stations;
    const routeLine = !isExplore && mapMode === 'route' ? routeLatLngs(activeRoute) : null;

    // 1. Standort (mit Suchradius im Ort-Modus)
    if (activeLocation && activeLocation.lat && activeLocation.lng && !routeLine) {
      L.marker([activeLocation.lat, activeLocation.lng], { icon: buildLocationIcon() })
        .bindPopup(`
          <div style="font-family: var(--font-sans, sans-serif); padding: 4px;">
            <strong style="color: #0F172A; font-size: 13px;">${escapeHtml(activeLocation.name)}</strong><br>
            <span style="color: #64748B; font-size: 11px;">${escapeHtml(activeLocation.address || 'Zentrum')}</span>
            ${!isExplore && mapMode === 'location' ? `<br><span style="font-size: 11px; font-weight: 700; color: #0284C7;">Suchradius: ${escapeHtml(activeLocation.radiusKm)} km</span>` : ''}
          </div>
        `)
        .addTo(layerGroup);
      if (!isExplore && mapMode === 'location') {
        L.circle([activeLocation.lat, activeLocation.lng], {
          radius: (activeLocation.radiusKm || 5) * 1000,
          color: '#0F172A',
          weight: 1.5,
          dashArray: '5, 6',
          fillColor: '#0F172A',
          fillOpacity: 0.03,
          interactive: false,
        }).addTo(layerGroup);
      }
    }

    // 2. Aktive Route mit Korridor, Start und Ziel
    if (routeLine) {
      const corridorKm = activeRoute.corridorRadiusKm || DEFAULT_CORRIDOR_KM;
      L.polyline(routeLine, {
        color: '#2563EB',
        weight: Math.min(50, Math.max(14, corridorKm * 14)),
        opacity: 0.14,
        lineCap: 'round',
        interactive: false,
      }).addTo(layerGroup);
      L.polyline(routeLine, {
        color: '#2563EB',
        weight: 3.5,
        opacity: 0.88,
        dashArray: activeRoute.approximate ? '2, 8' : null,
        interactive: false,
      }).addTo(layerGroup);

      const flag = (pt, label, bg, title) => {
        const lat = pt?.lat ?? (Array.isArray(pt) ? pt[0] : null);
        const lng = pt?.lng ?? (Array.isArray(pt) ? pt[1] : null);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'route-flag',
            html: `<div style="background: ${bg}; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; box-shadow: 0 4px 10px rgba(15,23,42,0.3); border: 2px solid white;">${label}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
          .bindPopup(`<strong style="font-size: 12px;">${escapeHtml(title)}</strong>`)
          .addTo(layerGroup);
      };
      flag(activeRoute.startCoords || routeLine[0], 'A', '#059669', `Start: ${activeRoute.startName || 'Start'}`);
      flag(activeRoute.endCoords || routeLine[routeLine.length - 1], 'B', '#DC2626', `Ziel: ${activeRoute.endName || 'Ziel'}`);
    }

    // 3. Tankstellen als Preis-Chips in Ampelfarben
    drawStations.forEach((st) => {
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) return;
      const isSelected = selectedStation?.id === st.id;
      const isFavorite = favoriteStationIds.includes(st.id);
      const marker = L.marker([st.lat, st.lng], {
        icon: buildStationChipIcon(st, { isSelected, isFavorite }),
        zIndexOffset: isSelected ? 1000 : priceTone(st).level === 'cheap' ? 200 : 0,
        keyboard: false,
      }).addTo(layerGroup);
      marker.on('click', () => {
        if (onSelectStation) onSelectStation(st);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, activeLocation, activeRoute, selectedStation, onSelectStation, favoriteStationIds, mapMode, exploreStations]);

  const preferredNav = resolveNavApp(navApp);
  const openNavigation = (st) => navigateToStation(st, navApp);

  // Basistankstelle für das gewählte Element (im Erkunden-Modus aus dem Kartenausschnitt)
  const visibleStations = mapMode === 'explore' ? exploreStations : stations;
  const sortedByDist = [...visibleStations].filter((st) => st.isOpen !== false).sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  const baseStation = sortedByDist[0];

  const selectedDetour = selectedStation && !selectedStation.detour ? calculateDetourProfitability({
    targetPrice: selectedStation.currentPrice,
    targetDistanceKm: selectedStation.distanceKm ?? 0,
    basePrice: baseStation ? baseStation.currentPrice : selectedStation.currentPrice,
    baseDistanceKm: baseStation ? baseStation.distanceKm ?? 0 : 0,
    fillLiters: Number.isFinite(fillLiters) ? fillLiters : 40,
    consumptionL100km: activeVehicle?.consumptionL100km || 6.2,
  }) : selectedStation?.detour || null;

  return (
    <div className="full-screen-map-wrapper">
      
      {/* 1. Leaflet Map Canvas (100vw x 100vh Full Screen) */}
      <div ref={mapContainerRef} className="full-screen-leaflet-map" />

      {/* 2. Ethereal Soft White Vignette Overlay (Sanfter weißer Randverlauf an allen Bildschirmrändern) */}
      <div className="map-vignette-overlay" aria-hidden="true" />

      {/* Warnung bei fehlendem API-Key auf der Karte */}
      {!hasValidApiKey && (
        <div
          style={{
            position: 'absolute',
            top: '78px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1.5px solid #FCD34D',
            borderRadius: '14px',
            padding: '0.75rem 1.15rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            maxWidth: '92%',
          }}
        >
          <div style={{ background: '#FEF3C7', padding: '0.35rem', borderRadius: '8px', color: '#D97706', display: 'flex' }}>
            <Key size={16} />
          </div>
          <div style={{ fontSize: '0.78rem', color: '#1E293B' }}>
            <strong>Keine Tankstellen auf Karte:</strong> Tankerkönig API-Key erforderlich.
          </div>
          {onOpenSettings && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onOpenSettings}
              style={{ fontSize: '0.74rem', padding: '0.32rem 0.75rem', borderRadius: '9999px', whiteSpace: 'nowrap' }}
            >
              ⚙️ Key eingeben
            </button>
          )}
        </div>
      )}

      {/* 3a. Eingeklapptes Menü: kleine Pille mit Modus & Sorte */}
      {isToolbarHidden && (
        <button type="button" className="map-toolbar-pill" onClick={() => setIsToolbarHidden(false)} title="Menü einblenden">
          {(() => {
            const Icon = (MAP_MODES.find((m) => m.id === mapMode) || MAP_MODES[0]).Icon;
            return <Icon size={12} />;
          })()}
          <span>
            {mapMode === 'location'
              ? `${activeLocation?.name || 'Ort'} · ${Number(activeLocation?.radiusKm || 5)} km`
              : mapMode === 'route'
                ? (activeRoute?.name || 'Route')
                : mapMode === 'favorites'
                  ? `Favoriten (${favoriteStationIds.length})`
                  : `Erkunden${exploreStatus.count ? ` · ${exploreStatus.count}` : ''}`}
          </span>
          <span className="map-toolbar-pill-fuel">{String(fuelType || 'diesel').toUpperCase()}</span>
          <ChevronDown size={13} />
        </button>
      )}

      {/* Legende der Preisfarben (ausgeblendet, sobald eine Station gewählt ist) */}
      {!selectedStation && (
        <div className="map-legend-pill" aria-hidden="true">
          <span><i style={{ background: '#059669' }} /> günstig</span>
          <span><i style={{ background: '#FFFFFF', borderColor: '#CBD5E1' }} /> Mittel</span>
          <span><i style={{ background: '#DC2626' }} /> teuer</span>
          <span style={{ color: '#94A3B8' }}>vs. Median</span>
        </div>
      )}

      {/* 3. Schwebende, transparente Steuerungsleiste (Unter dem Header zentriert) */}
      {!isToolbarHidden && (
      <div className="map-floating-toolbar">

        
        {/* Zeile 1: Modus-Wahl (Ort/Route/Favoriten) & Spritsorte & Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap' }}>
          {/* Modus: Ort / Route / Favoriten / Erkunden */}
          <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: '8px', padding: '2px', gap: '2px', flexShrink: 0 }}>
            {MAP_MODES.map(({ id, label, Icon, title }) => {
              const active = mapMode === id;
              const isFav = id === 'favorites';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectMode(id)}
                  title={title}
                  style={{ border: 'none', background: active ? '#0F172A' : 'transparent', color: active ? '#FFFFFF' : '#64748B', borderRadius: '6px', padding: '0.22rem 0.5rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <Icon size={11} fill={isFav && active ? '#F59E0B' : 'none'} color={isFav ? (active ? '#F59E0B' : '#64748B') : undefined} />
                  <span>{isFav ? `Favoriten (${favoriteStationIds.length})` : label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
            {/* Quick Fuel Selector auf der Karte */}
            {onSelectFuel && (
              <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: '9999px', padding: '2px', gap: '2px' }}>
                <button
                  type="button"
                  onClick={() => onSelectFuel('diesel')}
                  style={{
                    border: 'none',
                    background: fuelType === 'diesel' ? '#0F172A' : 'transparent',
                    color: fuelType === 'diesel' ? '#FFFFFF' : '#475569',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  Diesel
                </button>
                <button
                  type="button"
                  onClick={() => onSelectFuel('e10')}
                  style={{
                    border: 'none',
                    background: fuelType === 'e10' ? '#0F172A' : 'transparent',
                    color: fuelType === 'e10' ? '#FFFFFF' : '#475569',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  E10
                </button>
                <button
                  type="button"
                  onClick={() => onSelectFuel('e5')}
                  style={{
                    border: 'none',
                    background: fuelType === 'e5' ? '#0F172A' : 'transparent',
                    color: fuelType === 'e5' ? '#FFFFFF' : '#475569',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  E5
                </button>
              </div>
            )}

            {/* Minimieren/Maximieren Button */}
            <button
              type="button"
              onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
              style={{
                border: 'none',
                background: '#F1F5F9',
                color: '#64748B',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title={isToolbarExpanded ? 'Details einklappen' : 'Details ausklappen'}
              aria-label={isToolbarExpanded ? 'Details einklappen' : 'Details ausklappen'}
            >
              {isToolbarExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {/* Menü komplett ausblenden (mehr Platz für die Karte, z.B. auf dem iPhone) */}
            <button
              type="button"
              onClick={() => setIsToolbarHidden(true)}
              style={{
                border: 'none',
                background: '#F1F5F9',
                color: '#64748B',
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Menü ausblenden"
              aria-label="Menü ausblenden"
            >
              <ChevronsUp size={13} />
            </button>
          </div>
        </div>

        {/* Zeile 2: Dropdown-Wähler (Ort / Route / Favorit) + GPS Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {mapMode === 'location' ? (
              <select
                value={activeLocation?.id || ''}
                onChange={(e) => {
                  if (e.target.value === '__gps__') {
                    if (onLocateGps) onLocateGps();
                  } else {
                    if (onSelectLocation) onSelectLocation(e.target.value);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.28rem 0.5rem',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  fontWeight: 700,
                  fontSize: '0.76rem',
                  color: '#0F172A',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  textOverflow: 'ellipsis',
                }}
              >
                <option value="__gps__">📍 Aktueller Ort (GPS)</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    📍 {loc.name} ({Number(loc.radiusKm || 5)} km)
                  </option>
                ))}
              </select>
            ) : mapMode === 'route' ? (
              <select
                value={activeRoute?.id || (routes[0]?.id || '')}
                onChange={(e) => onSelectRoute && onSelectRoute(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.28rem 0.5rem',
                  borderRadius: '8px',
                  border: '1.5px solid #93C5FD',
                  fontWeight: 700,
                  fontSize: '0.76rem',
                  color: '#1D4ED8',
                  background: '#EFF6FF',
                  cursor: 'pointer',
                  textOverflow: 'ellipsis',
                }}
              >
                {routes.length === 0 ? (
                  <option disabled>Keine Route vorhanden</option>
                ) : (
                  routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      🧭 {r.name} ({fmtNum(r.totalDistanceKm || 0, 1)} km)
                    </option>
                  ))
                )}
              </select>
            ) : mapMode === 'explore' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.28rem 0.55rem', borderRadius: '8px', border: '1.5px solid #C7D2FE', background: '#EEF2FF', fontSize: '0.74rem', color: '#3730A3', fontWeight: 700, minWidth: 0 }}>
                {exploreStatus.loading ? <RefreshCw size={12} className="animate-spin" style={{ flexShrink: 0 }} /> : <Compass size={12} style={{ flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {exploreStatus.loading
                    ? 'Suche Tankstellen im Ausschnitt …'
                    : exploreStatus.error && exploreStatus.count === 0
                      ? `Fehler: ${exploreStatus.error.message || exploreStatus.error}`
                      : exploreStatus.count === 0
                        ? 'Keine Tankstellen mit Preis im Ausschnitt'
                        : `${exploreStatus.count} Tankstellen${exploreStatus.capped ? ` (nächste ${EXPLORE_MAX_MARKERS} von ${exploreStatus.total})` : ''} • Median ${exploreStatus.median ? fmtNum(exploreStatus.median, 3) : '–'} € • ${exploreStatus.radiusKm} km um die Mitte`}
                  {exploreStatus.tooFar && !exploreStatus.loading ? ' • näher zoomen' : ''}
                </span>
                <button type="button" onClick={() => exploreRef.current && exploreRef.current(true)} title="Ausschnitt neu laden" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#4338CA', cursor: 'pointer', display: 'flex', padding: 0, flexShrink: 0 }}>
                  <RefreshCw size={12} />
                </button>
              </div>
            ) : (
              <select
                value={selectedStation?.id || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    const target = stations.find((s) => s.id === e.target.value);
                    if (target && onSelectStation) onSelectStation(target);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.28rem 0.5rem',
                  borderRadius: '8px',
                  border: '1.5px solid #FDE68A',
                  fontWeight: 700,
                  fontSize: '0.76rem',
                  color: '#92400E',
                  background: '#FFFBEB',
                  cursor: 'pointer',
                  textOverflow: 'ellipsis',
                }}
              >
                <option value="">⭐ Alle Favoriten ({favoriteStationIds.length})</option>
                {stations.filter((s) => favoriteStationIds.includes(s.id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    ⭐ {s.name} ({s.currentPrice ? fmtNum(s.currentPrice, 3) : ''} €)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Fahrt planen (Tankstellen entlang einer Navigation) */}
          {onPlanTrip && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onPlanTrip}
              style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.28rem 0.55rem', borderRadius: '8px', fontWeight: 700, flexShrink: 0 }}
              title="Fahrt planen: Tankstellen entlang deiner Navigation"
            >
              <RouteIcon size={12} />
              <span>Fahrt</span>
            </button>
          )}

          {/* GPS Button */}
          {onLocateGps && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLocateGps}
              style={{
                fontSize: '0.72rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.28rem 0.55rem',
                background: '#F0F9FF',
                borderColor: '#BAE6FD',
                color: '#0369A1',
                borderRadius: '8px',
                fontWeight: 700,
                flexShrink: 0,
              }}
              title="Aktuellen GPS-Standort orten"
            >
              <LocateFixed size={12} color="#0284C7" />
              <span>GPS</span>
            </button>
          )}
        </div>

        {/* Zeile 2: Suchradius Slider, Kartenstil & Wischbare Schnellstart-Städte (Ausklappbar) */}
        {isToolbarExpanded && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
              borderTop: '1px solid #F1F5F9',
              paddingTop: '0.42rem',
            }}
          >
            {/* Obere Reihe in Zeile 2: Radius-Slider + Kartenstil-Umschalter */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
              }}
            >
              {/* Radius-Slider (nur im Ort-Modus relevant) */}
              {mapMode === 'location' && onUpdateRadius && activeLocation && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>
                  <Sliders size={12} color="#64748B" />
                  <span>Radius:</span>
                  <input
                    type="range"
                    min="2"
                    max="25"
                    step="1"
                    value={activeLocation.radiusKm || 5}
                    onChange={(e) => onUpdateRadius(activeLocation.id, parseFloat(e.target.value))}
                    style={{ width: '65px', accentColor: '#0F172A', cursor: 'pointer' }}
                  />
                  <strong className="num-mono" style={{ color: '#0F172A', minWidth: '32px' }}>
                    {activeLocation.radiusKm} km
                  </strong>
                </div>
              )}

              {/* Korridor-Schnellwahl (im Routen-Modus) */}
              {mapMode === 'route' && activeRoute && onUpdateRouteCorridorRadius && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', color: '#0369A1', whiteSpace: 'nowrap' }}>
                  <Navigation size={12} color="#0284C7" />
                  <span>Korridor:</span>
                  {CORRIDOR_OPTIONS.map((rad) => {
                    const isActive = Math.abs((activeRoute.corridorRadiusKm || DEFAULT_CORRIDOR_KM) - rad) < 0.2;
                    return (
                      <button
                        key={rad}
                        type="button"
                        onClick={() => onUpdateRouteCorridorRadius(activeRoute.id, rad)}
                        style={{
                          border: isActive ? '1.5px solid #0284C7' : '1px solid #BAE6FD',
                          background: isActive ? '#0284C7' : '#FFFFFF',
                          color: isActive ? '#FFFFFF' : '#0369A1',
                          padding: '0.12rem 0.35rem',
                          borderRadius: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ±{String(rad).replace('.', ',')}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Fahrzeug-Direktwechsler auf der Karte */}
              {vehicles && vehicles.length > 0 && onSelectVehicle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', color: '#64748B' }}>
                  <Car size={12} color="#0F172A" />
                  <select
                    value={activeVehicle?.id || ''}
                    onChange={(e) => onSelectVehicle(e.target.value)}
                    style={{
                      padding: '0.15rem 0.4rem',
                      borderRadius: '6px',
                      border: '1px solid #CBD5E1',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      background: '#FFFFFF',
                      color: '#0F172A',
                      maxWidth: '135px',
                      textOverflow: 'ellipsis',
                      cursor: 'pointer',
                    }}
                    title="Fahrzeug wechseln"
                  >
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        🚗 {v.name} ({v.consumptionL100km}L)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Kartenstil Switcher (OSM Bunt / Esri Clean / Satellit) */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: '#F1F5F9',
                  borderRadius: '9999px',
                  padding: '2px',
                  gap: '2px',
                }}
              >
                <Layers size={11} color="#64748B" style={{ marginLeft: '4px', marginRight: '2px' }} />
                <button
                  type="button"
                  onClick={() => handleSelectMapProvider('osm')}
                  style={{
                    border: 'none',
                    background: mapProvider === 'osm' ? '#0F172A' : 'transparent',
                    color: mapProvider === 'osm' ? '#FFFFFF' : '#475569',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="OpenStreetMap Standard: Bunt, kostenfrei, ohne API-Key"
                >
                  Bunt (OSM)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMapProvider('esriStreet')}
                  style={{
                    border: 'none',
                    background: mapProvider === 'esriStreet' ? '#0F172A' : 'transparent',
                    color: mapProvider === 'esriStreet' ? '#FFFFFF' : '#475569',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Esri World Street Map: Clean, modern, kostenfrei"
                >
                  Clean
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMapProvider('esriSat')}
                  style={{
                    border: 'none',
                    background: mapProvider === 'esriSat' ? '#0F172A' : 'transparent',
                    color: mapProvider === 'esriSat' ? '#FFFFFF' : '#475569',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    borderRadius: '9999px',
                    padding: '0.15rem 0.45rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  title="Esri World Imagery: Echte Satellitenbilder"
                >
                  Satellit
                </button>
              </div>
            </div>

            {/* Untere Reihe in Zeile 2: Swipeable Quick Cities Strip */}
            {onSelectQuickCity && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {QUICK_CITIES.map((qc) => {
                  const isSelected = activeLocation?.name?.toLowerCase().includes(qc.name.toLowerCase());
                  return (
                    <button
                      key={qc.id}
                      type="button"
                      onClick={() => {
                        if (mapMode === 'explore') {
                          if (mapInstanceRef.current) mapInstanceRef.current.setView([qc.lat, qc.lng], 12);
                        } else {
                          onSelectQuickCity(qc);
                        }
                      }}
                      style={{
                        background: isSelected ? '#0F172A' : '#F1F5F9',
                        color: isSelected ? '#FFFFFF' : '#334155',
                        border: 'none',
                        borderRadius: '9999px',
                        padding: '0.18rem 0.5rem',
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {qc.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
      )}

      {/* 4. Schwebende Station-Detail-Karte (Erscheint beim Klick auf eine Tankstelle über dem schwebenden Dock) */}
      {selectedStation && (
        <div className="map-floating-station-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '6px',
                  background: '#F1F5F9',
                  color: '#334155',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}
              >
                {selectedStation.brand || 'Frei'}
              </span>
              <h4
                style={{
                  fontSize: '0.92rem',
                  fontWeight: 800,
                  color: '#0F172A',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedStation.name}
              </h4>
              {selectedStation.isOpen === false && (
                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: '#DC2626',
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    padding: '0.1rem 0.38rem',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Geschlossen
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
              {(() => {
                const isSelectedFav = favoriteStationIds.includes(selectedStation.id);
                return (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite && onToggleFavorite(selectedStation)}
                    style={{
                      border: 'none',
                      background: isSelectedFav ? '#FEF3C7' : '#F1F5F9',
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: isSelectedFav ? '#F59E0B' : '#94A3B8',
                      transition: 'all 0.15s ease',
                    }}
                    title={isSelectedFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                  >
                    <Star size={13} fill={isSelectedFav ? '#F59E0B' : 'none'} color={isSelectedFav ? '#F59E0B' : '#94A3B8'} />
                  </button>
                );
              })()}

              <div style={{ textAlign: 'right' }}>
                <span className="num-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: priceTone(selectedStation).level === 'cheap' ? '#059669' : priceTone(selectedStation).level === 'expensive' ? '#DC2626' : '#0F172A', lineHeight: 1 }}>
                  {Number.isFinite(selectedStation.currentPrice) ? fmtNum(selectedStation.currentPrice, 3) : '–'}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#64748B', marginLeft: '0.15rem' }}>€</span>
              </div>

              {onCloseSelectedStation && (
                <button
                  type="button"
                  onClick={onCloseSelectedStation}
                  style={{
                    border: 'none',
                    background: '#F1F5F9',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748B',
                    marginLeft: '0.2rem',
                  }}
                  title="Schließen"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.74rem', color: '#64748B' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedStation.isOnRouteCorridor && selectedStation.kmAlongRoute !== undefined ? (
                <>
                  <Navigation size={11} color="#2563EB" style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, color: '#1D4ED8', flexShrink: 0 }}>km {selectedStation.kmAlongRoute}</span>
                  <span style={{ color: '#CBD5E1' }}>•</span>
                  <span style={{ color: '#2563EB', flexShrink: 0 }}>{selectedStation.routeDetourKm < 0.1 ? 'an der Strecke' : selectedStation.routeDetourKm >= 1 ? `+${fmtNum(selectedStation.routeDetourKm, 1)} km Abstecher` : `+${Math.round(selectedStation.routeDetourKm * 1000)} m Abstecher`}</span>
                  <span style={{ color: '#CBD5E1' }}>•</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedStation.street}</span>
                </>
              ) : (
                <>
                  <MapPin size={11} color="#94A3B8" style={{ flexShrink: 0 }} />
                  <span>{selectedStation.distanceKm} km</span>
                  <span style={{ color: '#CBD5E1' }}>•</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedStation.street}</span>
                </>
              )}
            </div>

            {selectedDetour && selectedDetour.isProfitable && (
              <span className="badge badge-favorable" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', flexShrink: 0 }}>
                +{fmtNum(selectedDetour.netSavingsEuro, 2)} € netto
              </span>
            )}
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.45rem', marginTop: '0.1rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openNavigation(selectedStation)}
              style={{ borderRadius: '9999px', fontSize: '0.74rem', padding: '0.42rem 0.2rem', justifyContent: 'center' }}
            >
              <Navigation size={12} />
              <span>{navAppLabel(preferredNav)}</span>
            </button>
            {(() => {
              const isSelectedFav = favoriteStationIds.includes(selectedStation.id);
              return (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onToggleFavorite && onToggleFavorite(selectedStation)}
                  style={{
                    borderRadius: '9999px',
                    fontSize: '0.74rem',
                    padding: '0.42rem 0.2rem',
                    justifyContent: 'center',
                    background: isSelectedFav ? '#FFFBEB' : '#FFFFFF',
                    borderColor: isSelectedFav ? '#FDE68A' : undefined,
                    color: isSelectedFav ? '#B45309' : undefined,
                  }}
                >
                  <Star size={12} fill={isSelectedFav ? '#F59E0B' : 'none'} color={isSelectedFav ? '#F59E0B' : '#64748B'} />
                  <span>{isSelectedFav ? 'Favorit' : 'Merken'}</span>
                </button>
              );
            })()}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (onOpenStationDetails) onOpenStationDetails(selectedStation);
                else if (onSelectStation) onSelectStation(selectedStation);
              }}
              style={{ borderRadius: '9999px', fontSize: '0.74rem', padding: '0.42rem 0.2rem', justifyContent: 'center' }}
            >
              <Sparkles size={12} color="#059669" />
              <span>Details</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
