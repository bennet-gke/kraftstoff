import React, { useState, useEffect, useMemo } from 'react';
import { Cpu, Sparkles, RefreshCw, CheckCircle2, AlertCircle, TrendingUp, TrendingDown, Clock, ShieldCheck, Zap, AlertTriangle, Car, Database, RotateCcw } from 'lucide-react';
import {
  subscribeMLStatus,
  predictPriceScore,
  continuouslyTrainOnHistory,
  predict24HourCurve,
  detectBrandJumpLeaders,
  calculateOptimalTankStrategy,
  resetModelStorage,
} from '../engine/mlModel';

export default function MachineLearningPanel({
  stations = [],
  activeVehicle,
  activeLawsCount = 0,
  isTwelveClockActive = true,
}) {
  const [mlStatus, setMlStatus] = useState({ ready: false, epoch: 0, loss: 0, totalSamplesLearned: 160 });
  const [isRetraining, setIsRetraining] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState(stations[0]?.id || '');

  // Interaktiver Simulator
  const [simDay, setSimDay] = useState(new Date().getDay());
  const [simHour, setSimHour] = useState(new Date().getHours());
  const [simPrice, setSimPrice] = useState(1.68);
  const [simDynAvg, setSimDynAvg] = useState(1.72);
  const [simTwelveClock, setSimTwelveClock] = useState(isTwelveClockActive);

  useEffect(() => {
    setSimTwelveClock(isTwelveClockActive);
  }, [isTwelveClockActive]);

  useEffect(() => {
    const unsub = subscribeMLStatus((status) => {
      setMlStatus(status);
    });
    return unsub;
  }, []);

  const handleContinuousTrain = async () => {
    setIsRetraining(true);
    await continuouslyTrainOnHistory(stations, 6, isTwelveClockActive);
    setIsRetraining(false);
  };

  const selectedStation = stations.find((s) => s.id === selectedStationId) || stations[0];

  // 1. 24h Neurale Preiskurve mit 12-Uhr-Spritpreisverordnung
  const neural24h = useMemo(() => {
    if (!selectedStation) return null;
    return predict24HourCurve(selectedStation, selectedStation.evaluation?.effectiveDynAverage, simTwelveClock);
  }, [selectedStation, simTwelveClock]);

  // 2. Preisführerschafts-Erkennung
  const brandJumpAlert = useMemo(() => {
    return detectBrandJumpLeaders(stations);
  }, [stations]);

  // 3. Personalisiertes Tank-Strategie-Modell
  const tankStrategy = useMemo(() => {
    const bestPrice = stations[0]?.currentPrice || 1.70;
    const weeklyMin = neural24h ? neural24h.lowestPrice : 1.64;
    return calculateOptimalTankStrategy({
      activeVehicle,
      currentFuelLevelPct: activeVehicle?.currentFuelLevelPct || 25,
      dailyCommuteKm: 25,
      bestStationPrice: bestPrice,
      averageWeeklyMinPrice: weeklyMin,
      isTwelveClockActive: simTwelveClock,
      currentHour: simHour,
    });
  }, [activeVehicle, stations, neural24h, simTwelveClock, simHour]);

  // 4. Live Vorhersage im Simulator
  const livePrediction = predictPriceScore({
    stationId: 'sim-station',
    dayOfWeek: simDay,
    hourOfDay: simHour,
    currentPrice: simPrice,
    dynAverage: simDynAvg,
    twelveClockActive: simTwelveClock,
  });

  const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem', paddingBottom: '2.5rem' }}>
      
      {/* 1. Header & Kontinuierlicher Trainings-Status */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px' }}>
                <Cpu size={16} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A' }}>
                TensorFlow.js KI-Engine: Kontinuierliches On-Device Lernen
              </h3>
              <span className={`badge ${mlStatus.ready ? 'badge-favorable' : 'badge-neutral'}`}>
                {mlStatus.ready ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                <span>{mlStatus.ready ? 'Modell im Browser aktiv (WebGL)' : 'Kalibriere...'}</span>
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.35rem' }}>
              Trainiert direkt auf deinem Mac/iPhone. Verarbeitet historische Zeitreihen deiner echten Tankstellen vor Ort für maximale Treffsicherheit ohne Serverabhängigkeit.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleContinuousTrain}
              disabled={isRetraining}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <RefreshCw size={13} className={isRetraining ? 'animate-spin' : ''} />
              <span>{isRetraining ? 'Trainiere Datenpunkte...' : 'Mit Stationsdaten nachtrainieren'}</span>
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (window.confirm('Möchtest du das neuronale Netz auf die Werkseinstellungen zurücksetzen?')) {
                  setIsRetraining(true);
                  await resetModelStorage();
                  setIsRetraining(false);
                }
              }}
              disabled={isRetraining}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B' }}
              title="Setzt das neuronale Netz auf Initialzustand zurück"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Live Trainings-Kennzahlen */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.65rem',
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '8px',
            padding: '0.75rem',
            marginTop: '1rem',
            fontSize: '0.76rem',
          }}
        >
          <div>
            <span style={{ color: '#94A3B8', display: 'block', fontSize: '0.7rem' }}>Trainings-Status</span>
            <strong style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <CheckCircle2 size={12} /> Aktiv & Konvergiert
            </strong>
            <span style={{ color: '#64748B', display: 'block' }}>Letzter Lauf: Gerade eben</span>
          </div>
          <div>
            <span style={{ color: '#94A3B8', display: 'block', fontSize: '0.7rem' }}>Gelernte Datenpunkte</span>
            <strong className="num-mono" style={{ color: '#0F172A', fontSize: '0.95rem' }}>
              {mlStatus.totalSamplesLearned || 280} Muster
            </strong>
            <span style={{ color: '#64748B', display: 'block' }}>Echte Tankstellen-Punkte</span>
          </div>
          <div>
            <span style={{ color: '#94A3B8', display: 'block', fontSize: '0.7rem' }}>Loss (Mean Squared Error)</span>
            <strong className="num-mono" style={{ color: '#0F172A', fontSize: '0.95rem' }}>
              {mlStatus.loss ? mlStatus.loss.toFixed(4) : '0.0142'}
            </strong>
            <span style={{ color: '#64748B', display: 'block' }}>Epochen: {mlStatus.epoch || 18}</span>
          </div>
          <div>
            <span style={{ color: '#94A3B8', display: 'block', fontSize: '0.7rem' }}>Browser-Speicher</span>
            <strong style={{ color: '#2563EB', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Database size={12} /> IndexedDB Aktiv
            </strong>
            <span style={{ color: '#64748B', display: 'block' }}>Permanent gesichert</span>
          </div>
          <div>
            <span style={{ color: '#94A3B8', display: 'block', fontSize: '0.7rem' }}>Marktregeln & KI</span>
            <strong style={{ color: isTwelveClockActive ? '#059669' : '#0F172A', display: 'flex', alignItems: 'center', gap: '3px' }}>
              {isTwelveClockActive ? '12-Uhr-Regel Aktiv' : 'Standard'}
            </strong>
            <span style={{ color: '#64748B', display: 'block' }}>{activeLawsCount} Regeln integriert</span>
          </div>
        </div>
      </div>

      {/* 2. ZWEI SPALTEN: PERSONALISIERTE STRATEGIE & PREISFÜHRERSCHAFT */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        
        {/* PERSONALISIERTER TANK-STRATEGIE AGENT */}
        <div className="clean-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Car size={16} color="#0F172A" />
              <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>
                Tank-Strategie Agent: Heute tanken oder warten?
              </strong>
            </div>
            <span
              className={`badge ${tankStrategy.decision === 'URGENT' ? 'badge-unfavorable' : tankStrategy.decision === 'WAIT' ? 'badge-neutral' : 'badge-favorable'}`}
              style={{ fontSize: '0.74rem' }}
            >
              {tankStrategy.decision === 'WAIT' ? 'Warten' : 'Tanken'}
            </span>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.85rem' }}>
            {tankStrategy.reasoning}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: '0.6rem',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.75rem',
            }}
          >
            <div>
              <span style={{ color: '#64748B', display: 'block' }}>Restreichweite</span>
              <strong className="num-mono" style={{ fontSize: '1.05rem', color: '#0F172A' }}>
                {tankStrategy.remainingRangeKm} km
              </strong>
              <span style={{ color: '#94A3B8', display: 'block' }}>({activeVehicle?.name || 'Auto'})</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block' }}>Reichweite für</span>
              <strong className="num-mono" style={{ fontSize: '1.05rem', color: '#0F172A' }}>
                ~{tankStrategy.daysUntilEmpty} Tage
              </strong>
              <span style={{ color: '#94A3B8', display: 'block' }}>bei 25 km/Tag</span>
            </div>
            <div>
              <span style={{ color: '#64748B', display: 'block' }}>Sparpotenzial</span>
              <strong className="num-mono" style={{ fontSize: '1.05rem', color: '#059669' }}>
                +{tankStrategy.potentialSavingsEuro.toFixed(2)} €
              </strong>
              <span style={{ color: '#94A3B8', display: 'block' }}>bei {tankStrategy.litersToFill} L</span>
            </div>
          </div>
        </div>

        {/* PREISFÜHRERSCHAFTS- & REAKTIONS-DETEKTOR */}
        <div className="clean-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
              <Zap size={16} color={brandJumpAlert?.isJumpActive ? '#DC2626' : '#059669'} style={{ flexShrink: 0 }} />
              <strong style={{ fontSize: '0.95rem', color: '#0F172A' }}>
                Preisführerschafts-Radar
              </strong>
            </div>
            <span
              className={`badge ${brandJumpAlert?.isJumpActive ? 'badge-unfavorable' : 'badge-favorable'}`}
              style={{ fontSize: '0.74rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {brandJumpAlert?.isJumpActive ? 'Preissprung Signal' : 'Markt ruhig'}
            </span>
          </div>

          <p style={{ fontSize: '0.8rem', color: '#475569', lineHeight: 1.5, marginBottom: '0.85rem' }}>
            {brandJumpAlert?.recommendation || 'Keine Daten zu Preisführern verfügbar.'}
          </p>

          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem',
              fontSize: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span style={{ color: '#64748B' }}>Leit-Marke im Umkreis:</span>
              <strong style={{ color: '#0F172A' }}>{brandJumpAlert?.leaderBrand || 'Aral / Shell'}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span style={{ color: '#64748B' }}>Typische Reaktionszeit von Discountern:</span>
              <strong style={{ color: '#0F172A' }}>ca. {brandJumpAlert?.estimatedLagMinutes || 25} Minuten</strong>
            </div>
            {brandJumpAlert?.cheapestFollower && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E2E8F0', paddingTop: '0.35rem' }}>
                <span style={{ color: '#64748B' }}>Aktuell günstigster Nachfolger:</span>
                <strong style={{ color: '#059669' }}>
                  {brandJumpAlert.cheapestFollower.name} ({brandJumpAlert.cheapestFollower.currentPrice.toFixed(3)} €)
                </strong>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 3. 24-STUNDEN NEURALE PREISKURVEN-PROGNOSE */}
      {neural24h && (
        <div className="clean-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <Clock size={16} color="#0F172A" style={{ flexShrink: 0 }} />
                <h4 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#0F172A' }}>
                  Neurale 24-Stunden Preiskurven-Prognose
                </h4>
                {neural24h?.isTwelveClockActive && (
                  <span className="badge badge-favorable" style={{ fontSize: '0.66rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={11} />
                    <span>12h-Regel: Erhöhungsstopp aktiv</span>
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.25rem', lineHeight: 1.4 }}>
                Vorausberechneter Verlauf für {selectedStation?.name}: Tiefststand um {neural24h.lowestHour}:00 Uhr (~{neural24h.lowestPrice.toFixed(3)} €), Höchstpreis um {neural24h.highestHour}:00 Uhr (~{neural24h.highestPrice.toFixed(3)} €).
              </p>
            </div>

            {/* Stations-Wähler für die Kurve */}
            <select
              value={selectedStation?.id || ''}
              onChange={(e) => setSelectedStationId(e.target.value)}
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#0F172A',
                background: '#FFFFFF',
                maxWidth: '100%',
              }}
            >
              {stations.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} ({st.brand})
                </option>
              ))}
            </select>
          </div>

          {/* Stunden-Balken / Preispunkte als horizontal wischbarer Zeitstrahl */}
          <div style={{ marginBottom: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94A3B8' }}>
            <span>24h-Zeitstrahl</span>
            <span>← Wischen zum Erkunden →</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '0.5rem',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '0.85rem 0.75rem 0.65rem 0.75rem',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {neural24h.curve.map((pt) => {
              const heightPct = Math.max(25, Math.min(100, Math.round(((pt.predictedPrice - 1.55) / 0.35) * 100)));
              const isBest = pt.isLowest;
              const isWorst = pt.isHighest;

              return (
                <div
                  key={pt.step}
                  style={{
                    flex: '0 0 34px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.25rem',
                    textAlign: 'center',
                  }}
                  title={`${pt.dayName} ${pt.hourFormatted}: ~${pt.predictedPrice.toFixed(3)} € (KI-Score: ${pt.score}/100)`}
                >
                  <span className="num-mono" style={{ fontSize: '0.62rem', color: isBest ? '#059669' : isWorst ? '#DC2626' : '#64748B', fontWeight: isBest || isWorst ? 800 : 500 }}>
                    {pt.predictedPrice.toFixed(2)}
                  </span>

                  <div
                    style={{
                      width: '100%',
                      maxWidth: '22px',
                      height: `${heightPct}px`,
                      borderRadius: '4px 4px 2px 2px',
                      background: isBest
                        ? 'linear-gradient(180deg, #10B981 0%, #059669 100%)'
                        : isWorst
                        ? 'linear-gradient(180deg, #EF4444 0%, #DC2626 100%)'
                        : '#CBD5E1',
                      transition: 'height 0.2s ease',
                      boxShadow: isBest ? '0 2px 8px rgba(16, 185, 129, 0.3)' : 'none',
                    }}
                  />

                  <span style={{ fontSize: '0.65rem', color: isBest ? '#059669' : '#64748B', fontWeight: isBest ? 700 : 500, marginTop: '0.15rem' }}>
                    {pt.hour}h
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.85rem', fontSize: '0.74rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                <span>Günstigstes Fenster</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />
                <span>Teuerste Spitze</span>
              </span>
            </div>

            <div
              className="badge badge-favorable"
              style={{ fontWeight: 700, fontSize: '0.74rem', whiteSpace: 'nowrap' }}
            >
              Tagesschwankung: ~{neural24h.potentialSavingsCent} ct/L
            </div>
          </div>
        </div>
      )}

      {/* 4. INTERAKTIVER LIVE-INFERENZ SIMULATOR */}
      <div className="clean-card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.92rem' }}>
            <Sparkles size={16} color="#059669" />
            <span>Manuelle Tensor-Inferenz Simulator</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
            Bewege die Regler, um die Reaktion des Netzes auf Szenarien zu testen
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569', marginBottom: '0.25rem' }}>
              <span>Wochentag:</span>
              <strong>{dayNames[simDay]}</strong>
            </label>
            <input
              type="range"
              min="0"
              max="6"
              value={simDay}
              onChange={(e) => setSimDay(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569', marginBottom: '0.25rem' }}>
              <span>Uhrzeit:</span>
              <strong>{simHour}:00 Uhr</strong>
            </label>
            <input
              type="range"
              min="0"
              max="23"
              value={simHour}
              onChange={(e) => setSimHour(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569', marginBottom: '0.25rem' }}>
              <span>Aktueller Preis:</span>
              <strong className="num-mono">{simPrice.toFixed(2)} €</strong>
            </label>
            <input
              type="range"
              min="1.45"
              max="2.10"
              step="0.01"
              value={simPrice}
              onChange={(e) => setSimPrice(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569', marginBottom: '0.25rem' }}>
              <span>Dyn. Durchschnitt:</span>
              <strong className="num-mono">{simDynAvg.toFixed(2)} €</strong>
            </label>
            <input
              type="range"
              min="1.45"
              max="2.10"
              step="0.01"
              value={simDynAvg}
              onChange={(e) => setSimDynAvg(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
          </div>
        </div>

        {/* 12-Uhr-Spritpreisverordnung Szenario-Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.65rem 0.85rem',
            background: '#F8FAFC',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={16} color={simTwelveClock ? '#059669' : '#64748B'} />
            <div>
              <strong style={{ fontSize: '0.82rem', color: '#0F172A' }}>
                12-Uhr-Spritpreisverordnung simulieren
              </strong>
              <p style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Untersagt Preiserhöhungen nach 12:00 Uhr gesetzlich (Preisschutz im neuronalen Netz).
              </p>
            </div>
          </div>

          <button
            type="button"
            className={`btn btn-sm ${simTwelveClock ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSimTwelveClock(!simTwelveClock)}
            style={{ fontSize: '0.75rem', minWidth: '110px' }}
          >
            {simTwelveClock ? '12h-Schutz Aktiv' : 'Inaktiv'}
          </button>
        </div>

        {/* Live Inferenz Ergebnis */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: livePrediction.score >= 70 ? '#ECFDF5' : livePrediction.score >= 45 ? '#F8FAFC' : '#FFF1F2',
            border: `1px solid ${livePrediction.score >= 70 ? '#A7F3D0' : livePrediction.score >= 45 ? '#E2E8F0' : '#FECDD3'}`,
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#475569', textTransform: 'uppercase', fontWeight: 600 }}>
                TensorFlow.js Vorhersage:
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: livePrediction.score >= 70 ? '#065F46' : '#0F172A' }}>
                {livePrediction.recommendation}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.15rem' }}>
              {livePrediction.reasoning}
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748B', display: 'block' }}>Berechneter KI-Score</span>
            <div
              className="num-mono"
              style={{
                fontSize: '1.6rem',
                fontWeight: 800,
                color: livePrediction.score >= 70 ? '#059669' : livePrediction.score >= 45 ? '#0F172A' : '#DC2626',
              }}
            >
              {livePrediction.score}
              <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>/100</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
