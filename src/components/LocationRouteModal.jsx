import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Plus, Trash2, X, Download, Search, LocateFixed, RefreshCw, AlertCircle, CheckCircle2, Pencil, Check, Route as RouteIcon, Bookmark, AlertTriangle } from 'lucide-react';
import { locationService, getCurrentPosition } from '../services/locationService';
import { routeService, CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from '../services/routeService';
import { backupService, describeSaveResult } from '../services/backupService';
import { fmtNum, fmtDuration } from '../utils/format';
import { useEscapeToClose } from './modalHooks';

const RADIUS_PRESETS = [3, 5, 10, 15, 25];

/** Zwei Punkte gelten als identisch, wenn sie weniger als ~50 m auseinander liegen. */
function isSamePlace(a, b) {
  return !!a && !!b && Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lng - b.lng) < 0.0005;
}

function Msg({ msg }) {
  if (!msg) return null;
  return (
    <div className={`inline-msg is-${msg.type}`} role={msg.type === 'error' ? 'alert' : 'status'}>
      {msg.type === 'error' ? <AlertCircle size={14} /> : msg.type === 'warning' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      <span>{msg.text}</span>
    </div>
  );
}

/** Eintrag mit Umbenennen und Löschen (mit Rückfrage). */
function ManageItem({ title, sub, meta, isActive, activeLabel, badge, onActivate, activateLabel, onRename, onDelete, canDelete = true, extra, children }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const n = name.trim();
    if (n && n !== title) onRename(n);
    setEditing(false);
  };

  return (
    <div className={`manage-item ${isActive ? 'is-active' : ''}`}>
      <div className="manage-item-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          {editing ? (
            <form
              className="manage-item-rename"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus aria-label="Neuer Name" />
              <button type="submit" className="icon-btn" aria-label="Namen speichern"><Check size={15} /></button>
              <button type="button" className="icon-btn" aria-label="Abbrechen" onClick={() => { setName(title); setEditing(false); }}><X size={15} /></button>
            </form>
          ) : (
            <div className="manage-item-title">
              {badge && <span className="option-row-badge">{badge}</span>}
              <span>{title}</span>
              {isActive && <span className="badge badge-favorable" style={{ fontSize: '0.64rem', padding: '0.1rem 0.45rem' }}>{activeLabel || 'Aktiv'}</span>}
            </div>
          )}
          {sub && <div className="manage-item-sub">{sub}</div>}
          {meta && <div className="manage-item-meta">{meta}</div>}
        </div>
        {!editing && (
          <div className="manage-item-actions">
            {!isActive && onActivate && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onActivate}>{activateLabel || 'Anzeigen'}</button>
            )}
            {extra}
            {onRename && (
              <button type="button" className="icon-btn" onClick={() => { setName(title); setEditing(true); }} aria-label={`${title} umbenennen`} title="Umbenennen">
                <Pencil size={14} />
              </button>
            )}
            {canDelete && onDelete && (
              <button type="button" className="icon-btn is-danger" onClick={() => setConfirmDelete(true)} aria-label={`${title} löschen`} title="Löschen">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {confirmDelete && (
        <div className="inline-confirm">
          <span>„{title}“ löschen?</span>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirmDelete(false); onDelete(); }}>Löschen</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmDelete(false)}>Abbrechen</button>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Orte & Routen verwalten: Orte per Adresse, GPS oder Koordinaten anlegen, Radius je Ort,
 * feste Routen (z. B. Arbeitsweg) als Straßenroute berechnen und speichern.
 */
export default function LocationRouteModal({
  isOpen,
  onClose,
  locations = [],
  activeLocationId,
  onSelectLocation,
  onUpdateLocations,
  onUpdateRadius,
  routes = [],
  activeRouteId,
  onSelectRoute,
  onUpdateRoutes,
  initialTab = 'locations',
}) {
  const [tab, setTab] = useState(initialTab);
  const [footerMsg, setFooterMsg] = useState(null);
  useEscapeToClose(isOpen, onClose);

  // ---------------------------------------------------------------- Orte
  const [locName, setLocName] = useState('');
  const [locQuery, setLocQuery] = useState('');
  const [coordsMode, setCoordsMode] = useState(false);
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locRadius, setLocRadius] = useState(5);
  const [found, setFound] = useState(null); // { lat, lng, label, shortName }
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState(null);

  const activeLocation = locations.find((l) => l.id === activeLocationId) || null;

  const handleSearch = async () => {
    const q = locQuery.trim();
    if (!q) return;
    setLocBusy(true);
    setLocMsg(null);
    try {
      const geo = await locationService.geocodeAddress(q, { bias: activeLocation });
      if (geo) {
        setFound({ lat: geo.lat, lng: geo.lng, label: geo.displayName || q, shortName: q });
      } else {
        setFound(null);
        setLocMsg({ type: 'error', text: 'Adresse nicht gefunden. Prüfe die Schreibweise oder gib Koordinaten ein.' });
      }
    } catch (e) {
      setLocMsg({ type: 'error', text: `Suche fehlgeschlagen: ${e.message}` });
    } finally {
      setLocBusy(false);
    }
  };

  const handleGps = async () => {
    setLocBusy(true);
    setLocMsg(null);
    try {
      const pos = await getCurrentPosition({ timeoutMs: 10000 });
      let label = `${fmtNum(pos.lat, 5)}, ${fmtNum(pos.lng, 5)}`;
      let shortName = 'Mein Standort';
      try {
        const rev = await locationService.reverseGeocode(pos.lat, pos.lng);
        if (rev?.displayName) label = rev.displayName;
        if (rev?.shortName) shortName = rev.shortName;
      } catch {}
      setCoordsMode(false);
      setFound({ lat: pos.lat, lng: pos.lng, label, shortName });
      setLocQuery(shortName);
    } catch (e) {
      setLocMsg({ type: 'error', text: e.message });
    } finally {
      setLocBusy(false);
    }
  };

  const handleAddLocation = async (e) => {
    e.preventDefault();
    setLocBusy(true);
    setLocMsg(null);
    try {
      let point = null;
      if (coordsMode) {
        const lat = parseFloat(String(locLat).replace(',', '.'));
        const lng = parseFloat(String(locLng).replace(',', '.'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          throw new Error('Bitte gültige Koordinaten eingeben (z. B. 52,5200 und 13,4050).');
        }
        point = { lat, lng, label: locQuery.trim() || `${fmtNum(lat, 4)}, ${fmtNum(lng, 4)}`, shortName: '' };
      } else if (found) {
        point = found;
      } else if (locQuery.trim()) {
        const geo = await locationService.geocodeAddress(locQuery.trim(), { bias: activeLocation });
        if (!geo) throw new Error('Adresse nicht gefunden. Prüfe die Schreibweise oder gib Koordinaten ein.');
        point = { lat: geo.lat, lng: geo.lng, label: geo.displayName || locQuery.trim(), shortName: locQuery.trim() };
      } else {
        throw new Error('Bitte eine Adresse eingeben, „Mein Standort“ nutzen oder Koordinaten angeben.');
      }
      const name = locName.trim() || point.shortName || locQuery.trim() || 'Neuer Ort';
      const newLoc = await locationService.addLocation({
        name,
        address: point.label,
        lat: point.lat,
        lng: point.lng,
        radiusKm: locRadius,
      });
      onUpdateLocations(locationService.locations);
      onSelectLocation(newLoc.id);
      setLocName('');
      setLocQuery('');
      setLocLat('');
      setLocLng('');
      setFound(null);
      setLocMsg({ type: 'success', text: `✓ „${newLoc.name}“ angelegt und ausgewählt.` });
    } catch (err) {
      setLocMsg({ type: 'error', text: err.message });
    } finally {
      setLocBusy(false);
    }
  };

  const updateRadius = (id, km) => {
    if (onUpdateRadius) onUpdateRadius(id, km);
    else onUpdateLocations(locationService.updateLocation(id, { radiusKm: km }));
  };

  // ---------------------------------------------------------------- Routen
  const [startSel, setStartSel] = useState(() => activeLocationId || locations[0]?.id || 'custom');
  const [startQuery, setStartQuery] = useState('');
  const [endSel, setEndSel] = useState(() => locations.find((l) => l.id !== (activeLocationId || locations[0]?.id))?.id || 'custom');
  const [endQuery, setEndQuery] = useState('');
  const [routeName, setRouteName] = useState('');
  const [corridor, setCorridor] = useState(DEFAULT_CORRIDOR_KM);
  const [preview, setPreview] = useState(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [routeMsg, setRouteMsg] = useState(null);
  const geoCache = useRef(new Map());

  // Gelöschte Orte: Auswahl automatisch auf einen vorhandenen Ort setzen
  const startId = startSel === 'custom' || locations.some((l) => l.id === startSel) ? startSel : locations[0]?.id || 'custom';
  const endId = endSel === 'custom' || locations.some((l) => l.id === endSel) ? endSel : 'custom';

  const resolvePoint = useCallback(async (sel, query) => {
    if (sel && sel !== 'custom') {
      const loc = locations.find((l) => l.id === sel);
      const lat = parseFloat(loc?.lat);
      const lng = parseFloat(loc?.lng);
      return loc && Number.isFinite(lat) && Number.isFinite(lng) ? { name: loc.name, lat, lng } : null;
    }
    const q = (query || '').trim();
    if (q.length < 3) return null;
    if (geoCache.current.has(q)) return geoCache.current.get(q);
    const geo = await locationService.geocodeAddress(q, { bias: locations[0] || null });
    const point = geo ? { name: q, lat: geo.lat, lng: geo.lng } : null;
    geoCache.current.set(q, point);
    return point;
  }, [locations]);

  // Vorschau der Straßenroute, sobald Start und Ziel feststehen (entprellt, damit nicht bei jedem Tastendruck gesucht wird)
  useEffect(() => {
    if (!isOpen || tab !== 'routes') return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const start = await resolvePoint(startId, startQuery);
        const end = await resolvePoint(endId, endQuery);
        if (cancelled) return;
        if (!start || !end) {
          setPreview(null);
          return;
        }
        if (isSamePlace(start, end)) {
          setPreview(null);
          setRouteMsg({ type: 'error', text: 'Start und Ziel sind gleich – bitte zwei verschiedene Orte wählen.' });
          return;
        }
        setCalcBusy(true);
        const res = await routeService.calculateOsmRoute(start, end);
        if (!cancelled) {
          setPreview({ start, end, res });
          setRouteMsg(null);
        }
      } catch (e) {
        if (!cancelled) setRouteMsg({ type: 'error', text: e.message });
      } finally {
        setCalcBusy(false);
      }
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, tab, startId, endId, startQuery, endQuery, resolvePoint]);

  const handleAddRoute = async (e) => {
    e.preventDefault();
    setCalcBusy(true);
    setRouteMsg(null);
    try {
      const start = await resolvePoint(startId, startQuery);
      const end = await resolvePoint(endId, endQuery);
      if (!start) throw new Error('Startpunkt nicht gefunden – bitte Eingabe prüfen.');
      if (!end) throw new Error('Ziel nicht gefunden – bitte Eingabe prüfen.');
      if (isSamePlace(start, end)) throw new Error('Start und Ziel sind gleich – bitte zwei verschiedene Orte wählen.');
      const res = preview && isSamePlace(preview.start, start) && isSamePlace(preview.end, end) ? preview.res : await routeService.calculateOsmRoute(start, end);
      const name = routeName.trim() || `${start.name} → ${end.name}`;
      const newRoute = await routeService.addRoute({
        name,
        description: `${start.name} → ${end.name}`,
        startName: start.name,
        startCoords: { lat: start.lat, lng: start.lng },
        endName: end.name,
        endCoords: { lat: end.lat, lng: end.lng },
        totalDistanceKm: res.distanceKm,
        durationMin: res.durationMin,
        approximate: res.approximate,
        corridorRadiusKm: corridor,
        polylineCoords: res.polylineCoords,
      });
      onUpdateRoutes(routeService.routes);
      onSelectRoute(newRoute.id);
      setRouteName('');
      setPreview(null);
      setRouteMsg({ type: res.approximate ? 'warning' : 'success', text: res.approximate ? `„${newRoute.name}“ gespeichert – der Routing-Dienst war nicht erreichbar, der Korridor folgt vorerst der Luftlinie.` : `✓ „${newRoute.name}“ gespeichert und aktiviert.` });
    } catch (err) {
      setRouteMsg({ type: 'error', text: err.message });
    } finally {
      setCalcBusy(false);
    }
  };

  const handleSaveFile = async () => {
    try {
      const res = await backupService.saveToDatabase({ explicit: true });
      setFooterMsg({ type: res.success ? 'success' : 'error', text: describeSaveResult(res) });
    } catch (e) {
      setFooterMsg({ type: 'error', text: `Speichern fehlgeschlagen: ${e.message}` });
    }
  };

  if (!isOpen) return null;

  const sortedRoutes = [...routes].sort((a, b) => (b.isTrip ? 1 : 0) - (a.isTrip ? 1 : 0));
  const selectOptions = locations.map((l) => (
    <option key={l.id} value={l.id}>{l.name}</option>
  ));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Orte und Routen verwalten">
        <div className="modal-head">
          <div>
            <h3>Orte & Routen</h3>
            <p>Suchbereiche für das Radar und feste Strecken wie den Arbeitsweg</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className="nav-pill-group" style={{ marginBottom: '1rem' }} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'locations'} className={`nav-pill-btn ${tab === 'locations' ? 'active' : ''}`} onClick={() => setTab('locations')} style={{ flex: 1, justifyContent: 'center' }}>
            <MapPin size={14} />
            <span>Orte ({locations.length})</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'routes'} className={`nav-pill-btn ${tab === 'routes' ? 'active' : ''}`} onClick={() => setTab('routes')} style={{ flex: 1, justifyContent: 'center' }}>
            <RouteIcon size={14} />
            <span>Routen ({routes.length})</span>
          </button>
        </div>

        {tab === 'locations' && (
          <div>
            <div className="manage-list">
              {locations.map((loc) => (
                <ManageItem
                  key={loc.id}
                  title={loc.name}
                  sub={loc.address && loc.address !== loc.name ? loc.address : `${fmtNum(loc.lat, 4)}, ${fmtNum(loc.lng, 4)}`}
                  isActive={loc.id === activeLocationId && !activeRouteId}
                  onActivate={() => onSelectLocation(loc.id)}
                  activateLabel="Auswählen"
                  onRename={(name) => onUpdateLocations(locationService.updateLocation(loc.id, { name }))}
                  onDelete={() => onUpdateLocations(locationService.deleteLocation(loc.id))}
                  canDelete={locations.length > 1}
                >
                  <div className="manage-item-slider">
                    <span>Radius</span>
                    <input
                      type="range"
                      min="1"
                      max="25"
                      step="1"
                      value={Number(loc.radiusKm || 5)}
                      onChange={(e) => updateRadius(loc.id, parseFloat(e.target.value) || 5)}
                      aria-label={`Suchradius für ${loc.name}`}
                    />
                    <strong className="num-mono">{Number(loc.radiusKm || 5)} km</strong>
                  </div>
                </ManageItem>
              ))}
            </div>

            <form className="form-section" onSubmit={handleAddLocation}>
              <h4>Neuen Ort anlegen</h4>

              {!coordsMode ? (
                <div className="field">
                  <label className="field-label" htmlFor="loc-query">Adresse oder Ort</label>
                  <div className="input-with-btn">
                    <input
                      id="loc-query"
                      className="text-input"
                      type="text"
                      placeholder="z. B. Hauptstraße 5, Bielefeld"
                      value={locQuery}
                      onChange={(e) => {
                        setLocQuery(e.target.value);
                        setFound(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !found) {
                          e.preventDefault();
                          handleSearch();
                        }
                      }}
                      autoComplete="street-address"
                      enterKeyHint="search"
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleSearch} disabled={locBusy || !locQuery.trim()}>
                      <Search size={13} />
                      <span>Suchen</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <div className="field">
                    <label className="field-label" htmlFor="loc-lat">Breitengrad</label>
                    <input id="loc-lat" className="text-input" inputMode="decimal" placeholder="52,5200" value={locLat} onChange={(e) => setLocLat(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="loc-lng">Längengrad</label>
                    <input id="loc-lng" className="text-input" inputMode="decimal" placeholder="13,4050" value={locLng} onChange={(e) => setLocLng(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="form-links">
                <button type="button" className="text-link" onClick={handleGps} disabled={locBusy}>
                  <LocateFixed size={13} /> Mein Standort
                </button>
                <button type="button" className="text-link" onClick={() => { setCoordsMode((v) => !v); setFound(null); }}>
                  {coordsMode ? 'Adresse eingeben' : 'Koordinaten eingeben'}
                </button>
              </div>

              {found && !coordsMode && (
                <div className="found-box">
                  <CheckCircle2 size={14} />
                  <span>{found.label}</span>
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="loc-name">Name (optional)</label>
                <input id="loc-name" className="text-input" type="text" placeholder={found?.shortName || 'z. B. Zuhause, Arbeit, Eltern'} value={locName} onChange={(e) => setLocName(e.target.value)} maxLength={80} />
              </div>

              <div className="field">
                <span className="field-label">Suchradius</span>
                <div className="chip-row">
                  {RADIUS_PRESETS.map((r) => (
                    <button key={r} type="button" className={`chip-btn ${locRadius === r ? 'active' : ''}`} onClick={() => setLocRadius(r)} aria-pressed={locRadius === r}>
                      {r} km
                    </button>
                  ))}
                </div>
              </div>

              <Msg msg={locMsg} />

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={locBusy}>
                {locBusy ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{locBusy ? 'Suche Ort …' : 'Ort speichern'}</span>
              </button>
            </form>
          </div>
        )}

        {tab === 'routes' && (
          <div>
            {sortedRoutes.length > 0 ? (
              <div className="manage-list">
                {sortedRoutes.map((r) => (
                  <ManageItem
                    key={r.id}
                    title={r.name}
                    badge={r.isTrip ? 'Fahrt' : null}
                    sub={`${r.startName || 'Start'} → ${r.endName || 'Ziel'}`}
                    meta={`${fmtNum(r.totalDistanceKm, 1)} km${r.durationMin ? ` • ca. ${fmtDuration(r.durationMin)}` : ''} • Korridor ±${fmtNum(r.corridorRadiusKm || DEFAULT_CORRIDOR_KM, 1)} km • ${r.approximate ? 'Luftlinie (Routing war nicht erreichbar)' : 'Straßenroute'}`}
                    isActive={r.id === activeRouteId}
                    onActivate={() => onSelectRoute(r.id)}
                    activateLabel="Anzeigen"
                    onRename={(name) => onUpdateRoutes(routeService.updateRoute(r.id, { name }))}
                    onDelete={() => onUpdateRoutes(routeService.deleteRoute(r.id))}
                    extra={r.isTrip ? (
                      <button type="button" className="icon-btn" title="Dauerhaft als Route behalten" aria-label="Dauerhaft als Route behalten" onClick={() => onUpdateRoutes(routeService.updateRoute(r.id, { isTrip: false }))}>
                        <Bookmark size={14} />
                      </button>
                    ) : null}
                  />
                ))}
                {activeRouteId && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelectRoute(null)}>
                    <MapPin size={13} />
                    <span>Route abwählen – zurück zum Standort</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="drawer-empty" style={{ marginBottom: '1rem' }}>
                <RouteIcon size={20} color="#94A3B8" />
                <strong>Noch keine Route gespeichert</strong>
                <span>Lege unten eine feste Strecke an. Für spontane Fahrten nutze „Fahrt planen“.</span>
              </div>
            )}

            <form className="form-section" onSubmit={handleAddRoute}>
              <h4>Neue Route</h4>
              <div className="form-row">
                <div className="field">
                  <label className="field-label" htmlFor="route-start">Start</label>
                  <select id="route-start" className="select-input" value={startId} onChange={(e) => setStartSel(e.target.value)}>
                    {selectOptions}
                    <option value="custom">Andere Adresse …</option>
                  </select>
                  {startId === 'custom' && (
                    <input className="text-input" style={{ marginTop: '0.35rem' }} type="text" placeholder="Start-Adresse" value={startQuery} onChange={(e) => setStartQuery(e.target.value)} />
                  )}
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="route-end">Ziel</label>
                  <select id="route-end" className="select-input" value={endId} onChange={(e) => setEndSel(e.target.value)}>
                    {selectOptions}
                    <option value="custom">Andere Adresse …</option>
                  </select>
                  {endId === 'custom' && (
                    <input className="text-input" style={{ marginTop: '0.35rem' }} type="text" placeholder="Ziel-Adresse" value={endQuery} onChange={(e) => setEndQuery(e.target.value)} />
                  )}
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="route-name">Name (optional)</label>
                <input
                  id="route-name"
                  className="text-input"
                  type="text"
                  placeholder={preview ? `${preview.start.name} → ${preview.end.name}` : 'z. B. Arbeitsweg'}
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  maxLength={80}
                />
              </div>

              <div className="field">
                <span className="field-label">Korridor links und rechts der Strecke</span>
                <div className="corridor-chips" role="group" aria-label="Korridor-Breite">
                  {CORRIDOR_OPTIONS.map((rad) => (
                    <button key={rad} type="button" className={Math.abs(corridor - rad) < 0.2 ? 'active' : ''} onClick={() => setCorridor(rad)}>
                      ±{fmtNum(rad, rad % 1 ? 1 : 0)} km
                    </button>
                  ))}
                </div>
              </div>

              {calcBusy && !preview && (
                <div className="inline-msg is-info">
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Berechne Straßenroute …</span>
                </div>
              )}

              {preview && (
                <div className={`route-preview ${preview.res.approximate ? 'is-approx' : ''}`}>
                  <div className="route-preview-head">
                    {preview.res.approximate ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                    <span>{preview.res.approximate ? 'Nur Luftlinie – Routing-Dienst nicht erreichbar' : 'Straßenroute berechnet'}</span>
                    {calcBusy && <RefreshCw size={12} className="animate-spin" />}
                  </div>
                  <div className="route-preview-figures">
                    <div>
                      <span>Strecke</span>
                      <strong className="num-mono">{fmtNum(preview.res.distanceKm, 1)} km</strong>
                    </div>
                    <div>
                      <span>Fahrzeit</span>
                      <strong className="num-mono">ca. {fmtDuration(preview.res.durationMin) || '–'}</strong>
                    </div>
                  </div>
                </div>
              )}

              <Msg msg={routeMsg} />

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={calcBusy}>
                {calcBusy ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>{calcBusy ? 'Berechne …' : 'Route speichern & anzeigen'}</span>
              </button>
            </form>
          </div>
        )}

        <Msg msg={footerMsg} />
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
