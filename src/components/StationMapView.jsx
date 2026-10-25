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
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Fuel,
  Clock,
  TrendingDown,
  TrendingUp,
  Car,
  Layers,
  Star,
  Key,
} from 'lucide-react';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { QUICK_CITIES } from '../services/locationService';

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
  hasValidApiKey = true,
  onOpenSettings,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);
  const [mapMode, setMapMode] = useState(() => filterMode || (activeRoute ? 'route' : 'location'));

  // Halte mapMode synchron mit filterMode
  useEffect(() => {
    setMapMode(filterMode || (activeRoute ? 'route' : 'location'));
  }, [filterMode, activeRoute]);

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
      try {
        map.remove();
      } catch {}
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
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

  // Aktualisiere Kartenzentrum & Schichten bei Standort- oder Stationsänderung
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // 1. Zentriere Karte zuverlässig auf Route oder Standort
    if (activeRoute && ((activeRoute.polylineCoords && activeRoute.polylineCoords.length > 1) || (activeRoute.waypoints && activeRoute.waypoints.length > 1))) {
      const latlngs = (activeRoute.polylineCoords && activeRoute.polylineCoords.length > 1)
        ? activeRoute.polylineCoords
        : activeRoute.waypoints.map((wp) => [wp.lat, wp.lng]);
      map.invalidateSize();
      try {
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14 });
      } catch {}
    } else if (activeLocation && activeLocation.lat && activeLocation.lng) {
      let targetZoom = 12;
      const rad = activeLocation.radiusKm || 5;
      if (rad <= 3) targetZoom = 13;
      else if (rad <= 7) targetZoom = 12;
      else if (rad <= 14) targetZoom = 11;
      else targetZoom = 10;

      map.invalidateSize();
      map.setView([activeLocation.lat, activeLocation.lng], targetZoom);

      // Standort-Marker (Edler dunkler Pin mit weißem Ring)
      const locIcon = L.divIcon({
        className: 'custom-loc-marker',
        html: `
          <div style="background: #0F172A; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(15,23,42,0.4); border: 2.5px solid white;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker([activeLocation.lat, activeLocation.lng], { icon: locIcon })
        .bindPopup(`
          <div style="font-family: var(--font-sans, sans-serif); padding: 4px;">
            <strong style="color: #0F172A; font-size: 13px;">${activeLocation.name}</strong><br>
            <span style="color: #64748B; font-size: 11px;">${activeLocation.address || 'Zentrum'}</span><br>
            <span style="font-size: 11px; font-weight: 700; color: #0284C7;">Suchradius: ${activeLocation.radiusKm} km</span>
          </div>
        `)
        .addTo(layerGroup);

      // Suchradius-Kreis
      L.circle([activeLocation.lat, activeLocation.lng], {
        radius: (activeLocation.radiusKm || 5) * 1000,
        color: '#0F172A',
        weight: 1.5,
        dashArray: '5, 6',
        fillColor: '#0F172A',
        fillOpacity: 0.03,
      }).addTo(layerGroup);
    }

    // 2. Zeichne aktive Route (falls vorhanden)
    if (activeRoute && ((activeRoute.polylineCoords && activeRoute.polylineCoords.length > 1) || (activeRoute.waypoints && activeRoute.waypoints.length > 1))) {
      const latlngs = (activeRoute.polylineCoords && activeRoute.polylineCoords.length > 1)
        ? activeRoute.polylineCoords
        : activeRoute.waypoints.map((wp) => [wp.lat, wp.lng]);
      
      // Korridor-Puffer (Breite entsprechend des eingestellten Korridors)
      const corridorKm = activeRoute.corridorRadiusKm || 2.5;
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: Math.min(50, Math.max(14, corridorKm * 14)),
        opacity: 0.14,
        lineCap: 'round',
      }).addTo(layerGroup);

      // Mittellinie (OSM Fahrstrecke)
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: 3.5,
        opacity: 0.88,
        dashArray: '6, 6',
      }).addTo(layerGroup);

      // Start- und Ziel-Marker
      const startPt = activeRoute.startCoords || activeRoute.waypoints?.[0];
      const endPt = activeRoute.endCoords || activeRoute.waypoints?.[activeRoute.waypoints.length - 1];

      if (startPt && (startPt.lat || Array.isArray(startPt))) {
        const sLat = startPt.lat || startPt[0];
        const sLng = startPt.lng || startPt[1];
        const startIcon = L.divIcon({
          className: 'route-flag-start',
          html: `
            <div style="background: #059669; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; box-shadow: 0 4px 10px rgba(5,150,105,0.4); border: 2px solid white;">
              A
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([sLat, sLng], { icon: startIcon })
          .bindPopup(`<strong style="color: #065F46; font-size: 12px;">🟢 Start: ${activeRoute.startName || 'Start'}</strong>`)
          .addTo(layerGroup);
      }

      if (endPt && (endPt.lat || Array.isArray(endPt))) {
        const eLat = endPt.lat || endPt[0];
        const eLng = endPt.lng || endPt[1];
        const endIcon = L.divIcon({
          className: 'route-flag-end',
          html: `
            <div style="background: #DC2626; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; box-shadow: 0 4px 10px rgba(220,38,38,0.4); border: 2px solid white;">
              B
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([eLat, eLng], { icon: endIcon })
          .bindPopup(`<strong style="color: #991B1B; font-size: 12px;">🏁 Ziel: ${activeRoute.endName || 'Ziel'}</strong>`)
          .addTo(layerGroup);
      }
    }

    // 3. Basistankstelle für den Umweg-Rechner
    const sortedByDist = [...stations].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    const baseStation = sortedByDist[0];

    // 4. Zeichne Tankstellen als benutzerdefinierte bunte Preis-Chips
    stations.forEach((st) => {
      const isCheap = st.evaluation?.isCheap;
      const isSelected = selectedStation?.id === st.id;
      const isFavorite = favoriteStationIds.includes(st.id) || st.isFavorite;
      const priceStr = st.currentPrice ? st.currentPrice.toFixed(3) : '1.699';

      const chipBg = isSelected ? '#0F172A' : isCheap ? '#059669' : '#FFFFFF';
      const chipColor = isSelected || isCheap ? '#FFFFFF' : '#0F172A';
      const chipBorder = isSelected ? '#38BDF8' : isFavorite ? '#F59E0B' : '#FFFFFF';

      const customIcon = L.divIcon({
        className: 'station-price-chip-wrap',
        html: `
          <div style="
            background: ${chipBg};
            color: ${chipColor};
            border: 2px solid ${chipBorder};
            padding: 3px 8px;
            border-radius: 9999px;
            font-family: var(--font-sans, -apple-system, sans-serif);
            font-weight: 700;
            font-size: 11px;
            box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22);
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            transform: translate(-50%, -50%) ${isSelected ? 'scale(1.18)' : 'scale(1)'};
          ">
            <span style="font-size: 9.5px; opacity: 0.9; text-transform: uppercase;">${isFavorite ? '⭐ ' : ''}${st.brand || 'Frei'}</span>
            <span style="font-family: var(--font-mono, monospace); font-size: 12px; font-weight: 800;">${priceStr} €</span>
          </div>
        `,
        iconSize: [88, 28],
        iconAnchor: [44, 14],
      });

      const marker = L.marker([st.lat, st.lng], { icon: customIcon }).addTo(layerGroup);

      marker.on('click', () => {
        if (onSelectStation) onSelectStation(st);
      });
    });

    // Falls Favoriten-Filter aktiv: zentriere Karte auf Favoriten
    if (filterMode === 'favorites' && stations.length > 0) {
      try {
        const bounds = L.latLngBounds(stations.map((s) => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch {}
    }

  }, [stations, activeLocation, activeRoute, activeVehicle, selectedStation, onSelectStation, favoriteStationIds, filterMode]);

  // Maps Navigation starten (Apple Maps auf iOS oder Google Maps)
  const openNavigation = (st) => {
    if (!st) return;
    const query = st.lat && st.lng
      ? `${st.lat},${st.lng}`
      : encodeURIComponent(`${st.name}, ${st.street}, ${st.city}`);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const mapsUrl = isIOS
      ? `maps://maps.apple.com/?daddr=${query}`
      : `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    window.open(mapsUrl, '_blank');
  };

  // Basistankstelle für das gewählte Element
  const sortedByDist = [...stations].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
  const baseStation = sortedByDist[0];

  const selectedDetour = selectedStation ? calculateDetourProfitability({
    targetPrice: selectedStation.currentPrice,
    targetDistanceKm: selectedStation.distanceKm,
    basePrice: baseStation ? baseStation.currentPrice : selectedStation.currentPrice,
    baseDistanceKm: baseStation ? baseStation.distanceKm : 0,
    fillLiters: activeVehicle ? (activeVehicle.tankCapacityL * (1 - (activeVehicle.currentFuelLevelPct || 20) / 100)) : 40,
    consumptionL100km: activeVehicle?.consumptionL100km || 6.2,
  }) : null;

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

      {/* 3. Schwebende, transparente Steuerungsleiste (Unter dem Header zentriert) */}
      <div className="map-floating-toolbar">

        
        {/* Zeile 1: Modus-Wahl (Ort/Route/Favoriten) & Spritsorte & Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap' }}>
          {/* Apple-Style Ort vs Route vs Favoriten Switcher */}
          <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: '8px', padding: '2px', gap: '2px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => {
                setMapMode('location');
                if (onSelectFilterMode) onSelectFilterMode('location');
                if (onSelectRoute) onSelectRoute(null);
              }}
              style={{
                border: 'none',
                background: mapMode === 'location' ? '#0F172A' : 'transparent',
                color: mapMode === 'location' ? '#FFFFFF' : '#64748B',
                borderRadius: '6px',
                padding: '0.22rem 0.5rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
              title="Standort-Modus"
            >
              <MapPin size={11} />
              <span>Ort</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMapMode('route');
                if (onSelectFilterMode) onSelectFilterMode('route');
                if (routes.length > 0 && (!activeRoute || !routes.some((r) => r.id === activeRoute.id))) {
                  if (onSelectRoute) onSelectRoute(routes[0].id);
                }
              }}
              style={{
                border: 'none',
                background: mapMode === 'route' ? '#0F172A' : 'transparent',
                color: mapMode === 'route' ? '#FFFFFF' : '#64748B',
                borderRadius: '6px',
                padding: '0.22rem 0.5rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
              title="Routen-Modus"
            >
              <Navigation size={11} />
              <span>Route</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMapMode('favorites');
                if (onSelectFilterMode) onSelectFilterMode('favorites');
              }}
              style={{
                border: 'none',
                background: mapMode === 'favorites' ? '#0F172A' : 'transparent',
                color: mapMode === 'favorites' ? '#FFFFFF' : '#64748B',
                borderRadius: '6px',
                padding: '0.22rem 0.5rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
              title="Favoriten-Modus"
            >
              <Star size={11} fill={mapMode === 'favorites' ? '#F59E0B' : 'none'} color={mapMode === 'favorites' ? '#F59E0B' : '#64748B'} />
              <span>Favoriten ({favoriteStationIds.length})</span>
            </button>
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
              title={isToolbarExpanded ? 'Toolbar einklappen' : 'Toolbar ausklappen'}
            >
              {isToolbarExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
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
                    if (onSelectRoute) onSelectRoute(null);
                  } else {
                    if (onSelectLocation) onSelectLocation(e.target.value);
                    if (onSelectRoute) onSelectRoute(null);
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
                      🧭 {r.name} ({Number(r.totalDistanceKm || 0).toFixed(1)} km)
                    </option>
                  ))
                )}
              </select>
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
                    ⭐ {s.name} ({s.currentPrice ? s.currentPrice.toFixed(3) : ''} €)
                  </option>
                ))}
              </select>
            )}
          </div>

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
                  {[1.0, 2.0, 3.5, 5.0].map((rad) => {
                    const isActive = Math.abs((activeRoute.corridorRadiusKm || 2.5) - rad) < 0.2;
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
                        ±{rad}
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
                      onClick={() => onSelectQuickCity(qc)}
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
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
              {(() => {
                const isSelectedFav = favoriteStationIds.includes(selectedStation.id) || selectedStation.isFavorite;
                return (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite && onToggleFavorite(selectedStation.id)}
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
                <span className="num-mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: selectedStation.evaluation?.isCheap ? '#059669' : '#0F172A', lineHeight: 1 }}>
                  {selectedStation.currentPrice ? selectedStation.currentPrice.toFixed(3) : '1.699'}
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
                  <span style={{ color: '#2563EB', flexShrink: 0 }}>{selectedStation.routeDetourKm < 0.1 ? 'an der Strecke' : `+${(selectedStation.routeDetourKm * 1000).toFixed(0)}m Abstecher`}</span>
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
                +{selectedDetour.netSavingsEuro.toFixed(2)} € Netto
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
              <span>Route</span>
            </button>
            {(() => {
              const isSelectedFav = favoriteStationIds.includes(selectedStation.id) || selectedStation.isFavorite;
              return (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onToggleFavorite && onToggleFavorite(selectedStation.id)}
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
                if (onSelectStation) onSelectStation(selectedStation);
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
