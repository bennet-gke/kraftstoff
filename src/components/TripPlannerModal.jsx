import React, { useState, useEffect, useRef } from 'react';
import { Route, X, MapPin, Link as LinkIcon, ClipboardPaste, LocateFixed, RefreshCw, CheckCircle2, AlertCircle, Navigation, ChevronDown, ChevronUp } from 'lucide-react';
import { locationService, getCurrentPosition } from '../services/locationService';
import { routeService, CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from '../services/routeService';
import { parseNavigationText, parseCoordinate } from '../services/navLinkParser';

// Namen aus fremden Links nie als HTML verwenden und sinnvoll kürzen
const cleanName = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const canReadClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && (typeof window === 'undefined' || window.isSecureContext !== false);
const looksLikeCoords = (s) => /^-?\d{1,3}(?:[.,]\d+)?\s*,\s*-?\d{1,3}(?:[.,]\d+)?$/.test(String(s || '').trim());

/** Punkte, die nur als Koordinaten bekannt sind (z. B. Apple-Karten-Links), bekommen einen Ortsnamen. */
async function withFriendlyName(place, { withRoad = false } = {}) {
  if (!place || (place.name && !looksLikeCoords(place.name))) return place;
  try {
    const rev = await Promise.race([
      locationService.reverseGeocode(place.lat, place.lng),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    if (rev?.shortName && rev.shortName !== 'Aktueller Standort') {
      return { ...place, name: cleanName(withRoad && rev.road ? `${rev.road}, ${rev.shortName}` : rev.shortName) };
    }
  } catch {}
  return place;
}

/**
 * Fahrt planen: Navigation aus Google Maps / Apple Karten übernehmen (Zwischenablage oder Link) oder
 * Ziel eingeben. Start = GPS, Start aus dem Link oder ein gespeicherter Ort. Danach reale Straßenroute (OSRM)
 * und alle Tankstellen im Korridor.
 */
export default function TripPlannerModal({ isOpen, onClose, locations = [], activeLocation = null, onPlanTrip, initialLink = null, initialDestination = null, defaultCorridorKm = DEFAULT_CORRIDOR_KM }) {
  const [destText, setDestText] = useState(initialDestination || '');
  const [linkText, setLinkText] = useState(initialLink || '');
  const [showLinkInput, setShowLinkInput] = useState(!canReadClipboard || !!initialLink);
  const [startMode, setStartMode] = useState('gps'); // 'gps' | 'link' | <location id>
  const [corridorKm, setCorridorKm] = useState(defaultCorridorKm);
  const [parsed, setParsed] = useState(null); // { provider, origin, destination }
  const [resolvedDest, setResolvedDest] = useState(null); // { name, lat, lng } aus dem Link
  const [busy, setBusy] = useState(null); // 'link' | 'plan' | null
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const autoRan = useRef(false);

  const providerLabel = (p) => (p === 'apple' ? 'Apple Karten' : 'Google Maps');

  /** { name, query, lat, lng } → Koordinaten (Link-Koordinaten, "lat,lng" oder Adresssuche) */
  const resolvePlace = async (place) => {
    if (place.lat != null && place.lng != null) return { name: cleanName(place.name), lat: place.lat, lng: place.lng };
    const text = String(place.query || place.name || '').trim();
    const c = parseCoordinate(text);
    if (c) return { name: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, lat: c.lat, lng: c.lng };
    const geo = await locationService.geocodeAddress(text, { bias: activeLocation });
    if (!geo) throw new Error(`„${cleanName(text)}“ wurde nicht gefunden. Bitte Ort oder Adresse genauer angeben.`);
    return { name: cleanName(text), address: geo.displayName, lat: geo.lat, lng: geo.lng };
  };

  const resolveStart = async (mode, parsedLink) => {
    if (mode === 'link' && parsedLink?.origin) return resolvePlace(parsedLink.origin);
    if (mode === 'gps') {
      try {
        const pos = await getCurrentPosition({ timeoutMs: 10000 });
        let name = 'Mein Standort';
        try {
          const rev = await locationService.reverseGeocode(pos.lat, pos.lng);
          if (rev?.shortName) name = `Standort (${cleanName(rev.shortName)})`;
        } catch {}
        return { ...pos, name, isGps: true };
      } catch (e) {
        if (activeLocation?.lat && activeLocation?.lng) {
          setNote(`Kein GPS (${e.message}) – Start ist „${activeLocation.name}“.`);
          return { name: activeLocation.name, lat: activeLocation.lat, lng: activeLocation.lng };
        }
        throw e;
      }
    }
    const loc = locations.find((l) => l.id === mode);
    if (loc) return { name: loc.name, lat: loc.lat, lng: loc.lng };
    throw new Error('Bitte einen Startpunkt wählen.');
  };

  const plan = async ({ dest = resolvedDest, destInput = destText, mode = startMode, parsedLink = parsed } = {}) => {
    setBusy('plan');
    setError(null);
    try {
      const input = String(destInput || '').trim();
      if (!input && !dest) throw new Error('Bitte ein Ziel eingeben oder eine Navigation aus Google Maps / Apple Karten übernehmen.');
      const rawEnd = dest && (!input || input === dest.name) ? dest : await resolvePlace({ name: input, query: input });
      const rawStart = await resolveStart(mode, parsedLink);
      const [start, end] = await Promise.all([withFriendlyName(rawStart), withFriendlyName(rawEnd, { withRoad: true })]);
      if (Math.abs(start.lat - end.lat) < 0.0005 && Math.abs(start.lng - end.lng) < 0.0005) throw new Error('Start und Ziel sind identisch.');
      const osrm = await routeService.calculateOsmRoute(start, end);
      await onPlanTrip({ start, end, corridorKm, osrm });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  /** Link lesen und – wenn ein Ziel erkannt wurde – direkt planen. */
  const handleLink = async (text = linkText, { autoPlan = true } = {}) => {
    if (!String(text || '').trim()) {
      setError('Bitte zuerst einen Link einfügen.');
      return;
    }
    setBusy('link');
    setError(null);
    setNote(null);
    try {
      const p = await parseNavigationText(text);
      if (p.error || !p.destination) {
        setParsed(null);
        setError(p.error || 'Im Link wurde kein Ziel gefunden.');
        setShowLinkInput(true);
        return;
      }
      const destination = { ...p.destination, name: cleanName(p.destination.name || p.destination.query) };
      const origin = p.origin ? { ...p.origin, name: cleanName(p.origin.name || p.origin.query) } : null;
      const next = { ...p, destination, origin };
      setParsed(next);
      setDestText(destination.name || '');
      const dest = destination.lat != null ? { name: destination.name, lat: destination.lat, lng: destination.lng } : null;
      setResolvedDest(dest);
      const mode = origin ? 'link' : 'gps';
      setStartMode(mode);
      setNote(`${providerLabel(p.provider)}: Ziel „${destination.name}“, Start ${origin ? `„${origin.name}“` : 'ist dein Standort'}.`);
      setBusy(null);
      if (autoPlan) await plan({ dest, destInput: destination.name, mode, parsedLink: next });
    } catch (e) {
      setError(e.message);
      setShowLinkInput(true);
    } finally {
      setBusy((b) => (b === 'link' ? null : b));
    }
  };

  const handlePasteFromClipboard = async () => {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setError('Die Zwischenablage ist leer. In der Karten-App „Teilen → Link kopieren“ tippen.');
        return;
      }
      setLinkText(text);
      await handleLink(text);
    } catch {
      setShowLinkInput(true);
      setError('Kein Zugriff auf die Zwischenablage – bitte den Link ins Feld einfügen.');
    }
  };

  // Aus einem Start-Link geöffnet (Kurzbefehl, Teilen an die App): sofort auswerten
  useEffect(() => {
    if (!isOpen || autoRan.current) return;
    autoRan.current = true;
    if (initialLink) handleLink(initialLink);
    else if (initialDestination) plan({ dest: null, destInput: initialDestination, mode: 'gps' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const isBusy = !!busy;

  return (
    <div className="modal-backdrop" onClick={isBusy ? undefined : onClose}>
      <div className="modal-content" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="modal-head-icon" style={{ background: '#2563EB' }}>
              <Route size={18} />
            </div>
            <div>
              <h3>Fahrt planen</h3>
              <p>Tankstellen entlang deiner Navigation – mit Umweg, Preis und Tankwart-Tipp</p>
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        {/* 1. Navigation übernehmen */}
        <div className="planner-card is-primary">
          <div className="planner-card-title"><LinkIcon size={15} color="#2563EB" /> <span>Navigation aus Google Maps / Apple Karten</span></div>
          <p className="planner-card-text">In der Karten-App Route oder Ziel öffnen → „Teilen“ → „Link kopieren“, dann hier übernehmen. Start und Ziel werden erkannt und die Fahrt sofort geplant.</p>
          {canReadClipboard && (
            <button type="button" className="btn btn-primary planner-big-btn" onClick={handlePasteFromClipboard} disabled={isBusy}>
              {busy === 'link' ? <RefreshCw size={15} className="animate-spin" /> : <ClipboardPaste size={15} />}
              <span>{busy === 'link' ? 'Link wird gelesen …' : 'Aus Zwischenablage übernehmen'}</span>
            </button>
          )}
          <button type="button" className="planner-toggle" onClick={() => setShowLinkInput((v) => !v)}>
            {showLinkInput ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            <span>Link selbst einfügen</span>
          </button>
          {showLinkInput && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              <input
                type="url"
                inputMode="url"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) handleLink(); }}
                placeholder="https://maps.app.goo.gl/… oder https://maps.apple.com/…"
                spellCheck={false}
                className="planner-input mono"
                style={{ flex: '1 1 240px' }}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleLink()} disabled={isBusy || !linkText.trim()}>
                <Navigation size={13} />
                <span>Übernehmen</span>
              </button>
            </div>
          )}
        </div>

        {/* 2. Oder Ziel eingeben */}
        <div className="planner-card">
          <div className="planner-card-title"><MapPin size={15} color="#DC2626" /> <span>Oder Ziel eingeben</span></div>
          <input
            type="text"
            value={destText}
            onChange={(e) => { setDestText(e.target.value); if (resolvedDest && e.target.value.trim() !== resolvedDest.name) setResolvedDest(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isBusy) plan(); }}
            placeholder="Ort oder Adresse, z.B. Hamburg Hauptbahnhof"
            className="planner-input"
            enterKeyHint="go"
          />
          <div className="planner-row">
            <LocateFixed size={14} color="#059669" />
            <select value={startMode} onChange={(e) => setStartMode(e.target.value)} className="planner-input" aria-label="Start">
              <option value="gps">Start: mein aktueller Standort (GPS)</option>
              {parsed?.origin && <option value="link">Start aus dem Link: {parsed.origin.name}</option>}
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>Start: {loc.name}</option>
              ))}
            </select>
          </div>
          <div className="corridor-chips" role="group" aria-label="Korridor-Breite" style={{ marginTop: '0.6rem' }}>
            <span>Korridor um die Strecke:</span>
            {CORRIDOR_OPTIONS.map((rad) => (
              <button key={rad} type="button" className={Math.abs(corridorKm - rad) < 0.2 ? 'active' : ''} onClick={() => setCorridorKm(rad)}>
                ±{String(rad).replace('.', ',')} km
              </button>
            ))}
          </div>
        </div>

        {note && (
          <div className="inline-msg is-success">
            <CheckCircle2 size={14} />
            <span>{note}</span>
          </div>
        )}
        {error && (
          <div className="inline-msg is-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isBusy}>Abbrechen</button>
          <button type="button" className="btn btn-primary" onClick={() => plan()} disabled={isBusy} style={{ borderRadius: '9999px', padding: '0.6rem 1.2rem', fontWeight: 700 }}>
            {busy === 'plan' ? <RefreshCw size={14} className="animate-spin" /> : <Route size={14} />}
            <span>{busy === 'plan' ? 'Route wird berechnet …' : 'Fahrt planen'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
