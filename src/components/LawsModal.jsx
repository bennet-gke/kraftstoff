import React, { useState } from 'react';
import { Scale, Plus, Trash2, X, Check, Pencil, AlertCircle, CheckCircle2, Download, ExternalLink, RotateCcw, Clock, CalendarDays } from 'lucide-react';
import { lawService } from '../services/lawService';
import { backupService, describeSaveResult } from '../services/backupService';
import {
  LAW_FUELS,
  LAW_KIND_LABELS,
  KPANG_LAW_ID,
  compileRules,
  describeRuleState,
  describeLawEffect,
  lawStatus,
  normalizeLaw,
} from '../engine/priceRules';
import { fuelLabel } from '../utils/format';
import { useEscapeToClose } from './modalHooks';
import { useNow } from './chartHooks';

const STATUS_BADGE = {
  active: 'badge-favorable',
  upcoming: 'badge-blue',
  expired: 'badge-gray',
  off: 'badge-gray',
};

const EMPTY_FORM = {
  name: '',
  kind: 'increase-times',
  times: ['12:00'],
  toleranceMin: '10',
  stepCt: '',
  validFrom: '',
  validUntil: '',
  fuels: [...LAW_FUELS],
  note: '',
  source: '',
};

function formFromLaw(law) {
  return {
    name: law.name,
    kind: law.kind,
    times: law.times.length ? [...law.times] : ['12:00'],
    toleranceMin: String(law.toleranceMin ?? 10),
    stepCt: law.kind === 'price-step' ? String(law.stepCt).replace('.', ',') : '',
    validFrom: law.validFrom,
    validUntil: law.validUntil,
    fuels: [...law.fuels],
    note: law.note,
    source: law.source,
  };
}

/** Eingaben prüfen und in einen Regel-Eintrag umwandeln (Komma erlaubt). */
function parseLawForm(form) {
  const name = String(form.name || '').trim();
  if (!name) return { error: 'Bitte einen Namen eingeben, z. B. „12-Uhr-Regel“.' };
  if (form.fuels.length === 0) return { error: 'Bitte mindestens eine Sorte auswählen.' };
  if (form.validFrom && form.validUntil && form.validUntil < form.validFrom) return { error: '„Gilt bis“ liegt vor „Gilt ab“.' };
  const source = String(form.source || '').trim();
  if (source && !/^https?:\/\/\S+$/i.test(source)) return { error: 'Die Quelle bitte als Link mit https:// angeben.' };
  const base = { name, kind: form.kind, validFrom: form.validFrom, validUntil: form.validUntil, fuels: form.fuels, note: form.note, source };
  if (form.kind === 'increase-times') {
    const times = form.times.map((t) => String(t || '').trim()).filter(Boolean);
    if (times.length === 0) return { error: 'Bitte mindestens eine Uhrzeit für erlaubte Erhöhungen angeben.' };
    const tol = Number(String(form.toleranceMin).replace(',', '.'));
    if (!Number.isFinite(tol) || tol < 0 || tol > 60) return { error: 'Die Toleranz bitte zwischen 0 und 60 Minuten angeben.' };
    return { data: { ...base, times, toleranceMin: Math.round(tol) } };
  }
  const step = Number(String(form.stepCt).replace(',', '.').replace('−', '-'));
  if (!Number.isFinite(step) || step === 0 || Math.abs(step) > 100) return { error: 'Bitte die Preisänderung in ct/L angeben (z. B. 3 oder -14,5).' };
  if (!form.validFrom) return { error: 'Bitte den Stichtag („Gilt ab“) angeben.' };
  return { data: { ...base, stepCt: step } };
}

function LawForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setTime = (i, value) => setForm((f) => ({ ...f, times: f.times.map((t, j) => (j === i ? value : t)) }));
  const toggleFuel = (fuel) => setForm((f) => ({ ...f, fuels: f.fuels.includes(fuel) ? f.fuels.filter((x) => x !== fuel) : [...f.fuels, fuel] }));

  const submit = (e) => {
    e.preventDefault();
    const res = parseLawForm(form);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError(null);
    onSubmit(res.data);
  };

  return (
    <form className="vehicle-form law-form" onSubmit={submit}>
      <div className="field">
        <label className="field-label">Name</label>
        <input className="text-input" type="text" value={form.name} onChange={set('name')} placeholder="z. B. 12-Uhr-Regel oder CO₂-Preis 2027" maxLength={80} />
      </div>

      <div className="field">
        <span className="field-label">Art der Regel</span>
        <div className="segmented is-wide" role="group" aria-label="Art der Regel">
          {Object.entries(LAW_KIND_LABELS).map(([id, label]) => (
            <button key={id} type="button" className={form.kind === id ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, kind: id }))} aria-pressed={form.kind === id}>
              {label}
            </button>
          ))}
        </div>
        <span className="field-hint">
          {form.kind === 'increase-times'
            ? 'Tankstellen dürfen nur zu diesen Uhrzeiten erhöhen, senken jederzeit (wie die 12-Uhr-Regel).'
            : 'Ab dem Stichtag ändert sich der Preis um einen festen Betrag – z. B. Steuer, CO₂-Preis oder ein befristeter Rabatt.'}
        </span>
      </div>

      {form.kind === 'increase-times' ? (
        <>
          <div className="field">
            <span className="field-label">Erlaubte Erhöhungen um</span>
            <div className="law-times">
              {form.times.map((t, i) => (
                <div key={i} className="law-time">
                  <input className="text-input" type="time" value={t} onChange={(e) => setTime(i, e.target.value)} aria-label={`Uhrzeit ${i + 1}`} />
                  {form.times.length > 1 && (
                    <button type="button" className="icon-btn is-danger" onClick={() => setForm((f) => ({ ...f, times: f.times.filter((_, j) => j !== i) }))} aria-label="Uhrzeit entfernen">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {form.times.length < 6 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm((f) => ({ ...f, times: [...f.times, '18:00'] }))}>
                  <Plus size={13} />
                  <span>Uhrzeit</span>
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label className="field-label">Toleranz (Minuten)</label>
            <input className="text-input" inputMode="numeric" value={form.toleranceMin} onChange={set('toleranceMin')} placeholder="10" style={{ maxWidth: '8rem' }} />
            <span className="field-hint">Erhöhungen kurz vor oder nach der Uhrzeit (Meldeverzug) gelten noch als erlaubt.</span>
          </div>
        </>
      ) : (
        <div className="field">
          <label className="field-label">Preisänderung (ct/L)</label>
          <input className="text-input" inputMode="decimal" value={form.stepCt} onChange={set('stepCt')} placeholder="z. B. 3 oder -14,5" style={{ maxWidth: '10rem' }} />
          <span className="field-hint">Plus = teurer, Minus = günstiger. Mit „Gilt bis“ entfällt die Änderung danach wieder.</span>
        </div>
      )}

      <div className="form-row">
        <div className="field">
          <label className="field-label">{form.kind === 'price-step' ? 'Gilt ab (Stichtag)' : 'Gilt ab'}</label>
          <input className="text-input" type="date" value={form.validFrom} onChange={set('validFrom')} />
        </div>
        <div className="field">
          <label className="field-label">Gilt bis (optional)</label>
          <input className="text-input" type="date" value={form.validUntil} onChange={set('validUntil')} />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Gilt für</span>
        <div className="law-fuels" role="group" aria-label="Sorten">
          {LAW_FUELS.map((f) => (
            <button key={f} type="button" className={`law-fuel-chip ${form.fuels.includes(f) ? 'is-on' : ''}`} onClick={() => toggleFuel(f)} aria-pressed={form.fuels.includes(f)}>
              {form.fuels.includes(f) && <Check size={12} />}
              {fuelLabel(f)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Notiz (optional)</label>
        <textarea className="text-input law-note-input" rows={3} value={form.note} onChange={set('note')} maxLength={600} placeholder="Was regelt das Gesetz? Woher stammt die Information?" />
      </div>
      <div className="field">
        <label className="field-label">Quelle (optional)</label>
        <input className="text-input" type="url" inputMode="url" value={form.source} onChange={set('source')} placeholder="https://…" />
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
 * Gesetze & Regeln: gesetzliche Rahmenbedingungen speichern, ein- und ausschalten, ändern und ergänzen.
 * Aktive Einträge begrenzen Prognosen und Tankwart-Empfehlungen; die Mechaniken selbst bleiben gleich.
 */
export default function LawsModal({ isOpen, onClose, laws = [], onUpdateLaws, fuelType = 'diesel' }) {
  const [editingId, setEditingId] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [msg, setMsg] = useState(null);
  const now = useNow(30000, laws);
  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const ruleState = describeRuleState(compileRules(laws, fuelType), now);
  const activeCount = laws.filter((l) => lawStatus(l, now).state === 'active').length;
  const hasTemplate = laws.some((l) => l.id === KPANG_LAW_ID);

  const handleToggle = (law) => {
    onUpdateLaws(lawService.setEnabled(law.id, !law.enabled));
    setMsg(null);
  };

  const handleCreate = (data) => {
    const law = lawService.addLaw({ ...data, enabled: true });
    onUpdateLaws(lawService.laws);
    setIsAdding(false);
    setMsg({ type: 'success', text: `✓ „${law.name}“ gespeichert und eingeschaltet.` });
  };

  const handleEdit = (law, data) => {
    onUpdateLaws(lawService.updateLaw(law.id, data));
    setEditingId(null);
    setMsg({ type: 'success', text: `✓ „${data.name}“ geändert.` });
  };

  const handleDelete = (law) => {
    onUpdateLaws(lawService.deleteLaw(law.id));
    setConfirmDeleteId(null);
    setMsg({ type: 'success', text: `„${law.name}“ gelöscht.` });
  };

  const handleRestore = () => {
    onUpdateLaws(lawService.restoreTemplate());
    setMsg({ type: 'success', text: '✓ Vorlage „12-Uhr-Regel“ wiederhergestellt.' });
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
      <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Gesetze">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <div className="modal-head-icon">
              <Scale size={16} />
            </div>
            <div>
              <h3>Gesetze & Regeln</h3>
              <p>Gesetzliche Rahmenbedingungen, die der Tankwart beachtet – ein- und ausschaltbar</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className={`law-summary ${ruleState.active ? 'is-active' : ''}`}>
          <strong>
            {ruleState.active
              ? `Gerade wirksam für ${fuelLabel(fuelType)}: ${ruleState.name} – Erhöhungen nur um ${ruleState.timesLabel}`
              : `Für ${fuelLabel(fuelType)} gilt gerade keine Erhöhungs-Regel – der Tankwart rechnet mit freier Preisbildung.`}
          </strong>
          <span>
            Warten, Prognosen und Ankunftsausblick bleiben gleich – eingeschaltete Gesetze setzen ihnen nur Grenzen.
            {` ${activeCount} von ${laws.length} ${laws.length === 1 ? 'Eintrag' : 'Einträgen'} in Kraft.`}
          </span>
        </div>

        <div className="manage-list">
          {laws.length === 0 && !isAdding && (
            <div className="manage-item">
              <div className="manage-item-sub">Keine Gesetze gespeichert. Die Prognosen rechnen mit freier Preisbildung.</div>
            </div>
          )}
          {laws.map((law) => {
            const status = lawStatus(law, now);
            if (editingId === law.id) {
              return (
                <div key={law.id} className="manage-item is-active">
                  <LawForm initial={formFromLaw(normalizeLaw(law))} submitLabel="Speichern" onSubmit={(data) => handleEdit(law, data)} onCancel={() => setEditingId(null)} />
                </div>
              );
            }
            return (
              <div key={law.id} className={`manage-item law-item ${law.enabled ? '' : 'is-off'}`}>
                <div className="manage-item-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="manage-item-title">
                      <span>{law.name}</span>
                      <span className={`badge ${STATUS_BADGE[status.state]}`} style={{ fontSize: '0.64rem', padding: '0.1rem 0.45rem' }}>{status.label}</span>
                    </div>
                    <div className="law-kind">
                      {law.kind === 'price-step' ? <CalendarDays size={12} /> : <Clock size={12} />}
                      <span>{LAW_KIND_LABELS[law.kind]}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={law.enabled}
                    aria-label={`${law.name} ${law.enabled ? 'ausschalten' : 'einschalten'}`}
                    className={`law-switch ${law.enabled ? 'is-on' : ''}`}
                    onClick={() => handleToggle(law)}
                  >
                    <span className="law-switch-knob" />
                  </button>
                </div>

                <div className="law-effect">{describeLawEffect(law)}</div>
                {law.note && <p className="law-note">{law.note}</p>}

                <div className="law-actions">
                  {law.source && (
                    <a className="law-source" href={law.source} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={12} />
                      <span>Quelle</span>
                    </a>
                  )}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="icon-btn" onClick={() => { setEditingId(law.id); setIsAdding(false); setConfirmDeleteId(null); }} aria-label={`${law.name} bearbeiten`} title="Bearbeiten">
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="icon-btn is-danger" onClick={() => setConfirmDeleteId(law.id)} aria-label={`${law.name} löschen`} title="Löschen">
                    <Trash2 size={14} />
                  </button>
                </div>

                {confirmDeleteId === law.id && (
                  <div className="inline-confirm">
                    <span>{law.builtIn ? `„${law.name}“ löschen? Zum vorübergehenden Abschalten reicht der Schalter.` : `„${law.name}“ löschen?`}</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(law)}>Löschen</button>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(null)}>Abbrechen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isAdding ? (
          <div className="form-section">
            <h4>Neues Gesetz / neue Regel</h4>
            <LawForm initial={EMPTY_FORM} submitLabel="Speichern & einschalten" onSubmit={handleCreate} onCancel={() => setIsAdding(false)} />
          </div>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm drawer-wide-btn" onClick={() => { setIsAdding(true); setEditingId(null); }}>
            <Plus size={14} />
            <span>Gesetz / Regel hinzufügen</span>
          </button>
        )}
        {!hasTemplate && !isAdding && (
          <button type="button" className="btn btn-secondary btn-sm drawer-wide-btn" style={{ marginTop: '0.5rem' }} onClick={handleRestore}>
            <RotateCcw size={14} />
            <span>Vorlage „12-Uhr-Regel“ wiederherstellen</span>
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
