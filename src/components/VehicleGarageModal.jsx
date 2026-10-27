import React, { useState } from 'react';
import { Car, Plus, Trash2, X, Check, Gauge, Download, Pencil, AlertCircle, CheckCircle2 } from 'lucide-react';
import { vehicleService } from '../services/vehicleService';
import { backupService, describeSaveResult } from '../services/backupService';
import { neededLitersFor, rangeKmFor, num } from '../engine/vehicleMath';
import { fmtNum, fuelLabel } from '../utils/format';
import { useEscapeToClose } from './modalHooks';

const FUEL_OPTIONS = [
  { id: 'diesel', label: 'Diesel' },
  { id: 'e10', label: 'Super E10' },
  { id: 'e5', label: 'Super E5' },
];

/** Eingaben prüfen und in Zahlen umwandeln (Komma erlaubt). */
function parseVehicleForm(form) {
  const name = String(form.name || '').trim();
  const consumption = num(String(form.consumption).replace(',', '.'), NaN);
  const tank = num(String(form.tank).replace(',', '.'), NaN);
  if (!name) return { error: 'Bitte einen Namen eingeben.' };
  if (!Number.isFinite(consumption) || consumption < 2 || consumption > 30) return { error: 'Verbrauch bitte zwischen 2 und 30 L/100 km angeben.' };
  if (!Number.isFinite(tank) || tank < 10 || tank > 200) return { error: 'Tankgröße bitte zwischen 10 und 200 Litern angeben.' };
  return {
    data: {
      name: name.slice(0, 60),
      brand: name.split(' ')[0] || 'Auto',
      fuelType: form.fuelType,
      consumptionL100km: Math.round(consumption * 10) / 10,
      tankCapacityL: Math.round(tank),
    },
  };
}

function VehicleForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const res = parseVehicleForm(form);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    onSubmit(res.data);
  };

  return (
    <form className="vehicle-form" onSubmit={submit}>
      <div className="field">
        <label className="field-label">Name</label>
        <input className="text-input" type="text" value={form.name} onChange={set('name')} placeholder="z. B. Skoda Octavia" maxLength={60} autoFocus />
      </div>
      <div className="field">
        <span className="field-label">Kraftstoff</span>
        <div className="segmented is-wide" role="group" aria-label="Kraftstoff">
          {FUEL_OPTIONS.map((f) => (
            <button key={f.id} type="button" className={form.fuelType === f.id ? 'active' : ''} onClick={() => setForm((x) => ({ ...x, fuelType: f.id }))} aria-pressed={form.fuelType === f.id}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label className="field-label">Verbrauch (L/100 km)</label>
          <input className="text-input" inputMode="decimal" value={form.consumption} onChange={set('consumption')} placeholder="6,0" />
        </div>
        <div className="field">
          <label className="field-label">Tankgröße (L)</label>
          <input className="text-input" inputMode="numeric" value={form.tank} onChange={set('tank')} placeholder="50" />
        </div>
      </div>
      {error && (
        <div className="inline-msg is-error" role="alert">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      <div className="drawer-actions">
        <button type="submit" className="btn btn-primary btn-sm">
          <Check size={13} />
          <span>{submitLabel}</span>
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Garage: Fahrzeuge anlegen und bearbeiten, Tankstand einstellen (daraus ergeben sich Tankmenge und Reichweite).
 */
export default function VehicleGarageModal({ isOpen, onClose, vehicles = [], activeVehicleId, onSelectActiveVehicle, onUpdateVehicles }) {
  const [editingId, setEditingId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [msg, setMsg] = useState(null);
  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const handleCreate = (data) => {
    const newV = vehicleService.addVehicle({ ...data, currentFuelLevelPct: 25 });
    onUpdateVehicles(vehicleService.vehicles);
    onSelectActiveVehicle(newV.id);
    setIsAdding(false);
    setMsg({ type: 'success', text: `✓ „${newV.name}“ angelegt und ausgewählt. Stelle jetzt den Tankstand ein.` });
  };

  const handleEdit = (v, data) => {
    const updated = vehicleService.updateVehicle(v.id, data);
    onUpdateVehicles(updated);
    setEditingId(null);
    // Kraftstoff des aktiven Fahrzeugs geändert: Radar auf die neue Sorte umstellen
    if (v.id === activeVehicleId && data.fuelType !== v.fuelType) onSelectActiveVehicle(v.id);
  };

  const handleDelete = (id) => {
    const updated = vehicleService.deleteVehicle(id);
    onUpdateVehicles(updated);
    setConfirmDeleteId(null);
  };

  const handleFuelLevel = (id, pct) => {
    onUpdateVehicles(vehicleService.updateVehicle(id, { currentFuelLevelPct: pct }));
  };

  const handleSaveFile = async () => {
    try {
      const res = await backupService.saveToDatabase({ explicit: true });
      setMsg({ type: res.success ? 'success' : 'error', text: describeSaveResult(res) });
    } catch (e) {
      setMsg({ type: 'error', text: `Speichern fehlgeschlagen: ${e.message}` });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Garage">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div className="modal-head-icon">
              <Car size={16} />
            </div>
            <div>
              <h3>Garage</h3>
              <p>Verbrauch und Tankstand bestimmen Tankmenge, Reichweite und Umweg-Rechnung</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className="manage-list">
          {vehicles.map((v) => {
            const isActive = v.id === activeVehicleId;
            const level = Math.min(100, Math.max(0, num(v.currentFuelLevelPct, 20)));
            const liters = Math.round(neededLitersFor(v));
            const range = rangeKmFor(v);

            if (editingId === v.id) {
              return (
                <div key={v.id} className="manage-item is-active">
                  <VehicleForm
                    initial={{ name: v.name, fuelType: v.fuelType || 'diesel', consumption: fmtNum(v.consumptionL100km, 1), tank: String(v.tankCapacityL) }}
                    submitLabel="Speichern"
                    onSubmit={(data) => handleEdit(v, data)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              );
            }

            return (
              <div key={v.id} className={`manage-item ${isActive ? 'is-active' : ''}`}>
                <div className="manage-item-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="manage-item-title">
                      <span>{v.name}</span>
                      <span className="badge badge-gray" style={{ fontSize: '0.64rem', padding: '0.1rem 0.45rem' }}>{fuelLabel(v.fuelType)}</span>
                      {isActive && (
                        <span className="badge badge-favorable" style={{ fontSize: '0.64rem', padding: '0.1rem 0.45rem' }}>
                          <Check size={10} /> Aktiv
                        </span>
                      )}
                    </div>
                    <div className="manage-item-sub">
                      {fmtNum(v.consumptionL100km, 1)} L/100 km • {v.tankCapacityL} L Tank
                    </div>
                  </div>
                  <div className="manage-item-actions">
                    {!isActive && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelectActiveVehicle(v.id)}>
                        Auswählen
                      </button>
                    )}
                    <button type="button" className="icon-btn" onClick={() => { setEditingId(v.id); setIsAdding(false); }} aria-label={`${v.name} bearbeiten`} title="Bearbeiten">
                      <Pencil size={14} />
                    </button>
                    {vehicles.length > 1 && (
                      <button type="button" className="icon-btn is-danger" onClick={() => setConfirmDeleteId(v.id)} aria-label={`${v.name} löschen`} title="Löschen">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {confirmDeleteId === v.id && (
                  <div className="inline-confirm">
                    <span>„{v.name}“ löschen?</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(v.id)}>Löschen</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(null)}>Abbrechen</button>
                  </div>
                )}

                <div className="fuel-level">
                  <div className="fuel-level-head">
                    <span><Gauge size={13} /> Tankstand</span>
                    <strong className="num-mono">{Math.round(level)} %</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={level}
                    onChange={(e) => handleFuelLevel(v.id, parseInt(e.target.value, 10))}
                    aria-label={`Tankstand ${v.name}`}
                    style={{ '--fill': `${level}%` }}
                  />
                  <div className="fuel-level-figures">
                    <span>Bis voll: <strong className="num-mono">{liters} L</strong></span>
                    <span>Reichweite: <strong className="num-mono">~{range} km</strong></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {isAdding ? (
          <div className="form-section">
            <h4>Neues Fahrzeug</h4>
            <VehicleForm initial={{ name: '', fuelType: 'diesel', consumption: '6,0', tank: '50' }} submitLabel="Fahrzeug anlegen" onSubmit={handleCreate} onCancel={() => setIsAdding(false)} />
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm drawer-wide-btn" onClick={() => { setIsAdding(true); setEditingId(null); }}>
            <Plus size={14} />
            <span>Fahrzeug hinzufügen</span>
          </button>
        )}

        {msg && (
          <div className={`inline-msg is-${msg.type}`} style={{ marginTop: '0.75rem' }} role="status">
            {msg.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
            <span>{msg.text}</span>
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleSaveFile}>
            <Download size={13} color="#059669" />
            <span>Jetzt in Datei sichern</span>
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
