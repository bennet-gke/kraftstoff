import React, { useState, useEffect, useMemo } from 'react';
import { X, Navigation, Sparkles, MapPin, Calculator, Clock, Zap, Star, ShieldCheck, AlertTriangle, Database } from 'lucide-react';
import PriceTrendChart from './PriceTrendChart';
import ForecastStrip from './ForecastStrip';
import { dataService } from '../services/dataService';
import { navigateToStation, resolveNavApp, navAppLabel } from '../services/navHandoff';
import { fmtNum } from '../utils/format';
import { calculateDetourProfitability } from '../engine/detourCalculator';
import { forecastStationCurve } from '../engine/mlModel';
import { describeWindowTime, describeWindowRange } from '../engine/regionalTrends';

const de = (v, digits = 1) => fmtNum(v, digits);
// Kosten mit Vorzeichen: Kosten als "−", Ersparnis (kürzerer Umweg) als "+", nichts ohne Vorzeichen
const costSign = (v) => (v > 0.004 ? '−' : v < -0.004 ? '+' : '');
const detourText = (km) => (km < 0.1 ? 'an der Strecke' : km >= 1 ? `+${de(km)} km Abstecher` : `+${Math.round(km * 1000)} m Abstecher`);

export default function StationDetailModal({
  station,
  baseStation,
  activeVehicle,
  fuelType = 'diesel',
  defaultDetourMode = 'local_roundtrip',
  isFavorite = false,
  onToggleFavorite,
  onClose,
  profile = null,
  windows = null,
  moves = null,
  rules,
  fillLiters = null,
  consumption = null,
  navApp = 'apple',
}) {
  const [stationDetails, setStationDetails] = useState(null);

  useEffect(() => {
    const sId = station?.id;
    if (sId && dataService.hasValidTankerkoenigKey()) {
      dataService.getStationDetails(sId).then((res) => { if (res) setStationDetails(res); }).catch(() => {});
    }
  }, [station?.id]);

  const defaultLiters = Number.isFinite(fillLiters) ? Math.min(85, Math.max(10, Math.round(fillLiters / 5) * 5)) : 40;
  const [simLiters, setSimLiters] = useState(defaultLiters);
  const [simConsumption, setSimConsumption] = useState(consumption || activeVehicle?.consumptionL100km || 6.2);
  const simWear = 0.05;
  const [modalDetourMode, setModalDetourMode] = useState(station?.isOnRouteCorridor ? 'route_corridor' : defaultDetourMode);

  const detour = useMemo(() => {
    if (!station) return null;
    return calculateDetourProfitability({
      targetPrice: station.currentPrice,
      targetDistanceKm: station.distanceKm ?? 0,
      basePrice: baseStation ? baseStation.currentPrice : station.currentPrice,
      baseDistanceKm: baseStation ? baseStation.distanceKm ?? 0 : 0,
      fillLiters: simLiters,
      consumptionL100km: simConsumption,
      wearCostPerKm: simWear,
      isRoundtrip: modalDetourMode !== 'route_corridor',
      detourMode: modalDetourMode,
      realAdditionalKm: station.realAdditionalKm,
      baseAdditionalKm: station.realAdditionalKm !== undefined && baseStation?.realAdditionalKm !== undefined ? baseStation.realAdditionalKm : 0,
    });
  }, [station, baseStation, simLiters, simConsumption, modalDetourMode]);

  // Ankunft wird in der App berechnet (inkl. Reisegeschwindigkeit der Route)
  const outlook = station?.outlook || null;

  const forecast = useMemo(() => {
    if (!station || !profile) return null;
    return forecastStationCurve({ station, pts: station.readings || [], profile, rules });
  }, [station, profile, rules]);

  if (!station) return null;

  const evaluation = station.evaluation;
  const score = station.score?.score ?? 50;
  const readings = station.readings || [];
  const isBase = baseStation && baseStation.id === station.id;
  const deltaRegionCt = station.deltaToRegionCent ?? 0;
  const nextWindow = windows?.nextWindow || null;
  const forecastSavingsEuro = forecast ? (forecast.potentialSavingsCent * simLiters) / 100 : 0;
  const preferredNav = resolveNavApp(navApp);
  const openNavigation = () => navigateToStation(station, navApp);
  void moves;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content is-tall" style={{ maxWidth: '840px' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem', gap: '0.5rem' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', padding: '0.15rem 0.45rem', borderRadius: '4px', background: '#F1F5F9', color: '#334155' }}>{station.brand}</span>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>{station.name}</h3>
              <span className="num-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: deltaRegionCt <= -1 ? '#059669' : deltaRegionCt >= 1 ? '#DC2626' : '#0F172A' }}>{Number.isFinite(station.currentPrice) ? de(station.currentPrice, 3) : '–'} €</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.78rem', marginTop: '0.25rem' }}>
              <MapPin size={13} color="#94A3B8" style={{ flexShrink: 0 }} />
              <span style={{ wordBreak: 'break-word' }}>{station.street}, {station.postCode || ''} {station.city}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {station.isOnRouteCorridor && station.kmAlongRoute !== undefined ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '0.15rem 0.45rem', borderRadius: '6px' }}>
                  <Navigation size={11} />
                  <span>{station.aheadKm !== undefined ? `in ${station.aheadKm} km` : `km ${Math.round(station.kmAlongRoute)} der Strecke`} ({detourText(station.routeDetourKm)})</span>
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 600, color: '#334155', background: '#F1F5F9', padding: '0.15rem 0.45rem', borderRadius: '6px' }}>
                  <Navigation size={11} color="#64748B" />
                  <span className="num-mono">{Number.isFinite(station.distanceKm) ? `${de(station.distanceKm)} km entfernt` : 'Entfernung unbekannt'}</span>
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', fontWeight: 700, color: station.isOpen !== false ? '#065F46' : '#DC2626', background: station.isOpen !== false ? '#ECFDF5' : '#FEF2F2', padding: '0.15rem 0.45rem', borderRadius: '6px' }}>
                {station.isOpen !== false ? '● Geöffnet' : '● Geschlossen'}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', fontWeight: 600, color: '#0284C7', background: '#F0F9FF', padding: '0.15rem 0.45rem', borderRadius: '6px' }}>
                <ShieldCheck size={11} />
                <span>{station.priceSource === 'last_known' ? 'Letzter gemeldeter Preis' : station.isFromCache ? 'Zwischengespeicherter Preis' : 'MTS-K Live-Preis'}</span>
              </span>
              {Math.abs(deltaRegionCt) >= 0.5 && (
                <span className={`badge ${deltaRegionCt < 0 ? 'badge-favorable' : 'badge-unfavorable'}`} style={{ fontSize: '0.7rem', padding: '0.12rem 0.45rem' }}>
                  {deltaRegionCt > 0 ? '+' : ''}{de(deltaRegionCt)} ct zum Regionsmedian
                </span>
              )}
            </div>
            {stationDetails && (
              <div style={{ marginTop: '0.45rem', padding: '0.35rem 0.6rem', background: '#F8FAFC', borderRadius: '6px', fontSize: '0.73rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', border: '1px solid #E2E8F0' }}>
                <Clock size={13} color="#64748B" />
                {stationDetails.wholeDay ? (
                  <strong style={{ color: '#059669' }}>Durchgehend 24 Stunden geöffnet</strong>
                ) : stationDetails.openingTimes && stationDetails.openingTimes.length > 0 ? (
                  <span>Öffnungszeiten: {stationDetails.openingTimes.map((t) => `${t.text ? t.text + ' ' : ''}${t.start ? t.start.slice(0, 5) : ''}–${t.end ? t.end.slice(0, 5) : ''}`).join(', ')}</span>
                ) : (
                  <span>Öffnungszeiten laut MTS-K nicht hinterlegt</span>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={() => onToggleFavorite && onToggleFavorite(station)}
              aria-pressed={isFavorite}
              style={{ background: isFavorite ? '#FEF3C7' : '#F8FAFC', border: isFavorite ? '1px solid #FDE68A' : '1px solid #E2E8F0', color: isFavorite ? '#92400E' : '#334155', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '8px', fontWeight: 700, fontSize: '0.76rem', padding: '0.35rem 0.65rem', cursor: 'pointer' }}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            >
              <Star size={13} fill={isFavorite ? '#F59E0B' : 'none'} color={isFavorite ? '#F59E0B' : '#64748B'} />
              <span>{isFavorite ? 'Favorit' : 'Merken'}</span>
            </button>
            <button className="btn btn-sm btn-primary" onClick={openNavigation} title={`Navigation mit ${navAppLabel(preferredNav)}`}>
              <Navigation size={13} />
              <span>{navAppLabel(preferredNav)}</span>
            </button>
            <button onClick={onClose} aria-label="Schließen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.25rem' }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 1. Wirtschaftlichkeit */}
        {detour && (
          <div style={{ background: isBase ? '#F8FAFC' : detour.isProfitable ? '#ECFDF5' : '#FFF1F2', border: `1px solid ${isBase ? '#E2E8F0' : detour.isProfitable ? '#A7F3D0' : '#FECDD3'}`, borderRadius: '10px', padding: '1.1rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Calculator size={16} color={detour.isProfitable || isBase ? '#059669' : '#DC2626'} />
                <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>Lohnt sich die Fahrt?</strong>
              </div>
              <div style={{ display: 'flex', background: '#FFFFFF', padding: '0.15rem', borderRadius: '6px', border: '1px solid #CBD5E1' }}>
                {[['local_roundtrip', 'Vom Ort aus (Hin & Rück)'], ['route_corridor', 'An Fahrt-Strecke (Zusatz-km)']].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setModalDetourMode(mode)} style={{ border: 'none', background: modalDetourMode === mode ? '#0F172A' : 'transparent', color: modalDetourMode === mode ? '#FFFFFF' : '#475569', padding: '0.2rem 0.55rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {isBase ? (
              <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>Diese Station ist deine Basistankstelle (nächste geöffnete Station). Alle anderen werden gegen sie gerechnet.</p>
            ) : (
              <>
                {baseStation && (
                  <div style={{ background: '#FFFFFF', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '0.65rem', fontSize: '0.74rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div>
                      <span>Vergleichs-Basis: </span>
                      <strong style={{ color: '#0F172A' }}>{baseStation.name}</strong> ({Number.isFinite(baseStation.distanceKm) ? `${de(baseStation.distanceKm)} km • ` : ''}<span className="num-mono" style={{ fontWeight: 700 }}>{de(baseStation.currentPrice, 3)} €</span>)
                    </div>
                    <div style={{ color: detour.priceDiffCent > 0 ? '#059669' : '#DC2626', fontWeight: 700 }}>
                      {detour.priceDiffCent > 0 ? `−${de(detour.priceDiffCent)} ct/L günstiger` : `+${de(Math.abs(detour.priceDiffCent))} ct/L teurer`}
                    </div>
                  </div>
                )}
                <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.85rem' }}>{detour.reasoning}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.75rem', fontSize: '0.75rem', marginBottom: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#94A3B8', display: 'block' }}>Brutto an der Säule</span>
                    <strong className="num-mono" style={{ color: detour.grossSavingsEuro >= 0 ? '#059669' : '#DC2626', fontSize: '1rem' }}>{detour.grossSavingsEuro >= 0 ? '+' : ''}{de(detour.grossSavingsEuro, 2)} €</strong>
                    <span style={{ color: '#64748B', display: 'block' }}>({de(detour.priceDiffCent)} ct/L × {simLiters} L)</span>
                  </div>
                  <div>
                    <span style={{ color: '#94A3B8', display: 'block' }}>{modalDetourMode === 'route_corridor' ? 'Sprit Zusatz-km' : 'Sprit Hin/Rück'}</span>
                    <strong className="num-mono" style={{ color: detour.fuelCostDetourEuro > 0.004 ? '#DC2626' : detour.fuelCostDetourEuro < -0.004 ? '#059669' : '#64748B', fontSize: '1rem' }}>{costSign(detour.fuelCostDetourEuro)}{de(Math.abs(detour.fuelCostDetourEuro), 2)} €</strong>
                    <span style={{ color: '#64748B', display: 'block' }}>({detour.totalDetourKm >= 0 ? `${de(detour.totalDetourKm)} km Mehrweg` : `${de(-detour.totalDetourKm)} km weniger Umweg`})</span>
                  </div>
                  <div>
                    <span style={{ color: '#94A3B8', display: 'block' }}>Verschleiß ({de(simWear, 2)} €/km)</span>
                    <strong className="num-mono" style={{ color: '#64748B', fontSize: '1rem' }}>{costSign(detour.wearCostEuro)}{de(Math.abs(detour.wearCostEuro), 2)} €</strong>
                    <span style={{ color: '#64748B', display: 'block' }}>Reifen & Bremsen</span>
                  </div>
                  <div style={{ borderLeft: '1px solid #E2E8F0', paddingLeft: '0.6rem' }}>
                    <span style={{ color: '#0F172A', display: 'block', fontWeight: 700 }}>Echter Reingewinn</span>
                    <strong className="num-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: detour.netSavingsEuro >= 0 ? '#059669' : '#DC2626' }}>{detour.netSavingsEuro > 0 ? '+' : ''}{de(detour.netSavingsEuro, 2)} €</strong>
                    <span style={{ color: '#64748B', display: 'block' }}>{detour.maxDetourKm > 0 ? `Lohnt bis ${de(detour.maxDetourKm)} km Mehrweg` : 'Kein Umweg lohnt sich'}</span>
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.73rem', color: '#475569' }}>
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span>Zu tankende Menge:</span>
                  <strong className="num-mono">{simLiters} Liter</strong>
                </label>
                <input type="range" min="10" max="85" step="5" value={simLiters} onChange={(e) => setSimLiters(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#0F172A' }} />
              </div>
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span>Verbrauch ({activeVehicle?.name || 'Auto'}):</span>
                  <strong className="num-mono">{de(simConsumption)} L/100 km</strong>
                </label>
                <input type="range" min="3.5" max="14.0" step="0.2" value={simConsumption} onChange={(e) => setSimConsumption(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#0F172A' }} />
              </div>
            </div>
          </div>
        )}

        {/* 2. Ankunft & Timing */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '1.1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Clock size={16} color="#0F172A" />
              <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>Wann hinfahren?</strong>
            </div>
            {outlook && (
              <span className={`badge ${outlook.outlook === 'RISING' ? 'badge-unfavorable' : 'badge-favorable'}`} style={{ fontSize: '0.76rem' }}>
                {outlook.outlook === 'RISING' ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                <span>{outlook.label}</span>
              </span>
            )}
          </div>
          {outlook && <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.75rem' }}>{outlook.text}</p>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', fontSize: '0.75rem' }}>
            <div style={{ background: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>Ankunft</span>
              <strong style={{ fontSize: '0.95rem', color: '#0F172A', display: 'block' }}>{outlook ? `${outlook.arrivalTimeFormatted} Uhr (${outlook.driveTimeMin >= 60 ? `~${Math.floor(outlook.driveTimeMin / 60)} Std. ${outlook.driveTimeMin % 60} Min.` : `~${outlook.driveTimeMin} Min.`})` : '–'}</strong>
              <span className="num-mono" style={{ color: '#64748B' }}>{outlook?.expectedArrivalPrice ? `erwartet ~${de(outlook.expectedArrivalPrice, 3)} €` : ''}</span>
            </div>
            <div style={{ background: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>Nächstes günstiges Fenster der Region</span>
              <strong style={{ fontSize: '0.95rem', color: '#0F172A', display: 'block' }}>
                {nextWindow ? describeWindowRange(nextWindow.start, nextWindow.end) : 'Keine Verbesserung erwartet'}
              </strong>
              <span className="num-mono" style={{ color: '#059669', fontWeight: 600 }}>{nextWindow ? `${nextWindow.est > 0 ? '+' : ''}${de(nextWindow.est)} ct zum Tagesmittel` : ''}</span>
            </div>
            <div style={{ background: '#F8FAFC', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
              <span style={{ color: '#64748B', display: 'block' }}>24h-Tief laut Prognose</span>
              <strong style={{ fontSize: '0.95rem', color: '#0F172A', display: 'block' }}>
                {forecast ? (forecast.lowest.hoursAhead === 0 ? 'Jetzt' : `${describeWindowTime(forecast.lowest)} (~${de(forecast.lowest.price, 3)} €)`) : '–'}
              </strong>
              <span className="num-mono" style={{ color: forecastSavingsEuro > 0.5 ? '#059669' : '#64748B', fontWeight: 600 }}>
                {forecast && forecast.potentialSavingsCent > 0.4 ? `bis zu ${de(forecastSavingsEuro, 2)} € bei ${simLiters} L` : 'kaum Sparpotenzial durch Warten'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Prognose */}
        {forecast && (
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '1.1rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.6rem' }}>
              <Zap size={16} color="#D97706" />
              <strong style={{ fontSize: '0.92rem', color: '#0F172A' }}>24-Stunden-Prognose für diese Station</strong>
            </div>
            <ForecastStrip forecast={forecast} compact />
          </div>
        )}

        {/* 4. Echter Preisverlauf */}
        <div style={{ marginBottom: '1.25rem' }}>
          <PriceTrendChart readings={readings} stationName={station.name} fuelType={fuelType} evaluation={evaluation} />
        </div>

        {/* 5. Einordnung */}
        <div style={{ background: score >= 70 ? '#ECFDF5' : '#F8FAFC', border: `1px solid ${score >= 70 ? '#A7F3D0' : '#E2E8F0'}`, borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Sparkles size={16} color={score >= 70 ? '#059669' : '#0F172A'} />
              <strong style={{ fontSize: '0.88rem', color: '#0F172A' }}>Einordnung: {station.score?.label || 'Mittelfeld'} • Score {score}/100</strong>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#64748B', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <Database size={12} /> {readings.length === 1 ? '1 eigener Messwert' : `${readings.length} eigene Messwerte`}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
            {station.score?.reasons?.length
              ? `${station.score.reasons.join(', ')}.`.replace(/^./, (c) => c.toUpperCase())
              : 'Preislich im Mittelfeld der Region.'}
            {evaluation?.hasHistory && Number.isFinite(evaluation.expectedNow)
              ? ` Um diese Uhrzeit kostet sie üblicherweise ~${de(evaluation.expectedNow, 3)} € – jetzt ${evaluation.deltaCent > 0 ? '+' : ''}${de(evaluation.deltaCent)} ct (Schwankung ${evaluation.volatilityLevel.toLowerCase()}).`
              : ' Für den Vergleich mit dem üblichen Preis dieser Station fehlen noch eigene Messwerte – die App sammelt sie bei jedem Öffnen.'}
          </p>
        </div>
      </div>
    </div>
  );
}
