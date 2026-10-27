import React, { useEffect, useRef, useState } from 'react';
import { Navigation, Coffee, Fuel, BellOff, Car, MapPin, RotateCcw, LocateFixed, ChevronDown, X, Check, ArrowUpDown, Plus, Star, Route as RouteIcon, Settings2 } from 'lucide-react';
import { QUICK_CITIES } from '../services/locationService';
import { CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from '../services/routeService';
import { neededLitersFor } from '../engine/vehicleMath';
import { fmtNum, fuelLabel } from '../utils/format';

const FUELS = [
  { id: 'diesel', label: 'Diesel', desc: 'B7' },
  { id: 'e10', label: 'Super E10', desc: '95 Oktan, bis 10 % Ethanol' },
  { id: 'e5', label: 'Super E5', desc: '95 Oktan, bis 5 % Ethanol' },
];

const SORTS_LOCAL = [
  { id: 'score', label: 'Empfehlung', desc: 'Preis, Umweg und Tageszeit kombiniert' },
  { id: 'savings', label: 'Netto-Ersparnis', desc: 'Ersparnis nach Spritkosten für den Umweg' },
  { id: 'price', label: 'Niedrigster Preis', desc: 'Reiner Literpreis' },
  { id: 'distance', label: 'Kürzeste Distanz', desc: 'Nächste Tankstellen zuerst' },
];

const SORTS_ROUTE = [
  { id: 'route_progress', label: 'In Fahrtrichtung', desc: 'In der Reihenfolge der Strecke' },
  { id: 'score', label: 'Empfehlung', desc: 'Preis, Abstecher und Tageszeit kombiniert' },
  { id: 'price', label: 'Niedrigster Preis', desc: 'Reiner Literpreis' },
  { id: 'detour', label: 'Kürzester Abstecher', desc: 'Am dichtesten an der Strecke' },
  { id: 'savings', label: 'Netto-Ersparnis', desc: 'Ersparnis nach Spritkosten für den Abstecher' },
];

const SORT_LABEL = {
  score: 'Empfehlung',
  savings: 'Netto-Ersparnis',
  price: 'Günstigster Preis',
  distance: 'Kürzeste Distanz',
  route_progress: 'In Fahrtrichtung',
  detour: 'Kürzester Abstecher',
};

/** Countdown "12:34" bis zu einem Zeitpunkt; ruft onExpire genau einmal auf. */
function useCountdown(untilMs, onExpire) {
  const [now, setNow] = useState(() => Date.now());
  const expireRef = useRef(onExpire);
  const firedRef = useRef(false);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);
  useEffect(() => {
    firedRef.current = false;
    if (!untilMs) return undefined;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= untilMs && !firedRef.current) {
        firedRef.current = true;
        expireRef.current?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [untilMs]);
  if (!untilMs) return '';
  const left = Math.max(0, Math.round((untilMs - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function DrawerHead({ title, sub, onClose }) {
  return (
    <div className="drawer-head">
      <div style={{ minWidth: 0 }}>
        <div className="drawer-title">{title}</div>
        {sub && <div className="drawer-sub">{sub}</div>}
      </div>
      <button type="button" className="drawer-close" onClick={onClose} aria-label="Schließen">
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * Filterleiste im Radar: Bereich (Ort / Route / Favoriten), Fahrzeug, Kraftstoff, Sortierung, Umweg-Modus, Alarm-Pause.
 * Die Reiter im Bereichs-Menü sind reine Ansichten – erst eine Auswahl wechselt den Modus.
 */
export default function RouteScheduleBar({
  selectedFuel = 'diesel',
  onSelectFuel,
  isPaused = false,
  pausedUntil = null,
  onPause30Min,
  onResumeAlerts,
  sortBy = 'score',
  onSelectSort,
  activeVehicle,
  vehicles = [],
  onSelectVehicle,
  onOpenVehicleModal,
  activeLocation,
  locations = [],
  onSelectLocation,
  onUpdateRadius,
  activeRoute = null,
  routes = [],
  onSelectRoute,
  onUpdateRouteCorridorRadius,
  filterMode = 'location',
  onSelectFilterMode,
  favoriteStationIds = [],
  onOpenLocationRouteModal,
  onOpenTripPlanner,
  onLocateGps,
  onSelectQuickCity,
  detourMode = 'local_roundtrip',
  onSelectDetourMode,
  customConsumption,
  onUpdateCustomConsumption,
  customLiters,
  onUpdateCustomLiters,
  onResetVehicleOverrides,
}) {
  // 'location' | 'vehicle' | 'fuel' | 'sort' | null
  const [activeDrawer, setActiveDrawer] = useState(null);
  // Ansicht im Bereichs-Menü: 'location' | 'route' | 'favorites'
  const [areaView, setAreaView] = useState(filterMode);

  const pausedUntilMs = isPaused && pausedUntil ? new Date(pausedUntil).getTime() : null;
  const timeLeft = useCountdown(Number.isFinite(pausedUntilMs) ? pausedUntilMs : null, onResumeAlerts);

  const routeMode = filterMode === 'route' && !!activeRoute;
  const autoLiters = Math.round(neededLitersFor(activeVehicle));
  const neededLiters = customLiters || autoLiters;
  const effectiveConsumption = customConsumption || activeVehicle?.consumptionL100km || 6.5;
  const hasVehicleOverrides = (customConsumption !== null && customConsumption !== activeVehicle?.consumptionL100km) || customLiters !== null;
  const literMax = Math.max(90, Math.ceil((Number(activeVehicle?.tankCapacityL) || 0) / 5) * 5);
  const sortedRoutes = [...routes].sort((a, b) => (b.isTrip ? 1 : 0) - (a.isTrip ? 1 : 0));

  const close = () => setActiveDrawer(null);
  const toggleDrawer = (name) => {
    if (name === 'location' && activeDrawer !== 'location') setAreaView(filterMode);
    setActiveDrawer((prev) => (prev === name ? null : name));
  };

  const sortOptions = routeMode ? SORTS_ROUTE : SORTS_LOCAL;
  // Im Routen-Modus sortiert "Distanz" in Fahrtrichtung
  const effectiveSort = routeMode && sortBy === 'distance' ? 'route_progress' : sortBy;
  const corridor = Number(activeRoute?.corridorRadiusKm) || DEFAULT_CORRIDOR_KM;

  let areaLabel;
  let AreaIcon = MapPin;
  let areaTone = '';
  if (filterMode === 'favorites') {
    areaLabel = <>Favoriten (<strong>{favoriteStationIds.length}</strong>)</>;
    AreaIcon = Star;
    areaTone = 'is-fav';
  } else if (routeMode) {
    areaLabel = activeRoute.isTrip ? <>Fahrt: <strong>{activeRoute.endName || activeRoute.name}</strong></> : <>Route: <strong>{activeRoute.name}</strong></>;
    AreaIcon = RouteIcon;
    areaTone = 'is-route';
  } else {
    areaLabel = <>{activeLocation?.name || 'Standort'} • {Number(activeLocation?.radiusKm || 5)} km</>;
  }

  return (
    <div className="filter-bar-wrap">
      <div className="filter-pill-bar" role="toolbar" aria-label="Filter">
        <button
          type="button"
          className={`filter-pill ${areaTone} ${activeDrawer === 'location' ? 'active' : ''}`}
          onClick={() => toggleDrawer('location')}
          aria-expanded={activeDrawer === 'location'}
          title="Bereich wählen: Ort, Route oder Favoriten"
        >
          <AreaIcon size={13} fill={filterMode === 'favorites' && activeDrawer !== 'location' ? '#F59E0B' : 'none'} />
          <span className="filter-pill-text">{areaLabel}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'vehicle' ? 'active' : ''}`}
          onClick={() => toggleDrawer('vehicle')}
          aria-expanded={activeDrawer === 'vehicle'}
          title="Fahrzeug und Tankmenge"
        >
          <Car size={13} />
          <span className="filter-pill-text">{activeVehicle?.name || 'Fahrzeug'} • {neededLiters} L</span>
          {hasVehicleOverrides && <span className="filter-pill-dot" aria-hidden="true" />}
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'fuel' ? 'active' : ''}`}
          onClick={() => toggleDrawer('fuel')}
          aria-expanded={activeDrawer === 'fuel'}
          title="Kraftstoffsorte"
        >
          <Fuel size={13} />
          <span>{fuelLabel(selectedFuel)}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        <button
          type="button"
          className={`filter-pill ${activeDrawer === 'sort' ? 'active' : ''}`}
          onClick={() => toggleDrawer('sort')}
          aria-expanded={activeDrawer === 'sort'}
          title="Sortierung"
        >
          <ArrowUpDown size={13} />
          <span>{SORT_LABEL[effectiveSort] || 'Empfehlung'}</span>
          <ChevronDown size={12} style={{ opacity: 0.6 }} />
        </button>

        {!routeMode && onSelectDetourMode && (
          <button
            type="button"
            className={`filter-pill ${detourMode === 'route_corridor' ? 'is-route' : ''}`}
            onClick={() => onSelectDetourMode(detourMode === 'local_roundtrip' ? 'route_corridor' : 'local_roundtrip')}
            title="Umweg-Berechnung: extra hin und zurück fahren oder auf dem Weg vorbeifahren"
          >
            <Navigation size={12} />
            <span>{detourMode === 'route_corridor' ? 'Umweg: auf dem Weg' : 'Umweg: hin & zurück'}</span>
          </button>
        )}

        {isPaused ? (
          <button type="button" className="filter-pill is-paused" onClick={onResumeAlerts} title="Alarm-Pause beenden">
            <BellOff size={12} />
            <span>Alarme aus {timeLeft}</span>
          </button>
        ) : (
          <button type="button" className="filter-pill" onClick={onPause30Min} title="Preisalarme 30 Minuten pausieren">
            <Coffee size={12} color="#64748B" />
            <span>Alarme 30 Min. aus</span>
          </button>
        )}
      </div>

      {activeDrawer && (
        <div className="drawer-card">
          {/* BEREICH: Ort / Route / Favoriten */}
          {activeDrawer === 'location' && (
            <div className="drawer-body">
              <div className="drawer-head">
                <div className="segmented" role="tablist" aria-label="Bereich">
                  <button type="button" role="tab" aria-selected={areaView === 'location'} className={areaView === 'location' ? 'active' : ''} onClick={() => setAreaView('location')}>
                    <MapPin size={13} />
                    <span>Ort</span>
                  </button>
                  <button type="button" role="tab" aria-selected={areaView === 'route'} className={areaView === 'route' ? 'active' : ''} onClick={() => setAreaView('route')}>
                    <RouteIcon size={13} />
                    <span>Route{routes.length > 0 ? ` (${routes.length})` : ''}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={areaView === 'favorites'} className={areaView === 'favorites' ? 'active' : ''} onClick={() => setAreaView('favorites')}>
                    <Star size={13} />
                    <span>Favoriten ({favoriteStationIds.length})</span>
                  </button>
                </div>
                <button type="button" className="drawer-close" onClick={close} aria-label="Schließen">
                  <X size={16} />
                </button>
              </div>

              {areaView === 'location' && (
                <>
                  {onLocateGps && (
                    <button
                      type="button"
                      className={`option-row is-gps ${filterMode === 'location' && activeLocation?.id === 'loc-current-gps' ? 'is-selected' : ''}`}
                      onClick={() => {
                        close();
                        onLocateGps();
                      }}
                    >
                      <span className="option-row-icon"><LocateFixed size={15} /></span>
                      <span className="option-row-main">
                        <span className="option-row-title">Mein Standort (GPS)</span>
                        <span className="option-row-sub">Tankstellen rund um deine aktuelle Position</span>
                      </span>
                      {filterMode === 'location' && activeLocation?.id === 'loc-current-gps' && <Check size={14} />}
                    </button>
                  )}

                  {locations.filter((l) => l.id !== 'loc-current-gps').length > 0 && (
                    <div>
                      <div className="drawer-section-label">Gespeicherte Orte</div>
                      <div className="option-list">
                        {locations.filter((l) => l.id !== 'loc-current-gps').map((loc) => {
                          const isSelected = filterMode === 'location' && activeLocation?.id === loc.id;
                          return (
                            <button
                              key={loc.id}
                              type="button"
                              className={`option-row ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => {
                                close();
                                onSelectLocation(loc.id);
                              }}
                            >
                              <span className="option-row-main">
                                <span className="option-row-title">{loc.name}</span>
                                {loc.address && <span className="option-row-sub">{loc.address}</span>}
                              </span>
                              <span className="option-row-tag">{Number(loc.radiusKm || 5)} km</span>
                              {isSelected && <Check size={14} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {onUpdateRadius && activeLocation && filterMode === 'location' && (
                    <div className="drawer-slider">
                      <div className="drawer-slider-head">
                        <span>Suchradius um {activeLocation.name}</span>
                        <strong className="num-mono">{Number(activeLocation.radiusKm || 5)} km</strong>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="25"
                        step="1"
                        value={Number(activeLocation.radiusKm || 5)}
                        onChange={(e) => onUpdateRadius(activeLocation.id, parseFloat(e.target.value) || 5)}
                        aria-label="Suchradius in Kilometern"
                      />
                    </div>
                  )}

                  {onSelectQuickCity && (
                    <div>
                      <div className="drawer-section-label">Andere Stadt ansehen</div>
                      <div className="chip-row">
                        {QUICK_CITIES.slice(0, 6).map((qc) => (
                          <button
                            key={qc.id}
                            type="button"
                            className="chip-btn"
                            onClick={() => {
                              close();
                              onSelectQuickCity(qc);
                            }}
                          >
                            {qc.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm drawer-wide-btn"
                    onClick={() => {
                      close();
                      onOpenLocationRouteModal();
                    }}
                  >
                    <Plus size={13} />
                    <span>Orte anlegen & verwalten</span>
                  </button>
                </>
              )}

              {areaView === 'route' && (
                <>
                  {onOpenTripPlanner && (
                    <button
                      type="button"
                      className="option-row is-trip-cta"
                      onClick={() => {
                        close();
                        onOpenTripPlanner();
                      }}
                    >
                      <span className="option-row-icon"><Navigation size={15} /></span>
                      <span className="option-row-main">
                        <span className="option-row-title">Fahrt planen</span>
                        <span className="option-row-sub">Ziel eingeben oder Link aus Google Maps / Apple Karten einfügen</span>
                      </span>
                    </button>
                  )}

                  {sortedRoutes.length === 0 ? (
                    <div className="drawer-empty">
                      <RouteIcon size={20} color="#94A3B8" />
                      <strong>Noch keine Route gespeichert</strong>
                      <span>Plane eine Fahrt oder lege eine feste Strecke (z. B. den Arbeitsweg) an.</span>
                    </div>
                  ) : (
                    <div>
                      <div className="drawer-section-label">Routen</div>
                      <div className="option-list">
                        {sortedRoutes.map((r) => {
                          const isSelected = routeMode && activeRoute?.id === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className={`option-row is-route ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => {
                                close();
                                onSelectRoute(r.id);
                              }}
                            >
                              <span className="option-row-main">
                                <span className="option-row-title">
                                  {r.isTrip && <span className="option-row-badge">Fahrt</span>}
                                  {r.name}
                                </span>
                                <span className="option-row-sub">
                                  {r.startName || 'Start'} → {r.endName || 'Ziel'} • Korridor ±{fmtNum(r.corridorRadiusKm || DEFAULT_CORRIDOR_KM, 1)} km{r.approximate ? ' • Luftlinie' : ''}
                                </span>
                              </span>
                              <span className="option-row-tag">{Math.round(Number(r.totalDistanceKm) || 0)} km</span>
                              {isSelected && <Check size={14} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {routeMode && onUpdateRouteCorridorRadius && (
                    <div className="drawer-slider is-route">
                      <div className="drawer-slider-head">
                        <span>Korridor um die Strecke</span>
                        <strong className="num-mono">±{fmtNum(corridor, 1)} km</strong>
                      </div>
                      <div className="corridor-chips" role="group" aria-label="Korridor-Breite">
                        {CORRIDOR_OPTIONS.map((rad) => (
                          <button key={rad} type="button" className={Math.abs(corridor - rad) < 0.2 ? 'active' : ''} onClick={() => onUpdateRouteCorridorRadius(activeRoute.id, rad)}>
                            ±{fmtNum(rad, rad % 1 ? 1 : 0)} km
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="drawer-actions">
                    {routeMode && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          close();
                          onSelectFilterMode('location');
                        }}
                      >
                        <MapPin size={13} />
                        <span>Zurück zum Standort</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        close();
                        onOpenLocationRouteModal();
                      }}
                    >
                      <Settings2 size={13} />
                      <span>Routen verwalten</span>
                    </button>
                  </div>
                </>
              )}

              {areaView === 'favorites' && (
                <>
                  <div className="fav-info">
                    <span className="fav-info-icon"><Star size={18} fill="#F59E0B" color="#F59E0B" /></span>
                    <div>
                      <strong>{filterMode === 'favorites' ? 'Favoriten werden angezeigt' : 'Deine Lieblings-Tankstellen'}</strong>
                      <span>
                        {favoriteStationIds.length > 0
                          ? `${favoriteStationIds.length} ${favoriteStationIds.length === 1 ? 'Tankstelle' : 'Tankstellen'} – mit aktuellen Preisen, egal wo du gerade bist.`
                          : 'Noch keine Favoriten. Tippe bei einer Tankstelle auf den Stern, um sie hier zu sammeln.'}
                      </span>
                    </div>
                  </div>
                  <div className="drawer-actions">
                    {filterMode !== 'favorites' ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={favoriteStationIds.length === 0}
                        onClick={() => {
                          close();
                          onSelectFilterMode('favorites');
                        }}
                      >
                        <Star size={13} />
                        <span>Nur Favoriten anzeigen</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          close();
                          onSelectFilterMode('location');
                        }}
                      >
                        <MapPin size={13} />
                        <span>Zurück zum Standort</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* FAHRZEUG & TANKMENGE */}
          {activeDrawer === 'vehicle' && (
            <div className="drawer-body">
              <DrawerHead
                title="Fahrzeug & Tankmenge"
                sub={activeVehicle ? `${activeVehicle.name}: ${fmtNum(effectiveConsumption, 1)} L/100 km • ${neededLiters} L tanken` : 'Noch kein Fahrzeug angelegt'}
                onClose={close}
              />

              {vehicles.length > 0 && (
                <div className="option-list">
                  {vehicles.map((v) => {
                    const isSelected = activeVehicle?.id === v.id;
                    return (
                      <button key={v.id} type="button" className={`option-row ${isSelected ? 'is-selected' : ''}`} onClick={() => onSelectVehicle && onSelectVehicle(v.id)}>
                        <span className="option-row-icon"><Car size={14} /></span>
                        <span className="option-row-main">
                          <span className="option-row-title">{v.name}</span>
                          <span className="option-row-sub">
                            {fuelLabel(v.fuelType)} • {fmtNum(v.consumptionL100km, 1)} L/100 km • {v.tankCapacityL} L Tank
                          </span>
                        </span>
                        {isSelected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="drawer-slider">
                <div className="drawer-slider-head">
                  <span>Verbrauch</span>
                  <strong className="num-mono">{fmtNum(effectiveConsumption, 1)} L/100 km</strong>
                </div>
                <input
                  type="range"
                  min="3"
                  max="20"
                  step="0.1"
                  value={effectiveConsumption}
                  onChange={(e) => onUpdateCustomConsumption(parseFloat(e.target.value))}
                  aria-label="Verbrauch in Litern pro 100 Kilometer"
                />
                <div className="drawer-slider-head" style={{ marginTop: '0.55rem' }}>
                  <span>Zu tankende Menge{customLiters ? '' : ' (aus Tankstand)'}</span>
                  <strong className="num-mono">{neededLiters} L</strong>
                </div>
                <input
                  type="range"
                  min="5"
                  max={literMax}
                  step="5"
                  value={Math.min(literMax, neededLiters)}
                  onChange={(e) => onUpdateCustomLiters(parseFloat(e.target.value))}
                  aria-label="Zu tankende Menge in Litern"
                />
              </div>

              <div className="drawer-actions">
                {hasVehicleOverrides && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onResetVehicleOverrides}>
                    <RotateCcw size={12} />
                    <span>Fahrzeugwerte nutzen</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    close();
                    onOpenVehicleModal();
                  }}
                >
                  <Car size={13} />
                  <span>{vehicles.length > 0 ? 'Garage & Tankstand' : 'Fahrzeug anlegen'}</span>
                </button>
              </div>
            </div>
          )}

          {/* KRAFTSTOFF */}
          {activeDrawer === 'fuel' && (
            <div className="drawer-body">
              <DrawerHead title="Kraftstoffsorte" onClose={close} />
              <div className="option-grid is-3">
                {FUELS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`option-tile ${selectedFuel === f.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      close();
                      onSelectFuel(f.id);
                    }}
                    aria-pressed={selectedFuel === f.id}
                  >
                    <strong>{f.label}</strong>
                    <span>{f.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SORTIERUNG */}
          {activeDrawer === 'sort' && (
            <div className="drawer-body">
              <DrawerHead title="Sortierung" onClose={close} />
              <div className="option-grid">
                {sortOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`option-tile ${effectiveSort === s.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      close();
                      onSelectSort(s.id);
                    }}
                    aria-pressed={effectiveSort === s.id}
                  >
                    <strong>{s.label}</strong>
                    <span>{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
