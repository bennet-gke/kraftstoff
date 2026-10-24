import React, { useState, useEffect } from 'react';
import {
  Navigation,
  Coffee,
  Fuel,
  BellOff,
  Car,
  MapPin,
  SlidersHorizontal,
  RotateCcw,
  LocateFixed,
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
  locations = [],
  onSelectLocation,
  onUpdateRadius,
  activeRoute,
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
  const [showQuickSettings, setShowQuickSettings] = useState(false);

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
        setTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs} Min`);
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

  return (
    <div
      className="clean-card"
      style={{
        marginBottom: '1.25rem',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        background: '#FFFFFF',
      }}
    >
      {/* SEKTION 1: STANDORT, RADIUS & ROUTEN-KORRIDOR */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.65rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid #F1F5F9',
        }}
      >
        {/* Standort & Schnellwahl */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenLocationRouteModal}
            title="Standorte & Routen verwalten"
            style={{ background: '#F8FAFC', padding: '0.35rem 0.65rem' }}
          >
            <MapPin size={13} color="#0F172A" />
            <span style={{ color: '#64748B' }}>Ort:</span>
            <strong style={{ color: '#0F172A' }}>{activeLocation?.name || 'Mein Standort'}</strong>
          </button>

          {/* Quick Cities */}
          {onSelectQuickCity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
              {QUICK_CITIES.slice(0, 4).map((qc) => {
                const isSelected = activeLocation?.name?.toLowerCase().includes(qc.name.toLowerCase());
                return (
                  <button
                    key={qc.id}
                    type="button"
                    onClick={() => onSelectQuickCity(qc)}
                    style={{
                      border: 'none',
                      background: isSelected ? '#0F172A' : '#F1F5F9',
                      color: isSelected ? '#FFFFFF' : '#475569',
                      padding: '0.22rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.71rem',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title={`${qc.name} als aktiven Standort wählen`}
                  >
                    {qc.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* GPS-Ortung */}
          {onLocateGps && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onLocateGps}
              title="Aktuellen GPS-Standort per Browser orten"
              style={{ background: '#F0F9FF', borderColor: '#BAE6FD', color: '#0369A1', padding: '0.25rem 0.55rem' }}
            >
              <LocateFixed size={12} color="#0284C7" />
              <span>GPS</span>
            </button>
          )}
        </div>

        {/* Suchradius Schieberegler & Route */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          {onUpdateRadius && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.74rem' }}>
              <span style={{ color: '#64748B' }}>Radius:</span>
              <input
                type="range"
                min="2"
                max="25"
                step="1"
                value={Number(activeLocation?.radiusKm || 5)}
                onChange={(e) => activeLocation?.id && onUpdateRadius(activeLocation.id, parseFloat(e.target.value) || 5)}
                style={{ width: '80px', accentColor: '#0F172A', cursor: 'pointer' }}
                title="Suchradius anpassen"
              />
              <strong className="num-mono" style={{ color: '#0F172A', minWidth: '35px' }}>
                {Number(activeLocation?.radiusKm || 5)} km
              </strong>
            </div>
          )}

          {/* Route Button */}
          <button
            className={`btn btn-sm ${activeRoute ? 'btn-primary' : 'btn-secondary'}`}
            onClick={onOpenLocationRouteModal}
            title="Routen verwalten & OSM Korridorfilter"
            style={{ padding: '0.35rem 0.65rem' }}
          >
            <Navigation size={12} />
            <span>{activeRoute ? `Route: ${activeRoute.name}` : 'Route wählen'}</span>
          </button>
        </div>
      </div>

      {/* SEKTION 2: FAHRZEUG, VERBRAUCH & UMWEG-MODUS */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.65rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid #F1F5F9',
        }}
      >
        {/* Fahrzeug & Parameter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenVehicleModal}
            title="Fahrzeug wechseln oder Garage öffnen"
            style={{ background: '#F8FAFC', padding: '0.35rem 0.65rem' }}
          >
            <Car size={13} color="#0F172A" />
            <span style={{ color: '#64748B' }}>Fahrzeug:</span>
            <strong style={{ color: '#0F172A' }}>{activeVehicle?.name || 'Auto'}</strong>
            <span className="badge badge-gray" style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem' }}>
              {effectiveConsumption} L/100km • {neededLiters} L Tankbedarf
            </span>
          </button>

          <button
            className={`btn btn-sm ${showQuickSettings ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowQuickSettings(!showQuickSettings)}
            title="Verbrauch & Tankfüllung interaktiv anpassen"
            style={{ padding: '0.3rem 0.55rem' }}
          >
            <SlidersHorizontal size={12} />
            <span>{showQuickSettings ? 'Schließen' : 'Werte justieren'}</span>
          </button>
        </div>

        {/* Umweg-Modus Umschalter (Vom Ort Hin/Rück vs. An Strecke Zusatz-km) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>Mehrweg-Berechnung:</span>
          <div style={{ display: 'flex', background: '#F1F5F9', padding: '0.15rem', borderRadius: '6px' }}>
            <button
              type="button"
              onClick={() => onSelectDetourMode('local_roundtrip')}
              style={{
                border: 'none',
                background: detourMode === 'local_roundtrip' ? '#0F172A' : 'transparent',
                color: detourMode === 'local_roundtrip' ? '#FFFFFF' : '#64748B',
                padding: '0.22rem 0.55rem',
                borderRadius: '4px',
                fontSize: '0.71rem',
                fontWeight: detourMode === 'local_roundtrip' ? 700 : 500,
                cursor: 'pointer',
              }}
              title="Berücksichtigt Hin- und Rückfahrt von deinem festen Standort zur Tankstelle (2x Entfernung)"
            >
              Vom Ort (Hin & Rück)
            </button>
            <button
              type="button"
              onClick={() => onSelectDetourMode('route_corridor')}
              style={{
                border: 'none',
                background: detourMode === 'route_corridor' ? '#0F172A' : 'transparent',
                color: detourMode === 'route_corridor' ? '#FFFFFF' : '#64748B',
                padding: '0.22rem 0.55rem',
                borderRadius: '4px',
                fontSize: '0.71rem',
                fontWeight: detourMode === 'route_corridor' ? 700 : 500,
                cursor: 'pointer',
              }}
              title="Berücksichtigt nur den realen Zusatzweg / Abstecher beim Tankvorgang entlang der Route"
            >
              An Strecke (Zusatz-km)
            </button>
          </div>
        </div>
      </div>

      {/* Ausklappbare Feinjustierung (falls geöffnet) */}
      {showQuickSettings && (
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#475569', marginBottom: '0.2rem' }}>
              <span>Verbrauch anpassen:</span>
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

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#475569', marginBottom: '0.2rem' }}>
              <span>Zu tankende Menge:</span>
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

          {hasVehicleOverrides && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onResetVehicleOverrides}
                style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                title="Werte auf Autowerte zurücksetzen"
              >
                <RotateCcw size={11} />
                <span>Standard wiederherstellen</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* SEKTION 3: KRAFTSTOFF, FILTER & SORTIERUNG */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.65rem' }}>
        
        {/* Kraftstoffart-Auswahl */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#64748B', fontSize: '0.76rem', fontWeight: 600 }}>
            <Fuel size={13} />
            <span>Sorte:</span>
          </div>
          <div className="nav-pill-group">
            {[
              { id: 'diesel', label: 'Diesel' },
              { id: 'e10', label: 'Super E10' },
              { id: 'e5', label: 'Super E5' },
            ].map((fuel) => (
              <button
                key={fuel.id}
                className={`nav-pill-btn ${selectedFuel === fuel.id ? 'active' : ''}`}
                onClick={() => onSelectFuel(fuel.id)}
                style={{ padding: '0.22rem 0.65rem', fontSize: '0.75rem' }}
              >
                {fuel.label}
              </button>
            ))}
          </div>
        </div>

        {/* Schnellaktionen: Heimweg, Pause & Sortierung */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          
          {/* Heimweg-Filter */}
          <button
            className={`btn btn-sm ${isCommuteActive ? 'btn-primary' : 'btn-secondary'}`}
            onClick={onToggleCommute}
            title="Filtert und priorisiert Tankstellen auf deiner täglichen Pendel-Strecke"
            style={{ padding: '0.3rem 0.6rem' }}
          >
            <Navigation size={12} />
            <span>Heimweg-Filter</span>
            {isCommuteActive && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399', marginLeft: '0.2rem' }} />
            )}
          </button>

          {/* Pause 30 Min */}
          {isPaused ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <div className="badge badge-neutral" style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}>
                <BellOff size={11} />
                <span>Pausiert: {timeLeft}</span>
              </div>
              <button
                className="btn btn-sm btn-secondary"
                onClick={onResumeAlerts}
                title="Benachrichtigungen sofort wieder aktivieren"
                style={{ padding: '0.25rem 0.5rem' }}
              >
                Fortsetzen
              </button>
            </div>
          ) : (
            <button
              className="btn btn-sm btn-secondary"
              onClick={onPause30Min}
              title="Pausiert Benachrichtigungen für 30 Minuten"
              style={{ padding: '0.3rem 0.55rem' }}
            >
              <Coffee size={12} color="#64748B" />
              <span>30 Min Pause</span>
            </button>
          )}

          {/* Sortierung */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Sortierung:</span>
            <select
              value={sortBy}
              onChange={(e) => onSelectSort(e.target.value)}
              style={{
                fontFamily: 'inherit',
                fontSize: '0.76rem',
                fontWeight: 600,
                color: '#0F172A',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                padding: '0.25rem 0.55rem',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="score">KI-Score (Empfehlung)</option>
              <option value="savings">Größte Netto-Ersparnis</option>
              <option value="price">Günstigster Preis</option>
              <option value="distance">Geringste Distanz</option>
            </select>
          </div>

        </div>

      </div>
    </div>
  );
}
