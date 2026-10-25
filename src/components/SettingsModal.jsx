import React, { useState, useEffect } from 'react';
import { Settings, Database, Key, Clock, Check, X, ExternalLink, Info, AlertCircle, CheckCircle2, Cloud } from 'lucide-react';
import { dataService } from '../services/dataService';
import { backupService } from '../services/backupService';

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) {
  const creds = dataService.getCredentials();
  const [supabaseUrl, setSupabaseUrl] = useState(creds.supabaseUrl || '');
  const [supabaseKey, setSupabaseKey] = useState(creds.supabaseKey || '');
  const [tkKey, setTkKey] = useState(creds.tankerkoenigKey || '');

  const [thresholdCent, setThresholdCent] = useState(settings.alertThresholdCent || 3.0);
  const [commuteMorningStart, setCommuteMorningStart] = useState(settings.commuteMorningStart || '07:30');
  const [commuteMorningEnd, setCommuteMorningEnd] = useState(settings.commuteMorningEnd || '08:45');
  const [commuteEveningStart, setCommuteEveningStart] = useState(settings.commuteEveningStart || '16:30');
  const [commuteEveningEnd, setCommuteEveningEnd] = useState(settings.commuteEveningEnd || '18:45');

  // iCloud Pfad State
  const [iCloudPath, setICloudPath] = useState(backupService.getCustomPath());
  const [pathStatus, setPathStatus] = useState(null);
  const [isTestingPath, setIsTestingPath] = useState(false);

  // Test states
  const [tkTestState, setTkTestState] = useState({ testing: false, result: null });
  const [sbTestState, setSbTestState] = useState({ testing: false, result: null });

  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      backupService.checkServerStatus().then((status) => {
        if (status.isAvailable) {
          setPathStatus(status);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCheckPath = async () => {
    setIsTestingPath(true);
    backupService.setCustomPath(iCloudPath);
    const status = await backupService.checkServerStatus();
    setPathStatus(status);
    setIsTestingPath(false);
  };

  const handleTestTk = async () => {
    setTkTestState({ testing: true, result: null });
    const res = await dataService.testTankerkoenig(tkKey);
    setTkTestState({ testing: false, result: res });
  };

  const handleTestSb = async () => {
    setSbTestState({ testing: true, result: null });
    const res = await dataService.testSupabase(supabaseUrl, supabaseKey);
    setSbTestState({ testing: false, result: res });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Save API credentials
    dataService.saveCredentials({
      supabaseUrl: supabaseUrl.trim(),
      supabaseKey: supabaseKey.trim(),
      tankerkoenigKey: tkKey.trim(),
    });

    // Save iCloud Path
    backupService.setCustomPath(iCloudPath);

    // Save user settings
    onSaveSettings({
      alertThresholdCent: parseFloat(thresholdCent),
      commuteMorningStart,
      commuteMorningEnd,
      commuteEveningStart,
      commuteEveningEnd,
    });

    // Speichere alles inklusive neuem Tankerkönig Key direkt in die iCloud-Datenbankdatei!
    backupService.directSyncToICloud().catch((err) => console.warn('iCloud direct sync on settings save:', err));

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 1000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px' }}>
              <Settings size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                System-Einstellungen & API-Anbindung
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                iCloud Direkt-Sync, Tankerkönig Live-API & Pendler-Schwellenwerte
              </p>
            </div>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>

          {/* 1. TANKERKÖNIG API SEKTION (PRIMÄR & ERFORDERLICH) */}
          <div style={{
            background: '#FFFFFF',
            border: '2px solid #F59E0B',
            borderRadius: '10px',
            padding: '1rem',
            marginBottom: '1.25rem',
            boxShadow: '0 4px 14px rgba(245, 158, 11, 0.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <div style={{ background: '#FEF3C7', color: '#D97706', padding: '0.3rem', borderRadius: '6px' }}>
                  <Key size={16} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
                    1. Tankerkönig API-Key (Erforderlich für alle Live-Daten)
                  </h4>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-favorable" style={{ fontSize: '0.68rem', fontWeight: 700 }}>
                  100% Echte Tankstellen
                </span>
                <a 
                  href="https://creativecommons.tankerkoenig.de/" 
                  target="_blank" 
                  rel="noreferrer"
                  style={{ fontSize: '0.74rem', color: '#0284C7', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 700 }}
                >
                  <span>Kostenlos Key holen</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.45, marginBottom: '0.65rem' }}>
              Ohne persönlichen Key werden <strong>keine Tankstellen und keine Preise</strong> angezeigt. Liefert deutschlandweit minütlich frische MTS-K Daten des Bundeskartellamtes für <strong>Diesel, E5 & E10</strong>. Registrierung dauert 1 Minute auf <em>creativecommons.tankerkoenig.de</em>.
            </p>

            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <input
                type="text"
                placeholder="z.B. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                value={tkKey}
                onChange={(e) => setTkKey(e.target.value)}
                style={{ flex: 1, padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1.5px solid #CBD5E1', fontSize: '0.8rem', fontFamily: 'monospace' }}
              />
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ fontSize: '0.74rem', padding: '0.5rem 0.85rem', whiteSpace: 'nowrap', fontWeight: 700 }}
                onClick={handleTestTk}
                disabled={tkTestState.testing}
              >
                {tkTestState.testing ? 'Prüfe...' : 'Key testen'}
              </button>
            </div>

            {tkTestState.result && (
              <div style={{ 
                marginTop: '0.4rem', 
                padding: '0.45rem 0.65rem', 
                borderRadius: '6px', 
                fontSize: '0.74rem',
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.4rem',
                background: tkTestState.result.success ? '#ECFDF5' : '#FEF2F2',
                color: tkTestState.result.success ? '#065F46' : '#991B1B',
                border: `1px solid ${tkTestState.result.success ? '#A7F3D0' : '#FECACA'}`
              }}>
                {tkTestState.result.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{tkTestState.result.message}</span>
              </div>
            )}
          </div>

          {/* 2. ICLOUD & LOKALER DATEIPFAD (DIREKT-SYNC OHNE DIALOG) */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.95rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Cloud size={16} color="#0284C7" />
                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A' }}>
                  2. iCloud Drive Dateipfad (1-Klick-Sync ohne Finder-Dialog)
                </h4>
              </div>
              <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                Automatisch aktiv
              </span>
            </div>

            <p style={{ fontSize: '0.74rem', color: '#64748B', lineHeight: 1.45, marginBottom: '0.65rem' }}>
              Hinterlege hier einmalig den Pfad zu deiner <code>kraftstoff_daten.json</code> in iCloud Drive. Beim Klick auf <strong>„Aus iCloud aktualisieren“</strong> oder <strong>„In iCloud sichern“</strong> wird diese Datei direkt im Hintergrund gelesen/geschrieben – ganz ohne dass jedes Mal ein Dateiauswahl-Fenster aufpoppt!
            </p>

            <div style={{ marginBottom: '0.6rem' }}>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: '#334155', marginBottom: '0.2rem' }}>
                Speicherpfad auf deinem Mac:
              </label>
              <input
                type="text"
                value={iCloudPath}
                onChange={(e) => setICloudPath(e.target.value)}
                placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/kraftstoff_daten.json"
                style={{ width: '100%', padding: '0.42rem 0.65rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.76rem', fontFamily: 'monospace' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCheckPath}
                disabled={isTestingPath}
                style={{ fontSize: '0.72rem' }}
              >
                {isTestingPath ? 'Prüfe Pfad...' : 'Pfad prüfen & testen'}
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const defaultP = '~/Library/Mobile Documents/com~apple~CloudDocs/kraftstoff_daten.json';
                  setICloudPath(defaultP);
                  backupService.setCustomPath(defaultP);
                  handleCheckPath();
                }}
                style={{ fontSize: '0.72rem' }}
              >
                Auf Standard-iCloud zurücksetzen
              </button>
            </div>

            {pathStatus && (
              <div style={{
                marginTop: '0.6rem',
                padding: '0.45rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.74rem',
                background: pathStatus.exists ? '#ECFDF5' : '#FFFBEB',
                color: pathStatus.exists ? '#065F46' : '#92400E',
                border: `1px solid ${pathStatus.exists ? '#A7F3D0' : '#FDE68A'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}>
                {pathStatus.exists ? <CheckCircle2 size={14} color="#059669" /> : <Info size={14} color="#D97706" />}
                <span>
                  {pathStatus.exists
                    ? `✓ Datei existiert im Mac iCloud Drive (${pathStatus.path})! Bereit für 1-Klick Sync.`
                    : `Datei existiert noch nicht. Sie wird beim ersten Klick auf "In iCloud sichern" automatisch dort erstellt.`}
                </span>
              </div>
            )}
          </div>

          {/* SUPABASE CLOUD BACKEND SEKTION */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.95rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Database size={15} color="#059669" />
                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0F172A' }}>
                  2. Supabase Backend (PostgreSQL Cloud)
                </h4>
              </div>
              <a 
                href="https://supabase.com" 
                target="_blank" 
                rel="noreferrer"
                style={{ fontSize: '0.72rem', color: '#059669', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600 }}
              >
                <span>supabase.com</span>
                <ExternalLink size={12} />
              </a>
            </div>

            <p style={{ fontSize: '0.74rem', color: '#64748B', lineHeight: 1.45, marginBottom: '0.65rem' }}>
              Speichert deine Preis-Historien, Schwellenwerte und Push-Abonnements dauerhaft. 
              Führe dazu einmalig das Skript <code>supabase/schema.sql</code> im Supabase SQL Editor aus.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', marginBottom: '0.15rem' }}>
                  Supabase Project URL (z.B. https://xyz.supabase.co):
                </label>
                <input
                  type="text"
                  placeholder="https://xyzcompany.supabase.co"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  style={{ width: '100%', padding: '0.42rem 0.65rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.78rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#475569', marginBottom: '0.15rem' }}>
                  Supabase Anon Public Key:
                </label>
                <input
                  type="password"
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={supabaseKey}
                  onChange={(e) => setSupabaseKey(e.target.value)}
                  style={{ width: '100%', padding: '0.42rem 0.65rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.78rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ fontSize: '0.74rem', padding: '0.4rem 0.75rem' }}
                  onClick={handleTestSb}
                  disabled={sbTestState.testing}
                >
                  {sbTestState.testing ? 'Prüfe Verbindung...' : 'Supabase-Verbindung testen'}
                </button>
              </div>

              {sbTestState.result && (
                <div style={{ 
                  marginTop: '0.2rem', 
                  padding: '0.4rem 0.6rem', 
                  borderRadius: '6px', 
                  fontSize: '0.73rem',
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.4rem',
                  background: sbTestState.result.success ? '#ECFDF5' : '#FEF2F2',
                  color: sbTestState.result.success ? '#065F46' : '#991B1B',
                  border: `1px solid ${sbTestState.result.success ? '#A7F3D0' : '#FECACA'}`
                }}>
                  {sbTestState.result.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>{sbTestState.result.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* SCHWELLENWERT-BERECHNUNG */}
          <div style={{ marginBottom: '1.15rem' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.35rem' }}>
              <span>Alarm-Schwellenwert (Unter adaptivem Schnitt):</span>
              <strong className="num-mono" style={{ color: '#059669' }}>{thresholdCent} Cent günstiger</strong>
            </label>
            <input
              type="range"
              min="1.0"
              max="10.0"
              step="0.5"
              value={thresholdCent}
              onChange={(e) => setThresholdCent(e.target.value)}
              style={{ width: '100%', accentColor: '#0F172A' }}
            />
            <span style={{ fontSize: '0.73rem', color: '#64748B' }}>
              Ein Preis gilt als "günstig", wenn er mindestens diesen Betrag unter dem Adaptive Moving Average liegt.
            </span>
          </div>

          {/* PENDLER-ZEITFENSTER */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '0.85rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <Clock size={15} color="#0F172A" />
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>
                Pendler-Zeitfenster (Heimweg-Automatik)
              </h4>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.78rem' }}>
              <div>
                <label style={{ display: 'block', color: '#64748B', marginBottom: '0.2rem' }}>Morgen-Rushhour:</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="time"
                    value={commuteMorningStart}
                    onChange={(e) => setCommuteMorningStart(e.target.value)}
                    style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid #E2E8F0', width: '100%' }}
                  />
                  <span>bis</span>
                  <input
                    type="time"
                    value={commuteMorningEnd}
                    onChange={(e) => setCommuteMorningEnd(e.target.value)}
                    style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid #E2E8F0', width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#64748B', marginBottom: '0.2rem' }}>Abend-Heimweg:</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="time"
                    value={commuteEveningStart}
                    onChange={(e) => setCommuteEveningStart(e.target.value)}
                    style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid #E2E8F0', width: '100%' }}
                  />
                  <span>bis</span>
                  <input
                    type="time"
                    value={commuteEveningEnd}
                    onChange={(e) => setCommuteEveningEnd(e.target.value)}
                    style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid #E2E8F0', width: '100%' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid #F1F5F9', paddingTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary">
              {isSaved ? <Check size={14} /> : null}
              <span>{isSaved ? 'Gespeichert!' : 'Einstellungen sichern'}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
