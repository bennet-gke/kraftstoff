import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import {
  Fuel,
  Map as MapIcon,
  BarChart3,
  Sparkles,
  BellRing,
  Settings,
  Car,
  MapPin,
  RefreshCw,
  ChevronRight,
  Cloud,
  Star,
  AlertTriangle,
  Key,
  Navigation,
  Route as RouteIcon,
  X,
  WifiOff,
  Menu,
  Scale,
} from 'lucide-react';

import { dataService } from './services/dataService';
import { vehicleService } from './services/vehicleService';
import { locationService, getCurrentPosition } from './services/locationService';
import { routeService, findClosestPointOnRoute, CORRIDOR_OPTIONS, DEFAULT_CORRIDOR_KM } from './services/routeService';
import { lawService } from './services/lawService';
import { notificationService } from './services/notificationService';
import { fuelLabel, fmtKm, fmtNum } from './utils/format';
import { backupService, describeCounts, describeSaveResult } from './services/backupService';
import { priceHistoryService } from './services/priceHistoryService';
import { readLaunchParams, clearLaunchParams } from './services/launchParams';

import { evaluatePriceEngine } from './engine/adaptiveAverage';
import { calculateDetourProfitability } from './engine/detourCalculator';
import { buildArrivalOutlook } from './engine/arrivalOutlook';
import { buildRegionalProfile, summarizeRegionNow, findBestWindows, detectRecentPriceMoves, priorForRules } from './engine/regionalTrends';
import { compileRules, describeRuleState } from './engine/priceRules';
import { scoreStation, buildTankwartAdvice, rankByFillCost } from './engine/advisor';
import { initModel, trainOnHistory, resetModel, subscribeMLStatus, forecastStationCurve } from './engine/mlModel';
import { neededLitersFor } from './engine/vehicleMath';

import StationCard from './components/StationCard';
import RuleBanner from './components/RuleBanner';
import LawsModal from './components/LawsModal';
import MoreMenuSheet from './components/MoreMenuSheet';
import { SheetSwipeCloser, PullToRefresh } from './components/MobileGestures';
import RouteScheduleBar from './components/RouteScheduleBar';
import VehicleGarageModal from './components/VehicleGarageModal';
import LocationRouteModal from './components/LocationRouteModal';
import PushNotificationManager from './components/PushNotificationManager';
import SettingsModal from './components/SettingsModal';
import ICloudSyncModal from './components/ICloudSyncModal';
import DatabaseSetupScreen from './components/DatabaseSetupScreen';
import DatabaseStatusBanner from './components/DatabaseStatusBanner';
import TripPlannerModal from './components/TripPlannerModal';
import TripBar from './components/TripBar';
import SectionBoundary from './components/SectionBoundary';

// Schwere Bereiche (Leaflet, D3) erst bei Bedarf laden – der Start bleibt schnell
const StationMapView = lazy(() => import('./components/StationMapView'));
const RegionalTrendsPanel = lazy(() => import('./components/RegionalTrendsPanel'));
const TankwartPanel = lazy(() => import('./components/TankwartPanel'));
const StationDetailModal = lazy(() => import('./components/StationDetailModal'));

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const CLOCK_TICK_MS = 5 * 60 * 1000;
const TRIP_PROGRESS_INTERVAL_MS = 3 * 60 * 1000;

function LazyFallback({ label = 'Wird geladen …' }) {
  return (
    <div className="lazy-fallback">
      <RefreshCw size={16} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function fmtTime(d) {
  return d ? new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
}

export default function App() {
  // Navigation: 'stations' | 'map' | 'analytics' | 'ml'
  const [activeTab, setActiveTab] = useState('stations');

  // Daten & Einstellungen
  const [hasValidApiKey, setHasValidApiKey] = useState(() => dataService.hasValidTankerkoenigKey());
  const [stations, setStations] = useState([]);
  const [settings, setSettings] = useState(dataService.userSettings);
  const [selectedFuel, setSelectedFuel] = useState(settings.fuelPreference || 'diesel');
  const [sortBy, setSortBy] = useState(() => (routeService.getActiveRoute()?.isTrip ? 'route_progress' : 'score'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [fetchInfo, setFetchInfo] = useState(dataService.lastFetchInfo);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [mlStatus, setMlStatus] = useState({ ready: false, phase: 'idle' });
  const [apiError, setApiError] = useState(null);
  const [dbStatus, setDbStatus] = useState(() => backupService.getStatus());
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);

  // Fahrzeug
  const [vehicles, setVehicles] = useState(vehicleService.vehicles);
  const [activeVehicleId, setActiveVehicleId] = useState(vehicleService.activeVehicleId);

  // Standort & Routen
  const [locations, setLocations] = useState(locationService.locations);
  const [activeLocationId, setActiveLocationId] = useState(locationService.activeLocationId);
  const [routes, setRoutes] = useState(routeService.routes);
  const [laws, setLaws] = useState(lawService.laws);
  const [activeRouteId, setActiveRouteId] = useState(routeService.activeRouteId);
  const [tripProgress, setTripProgress] = useState(null); // { km, offRouteKm, at }

  // Favoriten & Filter
  const [favoriteStationIds, setFavoriteStationIds] = useState(() => dataService.getFavoriteStationIds());
  const [filterMode, setFilterMode] = useState(() => (routeService.activeRouteId ? 'route' : 'location'));

  // Fahrt-Option & Fahrzeug-Overrides
  const [detourMode, setDetourMode] = useState(routeService.activeRouteId ? 'route_corridor' : 'local_roundtrip');
  const [customConsumption, setCustomConsumption] = useState(null);
  const [customLiters, setCustomLiters] = useState(null);

  // Modals
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isLocRouteModalOpen, setIsLocRouteModalOpen] = useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLawsModalOpen, setIsLawsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isICloudModalOpen, setIsICloudModalOpen] = useState(false);
  const [isTripModalOpen, setIsTripModalOpen] = useState(false);
  const [tripInitial, setTripInitial] = useState(null); // { link, destination } aus Start-Links
  const [selectedStationForDetail, setSelectedStationForDetail] = useState(null);
  const [mapFocusStation, setMapFocusStation] = useState(null);
  const [toast, setToast] = useState(null); // { type, message }

  // Aktive Objekte
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) || vehicles[0];
  const activeLocation = locations.find((l) => l.id === activeLocationId) || locations[0];
  const activeRoute = routes.find((r) => r.id === activeRouteId) || null;
  const isDbReady = !!dbStatus.isConnected;
  const fillLiters = customLiters || neededLitersFor(activeVehicle);

  // Aktuelle Werte für Hintergrund-Abläufe (Intervalle, Ereignisse) ohne veraltete Closures
  const filterModeRef = useRef(filterMode);
  filterModeRef.current = filterMode;
  const selectedFuelRef = useRef(selectedFuel);
  selectedFuelRef.current = selectedFuel;
  const lastUpdatedRef = useRef(lastUpdatedAt);
  lastUpdatedRef.current = lastUpdatedAt;
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const trainTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const loadSeqRef = useRef(0);
  const radiusTimerRef = useRef(null);
  const launchRef = useRef(readLaunchParams());

  const showToast = useCallback((message, type = 'success', ms = 5500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  // ---------------------------------------------------------------------
  // Laden der Tankstellen
  // ---------------------------------------------------------------------

  const profileRef = useRef(null);
  const scheduleTraining = useCallback((fuel, force = false) => {
    if (trainTimerRef.current) clearTimeout(trainTimerRef.current);
    trainTimerRef.current = setTimeout(() => {
      // Nur die Stationen des aktuellen Bereichs (schneller, passend zum Regionsprofil)
      const all = priceHistoryService.getFuelMap(fuel);
      const ids = new Set(stationsRef.current.map((s) => s.id));
      const readingsMap = new Map([...all].filter(([id]) => ids.has(id)));
      const meta = new Map(stationsRef.current.map((s) => [s.id, { brand: s.brand }]));
      trainOnHistory({ readingsMap, stationsMeta: meta, epochs: 3, force, profile: profileRef.current }).catch(() => {});
    }, force ? 50 : 4000);
  }, []);

  /**
   * Lädt die Tankstellen für den aktuellen Bereich. Quelle der Wahrheit sind die Dienste (aktiver Ort/Route),
   * ältere Antworten werden verworfen, wenn inzwischen eine neuere Anfrage läuft.
   */
  const loadData = useCallback(async ({ fuel = selectedFuelRef.current, mode = filterModeRef.current } = {}) => {
    const seq = ++loadSeqRef.current;
    setIsRefreshing(true);
    setHasValidApiKey(dataService.hasValidTankerkoenigKey());
    try {
      let data;
      const route = routeService.getActiveRoute();
      if (mode === 'favorites') data = await dataService.getFavoriteStations(fuel, locationService.getActiveLocation());
      else if (mode === 'route' && route) data = await dataService.getStationsForRoute(fuel, route);
      else data = await dataService.getStationsWithPrices(fuel, locationService.getActiveLocation());
      if (seq !== loadSeqRef.current) return;
      setStations(data);
      setLastUpdatedAt(new Date());
      setApiError(dataService.lastApiError);
      setFetchInfo({ ...dataService.lastFetchInfo });
      if (data.length > 0) scheduleTraining(fuel);
    } catch (e) {
      if (seq === loadSeqRef.current) setApiError({ kind: 'network', message: e?.message || 'Unbekannter Fehler', at: Date.now() });
    } finally {
      if (seq === loadSeqRef.current) setIsRefreshing(false);
    }
  }, [scheduleTraining]);

  /** Zustand aus den Diensten übernehmen (nach Datei-Laden, anderem Tab, Zusammenführen) und neu laden. */
  const refreshFromServices = useCallback(({ load = true } = {}) => {
    setVehicles([...vehicleService.vehicles]);
    setActiveVehicleId(vehicleService.activeVehicleId);
    setLocations([...locationService.locations]);
    setActiveLocationId(locationService.activeLocationId);
    setRoutes([...routeService.routes]);
    setActiveRouteId(routeService.activeRouteId);
    setLaws([...lawService.laws]);
    setSettings({ ...dataService.userSettings });
    setFavoriteStationIds([...dataService.getFavoriteStationIds()]);
    setHasValidApiKey(dataService.hasValidTankerkoenigKey());
    const mode = routeService.getActiveRoute() ? 'route' : filterModeRef.current === 'favorites' ? 'favorites' : 'location';
    setFilterMode(mode);
    setDetourMode(mode === 'route' ? 'route_corridor' : 'local_roundtrip');
    const fuel = dataService.userSettings.fuelPreference || selectedFuelRef.current;
    setSelectedFuel(fuel);
    if (load) loadData({ fuel, mode });
  }, [loadData]);

  // Erststart ohne eigenen Standort: GPS-Standort anbieten (erst nach der Datenbank-Einrichtung)
  const maybeOfferGps = useCallback(async () => {
    let hasCustomLoc = false;
    try { hasCustomLoc = !!localStorage.getItem('kraftstoff_custom_location_set'); } catch {}
    if (hasCustomLoc) return;
    try {
      const pos = await getCurrentPosition({ timeoutMs: 8000 });
      const res = await locationService.createOrUpdateGpsLocation(pos.lat, pos.lng);
      setLocations([...res.locations]);
      setActiveLocationId(res.location.id);
      if (!routeService.getActiveRoute()) loadData({ mode: 'location' });
    } catch {}
  }, [loadData]);

  // Datenbank-Ordner verbunden bzw. neueste Datei geladen (Erststart, Ordnerwechsel, Neuverbindung, Dateiauswahl)
  const handleDbConnected = (res) => {
    setDbStatus(backupService.getStatus());
    setIsDbSetupOpen(false);
    refreshFromServices();
    if (res) {
      const message = res.loaded
        ? `✓ Neueste Datei geladen (${res.fileName}): ${describeCounts(res)}${res.keptLocalChanges ? ' – neuere Änderungen auf diesem Gerät bleiben erhalten' : ''}.`
        : res.offline
          ? `${res.message || 'Mac-Server nicht erreichbar.'} Du arbeitest lokal weiter.`
          : `✓ ${res.message || 'Verbunden.'}${res.hasKey === false ? ' Jetzt den Tankerkönig-Key eintragen.' : ''}`;
      showToast(message, res.offline ? 'warning' : 'success', 7000);
    }
    maybeOfferGps();
  };

  const showDbError = (message) => showToast(message, 'error', 6500);

  // Neueste Datei erneut laden (Mac-Server / freigegebener Ordner)
  const handleReconnectDb = async () => {
    const res = await backupService.loadNewest();
    if (res.success) handleDbConnected(res);
    else showDbError(res.message || 'Der Ordner ist weiterhin nicht erreichbar.');
  };

  // Vom Nutzer ausgelöstes Speichern: neue Datei mit Zeitstempel (iPhone: Teilen-Dialog / Download)
  const handleSaveDbNow = async () => {
    try {
      const res = await backupService.saveToDatabase({ explicit: true });
      if (!res.success) {
        if (res.method !== 'busy') showDbError(res.message || 'Speichern fehlgeschlagen.');
        return;
      }
      showToast(describeSaveResult(res), 'success', 6500);
    } catch (e) {
      showDbError(e.message);
    }
  };

  // ---------------------------------------------------------------------
  // Start, Hintergrund-Aktualisierung, Ereignisse
  // ---------------------------------------------------------------------

  useEffect(() => {
    let isCancelled = false;

    const unsubHistory = priceHistoryService.subscribe((v) => setHistoryVersion(v));
    const unsubMl = subscribeMLStatus((s) => setMlStatus(s));
    const unsubDb = backupService.subscribe((st) => setDbStatus(st));
    // Neuere Daten eines anderen Geräts wurden im Hintergrund übernommen
    const unsubData = backupService.subscribeData((info) => {
      if (!info?.background) return;
      refreshFromServices();
      if (info.changed) showToast(`✓ Neuere Daten${info.savedBy ? ` vom ${info.savedBy}` : ''} übernommen (${info.fileName}).`, 'success', 6000);
    });

    const initAppData = async () => {
      // 1. Preishistorie laden, API-Key aus IndexedDB wiederherstellen, Server-Key prüfen
      await priceHistoryService.init();
      try { await dataService.restoreFromIndexedDb(); } catch {}
      dataService.probeServerKey().then(() => {
        if (!isCancelled) setHasValidApiKey(dataService.hasValidTankerkoenigKey());
      });

      // Signalton auf dem iPhone nach der ersten Berührung freischalten
      notificationService.armAudioUnlock();

      // 2. Datenbank-Ordner: gespeicherte Zugriffsart wiederherstellen und die neueste Datei laden
      let connected = null;
      try {
        connected = await backupService.autoConnect();
      } catch (err) {
        console.warn('Datenbank-Verbindung beim Start:', err);
      }
      if (isCancelled) return;

      backupService.arm();
      setDbStatus(backupService.getStatus());
      if (connected?.success) {
        refreshFromServices();
        maybeOfferGps();
        if (connected.offline) showToast(`${connected.message || 'Mac-Server nicht erreichbar.'} Du arbeitest lokal weiter.`, 'warning', 7000);
      } else if (connected?.reason === 'safe-mode') {
        showToast('Abgesicherter Start: Die Datenbank-Datei wurde nicht automatisch geladen. Verbinde sie neu, sobald alles läuft.', 'warning', 9000);
      }

      // 3. KI (TensorFlow.js) erst nach dem Start im Hintergrund nachladen
      setTimeout(() => initModel().catch(() => {}), 3000);
    };

    initAppData();

    // Preiswächter nur bei sichtbarer App. Tankerkönig bittet um möglichst wenige automatische Abfragen,
    // keine runden Zeiten (zufälliger Versatz) und keine weiteren Abfragen nach einem Fehler mit dem Key.
    // Strecken (viele Einzelabfragen) werden nur auf Wunsch bzw. beim Öffnen der App aktualisiert.
    let refreshTimer = null;
    const scheduleRefresh = () => {
      refreshTimer = setTimeout(() => {
        const keyProblem = dataService.lastApiError?.kind === 'key';
        if (document.visibilityState === 'visible' && !keyProblem && filterModeRef.current !== 'route') loadData();
        scheduleRefresh();
      }, REFRESH_INTERVAL_MS + Math.round(Math.random() * 90 * 1000));
    };
    scheduleRefresh();

    // Zurück in der App: veraltete Preise sofort auffrischen
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !backupService.isConnected) return;
      if (dataService.lastApiError?.kind === 'key') return;
      const last = lastUpdatedRef.current ? lastUpdatedRef.current.getTime() : 0;
      if (Date.now() - last > STALE_AFTER_MS) loadData();
      setClockTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);

    // Änderungen aus einem anderen Tab übernehmen
    const onStorage = (e) => {
      if (!e.key || !e.key.startsWith('kraftstoff_')) return;
      if (['kraftstoff_user_vehicles', 'kraftstoff_user_locations', 'kraftstoff_user_routes', 'kraftstoff_user_laws', 'kraftstoff_user_settings', 'kraftstoff_api_credentials', 'kraftstoff_sync_ledger'].includes(e.key)) {
        vehicleService.vehicles = vehicleService.loadVehicles();
        locationService.locations = locationService.loadLocations();
        routeService.routes = routeService.loadRoutes();
        lawService.laws = lawService.loadLaws();
        dataService.userSettings = dataService.loadStoredSettings();
        backupService.reloadLedger();
        refreshFromServices({ load: false });
      }
    };
    window.addEventListener('storage', onStorage);

    // Uhrzeit-abhängige Auswertungen regelmäßig auffrischen
    const tick = setInterval(() => setClockTick((t) => t + 1), CLOCK_TICK_MS);

    // "30 Minuten pausieren" aus einer Benachrichtigung heraus
    const onSwMessage = (event) => {
      if (event?.data?.type === 'PAUSE_ALERTS_30_MIN') setSettings({ ...dataService.pauseAlerts30Minutes() });
    };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onSwMessage);

    return () => {
      isCancelled = true;
      clearTimeout(refreshTimer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      unsubHistory();
      unsubMl();
      unsubDb();
      unsubData();
      if (trainTimerRef.current) clearTimeout(trainTimerRef.current);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onSwMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start-Links (/?action=trip, /?ziel=…, /?share=…, /?tab=map) nach der Einrichtung ausführen
  useEffect(() => {
    if (!isDbReady || !launchRef.current) return;
    const lp = launchRef.current;
    launchRef.current = null;
    clearLaunchParams();
    if (lp.tab) setActiveTab(lp.tab);
    if (lp.openTrip) {
      setTripInitial({ link: lp.link, destination: lp.destination });
      setIsTripModalOpen(true);
    }
  }, [isDbReady]);

  // Sortierung passend zum Bereich halten (Routen-Sortierungen gibt es nur im Routen-Modus)
  useEffect(() => {
    if (filterMode !== 'route' && (sortBy === 'route_progress' || sortBy === 'detour')) setSortBy('score');
  }, [filterMode, sortBy]);

  // ---------------------------------------------------------------------
  // Handler
  // ---------------------------------------------------------------------

  const handleToggleFavorite = (stationOrId) => {
    const id = typeof stationOrId === 'string' ? stationOrId : stationOrId?.id;
    const station = typeof stationOrId === 'object' && stationOrId ? stationOrId : stations.find((s) => s.id === id);
    const updated = dataService.toggleFavoriteStation(station || id);
    setFavoriteStationIds([...updated]);
    setSettings({ ...dataService.userSettings });
  };

  const handleSelectFilterMode = (mode) => {
    if (mode === 'route') {
      let r = routeService.getActiveRoute();
      if (!r && routeService.routes.length > 0) r = routeService.setActiveRouteId(routeService.routes[0].id);
      if (!r) {
        showToast('Noch keine Route vorhanden – lege eine unter „Standorte & Routen“ an oder plane eine Fahrt.', 'warning', 6000);
        return;
      }
      setActiveRouteId(r.id);
      setFilterMode('route');
      setDetourMode('route_corridor');
      loadData({ mode: 'route' });
    } else if (mode === 'favorites') {
      setFilterMode('favorites');
      setDetourMode('local_roundtrip');
      loadData({ mode: 'favorites' });
    } else {
      routeService.setActiveRouteId(null);
      setActiveRouteId(null);
      setFilterMode('location');
      setDetourMode('local_roundtrip');
      loadData({ mode: 'location' });
    }
  };

  const handleSelectFuel = (fuel) => {
    if (fuel === selectedFuelRef.current) return;
    selectedFuelRef.current = fuel;
    setSelectedFuel(fuel);
    setSettings({ ...dataService.saveSettings({ fuelPreference: fuel }) });
    loadData({ fuel });
  };

  const handleSaveSettings = (newSettings, { keyChanged = false } = {}) => {
    const saved = dataService.saveSettings(newSettings);
    setSettings({ ...saved });
    setHasValidApiKey(dataService.hasValidTankerkoenigKey());
    if (keyChanged) loadData();
    return saved;
  };

  const handlePause30Min = () => setSettings({ ...dataService.pauseAlerts30Minutes() });
  const handleResumeAlerts = () => setSettings({ ...dataService.resumeAlerts() });
  const isPaused = dataService.isAlertsPaused();

  const handleSelectVehicle = (id) => {
    vehicleService.setActiveVehicleId(id);
    setActiveVehicleId(vehicleService.activeVehicleId);
    const targetVeh = vehicleService.vehicles.find((v) => v.id === id);
    if (targetVeh?.fuelType && ['diesel', 'e10', 'e5'].includes(targetVeh.fuelType)) handleSelectFuel(targetVeh.fuelType);
  };

  const handleUpdateVehicles = (updated) => {
    setVehicles([...updated]);
    setActiveVehicleId(vehicleService.activeVehicleId);
  };

  const handleSelectRoute = (id) => {
    routeService.setActiveRouteId(id || null);
    const r = routeService.getActiveRoute();
    setActiveRouteId(r ? r.id : null);
    setRoutes([...routeService.routes]);
    setTripProgress(null);
    if (r) {
      setFilterMode('route');
      setDetourMode('route_corridor');
      loadData({ mode: 'route' });
    } else {
      setFilterMode('location');
      setDetourMode('local_roundtrip');
      loadData({ mode: 'location' });
    }
  };

  // Korridor nur clientseitig filtern: der Abfrageplan deckt bereits ±5 km ab
  const handleUpdateRouteCorridorRadius = (routeId, newRadiusKm) => {
    const updated = routeService.updateRouteCorridorRadius(routeId, newRadiusKm);
    setRoutes([...updated]);
  };

  // Fahrt planen: Straßenroute vom Start (GPS) zum Ziel als Fahrt-Route anlegen, Tankstellen im Korridor laden
  const handlePlanTrip = async ({ start, end, corridorKm, osrm }) => {
    const trip = await routeService.setTripRoute({
      name: `Fahrt nach ${end.name}`,
      description: `${start.name} ➔ ${end.name} (${osrm.distanceKm} km)`,
      startName: start.name,
      startCoords: { lat: start.lat, lng: start.lng },
      endName: end.name,
      endCoords: { lat: end.lat, lng: end.lng },
      totalDistanceKm: osrm.distanceKm,
      durationMin: osrm.durationMin,
      approximate: osrm.approximate,
      corridorRadiusKm: corridorKm,
      polylineCoords: osrm.polylineCoords,
    });
    setRoutes([...routeService.routes]);
    setActiveRouteId(trip.id);
    setTripProgress(start.isGps ? { km: 0, offRouteKm: 0, at: Date.now() } : null);
    setFilterMode('route');
    setDetourMode('route_corridor');
    setSortBy('route_progress'); // unterwegs zählt die Reihenfolge entlang der Strecke
    setIsTripModalOpen(false);
    setTripInitial(null);
    setActiveTab('stations');
    const h = Math.floor((osrm.durationMin || 0) / 60);
    const m = (osrm.durationMin || 0) % 60;
    showToast(
      osrm.approximate
        ? `Routing-Dienst nicht erreichbar – Korridor entlang der Luftlinie nach ${end.name} (ca. ${osrm.distanceKm} km). Bitte später neu planen.`
        : `✓ Fahrt nach ${end.name}: ${String(osrm.distanceKm).replace('.', ',')} km, ca. ${h ? `${h} Std. ` : ''}${m} Min. – Tankstellen im Korridor werden geladen.`,
      osrm.approximate ? 'warning' : 'success',
      7000
    );
    await loadData({ mode: 'route' });
  };

  const handleEndTrip = () => {
    routeService.clearTripRoute();
    setRoutes([...routeService.routes]);
    setTripProgress(null);
    handleSelectRoute(null);
  };

  // Fahrtfortschritt per GPS: bereits passierte Tankstellen ausblenden, Restkilometer anzeigen
  const updateTripProgress = useCallback(async ({ silent = false } = {}) => {
    const route = routeService.getActiveRoute();
    if (!route || !route.isTrip) return;
    try {
      const pos = await getCurrentPosition({ timeoutMs: 9000 });
      const match = findClosestPointOnRoute(pos.lat, pos.lng, route);
      setTripProgress({ km: match.kmAlongRoute, offRouteKm: match.minDistanceKm, at: Date.now() });
      if (!silent) showToast(match.minDistanceKm > 3 ? `Du bist ${String(match.minDistanceKm).replace('.', ',')} km neben der geplanten Strecke.` : `✓ Position: km ${Math.round(match.kmAlongRoute)} von ${Math.round(route.totalDistanceKm)}.`, match.minDistanceKm > 3 ? 'warning' : 'success', 4500);
    } catch (e) {
      if (!silent) showToast(e.message, 'error', 6000);
    }
  }, [showToast]);

  const hasTripProgress = !!tripProgress;
  useEffect(() => {
    if (!activeRoute?.isTrip || !hasTripProgress) return undefined;
    // Nur automatisch, wenn die Standortfreigabe bereits erteilt wurde (keine wiederholten Abfragen)
    let cancelled = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' });
        if (!cancelled && perm?.state === 'granted') updateTripProgress({ silent: true });
      } catch {}
    }, TRIP_PROGRESS_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeRoute?.isTrip, activeRoute?.id, hasTripProgress, updateTripProgress]);

  const handleSelectLocation = (id) => {
    routeService.setActiveRouteId(null);
    setActiveRouteId(null);
    locationService.setActiveLocationId(id);
    setActiveLocationId(locationService.activeLocationId);
    setFilterMode('location');
    setDetourMode('local_roundtrip');
    loadData({ mode: 'location' });
  };

  const handleUpdateLocations = (updated) => {
    setLocations([...updated]);
    if (locationService.activeLocationId !== activeLocationId) {
      setActiveLocationId(locationService.activeLocationId);
      if (filterModeRef.current === 'location') loadData({ mode: 'location' });
    }
  };

  const handleUpdateRoutes = (updated) => {
    setRoutes([...updated]);
    // Aktive Route gelöscht: zurück zum Standort
    if (activeRouteId && !routeService.getActiveRoute()) handleSelectRoute(null);
  };

  const handleLocateGps = async () => {
    setIsRefreshing(true);
    try {
      const pos = await getCurrentPosition({ timeoutMs: 10000 });
      const res = await locationService.createOrUpdateGpsLocation(pos.lat, pos.lng);
      setLocations([...res.locations]);
      handleSelectLocation(res.location.id);
      showToast(`✓ Standort auf „${res.location.name}“ aktualisiert.`, 'success', 4500);
    } catch (e) {
      setIsRefreshing(false);
      showToast(e.message, 'error', 7000);
    }
  };

  // Radius sofort anzeigen, Abfrage erst nach kurzer Pause (Schieberegler feuert bei jedem Schritt)
  const handleUpdateRadius = (id, radiusKm) => {
    const targetId = id || locationService.activeLocationId;
    const updated = locationService.updateLocation(targetId, { radiusKm });
    setLocations([...updated]);
    // Neu laden nur, wenn genau dieser Ort gerade angezeigt wird
    if (targetId !== locationService.activeLocationId || filterModeRef.current !== 'location') return;
    if (radiusTimerRef.current) clearTimeout(radiusTimerRef.current);
    radiusTimerRef.current = setTimeout(() => loadData({ mode: 'location' }), 450);
  };

  const handleSelectQuickCity = (cityConfig) => {
    routeService.setActiveRouteId(null);
    setActiveRouteId(null);
    const res = locationService.switchToQuickCity(cityConfig);
    setLocations([...res.locations]);
    setActiveLocationId(locationService.activeLocationId);
    setFilterMode('location');
    setDetourMode('local_roundtrip');
    loadData({ mode: 'location' });
    showToast(`✓ Standort: ${res.location.name}.`, 'success', 3500);
  };

  // ---------------------------------------------------------------------
  // Ableitungen
  // ---------------------------------------------------------------------

  // Nur Stationen der gewählten Sorte (verhindert Vergleiche alter Preise mit der neuen Sorte)
  const currentStations = useMemo(() => stations.filter((s) => !s.fuelType || s.fuelType === selectedFuel), [stations, selectedFuel]);
  const favKey = filterMode === 'favorites' ? favoriteStationIds.join(',') : '';

  const routeFilteredStations = useMemo(() => {
    if (filterMode === 'favorites') {
      const fav = new Set(favKey.split(',').filter(Boolean));
      return currentStations.filter((s) => fav.has(s.id));
    }
    if (filterMode === 'route' && activeRoute) {
      const list = routeService.filterStationsByRoute(currentStations, activeRoute);
      if (!activeRoute.isTrip || !tripProgress) return list;
      // Unterwegs: bereits passierte Stationen ausblenden, Entfernung ab der aktuellen Position
      return list
        .filter((s) => s.kmAlongRoute >= tripProgress.km - 0.5)
        .map((s) => ({ ...s, distanceKm: Math.round((Math.max(0, s.kmAlongRoute - tripProgress.km) + s.routeDetourKm) * 10) / 10, aheadKm: Math.round(Math.max(0, s.kmAlongRoute - tripProgress.km)) }));
    }
    return locationService.filterStationsByRadius(currentStations, activeLocation);
  }, [filterMode, currentStations, activeLocation, activeRoute, favKey, tripProgress]);

  // Echte Messreihen des aktuellen Kraftstoffs (alle bekannten Stationen)
  const readingsMap = useMemo(() => {
    void historyVersion; // neu einlesen, sobald neue Messwerte gespeichert wurden
    return priceHistoryService.getFuelMap(selectedFuel);
  }, [selectedFuel, historyVersion]);

  // Messreihen nur der Stationen im aktuellen Bereich (Radius bzw. Routen-Korridor)
  const regionReadingsMap = useMemo(() => {
    const m = new Map();
    for (const st of routeFilteredStations) {
      const pts = readingsMap.get(st.id);
      if (pts && pts.length > 0) m.set(st.id, pts);
    }
    return m;
  }, [routeFilteredStations, readingsMap]);

  // Gesetze (z.B. 12-Uhr-Regel): nur eingeschaltete Einträge für die gewählte Sorte
  const rules = useMemo(() => compileRules(laws, selectedFuel), [laws, selectedFuel]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ruleState = useMemo(() => describeRuleState(rules), [rules, clockTick]);
  // Erfahrungswerte passend zu den aktiven Gesetzen (wird bei jedem Datenabruf neu bestimmt)
  const profile = useMemo(() => buildRegionalProfile(regionReadingsMap, { prior: priorForRules(rules) }), [regionReadingsMap, rules]);
  profileRef.current = profile;
  const regionNow = useMemo(() => summarizeRegionNow(routeFilteredStations), [routeFilteredStations]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const windows = useMemo(() => findBestWindows(profile), [profile, clockTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const moves = useMemo(() => detectRecentPriceMoves(routeFilteredStations, readingsMap, { rules }), [routeFilteredStations, readingsMap, rules, clockTick]);

  // Basistankstelle: nächste geöffnete Station bzw. erste auf der Route
  const baseStation = useMemo(() => {
    if (routeFilteredStations.length === 0) return null;
    const open = routeFilteredStations.filter((s) => s.isOpen !== false);
    const pool = open.length > 0 ? open : routeFilteredStations;
    if (filterMode === 'route') return [...pool].sort((a, b) => (a.kmAlongRoute || 0) - (b.kmAlongRoute || 0))[0];
    return [...pool].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))[0];
  }, [routeFilteredStations, filterMode]);

  const routeSpeedKmH = activeRoute && activeRoute.durationMin > 0 ? activeRoute.totalDistanceKm / (activeRoute.durationMin / 60) : null;

  const evaluatedStations = useMemo(() => {
    const thresholdEuro = (settings.alertThresholdCent || 3.0) / 100;
    const consumption = customConsumption || activeVehicle?.consumptionL100km || 6.2;

    return routeFilteredStations.map((st) => {
      const readings = readingsMap.get(st.id) || [];
      const evaluation = evaluatePriceEngine({ currentPrice: st.currentPrice, history: readings, thresholdCent: thresholdEuro, profile });
      const detour = calculateDetourProfitability({
        targetPrice: st.currentPrice,
        targetDistanceKm: st.distanceKm ?? 0,
        basePrice: baseStation ? baseStation.currentPrice : st.currentPrice,
        baseDistanceKm: baseStation ? baseStation.distanceKm ?? 0 : 0,
        fillLiters,
        consumptionL100km: consumption,
        isRoundtrip: detourMode !== 'route_corridor',
        detourMode,
        realAdditionalKm: st.realAdditionalKm,
        // Auf einer Strecke zählt nur der Mehrweg gegenüber der Vergleichsstation (die liegt auch nicht direkt an der Straße)
        baseAdditionalKm: st.realAdditionalKm !== undefined && baseStation?.realAdditionalKm !== undefined ? baseStation.realAdditionalKm : 0,
      });
      const isCorridor = !!st.isOnRouteCorridor;
      const outlook = buildArrivalOutlook({
        currentPrice: st.currentPrice,
        distanceKm: st.distanceKm ?? 1,
        isRouteCorridor: isCorridor || detourMode === 'route_corridor',
        avgSpeedKmH: isCorridor ? routeSpeedKmH : null,
        profile,
        wave: moves.wave,
        rules,
      });
      const score = scoreStation({ station: st, regionNow, evaluation, detour });
      const deltaToRegionCent = regionNow.median ? Math.round((st.currentPrice - regionNow.median) * 1000) / 10 : 0;
      return { ...st, readings, evaluation, detour, outlook, score, deltaToRegionCent };
    });
  }, [routeFilteredStations, readingsMap, settings.alertThresholdCent, activeVehicle, baseStation, detourMode, fillLiters, customConsumption, profile, moves, regionNow, routeSpeedKmH, rules]);

  const sortedStations = useMemo(() => {
    const list = [...evaluatedStations];
    const openFirst = (a, b) => (a.isOpen === false) - (b.isOpen === false);
    if (sortBy === 'price') {
      list.sort((a, b) => openFirst(a, b) || a.currentPrice - b.currentPrice);
    } else if (sortBy === 'distance' || sortBy === 'route_progress') {
      if (filterMode === 'route') list.sort((a, b) => (a.kmAlongRoute || 0) - (b.kmAlongRoute || 0));
      else list.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    } else if (sortBy === 'savings') {
      list.sort((a, b) => openFirst(a, b) || (b.detour?.netSavingsEuro || 0) - (a.detour?.netSavingsEuro || 0));
    } else if (sortBy === 'detour') {
      list.sort((a, b) => (a.routeDetourKm || 0) - (b.routeDetourKm || 0));
    } else {
      // Empfehlung: zuerst die Wahl des Tankwarts (geringste Kosten der Füllung inkl. Anfahrt), dann nach Score
      const bestId = rankByFillCost(list, fillLiters)[0]?.station.id;
      list.sort((a, b) => (b.id === bestId) - (a.id === bestId) || openFirst(a, b) || (b.score?.score || 0) - (a.score?.score || 0));
    }
    return list;
  }, [evaluatedStations, sortBy, filterMode, fillLiters]);

  // Der weise Tankwart
  const advice = useMemo(() => {
    const trip = filterMode === 'route' && activeRoute?.isTrip
      ? {
        remainingKm: Math.max(0, (activeRoute.totalDistanceKm || 0) - (tripProgress?.km || 0)),
        durationMin: activeRoute.durationMin && activeRoute.totalDistanceKm
          ? activeRoute.durationMin * Math.max(0, 1 - (tripProgress?.km || 0) / activeRoute.totalDistanceKm)
          : null,
      }
      : null;
    const args = { stations: evaluatedStations, regionNow, profile, windows, moves, vehicle: activeVehicle, settings, liters: fillLiters, trip, rules };
    const base = buildTankwartAdvice(args);
    if (!base.bestStation) return base;
    let forecast = null;
    try {
      forecast = forecastStationCurve({ station: base.bestStation, pts: readingsMap.get(base.bestStation.id) || [], profile, rules });
    } catch {}
    return buildTankwartAdvice({ ...args, forecast });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatedStations, regionNow, profile, windows, moves, activeVehicle, settings, readingsMap, fillLiters, mlStatus.trainingRuns, mlStatus.blendWeight, filterMode, activeRoute, tripProgress, rules]);

  const bestStation = advice.bestStation || sortedStations[0];

  const regionLabel = useMemo(() => {
    if (filterMode === 'route' && activeRoute) {
      const c = String(activeRoute.corridorRadiusKm || DEFAULT_CORRIDOR_KM).replace('.', ',');
      return activeRoute.isTrip ? `Fahrt nach ${activeRoute.endName || 'Ziel'} (±${c} km)` : `Route „${activeRoute.name}“ (±${c} km)`;
    }
    if (filterMode === 'favorites') return `Favoriten (${routeFilteredStations.length})`;
    return `${String(Number(activeLocation?.radiusKm || 5)).replace('.', ',')} km um ${activeLocation?.name || 'Mein Standort'}`;
  }, [filterMode, activeRoute, activeLocation, routeFilteredStations.length]);

  const dataStats = useMemo(
    () => priceHistoryService.getStats(selectedFuel, routeFilteredStations.map((s) => s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedFuel, routeFilteredStations, historyVersion]
  );

  // Datenbank: Änderungen sofort protokollieren; Datei schreiben entprellt bzw. auf Knopfdruck
  useEffect(() => {
    backupService.scheduleSync('state');
  }, [vehicles, locations, routes, laws, settings, favoriteStationIds]);

  useEffect(() => {
    if (historyVersion > 0) backupService.scheduleSync('history');
  }, [historyVersion]);

  // Automatische Preisalarme – nur mit frisch geladenen Preisen der gewählten Sorte
  useEffect(() => {
    if (isRefreshing || sortedStations.length === 0 || fetchInfo.fromCache) return;
    if (sortedStations.some((s) => s.fuelType && s.fuelType !== selectedFuel)) return;
    notificationService.checkAndTriggerPriceAlerts(sortedStations, settings, selectedFuel, regionNow);
  }, [sortedStations, settings, selectedFuel, regionNow, isRefreshing, fetchInfo.fromCache]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [activeTab]);

  // Detail-Modal und Kartenkarte immer mit der aktuell geladenen Fassung der Station versorgen
  const detailStation = selectedStationForDetail
    ? evaluatedStations.find((s) => s.id === selectedStationForDetail.id) || selectedStationForDetail
    : null;
  const mapCardStation = mapFocusStation
    ? sortedStations.find((s) => s.id === mapFocusStation.id) || (mapFocusStation.fuelType === selectedFuel ? mapFocusStation : null)
    : null;

  const liveLabel = fetchInfo.fromCache ? 'OFFLINE' : 'LIVE';

  const renderNoKey = (Icon, title, text) => (
    <div className="no-key-card">
      <div className="no-key-icon">
        <Icon size={28} strokeWidth={2.4} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => setIsSettingsModalOpen(true)} style={{ borderRadius: '9999px', padding: '0.65rem 1.4rem', fontSize: '0.86rem', fontWeight: 700 }}>
          <Settings size={15} />
          <span>API-Key eintragen</span>
        </button>
        <a href="https://creativecommons.tankerkoenig.de/" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ borderRadius: '9999px', padding: '0.65rem 1.15rem', fontSize: '0.86rem' }}>
          Kostenlos registrieren (1 Min.)
        </a>
      </div>
    </div>
  );

  const verdictBadge = (() => {
    switch (advice.verdict) {
      case 'URGENT': return { cls: 'badge-unfavorable', text: 'Dringend tanken' };
      case 'FILL_NOW': return { cls: 'badge-favorable', text: 'Jetzt tanken' };
      case 'FILL_LATER_TODAY': return { cls: 'badge-neutral', text: `Später: ${advice.bestWindowLabel || 'heute'}` };
      case 'WAIT_DAYS': return { cls: 'badge-blue', text: `Warten bis ${advice.bestWindowLabel}` };
      case 'NO_OPEN': return { cls: 'badge-gray', text: 'Alle geschlossen' };
      case 'TRIP': return { cls: 'badge-blue', text: 'Unterwegs' };
      default: return { cls: 'badge-gray', text: 'Hinweis' };
    }
  })();

  return (
    <div className={`app-viewport ${activeTab === 'map' ? 'map-mode-active' : ''}`}>
      {/* Header */}
      <header className="header-glass">
        <div className="header-inner">
          <div className="brand-badge" onClick={() => setActiveTab('stations')}>
            <div className="brand-logo-box">
              <Fuel size={19} strokeWidth={2.4} />
            </div>
            <div className="brand-text">
              <div className="brand-title-row">
                <span className="brand-title">KRAFTSTOFF</span>
                {!isDbReady ? (
                  <span className="live-status-pill" style={{ background: '#F1F5F9', color: '#475569', borderColor: '#E2E8F0' }}>{dbStatus.booted ? 'EINRICHTUNG' : 'START'}</span>
                ) : hasValidApiKey ? (
                  apiError && !fetchInfo.fromCache ? (
                    <span className="live-status-pill" style={{ background: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' }} title={apiError.message}>
                      <AlertTriangle size={10} />
                      <span>{apiError.kind === 'key' ? 'KEY-FEHLER' : 'OFFLINE'}</span>
                    </span>
                  ) : (
                    <span className={`live-status-pill ${fetchInfo.fromCache ? 'is-cached' : ''}`} title={lastUpdatedAt ? `Zuletzt aktualisiert ${fmtTime(lastUpdatedAt)}` : 'Live'}>
                      {fetchInfo.fromCache ? <WifiOff size={10} /> : <span className="live-dot" />}
                      <span>{liveLabel}</span>
                    </span>
                  )
                ) : (
                  <button
                    type="button"
                    className="key-missing-pill"
                    onClick={(e) => { e.stopPropagation(); setIsSettingsModalOpen(true); }}
                    title="Tankerkönig API-Key erforderlich"
                  >
                    <AlertTriangle size={11} color="#DC2626" />
                    <span>Key fehlt</span>
                  </button>
                )}
              </div>
              <div className="brand-subtitle">Tankradar & Tankwart</div>
            </div>
          </div>

          {isDbReady && (
            <nav className="nav-pill-group desktop-nav-pills">
              <button className={`nav-pill-btn ${activeTab === 'stations' ? 'active' : ''}`} onClick={() => setActiveTab('stations')}>
                <Fuel size={14} />
                <span>Radar</span>
              </button>
              <button className={`nav-pill-btn ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
                <MapIcon size={14} />
                <span>Karte</span>
              </button>
              <button className={`nav-pill-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
                <BarChart3 size={14} />
                <span>Trends</span>
              </button>
              <button className={`nav-pill-btn ${activeTab === 'ml' ? 'active' : ''}`} onClick={() => setActiveTab('ml')}>
                <Sparkles size={14} />
                <span>Tankwart (KI)</span>
              </button>
            </nav>
          )}

          {isDbReady && (
            <div className="header-action-dock" role="toolbar" aria-label="Schnellaktionen">
              <button type="button" className="header-action-btn" onClick={() => setIsTripModalOpen(true)} title="Fahrt planen – Tankstellen entlang deiner Navigation" aria-label="Fahrt planen">
                <RouteIcon size={16} color="#2563EB" />
              </button>
              <button type="button" className="header-action-btn dock-extra" onClick={() => setIsVehicleModalOpen(true)} title={`Garage: ${activeVehicle?.name || 'Fahrzeuge'}`} aria-label="Fahrzeug-Garage">
                <Car size={16} />
              </button>
              <button type="button" className="header-action-btn dock-extra" onClick={() => setIsLocRouteModalOpen(true)} title="Standorte & Routen" aria-label="Standorte und Routen">
                <MapPin size={16} />
              </button>
              <button type="button" className="header-action-btn" onClick={() => setIsLawsModalOpen(true)} title={ruleState.active ? `Gesetze: ${ruleState.name} aktiv` : 'Gesetze & Regeln'} aria-label="Gesetze und Regeln">
                <Scale size={16} color={ruleState.active ? '#B45309' : undefined} />
              </button>
              <button type="button" className="header-action-btn dock-extra" onClick={() => setIsPushModalOpen(true)} title="Preisalarme" aria-label="Preisalarme">
                <BellRing size={16} />
              </button>
              <button type="button" className={`header-action-btn ${dbStatus.unsavedSince ? 'has-dot' : ''}`} onClick={() => setIsICloudModalOpen(true)} title={dbStatus.unsavedSince ? 'Datenbank: Änderungen noch nicht gesichert' : 'Datenbank-Ordner'} aria-label="Datenbank-Ordner">
                <Cloud size={16} color="#0284C7" />
              </button>
              <button type="button" className="header-action-btn dock-extra" onClick={() => setIsSettingsModalOpen(true)} title="Einstellungen" aria-label="Einstellungen">
                <Settings size={16} />
              </button>
              <button type="button" className="header-action-btn dock-menu" onClick={() => setIsMenuOpen(true)} title="Menü" aria-label="Menü öffnen">
                <Menu size={18} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content-mobile" style={{ flex: 1, paddingBottom: '1rem' }}>
        {!isDbReady && !dbStatus.booted && <LazyFallback label="KRAFTSTOFF startet …" />}
        {!isDbReady && dbStatus.booted && <DatabaseSetupScreen variant="fullscreen" onConnected={handleDbConnected} />}

        {isDbReady && hasValidApiKey && apiError && (
          <div className={`notice-bar ${apiError.kind === 'key' ? 'is-error' : 'is-warning'}`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>
                {apiError.kind === 'key'
                  ? `Tankerkönig lehnt den API-Key ab: „${apiError.message}“. Bitte den Key in den Einstellungen prüfen.`
                  : apiError.kind === 'network'
                    ? `Tankerkönig ist gerade nicht erreichbar (${apiError.message}).${fetchInfo.fromCache && fetchInfo.cachedAt ? ` Angezeigt werden zwischengespeicherte Preise von ${fmtTime(fetchInfo.cachedAt)} Uhr.` : ''}`
                    : `Tankerkönig meldet: „${apiError.message}“.`}
              </span>
            </span>
            {apiError.kind === 'key' ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setIsSettingsModalOpen(true)} style={{ borderRadius: '9999px', fontSize: '0.72rem', padding: '0.3rem 0.75rem' }}>
                Einstellungen öffnen
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadData()} disabled={isRefreshing} style={{ borderRadius: '9999px', fontSize: '0.72rem', padding: '0.3rem 0.75rem' }}>
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                <span>Erneut versuchen</span>
              </button>
            )}
          </div>
        )}

        {isDbReady && (
          <DatabaseStatusBanner
            status={dbStatus}
            onSaveNow={handleSaveDbNow}
            onReconnect={handleReconnectDb}
            onLoaded={handleDbConnected}
            onError={showDbError}
          />
        )}

        {isDbReady && activeTab !== 'map' && (
          <RouteScheduleBar
            selectedFuel={selectedFuel}
            onSelectFuel={handleSelectFuel}
            isPaused={isPaused}
            pausedUntil={settings.pausedUntil}
            onPause30Min={handlePause30Min}
            onResumeAlerts={handleResumeAlerts}
            sortBy={sortBy}
            onSelectSort={setSortBy}
            activeVehicle={activeVehicle}
            vehicles={vehicles}
            onSelectVehicle={handleSelectVehicle}
            onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
            activeLocation={activeLocation}
            locations={locations}
            onSelectLocation={handleSelectLocation}
            onUpdateRadius={handleUpdateRadius}
            activeRoute={activeRoute}
            routes={routes}
            onSelectRoute={handleSelectRoute}
            onUpdateRouteCorridorRadius={handleUpdateRouteCorridorRadius}
            filterMode={filterMode}
            onSelectFilterMode={handleSelectFilterMode}
            favoriteStationIds={favoriteStationIds}
            onOpenLocationRouteModal={() => setIsLocRouteModalOpen(true)}
            onOpenTripPlanner={() => setIsTripModalOpen(true)}
            onLocateGps={handleLocateGps}
            onSelectQuickCity={handleSelectQuickCity}
            detourMode={detourMode}
            onSelectDetourMode={setDetourMode}
            customConsumption={customConsumption}
            onUpdateCustomConsumption={setCustomConsumption}
            customLiters={customLiters}
            onUpdateCustomLiters={setCustomLiters}
            onResetVehicleOverrides={() => { setCustomConsumption(null); setCustomLiters(null); }}
          />
        )}

        {/* TAB 1: RADAR */}
        {isDbReady && activeTab === 'stations' && (
          !hasValidApiKey ? renderNoKey(Key, 'Tankerkönig API-Key erforderlich', 'KRAFTSTOFF zeigt ausschließlich echte Tankstellen und Live-Preise der Markttransparenzstelle. Dafür brauchst du deinen persönlichen, kostenlosen Tankerkönig-Key.') : (
            <SectionBoundary name="Radar">
              {filterMode === 'route' && activeRoute && activeRoute.isTrip && (
                <TripBar
                  route={activeRoute}
                  stationCount={sortedStations.length}
                  bestStation={bestStation}
                  navApp={settings.navApp}
                  progress={tripProgress}
                  fetchInfo={fetchInfo}
                  onUpdateProgress={() => updateTripProgress()}
                  onUpdateCorridor={(rad) => handleUpdateRouteCorridorRadius(activeRoute.id, rad)}
                  onReplan={() => setIsTripModalOpen(true)}
                  onEnd={handleEndTrip}
                />
              )}
              {filterMode === 'route' && activeRoute && !activeRoute.isTrip && (
                <div className="route-summary-bar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <div className="route-summary-icon">
                      <Navigation size={15} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="route-summary-title">Route: {activeRoute.name}</div>
                      <div className="route-summary-sub">
                        {activeRoute.startName || 'Start'} ➔ {activeRoute.endName || 'Ziel'} • {String(Number(activeRoute.totalDistanceKm || 0).toFixed(1)).replace('.', ',')} km{activeRoute.approximate ? ' • Luftlinie (ohne Straßenverlauf)' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="corridor-chips" role="group" aria-label="Korridor-Breite">
                    <span>Korridor:</span>
                    {CORRIDOR_OPTIONS.map((rad) => {
                      const isActive = Math.abs((activeRoute.corridorRadiusKm || DEFAULT_CORRIDOR_KM) - rad) < 0.2;
                      return (
                        <button key={rad} type="button" className={isActive ? 'active' : ''} onClick={() => handleUpdateRouteCorridorRadius(activeRoute.id, rad)}>
                          ±{String(rad).replace('.', ',')} km
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {filterMode === 'route' && (fetchInfo.truncated || fetchInfo.partial) && !isRefreshing && (
                <div className="notice-bar is-warning">
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  <span>
                    {fetchInfo.truncated
                      ? `Sehr lange Strecke: Tankstellen wurden für die ersten ${Math.round(fetchInfo.coveredKm)} von ${Math.round(fetchInfo.totalKm)} km geladen.`
                      : 'Ein Teil der Strecke konnte gerade nicht geladen werden – die Liste ist eventuell unvollständig.'}
                  </span>
                </div>
              )}

              {/* Tankwart-Empfehlung */}
              {bestStation && advice.verdict !== 'NO_STATIONS' && (
                <div className="top-recommendation-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.85rem' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <span className={`badge ${verdictBadge.cls}`}>
                          <Sparkles size={12} />
                          <span>Tankwart: {verdictBadge.text}</span>
                        </span>
                        {bestStation.isOnRouteCorridor && <span className="badge badge-blue">{bestStation.aheadKm !== undefined ? `in ${bestStation.aheadKm} km` : `km ${Math.round(bestStation.kmAlongRoute || 0)} der Strecke`}</span>}
                        {advice.bestVsRegionCt <= -0.5 && <span className="badge badge-favorable" style={{ fontWeight: 700 }}>{fmtNum(advice.bestVsRegionCt, 1)} ct zum Regionsschnitt</span>}
                      </div>
                      <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>{bestStation.name}</h2>
                      <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.2rem', lineHeight: 1.4 }}>
                        {bestStation.isOnRouteCorridor
                          ? `${bestStation.street} • ${bestStation.routeDetourKm < 0.1 ? 'direkt an der Strecke' : bestStation.routeDetourKm >= 1 ? `${String(bestStation.routeDetourKm.toFixed(1)).replace('.', ',')} km Abstecher` : `${Math.round(bestStation.routeDetourKm * 1000)} m Abstecher`}`
                          : `${bestStation.street}${Number.isFinite(bestStation.distanceKm) ? ` • ${fmtKm(bestStation.distanceKm)} entfernt` : ''}`}
                        {' • '}
                        <span style={{ color: '#1E293B' }}>{advice.title}</span>
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="num-mono" style={{ fontSize: '1.9rem', fontWeight: 800, color: bestStation.isOpen === false ? '#64748B' : '#059669', lineHeight: 1 }}>
                          {Number(bestStation.currentPrice).toFixed(3).replace('.', ',')}
                          <span style={{ fontSize: '0.85rem', color: '#64748B', marginLeft: '0.2rem' }}>€/L</span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 700 }}>{fuelLabel(selectedFuel)}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setSelectedStationForDetail(bestStation)} style={{ padding: '0.5rem 0.9rem', borderRadius: '9999px' }}>
                          <span>Analyse</span>
                          <ChevronRight size={14} />
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('ml')} style={{ padding: '0.4rem 0.9rem', borderRadius: '9999px', fontSize: '0.72rem' }}>
                          Warum?
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {sortedStations.length > 0 && <RuleBanner rules={rules} compact onOpen={() => setIsLawsModalOpen(true)} />}

              <div className="list-header-row">
                <div className="list-header-text">
                  {filterMode === 'favorites' ? (
                    <>
                      <Star size={13} fill="#F59E0B" color="#F59E0B" />
                      <span>{sortedStations.length} {sortedStations.length === 1 ? 'Favorit' : 'Favoriten'}{favoriteStationIds.length > sortedStations.length ? ` (von ${favoriteStationIds.length})` : ''}</span>
                    </>
                  ) : (
                    <span>{sortedStations.length} {sortedStations.length === 1 ? 'Tankstelle' : 'Tankstellen'} • {regionLabel}</span>
                  )}
                  {regionNow.median && (
                    <span style={{ color: '#64748B', fontWeight: 500 }}>
                      • Median <span className="num-mono">{regionNow.median.toFixed(3).replace('.', ',')} €</span>
                    </span>
                  )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => loadData()} disabled={isRefreshing} title="Preise aktualisieren" aria-label="Preise aktualisieren" style={{ padding: '0.25rem 0.6rem', fontSize: '0.74rem', borderRadius: '9999px' }}>
                  <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                  <span>{lastUpdatedAt ? `${fetchInfo.fromCache && fetchInfo.cachedAt ? `Stand ${fmtTime(fetchInfo.cachedAt)}` : fmtTime(lastUpdatedAt)}` : 'Aktualisieren'}</span>
                </button>
              </div>

              {sortedStations.length === 0 && isRefreshing && (
                <div className="station-cards-grid" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="station-card-skeleton" />)}
                </div>
              )}

              {sortedStations.length === 0 && !isRefreshing && (
                <div className="empty-state-card">
                  <div className="empty-state-icon" style={{ background: filterMode === 'favorites' ? '#FFFBEB' : '#F1F5F9' }}>
                    {filterMode === 'favorites' ? <Star size={22} fill="#F59E0B" color="#F59E0B" /> : <Fuel size={22} color="#64748B" />}
                  </div>
                  <h3>
                    {filterMode === 'favorites'
                      ? favoriteStationIds.length > 0 ? 'Favoriten gerade ohne Preis' : 'Noch keine Favoriten markiert'
                      : 'Keine Tankstellen mit Preisen gefunden'}
                  </h3>
                  <p>
                    {filterMode === 'favorites'
                      ? favoriteStationIds.length > 0
                        ? `Für ${fuelLabel(selectedFuel)} liegt bei deinen Favoriten gerade kein Preis vor (Sorte nicht im Angebot oder Verbindung unterbrochen).`
                        : 'Tippe auf den Stern bei einer Tankstelle, um sie zu deinen Favoriten hinzuzufügen.'
                      : `Für ${fuelLabel(selectedFuel)} liegen im Bereich „${regionLabel}“ keine gemeldeten Preise vor. Vergrößere den Radius oder prüfe die Verbindung.`}
                  </p>
                  {filterMode === 'favorites' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSelectFilterMode('location')} style={{ borderRadius: '9999px', padding: '0.35rem 0.9rem', fontSize: '0.78rem' }}>
                      <MapPin size={13} />
                      <span>Zu allen Tankstellen im Umkreis</span>
                    </button>
                  )}
                </div>
              )}

              <div className="station-cards-grid">
                {sortedStations.map((st) => (
                  <StationCard
                    key={st.id}
                    station={st}
                    baseStation={baseStation}
                    detourMode={detourMode}
                    isFavorite={favoriteStationIds.includes(st.id)}
                    onToggleFavorite={handleToggleFavorite}
                    onSelect={() => setSelectedStationForDetail(st)}
                    windows={windows}
                    navApp={settings.navApp}
                  />
                ))}
              </div>
            </SectionBoundary>
          )
        )}

        {/* TAB 2: KARTE */}
        {isDbReady && activeTab === 'map' && (
          <div className="full-screen-map-container">
            <SectionBoundary name="Karte">
              <Suspense fallback={<LazyFallback label="Karte wird geladen …" />}>
                <StationMapView
                  stations={sortedStations}
                  locations={locations}
                  activeLocation={activeLocation}
                  onSelectLocation={handleSelectLocation}
                  onSelectQuickCity={handleSelectQuickCity}
                  onUpdateRadius={handleUpdateRadius}
                  onLocateGps={handleLocateGps}
                  activeRoute={activeRoute}
                  routes={routes}
                  onSelectRoute={handleSelectRoute}
                  onUpdateRouteCorridorRadius={handleUpdateRouteCorridorRadius}
                  filterMode={filterMode}
                  onSelectFilterMode={handleSelectFilterMode}
                  favoriteStationIds={favoriteStationIds}
                  onToggleFavorite={handleToggleFavorite}
                  activeVehicle={activeVehicle}
                  vehicles={vehicles}
                  onSelectVehicle={handleSelectVehicle}
                  fuelType={selectedFuel}
                  onSelectFuel={handleSelectFuel}
                  selectedStation={mapCardStation}
                  onSelectStation={setMapFocusStation}
                  onOpenStationDetails={setSelectedStationForDetail}
                  onCloseSelectedStation={() => setMapFocusStation(null)}
                  hasValidApiKey={hasValidApiKey}
                  onOpenSettings={() => setIsSettingsModalOpen(true)}
                  onExploreArea={(lat, lng, rad) => dataService.getStationsAroundPoint(selectedFuelRef.current, lat, lng, rad)}
                  onPlanTrip={() => setIsTripModalOpen(true)}
                  navApp={settings.navApp}
                  fillLiters={fillLiters}
                  isRefreshing={isRefreshing}
                />
              </Suspense>
            </SectionBoundary>
          </div>
        )}

        {/* TAB 3: TRENDS DER REGION */}
        {isDbReady && activeTab === 'analytics' && (
          !hasValidApiKey ? renderNoKey(BarChart3, 'Trends brauchen echte Daten', 'Die regionalen Trends entstehen aus den echten Preisen aller Tankstellen in deinem Bereich. Dafür wird der kostenlose Tankerkönig-Key benötigt.') : (
            <SectionBoundary name="Trends">
              <Suspense fallback={<LazyFallback label="Trends werden geladen …" />}>
                <RegionalTrendsPanel
                  regionLabel={regionLabel}
                  stations={evaluatedStations}
                  regionReadingsMap={regionReadingsMap}
                  profile={profile}
                  regionNow={regionNow}
                  windows={windows}
                  moves={moves}
                  activeVehicle={activeVehicle}
                  fillLiters={fillLiters}
                  settings={settings}
                  fuelType={selectedFuel}
                  dataStats={dataStats}
                  onSelectStation={setSelectedStationForDetail}
                  rules={rules}
                />
              </Suspense>
            </SectionBoundary>
          )
        )}

        {/* TAB 4: TANKWART (KI) */}
        {isDbReady && activeTab === 'ml' && (
          !hasValidApiKey ? renderNoKey(Sparkles, 'Der Tankwart braucht echte Preise', 'Empfehlungen und das lernende Modell basieren ausschließlich auf echten Zapfsäulenpreisen deiner Region. Dafür wird der kostenlose Tankerkönig-Key benötigt.') : (
            <SectionBoundary name="Tankwart">
              <Suspense fallback={<LazyFallback label="Tankwart wird geladen …" />}>
                <TankwartPanel
                  advice={advice}
                  stations={sortedStations}
                  profile={profile}
                  regionReadingsMap={readingsMap}
                  moves={moves}
                  rules={rules}
                  onOpenLaws={() => setIsLawsModalOpen(true)}
                  mlStatus={mlStatus}
                  onTrainNow={async () => {
                    const meta = new Map(stations.map((s) => [s.id, { brand: s.brand }]));
                    const res = await trainOnHistory({ readingsMap: regionReadingsMap, stationsMeta: meta, epochs: 6, force: true, profile });
                    if (!res.trained) {
                      const msg = res.reason === 'insufficient'
                        ? `Noch zu wenig echte Messdaten für ein Training (${res.samples || 0} von 150 Beispielen). Die App sammelt bei jedem Öffnen weiter.`
                        : res.reason === 'busy' ? 'Das Modell trainiert gerade bereits.' : 'Training derzeit nicht möglich.';
                      showToast(msg, res.reason === 'insufficient' ? 'success' : 'error', 6000);
                    } else {
                      backupService.scheduleSync('history');
                    }
                  }}
                  onResetModel={() => resetModel()}
                  onSelectStation={setSelectedStationForDetail}
                  activeVehicle={activeVehicle}
                  regionLabel={regionLabel}
                  onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
                  navApp={settings.navApp}
                />
              </Suspense>
            </SectionBoundary>
          )
        )}
      </main>

      <footer className="app-footer">
        <p>
          KRAFTSTOFF • echte MTS-K-Preise via Tankerkönig (CC BY 4.0) • {dataStats.points ? `${dataStats.points.toLocaleString('de-DE')} eigene Messwerte` : 'Datensammlung läuft'}
        </p>
      </footer>

      {isMenuOpen && (
        <MoreMenuSheet
          onClose={() => setIsMenuOpen(false)}
          vehicleName={activeVehicle?.name || ''}
          lawSummary={ruleState.active ? `${ruleState.name} in Kraft` : `${laws.filter((l) => l.enabled).length} von ${laws.length} eingeschaltet`}
          unsaved={!!dbStatus.unsavedSince}
          alertsActive={notificationService.getPermission() === 'granted'}
          onOpen={(id) => {
            setIsMenuOpen(false);
            if (id === 'vehicle') setIsVehicleModalOpen(true);
            else if (id === 'places') setIsLocRouteModalOpen(true);
            else if (id === 'alerts') setIsPushModalOpen(true);
            else if (id === 'laws') setIsLawsModalOpen(true);
            else if (id === 'database') setIsICloudModalOpen(true);
            else if (id === 'settings') setIsSettingsModalOpen(true);
          }}
        />
      )}

      <SheetSwipeCloser />
      <PullToRefresh enabled={isDbReady && hasValidApiKey && activeTab !== 'map'} onRefresh={() => loadData()} />

      {/* Schwebender Hinweis (auch über der Karte sichtbar) */}
      {toast && (
        <div className={`app-toast is-${toast.type}`} role="status" aria-live="polite">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Hinweis schließen">
            <X size={14} />
          </button>
        </div>
      )}

      {/* MODALS */}
      {isVehicleModalOpen && (
        <VehicleGarageModal
          isOpen
          onClose={() => setIsVehicleModalOpen(false)}
          vehicles={vehicles}
          activeVehicleId={activeVehicleId}
          onSelectActiveVehicle={handleSelectVehicle}
          onUpdateVehicles={handleUpdateVehicles}
        />
      )}

      {isLocRouteModalOpen && (
        <LocationRouteModal
          isOpen
          onClose={() => setIsLocRouteModalOpen(false)}
          locations={locations}
          activeLocationId={activeLocationId}
          onSelectLocation={handleSelectLocation}
          onUpdateLocations={handleUpdateLocations}
          onUpdateRadius={handleUpdateRadius}
          routes={routes}
          activeRouteId={filterMode === 'route' ? activeRouteId : null}
          onSelectRoute={handleSelectRoute}
          onUpdateRoutes={handleUpdateRoutes}
        />
      )}

      {isPushModalOpen && (
        <PushNotificationManager onClose={() => setIsPushModalOpen(false)} settings={settings} onPause={handlePause30Min} onResume={handleResumeAlerts} />
      )}

      {isLawsModalOpen && (
        <LawsModal
          isOpen={isLawsModalOpen}
          onClose={() => setIsLawsModalOpen(false)}
          laws={laws}
          onUpdateLaws={(list) => setLaws([...list])}
          fuelType={selectedFuel}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          isOpen
          onClose={() => setIsSettingsModalOpen(false)}
          settings={settings}
          onSaveSettings={handleSaveSettings}
          dbStatus={dbStatus}
          serverKeyAvailable={dataService.serverKeyAvailable}
          onOpenDbSetup={() => { setIsSettingsModalOpen(false); setIsDbSetupOpen(true); }}
        />
      )}

      {isTripModalOpen && (
        <TripPlannerModal
          isOpen
          onClose={() => { setIsTripModalOpen(false); setTripInitial(null); }}
          locations={locations}
          activeLocation={activeLocation}
          initialLink={tripInitial?.link || null}
          initialDestination={tripInitial?.destination || null}
          defaultCorridorKm={DEFAULT_CORRIDOR_KM}
          onPlanTrip={handlePlanTrip}
        />
      )}

      {isICloudModalOpen && (
        <ICloudSyncModal
          onClose={() => setIsICloudModalOpen(false)}
          onSyncComplete={() => refreshFromServices()}
          stationIds={[...stations.map((st) => st.id), ...favoriteStationIds]}
          onHistoryImported={(res) => {
            if (res.points > 0) {
              scheduleTraining(selectedFuelRef.current, true);
              backupService.scheduleSync('history');
            }
          }}
          dbStatus={dbStatus}
          onOpenDbSetup={() => { setIsICloudModalOpen(false); setIsDbSetupOpen(true); }}
        />
      )}

      {isDbSetupOpen && (
        <DatabaseSetupScreen variant="modal" onConnected={handleDbConnected} onClose={() => setIsDbSetupOpen(false)} />
      )}

      {detailStation && (
        <Suspense fallback={null}>
          <StationDetailModal
            station={detailStation}
            baseStation={baseStation}
            activeVehicle={activeVehicle}
            fuelType={selectedFuel}
            defaultDetourMode={detourMode}
            isFavorite={favoriteStationIds.includes(detailStation.id)}
            onToggleFavorite={handleToggleFavorite}
            onClose={() => setSelectedStationForDetail(null)}
            profile={profile}
            windows={windows}
            moves={moves}
            rules={rules}
            navApp={settings.navApp}
            fillLiters={fillLiters}
            consumption={customConsumption || activeVehicle?.consumptionL100km || 6.2}
          />
        </Suspense>
      )}

      {/* Mobile Dock */}
      {isDbReady && (
        <nav className="mobile-bottom-nav" aria-label="Hauptnavigation">
          <button type="button" className={`bottom-nav-item ${activeTab === 'stations' ? 'active' : ''}`} onClick={() => setActiveTab('stations')} aria-label="Radar">
            <Fuel size={16} strokeWidth={activeTab === 'stations' ? 2.4 : 2} />
            <span className="bottom-nav-label">Radar</span>
          </button>
          <button type="button" className={`bottom-nav-item ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')} aria-label="Karte">
            <MapIcon size={16} strokeWidth={activeTab === 'map' ? 2.4 : 2} />
            <span className="bottom-nav-label">Karte</span>
          </button>
          <button type="button" className={`bottom-nav-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')} aria-label="Trends">
            <BarChart3 size={16} strokeWidth={activeTab === 'analytics' ? 2.4 : 2} />
            <span className="bottom-nav-label">Trends</span>
          </button>
          <button type="button" className={`bottom-nav-item ${activeTab === 'ml' ? 'active' : ''}`} onClick={() => setActiveTab('ml')} aria-label="Tankwart">
            <Sparkles size={16} strokeWidth={activeTab === 'ml' ? 2.4 : 2} />
            <span className="bottom-nav-label">Tankwart</span>
          </button>
        </nav>
      )}
    </div>
  );
}
