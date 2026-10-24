import React, { useMemo } from 'react';
import { Sparkles, MapPin, Navigation, TrendingDown, TrendingUp, Minus, Calculator, Clock, ShieldCheck, AlertTriangle, Zap } from 'lucide-react';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { simulateArrivalPriceMonteCarlo, calculateOptimalTimingForStation } from '../engine/monteCarloArrival';

export default function StationCard({
  station,
  baseStation,
  activeVehicle,
  evaluation,
  mlPrediction,
  fuelType = 'diesel',
  detourMode = 'local_roundtrip',
  customConsumption = null,
  customLiters = null,
  isSelected = false,
  onSelect,
}) {
  const isCheap = evaluation?.isCheap;
  const deltaCent = evaluation?.deltaCent || 0;
  const score = mlPrediction?.score || evaluation?.score || 50;

  // Format price into base + superscript 9
  const priceStr = station.currentPrice.toFixed(3);
  const mainPrice = priceStr.slice(0, -1);
  const lastDigit = priceStr.slice(-1);

  // Füllmenge & Verbrauch berechnen
  const fillLiters = customLiters || (activeVehicle
    ? Math.round(activeVehicle.tankCapacityL * (1 - (activeVehicle.currentFuelLevelPct || 20) / 100))
    : 40);

  const consumption = customConsumption || activeVehicle?.consumptionL100km || 6.2;

  // Umweg-Rentabilität berechnen (mit Unterscheidung: Vom Ort aus vs. An der Strecke)
  const detour = useMemo(() => {
    return calculateDetourProfitability({
      targetPrice: station.currentPrice,
      targetDistanceKm: station.distanceKm,
      basePrice: baseStation ? baseStation.currentPrice : station.currentPrice,
      baseDistanceKm: baseStation ? baseStation.distanceKm : 0,
      fillLiters,
      consumptionL100km: consumption,
      isRoundtrip: detourMode !== 'route_corridor',
      detourMode,
      realAdditionalKm: station.realAdditionalKm,
    });
  }, [station.currentPrice, station.distanceKm, station.realAdditionalKm, baseStation, fillLiters, consumption, detourMode]);

  // Monte-Carlo Ankunftspreis-Simulation (1.000 Pfade)
  const arrival = useMemo(() => {
    return simulateArrivalPriceMonteCarlo({
      currentPrice: station.currentPrice,
      distanceKm: station.distanceKm,
      isRouteCorridor: station.isOnRouteCorridor || detourMode === 'route_corridor',
    });
  }, [station.currentPrice, station.distanceKm, station.isOnRouteCorridor, detourMode]);

  // Optimale Uhrzeiten & Tage Prognose
  const timing = useMemo(() => {
    return calculateOptimalTimingForStation(station.currentPrice, station.history);
  }, [station.currentPrice, station.history]);

  const timingSavingsEuro = ((timing.savingsVsNowCent * fillLiters) / 100).toFixed(2);

  return (
    <div
      className={`clean-card clean-card-hover ${isSelected ? 'selected-card' : ''}`}
      onClick={onSelect}
      style={{
        cursor: 'pointer',
        padding: '1.15rem',
        borderLeft: isCheap ? '4px solid #059669' : '1px solid #E2E8F0',
        borderColor: isSelected ? '#0F172A' : undefined,
        background: isSelected ? '#FAFAFA' : '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
      }}
    >
      {/* 1. Header: Name, Brand, Distanz & Preis */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: '#F1F5F9',
                color: '#334155',
                letterSpacing: '0.04em',
              }}
            >
              {station.brand || 'Frei'}
            </span>
            <h4
              style={{
                fontSize: '0.98rem',
                fontWeight: 700,
                color: '#0F172A',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {station.name}
            </h4>

            {station.isOnRouteCorridor && (
              <span className="badge badge-blue" style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}>
                <Navigation size={10} />
                <span>Auf Fahrt-Route (±{station.routeDetourKm} km)</span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B', fontSize: '0.78rem', marginTop: '0.25rem' }}>
            <MapPin size={13} color="#94A3B8" />
            <span>{station.street}, {station.city}</span>
            <span style={{ color: '#CBD5E1' }}>•</span>
            <span className="num-mono" style={{ fontWeight: 600 }}>{station.distanceKm} km entfernt</span>
          </div>
        </div>

        {/* Preis-Anzeige mit hochgestellter 9 */}
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span
              className="num-mono"
              style={{
                fontSize: '1.65rem',
                fontWeight: 800,
                color: isCheap ? '#059669' : '#0F172A',
                lineHeight: 1,
              }}
            >
              {mainPrice}
            </span>
            <span
              className="num-mono"
              style={{
                fontSize: '0.95rem',
                fontWeight: 700,
                color: isCheap ? '#059669' : '#0F172A',
                verticalAlign: 'super',
                marginLeft: '1px',
              }}
            >
              {lastDigit}
            </span>
            <span style={{ fontSize: '0.8rem', color: '#64748B', marginLeft: '0.25rem', fontWeight: 500 }}>
              €/L
            </span>
          </div>

          <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.1rem', textTransform: 'uppercase' }}>
            {fuelType}
          </span>
        </div>
      </div>

      {/* 2. WIRTSCHAFTLICHKEITS-CHECK: LITERPREIS vs. MEHRWEG KOMBINATION */}
      {baseStation && baseStation.id === station.id ? (
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.55rem 0.75rem',
            fontSize: '0.74rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '0.85rem' }}>📍</span>
            <div>
              <span style={{ fontWeight: 700, color: '#0F172A' }}>Basistankstelle</span>
              <span style={{ color: '#64748B', marginLeft: '0.35rem' }}>
                (Nächste Station: {station.distanceKm} km • Referenz für Mehrweg & Ersparnis)
              </span>
            </div>
          </div>
          <span className="badge badge-gray" style={{ fontSize: '0.66rem', fontWeight: 700, padding: '0.15rem 0.45rem' }}>
            Referenz vor Ort
          </span>
        </div>
      ) : baseStation && baseStation.id !== station.id ? (
        <div
          style={{
            background: detour.isProfitable ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${detour.isProfitable ? '#BBF7D0' : '#FECACA'}`,
            borderRadius: '8px',
            padding: '0.65rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.45rem',
          }}
        >
          {/* Kopfzeile: Fazit-Badge + Netto-Ergebnis */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Calculator size={14} color={detour.isProfitable ? '#059669' : '#DC2626'} />
              <span style={{ fontWeight: 700, fontSize: '0.78rem', color: detour.isProfitable ? '#166534' : '#991B1B' }}>
                {detour.isProfitable
                  ? `Fahrt lohnt sich! (+${detour.netSavingsEuro.toFixed(2)} € Reingewinn)`
                  : `Lohnt sich nicht (${detour.netSavingsEuro.toFixed(2)} € Verlust)`}
              </span>
            </div>
            <span
              className="num-mono"
              style={{
                fontWeight: 800,
                fontSize: '0.82rem',
                color: detour.isProfitable ? '#059669' : '#DC2626',
                background: '#FFFFFF',
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                border: `1px solid ${detour.isProfitable ? '#86EFAC' : '#FCA5A5'}`,
              }}
            >
              {detour.netSavingsEuro > 0 ? `+${detour.netSavingsEuro.toFixed(2)} € Netto` : `${detour.netSavingsEuro.toFixed(2)} € Verlust`}
            </span>
          </div>

          {/* 2 Spalten: Literpreis-Differenz an Zapfsäule vs. Fahrt- & Spritkosten */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              background: '#FFFFFF',
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #E2E8F0',
              fontSize: '0.72rem',
            }}
          >
            {/* Spalte 1: Literpreis & Zapfsäule */}
            <div>
              <div style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <span>⛽ Literpreis ({fillLiters} L Tankfüllung)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.15rem' }}>
                <strong
                  className="num-mono"
                  style={{
                    fontSize: '0.85rem',
                    color: detour.priceDiffCent > 0 ? '#059669' : '#DC2626',
                  }}
                >
                  {detour.priceDiffCent > 0 ? `-${detour.priceDiffCent.toFixed(1)} ct/L` : `+${Math.abs(detour.priceDiffCent).toFixed(1)} ct/L`}
                </strong>
                <span style={{ color: '#475569', fontSize: '0.68rem' }}>
                  vs. Basis ({baseStation.currentPrice.toFixed(3)} €)
                </span>
              </div>
              <div style={{ color: detour.grossSavingsEuro >= 0 ? '#059669' : '#DC2626', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                {detour.grossSavingsEuro >= 0 ? `+${detour.grossSavingsEuro.toFixed(2)} € an Säule` : `${detour.grossSavingsEuro.toFixed(2)} € an Säule`}
              </div>
            </div>

            {/* Spalte 2: Mehrweg & Spritkosten */}
            <div style={{ borderLeft: '1px solid #F1F5F9', paddingLeft: '0.5rem' }}>
              <div style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <span>🚗 Fahrt ({detourMode === 'route_corridor' ? 'Zusatzweg' : 'Hin- & Rückfahrt'})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.15rem' }}>
                <strong className="num-mono" style={{ fontSize: '0.85rem', color: '#0F172A' }}>
                  +{detour.totalDetourKm} km
                </strong>
                <span style={{ color: '#64748B', fontSize: '0.68rem' }}>
                  ({consumption} L/100km)
                </span>
              </div>
              <div style={{ color: '#DC2626', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                -{detour.fuelCostDetourEuro.toFixed(2)} € Spritkosten
              </div>
            </div>
          </div>

          {/* Transparenter Erklärsatz */}
          <div style={{ fontSize: '0.71rem', color: '#475569', lineHeight: 1.35 }}>
            {detour.isProfitable ? (
              <span>
                💡 <strong>Trotz {detour.totalDetourKm} km Mehrweg rentabel:</strong> Du sparst durch die {detour.priceDiffCent.toFixed(1)} ct/L weniger {detour.grossSavingsEuro.toFixed(2)} € an der Zapfsäule. Die Fahrt verbraucht nur {detour.fuelCostDetourEuro.toFixed(2)} € Sprit.
              </span>
            ) : (
              <span>
                ⚠️ <strong>Mehrweg frisst Ersparnis auf:</strong> Der Umweg von {detour.totalDetourKm} km kostet {detour.fuelCostDetourEuro.toFixed(2)} € Sprit. Das ist {detour.grossSavingsEuro > 0 ? `mehr als die ${detour.grossSavingsEuro.toFixed(2)} € Ersparnis an der Zapfsäule` : 'teurer als die Basistankstelle vor Ort'}.
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* 3. MONTE-CARLO PREISÄNDERUNGS-PROGNOSE BIS ZUR ANKUNFT */}
      <div
        style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: '6px',
          padding: '0.45rem 0.65rem',
          fontSize: '0.73rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.4rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#334155' }}>
          <Clock size={12} color="#0F172A" />
          <span>Ankunft in <strong>{arrival.driveTimeMin} Min.</strong> ({arrival.arrivalTimeFormatted} Uhr)</span>
          <span style={{ color: '#CBD5E1' }}>•</span>
          <span className="num-mono">Prognose: ~{arrival.meanArrivalPrice.toFixed(3)} €</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {arrival.riskLevel === 'HIGH' ? (
            <span
              className="badge badge-unfavorable"
              style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}
              title={arrival.recommendation}
            >
              <AlertTriangle size={10} />
              <span>{arrival.probabilities.pRise}% Preissprung-Risiko!</span>
            </span>
          ) : arrival.riskLevel === 'MEDIUM' ? (
            <span
              className="badge badge-neutral"
              style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}
              title={arrival.recommendation}
            >
              <span>{arrival.stabilityIndex}% Preis-Stabilität</span>
            </span>
          ) : (
            <span
              className="badge badge-favorable"
              style={{ fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}
              title={arrival.recommendation}
            >
              <ShieldCheck size={10} />
              <span>{arrival.probabilities.pStable}% stabil bis Ankunft</span>
            </span>
          )}
        </div>
      </div>

      {/* 4. OPTIMALE UHRZEIT & PROGNOSE (Heute vs. Optimal) */}
      {(!detour.isProfitable || timing.savingsVsNowCent >= 2.0) && (
        <div
          style={{
            background: timing.isCurrentlyOptimalWindow ? '#ECFDF5' : '#FFFBEB',
            border: `1px solid ${timing.isCurrentlyOptimalWindow ? '#A7F3D0' : '#FDE68A'}`,
            borderRadius: '6px',
            padding: '0.45rem 0.65rem',
            fontSize: '0.72rem',
            color: timing.isCurrentlyOptimalWindow ? '#065F46' : '#92400E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Zap size={12} color={timing.isCurrentlyOptimalWindow ? '#059669' : '#D97706'} />
            <span>
              {timing.isCurrentlyOptimalWindow ? (
                <strong>Jetzt optimales Preisfenster!</strong>
              ) : (
                <span>
                  Optimal heute: <strong>{timing.optimalHourToday}</strong> (~{timing.expectedOptimalPriceToday.toFixed(3)} €)
                </span>
              )}
            </span>
          </div>

          {!timing.isCurrentlyOptimalWindow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
              <span className="num-mono" style={{ color: '#059669' }}>
                +{timingSavingsEuro} € Sparpotenzial
              </span>
            </div>
          )}
        </div>
      )}

      {/* 5. Footer: AMA Trend + KI-Score + Details Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.2rem' }}>
        
        {/* Status-Badge aus der mathematischen Volatilitäts-Engine */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            className={`badge ${
              evaluation?.badgeColor === 'favorable'
                ? 'badge-favorable'
                : evaluation?.badgeColor === 'unfavorable'
                ? 'badge-unfavorable'
                : 'badge-neutral'
            }`}
          >
            {deltaCent < 0 ? (
              <TrendingDown size={12} />
            ) : deltaCent > 0 ? (
              <TrendingUp size={12} />
            ) : (
              <Minus size={12} />
            )}
            <span>
              {evaluation?.label || 'Normal'}{' '}
              {deltaCent !== 0 && (
                <span className="num-mono">
                  ({deltaCent > 0 ? `+${deltaCent.toFixed(1)}` : deltaCent.toFixed(1)} ct)
                </span>
              )}
            </span>
          </span>

          <span style={{ fontSize: '0.73rem', color: '#94A3B8' }}>
            Dyn. Ø {evaluation?.effectiveDynAverage?.toFixed(3)} €
          </span>
        </div>

        {/* TensorFlow.js KI-Score & Analysieren Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: score >= 75 ? '#ECFDF5' : score >= 50 ? '#EFF6FF' : '#FFF1F2',
              color: score >= 75 ? '#065F46' : score >= 50 ? '#1E40AF' : '#9F1239',
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.73rem',
              fontWeight: 700,
            }}
          >
            <Sparkles size={12} />
            <span>KI: {score}/100</span>
          </div>

          <button
            className="btn btn-sm btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
          >
            Details
          </button>
        </div>

      </div>

    </div>
  );
}
