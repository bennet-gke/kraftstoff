import React, { useState } from 'react';
import { Scale, Plus, Check, Trash2, X, AlertTriangle, ShieldCheck } from 'lucide-react';

export default function LawTaxModal({
  isOpen,
  onClose,
  laws = [],
  onUpdateLaws,
}) {
  const [newLabel, setNewLabel] = useState('');
  const [newDiscount, setNewDiscount] = useState('');
  const [newDesc, setNewDesc] = useState('');

  if (!isOpen) return null;

  const handleToggle = (id) => {
    const updated = laws.map((l) => (l.id === id ? { ...l, isActive: !l.isActive } : l));
    onUpdateLaws(updated);
  };

  const handleDelete = (id) => {
    const updated = laws.filter((l) => l.id !== id);
    onUpdateLaws(updated);
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newLabel || !newDiscount) return;

    const discountVal = parseFloat(newDiscount);
    const newLaw = {
      id: `law-${Date.now()}`,
      key: `custom_${Date.now()}`,
      label: newLabel,
      discountCent: isNaN(discountVal) ? 0 : discountVal,
      isActive: true,
      description: newDesc || 'Benutzerdefinierte Gesetzgebung',
    };

    onUpdateLaws([...laws, newLaw]);
    setNewLabel('');
    setNewDiscount('');
    setNewDesc('');
  };

  // Gesamte Netto-Auswirkung
  const totalImpactCent = laws
    .filter((l) => l.isActive)
    .reduce((sum, l) => sum + (l.discountCent || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.35rem', borderRadius: '6px' }}>
              <Scale size={16} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A' }}>
                Gesetzgebung & Steuerparameter
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Dynamische Konfiguration ohne Code-Deployment (Spezifikation S. 3)
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Zusammenfassung der Netto-Wirkung */}
        <div
          style={{
            background: totalImpactCent < 0 ? '#ECFDF5' : totalImpactCent > 0 ? '#FFF1F2' : '#F8FAFC',
            border: `1px solid ${totalImpactCent < 0 ? '#A7F3D0' : totalImpactCent > 0 ? '#FECDD3' : '#E2E8F0'}`,
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={18} color={totalImpactCent <= 0 ? '#059669' : '#DC2626'} />
            <div>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                Aktuelle Netto-Auswirkung auf alle Tankpreise:
              </span>
              <p style={{ fontSize: '0.74rem', color: '#64748B' }}>
                Fließt in die Baseline der Adaptive Moving Average Engine ein.
              </p>
            </div>
          </div>

          <div
            className="num-mono"
            style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              color: totalImpactCent <= 0 ? '#059669' : '#DC2626',
            }}
          >
            {totalImpactCent > 0 ? `+${totalImpactCent.toFixed(1)}` : totalImpactCent.toFixed(1)} ct/L
          </div>
        </div>

        {/* Liste konfigurierter Gesetze / Steuern */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {laws.map((law) => (
            <div
              key={law.id}
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                padding: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: law.isActive ? '#FFFFFF' : '#F8FAFC',
                opacity: law.isActive ? 1 : 0.7,
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ flex: 1, marginRight: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0F172A' }}>
                    {law.label}
                  </span>
                  <span
                    className={`badge ${law.discountCent < 0 ? 'badge-favorable' : 'badge-neutral'}`}
                    style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem' }}
                  >
                    {law.discountCent > 0 ? `+${law.discountCent.toFixed(1)}` : law.discountCent.toFixed(1)} ct
                  </span>
                </div>
                {law.description && (
                  <p style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.2rem' }}>
                    {law.description}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  className={`btn btn-sm ${law.isActive ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleToggle(law.id)}
                  style={{ minWidth: '85px' }}
                >
                  {law.isActive ? 'Aktiviert' : 'Deaktiviert'}
                </button>
                <button
                  onClick={() => handleDelete(law.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.3rem' }}
                  title="Eintrag löschen"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Neues Gesetz hinzufügen */}
        <form onSubmit={handleAdd} style={{ borderTop: '1px solid #F1F5F9', paddingTop: '1.25rem' }}>
          <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A', marginBottom: '0.75rem' }}>
            Neuen Parameter / Steuersenkung hinzufügen
          </h4>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="Bezeichnung (z.B. Sommer-Rabatt)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
              required
            />
            <input
              type="number"
              step="0.1"
              placeholder="z.B. -10 oder +5 Cent"
              value={newDiscount}
              onChange={(e) => setNewDiscount(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
              required
            />
          </div>

          <input
            type="text"
            placeholder="Optionale Beschreibung..."
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #E2E8F0',
              fontSize: '0.82rem',
              outline: 'none',
              marginBottom: '0.75rem',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Schließen
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} />
              <span>Regel anwenden</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
