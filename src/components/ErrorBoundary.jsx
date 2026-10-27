import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';

// Bewusst ohne Import aus den Diensten: die Fehlerseite muss auch funktionieren, wenn genau dort der Fehler liegt
const SAFE_MODE_KEY = 'kraftstoff_safe_mode';
const IDB_NAMES = ['kraftstoff_persistent_storage', 'tensorflowjs'];

function deleteDb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Löscht alles, was die App auf diesem Gerät gespeichert hat (die Dateien im iCloud-Ordner bleiben unberührt). */
async function resetAllLocalData() {
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  await Promise.all(IDB_NAMES.map(deleteDb));
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {}
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, confirmReset: false, resetting: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('KRAFTSTOFF: Darstellungsfehler', error, errorInfo);
  }

  handleSafeMode = () => {
    try { localStorage.setItem(SAFE_MODE_KEY, '1'); } catch {}
    window.location.reload();
  };

  handleResetLocations = () => {
    try {
      ['kraftstoff_user_locations', 'kraftstoff_active_location_id', 'kraftstoff_user_routes', 'kraftstoff_active_route_id'].forEach((k) => localStorage.removeItem(k));
    } catch {}
    window.location.reload();
  };

  handleFullReset = async () => {
    this.setState({ resetting: true });
    await resetAllLocalData();
    window.location.replace('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, confirmReset, resetting } = this.state;

    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <div className="fatal-icon">
            <AlertTriangle size={24} />
          </div>
          <h2>Da ist etwas schiefgelaufen</h2>
          <p>Die Ansicht konnte nicht dargestellt werden. Deine Daten sind lokal und in der Datenbank-Datei gesichert.</p>

          {error && <pre className="fatal-error">{String(error?.message || error)}</pre>}

          <div className="fatal-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={14} />
              <span>Neu laden</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleSafeMode}>
              <ShieldCheck size={14} />
              <span>Ohne automatisches Laden der Datei starten</span>
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleResetLocations}>
              <RotateCcw size={14} />
              <span>Orte & Routen zurücksetzen</span>
            </button>

            {!confirmReset ? (
              <button type="button" className="fatal-link" onClick={() => this.setState({ confirmReset: true })}>
                App auf diesem Gerät komplett zurücksetzen …
              </button>
            ) : (
              <div className="inline-confirm is-block">
                <span>Löscht alle lokalen Daten dieser App (Einstellungen, Preishistorie, KI-Lernstand, Offline-Speicher). Die Dateien in deinem iCloud-Ordner bleiben erhalten – danach einfach die neueste Datei wieder laden.</span>
                <div className="inline-confirm-actions">
                  <button type="button" className="btn btn-sm btn-danger" onClick={this.handleFullReset} disabled={resetting}>
                    <Trash2 size={13} />
                    <span>{resetting ? 'Setze zurück …' : 'Ja, zurücksetzen'}</span>
                  </button>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => this.setState({ confirmReset: false })} disabled={resetting}>
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
