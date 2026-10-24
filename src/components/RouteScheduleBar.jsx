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
  onOpenVehicleModal,
  activeLocation,
  locations: _locations = [],
  onSelectLocation: _onSelectLocation,
  onUpdateRadius,
  activeRoute: _activeRoute,
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
      case 'e10': return 'Super E10';
      case 'e5': return 'Super E5';
      default: return 'Diesel';
    }
  };

  return (
    <div style={{ marginBottom: '0.85rem' }}>
      {/* 1. HORIZONTALE FILTER-PILL-LEISTE (Mobil-optimiert, Swipeable) */}
      <div className="filter-pill-bar">
        
        {/* Pill 1: Ort & Radius */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'location' ? 'active' : ''}`}
          onClick={() => toggleDrawer('location')}
          title="Standort & Suchradius ändern"
        >
          <MapPin size={13} color={activeDrawer === 'location' ? '#FFFFFF' : '#0F172A'} />
          <span>{activeLocation?.name || 'Ort'} ({Number(activeLocation?.radiusKm || 5)} km)</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {/* Pill 2: Fahrzeug & Verbrauch */}
        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'vehicle' ? 'active' : ''}`}
          onClick={() => toggleDrawer('vehicle')}
          title="Fahrzeug & Verbrauch anpassen"
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

      {/* 2. SCHLANKE QUICK-DRAWER DETAILS (Öffnet sich nur bei Klick auf ein Pill) */}
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
          {/* DRAWER 1: STANDORT & RADIUS */}
          {activeDrawer === 'location' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                  Standort & Suchradius
                </span>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Quick Cities */}
              {onSelectQuickCity && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {QUICK_CITIES.map((qc) => {
                    const isSelected = activeLocation?.name?.toLowerCase().includes(qc.name.toLowerCase());
                    return (
                      <button
                        key={qc.id}
                        type="button"
                        onClick={() => {
                          onSelectQuickCity(qc);
                          setActiveDrawer(null);
                        }}
                        style={{
                          border: 'none',
                          background: isSelected ? '#0F172A' : '#F1F5F9',
                          color: isSelected ? '#FFFFFF' : '#475569',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: isSelected ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        {qc.name}
                      </button>
                    );
                  })}

                  {onLocateGps && (
                    <button
                      type="button"
                      onClick={() => {
                        onLocateGps();
                        setActiveDrawer(null);
                      }}
                      style={{
                        border: '1px solid #BAE6FD',
                        background: '#F0F9FF',
                        color: '#0369A1',
                        padding: '0.3rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <LocateFixed size={12} color="#0284C7" />
                      <span>GPS</span>
                    </button>
                  )}
                </div>
              )}

              {/* Radius Regler */}
              {onUpdateRadius && (
                <div style={{ background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.3rem' }}>
                    <span style={{ color: '#64748B' }}>Suchradius:</span>
                    <strong className="num-mono" style={{ color: '#0F172A' }}>
                      {Number(activeLocation?.radiusKm || 5)} km
                    </strong>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="25"
                    step="1"
                    value={Number(activeLocation?.radiusKm || 5)}
                    onChange={(e) => activeLocation?.id && onUpdateRadius(activeLocation.id, parseFloat(e.target.value) || 5)}
                    style={{ width: '100%', accentColor: '#0F172A', cursor: 'pointer' }}
                  />
                </div>
              )}

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setActiveDrawer(null);
                  onOpenLocationRouteModal();
                }}
                style={{ width: '100%', fontSize: '0.76rem' }}
              >
                Orte, Routen & OSM-Korridor verwalten...
              </button>
            </div>
          )}

          {/* DRAWER 2: FAHRZEUG & VERBRAUCH */}
          {activeDrawer === 'vehicle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                  Fahrzeug & Verbrauch: {activeVehicle?.name || 'Auto'}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveDrawer(null)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Verbrauch Regler */}
              <div style={{ background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748B' }}>Realverbrauch:</span>
                  <strong className="num-mono" style={{ color: '#0F172A' }}>
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
                  style={{ width: '100%', accentColor: '#0F172A' }}
                />
              </div>

              {/* Tankmenge Regler */}
              <div style={{ background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748B' }}>Zu tankende Menge:</span>
                  <strong className="num-mono" style={{ color: '#0F172A' }}>
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
                  style={{ width: '100%', accentColor: '#0F172A' }}
                />
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
                    <span>Zurücksetzen</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setActiveDrawer(null);
                    onOpenVehicleModal();
                  }}
                  style={{ flex: 1, fontSize: '0.72rem' }}
                >
                  <Car size={12} />
                  <span>Garage öffnen...</span>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {[
                  { id: 'savings', label: 'Größte Netto-Ersparnis', desc: 'Kombiniert Cent/L & Spritkosten für Mehrweg' },
                  { id: 'score', label: 'KI-Score Empfehlung', desc: 'TensorFlow.js Preisvorhersage & Stabilität' },
                  { id: 'price', label: 'Günstigster Preis', desc: 'Reiner Literpreis an der Zapfsäule' },
                  { id: 'distance', label: 'Geringste Distanz', desc: 'Nächste Tankstellen zuerst' },
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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.55rem 0.75rem',
                        borderRadius: '6px',
                        border: `1px solid ${isSelected ? '#0F172A' : '#E2E8F0'}`,
                        background: isSelected ? '#F8FAFC' : '#FFFFFF',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#0F172A' }}>
                          {s.label}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#64748B' }}>
                          {s.desc}
                        </div>
                      </div>
                      {isSelected && <Check size={14} color="#059669" />}
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
