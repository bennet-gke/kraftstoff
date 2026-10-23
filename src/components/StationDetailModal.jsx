import React, { useState, useMemo } from 'react';
import { X, Navigation, Sparkles, Activity, MapPin, Calculator, Car, Gauge, CheckCircle2, AlertTriangle, ArrowRight, Clock, ShieldCheck, Zap, Calendar, TrendingDown } from 'lucide-react';
import PriceTrendChart from './PriceTrendChart';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { simulateArrivalPriceMonteCarlo, calculateOptimalTimingForStation } from '../engine/monteCarloArrival';

export default function StationDetailModal({
  station,
  baseStation,
  activeVehicle,
  evaluation,
  mlPrediction,
  fuelType = 'diesel',
  defaultDetourMode = 'local_roundtrip',
  onClose,
}) {
  if (!station) return null;

  // Interaktive Rechner-Parameter im Modal
  const defaultLiters = activeVehicle
    ? Math.round(activeVehicle.tankCapacityL * (1 - (activeVehicle.currentFuelLevelPct || 20) / 100))
    : 45;

  const [simLiters, setSimLiters] = useState(defaultLiters);
  const [simConsumption, setSimConsumption] = useState(activeVehicle?.consumptionL100km || 6.2);
  const [simWear, setSimWear] = useState(0.06); // 6 Cent/km Verschleiß
  const [modalDetourMode, setModalDetourMode] = useState(station.isOnRouteCorridor ? 'route_corridor' : defaultDetourMode);

  // Umweg-Rentabilität
  const detour = useMemo(() => {
    return calculateDetourProfitability({
      targetPrice: station.currentPrice,
      targetDistanceKm: station.distanceKm,
      basePrice: baseStation ? baseStation.currentPrice : station.currentPrice,
      baseDistanceKm: baseStation ? baseStation.distanceKm : 0,
      fillLiters: simLiters,
      consumptionL100km: simConsumption,
      wearCostPerKm: simWear,
      isRoundtrip: modalDetourMode !== 'route_corridor',
      detourMode: modalDetourMode,
      realAdditionalKm: station.realAdditionalKm,
    });
  }, [station.currentPrice, station.distanceKm, station.realAdditionalKm, baseStation, simLiters, simConsumption, simWear, modalDetourMode]);

  // Monte-Carlo Ankunftssimulation (1.000 Pfade)
  const arrival = useMemo(() => {
    return simulateArrivalPriceMonteCarlo({
      currentPrice: station.currentPrice,
      distanceKm: station.distanceKm,
      isRouteCorridor: modalDetourMode === 'route_corridor',
    });
  }, [station.currentPrice, station.distanceKm, modalDetourMode]);

  // Optimale Uhrzeiten & Bester Tag
  const timing = useMemo(() => {
    return calculateOptimalTimingForStation(station.currentPrice, station.history);
  }, [station.currentPrice, station.history]);

  const timingSavingsEuro = ((timing.savingsVsNowCent * simLiters) / 100).toFixed(2);

  const openNavigation = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
    window.open(url, '_blank');
  };

  const isCheap = evaluation?.isCheap;
  const score = mlPrediction?.score || evaluation?.score || 50;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '840px', maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '4px',
                  background: '#F1F5F9',
                  color: '#334155',
                }}
              >
                {station.brand}
              </span>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>
                {station.name}
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B', fontSize: '0.78rem', marginTop: '0.25rem' }}>
              <MapPin size={13} color="#94A3B8" />
              <span>{station.street}, {station.postCode || ''} {station.city}</span>
              <span>•</span>
              <span className="num-mono" style={{ fontWeight: 600 }}>{station.distanceKm} km entfernt</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="btn btn-sm btn-primary" onClick={openNavigation}>
              <Navigation size={13} />
              <span>Navigation</span>
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.25rem' }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 1. WIRTSCHAFTLICHKEITS-RECHNER: Lohnt sich die Fahrt? */}
        <div
          style={{
            background: detour.isProfitable ? '#ECFDF5' : '#FFF1F2',
            border: `1px solid ${detour.isProfitable ? '#A7F3D0' : '#FECDD3'}`,
            borderRadius: '10px',
            padding: '1.1rem',
            marginBottom: '1.25rem',
          }}
        >
          {/* Umschalter für die Fahrt-Option */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Calculator size={16} color={detour.isProfitable ? '#059669' : '#DC2626'} />
              <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>
                Wirtschaftlichkeits-Rechnung: Lohnt sich die Fahrt?
              </strong>
            </div>

            {/* Option: Von einem Ort aus vs. An einer Strecke */}
            <div style={{ display: 'flex', background: '#FFFFFF', padding: '0.15rem', borderRadius: '6px', border: '1px solid #CBD5E1' }}>
              <button
                type="button"
                onClick={() => setModalDetourMode('local_roundtrip')}
                style={{
                  border: 'none',
                  background: modalDetourMode === 'local_roundtrip' ? '#0F172A' : 'transparent',
                  color: modalDetourMode === 'local_roundtrip' ? '#FFFFFF' : '#475569',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Vom Ort aus (Hin & Rück)
              </button>
              <button
                type="button"
                onClick={() => setModalDetourMode('route_corridor')}
                style={{
                  border: 'none',
                  background: modalDetourMode === 'route_corridor' ? '#0F172A' : 'transparent',
                  color: modalDetourMode === 'route_corridor' ? '#FFFFFF' : '#475569',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                An Fahrt-Strecke (Zusatz-km)
              </button>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.85rem' }}>
            {detour.reasoning}
          </p>

          {/* Detaillierte Zahlenrechnung */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.6rem',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.75rem',
              marginBottom: '0.85rem',
            }}
          >
            <div>
              <span style={{ color: '#94A3B8', display: 'block' }}>Brutto-Ersparnis Zapfsäule</span>
              <strong className="num-mono" style={{ color: '#059669', fontSize: '1rem' }}>
                +{detour.grossSavingsEuro.toFixed(2)} €
              </strong>
              <span style={{ color: '#64748B', display: 'block' }}>({detour.priceDiffCent} ct/L bei {simLiters} L)</span>
            </div>

            <div>
              <span style={{ color: '#94A3B8', display: 'block' }}>
                {modalDetourMode === 'route_corridor' ? 'Spritkosten Zusatz-km' : 'Spritkosten Hin/Rück'}
              </span>
              <strong className="num-mono" style={{ color: '#DC2626', fontSize: '1rem' }}>
                -{detour.fuelCostDetourEuro.toFixed(2)} €
              </strong>
              <span style={{ color: '#64748B', display: 'block' }}>({detour.totalDetourKm} km Mehrweg)</span>
            </div>

            <div>
              <span style={{ color: '#94A3B8', display: 'block' }}>Verschleiß ({simWear} €/km)</span>
              <strong className="num-mono" style={{ color: '#64748B', fontSize: '1rem' }}>
                -{detour.wearCostEuro.toFixed(2)} €
              </strong>
              <span style={{ color: '#64748B', display: 'block' }}>Reifen & Bremsen</span>
            </div>

            <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: '0.6rem' }}>
              <span style={{ color: '#0F172A', display: 'block', fontWeight: 700 }}>Echter Reingewinn</span>
              <strong
                className="num-mono"
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: detour.netSavingsEuro >= 0 ? '#059669' : '#DC2626',
                }}
              >
                {detour.netSavingsEuro > 0 ? `+${detour.netSavingsEuro.toFixed(2)} €` : `${detour.netSavingsEuro.toFixed(2)} €`}
              </strong>
              <span style={{ color: '#64748B', display: 'block' }}>Max. Mehrweg: {detour.maxDetourKm} km</span>
            </div>
          </div>

          {/* Interaktive Feinjustierung: Liter & Verbrauch */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.73rem', color: '#475569' }}>
            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                <span>Zu tankende Menge (Liter):</span>
                <strong className="num-mono">{simLiters} Liter</strong>
              </label>
              <input
                type="range"
                min="10"
                max="85"
                step="5"
                value={simLiters}
                onChange={(e) => setSimLiters(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#0F172A' }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                <span>Verbrauch ({activeVehicle?.name || 'Auto'}):</span>
                <strong className="num-mono">{simConsumption} L/100km</strong>
              </label>
              <input
                type="range"
                min="3.5"
                max="14.0"
                step="0.2"
                value={simConsumption}
                onChange={(e) => setSimConsumption(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#0F172A' }}
              />
            </div>
          </div>
        </div>

        {/* 2. MONTE-CARLO PREISÄNDERUNGS-PROGNOSE (1.000 Simulationen) */}
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '10px',
            padding: '1.1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Clock size={16} color="#0F172A" />
              <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>
                Monte-Carlo Prognose: Ändert sich der Preis während der Anfahrt?
              </strong>
            </div>

            <span
              className={`badge ${arrival.riskLevel === 'HIGH' ? 'badge-unfavorable' : arrival.riskLevel === 'MEDIUM' ? 'badge-neutral' : 'badge-favorable'}`}
              style={{ fontSize: '0.76rem' }}
            >
              {arrival.riskLabel}
            </span>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.75rem' }}>
            {arrival.recommendation}
          </p>

          {/* Monte-Carlo Wahrscheinlichkeits-Balken */}
          <div style={{ marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.3rem' }}>
              <span>Wahrscheinlichkeits-Verteilung (1.000 Pfade):</span>
              <span>Ankunft in <strong>{arrival.driveTimeMin} Min.</strong> ({arrival.arrivalTimeFormatted} Uhr)</span>
            </div>

            <div style={{ display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', background: '#E2E8F0' }}>
              <div
                style={{ width: `${arrival.probabilities.pStable}%`, background: '#10B981' }}
                title={`Stabil: ${arrival.probabilities.pStable}%`}
              />
              <div
                style={{ width: `${arrival.probabilities.pDrop}%`, background: '#3B82F6' }}
                title={`Günstiger: ${arrival.probabilities.pDrop}%`}
              />
              <div
                style={{ width: `${arrival.probabilities.pRise}%`, background: '#EF4444' }}
                title={`Teurer: ${arrival.probabilities.pRise}%`}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '0.35rem', color: '#475569' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
                <span>Stabil ({arrival.probabilities.pStable}%)</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6' }} />
                <span>Preissenkung ({arrival.probabilities.pDrop}%)</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444' }} />
                <span>Preissprung ({arrival.probabilities.pRise}%)</span>
              </span>
            </div>
          </div>

          {/* Konfidenz-Intervall Box */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', background: '#F8FAFC', padding: '0.65rem 0.85rem', borderRadius: '6px', fontSize: '0.75rem' }}>
            <div>
              <span style={{ color: '#64748B', display: 'block' }}>Erwarteter Preis bei Ankunft:</span>
              <strong className="num-mono" style={{ fontSize: '1rem', color: '#0F172A' }}>
                {arrival.meanArrivalPrice.toFixed(3)} €/L
              </strong>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block' }}>90% Prognose-Korridor:</span>
              <strong className="num-mono" style={{ fontSize: '1rem', color: '#0F172A' }}>
                {arrival.priceRange90[0].toFixed(3)} – {arrival.priceRange90[1].toFixed(3)} €
              </strong>
            </div>
          </div>
        </div>

        {/* 3. OPTIMALE UHRZEITEN & TAGE (HEUTE & DIESE WOCHE) */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '10px',
            padding: '1.1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.6rem' }}>
            <Zap size={16} color="#D97706" />
            <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>
              Timing-Optimierer: Wann ist der ideale Tankzeitpunkt?
            </strong>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.85rem' }}>
            {timing.verdictText}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', fontSize: '0.75rem' }}>
            <div style={{ background: '#FFFFFF', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>Optimale Uhrzeit heute</span>
              <strong style={{ fontSize: '0.95rem', color: '#0F172A', display: 'block' }}>
                {timing.optimalHourToday}
              </strong>
              <span className="num-mono" style={{ color: '#059669', fontWeight: 600 }}>
                ~{timing.expectedOptimalPriceToday.toFixed(3)} € (-{timing.savingsVsNowCent} ct)
              </span>
            </div>

            <div style={{ background: '#FFFFFF', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>Sparpotenzial Tankfüllung</span>
              <strong className="num-mono" style={{ fontSize: '1.05rem', color: '#059669', display: 'block' }}>
                +{timingSavingsEuro} €
              </strong>
              <span style={{ color: '#64748B' }}>bei {simLiters} Litern heute Abend</span>
            </div>

            <div style={{ background: '#FFFFFF', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>Günstigster Tag der Woche</span>
              <strong style={{ fontSize: '0.95rem', color: '#0F172A', display: 'block' }}>
                {timing.bestDayOfWeek}
              </strong>
              <span className="num-mono" style={{ color: '#64748B' }}>
                ~{timing.expectedBestDayPrice.toFixed(3)} € erwartet
              </span>
            </div>
          </div>
        </div>

        {/* 4. D3.js PREISVERLAUFS-CHART */}
        <div style={{ marginBottom: '1.25rem' }}>
          <PriceTrendChart
            history={station.history}
            stationName={station.name}
            fuelType={fuelType}
            evaluation={evaluation}
          />
        </div>

        {/* 5. TENSORFLOW.JS KI-EMPFEHLUNG */}
        <div
          style={{
            background: score >= 70 ? '#ECFDF5' : '#F8FAFC',
            border: `1px solid ${score >= 70 ? '#A7F3D0' : '#E2E8F0'}`,
            borderRadius: '8px',
            padding: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
            <Sparkles size={16} color={score >= 70 ? '#059669' : '#0F172A'} />
            <strong style={{ fontSize: '0.88rem', color: '#0F172A' }}>
              TensorFlow.js Score: {score}/100 • {mlPrediction?.recommendation}
            </strong>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
            {mlPrediction?.reasoning}
          </p>
        </div>

      </div>
    </div>
  );
}
