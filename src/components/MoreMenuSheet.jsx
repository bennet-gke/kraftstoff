import React from 'react';
import { Car, MapPin, BellRing, Cloud, Settings, ChevronRight, X, Scale } from 'lucide-react';
import { useEscapeToClose } from './modalHooks';

/**
 * Menü für das iPhone: seltener gebrauchte Funktionen aus der Kopfzeile in einem Bottom-Sheet.
 */
export default function MoreMenuSheet({ onClose, onOpen, vehicleName = '', lawSummary = '', unsaved = false, alertsActive = false }) {
  useEscapeToClose(true, onClose);
  const rows = [
    { id: 'vehicle', icon: Car, title: 'Garage', sub: vehicleName ? `${vehicleName} • Verbrauch & Tankstand` : 'Fahrzeuge, Verbrauch & Tankstand' },
    { id: 'places', icon: MapPin, title: 'Orte & Routen', sub: 'Suchbereiche und feste Strecken' },
    { id: 'laws', icon: Scale, title: 'Gesetze & Regeln', sub: lawSummary || '12-Uhr-Regel & weitere Vorgaben ein- und ausschalten' },
    { id: 'alerts', icon: BellRing, title: 'Preisalarme', sub: alertsActive ? 'Mitteilungen sind erlaubt' : 'Mitteilungen einrichten' },
    { id: 'database', icon: Cloud, title: 'Datenbank', sub: unsaved ? 'Änderungen noch nicht gesichert' : 'iCloud-Ordner, Sichern & Laden, Archiv-Import', dot: unsaved },
    { id: 'settings', icon: Settings, title: 'Einstellungen', sub: 'Key, Karten-App, Fahrprofil, Alarme' },
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content menu-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menü">
        <div className="modal-head" style={{ marginBottom: '0.6rem' }}>
          <div>
            <h3>Menü</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>
        <div className="menu-sheet-list">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.id} type="button" className="menu-sheet-row" onClick={() => onOpen(r.id)}>
                <span className={`menu-sheet-icon ${r.dot ? 'has-dot' : ''}`}>
                  <Icon size={18} />
                </span>
                <span className="menu-sheet-text">
                  <strong>{r.title}</strong>
                  <span>{r.sub}</span>
                </span>
                <ChevronRight size={16} className="menu-sheet-chevron" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
