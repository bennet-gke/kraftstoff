import React, { useRef, useState } from 'react';
import { Cloud, Upload, Download, Share2, RefreshCw, FolderOpen, AlertCircle } from 'lucide-react';
import { backupService, fmtWhen } from '../services/backupService';

/**
 * Schmale Statusleiste unter dem Header:
 *  - Mac-Server getrennt / Ordnerfreigabe fehlt / letztes Speichern fehlgeschlagen (gelb)
 *  - manueller Modus (Dateien-App): zuletzt geladene Datei, "Neueste Datei laden", "Jetzt sichern"
 */
export default function DatabaseStatusBanner({ status, onSaveNow, onReconnect, onLoaded, onError }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  if (!status?.isConnected) return null;

  const isManual = status.mode === 'manual';
  const serverDown = status.mode === 'server' && status.serverAvailable === false;
  const needsPermission = status.mode === 'fs-access' && status.permission !== 'granted';
  const lastFailed = status.lastSaveResult && status.lastSaveResult.success === false && status.lastSaveResult.method !== 'cancelled';
  const unsaved = !!status.unsavedSince;
  const saving = !!status.isSaving;

  if (!isManual && !serverDown && !needsPermission && !lastFailed && !unsaved) return null;

  const handleFiles = async (e) => {
    const input = e.target;
    const picked = Array.from(input.files || []);
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const res = await backupService.connectWithFiles(picked, { mode: 'manual' });
      if (onLoaded) onLoaded(res);
    } catch (err) {
      if (onError) onError(err.message);
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  const warn = serverDown || needsPermission || lastFailed || unsaved;

  let text;
  if (serverDown) text = `Mac-Server nicht erreichbar – lokale Kopie aktiv.${unsaved ? ` Ungesichert seit ${fmtWhen(status.unsavedSince)}.` : ''}`;
  else if (needsPermission) text = 'Ordnerzugriff einmal freigeben, damit die neueste Datei geladen und gespeichert werden kann.';
  else if (isManual) {
    text = status.currentName
      ? `Stand: ${status.currentName}${status.currentAt ? ` (${fmtWhen(status.currentAt)}, ${status.currentSource === 'save' ? 'gespeichert' : 'geladen'})` : ''}.`
      : 'Noch keine Datenbank-Datei – die erste entsteht beim ersten Sichern.';
    if (unsaved) text += ` Ungesichert seit ${fmtWhen(status.unsavedSince)}.`;
  } else if (lastFailed) text = `Speichern fehlgeschlagen: ${status.lastSaveResult.message || 'unbekannter Fehler'}.`;
  else text = `Änderungen seit ${fmtWhen(status.unsavedSince)} noch nicht als Datei gesichert.`;

  return (
    <div className={`db-banner ${warn ? 'is-warn' : ''}`} role="status">
      <span className="db-banner-text">
        {warn ? <AlertCircle size={14} /> : <Cloud size={14} />}
        <span>{text}</span>
      </span>
      <span className="db-banner-actions">
        {(serverDown || needsPermission) && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onReconnect}>
            {needsPermission ? <FolderOpen size={12} /> : <RefreshCw size={12} />}
            <span>{needsPermission ? 'Freigeben' : 'Neu verbinden'}</span>
          </button>
        )}
        {isManual && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
            <span>Neueste laden</span>
          </button>
        )}
        {(unsaved || lastFailed) && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onSaveNow} disabled={saving}>
            {saving ? <RefreshCw size={12} className="animate-spin" /> : isManual && status.exportMethod === 'share' ? <Share2 size={12} /> : <Download size={12} />}
            <span>{saving ? 'Sichere …' : isManual ? 'Jetzt sichern' : 'Erneut speichern'}</span>
          </button>
        )}
        <input ref={fileInputRef} type="file" multiple accept=".json,application/json" onChange={handleFiles} style={{ display: 'none' }} />
      </span>
    </div>
  );
}
