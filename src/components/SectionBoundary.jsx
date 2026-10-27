import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Fehlergrenze für einen Bereich (Radar, Karte, Trends, Tankwart): Ein Fehler in einem Diagramm
 * legt nicht mehr die ganze App lahm, der Rest bleibt bedienbar.
 */
export default class SectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`Bereich „${this.props.name}“ konnte nicht angezeigt werden:`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="section-error" role="alert">
        <AlertTriangle size={20} color="#DC2626" />
        <div>
          <strong>{this.props.name || 'Dieser Bereich'} konnte nicht angezeigt werden.</strong>
          <p>{String(this.state.error?.message || this.state.error)}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ error: null })}>
          <RefreshCw size={13} />
          <span>Erneut versuchen</span>
        </button>
      </div>
    );
  }
}
