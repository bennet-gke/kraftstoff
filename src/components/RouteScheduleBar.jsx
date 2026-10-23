import React, { useState, useEffect } from 'react';
import { Navigation, Coffee, Fuel, BellOff, Car, MapPin, SlidersHorizontal, Sparkles, Route, Compass, RotateCcw, LocateFixed } from 'lucide-react';
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

  return (
    <div className="clean-card" style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem' }}>
      
      {/* Obere Zeile: Fahrzeug, Standort & Radius, Route & Umweg-Modus */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', paddingBottom: '0.65rem', borderBottom: '1px solid #F1F5F9', marginBottom: '0.65rem' }}>
        
        {/* Aktives Fahrzeug mit Schnelljustierung */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenVehicleModal}
            title="Fahrzeug wechseln oder Garage öffnen"
            style={{ background: '#F8FAFC' }}
          >
            <Car size={13} color="#0F172A" />
            <span>Auto:</span>
            <strong style={{ color: '#0F172A' }}>{activeVehicle?.name || 'Auto'}</strong>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>
              ({customConsumption || activeVehicle?.consumptionL100km} L • {customLiters || Math.round(activeVehicle?.tankCapacityL * (1 - (activeVehicle?.currentFuelLevelPct || 20) / 100))} L nötig)
            </span>
          </button>

          <button
            className={`btn btn-sm ${showQuickSettings ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowQuickSettings(!showQuickSettings)}
            title="Verbrauch & Tankfüllung interaktiv anpassen"
            style={{ padding: '0.35rem 0.55rem' }}
          >
            <SlidersHorizontal size={12} />
            <span style={{ fontSize: '0.72rem' }}>Justieren</span>
          </button>
        </div>

        {/* Aktiver Standort & Suchradius */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenLocationRouteModal}
            title="Standort wechseln oder Suchradius ändern"
            style={{ background: '#F8FAFC' }}
          >
            <MapPin size={13} color="#0F172A" />
            <span>Standort:</span>
            <strong style={{ color: '#0F172A' }}>{activeLocation?.name || 'Mein Standort'}</strong>
            <span className="badge badge-gray" style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem' }}>
              {activeLocation?.radiusKm || 5} km
            </span>
          </button>

          {onLocateGps && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onLocateGps}
              title="Aktuellen GPS-Standort per Browser orten"
              style={{ background: '#F0F9FF', borderColor: '#BAE6FD', color: '#0369A1', padding: '0.3rem 0.55rem' }}
            >
              <LocateFixed size={12} color="#0284C7" />
              <span>GPS orten</span>
            </button>
          )}

          {onSelectQuickCity && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {QUICK_CITIES.slice(0, 4).map((qc) => {
                const isSelected = activeLocation?.name?.includes(qc.name);
                return (
                  <button
                    key={qc.id}
                    type="button"
                    onClick={() => onSelectQuickCity(qc)}
                    style={{
                      border: 'none',
                      background: isSelected ? '#0F172A' : '#F1F5F9',
                      color: isSelected ? '#FFFFFF' : '#475569',
                      padding: '0.2rem 0.45rem',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title={`${qc.name} als aktiven Standort wählen`}
                  >
                    {qc.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Aktive Route (falls gesetzt) */}
        <button
          className={`btn btn-sm ${activeRoute ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onOpenLocationRouteModal}
          title="Routen verwalten & OSM Korridorfilter"
          style={{ background: activeRoute ? undefined : '#F8FAFC' }}
        >
          <Navigation size={13} />
          <span>{activeRoute ? `Route: ${activeRoute.name}` : 'Route wählen...'}</span>
        </button>

        {/* Umweg-Modus Umschalter: Vom Ort aus vs. An einer Fahrt-Strecke */}
        <div style={{ display: 'flex', background: '#F1F5F9', padding: '0.15rem', borderRadius: '6px' }}>
          <button
            type="button"
            onClick={() => onSelectDetourMode('local_roundtrip')}
            style={{
              border: 'none',
              background: detourMode === 'local_roundtrip' ? '#0F172A' : 'transparent',
              color: detourMode === 'local_roundtrip' ? '#FFFFFF' : '#64748B',
              padding: '0.25rem 0.55rem',
              borderRadius: '4px',
              fontSize: '0.72rem',
              fontWeight: detourMode === 'local_roundtrip' ? 700 : 500,
              cursor: 'pointer',
            }}
            title="Berücksichtigt Hin- und Rückfahrt von deinem festen Standort zur Tankstelle (2x Entfernung)"
          >
            Vom Ort (Hin/Rück)
          </button>
          <button
            type="button"
            onClick={() => onSelectDetourMode('route_corridor')}
            style={{
              border: 'none',
              background: detourMode === 'route_corridor' ? '#0F172A' : 'transparent',
              color: detourMode === 'route_corridor' ? '#FFFFFF' : '#64748B',
              padding: '0.25rem 0.55rem',
              borderRadius: '4px',
              fontSize: '0.72rem',
              fontWeight: detourMode === 'route_corridor' ? 700 : 500,
              cursor: 'pointer',
            }}
            title="Berücksichtigt nur den realen Zusatzweg / Abstecher beim Tankvorgang entlang der Route"
          >
            An Strecke (Zusatz-km)
          </button>
        </div>

      </div>

      {/* Ausklappbare Schnelljustierung: Verbrauch & Tankmenge */}
      {showQuickSettings && (
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '0.75rem',
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
                {customConsumption || activeVehicle?.consumptionL100km} L/100km
              </strong>
            </div>
            <input
              type="range"
              min="3.5"
              max="14.0"
              step="0.1"
              value={customConsumption || activeVehicle?.consumptionL100km || 6.2}
              onChange={(e) => onUpdateCustomConsumption(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#475569', marginBottom: '0.2rem' }}>
              <span>Zu tankende Menge (Liter):</span>
              <strong className="num-mono" style={{ color: '#0F172A' }}>
                {customLiters || Math.round(activeVehicle?.tankCapacityL * (1 - (activeVehicle?.currentFuelLevelPct || 20) / 100))} L
              </strong>
            </div>
            <input
              type="range"
              min="10"
              max="90"
              step="5"
              value={customLiters || Math.round(activeVehicle?.tankCapacityL * (1 - (activeVehicle?.currentFuelLevelPct || 20) / 100))}
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

      {/* Untere Zeile: Kraftstoffart, Schnellaktionen & Sortierung */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        
        {/* Kraftstoffart-Wahl */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.78rem', fontWeight: 600 }}>
            <Fuel size={14} />
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
              >
                {fuel.label}
              </button>
            ))}
          </div>
        </div>

        {/* Kontextuelle Schnellaktionen: Heimweg & Arbeitspause */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          
          {/* Heimweg Button */}
          <button
            className={`btn btn-sm ${isCommuteActive ? 'btn-primary' : 'btn-secondary'}`}
            onClick={onToggleCommute}
            title="Filtert und priorisiert Tankstellen auf deiner täglichen Pendel-Strecke"
          >
            <Navigation size={13} />
            <span>Heimweg-Filter</span>
            {isCommuteActive && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34D399', marginLeft: '0.2rem' }} />
            )}
          </button>

          {/* Pause-Button ("Bin noch auf der Arbeit") */}
          {isPaused ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div className="badge badge-neutral" style={{ padding: '0.35rem 0.6rem' }}>
                <BellOff size={13} />
                <span>Pausiert: {timeLeft}</span>
              </div>
              <button
                className="btn btn-sm btn-secondary"
                onClick={onResumeAlerts}
                title="Benachrichtigungen sofort wieder aktivieren"
              >
                Fortsetzen
              </button>
            </div>
          ) : (
            <button
              className="btn btn-sm btn-secondary"
              onClick={onPause30Min}
              title="Pausiert Benachrichtigungen für 30 Minuten"
            >
              <Coffee size={13} color="#64748B" />
              <span>30 Min pausieren</span>
            </button>
          )}

          {/* Sortierung */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>Sortierung:</span>
            <select
              value={sortBy}
              onChange={(e) => onSelectSort(e.target.value)}
              style={{
                fontFamily: 'inherit',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#0F172A',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                padding: '0.3rem 0.6rem',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="score">KI-Score (Empfehlung)</option>
              <option value="price">Günstigster Preis</option>
              <option value="distance">Geringste Distanz</option>
              <option value="savings">Größte Netto-Ersparnis</option>
            </select>
          </div>

        </div>

      </div>
    </div>
  );
}
