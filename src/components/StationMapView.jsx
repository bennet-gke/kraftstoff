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
} from 'lucide-react';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { QUICK_CITIES } from '../services/locationService';

export default function StationMapView({
  stations = [],
  locations = [],
  activeLocation,
  onSelectLocation,
  onSelectQuickCity,
  onUpdateRadius,
  onLocateGps,
  activeRoute,
  activeVehicle,
  fuelType = 'diesel',
  onSelectFuel,
  selectedStation,
  onSelectStation,
  onCloseSelectedStation,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);

  // Initialisiere Leaflet Map mit bunter, lebendiger Vektorkarte (CartoDB Voyager)
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const centerLat = activeLocation?.lat || 52.5200;
    const centerLng = activeLocation?.lng || 13.4050;

    const map = L.map(mapContainerRef.current, {
      center: [centerLat, centerLng],
      zoom: 12,
      zoomControl: false,
    });

    // Zoom Control unten rechts (kollidiert nicht mit dem schwebenden Dock)
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CartoDB Voyager: Wunderschöne, lebendige & bunte Vektorkarte (wie Apple/Google Maps mit grünen Parks, blauen Seen & Straßen)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

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

  // Aktualisiere Kartenzentrum & Schichten bei Standort- oder Stationsänderung
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // 1. Zentriere Karte zuverlässig auf den gewählten Standort
    if (activeLocation && activeLocation.lat && activeLocation.lng) {
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
      
      // Korridor-Puffer
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: (activeRoute.corridorRadiusKm || 2.5) * 14,
        opacity: 0.12,
        lineCap: 'round',
      }).addTo(layerGroup);

      // Mittellinie (OSM Fahrstrecke)
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '6, 6',
      }).addTo(layerGroup);
    }

    // 3. Basistankstelle für den Umweg-Rechner
    const sortedByDist = [...stations].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    const baseStation = sortedByDist[0];

    // 4. Zeichne Tankstellen als benutzerdefinierte bunte Preis-Chips
    stations.forEach((st) => {
      const isCheap = st.evaluation?.isCheap;
      const isSelected = selectedStation?.id === st.id;
      const priceStr = st.currentPrice ? st.currentPrice.toFixed(3) : '1.699';

      const chipBg = isSelected ? '#0F172A' : isCheap ? '#059669' : '#FFFFFF';
      const chipColor = isSelected || isCheap ? '#FFFFFF' : '#0F172A';
      const chipBorder = isSelected ? '#38BDF8' : '#FFFFFF';

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
            <span style="font-size: 9.5px; opacity: 0.9; text-transform: uppercase;">${st.brand || 'Frei'}</span>
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

  }, [stations, activeLocation, activeRoute, activeVehicle, selectedStation, onSelectStation]);

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

      {/* 3. Schwebende, transparente Steuerungsleiste (Unter dem Header zentriert) */}
      <div className="map-floating-toolbar">
        
        {/* Zeile 1: Standort-Auswahl, GPS-Button, Sprit-Auswahl & Stationen-Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.45rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flex: 1 }}>
            <MapPin size={14} color="#0F172A" style={{ flexShrink: 0 }} />
            <select
              value={activeLocation?.id || ''}
              onChange={(e) => onSelectLocation && onSelectLocation(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '180px',
                padding: '0.28rem 0.5rem',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontWeight: 700,
                fontSize: '0.78rem',
                color: '#0F172A',
                background: '#FFFFFF',
                cursor: 'pointer',
                textOverflow: 'ellipsis',
              }}
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
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
                  padding: '0.25rem 0.5rem',
                  background: '#F0F9FF',
                  borderColor: '#BAE6FD',
                  color: '#0369A1',
                  borderRadius: '9999px',
                }}
                title="Aktuellen GPS-Standort orten"
              >
                <LocateFixed size={12} color="#0284C7" />
                <span>GPS</span>
              </button>
            )}

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

        {/* Zeile 2: Suchradius Slider & Wischbare Schnellstart-Städte (Ausklappbar) */}
        {isToolbarExpanded && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.6rem',
              borderTop: '1px solid #F1F5F9',
              paddingTop: '0.4rem',
            }}
          >
            {/* Radius-Slider */}
            {onUpdateRadius && activeLocation && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap', flexShrink: 0 }}>
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

            {/* Swipeable Quick Cities Strip */}
            {onSelectQuickCity && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                  flexShrink: 1,
                  minWidth: 0,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <MapPin size={11} color="#94A3B8" />
              <span>{selectedStation.distanceKm} km</span>
              <span>•</span>
              <span>{selectedStation.street}</span>
            </div>

            {selectedDetour && selectedDetour.isProfitable && (
              <span className="badge badge-favorable" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}>
                +{selectedDetour.netSavingsEuro.toFixed(2)} € Netto
              </span>
            )}
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', marginTop: '0.1rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openNavigation(selectedStation)}
              style={{ borderRadius: '9999px', fontSize: '0.76rem', padding: '0.45rem' }}
            >
              <Navigation size={13} />
              <span>Route starten</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (onSelectStation) onSelectStation(selectedStation);
              }}
              style={{ borderRadius: '9999px', fontSize: '0.76rem', padding: '0.45rem' }}
            >
              <Sparkles size={13} color="#059669" />
              <span>KI-Details</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
