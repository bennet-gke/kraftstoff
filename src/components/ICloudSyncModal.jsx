import React, { useState, useRef, useEffect } from 'react';
import { Cloud, Download, Upload, Check, AlertCircle, RefreshCw, X, FolderSync, Smartphone, Laptop, CheckCircle2 } from 'lucide-react';
import { backupService, FIXED_ICLOUD_PATH } from '../services/backupService';

export default function ICloudSyncModal({
  isOpen,
  onClose,
  onSyncComplete,
}) {
  const [statusMessage, setStatusMessage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      backupService.checkServerStatus().then((status) => {
        setServerStatus(status);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 1-Klick Direkt-Export in festen iCloud-Pfad
  const handleExport = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await backupService.directSyncToICloud();
      if (res.method === 'direct-file') {
        setStatusMessage({
          type: 'success',
          text: `✓ Erfolgreich direkt in iCloud Drive gespeichert (${res.directPath})!`,
        });
      } else {
        backupService.downloadBackupFile('kraftstoff_daten.json');
        setStatusMessage({
          type: 'success',
          text: '✓ Datei "kraftstoff_daten.json" für iCloud Drive heruntergeladen.',
        });
      }
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Export fehlgeschlagen: ${err.message}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 1-Klick Direkt-Import aus festem iCloud-Pfad
  const handleImport = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await backupService.directSyncFromICloud();
      if (res.method === 'direct-file') {
        setStatusMessage({
          type: 'success',
          text: `✓ Erfolgreich aus iCloud Drive synchronisiert! (${res.locationCount} Standorte, ${res.vehicleCount} Autos & Einstellungen geladen)`,
        });
        if (onSyncComplete) {
          onSyncComplete(res.data);
        }
        setTimeout(() => {
          setStatusMessage(null);
          onClose();
        }, 1500);
        return;
      }
      // Fallback: Dateiauswahldialog öffnen
      fileInputRef.current?.click();
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `${err.message} Öffne Dateidialog...`,
      });
      fileInputRef.current?.click();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const result = await backupService.importBackupFile(file);
      setStatusMessage({
        type: 'success',
        text: `Erfolgreich synchronisiert! ${result.locationCount} Standorte, ${result.vehicleCount} Autos & Einstellungen übernommen.`,
      });

      if (onSyncComplete) {
        onSyncComplete(result.data);
      }

      setTimeout(() => {
        setStatusMessage(null);
        onClose();
      }, 1500);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err.message,
      });
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px' }}>
              <Cloud size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                iCloud Drive Direkt-Sync
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Automatischer Sync über die feste iCloud-Datei im Code
              </p>
            </div>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        {/* Fester Dateipfad im Code */}
        <div style={{
          background: '#0F172A',
          color: '#E2E8F0',
          borderRadius: '8px',
          padding: '0.75rem 0.95rem',
          marginBottom: '1rem',
          fontSize: '0.75rem',
          border: '1px solid #1E293B',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span style={{ color: '#94A3B8', fontSize: '0.68rem', textTransform: 'uppercase', fontWeight: 700 }}>
              Fester Speicherort im Code:
            </span>
            <span style={{ color: '#38BDF8', fontSize: '0.68rem', fontWeight: 700 }}>
              Immer aktiv
            </span>
          </div>
          <div style={{ fontFamily: 'monospace', color: '#38BDF8', wordBreak: 'break-all' }}>
            {FIXED_ICLOUD_PATH}
          </div>
          {serverStatus?.exists && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.4rem', color: '#4ADE80', fontSize: '0.72rem' }}>
              <CheckCircle2 size={13} />
              <span>Datei existiert und ist sofort synchronisierbar!</span>
            </div>
          )}
        </div>

        {/* Status Feedback */}
        {statusMessage && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '6px',
              fontSize: '0.78rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: statusMessage.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              color: statusMessage.type === 'success' ? '#065F46' : '#991B1B',
              border: `1px solid ${statusMessage.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            }}
          >
            {statusMessage.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Versteckter File Input */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".json,application/json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* Die beiden Hauptaktionen (1-Klick) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1.25rem' }}>
          
          {/* Export */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExport}
            disabled={isProcessing}
            style={{
              padding: '1rem 0.75rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              textAlign: 'center',
              borderRadius: '8px',
              border: '1px solid #CBD5E1',
            }}
          >
            <Download size={22} color="#0F172A" />
            <div>
              <strong style={{ display: 'block', fontSize: '0.85rem', color: '#0F172A', marginBottom: '0.15rem' }}>
                In iCloud sichern
              </strong>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Direkt in iCloud-Datei schreiben
              </span>
            </div>
          </button>

          {/* Import */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleImport}
            disabled={isProcessing}
            style={{
              padding: '1rem 0.75rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              textAlign: 'center',
              borderRadius: '8px',
            }}
          >
            <Upload size={22} color="#FFFFFF" />
            <div>
              <strong style={{ display: 'block', fontSize: '0.85rem', color: '#FFFFFF', marginBottom: '0.15rem' }}>
                {isProcessing ? 'Lese Datei...' : 'Aus iCloud aktualisieren'}
              </strong>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                Direkt aus iCloud-Datei lesen
              </span>
            </div>
          </button>

        </div>

        {/* Geräte-Visualisierung */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#94A3B8', fontSize: '0.74rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Laptop size={14} />
            <span>Mac</span>
          </div>
          <span style={{ color: '#CBD5E1' }}>⟷ Feste iCloud-Datei ⟷</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Smartphone size={14} />
            <span>iPhone / iPad</span>
          </div>
        </div>

      </div>
    </div>
  );
}

