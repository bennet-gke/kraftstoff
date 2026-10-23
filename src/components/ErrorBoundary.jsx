import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('KRAFTSTOFF ErrorBoundary caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleResetLocations = () => {
    try {
      localStorage.removeItem('kraftstoff_user_locations');
      localStorage.removeItem('kraftstoff_active_location_id');
      localStorage.removeItem('kraftstoff_user_routes');
      localStorage.removeItem('kraftstoff_active_route_id');
    } catch {}
    window.location.reload();
  };

  handleFullReset = () => {
    try {
      localStorage.clear();
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#F8FAFC',
            padding: '1.5rem',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '1.75rem',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.08)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#FEF2F2',
                color: '#DC2626',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <AlertTriangle size={24} />
            </div>

            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', marginBottom: '0.4rem' }}>
              Ansicht konnte nicht geladen werden
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#64748B', lineHeight: 1.5, marginBottom: '1.25rem' }}>
              Es ist ein Fehler beim Darstellen der Daten aufgetreten. Deine Tankdaten und Einstellungen sind lokal oder in der iCloud gesichert.
            </p>

            {this.state.error && (
              <div
                style={{
                  background: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  borderRadius: '6px',
                  padding: '0.65rem',
                  fontSize: '0.72rem',
                  color: '#475569',
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  maxHeight: '100px',
                  overflowY: 'auto',
                  marginBottom: '1.25rem',
                }}
              >
                {this.state.error.toString()}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-primary"
                style={{ justifyContent: 'center', padding: '0.65rem' }}
              >
                <RefreshCw size={14} />
                <span>Seite neu laden</span>
              </button>

              <button
                onClick={this.handleResetLocations}
                className="btn btn-secondary"
                style={{ justifyContent: 'center', padding: '0.65rem' }}
              >
                <RotateCcw size={14} />
                <span>Standorte & Routen auf Standard zurücksetzen</span>
              </button>

              <button
                onClick={this.handleFullReset}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                  marginTop: '0.5rem',
                  textDecoration: 'underline',
                }}
              >
                Vollständigen Cache leeren
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
