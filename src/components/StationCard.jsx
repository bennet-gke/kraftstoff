import React, { useState } from 'react';
import { Sparkles, MapPin, Navigation, TrendingDown, TrendingUp, Calculator, Clock, ShieldCheck, AlertTriangle, Zap, ChevronDown, Star, Database } from 'lucide-react';
import { describeWindowRange } from '../engine/regionalTrends';
import { navigateToStation, resolveNavApp, navAppLabel } from '../services/navHandoff';
import { fmtNum, fmtKm, fmtSigned } from '../utils/format';

const de = (v, digits = 1) => fmtNum(v, digits);
const detourText = (km) => (km < 0.1 ? 'an der Strecke' : km >= 1 ? `+${de(km)} km Abstecher` : `+${Math.round(km * 1000)} m Abstecher`);

/**
 * Kompakte Tankstellen-Karte (Akkordeon). Alle Kennzahlen kommen vorberechnet aus App.jsx:
 * station.evaluation (eigene Historie), station.detour (Umwegrechner),
 * station.outlook (Ankunfts-Ausblick), station.score (Empfehlungs-Score), station.readings.
 */
export default function StationCard({
  station,
  baseStation,
  detourMode = 'local_roundtrip',
  isFavorite = false,
  onToggleFavorite,
  isSelected = false,
  onSelect,
  windows = null,
  navApp = 'apple',
}) {
  const [isExpanded, setIsExpanded] = useState(isSelected);

  const evaluation = station.evaluation;
  const detour = station.detour;
  const outlook = station.outlook;
  const score = station.score?.score ?? 50;
  const scoreLabel = station.score?.label || 'Mittelfeld';
  const isCheap = !!evaluation?.isCheap;
  const deltaRegionCt = station.deltaToRegionCent ?? 0;
  const readingsCount = station.readings?.length || 0;

  const priceStr = Number.isFinite(station.currentPrice) ? de(station.currentPrice, 3) : '–';
  const mainPrice = priceStr.length > 1 ? priceStr.slice(0, -1) : priceStr;
  const lastDigit = priceStr.length > 1 ? priceStr.slice(-1) : '';

  const openNavigation = (e) => {
    e.stopPropagation();
    navigateToStation(station, navApp);
  };

  const isBase = baseStation && baseStation.id === station.id;
  const isClosed = station.isOpen === false;
  const priceColor = isClosed ? '#94A3B8' : deltaRegionCt <= -1.5 ? '#059669' : '#0F172A';
  const nextWindow = windows?.nextWindow && windows.nextWindow.start.hoursAhead >= 1 ? windows.nextWindow : null;
  const routeKmLabel = station.aheadKm !== undefined ? `in ${station.aheadKm} km` : `km ${Math.round(station.kmAlongRoute ?? 0)}`;

  return (
    <div className={`accordion-card ${isExpanded ? 'is-expanded' : ''} ${isClosed ? 'is-closed' : deltaRegionCt <= -1.5 || isCheap ? 'is-favorable' : ''}`}>
      <div className="accordion-header" onClick={() => setIsExpanded(!isExpanded)} style={{ background: isExpanded ? '#FAFAFA' : '#FFFFFF', transition: 'background 0.15s ease' }}>
        {/* Zeile 1 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', padding: '0.12rem 0.42rem', borderRadius: '4px', background: '#F1F5F9', color: '#334155', letterSpacing: '0.04em', flexShrink: 0 }}>
              {station.brand || 'Frei'}
            </span>
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{station.name}</h4>
            {station.isOpen === false && (
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', padding: '0.1rem 0.38rem', borderRadius: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Geschlossen
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (onToggleFavorite) onToggleFavorite(station); }}
              title={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
              aria-label={isFavorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
              aria-pressed={isFavorite}
              style={{ border: 'none', background: isFavorite ? '#FEF3C7' : 'transparent', borderRadius: '50%', width: '34px', height: '34px', margin: '-4px 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0 }}
            >
              <Star size={14} fill={isFavorite ? '#F59E0B' : 'none'} color={isFavorite ? '#F59E0B' : '#94A3B8'} />
            </button>
          </div>

          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'baseline', flexShrink: 0 }}>
            <span className="num-mono" style={{ fontSize: '1.45rem', fontWeight: 800, color: priceColor, lineHeight: 1 }}>{mainPrice}</span>
            <span className="num-mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: priceColor, verticalAlign: 'super', marginLeft: '1px' }}>{lastDigit}</span>
            <span style={{ fontSize: '0.72rem', color: '#64748B', marginLeft: '0.2rem', fontWeight: 500 }}>€</span>
          </div>
        </div>

        {/* Zeile 2 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.74rem', color: '#64748B', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {station.isOnRouteCorridor && station.kmAlongRoute !== undefined ? (
              <>
                <Navigation size={11} color="#2563EB" style={{ flexShrink: 0 }} />
                <span className="num-mono" style={{ fontWeight: 700, color: '#1D4ED8', flexShrink: 0 }}>{routeKmLabel}</span>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span style={{ flexShrink: 0, color: '#2563EB' }}>{detourText(station.routeDetourKm)}</span>
              </>
            ) : (
              <>
                <MapPin size={11} color="#94A3B8" style={{ flexShrink: 0 }} />
                <span className="num-mono" style={{ fontWeight: 600, flexShrink: 0 }}>{fmtKm(station.distanceKm)}</span>
              </>
            )}
            {Math.abs(deltaRegionCt) >= 0.5 && (
              <>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span style={{ color: deltaRegionCt < 0 ? '#059669' : '#DC2626', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0 }} title="Abstand zum Regionsmedian">
                  {deltaRegionCt < 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                  <span>{deltaRegionCt > 0 ? '+' : ''}{de(deltaRegionCt)} ct</span>
                </span>
              </>
            )}
            {!station.isOnRouteCorridor && outlook && (
              <>
                <span style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
                <span style={{ flexShrink: 0 }}>~{outlook.driveTimeMin} Min.</span>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
            {isClosed ? (
              <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#F1F5F9', color: '#64748B', padding: '0.12rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>letzter Preis</span>
            ) : isBase ? (
              <span style={{ fontSize: '0.68rem', fontWeight: 700, background: '#F1F5F9', color: '#475569', padding: '0.12rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>📍 Basis</span>
            ) : detour ? (
              <span className="num-mono" style={{ fontSize: '0.7rem', fontWeight: 800, background: detour.isProfitable ? '#ECFDF5' : '#FFF1F2', color: detour.isProfitable ? '#059669' : '#DC2626', border: `1px solid ${detour.isProfitable ? '#A7F3D0' : '#FECDD3'}`, padding: '0.12rem 0.45rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                {detour.netSavingsEuro > 0 ? '+' : ''}{de(detour.netSavingsEuro, 2)} € netto
              </span>
            ) : null}
            <div style={{ color: '#94A3B8', display: 'flex', alignItems: 'center', flexShrink: 0, transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="accordion-expanded-body">
          {/* A: Wirtschaftlichkeit */}
          {isBase || !detour ? (
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.65rem 0.8rem', fontSize: '0.74rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.9rem' }}>📍</span>
                <div>
                  <strong style={{ color: '#0F172A' }}>Basistankstelle</strong>
                  <div style={{ color: '#64748B', fontSize: '0.68rem', marginTop: '0.1rem' }}>{station.isOnRouteCorridor ? 'Erste geöffnete Station der Strecke' : `Nächste geöffnete Station${Number.isFinite(station.distanceKm) ? ` (${de(station.distanceKm)} km)` : ''}`} • Vergleichsreferenz für alle anderen</div>
                </div>
              </div>
              <span className="badge badge-gray" style={{ fontSize: '0.64rem', flexShrink: 0 }}>Referenz</span>
            </div>
          ) : (
            <div style={{ background: detour.isProfitable ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${detour.isProfitable ? '#BBF7D0' : '#FECACA'}`, borderRadius: '8px', padding: '0.65rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Calculator size={14} color={detour.isProfitable ? '#059669' : '#DC2626'} />
                  <span style={{ fontWeight: 700, fontSize: '0.78rem', color: detour.isProfitable ? '#166534' : '#991B1B' }}>
                    {detour.isProfitable ? `Fahrt lohnt sich (+${de(detour.netSavingsEuro, 2)} € netto)` : `Lohnt sich nicht (${de(detour.netSavingsEuro, 2)} €)`}
                  </span>
                </div>
                <span style={{ fontSize: '0.68rem', color: '#64748B' }}>vs. {baseStation?.name}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: '#FFFFFF', padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.72rem' }}>
                <div>
                  <div style={{ color: '#64748B', fontWeight: 600 }}>⛽ Zapfsäule ({detour.fillLiters} L)</div>
                  <strong className="num-mono" style={{ fontSize: '0.84rem', color: detour.priceDiffCent > 0 ? '#059669' : '#DC2626', display: 'block', marginTop: '0.15rem' }}>
                    {detour.priceDiffCent > 0 ? `−${de(detour.priceDiffCent)} ct/L` : `+${de(Math.abs(detour.priceDiffCent))} ct/L`}
                  </strong>
                  <div style={{ color: detour.grossSavingsEuro >= 0 ? '#059669' : '#DC2626', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                    {detour.grossSavingsEuro >= 0 ? '+' : ''}{de(detour.grossSavingsEuro, 2)} € an der Säule
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid #F1F5F9', paddingLeft: '0.5rem' }}>
                  <div style={{ color: '#64748B', fontWeight: 600 }}>🚗 Fahrt ({detourMode === 'route_corridor' ? 'Zusatzweg' : 'Hin & Rück'})</div>
                  <strong className="num-mono" style={{ fontSize: '0.84rem', color: '#0F172A', display: 'block', marginTop: '0.15rem' }}>{fmtSigned(detour.totalDetourKm, 1)} km</strong>
                  <div style={{ color: detour.fuelCostDetourEuro + detour.wearCostEuro > 0.004 ? '#DC2626' : detour.fuelCostDetourEuro + detour.wearCostEuro < -0.004 ? '#059669' : '#64748B', fontWeight: 600, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                    {detour.fuelCostDetourEuro + detour.wearCostEuro > 0.004
                      ? `−${de(detour.fuelCostDetourEuro + detour.wearCostEuro, 2)} € Sprit & Verschleiß`
                      : detour.fuelCostDetourEuro + detour.wearCostEuro < -0.004
                        ? `+${de(Math.abs(detour.fuelCostDetourEuro + detour.wearCostEuro), 2)} € weniger Umweg`
                        : 'kein Mehrweg'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* B: Timing & Ausblick */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.55rem 0.75rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#334155' }}>
              <Clock size={12} color="#0F172A" />
              <span>{outlook ? `Ankunft gegen ${outlook.arrivalTimeFormatted} Uhr` : 'Ankunftszeit unbekannt'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              {outlook && (
                <span className={`badge ${outlook.outlook === 'RISING' ? 'badge-unfavorable' : 'badge-favorable'}`} style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem' }} title={outlook.text}>
                  {outlook.outlook === 'RISING' ? <AlertTriangle size={10} /> : <ShieldCheck size={10} />}
                  <span>{outlook.outlook === 'RISING' ? 'Eher steigend' : outlook.outlook === 'FALLING' ? 'Eher fallend' : 'Stabil bis Ankunft'}</span>
                </span>
              )}
              {windows?.phase === 'GÜNSTIG' ? (
                <span className="badge badge-favorable" style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem' }}>
                  <Zap size={10} />
                  <span>Günstige Phase jetzt</span>
                </span>
              ) : nextWindow ? (
                <span style={{ color: '#92400E', fontSize: '0.68rem', fontWeight: 600 }}>
                  Günstiger {describeWindowRange(nextWindow.start, nextWindow.end)}
                </span>
              ) : null}
              <span className="badge badge-gray" style={{ fontSize: '0.66rem', padding: '0.1rem 0.4rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }} title={station.score?.reasons?.join(' • ') || 'Empfehlungs-Score'}>
                <Sparkles size={10} color="#059669" />
                <span>{scoreLabel} • {score}</span>
              </span>
            </div>
          </div>

          {/* C: Historie & Adresse & Aktionen */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.74rem', color: '#64748B', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <MapPin size={12} color="#0F172A" />
                <span>{station.street}, {station.city}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem' }} title="Eigene aufgezeichnete Messwerte dieser Station">
                <Database size={11} />
                <span>{readingsCount === 1 ? '1 Messwert' : `${readingsCount} Messwerte`}{evaluation?.hasHistory && Number.isFinite(evaluation.expectedNow) ? ` • um diese Zeit üblich ${de(evaluation.expectedNow, 3)} €` : ''}</span>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button type="button" onClick={openNavigation} className="btn btn-primary btn-sm" style={{ justifyContent: 'center', gap: '0.4rem', padding: '0.55rem 0.85rem', borderRadius: '9999px', fontSize: '0.78rem' }}>
                <Navigation size={13} />
                <span>{navAppLabel(resolveNavApp(navApp))}</span>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); if (onSelect) onSelect(); }} className="btn btn-secondary btn-sm" style={{ justifyContent: 'center', gap: '0.4rem', padding: '0.55rem 0.85rem', borderRadius: '9999px', fontSize: '0.78rem' }}>
                <Sparkles size={13} color="#059669" />
                <span>Analyse</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
