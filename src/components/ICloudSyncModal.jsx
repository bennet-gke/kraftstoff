import React, { useEffect, useRef, useState } from 'react';
import { Database, Download, Upload, Check, AlertCircle, X, Smartphone, Laptop, CheckCircle2, ShieldCheck, RefreshCw, FolderOpen, Share2, FileJson, History } from 'lucide-react';
import { backupService, describeCounts, describeSaveResult, fmtWhen } from '../services/backupService';
import { importTankerkoenigFiles } from '../services/historyImport';
import { useEscapeToClose } from './modalHooks';

/**
 * Datenbank-Ordner: Status, neue Datei speichern, neueste Datei laden, Zugriffsart ändern.
 * Wird nur geöffnet gerendert.
 */
export default function ICloudSyncModal({ isOpen = true, onClose, onSyncComplete, dbStatus = null, onOpenDbSetup, stationIds = [], onHistoryImported }) {
  const [statusMessage, setStatusMessage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [files, setFiles] = useState([]);
  const [importState, setImportState] = useState(null); // { busy, text, type }
  const fileInputRef = useRef(null);
  const archiveInputRef = useRef(null);
  useEscapeToClose(isOpen, onClose);

  const refreshFiles = () => backupService.listFiles().then(setFiles).catch(() => {});

  useEffect(() => {
    let alive = true;
    backupService.listFiles().then((list) => {
      if (alive) setFiles(list);
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!isOpen) return null;

  const status = dbStatus || backupService.getStatus();
  const isManual = status.mode === 'manual';
  const isDirect = (status.mode === 'server' && status.serverAvailable !== false) || (status.mode === 'fs-access' && status.permission === 'granted');
  const fileCount = Number.isFinite(status.fileCount) && status.fileCount > 0 ? status.fileCount : files.length;

  const handleSave = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await backupService.saveToDatabase({ explicit: true });
      setStatusMessage({ type: res.success ? 'success' : 'error', text: describeSaveResult(res) });
      refreshFiles();
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Speichern fehlgeschlagen: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadNewest = async () => {
    if (isManual) {
      fileInputRef.current?.click();
      return;
    }
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await backupService.loadNewest();
      if (!res.success) {
        setStatusMessage({ type: 'error', text: res.message || 'Laden fehlgeschlagen.' });
        return;
      }
      if (res.loaded) {
        setStatusMessage({ type: 'success', text: `✓ Neueste Datei geladen (${res.fileName}): ${describeCounts(res)}, ${res.mergedReadings || 0} neue Messwerte${res.modelAdopted ? ', KI-Modell übernommen' : ''}.` });
        if (onSyncComplete) onSyncComplete(res);
      } else {
        setStatusMessage({ type: 'success', text: `✓ ${res.message || 'Im Ordner liegt noch keine Datei.'}` });
      }
      refreshFiles();
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Laden fehlgeschlagen: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFilesChange = async (e) => {
    const input = e.target;
    const picked = Array.from(input.files || []);
    if (picked.length === 0) return;
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await backupService.connectWithFiles(picked, { mode: 'manual' });
      setStatusMessage({ type: 'success', text: `✓ ${res.fileName} geladen: ${describeCounts(res)}, ${res.mergedReadings || 0} neue Messwerte${res.merged ? ' – Änderungen dieses Geräts wurden zusammengeführt' : ''}.` });
      if (onSyncComplete) onSyncComplete(res);
    } catch (err) {
      setStatusMessage({ type: 'error', text: err.message });
    } finally {
      setIsProcessing(false);
      input.value = '';
    }
  };

  const handleArchiveFiles = async (e) => {
    const input = e.target;
    const picked = Array.from(input.files || []).sort((a, b) => a.name.localeCompare(b.name));
    input.value = '';
    if (picked.length === 0) return;
    setImportState({ busy: true, type: 'info', text: `Lese ${picked.length} ${picked.length === 1 ? 'Datei' : 'Dateien'} …` });
    try {
      const res = await importTankerkoenigFiles(picked, {
        stationIds,
        onProgress: ({ fileIndex, fileCount, name }) => setImportState({ busy: true, type: 'info', text: `Lese Datei ${fileIndex + 1} von ${fileCount}: ${name}` }),
      });
      const text = res.points > 0
        ? `✓ ${res.points.toLocaleString('de-DE')} Messpunkte für ${res.stations} Tankstellen aus ${res.days} ${res.days === 1 ? 'Tag' : 'Tagen'} übernommen. Trends und Tankwart lernen sofort daraus.`
        : res.tooOld > 0
          ? 'Die Dateien sind älter als 28 Tage – so weit zurück speichert die App keine Historie.'
          : 'In den Dateien wurden keine Preise für Tankstellen gefunden, die die App kennt. Öffne zuerst das Radar für deine Region.';
      setImportState({ busy: false, type: res.points > 0 ? 'success' : 'warning', text });
      if (onHistoryImported) onHistoryImported(res);
    } catch (err) {
      setImportState({ busy: false, type: 'error', text: err.message });
    }
  };

  const badgeClass = isDirect ? 'is-ok' : isManual ? 'is-manual' : 'is-warn';
  const badgeText = isDirect || isManual ? status.modeLabel : status.mode ? `${status.modeLabel} – getrennt` : 'Nicht verbunden';
  const saveLabel = isManual ? (status.exportMethod === 'share' ? 'Datei sichern (Teilen)' : 'Datei herunterladen') : 'Neue Datei speichern';
  const saveHint = isManual ? 'Aktueller Stand als neue Datei mit Zeitstempel' : 'Aktueller Stand als neue Datei im Ordner';
  const loadLabel = isManual ? 'Neueste Datei auswählen' : 'Neueste Datei laden';
  const loadHint = isManual ? 'Aus der Dateien-App (mehrere erlaubt)' : 'Stand des anderen Geräts holen';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Datenbank">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div className="modal-head-icon">
              <Database size={17} />
            </div>
            <div>
              <h3>Datenbank</h3>
              <p>Jedes Speichern = neue Datei mit Zeitstempel, Laden = neueste Datei</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className="db-status-card">
          <div className="db-status-card-head">
            <span>Speicherort</span>
            <span className={`db-status-badge ${badgeClass}`}>{badgeText}</span>
          </div>
          <div className="db-status-path">
            {status.mode === 'server' ? status.dir : status.mode === 'fs-access' ? `Ordner „${status.dir}“` : isManual ? 'Dein iCloud-Ordner in der Dateien-App' : 'Kein Ordner festgelegt'}
          </div>
          <div className="db-status-lines">
            <span>
              <ShieldCheck size={13} color="#38BDF8" />
              <span>Enthält API-Key, Fahrzeuge, Orte, Routen, Einstellungen, Preishistorie (14 Tage) und KI-Modell.</span>
            </span>
            {status.currentName ? (
              <span className="is-ok">
                <CheckCircle2 size={13} />
                <span>Stand: {status.currentName}{status.currentAt ? ` (${fmtWhen(status.currentAt)}, ${status.currentSource === 'save' ? 'gespeichert' : 'geladen'})` : ''}{fileCount > 1 ? ` • ${fileCount} Dateien im Ordner` : ''}.</span>
              </span>
            ) : (
              <span>
                <FileJson size={13} />
                <span>Noch keine Datei – die erste entsteht beim ersten Speichern.</span>
              </span>
            )}
            {status.unsavedSince && (
              <span className="is-warn">
                <AlertCircle size={13} />
                <span>Änderungen seit {fmtWhen(status.unsavedSince)} noch nicht als Datei gesichert.</span>
              </span>
            )}
            {status.mode === 'server' && status.serverAvailable === false && (
              <span className="is-warn">
                <AlertCircle size={13} />
                <span>Mac-Server gerade nicht erreichbar – Änderungen bleiben lokal, bis wieder gespeichert werden kann.</span>
              </span>
            )}
            {status.mode === 'fs-access' && status.permission !== 'granted' && (
              <span className="is-warn">
                <AlertCircle size={13} />
                <span>Ordnerzugriff nach dem Neustart noch nicht freigegeben – „Neueste Datei laden“ fragt die Freigabe ab.</span>
              </span>
            )}
          </div>
          {onOpenDbSetup && (
            <button type="button" className="db-status-change" onClick={onOpenDbSetup}>
              <FolderOpen size={12} />
              <span>Ordner / Zugriffsart ändern</span>
            </button>
          )}
        </div>

        {statusMessage && (
          <div className={`inline-msg is-${statusMessage.type}`} style={{ marginBottom: '0.9rem' }} role={statusMessage.type === 'error' ? 'alert' : 'status'}>
            {statusMessage.type === 'success' ? <Check size={15} /> : <AlertCircle size={15} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <input type="file" ref={fileInputRef} multiple accept=".json,application/json" onChange={handleFilesChange} style={{ display: 'none' }} />

        <div className="db-actions">
          <button type="button" className="db-action" onClick={handleSave} disabled={isProcessing || status.isSaving}>
            {isProcessing || status.isSaving ? <RefreshCw size={22} className="animate-spin" /> : isManual && status.exportMethod === 'share' ? <Share2 size={22} /> : <Download size={22} />}
            <strong>{saveLabel}</strong>
            <span>{saveHint}</span>
          </button>
          <button type="button" className="db-action is-dark" onClick={handleLoadNewest} disabled={isProcessing}>
            {isProcessing ? <RefreshCw size={22} className="animate-spin" /> : <Upload size={22} />}
            <strong>{loadLabel}</strong>
            <span>{loadHint}</span>
          </button>
        </div>

        {isManual && (
          <div className="db-export-choice">
            <span>Beim Speichern:</span>
            <label>
              <input type="radio" name="exportMethod" checked={status.exportMethod === 'share'} onChange={() => backupService.setExportMethod('share')} />
              <span>Teilen-Menü („In Dateien sichern“)</span>
            </label>
            <label>
              <input type="radio" name="exportMethod" checked={status.exportMethod !== 'share'} onChange={() => backupService.setExportMethod('download')} />
              <span>Download</span>
            </label>
          </div>
        )}

        {!isManual && files.length > 0 && (
          <div className="db-file-list">
            <div className="db-file-list-head">Dateien im Ordner (neueste zuerst)</div>
            {files.slice(0, 5).map((f) => (
              <span key={f.name}>
                <FileJson size={11} color="#64748B" />
                <span className="db-file-name">{f.name}</span>
                <span className="db-file-meta">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''}</span>
              </span>
            ))}
            {fileCount > 5 && <span className="db-file-meta">… und {fileCount - 5} weitere</span>}
          </div>
        )}

        <div className="history-import">
          <div className="history-import-head">
            <History size={15} />
            <strong>Tankerkönig-Archiv importieren</strong>
          </div>
          <p>
            Die kostenlose Tankerkönig-Schnittstelle liefert nur aktuelle Preise. Das Archiv mit allen Preisänderungen gibt es als Tagesdateien (<code>JJJJ-MM-TT-prices.csv</code>) nur für registrierte, geprüfte Nutzer – Anmeldung über onboarding.tankerkoenig.de. Hast du die Dateien, lernen Trends und Tankwart sofort aus bis zu 28 Tagen. Importiert werden nur Tankstellen, die die App schon kennt.
          </p>
          <input ref={archiveInputRef} type="file" multiple accept=".csv,text/csv" onChange={handleArchiveFiles} style={{ display: 'none' }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => archiveInputRef.current?.click()} disabled={importState?.busy}>
            {importState?.busy ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
            <span>Tagesdateien auswählen</span>
          </button>
          {importState && (
            <div className={`inline-msg is-${importState.type}`} style={{ marginTop: '0.5rem' }} role="status">
              {importState.busy ? <RefreshCw size={14} className="animate-spin" /> : importState.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              <span>{importState.text}</span>
            </div>
          )}
        </div>

        <div className="db-footnote">
          <span><Laptop size={13} /> Mac: speichert automatisch</span>
          <span><Smartphone size={13} /> iPhone: Speichern = Teilen/Download, Laden = Dateien-App</span>
        </div>
      </div>
    </div>
  );
}
