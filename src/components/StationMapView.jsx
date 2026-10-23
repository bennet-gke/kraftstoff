import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Sparkles, MapPin, CheckCircle, AlertTriangle, Compass, Sliders, LocateFixed } from 'lucide-react';
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

    // Zoom Control oben rechts
    L.control.zoom({ position: 'topright' }).addTo(map);

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
      
      {/* Interaktive Map Toolbar (Standortwechsler & Radius-Slider) */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          borderRadius: '8px',
          padding: '0.5rem 0.85rem',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: '0.78rem',
          maxWidth: '90%',
        }}
      >
        {/* Standort-Auswahl */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <MapPin size={15} color="#0F172A" />
          <select
            value={activeLocation?.id || ''}
            onChange={(e) => onSelectLocation && onSelectLocation(e.target.value)}
            style={{
              padding: '0.3rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              fontWeight: 700,
              fontSize: '0.78rem',
              color: '#0F172A',
              background: '#FFFFFF',
              cursor: 'pointer',
            }}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          {onLocateGps && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLocateGps}
              style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0.5rem', background: '#F0F9FF', borderColor: '#BAE6FD', color: '#0369A1' }}
              title="Aktuellen GPS-Standort orten und Karte zentrieren"
            >
              <LocateFixed size={12} color="#0284C7" />
              <span>GPS orten</span>
            </button>
          )}

          {/* Schnellstart-Städte */}
          {onSelectQuickCity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', overflowX: 'auto' }}>
              {QUICK_CITIES.slice(0, 5).map((qc) => {
                const isSelected = activeLocation?.name?.includes(qc.name);
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
                      padding: '0.2rem 0.45rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {qc.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Radius-Slider */}
        {onUpdateRadius && activeLocation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '1px solid #E2E8F0', paddingLeft: '0.75rem' }}>
            <Sliders size={13} color="#64748B" />
            <span style={{ color: '#64748B', whiteSpace: 'nowrap' }}>Radius:</span>
            <input
              type="range"
              min="2"
              max="25"
              step="1"
              value={activeLocation.radiusKm || 5}
              onChange={(e) => onUpdateRadius(activeLocation.id, parseFloat(e.target.value))}
              style={{ width: '80px', accentColor: '#0F172A', cursor: 'pointer' }}
            />
            <strong className="num-mono" style={{ color: '#0F172A', minWidth: '38px' }}>
              {activeLocation.radiusKm} km
            </strong>
          </div>
        )}

        {/* Stationsanzahl Badge */}
        <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: '0.75rem', color: '#059669', fontWeight: 700 }}>
          {stations.length} Stationen im Blick
        </div>
      </div>

      {/* Map Canvas */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '540px' }} />

    </div>
  );
}
