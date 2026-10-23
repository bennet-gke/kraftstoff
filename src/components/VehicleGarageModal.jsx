import React, { useState } from 'react';
import { Car, Plus, Trash2, X, Check, Fuel, Gauge, Sliders, Download } from 'lucide-react';
import { vehicleService } from '../services/vehicleService';
import { backupService } from '../services/backupService';

export default function VehicleGarageModal({
  isOpen,
  onClose,
  vehicles = [],
  activeVehicleId,
  onSelectActiveVehicle,
  onUpdateVehicles,
}) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [fuelType, setFuelType] = useState('diesel');
  const [consumption, setConsumption] = useState('5.8');
  const [tankCapacity, setTankCapacity] = useState('50');
  const [fuelLevelPct, setFuelLevelPct] = useState('20');
  const [isAdding, setIsAdding] = useState(false);
  const [autoSyncICloud, setAutoSyncICloud] = useState(true);
  const [feedbackToast, setFeedbackToast] = useState(null);

  if (!isOpen) return null;

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name) return;

    const newV = vehicleService.addVehicle({
      name,
      brand,
      fuelType,
      consumptionL100km: parseFloat(consumption),
      tankCapacityL: parseFloat(tankCapacity),
      currentFuelLevelPct: parseFloat(fuelLevelPct),
    });

    onUpdateVehicles(vehicleService.vehicles);
    onSelectActiveVehicle(newV.id);
    setName('');
    setIsAdding(false);

    if (autoSyncICloud) {
      setTimeout(async () => {
        try {
          const res = await backupService.directSyncToICloud();
          setFeedbackToast(res.method === 'direct-file' ? '✓ Gespeichert & direkt in iCloud Drive synchronisiert!' : '✓ Fahrzeug gespeichert & Datei für iCloud erzeugt!');
        } catch {
          setFeedbackToast('✓ Fahrzeug lokal gespeichert!');
        }
        setTimeout(() => setFeedbackToast(null), 4000);
      }, 100);
    } else {
      setFeedbackToast('✓ Fahrzeug gespeichert!');
      setTimeout(() => setFeedbackToast(null), 3000);
    }
  };

  const handleDelete = (id) => {
    const updated = vehicleService.deleteVehicle(id);
    onUpdateVehicles(updated);
    if (autoSyncICloud) {
      setTimeout(() => backupService.directSyncToICloud(), 100);
    }
  };

  const handleUpdateFuelLevel = (id, pct) => {
    const updated = vehicleService.updateVehicle(id, { currentFuelLevelPct: pct });
    onUpdateVehicles(updated);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px' }}>
              <Car size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                Fahrzeug-Garage & Verbrauchsprofile
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Berechnung der exakten Tankmenge und Umweg-Rentabilität
              </p>
            </div>
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
            <X size={20} />
          </button>
        </div>

        {/* Fahrzeugliste */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.25rem' }}>
          {vehicles.map((v) => {
            const isActive = v.id === activeVehicleId;
            const neededLiters = vehicleService.getNeededLiters(v);

            return (
              <div
                key={v.id}
                style={{
                  border: `1px solid ${isActive ? '#0F172A' : '#E2E8F0'}`,
                  borderRadius: '10px',
                  padding: '1rem',
                  background: isActive ? '#FAFAFA' : '#FFFFFF',
                  boxShadow: isActive ? '0 2px 6px rgba(15,23,42,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0F172A' }}>
                        {v.name}
                      </span>
                      <span className="badge badge-gray" style={{ fontSize: '0.68rem', textTransform: 'uppercase' }}>
                        {v.fuelType}
                      </span>
                      {isActive && (
                        <span className="badge badge-favorable" style={{ fontSize: '0.68rem' }}>
                          <Check size={10} />
                          <span>Aktiv</span>
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.2rem' }}>
                      Verbrauch: <strong>{v.consumptionL100km} L/100km</strong> • Tankgröße: <strong>{v.tankCapacityL} Liter</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {!isActive && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onSelectActiveVehicle(v.id)}
                      >
                        Auswählen
                      </button>
                    )}
                    {vehicles.length > 1 && (
                      <button
                        onClick={() => handleDelete(v.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.3rem' }}
                        title="Fahrzeug löschen"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tankfüllstand-Schieberegler für dieses Fahrzeug */}
                <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: '8px', padding: '0.6rem 0.8rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem', color: '#475569', marginBottom: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Gauge size={12} color="#0F172A" />
                      <span>Aktueller Tankstand: <strong>{v.currentFuelLevelPct || 20}%</strong></span>
                    </div>
                    <span style={{ color: '#059669', fontWeight: 700 }}>
                      Benötigte Tankmenge: {neededLiters} L
                    </span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="90"
                    step="5"
                    value={v.currentFuelLevelPct || 20}
                    onChange={(e) => handleUpdateFuelLevel(v.id, parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: '#0F172A' }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Neues Auto anlegen Formular */}
        {isAdding ? (
          <form onSubmit={handleCreate} style={{ borderTop: '1px solid #F1F5F9', paddingTop: '1rem' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.75rem' }}>
              Neues Fahrzeug hinzufügen
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
              <input
                type="text"
                placeholder="Modell (z.B. VW Passat TDI)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                required
              />
              <select
                value={fuelType}
                onChange={(e) => setFuelType(e.target.value)}
                style={{ padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem', background: '#FFFFFF' }}
              >
                <option value="diesel">Diesel</option>
                <option value="e10">Super E10</option>
                <option value="e5">Super E5</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginBottom: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.15rem' }}>Verbrauch (L/100km):</label>
                <input
                  type="number"
                  step="0.1"
                  value={consumption}
                  onChange={(e) => setConsumption(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.15rem' }}>Tankvolumen (L):</label>
                <input
                  type="number"
                  step="1"
                  value={tankCapacity}
                  onChange={(e) => setTankCapacity(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748B', marginBottom: '0.15rem' }}>Reststand (%):</label>
                <input
                  type="number"
                  step="5"
                  min="0"
                  max="100"
                  value={fuelLevelPct}
                  onChange={(e) => setFuelLevelPct(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '0.8rem' }}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.74rem', color: '#475569', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoSyncICloud}
                  onChange={(e) => setAutoSyncICloud(e.target.checked)}
                  style={{ accentColor: '#0F172A' }}
                />
                <span>Automatisch in iCloud-Datei sichern (kraftstoff_daten.json)</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsAdding(false)}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Fahrzeug speichern
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setIsAdding(true)}
            style={{ width: '100%' }}
          >
            <Plus size={14} />
            <span>Weiteres Fahrzeug anlegen</span>
          </button>
        )}

        {/* Feedback Toast */}
        {feedbackToast && (
          <div
            style={{
              marginTop: '0.85rem',
              padding: '0.55rem 0.85rem',
              borderRadius: '6px',
              fontSize: '0.76rem',
              background: '#ECFDF5',
              color: '#065F46',
              border: '1px solid #A7F3D0',
              fontWeight: 600,
            }}
          >
            {feedbackToast}
          </div>
        )}

        {/* iCloud Sync Fußleiste */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #F1F5F9', paddingTop: '0.85rem', marginTop: '1.25rem', fontSize: '0.74rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              try {
                const res = await backupService.directSyncToICloud();
                alert(res.method === 'direct-file' ? `✓ In iCloud Drive gespeichert (${res.directPath})!` : '✓ Datei "kraftstoff_daten.json" erzeugt!');
              } catch (e) {
                alert(`Fehler: ${e.message}`);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <Download size={13} color="#059669" />
            <span>Jetzt in iCloud-Datei sichern</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Schließen
          </button>
        </div>

      </div>
    </div>
  );
}
