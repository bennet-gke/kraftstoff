import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Coffee,
  Fuel,
  BellOff,
  Car,
  MapPin,
  RotateCcw,
  LocateFixed,
  ChevronDown,
  X,
  Check,
  ArrowUpDown,
  Plus,
  Star,
} from 'lucide-react';
import { QUICK_CITIES } from '../services/locationService';

export default function RouteScheduleBar({
  selectedFuel = 'diesel',
  onSelectFuel,
  isCommuteActive = false,
  onToggleCommute,
  isPaused = false,
  pausedUntil = null,
  onPause30Min,
  onResumeAlerts,
  sortBy = 'score',
  onSelectSort,
  activeVehicle,
  vehicles = [],
  onSelectVehicle,
  onOpenVehicleModal,
  activeLocation,
  locations = [],
  onSelectLocation,
  onUpdateRadius,
  activeRoute = null,
  routes = [],
  onSelectRoute,
  filterMode = 'location',
  onSelectFilterMode,
  favoriteStationIds = [],
  onToggleFavorite,
  onOpenLocationRouteModal,
  onLocateGps,
  onSelectQuickCity,
  detourMode = 'local_roundtrip',
  onSelectDetourMode,
  customConsumption,
  onUpdateCustomConsumption,
  customLiters,
  onUpdateCustomLiters,
  onResetVehicleOverrides,
}) {
  const [timeLeft, setTimeLeft] = useState('');
  // 'location' | 'vehicle' | 'fuel' | 'sort' | null
  const [activeDrawer, setActiveDrawer] = useState(null);
  // 'location' | 'route' | 'favorites' inside the location drawer
  const [locationSubTab, setLocationSubTab] = useState(() => filterMode || (activeRoute ? 'route' : 'location'));

  // Synchronisiere SubTab mit aktivem Filtermodus, wenn Drawer geöffnet wird
  useEffect(() => {
    if (activeDrawer === 'location') {
      setLocationSubTab(filterMode || (activeRoute ? 'route' : 'location'));
    }
  }, [activeDrawer, filterMode, activeRoute]);

  // Live-Countdown für "30 Min pausieren"
  useEffect(() => {
    if (!isPaused || !pausedUntil) {
      setTimeLeft('');
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const expiry = new Date(pausedUntil).getTime();
      const diffSec = Math.max(0, Math.floor((expiry - now) / 1000));

      if (diffSec <= 0) {
        setTimeLeft('Abgelaufen');
        onResumeAlerts();
      } else {
        const mins = Math.floor(diffSec / 60);
        const secs = diffSec % 60;
        setTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs}m`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPaused, pausedUntil, onResumeAlerts]);

  const hasVehicleOverrides =
    (customConsumption !== null && customConsumption !== activeVehicle?.consumptionL100km) ||
    (customLiters !== null);

  const neededLiters = customLiters || (activeVehicle
    ? Math.round(activeVehicle.tankCapacityL * (1 - (activeVehicle.currentFuelLevelPct || 20) / 100))
    : 45);

  const effectiveConsumption = customConsumption || activeVehicle?.consumptionL100km || 6.2;

  const toggleDrawer = (drawerName) => {
    setActiveDrawer((prev) => (prev === drawerName ? null : drawerName));
  };

  const getSortLabel = () => {
    switch (sortBy) {
      case 'savings': return 'Netto-Ersparnis';
      case 'price': return 'Günstigster Preis';
      case 'distance': return 'Kürzeste Distanz';
      default: return 'KI-Score';
    }
  };

  const getFuelLabel = () => {
    switch (selectedFuel) {
      case 'e10': return 'E10';
      case 'e5': return 'E5';
      default: return 'Diesel';
    }
  };

  return (
    <div style={{ marginBottom: '0.85rem' }}>
      {/* 1. HORIZONTALE FILTER-PILL-LEISTE (Mobil-optimiert, Swipeable) */}
      <div className="filter-pill-bar">
        
        {/* Pill 1: Ort, Route ODER Favoriten */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'location' ? 'active' : ''}`}
          onClick={() => toggleDrawer('location')}
          title="Filter nach Ort, Route oder Favoriten wählen"
          style={{
            borderColor: filterMode === 'favorites' && activeDrawer !== 'location'
              ? '#FDE68A'
              : filterMode === 'route' && activeDrawer !== 'location'
              ? '#93C5FD'
              : undefined,
            background: filterMode === 'favorites' && activeDrawer !== 'location'
              ? '#FFFBEB'
              : filterMode === 'route' && activeDrawer !== 'location'
              ? '#EFF6FF'
              : undefined,
          }}
        >
          {filterMode === 'favorites' ? (
            <Star size={13} fill={activeDrawer === 'location' ? '#FFFFFF' : '#F59E0B'} color={activeDrawer === 'location' ? '#FFFFFF' : '#F59E0B'} />
          ) : filterMode === 'route' && activeRoute ? (
            <Navigation size={13} color={activeDrawer === 'location' ? '#FFFFFF' : '#2563EB'} />
          ) : (
            <MapPin size={13} color={activeDrawer === 'location' ? '#FFFFFF' : '#0F172A'} />
          )}
          <span>
            {filterMode === 'favorites' ? (
              <>Favoriten (<strong>{favoriteStationIds.length}</strong>)</>
            ) : filterMode === 'route' && activeRoute ? (
              <>Route: <strong>{activeRoute.name}</strong></>
            ) : (
              <>{activeLocation?.name || 'Ort'} ({Number(activeLocation?.radiusKm || 5)} km)</>
            )}
          </span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {/* Pill 2: Fahrzeug & Verbrauch */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'vehicle' ? 'active' : ''}`}
          onClick={() => toggleDrawer('vehicle')}
          title="Fahrzeug wechseln oder Verbrauch anpassen"
        >
          <Car size={13} color={activeDrawer === 'vehicle' ? '#FFFFFF' : '#0F172A'} />
          <span>{activeVehicle?.name || 'Auto'} ({effectiveConsumption}L)</span>
          {hasVehicleOverrides && (
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#38BDF8' }} />
          )}
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {/* Pill 3: Kraftstoff */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'fuel' ? 'active' : ''}`}
          onClick={() => toggleDrawer('fuel')}
          title="Kraftstoffsorte wählen"
        >
          <Fuel size={13} color={activeDrawer === 'fuel' ? '#FFFFFF' : '#0F172A'} />
          <span>{getFuelLabel()}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {/* Pill 4: Sortierung */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'sort' ? 'active' : ''}`}
          onClick={() => toggleDrawer('sort')}
          title="Sortierung ändern"
        >
          <ArrowUpDown size={13} color={activeDrawer === 'sort' ? '#FFFFFF' : '#0F172A'} />
          <span>{getSortLabel()}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {/* Pill 5: Mehrweg-Modus Quick Toggle (Vom Ort vs An Strecke) */}
        <button
          type="button"
          className="filter-pill"
          onClick={() => onSelectDetourMode(detourMode === 'local_roundtrip' ? 'route_corridor' : 'local_roundtrip')}
          title="Umschalten zwischen Hin- & Rückfahrt und Routen-Korridor"
          style={{
            borderColor: detourMode === 'route_corridor' ? '#93C5FD' : undefined,
            background: detourMode === 'route_corridor' ? '#EFF6FF' : undefined,
            color: detourMode === 'route_corridor' ? '#1D4ED8' : undefined,
          }}
        >
          <Navigation size={12} />
          <span>{detourMode === 'route_corridor' ? 'An Strecke' : 'Hin & Rück'}</span>
        </button>

        {/* Pill 6: Heimweg Filter Toggle */}
        <button
          type="button"
          className={`filter-pill ${isCommuteActive ? 'active' : ''}`}
          onClick={onToggleCommute}
          title="Pendel- & Heimweg-Filter"
        >
          <span>Heimweg</span>
          {isCommuteActive && (
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#34D399' }} />
          )}
        </button>

        {/* Pill 7: 30 Min Pause */}
        {isPaused ? (
          <button
            type="button"
            className="filter-pill"
            onClick={onResumeAlerts}
            style={{ background: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }}
            title="Alarm-Pause beenden"
          >
            <BellOff size={12} />
            <span>Pause {timeLeft}</span>
          </button>
        ) : (
          <button
            type="button"
            className="filter-pill"
            onClick={onPause30Min}
            title="Alarme für 30 Minuten pausieren"
          >
            <Coffee size={12} color="#64748B" />
            <span>30m Pause</span>
          </button>
        )}

      </div>

      {/* 2. SCHLANKE QUICK-DRAWER DETAILS (Öffnet sich bei Klick auf ein Pill) */}
      {activeDrawer && (
        <div
          className="clean-card"
          style={{
            marginTop: '0.5rem',
            padding: '0.95rem 1.1rem',
            background: '#FFFFFF',
            border: '1px solid rgba(226, 232, 240, 0.95)',
            borderRadius: '16px',
            boxShadow: '0 10px 25px -4px rgba(15, 23, 42, 0.08), 0 4px 10px -2px rgba(15, 23, 42, 0.04)',
            animation: 'fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* DRAWER 1: STANDORT & ROUTE WECHSLER */}
          {activeDrawer === 'location' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Header mit Apple-Style Schieberegler [ Ort | Route ] */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    background: '#F1F5F9',
                    borderRadius: '10px',
                    padding: '3px',
                    gap: '3px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setLocationSubTab('location');
                      if (onSelectFilterMode) onSelectFilterMode('location');
                    }}
                    style={{
                      border: 'none',
                      background: locationSubTab === 'location' ? '#0F172A' : 'transparent',
                      color: locationSubTab === 'location' ? '#FFFFFF' : '#475569',
                      borderRadius: '8px',
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <MapPin size={13} />
                    <span>Ort & Radius</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLocationSubTab('route');
                      if (onSelectFilterMode) onSelectFilterMode('route');
                    }}
                    style={{
                      border: 'none',
                      background: locationSubTab === 'route' ? '#0F172A' : 'transparent',
                      color: locationSubTab === 'route' ? '#FFFFFF' : '#475569',
                      borderRadius: '8px',
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Navigation size={13} />
                    <span>Fahrt-Route {routes.length > 0 && `(${routes.length})`}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLocationSubTab('favorites');
                      if (onSelectFilterMode) onSelectFilterMode('favorites');
                    }}
                    style={{
                      border: 'none',
                      background: locationSubTab === 'favorites' ? '#0F172A' : 'transparent',
                      color: locationSubTab === 'favorites' ? '#FFFFFF' : '#475569',
                      borderRadius: '8px',
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <Star size={13} fill={locationSubTab === 'favorites' ? '#F59E0B' : 'none'} color={locationSubTab === 'favorites' ? '#F59E0B' : '#475569'} />
                    <span>Favoriten ({favoriteStationIds.length})</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B', padding: '4px' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* UNTER-TAB A: ORTE */}
              {locationSubTab === 'location' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* 1. Aktueller Standort (GPS) */}
                  {onLocateGps && (
                    <button
                      type="button"
                      onClick={() => {
                        onLocateGps();
                        if (onSelectRoute) onSelectRoute(null);
                        setActiveDrawer(null);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '12px',
                        border: activeLocation?.id === 'loc-current-gps' && !activeRoute ? '1.5px solid #0284C7' : '1px solid #BAE6FD',
                        background: activeLocation?.id === 'loc-current-gps' && !activeRoute ? '#F0F9FF' : '#F8FAFC',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            background: '#E0F2FE',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <LocateFixed size={15} color="#0284C7" />
                        </div>
                        <div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0369A1' }}>
                            Aktueller Ort (GPS)
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                            Live-Standort über Smartphone GPS erfassen
                          </div>
                        </div>
                      </div>
                      {activeLocation?.id === 'loc-current-gps' && !activeRoute && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0284C7', background: '#E0F2FE', padding: '0.15rem 0.5rem', borderRadius: '9999px' }}>
                          Aktiv
                        </span>
                      )}
                    </button>
                  )}

                  {/* 2. Gespeicherte Orte */}
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                      Gespeicherte Orte ({locations.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '2px' }}>
                      {locations.map((loc) => {
                        const isSelected = !activeRoute && activeLocation?.id === loc.id;
                        return (
                          <button
                            key={loc.id}
                            type="button"
                            onClick={() => {
                              onSelectLocation(loc.id, loc);
                              if (onSelectRoute) onSelectRoute(null);
                              setActiveDrawer(null);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.55rem 0.75rem',
                              borderRadius: '10px',
                              border: isSelected ? '1.5px solid #0F172A' : '1px solid #E2E8F0',
                              background: isSelected ? '#0F172A' : '#FFFFFF',
                              color: isSelected ? '#FFFFFF' : '#0F172A',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1, paddingRight: '0.5rem' }}>
                              <div style={{ fontSize: '0.79rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {loc.name}
                              </div>
                              {loc.address && (
                                <div style={{ fontSize: '0.68rem', opacity: isSelected ? 0.8 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '1px' }}>
                                  {loc.address}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                              <span
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  background: isSelected ? 'rgba(255,255,255,0.2)' : '#F1F5F9',
                                  color: isSelected ? '#FFFFFF' : '#475569',
                                  padding: '0.12rem 0.45rem',
                                  borderRadius: '6px',
                                }}
                              >
                                {Number(loc.radiusKm || 5)} km
                              </span>
                              {isSelected && <Check size={14} color="#38BDF8" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3. Suchradius-Slider für aktiven Ort */}
                  {onUpdateRadius && activeLocation && !activeRoute && (
                    <div style={{ background: '#F8FAFC', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.3rem' }}>
                        <span style={{ color: '#64748B' }}>Suchradius um {activeLocation.name}:</span>
                        <strong className="num-mono" style={{ color: '#0F172A', fontWeight: 800 }}>
                          {Number(activeLocation.radiusKm || 5)} km
                        </strong>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="25"
                        step="1"
                        value={Number(activeLocation.radiusKm || 5)}
                        onChange={(e) => onUpdateRadius(activeLocation.id, parseFloat(e.target.value) || 5)}
                        style={{ width: '100%', accentColor: '#0F172A', cursor: 'pointer' }}
                      />
                    </div>
                  )}

                  {/* Quick Cities */}
                  {onSelectQuickCity && (
                    <div>
                      <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 600, marginBottom: '0.3rem' }}>
                        Schnellwechsel Stadt:
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {QUICK_CITIES.slice(0, 5).map((qc) => (
                          <button
                            key={qc.id}
                            type="button"
                            onClick={() => {
                              onSelectQuickCity(qc);
                              if (onSelectRoute) onSelectRoute(null);
                              setActiveDrawer(null);
                            }}
                            style={{
                              border: '1px solid #E2E8F0',
                              background: '#F8FAFC',
                              color: '#475569',
                              padding: '0.22rem 0.5rem',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                          >
                            {qc.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setActiveDrawer(null);
                      onOpenLocationRouteModal();
                    }}
                    style={{ width: '100%', fontSize: '0.76rem', borderRadius: '10px' }}
                  >
                    <Plus size={13} />
                    <span>Neuen Ort anlegen / Orte verwalten...</span>
                  </button>
                </div>
              )}

              {/* UNTER-TAB B: ROUTEN */}
              {locationSubTab === 'route' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                      Gespeicherte Routen ({routes.length})
                    </div>

                    {routes.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '1.2rem', background: '#F8FAFC', borderRadius: '12px', border: '1px dashed #CBD5E1' }}>
                        <Navigation size={22} color="#94A3B8" style={{ margin: '0 auto 0.4rem' }} />
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                          Noch keine Route angelegt
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.2rem', marginBottom: '0.8rem' }}>
                          Erstelle eine Fahrt-Route (z. B. Pendelstrecke), um günstige Tankstellen entlang deiner Strecke zu finden.
                        </p>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setActiveDrawer(null);
                            onOpenLocationRouteModal();
                          }}
                          style={{ fontSize: '0.75rem' }}
                        >
                          + Erste Route anlegen
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '2px' }}>
                        {routes.map((r) => {
                          const isSelected = activeRoute?.id === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                if (onSelectRoute) onSelectRoute(r.id);
                                setActiveDrawer(null);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.65rem 0.85rem',
                                borderRadius: '10px',
                                border: isSelected ? '1.5px solid #2563EB' : '1px solid #E2E8F0',
                                background: isSelected ? '#1E293B' : '#FFFFFF',
                                color: isSelected ? '#FFFFFF' : '#0F172A',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1, paddingRight: '0.5rem' }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <Navigation size={13} color={isSelected ? '#60A5FA' : '#2563EB'} />
                                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {r.name}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.7rem', opacity: isSelected ? 0.8 : 0.6, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {r.startName || 'Start'} ➔ {r.endName || 'Ziel'} • Korridor ±{r.corridorRadiusKm || 2.5} km
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                                <span
                                  style={{
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    background: isSelected ? 'rgba(59, 130, 246, 0.3)' : '#EFF6FF',
                                    color: isSelected ? '#93C5FD' : '#1D4ED8',
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '6px',
                                  }}
                                >
                                  {Number(r.totalDistanceKm || 0).toFixed(1)} km
                                </span>
                                {isSelected && <Check size={14} color="#60A5FA" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {activeRoute && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (onSelectRoute) onSelectRoute(null);
                        setActiveDrawer(null);
                      }}
                      style={{ width: '100%', fontSize: '0.74rem', color: '#64748B' }}
                    >
                      Route abwählen (Zurück zu Ort-Radius)
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setActiveDrawer(null);
                      onOpenLocationRouteModal();
                    }}
                    style={{ width: '100%', fontSize: '0.76rem', borderRadius: '10px' }}
                  >
                    <Plus size={13} />
                    <span>Neue Route anlegen / Routen verwalten...</span>
                  </button>
                </div>
              )}

              {/* UNTER-TAB C: FAVORITEN */}
              {locationSubTab === 'favorites' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div
                    style={{
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: '10px',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: '#FEF3C7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Star size={18} fill="#F59E0B" color="#F59E0B" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#92400E' }}>
                        Favoriten-Filter aktiv
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#B45309', marginTop: '2px', lineHeight: 1.4 }}>
                        {favoriteStationIds.length > 0
                          ? `Es werden nur deine ${favoriteStationIds.length} favorisierten Tankstellen auf der Karte und im Radar angezeigt.`
                          : 'Du hast noch keine Tankstellen mit dem Stern ⭐ markiert.'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        if (onSelectFilterMode) onSelectFilterMode('favorites');
                        setActiveDrawer(null);
                      }}
                      style={{ flex: 1, borderRadius: '8px', fontSize: '0.76rem' }}
                    >
                      <span>Favoriten anzeigen</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (onSelectFilterMode) onSelectFilterMode('location');
                        setLocationSubTab('location');
                        setActiveDrawer(null);
                      }}
                      style={{ borderRadius: '8px', fontSize: '0.76rem' }}
                    >
                      <span>Zu Ort-Radius wechseln</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* DRAWER 2: FAHRZEUG DIREKT WECHSELN & VERBRAUCH */}
          {activeDrawer === 'vehicle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0F172A' }}>
                    Fahrzeug wählen & Verbrauch
                  </span>
                  <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                    Aktuell: <strong>{activeVehicle?.name || 'Auto'}</strong> ({effectiveConsumption} L/100km)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B', padding: '4px' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* 1. Direkte Fahrzeugauswahl aus allen gespeicherten Autos */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                  Fahrzeug wechseln ({vehicles.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '2px' }}>
                  {vehicles.map((v) => {
                    const isSelected = activeVehicle?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          if (onSelectVehicle) onSelectVehicle(v.id);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.6rem 0.8rem',
                          borderRadius: '10px',
                          border: isSelected ? '1.5px solid #0F172A' : '1px solid #E2E8F0',
                          background: isSelected ? '#0F172A' : '#FFFFFF',
                          color: isSelected ? '#FFFFFF' : '#0F172A',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: '0.5rem' }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Car size={14} color={isSelected ? '#38BDF8' : '#0F172A'} />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {v.name}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.68rem', opacity: isSelected ? 0.85 : 0.65, marginTop: '2px' }}>
                            {v.brand || 'Auto'} • {v.fuelType.toUpperCase()} • {v.consumptionL100km} L/100km • {v.tankCapacityL}L Tank
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                          {isSelected && <Check size={14} color="#38BDF8" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Schnellanpassung für das gewählte Fahrzeug */}
              <div style={{ background: '#F8FAFC', padding: '0.75rem 0.85rem', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {/* Verbrauch Regler */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#64748B' }}>Realverbrauch ({activeVehicle?.name}):</span>
                    <strong className="num-mono" style={{ color: '#0F172A', fontWeight: 800 }}>
                      {effectiveConsumption} L/100km
                    </strong>
                  </div>
                  <input
                    type="range"
                    min="3.5"
                    max="14.0"
                    step="0.1"
                    value={effectiveConsumption}
                    onChange={(e) => onUpdateCustomConsumption(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: '#0F172A', cursor: 'pointer' }}
                  />
                </div>

                {/* Tankmenge Regler */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#64748B' }}>Zu tankende Menge:</span>
                    <strong className="num-mono" style={{ color: '#0F172A', fontWeight: 800 }}>
                      {neededLiters} Liter
                    </strong>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="5"
                    value={neededLiters}
                    onChange={(e) => onUpdateCustomLiters(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: '#0F172A', cursor: 'pointer' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {hasVehicleOverrides && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onResetVehicleOverrides}
                    style={{ flex: 1, fontSize: '0.72rem' }}
                  >
                    <RotateCcw size={11} />
                    <span>Auf Werksdaten</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setActiveDrawer(null);
                    onOpenVehicleModal();
                  }}
                  style={{ flex: 1, fontSize: '0.74rem', borderRadius: '10px' }}
                >
                  <Car size={13} />
                  <span>+ Auto anlegen / Garage...</span>
                </button>
              </div>
            </div>
          )}

          {/* DRAWER 3: KRAFTSTOFF */}
          {activeDrawer === 'fuel' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                  Kraftstoffsorte wählen
                </span>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                {[
                  { id: 'diesel', label: 'Diesel', desc: 'B7 Standard' },
                  { id: 'e10', label: 'Super E10', desc: '95 Oktan 10% Bio' },
                  { id: 'e5', label: 'Super E5', desc: '95 Oktan 5% Bio' },
                ].map((fuel) => {
                  const isSelected = selectedFuel === fuel.id;
                  return (
                    <button
                      key={fuel.id}
                      type="button"
                      onClick={() => {
                        onSelectFuel(fuel.id);
                        setActiveDrawer(null);
                      }}
                      style={{
                        padding: '0.65rem 0.5rem',
                        borderRadius: '8px',
                        border: `1px solid ${isSelected ? '#0F172A' : '#E2E8F0'}`,
                        background: isSelected ? '#0F172A' : '#F8FAFC',
                        color: isSelected ? '#FFFFFF' : '#0F172A',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{fuel.label}</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, marginTop: '0.15rem' }}>{fuel.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* DRAWER 4: SORTIERUNG */}
          {activeDrawer === 'sort' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                  Ergebnis-Sortierung
                </span>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                {[
                  { id: 'score', label: 'KI-Score', desc: 'Empfehlung aus Preis, Zyklus & Umweg' },
                  { id: 'savings', label: 'Netto-Ersparnis', desc: 'Reale Euro-Ersparnis abzüglich Sprit' },
                  { id: 'price', label: 'Niedrigster Preis', desc: 'Reiner Zapfsäulenpreis pro Liter' },
                  { id: 'distance', label: 'Kürzeste Distanz', desc: 'Nächste Tankstellen zuerst' },
                ].map((s) => {
                  const isSelected = sortBy === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onSelectSort(s.id);
                        setActiveDrawer(null);
                      }}
                      style={{
                        padding: '0.55rem 0.65rem',
                        borderRadius: '8px',
                        border: `1px solid ${isSelected ? '#0F172A' : '#E2E8F0'}`,
                        background: isSelected ? '#0F172A' : '#F8FAFC',
                        color: isSelected ? '#FFFFFF' : '#0F172A',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.78rem' }}>{s.label}</div>
                      <div style={{ fontSize: '0.66rem', opacity: 0.7, marginTop: '2px' }}>{s.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
