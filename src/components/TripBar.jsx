import React, { useState } from 'react';
import { Route, Navigation, X, RefreshCw, ExternalLink, Fuel, LocateFixed, AlertTriangle, Info } from 'lucide-react';
import { CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from '../services/routeService';
import { directionsUrl, openExternal, resolveNavApp, navAppLabel, appleSupportsWaypoints } from '../services/navHandoff';
import { fmtNum, fmtDuration } from '../utils/format';

const km = (v) => String(Math.round(Number(v) || 0));

/**
 * Fahrt-Leiste im Radar: Zusammenfassung der geplanten Fahrt, Fortschritt per GPS, bester Tankstopp,
 * Übergabe an die bevorzugte Karten-App (Standard Apple Karten) mit dem Tankstopp als Zwischenziel.
 */
export default function TripBar({ route, stationCount = 0, bestStation = null, navApp = 'apple', progress = null, onUpdateProgress, onUpdateCorridor, onReplan, onEnd }) {
  const [showHint, setShowHint] = useState(false);
  const [locating, setLocating] = useState(false);
  if (!route) return null;
  const preferred = resolveNavApp(navApp);
  const other = preferred === 'apple' ? 'google' : 'apple';
  const corridor = Number(route.corridorRadiusKm) || DEFAULT_CORRIDOR_KM;
  const duration = fmtDuration(route.durationMin);
  const dest = route.endCoords;
  const stopSupported = (app) => app === 'google' || appleSupportsWaypoints();
  const withStopUrl = (app) => directionsUrl({ app, destination: dest, waypoint: bestStation });
  const remainingKm = progress ? Math.max(0, (route.totalDistanceKm || 0) - progress.km) : null;

  const handleLocate = async () => {
    if (!onUpdateProgress) return;
    setLocating(true);
    try {
      await onUpdateProgress();
    } finally {
      setLocating(false);
    }
  };

  const mainLabel = bestStation
    ? stopSupported(preferred) ? `${navAppLabel(preferred)} mit Tankstopp` : `${navAppLabel(preferred)} zur Tankstelle`
    : `${navAppLabel(preferred)} zum Ziel`;

  return (
    <div className="trip-bar">
      <div className="trip-bar-head">
        <div className="trip-bar-title">
          <div className="trip-bar-icon">
            <Route size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="trip-bar-name">Fahrt nach {route.endName || 'Ziel'}</div>
            <div className="trip-bar-sub">
              von {route.startName || 'Start'} • {fmtNum(route.totalDistanceKm || 0, 1)} km{duration ? ` • ca. ${duration}` : ''} • {stationCount} {stationCount === 1 ? 'Tankstelle' : 'Tankstellen'}{progress ? ' voraus' : ' im Korridor'}
            </div>
          </div>
        </div>
        <div className="corridor-chips" role="group" aria-label="Korridor-Breite">
          <span>Korridor:</span>
          {CORRIDOR_OPTIONS.map((rad) => (
            <button key={rad} type="button" className={Math.abs(corridor - rad) < 0.2 ? 'active' : ''} onClick={() => onUpdateCorridor && onUpdateCorridor(rad)}>
              ±{fmtNum(rad, rad % 1 ? 1 : 0)}
            </button>
          ))}
        </div>
      </div>

      {route.approximate && (
        <div className="trip-bar-note is-warning">
          <AlertTriangle size={13} />
          <span>Routing-Dienst war nicht erreichbar – der Korridor folgt der Luftlinie. „Neu planen“ versucht es erneut.</span>
        </div>
      )}

      <div className="trip-bar-progress">
        <LocateFixed size={13} />
        {progress ? (
          <span>
            Position: km {km(progress.km)} von {km(route.totalDistanceKm)} • noch {km(remainingKm)} km
            {progress.offRouteKm > 3 ? ` • ${fmtNum(progress.offRouteKm, 1)} km neben der Strecke` : ''}
          </span>
        ) : (
          <span>Position unbekannt – zeigt alle Tankstellen der Strecke.</span>
        )}
        {onUpdateProgress && (
          <button type="button" className="trip-bar-link" onClick={handleLocate} disabled={locating}>
            {locating ? <RefreshCw size={12} className="animate-spin" /> : null}
            <span>{progress ? 'Aktualisieren' : 'Meine Position'}</span>
          </button>
        )}
      </div>

      {bestStation && (
        <div className="trip-bar-tip">
          <Fuel size={14} color="#059669" />
          <span>
            <strong>Tankstopp-Tipp:</strong> {bestStation.name}
            {Number.isFinite(bestStation.kmAlongRoute) ? ` • ${bestStation.aheadKm !== undefined ? `in ${bestStation.aheadKm} km` : `bei km ${km(bestStation.kmAlongRoute)}`}` : ''}
            {Number.isFinite(bestStation.currentPrice) ? ` • ${fmtNum(bestStation.currentPrice, 3)} €/L` : ''}
            {Number.isFinite(bestStation.routeDetourKm) ? ` • ${bestStation.routeDetourKm < 0.1 ? 'direkt an der Strecke' : bestStation.routeDetourKm >= 1 ? `${fmtNum(bestStation.routeDetourKm, 1)} km Abstecher` : `${Math.round(bestStation.routeDetourKm * 1000)} m Abstecher`}` : ''}
          </span>
        </div>
      )}

      <div className="trip-bar-actions">
        <button type="button" className="btn btn-primary btn-sm trip-bar-main" onClick={() => openExternal(withStopUrl(preferred))} disabled={!dest}>
          <Navigation size={14} />
          <span>{mainLabel}</span>
        </button>
        {bestStation && stopSupported(preferred) && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openExternal(directionsUrl({ app: preferred, destination: bestStation }))} title="Nur zur Tankstelle navigieren">
            <Fuel size={13} />
            <span>Nur Tankstelle</span>
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowHint((v) => !v)} aria-label="Hinweis zur Übergabe" title="Hinweis zur Übergabe">
          <Info size={13} />
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onReplan} title="Fahrt neu planen">
          <RefreshCw size={12} />
          <span>Neu planen</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm trip-bar-end" onClick={onEnd} title="Fahrt beenden und zurück zum Standort">
          <X size={12} />
          <span>Beenden</span>
        </button>
      </div>
      {showHint && (
        <div className="trip-bar-hint">
          <p>
            {navAppLabel(preferred)} startet an deinem aktuellen Standort{bestStation && stopSupported(preferred) ? ' und fährt erst den Tankstopp an, dann das Ziel' : ''}.
            {preferred === 'apple' && !appleSupportsWaypoints() ? ' Dein iPhone kennt noch keine Zwischenziele per Link (erst ab iOS 18.4) – nach dem Tanken einfach neu starten.' : ''}
            {' '}Die bevorzugte App stellst du in den Einstellungen ein.
          </p>
          <button type="button" className="text-link" onClick={() => openExternal(withStopUrl(other))}>
            <ExternalLink size={12} /> Stattdessen in {navAppLabel(other)} öffnen
          </button>
        </div>
      )}
    </div>
  );
}
