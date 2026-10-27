import React, { useMemo, useState } from 'react';
import { Cpu, Sparkles, RefreshCw, CheckCircle2, AlertCircle, Clock, Zap, Car, Database, RotateCcw, Fuel, Gauge, ChevronRight, Navigation, ArrowUpRight, ArrowDownRight, Scale } from 'lucide-react';
import RuleBanner from './RuleBanner';
import ForecastStrip from './ForecastStrip';
import { forecastStationCurve } from '../engine/mlModel';
import { describeWindowTime } from '../engine/regionalTrends';
import { navigateToStation, resolveNavApp, navAppLabel } from '../services/navHandoff';
import { fmtPrice, fmtEuro, fmtNum, fmtCt, fmtKm, moveTimeText } from '../utils/format';

const VERDICT_STYLE = {
  URGENT: { label: 'Dringend tanken', bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B', badge: 'badge-unfavorable' },
  FILL_NOW: { label: 'Jetzt tanken', bg: '#ECFDF5', border: '#A7F3D0', fg: '#065F46', badge: 'badge-favorable' },
  FILL_LATER_TODAY: { label: 'Heute später tanken', bg: '#FFFBEB', border: '#FDE68A', fg: '#92400E', badge: 'badge-neutral' },
  WAIT_DAYS: { label: 'Noch warten', bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', badge: 'badge-blue' },
  NO_OPEN: { label: 'Alles geschlossen', bg: '#F8FAFC', border: '#E2E8F0', fg: '#475569', badge: 'badge-gray' },
  TRIP: { label: 'Unterwegs', bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', badge: 'badge-blue' },
  NO_STATIONS: { label: 'Keine Daten', bg: '#F8FAFC', border: '#E2E8F0', fg: '#475569', badge: 'badge-gray' },
};

const REASON_ICON = {
  range: Gauge,
  price: Fuel,
  trend: Clock,
  wave: Zap,
  bargain: Sparkles,
  ai: Cpu,
  rule: Scale,
};

const MIN_SAMPLES = 150;
const MIN_DAYS = 3;

function phaseLabel(status) {
  const phase = status?.phase;
  if (phase === 'training') return 'Trainiert …';
  if (phase === 'loading') return 'Lädt …';
  if (phase === 'error') return 'Nicht verfügbar';
  if (status?.ready) return status.blendWeight > 0 ? 'Trainiert & aktiv' : 'Trainiert – Profil ist noch genauer';
  if (phase === 'collecting') return 'Sammelt echte Messwerte';
  return 'Bereit';
}

function stationWhere(st) {
  if (!st) return '';
  if (st.isOnRouteCorridor) {
    const pos = st.aheadKm !== undefined ? `in ${st.aheadKm} km` : `km ${Math.round(st.kmAlongRoute || 0)} der Strecke`;
    return `${pos}${st.routeDetourKm >= 0.1 ? ` • ${fmtKm(st.routeDetourKm)} Abstecher` : ' • direkt an der Strecke'}`;
  }
  return Number.isFinite(st.distanceKm) ? `${fmtKm(st.distanceKm)} entfernt` : '';
}

/**
 * KI-Tab: Der weise Tankwart. Empfehlung, 24h-Prognose, Marktbewegung und Lernstand des Modells.
 */
export default function TankwartPanel({
  advice,
  stations = [],
  profile,
  regionReadingsMap,
  moves,
  mlStatus,
  onTrainNow,
  onResetModel,
  onSelectStation,
  activeVehicle,
  regionLabel = '',
  onOpenVehicleModal,
  navApp = 'apple',
  rules,
  onOpenLaws,
}) {
  const [selectedStationId, setSelectedStationId] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Auswahl: gewählte Station, sonst Tankwart-Empfehlung, sonst erste Station
  const selectedStation = stations.find((s) => s.id === selectedStationId) || advice?.bestStation || stations[0] || null;
  const modelKey = `${mlStatus?.trainingRuns || 0}:${mlStatus?.blendWeight || 0}:${mlStatus?.ready ? 1 : 0}`;

  const forecast = useMemo(() => {
    if (!selectedStation || !profile) return null;
    void modelKey; // nach jedem Training neu rechnen
    return forecastStationCurve({ station: selectedStation, pts: regionReadingsMap?.get(selectedStation.id) || [], profile, rules });
  }, [selectedStation, regionReadingsMap, profile, modelKey, rules]);

  const verdict = advice?.verdict || 'NO_STATIONS';
  const style = VERDICT_STYLE[verdict] || VERDICT_STYLE.NO_STATIONS;
  const best = advice?.bestStation;
  const preferredNav = resolveNavApp(navApp);
  const allClosed = verdict === 'NO_OPEN';

  const handleTrain = async () => {
    setIsWorking(true);
    try {
      await onTrainNow?.();
    } finally {
      setIsWorking(false);
    }
  };

  const handleReset = async () => {
    setConfirmReset(false);
    setIsWorking(true);
    try {
      await onResetModel?.();
    } finally {
      setIsWorking(false);
    }
  };

  const datasetSize = mlStatus?.lastDatasetSize || mlStatus?.samplesLearned || 0;
  const progressPct = Math.min(100, Math.round((datasetSize / MIN_SAMPLES) * 100));
  const validation = mlStatus?.validation;
  const whenText = allClosed ? 'Sobald eine Station öffnet' : verdict === 'TRIP' ? 'Auf dieser Fahrt' : verdict === 'URGENT' || verdict === 'FILL_NOW' ? 'Jetzt' : advice?.bestWindowLabel || 'Jetzt';

  return (
    <div className="panel-stack">
      {/* 1. DER WEISE TANKWART */}
      <div className="clean-card" style={{ padding: '1.25rem', background: `linear-gradient(135deg, #FFFFFF 0%, ${style.bg} 100%)`, border: `1px solid ${style.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
            <div className="tankwart-avatar" aria-hidden="true">⛽</div>
            <div style={{ minWidth: 0 }}>
              <div className="tankwart-kicker">Dein Tankwart{regionLabel ? ` • ${regionLabel}` : ''}</div>
              <h3 style={{ fontSize: '1.08rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.25 }}>{advice?.title || 'Ich schaue mir die Lage an …'}</h3>
            </div>
          </div>
          <span className={`badge ${style.badge}`} style={{ fontSize: '0.78rem', fontWeight: 800, padding: '0.35rem 0.75rem' }}>{style.label}</span>
        </div>

        {advice?.summary && <p style={{ fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.55, marginTop: '0.85rem' }}>{advice.summary}</p>}

        {best && (
          <div className="tankwart-grid">
            {/* Wo */}
            <div className="tankwart-box">
              <div className="tankwart-box-label">{allClosed ? 'Günstigste (geschlossen)' : 'Wo: beste Gesamtlösung'}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="tankwart-station-name">{best.name}</div>
                  <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                    {best.brand}{stationWhere(best) ? ` • ${stationWhere(best)}` : ''}
                    {!best.isOnRouteCorridor && best.detour && best.detour.totalDetourKm > 0.05 ? ` • ${fmtKm(best.detour.totalDetourKm)} Mehrweg` : ''}
                  </div>
                </div>
                <div className="num-mono" style={{ fontSize: '1.4rem', fontWeight: 800, color: allClosed ? '#64748B' : '#059669', flexShrink: 0 }}>{fmtNum(best.currentPrice, 3)}</div>
              </div>
              {!allClosed && advice.bestVsMedianEuro > 0.05 && (
                <div style={{ fontSize: '0.74rem', color: '#065F46', marginTop: '0.35rem', fontWeight: 600 }}>
                  ≈ {fmtEuro(advice.bestVsMedianEuro)} günstiger als der Regionsschnitt bei {advice.liters} L
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => onSelectStation && onSelectStation(best)} style={{ flex: 1, borderRadius: '9999px', justifyContent: 'center' }}>
                  <span>Details</span>
                  <ChevronRight size={13} />
                </button>
                {!allClosed && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigateToStation(best, navApp)} style={{ flex: 1, borderRadius: '9999px', justifyContent: 'center' }} title={`Mit ${navAppLabel(preferredNav)} hinfahren`}>
                    <Navigation size={13} />
                    <span>{navAppLabel(preferredNav)}</span>
                  </button>
                )}
              </div>
              {advice.alternativeStation && (
                <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.5rem' }}>
                  Alternative: <strong style={{ color: '#0F172A' }}>{advice.alternativeStation.name}</strong> ({fmtPrice(advice.alternativeStation.currentPrice)}{stationWhere(advice.alternativeStation) ? `, ${stationWhere(advice.alternativeStation)}` : ''})
                </div>
              )}
            </div>

            {/* Wann */}
            <div className="tankwart-box">
              <div className="tankwart-box-label">Wann</div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: style.fg }}>{whenText}</div>
              {advice.expectedSavingsEuro > 0 && !allClosed && (
                <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.2rem' }}>
                  Erwartete Ersparnis durch Warten: <strong className="num-mono" style={{ color: '#059669' }}>{fmtEuro(advice.expectedSavingsEuro)}</strong> bei {advice.liters} L
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.6rem', fontSize: '0.72rem', color: '#64748B' }}>
                <div>
                  <span style={{ display: 'block' }}>Restreichweite</span>
                  <strong className="num-mono" style={{ fontSize: '0.95rem', color: '#0F172A' }}>{Number.isFinite(advice.rangeKm) ? `${advice.rangeKm} km` : '–'}</strong>
                  {Number.isFinite(advice.daysOfRange) && <span style={{ display: 'block' }}>≈ {fmtNum(advice.daysOfRange, 1)} Tage bei {advice.dailyKm} km/Tag</span>}
                </div>
                <div>
                  <span style={{ display: 'block' }}>Verlässlichkeit</span>
                  <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>{advice.confidence?.label || '–'}</strong>
                  <div className="mini-meter">
                    <div style={{ width: `${Math.round((advice.confidence?.value || 0) * 100)}%` }} />
                  </div>
                </div>
              </div>
              {onOpenVehicleModal && (
                <button type="button" className="text-link" onClick={onOpenVehicleModal} style={{ marginTop: '0.55rem' }}>
                  <Car size={12} /> Tankstand {activeVehicle?.name ? `von ${activeVehicle.name} ` : ''}anpassen
                </button>
              )}
            </div>
          </div>
        )}

        {advice?.reasons?.length > 0 && (
          <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div className="tankwart-box-label">Warum</div>
            {advice.reasons.map((r, idx) => {
              const Icon = REASON_ICON[r.icon] || Sparkles;
              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: '#334155', lineHeight: 1.45 }}>
                  <Icon size={14} color="#0F172A" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{r.text}</span>
                </div>
              );
            })}
          </div>
        )}

        {advice?.dataNote && (
          <div style={{ marginTop: '0.85rem', fontSize: '0.72rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Database size={12} style={{ flexShrink: 0 }} />
            <span>{advice.dataNote}</span>
          </div>
        )}
      </div>

      <RuleBanner rules={rules} onOpen={onOpenLaws} />

      {/* 2. 24h-PROGNOSE */}
      {selectedStation && forecast && (
        <div className="clean-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <Clock size={16} color="#0F172A" />
                <h4 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0F172A' }}>24-Stunden-Prognose</h4>
                <span className={`badge ${forecast.usesNeuralNet ? 'badge-favorable' : 'badge-gray'}`} style={{ fontSize: '0.66rem' }}>
                  {forecast.usesNeuralNet ? `Neuronales Netz ${Math.round(forecast.nnWeight * 100)} %` : 'Regionsprofil'}
                </span>
              </div>
              <p style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.25rem', lineHeight: 1.4 }}>
                {selectedStation.name}: Tief {forecast.lowest.hoursAhead === 0 ? 'jetzt' : describeWindowTime(forecast.lowest)} (~{fmtPrice(forecast.lowest.price)}), Hoch {forecast.highest.hoursAhead === 0 ? 'jetzt' : describeWindowTime(forecast.highest)} (~{fmtPrice(forecast.highest.price)}).
                {forecast.potentialSavingsCent > 0.4 ? ` Warten könnte bis zu ${fmtNum(forecast.potentialSavingsCent, 1)} ct/L bringen.` : ' Günstiger als jetzt wird es laut Prognose kaum.'}
              </p>
            </div>
            <select className="compact-select" value={selectedStation.id} onChange={(e) => setSelectedStationId(e.target.value)} aria-label="Tankstelle für die Prognose">
              {stations.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.id === best?.id ? '★ ' : ''}{st.name} ({fmtPrice(st.currentPrice)})
                </option>
              ))}
            </select>
          </div>
          <ForecastStrip forecast={forecast} />
          <div className="chart-legend" style={{ marginTop: '0.75rem' }}>
            <span><i className="lg-dot" style={{ background: '#059669' }} /> Tief</span>
            <span><i className="lg-dot" style={{ background: '#DC2626' }} /> Hoch</span>
            <span><i className="lg-dot" style={{ background: '#0F172A' }} /> Jetzt (echter Preis)</span>
            <span style={{ marginLeft: 'auto' }}>Tagesmittel der Station: {fmtPrice(forecast.level)}{forecast.levelFromHistory ? '' : ' (geschätzt)'}</span>
          </div>
        </div>
      )}

      {/* 3. MARKTBEWEGUNG */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Zap size={16} color={moves?.wave === 'UP' ? '#DC2626' : moves?.wave === 'DOWN' ? '#059669' : '#0F172A'} />
            <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>Marktbewegung im Bereich</strong>
          </div>
          <span className={`badge ${moves?.wave === 'UP' ? 'badge-unfavorable' : moves?.wave === 'DOWN' ? 'badge-favorable' : 'badge-gray'}`} style={{ fontSize: '0.74rem' }}>
            {moves?.wave === 'UP' ? 'Erhöhungswelle' : moves?.wave === 'DOWN' ? 'Senkungswelle' : 'Ruhig'}
          </span>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5 }}>
          {moves?.wave === 'UP' && `${moves.ups} von ${moves.considered} beobachteten Tankstellen haben in den letzten 90 Minuten erhöht. Erfahrungsgemäß ziehen die übrigen in den folgenden Stunden nach – wer jetzt noch günstig ist, bleibt es wahrscheinlich nicht lange.`}
          {moves?.wave === 'DOWN' && `${moves.downs} von ${moves.considered} beobachteten Tankstellen haben in den letzten 90 Minuten gesenkt. Die Region ist in einer Senkungsphase – ein guter Moment zum Tanken rückt näher.`}
          {(!moves || moves.wave === 'NONE') && (moves?.considered > 0
            ? `Keine auffällige Welle: In den letzten 90 Minuten gab es ${moves.ups} Erhöhung${moves.ups === 1 ? '' : 'en'} und ${moves.downs} Senkung${moves.downs === 1 ? '' : 'en'} unter ${moves.considered} beobachteten Tankstellen.`
            : 'Sobald für die Tankstellen mindestens zwei aktuelle Abrufe vorliegen, erkenne ich hier Erhöhungs- und Senkungswellen.')}
        </p>
        {moves && moves.moves.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
            {moves.moves.slice(0, 6).map((m) => (
              <span key={m.stationId} className={`move-chip ${m.direction === 'UP' ? 'is-up' : 'is-down'}`} title={m.name}>
                {m.direction === 'UP' ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {m.brand} {fmtCt(m.deltaCent)} • {moveTimeText(m)}
                {m.outsideRule ? ` • außerhalb ${moves.ruleTimesLabel || 'der erlaubten Zeit'}` : m.ruleIncrease ? ' • zur erlaubten Zeit' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 4. MODELL & LERNSTAND */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px', display: 'flex' }}>
                <Cpu size={16} />
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A' }}>Lernendes Prognosemodell</h3>
              <span className={`badge ${mlStatus?.ready && mlStatus.blendWeight > 0 ? 'badge-favorable' : mlStatus?.ready ? 'badge-blue' : mlStatus?.phase === 'error' ? 'badge-unfavorable' : 'badge-neutral'}`}>
                {mlStatus?.ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                <span>{phaseLabel(mlStatus)}</span>
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.35rem', lineHeight: 1.45 }}>
              Ein kleines neuronales Netz (TensorFlow.js, läuft nur auf deinem Gerät) lernt aus den echten Preisen deiner Tankstellen, wie sich der Preis in den nächsten 1 bis 24 Stunden entwickelt. Es fließt erst in die Prognose ein, wenn es im Test nachweislich besser ist als das Regionsprofil.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleTrain} disabled={isWorking || mlStatus?.phase === 'training' || mlStatus?.phase === 'error'}>
              <RefreshCw size={13} className={isWorking || mlStatus?.phase === 'training' ? 'animate-spin' : ''} />
              <span>{mlStatus?.phase === 'training' ? 'Trainiert …' : 'Jetzt trainieren'}</span>
            </button>
            {!confirmReset ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmReset(true)} disabled={isWorking} title="Lernstand des Netzes löschen">
                <RotateCcw size={12} />
                <span>Zurücksetzen</span>
              </button>
            ) : (
              <div className="inline-confirm">
                <span>Lernstand löschen? Preisdaten bleiben.</span>
                <button type="button" className="btn btn-sm btn-danger" onClick={handleReset}>Löschen</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmReset(false)}>Abbrechen</button>
              </div>
            )}
          </div>
        </div>

        {mlStatus?.lastError && (
          <div className="inline-msg is-error" style={{ marginTop: '0.75rem' }}>
            <AlertCircle size={13} />
            <span>{mlStatus.lastError}</span>
          </div>
        )}

        {!mlStatus?.ready && mlStatus?.phase !== 'error' && (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span>Lernbeispiele aus echten Messwerten</span>
              <strong className="num-mono" style={{ color: '#0F172A' }}>{datasetSize.toLocaleString('de-DE')} / {MIN_SAMPLES}{mlStatus?.daysLearned ? ` • ${fmtNum(mlStatus.daysLearned, 0)} / ${MIN_DAYS} Tage` : ''}</strong>
            </div>
            <div className="progress-track">
              <div style={{ width: `${progressPct}%` }} />
            </div>
            <p style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.3rem' }}>
              Jede beobachtete Preisänderung wird zum Lernbeispiel. Die App sammelt bei jedem Öffnen und alle 10 Minuten, solange sie geöffnet ist. Das Netz braucht Daten von mindestens {MIN_DAYS} verschiedenen Tagen. Mit dem Tankerkönig-Archiv (Menü → Datenbank) geht es sofort.
            </p>
          </div>
        )}

        <div className="model-stats">
          <div>
            <span>Gelernte Beispiele</span>
            <strong className="num-mono">{(mlStatus?.samplesLearned || 0).toLocaleString('de-DE')}</strong>
            <em>aus {mlStatus?.stationsLearned || 0} Tankstellen</em>
          </div>
          <div>
            <span>Trainingsläufe</span>
            <strong className="num-mono">{mlStatus?.trainingRuns || 0}</strong>
            <em>
              Zuletzt: {mlStatus?.lastTrainedAt ? new Date(mlStatus.lastTrainedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie'}
            </em>
          </div>
          <div>
            <span>Prognosefehler im Test</span>
            <strong className="num-mono">{validation && Number.isFinite(validation.nnMaeCt) ? `±${fmtNum(validation.nnMaeCt, 1)} ct` : '–'}</strong>
            <em>{validation && Number.isFinite(validation.profileMaeCt) ? `Profil allein: ±${fmtNum(validation.profileMaeCt, 1)} ct` : 'nach dem ersten Training'}</em>
          </div>
          <div>
            <span>Anteil an der Prognose</span>
            <strong className="num-mono">{Math.round((mlStatus?.blendWeight || 0) * 100)} %</strong>
            <em>Rest: Regionsprofil</em>
          </div>
          <div>
            <span>Gespeichert</span>
            <strong style={{ color: mlStatus?.isPersisted ? '#2563EB' : '#64748B' }}>{mlStatus?.isPersisted ? 'auf dem Gerät' : 'noch nicht'}</strong>
            <em>und in der Datenbank-Datei</em>
          </div>
          <div>
            <span>Rechenwerk</span>
            <strong>{mlStatus?.backend ? mlStatus.backend.toUpperCase() : '–'}</strong>
            <em>on-device, kein Server</em>
          </div>
        </div>
      </div>
    </div>
  );
}
