import React, { useState } from 'react';
import { Scale, Plus, Trash2, X, ShieldCheck, Clock, Zap, Sparkles } from 'lucide-react';

export default function LawTaxModal({
  isOpen,
  onClose,
  laws = [],
  onUpdateLaws,
}) {
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('Marktdynamik');
  const [newImpact, setNewImpact] = useState('');
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
    if (!newLabel) return;

    const newRule = {
      id: `rule-custom-${Date.now()}`,
      key: `custom_${Date.now()}`,
      label: newLabel,
      category: newCategory || 'Benutzerdefiniert',
      isActive: true,
      impact: newImpact || 'Steuert das neuronale Zeitreihenmodell',
      description: newDesc || 'Benutzerdefinierte Markt- & Verordnungsregel für das KI-Modell.',
    };

    onUpdateLaws([...laws, newRule]);
    setNewLabel('');
    setNewCategory('Marktdynamik');
    setNewImpact('');
    setNewDesc('');
  };

  const is12ClockActive = laws.some((l) => l.key === 'twelve_clock_regulation' && l.isActive);
  const activeCount = laws.filter((l) => l.isActive).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.25rem',
            borderBottom: '1px solid #F1F5F9',
            paddingBottom: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '0.45rem', borderRadius: '8px' }}>
              <Scale size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.08rem', fontWeight: 800, color: '#0F172A' }}>
                Marktregeln & 12-Uhr-Verordnung (KI-Steuerung)
              </h3>
              <p style={{ fontSize: '0.76rem', color: '#64748B' }}>
                Verordnungslogiken für neuronale Vorhersagen ohne künstliche Preisverzerrungen
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.35rem' }}
            title="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* 100% Echte Zapfsäulenpreise Reassurance-Banner */}
        <div
          style={{
            background: '#F0FDF4',
            border: '1px solid #BBF7D0',
            borderRadius: '10px',
            padding: '0.9rem 1.1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
          }}
        >
          <ShieldCheck size={22} color="#16A34A" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.85rem', color: '#166534' }}>
                100% Unverfälschte Zapfsäulenpreise
              </strong>
              <span className="badge badge-favorable" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                0.0 ct künstlicher Abzug
              </span>
            </div>
            <p style={{ fontSize: '0.76rem', color: '#15803D', marginTop: '0.25rem', lineHeight: 1.45 }}>
              Zapfsäulenpreise werden <strong>nicht</strong> künstlich verändert. Diese Verordnungsregeln fließen stattdessen direkt in das <strong>TensorFlow.js KI-Modell</strong>, die 24h-Preiskurve und den <strong>optimalen Tank-Fahrplan</strong> ein (z.B. Erhöhungsstopp ab 12 Uhr mittags).
            </p>
          </div>
        </div>

        {/* Status-Übersicht */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
            }}
          >
            <Clock size={18} color={is12ClockActive ? '#059669' : '#94A3B8'} />
            <div>
              <span style={{ fontSize: '0.7rem', color: '#64748B', display: 'block' }}>
                12-Uhr-Spritpreisverordnung:
              </span>
              <strong style={{ fontSize: '0.85rem', color: is12ClockActive ? '#059669' : '#64748B' }}>
                {is12ClockActive ? 'Aktiv (Preiserhöhungsverbot ab 12 Uhr)' : 'Deaktiviert'}
              </strong>
            </div>
          </div>

          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '8px',
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
            }}
          >
            <Sparkles size={18} color="#2563EB" />
            <div>
              <span style={{ fontSize: '0.7rem', color: '#64748B', display: 'block' }}>
                Aktive KI-Verordnungsregeln:
              </span>
              <strong style={{ fontSize: '0.85rem', color: '#0F172A' }}>
                {activeCount} von {laws.length} Regeln aktiv
              </strong>
            </div>
          </div>
        </div>

        {/* Liste konfigurierter Marktregeln */}
        <h4 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.75rem' }}>
          Konfigurierte Markt- und Verordnungsregeln
        </h4>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {laws.map((rule) => {
            const is12Clock = rule.id === 'rule-12-clock' || rule.key === 'twelve_clock_regulation';

            return (
              <div
                key={rule.id}
                style={{
                  border: is12Clock && rule.isActive ? '2px solid #10B981' : '1px solid #E2E8F0',
                  borderRadius: '10px',
                  padding: '0.9rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  background: rule.isActive ? '#FFFFFF' : '#F8FAFC',
                  opacity: rule.isActive ? 1 : 0.65,
                  boxShadow: is12Clock && rule.isActive ? '0 2px 8px rgba(16, 185, 129, 0.12)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A' }}>
                      {rule.label}
                    </span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: '#F1F5F9',
                        color: '#475569',
                        fontWeight: 600,
                      }}
                    >
                      {rule.category || 'Marktregel'}
                    </span>
                    {is12Clock && (
                      <span className="badge badge-favorable" style={{ fontSize: '0.66rem', padding: '0.1rem 0.45rem' }}>
                        🎯 Kern-Verordnung
                      </span>
                    )}
                  </div>

                  {rule.impact && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem' }}>
                      <Zap size={13} color="#2563EB" />
                      <span style={{ fontSize: '0.76rem', fontWeight: 600, color: '#1E40AF' }}>
                        {rule.impact}
                      </span>
                    </div>
                  )}

                  {rule.description && (
                    <p style={{ fontSize: '0.76rem', color: '#64748B', marginTop: '0.35rem', lineHeight: 1.45 }}>
                      {rule.description}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <button
                    className={`btn btn-sm ${rule.isActive ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleToggle(rule.id)}
                    style={{ minWidth: '85px', fontSize: '0.76rem' }}
                  >
                    {rule.isActive ? 'Aktiv' : 'Inaktiv'}
                  </button>

                  {!is12Clock && rule.id.startsWith('rule-custom-') && (
                    <button
                      onClick={() => handleDelete(rule.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '0.3rem' }}
                      title="Regel entfernen"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Neue Marktregel hinzufügen */}
        <form onSubmit={handleAdd} style={{ borderTop: '1px solid #F1F5F9', paddingTop: '1.25rem' }}>
          <h4 style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.5rem' }}>
            Eigene Markt- / Verordnungsregel ergänzen
          </h4>
          <p style={{ fontSize: '0.74rem', color: '#64748B', marginBottom: '0.75rem' }}>
            Erweitere das Regelwerk für das Machine Learning Modell mit regionalen Mustern.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="Bezeichnung (z.B. Ferienbeginn Reisewellen-Filter)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
              required
            />
            <input
              type="text"
              placeholder="Kategorie (z.B. Saisonal)"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="KI-Auswirkung (z.B. Preissprung um 14 Uhr erwarten)"
              value={newImpact}
              onChange={(e) => setNewImpact(e.target.value)}
              style={{
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Ausführliche Beschreibung..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #E2E8F0',
                fontSize: '0.82rem',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Schließen
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} />
              <span>Regel hinzufügen</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
