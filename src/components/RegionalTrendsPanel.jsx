import React, { useMemo, useState } from 'react';
import { BarChart3, Database, Zap, ArrowUpRight, ArrowDownRight, Clock, ChevronDown, ChevronUp, Scale } from 'lucide-react';
import RegionalIndexChart from './RegionalIndexChart';
import WeeklyProfileChart from './WeeklyProfileChart';
import HeatmapChart from './HeatmapChart';
import { buildRegionalIndexSeries, describeWindowRange } from '../engine/regionalTrends';
import { useNow } from './chartHooks';
import { fmtPrice, fmtCt, fmtEuro, fmtNum, fuelLabel, moveTimeText } from '../utils/format';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Trends-Tab: Spiegel der Region (alle Tankstellen im Radius bzw. im Routen-Korridor).
 */
export default function RegionalTrendsPanel({
  regionLabel = '',
  stations = [],
  regionReadingsMap,
  profile,
  regionNow,
  windows,
  moves,
  activeVehicle,
  fillLiters = null,
  settings,
  fuelType = 'diesel',
  dataStats,
  onSelectStation,
  rules,
}) {
  const [rangeHours, setRangeHours] = useState(72);
  const [showAllStations, setShowAllStations] = useState(false);
  const now = useNow(60000, regionReadingsMap);

  const indexSeries = useMemo(() => {
    if (!regionReadingsMap || regionReadingsMap.size === 0) return [];
    const step = rangeHours <= 24 ? 15 : rangeHours <= 72 ? 30 : 60;
    return buildRegionalIndexSeries(regionReadingsMap, { fromMs: now - rangeHours * HOUR_MS, toMs: now, stepMinutes: step });
  }, [regionReadingsMap, rangeHours, now]);

  const liters = Number.isFinite(fillLiters) && fillLiters > 0 ? Math.round(fillLiters) : 40;

  const sortedByPrice = useMemo(
    () => [...stations]
      .filter((s) => Number.isFinite(s.currentPrice))
      .sort((a, b) => (a.isOpen === false) - (b.isOpen === false) || a.currentPrice - b.currentPrice),
    [stations]
  );
  const visibleStations = showAllStations ? sortedByPrice : sortedByPrice.slice(0, 8);

  if (stations.length === 0) {
    return (
      <div className="empty-state-card">
        <BarChart3 size={36} color="#94A3B8" />
        <h3>Keine Tankstellen im Bereich</h3>
        <p>Für die Trend-Analyse brauche ich Tankstellen im gewählten Umkreis oder Routen-Korridor. Vergrößere den Radius oder wähle einen anderen Bereich.</p>
      </div>
    );
  }

  const spreadEuro = regionNow?.spreadCent ? (regionNow.spreadCent * liters) / 100 : 0;
  const nw = windows?.nextWindow;
  const sinceText = dataStats?.firstAt ? new Date(dataStats.firstAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : null;

  return (
    <div className="panel-stack">
      {/* Kopf: Bereich & Datenbasis */}
      <div className="clean-card" style={{ padding: '1.1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <BarChart3 size={16} color="#0F172A" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0F172A' }}>Trends für {regionLabel}</h3>
              <span className="badge badge-gray" style={{ fontSize: '0.68rem' }}>{stations.length} Tankstellen • {fuelLabel(fuelType)}</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.3rem', lineHeight: 1.45 }}>
              Alle Auswertungen beziehen sich auf sämtliche Tankstellen in diesem Bereich – ein Spiegel der Region, nicht einer einzelnen Station.
              {nw && !nw.isNow && (
                <>
                  {' '}Nächstes günstiges Fenster: <strong style={{ color: '#059669' }}>{describeWindowRange(nw.start, nw.end, now)}</strong> (typisch {fmtCt(nw.est)} zum Tagesmittel).
                </>
              )}
              {nw && nw.isNow && (
                <> Die Region ist <strong style={{ color: '#059669' }}>gerade in einer günstigen Phase</strong> ({describeWindowRange(nw.start, nw.end, now)}).</>
              )}
            </p>
          </div>

          <div className="data-pill">
            <Database size={15} color="#2563EB" />
            <div>
              <div style={{ fontWeight: 700, color: '#0F172A' }}>
                {dataStats?.points ? `${dataStats.points.toLocaleString('de-DE')} echte Messwerte` : 'Datensammlung läuft'}
              </div>
              <div>
                {dataStats?.series ? `${dataStats.series} Stationen` : ''}{sinceText ? ` • seit ${sinceText}` : ''}
                {!dataStats?.points && 'ab jetzt bei jedem Abruf'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Momentaufnahme */}
      {regionNow && regionNow.count > 1 && (
        <div className="stat-grid">
          <button type="button" className="clean-card stat-card is-clickable" onClick={() => onSelectStation && regionNow.cheapest && onSelectStation(regionNow.cheapest)}>
            <div className="stat-card-head">
              <span>Günstigste Station</span>
              <span className="badge badge-favorable" style={{ fontSize: '0.65rem' }}>Tiefstpreis</span>
            </div>
            <div className="stat-card-name">{regionNow.cheapest?.name || '–'}</div>
            <div className="num-mono stat-card-value" style={{ color: '#059669' }}>{fmtPrice(regionNow.min)}</div>
          </button>
          <div className="clean-card stat-card">
            <div className="stat-card-head">
              <span>Regionsmedian</span>
              <span className="badge badge-gray" style={{ fontSize: '0.65rem' }}>{regionNow.openCount} geöffnet</span>
            </div>
            <div className="stat-card-name">Mittlerer Preis im Bereich</div>
            <div className="num-mono stat-card-value">{fmtPrice(regionNow.median)}</div>
          </div>
          <button type="button" className="clean-card stat-card is-clickable" onClick={() => onSelectStation && regionNow.dearest && onSelectStation(regionNow.dearest)}>
            <div className="stat-card-head">
              <span>Teuerste Station</span>
              <span className="badge badge-unfavorable" style={{ fontSize: '0.65rem' }}>Höchstpreis</span>
            </div>
            <div className="stat-card-name">{regionNow.dearest?.name || '–'}</div>
            <div className="num-mono stat-card-value" style={{ color: '#DC2626' }}>{fmtPrice(regionNow.max)}</div>
          </button>
          <div className="clean-card stat-card">
            <div className="stat-card-head">
              <span>Spanne in der Region</span>
              <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>{fmtNum(regionNow.spreadCent, 1)} ct/L</span>
            </div>
            <div className="stat-card-name">{activeVehicle ? `${activeVehicle.name}: ${liters} L` : `Tankfüllung: ${liters} L`}</div>
            <div className="num-mono stat-card-value" style={{ color: '#2563EB' }}>bis {fmtEuro(spreadEuro)}</div>
          </div>
        </div>
      )}

      {/* Verlauf der Region */}
      <RegionalIndexChart series={indexSeries} fuelType={fuelType} regionLabel={regionLabel} rangeHours={rangeHours} onChangeRange={setRangeHours} stationCount={stations.length} />

      {/* Typische Woche */}
      <WeeklyProfileChart profile={profile} regionMedian={regionNow?.median ?? null} windows={windows} settings={settings} activeVehicle={activeVehicle} rules={rules} />

      {/* Heatmap */}
      <HeatmapChart profile={profile} regionMedian={regionNow?.median ?? null} fuelType={fuelType} subtitle={regionLabel} />

      {/* Aktuelle Preisbewegungen */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Zap size={16} color={moves?.wave === 'UP' ? '#DC2626' : moves?.wave === 'DOWN' ? '#059669' : '#0F172A'} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Preisänderungen der letzten 3 Stunden</h3>
          </div>
          <span className={`badge ${moves?.wave === 'UP' ? 'badge-unfavorable' : moves?.wave === 'DOWN' ? 'badge-favorable' : 'badge-gray'}`} style={{ fontSize: '0.72rem' }}>
            {moves?.wave === 'UP' ? `Erhöhungswelle (${moves.ups} Stationen)` : moves?.wave === 'DOWN' ? `Senkungswelle (${moves.downs} Stationen)` : 'Keine Welle'}
          </span>
        </div>
        {moves && moves.moves.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {moves.moves.slice(0, 8).map((m) => (
              <div key={m.stationId} className="move-row">
                <div className="move-row-name">
                  {m.direction === 'UP' ? <ArrowUpRight size={14} color="#DC2626" /> : <ArrowDownRight size={14} color="#059669" />}
                  <span className="move-row-title">{m.name}</span>
                  <span className="move-row-brand">{m.brand}</span>
                  {m.outsideRule && <span className="move-row-flag" title={`Erhöhung außerhalb von ${moves.ruleTimesLabel} – laut ${moves.ruleName} nicht erlaubt`}>außerhalb {moves.ruleTimesLabel}</span>}
                  {m.ruleIncrease && <span className="move-row-flag is-noon" title={`Erlaubte Erhöhung (${moves.ruleName}: ${moves.ruleTimesLabel})`}>{moves.ruleTimesLabel}</span>}
                </div>
                <div className="move-row-values">
                  <span className="num-mono" style={{ fontWeight: 800, color: m.direction === 'UP' ? '#DC2626' : '#059669' }}>{fmtCt(m.deltaCent)}</span>
                  <span className="num-mono" style={{ color: '#475569' }}>{fmtPrice(m.price)}</span>
                  <span className="move-row-time" title={m.timingKnown ? '' : 'Die App war in dieser Zeit nicht geöffnet – der genaue Zeitpunkt ist unbekannt.'}>
                    <Clock size={11} /> {moveTimeText(m)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.78rem', color: '#64748B' }}>
            {moves && moves.considered > 0
              ? 'Keine Preisänderung in den letzten drei Stunden erkannt – der Markt im Bereich ist ruhig.'
              : 'Preisänderungen werden sichtbar, sobald für die Stationen mindestens zwei aktuelle Abrufe vorliegen.'}
          </p>
        )}
      </div>

      {/* Stationen im Vergleich */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.3rem' }}>
          <Scale size={16} color="#0F172A" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Stationen im Vergleich zur Region</h3>
        </div>
        <p style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.6rem' }}>
          Abstand zum Regionsmedian • „üblich“: Abstand zum üblichen Preis der Station um diese Uhrzeit
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {visibleStations.map((st) => {
            const dReg = Number.isFinite(regionNow?.median) ? (st.currentPrice - regionNow.median) * 100 : null;
            const own = st.evaluation?.hasHistory ? st.evaluation.deltaCent : null;
            return (
              <button key={st.id} type="button" className="compare-row" onClick={() => onSelectStation && onSelectStation(st)} style={{ opacity: st.isOpen === false ? 0.6 : 1 }}>
                <div className="compare-row-name">
                  <span className="compare-row-brand">{st.brand}</span>
                  <span className="compare-row-title">{st.name}</span>
                  {st.isOpen === false && <span className="compare-row-closed">zu</span>}
                </div>
                <div className="compare-row-values">
                  {own !== null && (
                    <span className="num-mono" style={{ color: own <= -1 ? '#059669' : own >= 1 ? '#DC2626' : '#94A3B8', fontSize: '0.7rem' }} title="Abstand zum üblichen Preis dieser Station um diese Uhrzeit">
                      üblich {fmtCt(own)}
                    </span>
                  )}
                  {dReg !== null && (
                    <span className="num-mono" style={{ fontWeight: 700, color: dReg <= -1 ? '#059669' : dReg >= 1 ? '#DC2626' : '#475569' }} title="Abstand zum Regionsmedian">
                      {fmtCt(dReg)}
                    </span>
                  )}
                  <span className="num-mono" style={{ fontWeight: 800, color: '#0F172A' }}>{fmtPrice(st.currentPrice)}</span>
                </div>
              </button>
            );
          })}
        </div>
        {sortedByPrice.length > 8 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAllStations(!showAllStations)} style={{ marginTop: '0.6rem', width: '100%', fontSize: '0.74rem' }}>
            {showAllStations ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>{showAllStations ? 'Weniger anzeigen' : `Alle ${sortedByPrice.length} Stationen anzeigen`}</span>
          </button>
        )}
      </div>
    </div>
  );
}
