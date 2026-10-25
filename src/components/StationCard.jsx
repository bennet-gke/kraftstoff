import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  MapPin,
  Navigation,
  TrendingDown,
  TrendingUp,
  Calculator,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Zap,
  ChevronDown,
  ChevronUp,
  Star,
} from 'lucide-react';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { simulateArrivalPriceMonteCarlo, calculateOptimalTimingForStation } from '../engine/monteCarloArrival';

export default function StationCard({
  station,
  baseStation,
  activeVehicle,
  evaluation,
  mlPrediction,
  fuelType: _fuelType = 'diesel',
  detourMode = 'local_roundtrip',
  customConsumption = null,
  customLiters = null,
  isFavorite = false,
  onToggleFavorite,
  isSelected = false,
  onSelect,
}) {
  const [isExpanded, setIsExpanded] = useState(isSelected);

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

  // Umweg-Rentabilität berechnen
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

  // Monte-Carlo Ankunftspreis-Simulation
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

  // Maps Link für Direkt-Navigation auf dem Smartphone
  const openNavigation = (e) => {
    e.stopPropagation();
    const query = station.lat && station.lng
      ? `${station.lat},${station.lng}`
      : encodeURIComponent(`${station.name}, ${station.street}, ${station.city}`);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const mapsUrl = isIOS
      ? `maps://maps.apple.com/?daddr=${query}`
      : `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    window.open(mapsUrl, '_blank');
  };

  const isBase = baseStation && baseStation.id === station.id;

  return (
    <div
      className={`accordion-card ${isExpanded ? 'is-expanded' : ''} ${isCheap ? 'is-favorable' : ''}`}
    >
      {/* 1. KOPFZEILE (One-Glance Header mit geschützten Zeilen & ohne Textumbrüche) */}
      <div
        className="accordion-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          background: isExpanded ? '#FAFAFA' : '#FFFFFF',
          transition: 'background 0.15s ease',
        }}
      >
        {/* Zeile 1: Marke, Name & Großer Preis */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '0.12rem 0.42rem',
                borderRadius: '4px',
                background: '#F1F5F9',
                color: '#334155',
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              {station.brand || 'Frei'}
            </span>

            <h4
              style={{
                fontSize: '0.92rem',
                fontWeight: 700,
                color: '#0F172A',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {station.name}
            </h4>

            {station.isOpen === false && (
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: '#DC2626',
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  padding: '0.1rem 0.38rem',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Geschlossen
              </span>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onToggleFavorite) onToggleFavorite(station.id);
              }}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
              style={{
                border: 'none',
                background: isFavorite ? '#FEF3C7' : 'transparent',
                borderRadius: '50%',
                width: '26px',
                height: '26px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: isFavorite ? '#F59E0B' : '#94A3B8',
                transition: 'all 0.15s ease',
                flexShrink: 0,
                padding: 0,
              }}
            >
              <Star size={14} fill={isFavorite ? '#F59E0B' : 'none'} color={isFavorite ? '#F59E0B' : '#94A3B8'} />
            </button>

            {station.isOnRouteCorridor && (
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: '#1D4ED8',
                  background: '#EFF6FF',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  flexShrink: 0,
                  border: '1px solid #BFDBFE',
                }}
              >
                <Navigation size={9} />
                <span>km {station.kmAlongRoute || '–'} ({station.routeSegmentLabel || 'Route'})</span>
              </span>
            )}
          </div>

          {/* Großer Preis mit hochgestellter 9 */}
          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'baseline', flexShrink: 0 }}>
            <span
              className="num-mono"
              style={{
                fontSize: '1.45rem',
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
                fontSize: '0.85rem',
                fontWeight: 700,
                color: isCheap ? '#059669' : '#0F172A',
                verticalAlign: 'super',
                marginLeft: '1px',
              }}
            >
              {lastDigit}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#64748B', marginLeft: '0.2rem', fontWeight: 500 }}>
              €
            </span>
          </div>
        </div>

        {/* Zeile 2: Entfernung & Fahrzeit • Trend • Netto-Vorteil • Chevron */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.1rem' }}>
          
          {/* Linker Kennwerte-Block: white-space: nowrap verhindert vertikales Umbrechen von km & ct */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.74rem',
              color: '#64748B',
              whiteSpace: 'nowrap',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {station.isOnRouteCorridor && station.kmAlongRoute !== undefined ? (
              <>
                <Navigation size={11} color="#2563EB" style={{ flexShrink: 0 }} />
                <span className="num-mono" style={{ fontWeight: 700, color: '#1D4ED8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  km {station.kmAlongRoute}
                </span>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0, color: '#2563EB' }}>
                  {station.routeDetourKm < 0.1 ? 'an der Strecke' : `+${(station.routeDetourKm * 1000).toFixed(0)}m Abstecher`}
                </span>
              </>
            ) : (
              <>
                <MapPin size={11} color="#94A3B8" style={{ flexShrink: 0 }} />
                <span className="num-mono" style={{ fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {station.distanceKm} km
                </span>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                  ~{arrival.driveTimeMin} Min.
                </span>
              </>
            )}

            {deltaCent !== 0 && (
              <>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span
                  style={{
                    color: deltaCent < 0 ? '#059669' : '#DC2626',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.15rem',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {deltaCent < 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                  <span>{deltaCent > 0 ? `+${deltaCent.toFixed(1)}` : deltaCent.toFixed(1)} ct</span>
                </span>
              </>
            )}
          </div>

          {/* Rechter Vorteil-Block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
            {isBase ? (
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  background: '#F1F5F9',
                  color: '#475569',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                📍 Basis vor Ort
              </span>
            ) : detour.isProfitable ? (
              <span
                className="num-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  background: '#ECFDF5',
                  color: '#059669',
                  border: '1px solid #A7F3D0',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                +{detour.netSavingsEuro.toFixed(2)} € Netto
              </span>
            ) : (
              <span
                className="num-mono"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  background: '#FFF1F2',
                  color: '#DC2626',
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                {detour.netSavingsEuro.toFixed(2)} €
              </span>
            )}

            {/* Ausklapp-Pfeil mit sanfter Drehanimation */}
            <div
              style={{
                color: '#94A3B8',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <ChevronDown size={14} />
            </div>
          </div>

        </div>
      </div>

      {/* 2. HARMONISCHER, INTEGRIERTER DETAILBEREICH (Ohne abgeschnittene Tabs) */}
      {isExpanded && (
        <div className="accordion-expanded-body">
          
          {/* SEKTION A: WIRTSCHAFTLICHKEITS-RECHNER (Zapfsäule vs. Fahrtweg) */}
          {isBase ? (
            <div
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '0.65rem 0.8rem',
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.9rem' }}>📍</span>
                <div>
                  <strong style={{ color: '#0F172A' }}>Basistankstelle vor Ort</strong>
                  <div style={{ color: '#64748B', fontSize: '0.68rem', marginTop: '0.1rem' }}>
                    Nächste Station ({station.distanceKm} km) • Dient als 0,00 € Vergleichsreferenz für alle anderen Tankstellen
                  </div>
                </div>
              </div>
              <span className="badge badge-gray" style={{ fontSize: '0.64rem', flexShrink: 0 }}>Referenz</span>
            </div>
          ) : (
            <div
              style={{
                background: detour.isProfitable ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${detour.isProfitable ? '#BBF7D0' : '#FECACA'}`,
                borderRadius: '8px',
                padding: '0.65rem 0.8rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {/* Kopfzeile: Fazit */}
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
                    fontSize: '0.8rem',
                    color: detour.isProfitable ? '#059669' : '#DC2626',
                    background: '#FFFFFF',
                    padding: '0.12rem 0.45rem',
                    borderRadius: '4px',
                    border: `1px solid ${detour.isProfitable ? '#86EFAC' : '#FCA5A5'}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {detour.netSavingsEuro > 0 ? `+${detour.netSavingsEuro.toFixed(2)} € Netto` : `${detour.netSavingsEuro.toFixed(2)} €`}
                </span>
              </div>

              {/* 2 Spalten: Zapfsäule vs. Fahrt- & Spritkosten */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  background: '#FFFFFF',
                  padding: '0.5rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  fontSize: '0.72rem',
                }}
              >
                {/* Spalte 1: Zapfsäule */}
                <div>
                  <div style={{ color: '#64748B', fontWeight: 600 }}>
                    ⛽ Zapfsäule ({fillLiters} L)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', marginTop: '0.15rem' }}>
                    <strong
                      className="num-mono"
                      style={{
                        fontSize: '0.84rem',
                        color: detour.priceDiffCent > 0 ? '#059669' : '#DC2626',
                      }}
                    >
                      {detour.priceDiffCent > 0 ? `-${detour.priceDiffCent.toFixed(1)} ct/L` : `+${Math.abs(detour.priceDiffCent).toFixed(1)} ct/L`}
                    </strong>
                  </div>
                  <div style={{ color: detour.grossSavingsEuro >= 0 ? '#059669' : '#DC2626', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                    {detour.grossSavingsEuro >= 0 ? `+${detour.grossSavingsEuro.toFixed(2)} € an Säule` : `${detour.grossSavingsEuro.toFixed(2)} € an Säule`}
                  </div>
                </div>

                {/* Spalte 2: Fahrtkosten */}
                <div style={{ borderLeft: '1px solid #F1F5F9', paddingLeft: '0.5rem' }}>
                  <div style={{ color: '#64748B', fontWeight: 600 }}>
                    🚗 Fahrt ({detourMode === 'route_corridor' ? 'Zusatzweg' : 'Hin & Rück'})
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem', marginTop: '0.15rem' }}>
                    <strong className="num-mono" style={{ fontSize: '0.84rem', color: '#0F172A' }}>
                      +{detour.totalDetourKm} km
                    </strong>
                    <span style={{ color: '#64748B', fontSize: '0.66rem' }}>
                      ({consumption} L)
                    </span>
                  </div>
                  <div style={{ color: '#DC2626', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                    -{detour.fuelCostDetourEuro.toFixed(2)} € Spritkosten
                  </div>
                </div>
              </div>

              {/* Transparenter Erklärsatz */}
              <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.35 }}>
                {detour.isProfitable ? (
                  <span>
                    💡 <strong>Trotz {detour.totalDetourKm} km Mehrweg rentabel:</strong> Du sparst durch die {detour.priceDiffCent.toFixed(1)} ct/L weniger {detour.grossSavingsEuro.toFixed(2)} € an der Säule. Die Fahrt verbraucht nur {detour.fuelCostDetourEuro.toFixed(2)} € Sprit.
                  </span>
                ) : (
                  <span>
                    ⚠️ <strong>Mehrweg frisst Ersparnis auf:</strong> Der Umweg von {detour.totalDetourKm} km kostet {detour.fuelCostDetourEuro.toFixed(2)} € Sprit und übersteigt den Vorteil.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* SEKTION B: TIMING & PROGNOSE (Harmonischer Einzeiler) */}
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.55rem 0.75rem',
              fontSize: '0.72rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.4rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#334155' }}>
              <Clock size={12} color="#0F172A" />
              <span>Ankunft ~{arrival.driveTimeMin} Min. ({arrival.arrivalTimeFormatted} Uhr • ~{arrival.meanArrivalPrice.toFixed(3)} €)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              {arrival.riskLevel === 'HIGH' ? (
                <span className="badge badge-unfavorable" style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem' }}>
                  <AlertTriangle size={10} />
                  <span>{arrival.probabilities.pRise}% Sprung-Risiko</span>
                </span>
              ) : (
                <span className="badge badge-favorable" style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem' }}>
                  <ShieldCheck size={10} />
                  <span>{arrival.stabilityIndex || arrival.probabilities.pStable}% stabil</span>
                </span>
              )}

              {timing.isCurrentlyOptimalWindow ? (
                <span className="badge badge-favorable" style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem' }}>
                  <Zap size={10} />
                  <span>Optimales Fenster!</span>
                </span>
              ) : (
                <span style={{ color: '#92400E', fontSize: '0.68rem', fontWeight: 600 }}>
                  Optimal: {timing.optimalHourToday}
                </span>
              )}

              <span
                className="badge badge-gray"
                style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                title="TensorFlow.js Vorhersage-Score"
              >
                <Sparkles size={10} color="#059669" />
                <span>KI: {score}/100</span>
              </span>
            </div>
          </div>

          {/* SEKTION C: ADRESSE & SCHNELL-AKTIONEN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <MapPin size={12} color="#0F172A" />
              <span>{station.street}, {station.city}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {/* Button 1: Direkte Navigation (Apple Maps / Google Maps) */}
              <button
                type="button"
                onClick={openNavigation}
                className="btn btn-primary btn-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  padding: '0.55rem 0.85rem',
                  borderRadius: '9999px',
                  fontSize: '0.78rem',
                }}
              >
                <Navigation size={13} />
                <span>Route starten</span>
              </button>

              {/* Button 2: Detaillierte KI-Analyse Modal */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelect) onSelect();
                }}
                className="btn btn-secondary btn-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  padding: '0.55rem 0.85rem',
                  borderRadius: '9999px',
                  fontSize: '0.78rem',
                }}
              >
                <Sparkles size={13} color="#059669" />
                <span>KI-Analyse</span>
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
