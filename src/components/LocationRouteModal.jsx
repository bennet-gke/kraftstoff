import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, Plus, Trash2, X, Check, Target, Compass, Download, Cloud, Search, LocateFixed, Eye, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { locationService } from '../services/locationService';
import { routeService } from '../services/routeService';
import { backupService } from '../services/backupService';

export default function LocationRouteModal({
  isOpen,
  onClose,
  locations = [],
  activeLocationId,
  onSelectLocation,
  onUpdateLocations,
  routes = [],
  activeRouteId,
  onSelectRoute,
  onUpdateRoutes,
}) {
  const [modalTab, setModalTab] = useState('locations'); // 'locations' | 'routes'

  // Standort Formular Zustand
  const [locInputMode, setLocInputMode] = useState('address'); // 'address' | 'coords' | 'gps'
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newLocLat, setNewLocLat] = useState('');
  const [newLocLng, setNewLocLng] = useState('');
  const [newLocRadius, setNewLocRadius] = useState('6');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoFeedback, setGeoFeedback] = useState(null);
  const [detectedCoords, setDetectedCoords] = useState(null);

  // Routen Formular Zustand
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteDesc, setNewRouteDesc] = useState('');
  const [newRouteCorridor, setNewRouteCorridor] = useState('2.5');
  const [startType, setStartType] = useState(locations[0]?.id || 'custom');
  const [customStartQuery, setCustomStartQuery] = useState('');
  const [endType, setEndType] = useState(locations[1]?.id || locations[0]?.id || 'custom');
  const [customEndQuery, setCustomEndQuery] = useState('');
  const [isCalculatingOsm, setIsCalculatingOsm] = useState(false);
  const [osmRoutePreview, setOsmRoutePreview] = useState(null);
  const [autoSyncICloud, setAutoSyncICloud] = useState(true);
  const [routeToast, setRouteToast] = useState(null); // { type: 'success' | 'error', message: string }

  // Stelle sicher, dass startType & endType stets mit den tatsächlich vorhandenen Orten übereinstimmen
  useEffect(() => {
    if (locations && locations.length > 0) {
      if (startType !== 'custom' && !locations.some((l) => l.id === startType)) {
        setStartType(locations[0].id);
      }
      if (endType !== 'custom' && !locations.some((l) => l.id === endType)) {
        setEndType(locations[1]?.id || locations[0].id);
      }
    }
  }, [locations, startType, endType]);

  if (!isOpen) return null;

  // 1. GPS Standort live abrufen mit automatischer Adress-Rückauflösung
  const handleGetGpsPosition = () => {
    if (!navigator.geolocation) {
      setGeoFeedback({ success: false, message: 'GPS wird von diesem Browser nicht unterstützt.' });
      return;
    }
    setIsGeocoding(true);
    setGeoFeedback(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = parseFloat(pos.coords.latitude.toFixed(6));
          const lng = parseFloat(pos.coords.longitude.toFixed(6));
          setNewLocLat(lat.toString());
          setNewLocLng(lng.toString());
          const rev = await locationService.reverseGeocode(lat, lng);
          if (!newLocName.trim()) setNewLocName(`GPS: ${rev.shortName}`);
          setNewLocAddress(rev.displayName);
          setDetectedCoords({ lat, lng, displayName: rev.displayName });
          setIsGeocoding(false);
          setGeoFeedback({ success: true, message: `✓ GPS ermittelt: ${rev.shortName} (${lat}, ${lng})` });
        } catch {
          setIsGeocoding(false);
        }
      },
      (err) => {
        setIsGeocoding(false);
        setGeoFeedback({ success: false, message: `GPS-Fehler: ${err.message}` });
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // 2. OSM Nominatim Geocoding Test
  const handleTestGeocode = async () => {
    if (!newLocAddress.trim()) return;
    setIsGeocoding(true);
    setGeoFeedback(null);
    try {
      const geo = await locationService.geocodeAddress(newLocAddress);
      if (geo) {
        setDetectedCoords(geo);
        setNewLocLat(geo.lat.toString());
        setNewLocLng(geo.lng.toString());
        setGeoFeedback({
          success: true,
          message: `Gefunden: ${geo.displayName.slice(0, 50)}... (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`,
        });
      } else {
        setGeoFeedback({ success: false, message: 'Adresse nicht gefunden. Bitte prüfen oder Koordinaten direkt eingeben.' });
      }
    } catch (e) {
      setGeoFeedback({ success: false, message: `Geocoding-Fehler: ${e.message}` });
    } finally {
      setIsGeocoding(false);
    }
  };

  // 3. Standort speichern
  const handleAddLocation = async (e) => {
    e.preventDefault();
    if (!newLocName.trim()) return;

    setIsGeocoding(true);
    setGeoFeedback(null);

    try {
      let lat = parseFloat(newLocLat);
      let lng = parseFloat(newLocLng);
      let address = newLocAddress;

      // Falls Adressmodus und Koordinaten noch nicht ermittelt:
      if ((isNaN(lat) || isNaN(lng)) && locInputMode === 'address' && address) {
        const geo = await locationService.geocodeAddress(address);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
        }
      }

      const newLoc = await locationService.addLocation({
        name: newLocName,
        address: address || `${lat?.toFixed(4)}, ${lng?.toFixed(4)}`,
        lat,
        lng,
        radiusKm: parseFloat(newLocRadius) || 5.0,
      });

      onUpdateLocations(locationService.locations);
      onSelectLocation(newLoc.id, newLoc);
      setNewLocName('');
      setNewLocAddress('');
      setNewLocLat('');
      setNewLocLng('');
      setDetectedCoords(null);

      if (autoSyncICloud) {
        setTimeout(async () => {
          try {
            const res = await backupService.directSyncToICloud();
            setGeoFeedback({
              success: true,
              message: res.method === 'direct-file'
                ? `✓ Standort "${newLoc.name}" (${newLoc.lat}, ${newLoc.lng}) angelegt & in iCloud gesichert!`
                : `✓ Standort "${newLoc.name}" angelegt und in Datei gesichert!`,
            });
          } catch {
            setGeoFeedback({ success: true, message: `Standort "${newLoc.name}" angelegt!` });
          }
          setTimeout(() => setGeoFeedback(null), 4000);
        }, 150);
      } else {
        setGeoFeedback({
          success: true,
          message: `Standort "${newLoc.name}" (${newLoc.lat}, ${newLoc.lng}) angelegt!`,
        });
        setTimeout(() => setGeoFeedback(null), 4000);
      }
    } catch (err) {
      setGeoFeedback({ success: false, message: `Fehler beim Erfassen: ${err.message}` });
    } finally {
      setIsGeocoding(false);
    }
  };

  const handleUpdateRadius = (id, radiusKm) => {
    const updated = locationService.updateLocation(id, { radiusKm });
    onUpdateLocations(updated);
  };

  const handleDeleteLocation = (id) => {
    const updated = locationService.deleteLocation(id);
    onUpdateLocations(updated);
    if (autoSyncICloud) {
      setTimeout(() => backupService.directSyncToICloud(), 150);
    }
  };

  // 4. Start & Zielkoordinaten für Route ermitteln (robust & fehlertolerant)
  const resolveCoordsForRoute = async (type, customQuery = '') => {
    // 1. Suche in gespeicherten Standorten nach ID oder Name
    if (type && type !== 'custom') {
      let loc = locations.find((l) => l.id === type);
      if (!loc) {
        loc = locations.find((l) => l.name === type || l.name?.toLowerCase() === type?.toLowerCase());
      }
      if (loc && loc.lat != null && loc.lng != null) {
        const lat = parseFloat(loc.lat);
        const lng = parseFloat(loc.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          return { name: loc.name, lat, lng };
        }
      }
    }

    // 2. Benutzerdefinierte Adresse auflösen
    const query = (customQuery || (type === 'custom' ? '' : type) || '').trim();
    if (query) {
      const geo = await locationService.geocodeAddress(query);
      if (geo && geo.lat != null && geo.lng != null) {
        return { name: query, lat: parseFloat(geo.lat), lng: parseFloat(geo.lng) };
      }
    }

    // 3. Fallback: Erstbeste Location falls vorhanden
    if (locations && locations.length > 0) {
      const fallback = locations.find((l) => !isNaN(parseFloat(l.lat)) && !isNaN(parseFloat(l.lng))) || locations[0];
      if (fallback && fallback.lat != null && fallback.lng != null) {
        return { name: fallback.name, lat: parseFloat(fallback.lat), lng: parseFloat(fallback.lng) };
      }
    }

    return null;
  };

  // 5. Automatische OSM-Streckenberechnung im Hintergrund bei jeder Ortsauswahl
  useEffect(() => {
    if (modalTab !== 'routes') return;
    let isCancelled = false;

    const autoCalculateRoute = async () => {
      const start = await resolveCoordsForRoute(startType, customStartQuery);
      const end = await resolveCoordsForRoute(endType, customEndQuery);

      if (!start || !end) return;

      // Routennamen automatisch passend vorschlagen, falls noch leer oder Standard
      if (!newRouteName.trim() || newRouteName.includes(' - ') || newRouteName.includes(' ➔ ')) {
        setNewRouteName(`${start.name} - ${end.name}`);
      }

      setIsCalculatingOsm(true);
      try {
        const res = await routeService.calculateOsmRoute(start, end);
        if (!isCancelled && res.success) {
          setOsmRoutePreview({
            startName: start.name,
            endName: end.name,
            distanceKm: res.distanceKm,
            durationMin: res.durationMin,
            waypointsCount: res.waypoints?.length || 0,
            result: res,
          });
          setRouteToast(null);
        }
      } catch (err) {
        console.warn('Auto route preview calculation notice:', err);
      } finally {
        if (!isCancelled) setIsCalculatingOsm(false);
      }
    };

    const timer = setTimeout(autoCalculateRoute, 200);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [modalTab, startType, endType, customStartQuery, customEndQuery, locations]);

  // 6. Manuelle OSM Route Neuberechnung (Refresh)
  const handlePreviewOsmRoute = async () => {
    setIsCalculatingOsm(true);
    setRouteToast(null);
    try {
      const start = await resolveCoordsForRoute(startType, customStartQuery);
      const end = await resolveCoordsForRoute(endType, customEndQuery);

      if (!start || !end) {
        setRouteToast({ type: 'error', message: 'Bitte gültigen Start- und Zielort angeben.' });
        setIsCalculatingOsm(false);
        return;
      }

      const res = await routeService.calculateOsmRoute(start, end);
      setOsmRoutePreview({
        startName: start.name,
        endName: end.name,
        distanceKm: res.distanceKm,
        durationMin: res.durationMin,
        waypointsCount: res.waypoints?.length || 0,
        result: res,
      });
      setRouteToast({
        type: 'success',
        message: `✓ OSM Route berechnet: ${res.distanceKm} km (ca. ${res.durationMin} Min. Fahrzeit)`,
      });
    } catch (e) {
      setRouteToast({ type: 'error', message: `Fehler bei OSM-Berechnung: ${e.message}` });
    } finally {
      setIsCalculatingOsm(false);
    }
  };

  // 7. Route speichern
  const handleAddRoute = async (e) => {
    e.preventDefault();

    setIsCalculatingOsm(true);
    setRouteToast(null);

    try {
      const start = await resolveCoordsForRoute(startType, customStartQuery);
      const end = await resolveCoordsForRoute(endType, customEndQuery);

      if (!start || !end) {
        setRouteToast({ type: 'error', message: 'Fehler: Start- oder Zielkoordinaten konnten nicht aufgelöst werden.' });
        setIsCalculatingOsm(false);
        return;
      }

      const routeName = newRouteName.trim() || `${start.name} - ${end.name}`;

      // Verwende bereits vorab berechnete Route oder berechne sie jetzt
      let osrm = osmRoutePreview?.result;
      if (!osrm || osmRoutePreview.startName !== start.name || osmRoutePreview.endName !== end.name) {
        osrm = await routeService.calculateOsmRoute(start, end);
      }

      const newR = await routeService.addRoute({
        name: routeName,
        description: newRouteDesc.trim() || `${start.name} ➔ ${end.name} (${osrm.distanceKm} km)`,
        startName: start.name,
        startCoords: { lat: start.lat, lng: start.lng },
        endName: end.name,
        endCoords: { lat: end.lat, lng: end.lng },
        totalDistanceKm: osrm.distanceKm,
        corridorRadiusKm: parseFloat(newRouteCorridor) || 2.5,
        waypoints: osrm.waypoints,
        polylineCoords: osrm.polylineCoords,
      });

      onUpdateRoutes(routeService.routes);
      onSelectRoute(newR.id);
      setNewRouteName('');
      setNewRouteDesc('');
      setOsmRoutePreview(null);

      if (autoSyncICloud) {
        setTimeout(async () => {
          try {
            const res = await backupService.directSyncToICloud();
            setRouteToast({
              type: 'success',
              message: res.method === 'direct-file'
                ? `✓ Route "${newR.name}" (${newR.totalDistanceKm} km) gespeichert & in iCloud Drive gesichert!`
                : `✓ Route "${newR.name}" (${newR.totalDistanceKm} km) gespeichert!`,
            });
          } catch {
            setRouteToast({ type: 'success', message: `✓ Route "${newR.name}" (${newR.totalDistanceKm} km) lokal gespeichert!` });
          }
          setTimeout(() => setRouteToast(null), 5000);
        }, 150);
      } else {
        setRouteToast({ type: 'success', message: `✓ Route "${newR.name}" (${newR.totalDistanceKm} km) erfolgreich angelegt!` });
        setTimeout(() => setRouteToast(null), 5000);
      }
    } catch (err) {
      setRouteToast({ type: 'error', message: `Fehler beim Speichern der Route: ${err.message}` });
    } finally {
      setIsCalculatingOsm(false);
    }
  };

  const handleDeleteRoute = (id) => {
    const updated = routeService.deleteRoute(id);
    onUpdateRoutes(updated);
    if (autoSyncICloud) {
      setTimeout(() => backupService.directSyncToICloud(), 150);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
              Standorte, Suchradius & OSM-Routen
            </h3>
            <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
              Adressen oder Koordinaten hinterlegen • OpenStreetMap Fahrstrecken berechnen
            </p>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        {/* Tab Umschalter: Standorte vs. Routen */}
        <div className="nav-pill-group" style={{ marginBottom: '1.25rem', width: '100%' }}>
          <button
            className={`nav-pill-btn ${modalTab === 'locations' ? 'active' : ''}`}
            onClick={() => setModalTab('locations')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <MapPin size={14} />
            <span>Standorte & Radius</span>
          </button>
          <button
            className={`nav-pill-btn ${modalTab === 'routes' ? 'active' : ''}`}
            onClick={() => setModalTab('routes')}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Navigation size={14} />
            <span>OSM Fahrt-Routen (Ort 1 ➔ Ort 2)</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: STANDORTE & RADIUS                                 */}
        {/* ========================================================= */}
        {modalTab === 'locations' && (
          <div>
            {/* Liste gespeicherter Standorte */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem', maxHeight: '240px', overflowY: 'auto' }}>
              {locations.map((loc) => {
                const isActive = loc.id === activeLocationId;
                return (
                  <div
                    key={loc.id}
                    style={{
                      border: `1px solid ${isActive ? '#0F172A' : '#E2E8F0'}`,
                      borderRadius: '8px',
                      padding: '0.85rem',
                      background: isActive ? '#FAFAFA' : '#FFFFFF',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>
                            {loc.name}
                          </span>
                          {isActive && (
                            <span className="badge badge-favorable" style={{ fontSize: '0.68rem' }}>
                              Aktiv
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          {loc.address || `${loc.lat}, ${loc.lng}`}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#94A3B8' }} className="num-mono">
                          {loc.lat?.toFixed(4)}, {loc.lng?.toFixed(4)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {!isActive && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onSelectLocation(loc.id, loc)}
                          >
                            Aktivieren
                          </button>
                        )}
                        {locations.length > 1 && (
                          <button
                            onClick={() => handleDeleteLocation(loc.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.3rem' }}
                            title="Standort löschen"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Radius Slider */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: '6px', padding: '0.45rem 0.65rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#475569', marginBottom: '0.2rem' }}>
                        <span>Suchradius für Tankstellen:</span>
                        <strong className="num-mono" style={{ color: '#0F172A' }}>{loc.radiusKm} km</strong>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="35"
                        step="1"
                        value={loc.radiusKm}
                        onChange={(e) => handleUpdateRadius(loc.id, parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: '#0F172A' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Standort Hinzufügen Formular */}
            <form onSubmit={handleAddLocation} style={{ borderTop: '1px solid #F1F5F9', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A' }}>
                  Neuen Standort anlegen
                </h4>
                {/* Eingabe-Modus Umschalter */}
                <div style={{ display: 'flex', gap: '0.25rem', background: '#F1F5F9', padding: '0.15rem', borderRadius: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setLocInputMode('address')}
                    style={{
                      border: 'none',
                      background: locInputMode === 'address' ? '#FFFFFF' : 'transparent',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: locInputMode === 'address' ? 700 : 500,
                      cursor: 'pointer',
                      color: locInputMode === 'address' ? '#0F172A' : '#64748B',
                    }}
                  >
                    Adresse
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocInputMode('coords')}
                    style={{
                      border: 'none',
                      background: locInputMode === 'coords' ? '#FFFFFF' : 'transparent',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: locInputMode === 'coords' ? 700 : 500,
                      cursor: 'pointer',
                      color: locInputMode === 'coords' ? '#0F172A' : '#64748B',
                    }}
                  >
                    Koordinaten
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLocInputMode('gps');
                      handleGetGpsPosition();
                    }}
                    style={{
                      border: 'none',
                      background: locInputMode === 'gps' ? '#FFFFFF' : 'transparent',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.72rem',
                      fontWeight: locInputMode === 'gps' ? 700 : 500,
                      cursor: 'pointer',
                      color: locInputMode === 'gps' ? '#0F172A' : '#64748B',
                    }}
                  >
                    GPS
                  </button>
                </div>
              </div>

              {/* Name & Radius */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Standortname (z.B. Zweitwohnsitz, Eltern)"
                  value={newLocName}
                  onChange={(e) => setNewLocName(e.target.value)}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                  required
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    placeholder="Radius km"
                    value={newLocRadius}
                    onChange={(e) => setNewLocRadius(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                    min="1"
                    max="50"
                    required
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>km</span>
                </div>
              </div>

              {/* MODUS 1: ADRESSE MIT NOMINATIM GEOCODING */}
              {locInputMode === 'address' && (
                <div style={{ marginBottom: '0.65rem' }}>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input
                      type="text"
                      placeholder="Adresse oder Stadt (z.B. Kurfürstendamm 100, Berlin)"
                      value={newLocAddress}
                      onChange={(e) => setNewLocAddress(e.target.value)}
                      style={{ flex: 1, padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                    />
                    <button
                      type="button"
                      onClick={handleTestGeocode}
                      disabled={isGeocoding || !newLocAddress.trim()}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.74rem' }}
                      title="Koordinaten per OpenStreetMap Nominatim suchen"
                    >
                      <Search size={13} />
                      <span>{isGeocoding ? 'Sucht...' : 'Suchen'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* MODUS 2: DIREKTE KOORDINATEN */}
              {locInputMode === 'coords' && (
                <div style={{ marginBottom: '0.65rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <div>
                      <label style={{ fontSize: '0.68rem', color: '#64748B', display: 'block', marginBottom: '0.15rem' }}>
                        Breitengrad (Latitude):
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="z.B. 52.5200"
                        value={newLocLat}
                        onChange={(e) => setNewLocLat(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.68rem', color: '#64748B', display: 'block', marginBottom: '0.15rem' }}>
                        Längengrad (Longitude):
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="z.B. 13.4050"
                        value={newLocLng}
                        onChange={(e) => setNewLocLng(e.target.value)}
                        style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                        required
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder="Optionale Adressnotiz (z.B. Ferienhaus Harz)"
                    value={newLocAddress}
                    onChange={(e) => setNewLocAddress(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.75rem' }}
                  />
                </div>
              )}

              {/* MODUS 3: GPS */}
              {locInputMode === 'gps' && (
                <div style={{ marginBottom: '0.65rem', background: '#F8FAFC', padding: '0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.74rem', color: '#334155' }}>
                      {detectedCoords ? (
                        <span>GPS-Position erfasst: <strong className="num-mono">{detectedCoords.lat}, {detectedCoords.lng}</strong></span>
                      ) : (
                        <span>Keine GPS-Koordinaten geladen.</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleGetGpsPosition}
                      disabled={isGeocoding}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.72rem' }}
                    >
                      <LocateFixed size={12} />
                      <span>{isGeocoding ? 'Ermittle...' : 'GPS aktualisieren'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Feedback Alert */}
              {geoFeedback && (
                <div style={{
                  marginBottom: '0.65rem',
                  padding: '0.45rem 0.65rem',
                  borderRadius: '6px',
                  fontSize: '0.74rem',
                  background: geoFeedback.success ? '#ECFDF5' : '#FEF2F2',
                  color: geoFeedback.success ? '#065F46' : '#991B1B',
                  border: `1px solid ${geoFeedback.success ? '#A7F3D0' : '#FECACA'}`,
                }}>
                  {geoFeedback.message}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.74rem', color: '#475569', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoSyncICloud}
                    onChange={(e) => setAutoSyncICloud(e.target.checked)}
                    style={{ accentColor: '#0F172A' }}
                  />
                  <span>Automatisch in iCloud-Datei sichern</span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={isGeocoding}>
                <Plus size={14} />
                <span>{isGeocoding ? 'Ermittle Geodaten...' : 'Standort anlegen & in iCloud sichern'}</span>
              </button>
            </form>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: ROUTEN & KORRIDORE (OSM ORT 1 ➔ ORT 2)            */}
        {/* ========================================================= */}
        {modalTab === 'routes' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem', maxHeight: '220px', overflowY: 'auto' }}>
              {/* Option: Keine Route aktiv */}
              <div
                style={{
                  border: `1px solid ${!activeRouteId ? '#0F172A' : '#E2E8F0'}`,
                  borderRadius: '8px',
                  padding: '0.75rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: !activeRouteId ? '#FAFAFA' : '#FFFFFF',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0F172A' }}>
                    Standard: Keine Route (Umkreis-Modus)
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    Zeigt alle Tankstellen im Sternfahrt-Radius (Hin- & Rückweg berechnet)
                  </div>
                </div>
                {!activeRouteId ? (
                  <span className="badge badge-favorable" style={{ fontSize: '0.68rem' }}>Aktiv</span>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => onSelectRoute(null)}>
                    Wählen
                  </button>
                )}
              </div>

              {routes.map((r) => {
                const isActive = r.id === activeRouteId;
                return (
                  <div
                    key={r.id}
                    style={{
                      border: `1px solid ${isActive ? '#2563EB' : '#E2E8F0'}`,
                      borderRadius: '8px',
                      padding: '0.85rem',
                      background: isActive ? '#EFF6FF' : '#FFFFFF',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>
                            {r.name}
                          </span>
                          {isActive && (
                            <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>
                              Route aktiv
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '0.15rem' }}>
                          {r.description || `${r.startName || 'Start'} ➔ ${r.endName || 'Ziel'}`}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {!isActive ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onSelectRoute(r.id)}
                          >
                            Route abfahren
                          </button>
                        ) : (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onSelectRoute(null)}
                          >
                            Deaktivieren
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteRoute(r.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.3rem' }}
                          title="Route löschen"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.72rem', color: '#475569', marginTop: '0.35rem' }}>
                      <span>Strecke: <strong>{r.totalDistanceKm} km</strong></span>
                      <span>Korridor-Puffer: <strong>±{r.corridorRadiusKm} km</strong></span>
                      <span style={{ color: '#059669', fontWeight: 600 }}>OSM-geprüft</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Neue Route hinzufügen Formular: Ort 1 zu Ort 2 */}
            <form onSubmit={handleAddRoute} style={{ borderTop: '1px solid #F1F5F9', paddingTop: '1rem' }}>
              <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.5rem' }}>
                Neue OSM-Route berechnen (Ort 1 ➔ Ort 2)
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Routen-Name (z.B. Arbeitsweg)"
                  value={newRouteName}
                  onChange={(e) => setNewRouteName(e.target.value)}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                  required
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="number"
                    step="0.5"
                    placeholder="Korridor"
                    value={newRouteCorridor}
                    onChange={(e) => setNewRouteCorridor(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                    required
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap' }}>km</span>
                </div>
              </div>

              {/* Startort (Ort 1) Auswahl */}
              <div style={{ marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.7rem', color: '#64748B', display: 'block', marginBottom: '0.15rem' }}>
                  Startpunkt (Ort 1):
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  <select
                    value={startType}
                    onChange={(e) => setStartType(e.target.value)}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem', background: '#FFFFFF' }}
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                    <option value="custom">+ Andere Adresse / Ort...</option>
                  </select>
                  {startType === 'custom' && (
                    <input
                      type="text"
                      placeholder="Start-Adresse eingeben"
                      value={customStartQuery}
                      onChange={(e) => setCustomStartQuery(e.target.value)}
                      style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem' }}
                      required
                    />
                  )}
                </div>
              </div>

              {/* Zielort (Ort 2) Auswahl */}
              <div style={{ marginBottom: '0.65rem' }}>
                <label style={{ fontSize: '0.7rem', color: '#64748B', display: 'block', marginBottom: '0.15rem' }}>
                  Zielpunkt (Ort 2):
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  <select
                    value={endType}
                    onChange={(e) => setEndType(e.target.value)}
                    style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem', background: '#FFFFFF' }}
                  >
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                    <option value="custom">+ Andere Adresse / Ort...</option>
                  </select>
                  {endType === 'custom' && (
                    <input
                      type="text"
                      placeholder="Ziel-Adresse eingeben"
                      value={customEndQuery}
                      onChange={(e) => setCustomEndQuery(e.target.value)}
                      style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.78rem' }}
                      required
                    />
                  )}
                </div>
              </div>

              {/* Live OSM-Streckenanzeige (Automatische Berechnung) */}
              {isCalculatingOsm && !osmRoutePreview && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 0.65rem', marginBottom: '0.65rem', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.74rem', color: '#0284C7' }}>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Berechne OSM-Fahrstrecke und Fahrzeit automatisch...</span>
                </div>
              )}

              {osmRoutePreview && (
                <div
                  style={{
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    borderRadius: '8px',
                    padding: '0.75rem 0.85rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#166534', fontWeight: 700, fontSize: '0.8rem' }}>
                      <CheckCircle2 size={15} color="#16A34A" />
                      <span>OSM-Strecke automatisch berechnet</span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#15803D', background: '#DCFCE7', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                      ±{newRouteCorridor} km Korridor
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.25rem' }}>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: '#64748B', display: 'block' }}>Fahrstrecke:</span>
                      <strong className="num-mono" style={{ fontSize: '1.2rem', color: '#0F172A' }}>{osmRoutePreview.distanceKm} km</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.68rem', color: '#64748B', display: 'block' }}>Fahrzeit:</span>
                      <strong className="num-mono" style={{ fontSize: '1.2rem', color: '#0F172A' }}>~{osmRoutePreview.durationMin} Min.</strong>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <span style={{ fontSize: '0.68rem', color: '#64748B', display: 'block' }}>OSM-Punkte:</span>
                      <span className="num-mono" style={{ fontSize: '0.82rem', color: '#334155' }}>{osmRoutePreview.waypointsCount} Segmente</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Feedback Toast */}
              {routeToast && (
                <div
                  style={{
                    marginBottom: '0.65rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    background: (routeToast.type === 'error' || (typeof routeToast === 'string' && routeToast.includes('Fehler'))) ? '#FEF2F2' : '#ECFDF5',
                    color: (routeToast.type === 'error' || (typeof routeToast === 'string' && routeToast.includes('Fehler'))) ? '#991B1B' : '#065F46',
                    border: `1px solid ${(routeToast.type === 'error' || (typeof routeToast === 'string' && routeToast.includes('Fehler'))) ? '#FECACA' : '#A7F3D0'}`,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  {(routeToast.type === 'error' || (typeof routeToast === 'string' && routeToast.includes('Fehler'))) ? (
                    <AlertCircle size={14} color="#DC2626" />
                  ) : (
                    <CheckCircle2 size={14} color="#16A34A" />
                  )}
                  <span>{routeToast.message || routeToast}</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary btn-sm" style={{ width: '100%', padding: '0.6rem' }} disabled={isCalculatingOsm}>
                <Plus size={15} />
                <span>{isCalculatingOsm ? 'Berechne Route...' : 'Route speichern & aktivieren'}</span>
              </button>
            </form>
          </div>
        )}

        {/* iCloud Sync Fußleiste */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', paddingTop: '0.85rem', marginTop: '1.25rem', fontSize: '0.74rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              try {
                const res = await backupService.directSyncToICloud();
                alert(res.method === 'direct-file' ? `✓ In iCloud Drive gespeichert (${res.directPath})!` : '✓ Datei "kraftstoff_daten.json" erzeugt!');
              } catch (e) {
                alert(`Fehler: ${e.message}`);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Download size={13} color="#059669" />
            <span>Jetzt in iCloud-Datei sichern</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Schließen
          </button>
        </div>

      </div>
    </div>
  );
}
