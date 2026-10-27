import React, { useEffect, useRef, useState } from 'react';
import { Database, CheckCircle2, AlertCircle, AlertTriangle, Laptop, Smartphone, Upload, X, RefreshCw, FolderOpen, Info, Globe, FilePlus2 } from 'lucide-react';
import { backupService, DEFAULT_DB_DIR, SNAPSHOT_PREFIX, describeCounts, supportsFsAccess, isIOS, fmtWhen } from '../services/backupService';
import { useEscapeToClose } from './modalHooks';

/**
 * Einrichtung des Datenbank-Ordners. Erster Schritt beim ersten Start (variant="fullscreen"),
 * später erreichbar über "Ordner ändern" (variant="modal").
 *
 * Drei Zugriffsarten:
 *  - Mac-Server: Ordnerpfad eintragen, neueste Datei wird geladen, Speichern schreibt neue Dateien.
 *  - Ordner im Browser freigeben (Chrome/Edge, File System Access API).
 *  - Dateien-App / Download (iPhone, Safari): Datei auswählen bzw. ohne Datei starten.
 */
export default function DatabaseSetupScreen({ variant = 'fullscreen', onConnected, onClose }) {
  const [dir, setDir] = useState(() => (backupService.mode === 'server' && backupService.dir) || DEFAULT_DB_DIR);
  const [server, setServer] = useState(null);
  const [checkedDir, setCheckedDir] = useState(null);
  const [busy, setBusy] = useState(null); // 'server' | 'fs' | 'files' | 'fresh' | null
  const [result, setResult] = useState(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const fileInputRef = useRef(null);
  const firstCheckRef = useRef(true);
  const isChecking = checkedDir !== dir;
  useEscapeToClose(variant === 'modal', onClose);

  // Ordner live prüfen (entprellt)
  useEffect(() => {
    let cancelled = false;
    const delay = firstCheckRef.current ? 0 : 350;
    firstCheckRef.current = false;
    const timer = setTimeout(async () => {
      const status = await backupService.checkServer(dir);
      if (!cancelled) {
        setServer(status);
        setCheckedDir(dir);
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dir]);

  const finish = (res, text) => {
    setResult({ type: 'success', text });
    setTimeout(() => onConnected && onConnected(res), 700);
  };

  const loadedText = (res) =>
    `Neueste Datei geladen (${res.fileName}): ${describeCounts(res)}, API-Key ${res.hasKey ? 'vorhanden' : 'noch nicht hinterlegt'}${res.merged ? ' – Änderungen dieses Geräts wurden zusammengeführt' : ''}.`;

  const run = async (kind, fn) => {
    setBusy(kind);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ type: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleConnectServer = () => run('server', async () => {
    const res = await backupService.connectServer(dir);
    if (!res.success) {
      setResult({ type: 'error', text: res.message || 'Verbindung fehlgeschlagen.' });
      return;
    }
    finish(res, res.loaded ? loadedText(res) : res.message);
  });

  const handleConnectFs = () => run('fs', async () => {
    const res = await backupService.connectFsAccess();
    if (!res.success) {
      if (res.reason !== 'cancelled') setResult({ type: 'error', text: res.message || 'Ordner konnte nicht freigegeben werden.' });
      return;
    }
    finish(res, res.loaded ? loadedText(res) : res.message);
  });

  const handleFilesChange = (e) => {
    const input = e.target;
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    run('files', async () => {
      try {
        const res = await backupService.connectWithFiles(files, { mode: 'manual' });
        const skipped = res.skippedFiles ? ` (${res.skippedFiles} ungültige Datei${res.skippedFiles === 1 ? '' : 'en'} übersprungen)` : '';
        finish(res, `${loadedText(res)}${skipped}`);
      } finally {
        input.value = '';
      }
    });
  };

  const handleFresh = () => run('fresh', async () => {
    setConfirmFresh(false);
    const res = await backupService.connectFresh();
    finish(res, res.message);
  });

  let serverLine;
  if (isChecking || !server) serverLine = { tone: 'info', icon: RefreshCw, text: 'Prüfe Ordner …' };
  else if (server.pathOk === false) serverLine = { tone: 'error', icon: AlertCircle, text: server.error || 'Ungültiger Ordner.' };
  else if (server.newest) {
    const n = server.fileCount || 1;
    serverLine = { tone: 'success', icon: CheckCircle2, text: `${n} ${n === 1 ? 'Datei' : 'Dateien'} gefunden. Neueste: ${server.newest.name} (${fmtWhen(server.newest.mtime)}). Beim Verbinden wird sie geladen.` };
  } else if (server.legacy) {
    serverLine = { tone: 'success', icon: CheckCircle2, text: `Noch keine Datei im Ordner, aber eine ältere ${server.legacy.name} daneben (${fmtWhen(server.legacy.mtime)}). Sie wird als Startpunkt geladen; das nächste Speichern legt die erste Datei im Ordner an.` };
  } else if (server.dirExists) serverLine = { tone: 'info', icon: FolderOpen, text: 'Ordner vorhanden, noch ohne Datei. Die erste Datei entsteht beim ersten Speichern.' };
  else serverLine = { tone: 'info', icon: FolderOpen, text: 'Ordner existiert noch nicht. Er wird beim ersten Speichern zusammen mit der ersten Datei angelegt.' };
  const ServerIcon = serverLine.icon;
  const serverAvailable = !!server?.isAvailable;
  const canConnectServer = serverAvailable && server.pathOk !== false;
  const notInICloud = serverAvailable && !isChecking && server.pathOk !== false && server.inICloud === false;
  const isBusy = !!busy;
  const insecure = typeof window !== 'undefined' && window.isSecureContext === false;

  const body = (
    <div className="db-setup">
      <div className="db-setup-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
          <div className="db-setup-icon">
            <Database size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2>{variant === 'fullscreen' ? 'Schritt 1: Datenbank-Ordner festlegen' : 'Datenbank-Ordner ändern'}</h2>
            <p>Ein iCloud-Ordner für alles: API-Key, Fahrzeuge, Orte, Routen, Einstellungen, Preishistorie und KI-Modell.</p>
          </div>
        </div>
        {variant === 'modal' && onClose && (
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        )}
      </div>

      {variant === 'fullscreen' && (
        <p className="db-setup-intro">
          Jedes Speichern legt eine <strong>neue Datei</strong> <code>{SNAPSHOT_PREFIX}&lt;Datum&gt;_&lt;Uhrzeit&gt;.json</code> an – nichts wird überschrieben. Beim Öffnen wird die <strong>neueste Datei</strong> geladen; Änderungen von Mac und iPhone werden zusammengeführt. Gibt es noch keine Datei, entsteht sie beim ersten Speichern.
        </p>
      )}

      {/* A) Mac-Server */}
      {serverAvailable && (
        <div className="db-option is-primary">
          <div className="db-option-title"><Laptop size={15} /> <span>Ordner über den Mac</span></div>
          <p className="db-option-text">Der lokale Server liest die neueste Datei direkt aus iCloud Drive und legt beim Speichern automatisch neue Dateien an. Aufbewahrt werden die 20 neuesten Stände und zusätzlich 14 Tage lang je ein Stand pro Tag.</p>
          <label className="field-label" htmlFor="db-dir" style={{ marginTop: '0.6rem' }}>Ordner auf dem Mac</label>
          <div className="input-with-btn">
            <input
              id="db-dir"
              className="text-input is-mono"
              type="text"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConnectServer && !isBusy) handleConnectServer();
              }}
              placeholder={DEFAULT_DB_DIR}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {dir !== DEFAULT_DB_DIR && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDir(DEFAULT_DB_DIR)}>
                Standard
              </button>
            )}
          </div>
          <p className="field-hint">„~“ steht für deinen Benutzerordner. Standard: <code>{DEFAULT_DB_DIR}</code></p>
          <div className={`inline-msg is-${serverLine.tone}`} style={{ marginTop: '0.55rem' }}>
            <ServerIcon size={15} className={isChecking ? 'animate-spin' : ''} />
            <span>{serverLine.text}</span>
          </div>
          {notInICloud && (
            <div className="inline-msg is-warning" style={{ marginTop: '0.45rem' }}>
              <AlertTriangle size={15} />
              <span>Dieser Ordner liegt nicht in iCloud Drive – das iPhone sieht diese Dateien dann nicht.</span>
            </div>
          )}
          <button type="button" className="btn btn-primary db-option-btn" onClick={handleConnectServer} disabled={isBusy || isChecking || !canConnectServer}>
            {busy === 'server' ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
            <span>{busy === 'server' ? 'Verbinde …' : server?.newest || server?.legacy ? 'Ordner verbinden & neueste Datei laden' : 'Ordner verbinden'}</span>
          </button>
        </div>
      )}

      {/* B) Ordner im Browser (Chrome/Edge) */}
      {supportsFsAccess && (
        <div className="db-option">
          <div className="db-option-title"><Globe size={15} /> <span>Ordner im Browser freigeben</span></div>
          <p className="db-option-text">Chrome und Edge können den iCloud-Ordner direkt öffnen: einmal freigeben, danach werden Dateien ohne Server gelesen und geschrieben.</p>
          <button type="button" className="btn btn-secondary db-option-btn" onClick={handleConnectFs} disabled={isBusy}>
            {busy === 'fs' ? <RefreshCw size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            <span>Ordner auswählen & freigeben</span>
          </button>
        </div>
      )}

      {/* C) Dateien-App / Download */}
      <div className={`db-option ${!serverAvailable && !supportsFsAccess ? 'is-primary' : ''}`}>
        <div className="db-option-title"><Smartphone size={15} /> <span>{isIOS ? 'iPhone: Dateien-App' : 'Datei auswählen / Download'}</span></div>
        <p className="db-option-text">
          Zum Laden wählst du im iCloud-Ordner die neueste Datei aus – oder gleich mehrere, dann nimmt die App automatisch die neueste. Beim Speichern entsteht eine neue Datei {isIOS ? 'über „In Dateien sichern“ im Teilen-Menü – wähle dort deinen Ordner' : 'als Download (im Browser kann der Download-Ordner auf iCloud Drive gestellt werden)'}.
        </p>
        <div className="db-option-actions">
          <button type="button" className={serverAvailable || supportsFsAccess ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
            {busy === 'files' ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            <span>Neueste Datei auswählen</span>
          </button>
          {!confirmFresh ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmFresh(true)} disabled={isBusy}>
              {busy === 'fresh' ? <RefreshCw size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
              <span>Noch keine Datei – neu starten</span>
            </button>
          ) : null}
          <input ref={fileInputRef} type="file" multiple accept=".json,application/json" onChange={handleFilesChange} style={{ display: 'none' }} />
        </div>
        {confirmFresh && (
          <div className="inline-confirm is-block">
            <span>Ohne Datei starten? Liegen im iCloud-Ordner schon Dateien, wähle lieber die neueste aus – sonst fehlen hier deine bisherigen Daten (verloren gehen sie nicht).</span>
            <div className="inline-confirm-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={handleFresh}>Ja, neu starten</button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmFresh(false)}>Abbrechen</button>
            </div>
          </div>
        )}
      </div>

      {!serverAvailable && !isChecking && !isIOS && (
        <p className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.6rem' }}>
          <Info size={12} /> <span>Kein Mac-Server erreichbar. Über den Mac geöffnet (npm run dev) kann der Ordner auch direkt angebunden werden.</span>
        </p>
      )}
      {insecure && (
        <div className="inline-msg is-warning" style={{ marginTop: '0.6rem' }}>
          <AlertTriangle size={14} />
          <span>Diese Seite läuft ohne HTTPS. Teilen-Menü, Standort und Offline-Modus funktionieren erst in der veröffentlichten Version (z. B. auf Vercel) – Laden und Speichern per Datei klappt trotzdem.</span>
        </div>
      )}

      {result && (
        <div className={`inline-msg is-${result.type}`} style={{ marginTop: '0.75rem' }} role={result.type === 'error' ? 'alert' : 'status'}>
          {result.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{result.text}</span>
        </div>
      )}
    </div>
  );

  if (variant === 'modal') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Datenbank-Ordner">
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="db-setup-page">
      <div className="clean-card">{body}</div>
    </div>
  );
}
