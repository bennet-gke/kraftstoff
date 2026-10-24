import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Sparkles, MapPin, Sliders, LocateFixed } from 'lucide-react';
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
  selectedStation,
  onSelectStation,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);

  // Initialisiere Leaflet Map mit sauberem Unmount-Cleanup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const centerLat = activeLocation?.lat || 52.5200;
    const centerLng = activeLocation?.lng || 13.4050;

    const map = L.map(mapContainerRef.current, {
      center: [centerLat, centerLng],
      zoom: 12,
      zoomControl: false,
    });

    // Zoom Control unten rechts (kollidiert nicht mit der oberen Steuerungsleiste)
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Esri World Light Gray Base: Saubere, minimalistische Kacheln
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 16,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    mapInstanceRef.current = map;

    // Erneute Größenberechnung nach Rendering
    const timer = setTimeout(() => {
      if (map) map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
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

      // Standort-Marker
      const locIcon = L.divIcon({
        className: 'custom-loc-marker',
        html: `
          <div style="background: #0F172A; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(15,23,42,0.35); border: 2.5px solid white;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      L.marker([activeLocation.lat, activeLocation.lng], { icon: locIcon })
        .bindPopup(`
          <div style="font-family: sans-serif; padding: 2px;">
            <strong style="color: #0F172A; font-size: 13px;">${activeLocation.name}</strong><br>
            <span style="color: #64748B; font-size: 11px;">${activeLocation.address || 'Zentrum'}</span><br>
            <span style="font-size: 11px; font-weight: 600;">Suchradius: ${activeLocation.radiusKm} km</span>
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
        fillOpacity: 0.04,
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

    // 4. Zeichne Tankstellen als benutzerdefinierte Preis-Chips
    stations.forEach((st) => {
      const isCheap = st.evaluation?.isCheap;
      const isSelected = selectedStation?.id === st.id;
      const priceStr = st.currentPrice ? st.currentPrice.toFixed(3) : '1.699';

      // Rentabilitäts-Rechnung
      const detour = calculateDetourProfitability({
        targetPrice: st.currentPrice,
        targetDistanceKm: st.distanceKm,
        basePrice: baseStation ? baseStation.currentPrice : st.currentPrice,
        baseDistanceKm: baseStation ? baseStation.distanceKm : 0,
        fillLiters: activeVehicle ? (activeVehicle.tankCapacityL * (1 - activeVehicle.currentFuelLevelPct / 100)) : 40,
        consumptionL100km: activeVehicle?.consumptionL100km || 6.0,
      });

      const chipColor = isCheap ? '#059669' : '#0F172A';
      const chipBg = isCheap ? '#ECFDF5' : '#FFFFFF';
      const chipBorder = isSelected ? '#0F172A' : isCheap ? '#A7F3D0' : '#E2E8F0';

      const customIcon = L.divIcon({
        className: 'station-price-chip',
        html: `
          <div style="
            background: ${chipBg};
            color: ${chipColor};
            border: 2px solid ${chipBorder};
            padding: 3px 8px;
            border-radius: 20px;
            font-family: var(--font-sans, sans-serif);
            font-weight: 700;
            font-size: 11px;
            box-shadow: 0 2px 8px rgba(15,23,42,0.14);
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            cursor: pointer;
            transition: transform 0.15s ease;
            transform: translate(-50%, -50%) ${isSelected ? 'scale(1.1)' : ''};
          ">
            <span>${st.brand || 'Frei'}</span>
            <span style="font-family: monospace; font-size: 12px; font-weight: 800;">${priceStr} €</span>
          </div>
        `,
        iconSize: [85, 26],
        iconAnchor: [42, 13],
      });

      const marker = L.marker([st.lat, st.lng], { icon: customIcon }).addTo(layerGroup);

      marker.on('click', () => {
        if (onSelectStation) onSelectStation(st);
      });

      // HTML Popup mit Rentabilitäts-Rechnung ("Lohnt sich der Weg?")
      const popupContent = `
        <div style="font-family: sans-serif; font-size: 12px; min-width: 210px; padding: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
            <strong style="font-size: 13px; color: #0F172A;">${st.name}</strong>
            <span style="font-size: 14px; font-weight: 800; color: ${isCheap ? '#059669' : '#0F172A'}; font-family: monospace;">${priceStr} €</span>
          </div>
          <div style="color: #64748B; margin-bottom: 6px;">${st.street} • <strong>${st.distanceKm} km</strong></div>

          <div style="background: ${detour.isProfitable ? '#ECFDF5' : '#FFF1F2'}; border: 1px solid ${detour.isProfitable ? '#A7F3D0' : '#FECDD3'}; border-radius: 6px; padding: 6px; margin-bottom: 6px;">
            <div style="font-weight: 700; color: ${detour.isProfitable ? '#065F46' : '#9F1239'}; margin-bottom: 2px;">
              ${detour.isProfitable ? '✓ Fahrt lohnt sich!' : '✗ Fahrt lohnt sich nicht!'}
            </div>
            <div style="font-size: 11px; color: #475569;">
              Netto-Ergebnis: <strong>${detour.netSavingsEuro > 0 ? '+' : ''}${detour.netSavingsEuro.toFixed(2)} €</strong><br>
              (Spritkosten für ${detour.totalDetourKm} km Mehrweg: ${detour.fuelCostDetourEuro.toFixed(2)} €)
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
    });

  }, [stations, activeLocation, activeRoute, activeVehicle, selectedStation, onSelectStation]);

  return (
    <div className="clean-card" style={{ padding: '0', overflow: 'hidden', position: 'relative' }}>
      
      {/* Interaktive Map Toolbar (Mobil-optimierte 2-zeilige Steuerungsleiste) */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          right: '10px',
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: '12px',
          padding: '0.55rem 0.75rem',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
        }}
      >
        {/* Zeile 1: Standort-Auswahl, GPS-Button & Stationen-Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flex: 1 }}>
            <MapPin size={14} color="#0F172A" style={{ flexShrink: 0 }} />
            <select
              value={activeLocation?.id || ''}
              onChange={(e) => onSelectLocation && onSelectLocation(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '200px',
                padding: '0.28rem 0.5rem',
                borderRadius: '6px',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
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
                  whiteSpace: 'nowrap',
                }}
                title="Aktuellen GPS-Standort orten"
              >
                <LocateFixed size={12} color="#0284C7" />
                <span>GPS</span>
              </button>
            )}

            <span
              className="badge badge-favorable"
              style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {stations.length} Stationen
            </span>
          </div>

        </div>

        {/* Zeile 2: Suchradius Slider & Wischbare Schnellstart-Städte */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.6rem',
            borderTop: '1px solid #F1F5F9',
            paddingTop: '0.35rem',
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
                      borderRadius: '4px',
                      padding: '0.18rem 0.45rem',
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

      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '540px' }} />

    </div>
  );
}
