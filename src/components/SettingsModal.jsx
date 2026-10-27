import React, { useState } from 'react';
import { Settings, Key, Clock, Check, X, ExternalLink, AlertCircle, CheckCircle2, Database, Car, Bell, FolderOpen, Navigation, RefreshCw } from 'lucide-react';
import { dataService } from '../services/dataService';
import { backupService, describeSaveResult, fmtWhen } from '../services/backupService';
import { navAppLabel } from '../services/navHandoff';
import { fmtNum } from '../utils/format';
import { useEscapeToClose } from './modalHooks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NAV_OPTIONS = [
  { id: 'apple', label: 'Apple Karten' },
  { id: 'google', label: 'Google Maps' },
];

/**
 * Einstellungen: Datenbank-Ordner, Tankerkönig-Key, Karten-App, Fahrprofil, Preisalarm.
 * Wird nur geöffnet gerendert – startet daher immer mit den aktuellen Werten.
 */
export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings, dbStatus = null, serverKeyAvailable = false, onOpenDbSetup }) {
  const storedKey = dataService.getStoredKey();
  const [tkKey, setTkKey] = useState(storedKey);
  const [thresholdCent, setThresholdCent] = useState(Number(settings.alertThresholdCent) || 3);
  const [dailyCommuteKm, setDailyCommuteKm] = useState(Number(settings.dailyCommuteKm) || 30);
  const [commuteMorningStart, setCommuteMorningStart] = useState(settings.commuteMorningStart || '07:30');
  const [commuteMorningEnd, setCommuteMorningEnd] = useState(settings.commuteMorningEnd || '08:45');
  const [commuteEveningStart, setCommuteEveningStart] = useState(settings.commuteEveningStart || '16:30');
  const [commuteEveningEnd, setCommuteEveningEnd] = useState(settings.commuteEveningEnd || '18:45');
  const [navApp, setNavApp] = useState(settings.navApp === 'google' ? 'google' : 'apple');
  const [tkTest, setTkTest] = useState({ testing: false, result: null });
  const [saveState, setSaveState] = useState(null); // null | 'saving' | 'done' | 'error'
  const [saveMessage, setSaveMessage] = useState('');
  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const status = dbStatus || backupService.getStatus();
  const isDirect = (status.mode === 'server' && status.serverAvailable !== false) || (status.mode === 'fs-access' && status.permission === 'granted');
  const locationText = status.mode === 'server'
    ? status.dir
    : status.mode === 'fs-access'
      ? `Ordner „${status.dir}“ (im Browser freigegeben)`
      : status.mode === 'manual'
        ? 'Dein iCloud-Ordner in der Dateien-App'
        : 'Kein Ordner festgelegt';
  const trimmedKey = tkKey.trim();
  const keyChanged = trimmedKey !== storedKey;
  const keyInvalid = trimmedKey !== '' && !UUID_RE.test(trimmedKey);

  const handleTestTk = async () => {
    setTkTest({ testing: true, result: null });
    const res = await dataService.testTankerkoenig(trimmedKey);
    setTkTest({ testing: false, result: res });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (keyInvalid) {
      setTkTest({ testing: false, result: { success: false, message: 'Der Key hat nicht das erwartete Format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.' } });
      return;
    }
    setSaveState('saving');
    if (keyChanged) dataService.saveCredentials({ tankerkoenigKey: trimmedKey });
    onSaveSettings(
      {
        alertThresholdCent: Math.round(Number(thresholdCent) * 10) / 10,
        dailyCommuteKm: Math.max(5, parseInt(dailyCommuteKm, 10) || 30),
        commuteMorningStart,
        commuteMorningEnd,
        commuteEveningStart,
        commuteEveningEnd,
        navApp,
      },
      { keyChanged }
    );
    // Danach als neue Datei mit Zeitstempel sichern (Mac/Browser-Ordner direkt, iPhone per Teilen/Download)
    let closeDelay = 1200;
    try {
      const res = await backupService.saveToDatabase({ explicit: true });
      setSaveState(res.success ? 'done' : 'error');
      setSaveMessage(res.success ? describeSaveResult(res) : res.message || 'Datei konnte nicht gespeichert werden – Einstellungen sind lokal übernommen.');
      if (!res.success) closeDelay = 3500;
    } catch (err) {
      setSaveState('error');
      setSaveMessage(`Einstellungen übernommen, Datei nicht gespeichert: ${err.message}`);
      closeDelay = 3500;
    }
    setTimeout(onClose, closeDelay);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Einstellungen">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div className="modal-head-icon">
              <Settings size={16} />
            </div>
            <div>
              <h3>Einstellungen</h3>
              <p>Datenbank, Tankerkönig-Key, Karten-App, Fahrprofil und Alarme</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* 1. Datenbank */}
          <section className="settings-section">
            <div className="settings-section-head">
              <h4><Database size={15} /> Datenbank-Ordner</h4>
              <span className={`badge ${isDirect ? 'badge-favorable' : 'badge-neutral'}`} style={{ fontSize: '0.65rem' }}>
                {status.mode ? status.modeLabel : 'Nicht verbunden'}
              </span>
            </div>
            <div className="settings-path">{locationText}</div>
            <div className="settings-row">
              <span className="settings-note">
                {status.currentName
                  ? `Stand: ${status.currentName}${status.currentAt ? ` (${fmtWhen(status.currentAt)}, ${status.currentSource === 'save' ? 'gespeichert' : 'geladen'})` : ''}.`
                  : 'Noch keine Datei – die erste entsteht beim ersten Speichern.'}
                {status.unsavedSince ? ` Änderungen seit ${fmtWhen(status.unsavedSince)} noch nicht in der Datei.` : ''}
              </span>
              {onOpenDbSetup && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenDbSetup}>
                  <FolderOpen size={12} />
                  <span>Ordner ändern</span>
                </button>
              )}
            </div>
          </section>

          {/* 2. Tankerkönig */}
          <section className={`settings-section ${!storedKey && !serverKeyAvailable ? 'is-required' : ''}`}>
            <div className="settings-section-head">
              <h4><Key size={15} /> Tankerkönig-Key {serverKeyAvailable ? '(optional)' : ''}</h4>
              <a href="https://creativecommons.tankerkoenig.de/" target="_blank" rel="noreferrer" className="text-link">
                Kostenlos Key holen <ExternalLink size={12} />
              </a>
            </div>
            <p className="settings-note" style={{ marginBottom: '0.6rem' }}>
              {serverKeyAvailable
                ? 'Auf dem Server ist bereits ein Key hinterlegt – die App funktioniert auch ohne eigenen. Ein eigener Key hat Vorrang.'
                : 'Ohne Key gibt es keine Tankstellen und keine Preise. Der Key liefert die amtlichen MTS-K-Daten für Diesel, E5 und E10.'}
              {' '}Er wird lokal und in der Datenbank-Datei gesichert.
            </p>
            <div className="input-with-btn">
              <input
                className={`text-input is-mono ${keyInvalid ? 'is-invalid' : ''}`}
                type="text"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={tkKey}
                onChange={(e) => {
                  setTkKey(e.target.value);
                  setTkTest({ testing: false, result: null });
                }}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Tankerkönig API-Key"
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleTestTk} disabled={tkTest.testing || !trimmedKey}>
                {tkTest.testing ? <RefreshCw size={13} className="animate-spin" /> : null}
                <span>{tkTest.testing ? 'Prüfe …' : 'Testen'}</span>
              </button>
            </div>
            {tkTest.result && (
              <div className={`inline-msg ${tkTest.result.success ? 'is-success' : 'is-error'}`} style={{ marginTop: '0.5rem' }}>
                {tkTest.result.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{tkTest.result.message}</span>
              </div>
            )}
            {!tkTest.result && storedKey && !keyChanged && (
              <div className="settings-note" style={{ marginTop: '0.4rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <CheckCircle2 size={13} /> Eigener Key ist gespeichert.
              </div>
            )}
          </section>

          {/* 3. Karten-App */}
          <section className="settings-section">
            <div className="settings-section-head">
              <h4><Navigation size={15} /> Navigation öffnen mit</h4>
            </div>
            <div className="segmented is-wide" role="group" aria-label="Karten-App">
              {NAV_OPTIONS.map((o) => (
                <button key={o.id} type="button" className={navApp === o.id ? 'active' : ''} onClick={() => setNavApp(o.id)} aria-pressed={navApp === o.id}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="settings-note" style={{ marginTop: '0.45rem' }}>
              {navApp === 'apple'
                ? `Standard. Bei einer Fahrt übernimmt ${navAppLabel('apple')} den Tankstopp als Zwischenziel (ab iOS 18.4).`
                : `Google Maps muss auf dem iPhone installiert sein, sonst öffnet sich die Webversion. Der Tankstopp wird als Zwischenziel übernommen.`}
            </p>
          </section>

          {/* 4. Fahrprofil */}
          <section className="settings-section">
            <div className="settings-section-head">
              <h4><Car size={15} /> Fahrprofil</h4>
            </div>
            <div className="settings-slider-head">
              <span>Fahrstrecke pro Tag</span>
              <strong className="num-mono">{dailyCommuteKm} km</strong>
            </div>
            <input type="range" min="5" max="200" step="5" value={dailyCommuteKm} onChange={(e) => setDailyCommuteKm(Number(e.target.value))} aria-label="Fahrstrecke pro Tag" />
            <p className="settings-note" style={{ marginBottom: '0.75rem' }}>Daraus schätzt der Tankwart, wie lange der Tank noch reicht und ob sich Warten lohnt.</p>

            <div className="settings-slider-head" style={{ marginBottom: '0.35rem' }}>
              <span><Clock size={13} style={{ verticalAlign: '-2px' }} /> Übliche Tankzeiten (Morgen-/Abend-Vergleich)</span>
            </div>
            <div className="time-grid">
              <div>
                <span className="field-label">Morgens</span>
                <div className="time-range">
                  <input type="time" className="text-input" value={commuteMorningStart} onChange={(e) => setCommuteMorningStart(e.target.value)} aria-label="Morgens von" />
                  <span>bis</span>
                  <input type="time" className="text-input" value={commuteMorningEnd} onChange={(e) => setCommuteMorningEnd(e.target.value)} aria-label="Morgens bis" />
                </div>
              </div>
              <div>
                <span className="field-label">Abends</span>
                <div className="time-range">
                  <input type="time" className="text-input" value={commuteEveningStart} onChange={(e) => setCommuteEveningStart(e.target.value)} aria-label="Abends von" />
                  <span>bis</span>
                  <input type="time" className="text-input" value={commuteEveningEnd} onChange={(e) => setCommuteEveningEnd(e.target.value)} aria-label="Abends bis" />
                </div>
              </div>
            </div>
          </section>

          {/* 5. Preisalarm */}
          <section className="settings-section">
            <div className="settings-section-head">
              <h4><Bell size={15} /> Preisalarm</h4>
            </div>
            <div className="settings-slider-head">
              <span>Melden ab</span>
              <strong className="num-mono" style={{ color: '#059669' }}>{fmtNum(thresholdCent, 1)} ct Ersparnis</strong>
            </div>
            <input type="range" min="1" max="10" step="0.5" value={thresholdCent} onChange={(e) => setThresholdCent(Number(e.target.value))} aria-label="Alarm-Schwelle in Cent" />
            <p className="settings-note">
              Hinweis, wenn die günstigste geöffnete Tankstelle mindestens so viel unter ihrem üblichen Preis für diese Uhrzeit oder unter dem Regionsmedian liegt. Benachrichtigungen schaltest du über die Glocke oben ein.
            </p>
          </section>

          <div className="modal-foot">
            {saveState && saveState !== 'saving' && (
              <span className={`settings-save-msg ${saveState === 'error' ? 'is-error' : ''}`}>{saveMessage}</span>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn btn-primary" disabled={saveState === 'saving'}>
              {saveState === 'done' ? <Check size={14} /> : saveState === 'saving' ? <RefreshCw size={14} className="animate-spin" /> : null}
              <span>{saveState === 'saving' ? 'Speichere …' : saveState === 'done' ? 'Gespeichert' : 'Speichern'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
