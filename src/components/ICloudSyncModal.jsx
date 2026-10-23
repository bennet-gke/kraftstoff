import React, { useState, useRef } from 'react';
import { Cloud, Download, Upload, Check, AlertCircle, RefreshCw, X, FolderSync, Smartphone, Laptop } from 'lucide-react';
import { backupService } from '../services/backupService';

export default function ICloudSyncModal({
  isOpen,
  onClose,
  onSyncComplete,
}) {
  const [statusMessage, setStatusMessage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleExport = () => {
    try {
      backupService.downloadBackupFile('kraftstoff_daten.json');
      setStatusMessage({
        type: 'success',
        text: 'Datei "kraftstoff_daten.json" heruntergeladen! Lege sie einfach in deinen iCloud Drive Ordner.',
      });
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Export fehlgeschlagen: ${err.message}`,
      });
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
      }, 1800);
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
                iCloud Drive & Geräte-Sync
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Einfacher Dateiaustausch zwischen deinem Mac und iPhone
              </p>
            </div>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        {/* Kurzanleitung */}
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '0.85rem', marginBottom: '1.25rem', fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', color: '#0F172A', fontWeight: 700 }}>
            <FolderSync size={15} color="#0284C7" />
            <span>So funktioniert der iCloud-Sync:</span>
          </div>
          <ol style={{ paddingLeft: '1.2rem', margin: 0 }}>
            <li>Klicke auf <strong>„In iCloud sichern“</strong> und speichere die Datei <code>kraftstoff_daten.json</code> in deinem <em>iCloud Drive</em>.</li>
            <li>Öffne die App auf deinem anderen Gerät (z.B. iPhone) und klicke auf <strong>„Aus iCloud aktualisieren“</strong> – wähle dort einfach dieselbe Datei aus.</li>
          </ol>
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

        {/* Die beiden Hauptaktionen */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1.25rem' }}>
          
          {/* Export */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExport}
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
                kraftstoff_daten.json exportieren
              </span>
            </div>
          </button>

          {/* Import */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
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
                Datei aus iCloud Drive laden
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
          <span style={{ color: '#CBD5E1' }}>⟷ iCloud Drive ⟷</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Smartphone size={14} />
            <span>iPhone / iPad</span>
          </div>
        </div>

      </div>
    </div>
  );
}
