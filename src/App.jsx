import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fuel,
  Map as MapIcon,
  BarChart3,
  Calendar,
  Sparkles,
  Scale,
  BellRing,
  Settings,
  Car,
  MapPin,
  Navigation,
  RefreshCw,
  ChevronRight,
  TrendingDown,
  Calculator,
  Cloud,
  Download,
  Upload,
  Compass,
  LocateFixed,
} from 'lucide-react';

import { dataService } from './services/dataService';
import { vehicleService } from './services/vehicleService';
import { locationService } from './services/locationService';
import { routeService } from './services/routeService';
import { backupService } from './services/backupService';
import { notificationService } from './services/notificationService';

import { evaluatePriceEngine } from './engine/adaptiveAverage';
import { initAndTrainModel, predictPriceScore, continuouslyTrainOnHistory } from './engine/mlModel';
import { calculateDetourProfitability } from './engine/detourCalculator';

import StationCard from './components/StationCard';
import RouteScheduleBar from './components/RouteScheduleBar';
import StationMapView from './components/StationMapView';
import TypicalWeekChart from './components/TypicalWeekChart';
import HeatmapChart from './components/HeatmapChart';
import PriceTrendChart from './components/PriceTrendChart';
import MachineLearningPanel from './components/MachineLearningPanel';

import VehicleGarageModal from './components/VehicleGarageModal';
import LocationRouteModal from './components/LocationRouteModal';
import LawTaxModal from './components/LawTaxModal';
import PushNotificationManager from './components/PushNotificationManager';
import SettingsModal from './components/SettingsModal';
import StationDetailModal from './components/StationDetailModal';
import ICloudSyncModal from './components/ICloudSyncModal';

export default function App() {
  // Navigation Tabs: 'stations' | 'map' | 'analytics' | 'ml'
  const [activeTab, setActiveTab] = useState('stations');

  // Daten & Einstellungen
  const [stations, setStations] = useState([]);
  const [settings, setSettings] = useState(dataService.userSettings);
  const [laws, setLaws] = useState(dataService.lawsTaxes);
  const [selectedFuel, setSelectedFuel] = useState(settings.fuelPreference || 'diesel');
  const [isCommuteActive, setIsCommuteActive] = useState(false);
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'price' | 'distance' | 'savings'
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fahrzeug-Zustand
  const [vehicles, setVehicles] = useState(vehicleService.vehicles);
  const [activeVehicleId, setActiveVehicleId] = useState(vehicleService.activeVehicleId);

  // Standort & Routen Zustand
  const [locations, setLocations] = useState(locationService.locations);
  const [activeLocationId, setActiveLocationId] = useState(locationService.activeLocationId);
  const [routes, setRoutes] = useState(routeService.routes);
  const [activeRouteId, setActiveRouteId] = useState(routeService.activeRouteId);

  // Fahrt-Option & Fahrzeug-Overrides
  const [detourMode, setDetourMode] = useState(routeService.activeRouteId ? 'route_corridor' : 'local_roundtrip');
  const [customConsumption, setCustomConsumption] = useState(null);
  const [customLiters, setCustomLiters] = useState(null);

  useEffect(() => {
    if (activeRouteId) {
      setDetourMode('route_corridor');
    }
  }, [activeRouteId]);

  // Modals
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isLocRouteModalOpen, setIsLocRouteModalOpen] = useState(false);
  const [isLawModalOpen, setIsLawModalOpen] = useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isICloudModalOpen, setIsICloudModalOpen] = useState(false);
  const [selectedStationForDetail, setSelectedStationForDetail] = useState(null);

  const [syncFeedback, setSyncFeedback] = useState(null);
  const [notifPermission, setNotifPermission] = useState('default');

  const directFileInputRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNotifPermission(notificationService.getPermission());
    }
  }, []);

  // iCloud Sync Handler
  const handleICloudSyncComplete = (importedData) => {
    if (importedData.vehicles) setVehicles([...importedData.vehicles]);
    if (importedData.activeVehicleId) setActiveVehicleId(importedData.activeVehicleId);
    if (importedData.locations) setLocations([...importedData.locations]);
    if (importedData.activeLocationId) setActiveLocationId(importedData.activeLocationId);
    if (importedData.routes) setRoutes([...importedData.routes]);
    if (importedData.activeRouteId) setActiveRouteId(importedData.activeRouteId);
    if (importedData.userSettings) setSettings({ ...importedData.userSettings });
    if (importedData.lawsTaxes) setLaws([...importedData.lawsTaxes]);

    const targetLoc =
      importedData.locations?.find((l) => l.id === importedData.activeLocationId) ||
      importedData.locations?.[0];
    const fuel = importedData.userSettings?.fuelPreference || selectedFuel;
    if (fuel !== selectedFuel) setSelectedFuel(fuel);
    loadData(fuel, targetLoc);
  };

  const [isSyncing, setIsSyncing] = useState(false);

  // 1-Klick Direkt-Sync aus iCloud Drive (ohne Finder-Dialog!)
  const handleSyncFromICloud = async () => {
    setIsSyncing(true);
    try {
      const res = await backupService.directSyncFromICloud();
      if (res.requiresManualFile) {
        // Fallback für Standalone/Remote-Betrieb: Öffne Dateiauswahl
        directFileInputRef.current?.click();
      } else {
        handleICloudSyncComplete(res.data);
        notificationService.playAlertChime();
        setSyncFeedback({
          type: 'success',
          message: `✓ In 0.1s synchronisiert! ${res.locationCount} Standorte & ${res.vehicleCount} Fahrzeuge direkt aus iCloud Drive geladen.`,
        });
        setTimeout(() => setSyncFeedback(null), 5000);
      }
    } catch (err) {
      setSyncFeedback({
        type: 'error',
        message: `Hinweis: ${err.message}`,
      });
      setTimeout(() => setSyncFeedback(null), 6000);
    } finally {
      setIsSyncing(false);
    }
  };

  // 1-Klick Direkt-Sync in iCloud Drive (ohne Finder-Dialog!)
  const handleSyncToICloud = async () => {
    setIsSyncing(true);
    try {
      const res = await backupService.directSyncToICloud();
      notificationService.playAlertChime();
      if (res.method === 'direct-file') {
        setSyncFeedback({
          type: 'success',
          message: `✓ Direkt in iCloud Drive gesichert (${res.directPath})!`,
        });
      } else {
        setSyncFeedback({
          type: 'success',
          message: '✓ Datei "kraftstoff_daten.json" heruntergeladen! In deinem iCloud Drive Ordner ablegen.',
        });
      }
      setTimeout(() => setSyncFeedback(null), 5000);
    } catch (err) {
      setSyncFeedback({
        type: 'error',
        message: `Fehler beim Sichern: ${err.message}`,
      });
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDirectFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await backupService.importBackupFile(file);
      handleICloudSyncComplete(res.data);
      notificationService.playAlertChime();
      setSyncFeedback({
        type: 'success',
        message: `✓ Alles aktualisiert! ${res.locationCount} Standorte & ${res.vehicleCount} Fahrzeuge übernommen • Live-Preise neu berechnet.`,
      });
      setTimeout(() => setSyncFeedback(null), 5000);
    } catch (err) {
      setSyncFeedback({
        type: 'error',
        message: `Fehler beim Laden der iCloud-Datei: ${err.message}`,
      });
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      if (directFileInputRef.current) directFileInputRef.current.value = '';
    }
  };

  // Lade Tankstellendaten
  const loadData = async (fuel = selectedFuel, loc = null) => {
    setIsRefreshing(true);
    try {
      const targetLoc = loc || locations.find((l) => l.id === activeLocationId) || locations[0];
      const data = await dataService.getStationsWithPrices(fuel, targetLoc);
      setStations(data);

      // Kontinuierliches On-Device Lernen im Hintergrund mit den neuen Tankstellendaten
      if (data && data.length > 0) {
        setTimeout(() => {
          continuouslyTrainOnHistory(data, 2).catch(() => {});
        }, 1500);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData(selectedFuel);
    initAndTrainModel(15).catch((err) => console.log('TF init background:', err));

    // Falls noch kein individueller Standort gesetzt wurde, frage GPS beim ersten Start automatisch an
    const hasCustomLoc = localStorage.getItem('kraftstoff_custom_location_set');
    if (!hasCustomLoc && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const res = await locationService.createOrUpdateGpsLocation(lat, lng);
            setLocations([...res.locations]);
            setActiveLocationId(res.location.id);
            await loadData(selectedFuel, res.location);
          } catch {}
        },
        () => {},
        { timeout: 7000, enableHighAccuracy: true }
      );
    }

    // Automatischer Hintergrund-Preiswächter alle 10 Minuten
    const interval = setInterval(() => {
      loadData(selectedFuel);
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Aktive Objekte
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) || vehicles[0];
  const activeLocation = locations.find((l) => l.id === activeLocationId) || locations[0];
  const activeRoute = routes.find((r) => r.id === activeRouteId) || null;
  const activeTaxReliefCent = 0; // 100% reale Zapfsäulenpreise ohne künstliche Verzerrungen
  const isTwelveClockActive = laws.some((l) => (l.key === 'twelve_clock_regulation' || l.id === 'rule-12-clock') && l.isActive);

  // Kraftstoffart wechseln
  const handleSelectFuel = (fuel) => {
    setSelectedFuel(fuel);
    loadData(fuel);
  };

  // Gesetze / Marktregeln updaten
  const handleUpdateLaws = (updatedLaws) => {
    const saved = dataService.saveLaws(updatedLaws);
    setLaws([...saved]);
    loadData(selectedFuel);
  };

  // Settings speichern
  const handleSaveSettings = (newSettings) => {
    const saved = dataService.saveSettings(newSettings);
    setSettings({ ...saved });
    loadData(selectedFuel);
    return saved;
  };

  // Snooze
  const handlePause30Min = () => {
    const updated = dataService.pauseAlerts30Minutes();
    setSettings({ ...updated });
  };
  const handleResumeAlerts = () => {
    const updated = dataService.resumeAlerts();
    setSettings({ ...updated });
  };
  const isPaused = dataService.isAlertsPaused();

  // Standort- und Radius-Wechsler
  const handleSelectLocation = (id, locObj = null) => {
    setActiveLocationId(id);
    locationService.setActiveLocationId(id);
    const target = locObj || locations.find((l) => l.id === id);
    loadData(selectedFuel, target);
  };

  // Live GPS-Ortung
  const handleLocateGps = () => {
    if (!navigator.geolocation) {
      alert('GPS wird von deinem Browser nicht unterstützt.');
      return;
    }
    setIsRefreshing(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const res = await locationService.createOrUpdateGpsLocation(lat, lng);
          setLocations([...res.locations]);
          setActiveLocationId(res.location.id);
          await loadData(selectedFuel, res.location);
          setSyncFeedback({
            type: 'success',
            message: `✓ Standort auf "${res.location.name}" (${lat.toFixed(4)}, ${lng.toFixed(4)}) aktualisiert!`,
          });
          setTimeout(() => setSyncFeedback(null), 5000);
        } catch (e) {
          alert('Fehler bei GPS-Ortung: ' + e.message);
        } finally {
          setIsRefreshing(false);
        }
      },
      (err) => {
        setIsRefreshing(false);
        alert('GPS-Zugriff nicht freigegeben: ' + err.message);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleUpdateRadius = (id, radiusKm) => {
    const updated = locationService.updateLocation(id, { radiusKm });
    setLocations([...updated]);
    const curr = updated.find((l) => l.id === (id || activeLocationId)) || updated[0];
    loadData(selectedFuel, curr);
  };

  const handleSelectQuickCity = (cityConfig) => {
    const res = locationService.switchToQuickCity(cityConfig);
    setLocations([...res.locations]);
    setActiveLocationId(res.location.id);
    loadData(selectedFuel, res.location);
    setSyncFeedback({
      type: 'success',
      message: `✓ Standort gewechselt zu "${cityConfig.name} Zentrum"!`,
    });
    setTimeout(() => setSyncFeedback(null), 4000);
  };

  // 1. Stationen bezüglich aktuellem Standort und Radius aktualisieren
  const localizedStations = useMemo(() => {
    return locationService.filterStationsByRadius(stations, activeLocation);
  }, [stations, activeLocation]);

  // 2. Stationen filtern, falls eine Route aktiv ist
  const routeFilteredStations = useMemo(() => {
    if (activeRoute) {
      return routeService.filterStationsByRoute(localizedStations, activeRoute);
    }
    return localizedStations;
  }, [localizedStations, activeRoute]);

  // 3. Basistankstelle finden (die nächste zum Standort)
  const baseStation = useMemo(() => {
    if (routeFilteredStations.length === 0) return null;
    return [...routeFilteredStations].sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0))[0];
  }, [routeFilteredStations]);

  // 4. Bewertung & Rentabilitäts-Berechnung
  const evaluatedStations = useMemo(() => {
    const thresholdEuro = (settings.alertThresholdCent || 3.0) / 100;
    const now = new Date();
    const fillLiters = customLiters || vehicleService.getNeededLiters(activeVehicle);
    const consumption = customConsumption || activeVehicle?.consumptionL100km || 6.2;

    return routeFilteredStations.map((st) => {
      const evaluation = evaluatePriceEngine({
        currentPrice: st.currentPrice,
        history: st.history,
        thresholdCent: thresholdEuro,
        taxReliefCent: 0,
      });

      const mlPrediction = predictPriceScore({
        stationId: st.id,
        dayOfWeek: now.getDay(),
        hourOfDay: now.getHours(),
        currentPrice: st.currentPrice,
        dynAverage: evaluation.effectiveDynAverage,
        twelveClockActive: isTwelveClockActive,
      });

      const detour = calculateDetourProfitability({
        targetPrice: st.currentPrice,
        targetDistanceKm: st.distanceKm,
        basePrice: baseStation ? baseStation.currentPrice : st.currentPrice,
        baseDistanceKm: baseStation ? baseStation.distanceKm : 0,
        fillLiters,
        consumptionL100km: consumption,
        isRoundtrip: detourMode !== 'route_corridor',
        detourMode,
        realAdditionalKm: st.realAdditionalKm,
      });

      return {
        ...st,
        evaluation,
        mlPrediction,
        detour,
      };
    });
  }, [routeFilteredStations, settings.alertThresholdCent, isTwelveClockActive, activeVehicle, baseStation, detourMode, customLiters, customConsumption]);

  // 5. Sortierung
  const sortedStations = useMemo(() => {
    let list = [...evaluatedStations];

    if (isCommuteActive) {
      list = list.filter((s) => s.isOnCommuteRoute || s.isOnRouteCorridor);
    }

    if (sortBy === 'score') {
      list.sort((a, b) => (b.mlPrediction?.score || 0) - (a.mlPrediction?.score || 0));
    } else if (sortBy === 'price') {
      list.sort((a, b) => a.currentPrice - b.currentPrice);
    } else if (sortBy === 'distance') {
      list.sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    } else if (sortBy === 'savings') {
      list.sort((a, b) => (b.detour?.netSavingsEuro || 0) - (a.detour?.netSavingsEuro || 0));
    }

    return list;
  }, [evaluatedStations, isCommuteActive, sortBy]);

  const bestStation = sortedStations[0];

  // Automatische Preisschwellen-Prüfung für Push & Akustik-Chime
  useEffect(() => {
    if (sortedStations.length > 0) {
      notificationService.checkAndTriggerPriceAlerts(sortedStations, settings, selectedFuel);
    }
  }, [sortedStations, settings, selectedFuel]);

  return (
    <div className="app-viewport">
      
      {/* Minimalist Glasmorphe Header */}
      <header className="header-glass">
        <div className="header-inner">
          
          {/* Logo */}
          <div className="brand-badge" onClick={() => setActiveTab('stations')}>
            <div className="brand-logo-box">
              <Fuel size={20} strokeWidth={2.4} />
            </div>
            <div>
              <div className="brand-title">KRAFTSTOFF</div>
              <div className="brand-subtitle">Intelligenter Tankradar</div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="nav-pill-group">
            <button
              className={`nav-pill-btn ${activeTab === 'stations' ? 'active' : ''}`}
              onClick={() => setActiveTab('stations')}
            >
              <Fuel size={14} />
              <span>Radar</span>
            </button>
            <button
              className={`nav-pill-btn ${activeTab === 'map' ? 'active' : ''}`}
              onClick={() => setActiveTab('map')}
            >
              <MapIcon size={14} />
              <span>Karte</span>
            </button>
            <button
              className={`nav-pill-btn ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart3 size={14} />
              <span>Typische Woche</span>
            </button>
            <button
              className={`nav-pill-btn ${activeTab === 'ml' ? 'active' : ''}`}
              onClick={() => setActiveTab('ml')}
            >
              <Sparkles size={14} />
              <span>KI (TF.js)</span>
            </button>
          </nav>

          {/* Action Icons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            
            {/* Auto Garage Button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsVehicleModalOpen(true)}
              title="Fahrzeug-Garage & Verbrauch"
              style={{ padding: '0.45rem' }}
            >
              <Car size={16} color="#0F172A" />
            </button>

            {/* Standorte & Routen Button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsLocRouteModalOpen(true)}
              title="Standorte & Routen verwalten"
              style={{ padding: '0.45rem' }}
            >
              <MapPin size={16} color="#0F172A" />
            </button>

            {/* Marktregeln & 12-Uhr-Verordnung Icon */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsLawModalOpen(true)}
              title="Marktregeln & 12-Uhr-Verordnung anpassen"
              style={{ position: 'relative', padding: '0.45rem' }}
            >
              <Scale size={16} color="#0F172A" />
              {isTwelveClockActive && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#059669',
                  }}
                  title="12-Uhr-Spritpreisverordnung aktiv"
                />
              )}
            </button>

            {/* Web Push Manager */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsPushModalOpen(true)}
              title="Push-Benachrichtigungen"
              style={{ padding: '0.45rem' }}
            >
              <BellRing size={16} color="#0F172A" />
            </button>

            {/* iCloud Sync Button */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsICloudModalOpen(true)}
              title="iCloud Drive Sync (Mac & iPhone)"
              style={{ padding: '0.45rem' }}
            >
              <Cloud size={16} color="#0284C7" />
            </button>

            {/* Einstellungen */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Einstellungen & Supabase"
              style={{ padding: '0.45rem' }}
            >
              <Settings size={16} color="#0F172A" />
            </button>

          </div>

        </div>
      </header>

      {/* Hauptinhalt */}
      <main style={{ flex: 1, paddingBottom: '2.5rem' }}>

        {/* Versteckter File-Input für 1-Klick Import aus iCloud */}
        <input
          type="file"
          ref={directFileInputRef}
          accept=".json,application/json"
          onChange={handleDirectFileImport}
          style={{ display: 'none' }}
        />

        {/* Haupt-Synchronisationsleiste beim Start der App */}
        <div
          className="clean-card"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1.15rem',
            background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)',
            border: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.85rem',
            boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#0F172A',
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Cloud size={20} color="#38BDF8" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0F172A' }}>
                  KRAFTSTOFF Synchronisation
                </span>
                <span className="badge badge-gray" style={{ fontSize: '0.66rem' }}>
                  iCloud Drive & Lokal
                </span>
                {notifPermission !== 'granted' && (
                  <button
                    onClick={() => setIsPushModalOpen(true)}
                    className="badge badge-neutral"
                    style={{ fontSize: '0.66rem', cursor: 'pointer', border: '1px solid #CBD5E1', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                    title="Mitteilungen einschalten"
                  >
                    <BellRing size={10} color="#0284C7" />
                    <span>Preisalarm aktivieren</span>
                  </button>
                )}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: '0.2rem' }}>
                Aktiv: <strong>{activeLocation?.name}</strong> ({activeLocation?.radiusKm} km) •{' '}
                <strong>{activeVehicle?.name}</strong> ({activeVehicle?.consumptionL100km} L) •{' '}
                <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{selectedFuel}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Der zentrale "Aus iCloud aktualisieren" Button (Direkt-Sync ohne Dialog!) */}
            <button
              onClick={handleSyncFromICloud}
              disabled={isSyncing}
              className="btn btn-primary"
              style={{
                fontSize: '0.82rem',
                padding: '0.55rem 0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: '#0F172A',
                color: '#FFFFFF',
                boxShadow: '0 2px 6px rgba(15,23,42,0.18)',
                cursor: isSyncing ? 'not-allowed' : 'pointer',
              }}
              title="Liest kraftstoff_daten.json direkt aus deinem iCloud Drive und aktualisiert alle Daten und Preise sofort"
            >
              <Upload size={14} color="#38BDF8" className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? 'Synchronisiere...' : 'Aus iCloud aktualisieren'}</span>
            </button>

            {/* In iCloud sichern Button (Direkt-Sync ohne Download-Dialog!) */}
            <button
              onClick={handleSyncToICloud}
              disabled={isSyncing}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.78rem', padding: '0.5rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              title="Speichert alle aktuellen Orte, Autos & Einstellungen direkt in deine iCloud Drive Datei"
            >
              <Download size={13} color="#059669" />
              <span>In iCloud sichern</span>
            </button>

            {/* Preise neu abrufen */}
            <button
              onClick={() => loadData(selectedFuel)}
              disabled={isRefreshing}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.78rem', padding: '0.5rem 0.7rem' }}
              title="Preise vom Server neu abrufen"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Feedback Banner nach Synchronisation */}
        {syncFeedback && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.65rem 0.95rem',
              borderRadius: '8px',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: syncFeedback.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              color: syncFeedback.type === 'success' ? '#065F46' : '#991B1B',
              border: `1px solid ${syncFeedback.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
              fontWeight: 600,
            }}
          >
            <span>{syncFeedback.message}</span>
            <button
              onClick={() => setSyncFeedback(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700, fontSize: '0.9rem' }}
            >
              ×
            </button>
          </div>
        )}



        {/* Steuerungsleiste: Fahrzeug, Standort/Radius, Route, Sorte, Heimweg */}
        <RouteScheduleBar
          selectedFuel={selectedFuel}
          onSelectFuel={handleSelectFuel}
          isCommuteActive={isCommuteActive}
          onToggleCommute={() => setIsCommuteActive(!isCommuteActive)}
          isPaused={isPaused}
          pausedUntil={settings.pausedUntil}
          onPause30Min={handlePause30Min}
          onResumeAlerts={handleResumeAlerts}
          sortBy={sortBy}
          onSelectSort={setSortBy}
          activeVehicle={activeVehicle}
          onOpenVehicleModal={() => setIsVehicleModalOpen(true)}
          activeLocation={activeLocation}
          activeRoute={activeRoute}
          onOpenLocationRouteModal={() => setIsLocRouteModalOpen(true)}
          onLocateGps={handleLocateGps}
          onSelectQuickCity={handleSelectQuickCity}
          detourMode={detourMode}
          onSelectDetourMode={setDetourMode}
          customConsumption={customConsumption}
          onUpdateCustomConsumption={setCustomConsumption}
          customLiters={customLiters}
          onUpdateCustomLiters={setCustomLiters}
          onResetVehicleOverrides={() => {
            setCustomConsumption(null);
            setCustomLiters(null);
          }}
        />

        {/* TAB 1: RADAR & TANKSTELLEN-LISTE */}
        {activeTab === 'stations' && (
          <>
            {/* Top-Empfehlung Banner */}
            {bestStation && (
              <div
                className="clean-card"
                style={{
                  background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)',
                  marginBottom: '1.25rem',
                  padding: '1.25rem',
                  border: '1px solid #E2E8F0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
                      <span className="badge badge-favorable">
                        <Sparkles size={12} />
                        <span>Top-Empfehlung ({activeVehicle?.name})</span>
                      </span>
                      {bestStation.isOnRouteCorridor && (
                        <span className="badge badge-blue">Auf deiner aktiven Route</span>
                      )}
                    </div>

                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>
                      {bestStation.name}
                    </h2>
                    <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '0.15rem' }}>
                      {bestStation.street} • {bestStation.distanceKm} km entfernt •{' '}
                      {bestStation.detour?.isProfitable ? (
                        <strong style={{ color: '#059669' }}>
                          Fahrt lohnt sich! Netto-Gewinn: +{bestStation.detour?.netSavingsEuro.toFixed(2)} €
                        </strong>
                      ) : (
                        <span>Niedrigster Zapfsäulenpreis</span>
                      )}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="num-mono" style={{ fontSize: '2rem', fontWeight: 800, color: '#059669', lineHeight: 1 }}>
                        {bestStation.currentPrice.toFixed(3)}
                        <span style={{ fontSize: '0.9rem', color: '#64748B', marginLeft: '0.25rem' }}>€/L</span>
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#94A3B8', textTransform: 'uppercase' }}>
                        {selectedFuel}
                      </span>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={() => setSelectedStationForDetail(bestStation)}
                    >
                      <span>Analyse öffnen</span>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Schnellwechsler für Standorte & Radius */}
            <div
              className="clean-card"
              style={{
                marginBottom: '1rem',
                padding: '0.65rem 0.85rem',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                background: '#FFFFFF',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <MapPin size={13} color="#0F172A" />
                  <span>Standort:</span>
                </span>
                {locations.map((loc) => {
                  const isActive = loc.id === activeLocationId;
                  return (
                    <button
                      key={loc.id}
                      onClick={() => handleSelectLocation(loc.id, loc)}
                      className="btn"
                      style={{
                        padding: '0.25rem 0.65rem',
                        fontSize: '0.74rem',
                        borderRadius: '20px',
                        background: isActive ? '#0F172A' : '#F1F5F9',
                        color: isActive ? '#FFFFFF' : '#475569',
                        border: 'none',
                        fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {loc.name}
                    </button>
                  );
                })}
                <button
                  onClick={() => setIsLocRouteModalOpen(true)}
                  style={{
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.72rem',
                    borderRadius: '20px',
                    background: 'transparent',
                    border: '1px dashed #CBD5E1',
                    color: '#64748B',
                    cursor: 'pointer',
                  }}
                  title="Neuen Ort anlegen"
                >
                  + Ort anlegen
                </button>
                <button
                  onClick={handleLocateGps}
                  style={{
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.72rem',
                    borderRadius: '20px',
                    background: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    color: '#1E40AF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontWeight: 600,
                  }}
                  title="Aktuellen GPS-Standort orten & übernehmen"
                >
                  <Compass size={11} color="#0284C7" />
                  <span>GPS orten</span>
                </button>
              </div>

              {/* Radius-Slider für den aktiven Standort */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
                <span style={{ color: '#64748B' }}>Suchradius:</span>
                <input
                  type="range"
                  min="2"
                  max="25"
                  step="1"
                  value={activeLocation?.radiusKm || 5}
                  onChange={(e) => handleUpdateRadius(activeLocation.id, parseFloat(e.target.value))}
                  style={{ width: '90px', accentColor: '#0F172A', cursor: 'pointer' }}
                />
                <strong className="num-mono" style={{ color: '#0F172A', minWidth: '38px' }}>
                  {activeLocation?.radiusKm} km
                </strong>
              </div>
            </div>

            {/* Listenkopf */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                {sortedStations.length} Tankstellen im Radius ({activeLocation?.radiusKm} km um {activeLocation?.name})
                {activeRoute && ` • Korridor: ${activeRoute.name}`}
              </div>

              <button
                className="btn btn-secondary btn-sm"
                onClick={() => loadData(selectedFuel)}
                disabled={isRefreshing}
                title="Preise aktualisieren"
              >
                <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                <span>Aktualisieren</span>
              </button>
            </div>

            {/* Grid aller Stationen */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
              {sortedStations.map((st) => (
                <StationCard
                  key={st.id}
                  station={st}
                  baseStation={baseStation}
                  activeVehicle={activeVehicle}
                  evaluation={st.evaluation}
                  mlPrediction={st.mlPrediction}
                  fuelType={selectedFuel}
                  detourMode={detourMode}
                  customConsumption={customConsumption}
                  customLiters={customLiters}
                  onSelect={() => setSelectedStationForDetail(st)}
                />
              ))}
            </div>
          </>
        )}

        {/* TAB 2: INTERAKTIVE KARTENANSICHT */}
        {activeTab === 'map' && (
          <div>
            <StationMapView
              stations={sortedStations}
              locations={locations}
              activeLocation={activeLocation}
              onSelectLocation={handleSelectLocation}
              onSelectQuickCity={handleSelectQuickCity}
              onUpdateRadius={handleUpdateRadius}
              onLocateGps={handleLocateGps}
              activeRoute={activeRoute}
              activeVehicle={activeVehicle}
              fuelType={selectedFuel}
              selectedStation={selectedStationForDetail}
              onSelectStation={(st) => setSelectedStationForDetail(st)}
            />
          </div>
        )}

        {/* TAB 3: TYPISCHE WOCHE & D3 ANALYSEN */}
        {activeTab === 'analytics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* 1. Die "Typische Woche" - Dynamischer Wochenzyklus mit Hoch- und Tiefzeiten */}
            <TypicalWeekChart
              baseFuelPrice={bestStation ? bestStation.currentPrice : 1.72}
              fuelType={selectedFuel}
              taxReliefCent={activeTaxReliefCent}
            />

            {/* 2. D3 Heatmap 7 Tage x 24 Stunden Matrix */}
            <HeatmapChart
              history={bestStation?.history || []}
              fuelType={selectedFuel}
              stationName={bestStation?.name}
            />

            {/* 3. D3 Preisverlauf mit AMA und Volatilitätsband */}
            {bestStation && (
              <PriceTrendChart
                history={bestStation.history}
                stationName={bestStation.name}
                fuelType={selectedFuel}
                evaluation={bestStation.evaluation}
              />
            )}
          </div>
        )}

        {/* TAB 4: TENSORFLOW.JS MACHINE LEARNING */}
        {activeTab === 'ml' && (
          <MachineLearningPanel
            stations={evaluatedStations}
            activeVehicle={activeVehicle}
            activeLawsCount={laws.filter((l) => l.isActive).length}
            isTwelveClockActive={isTwelveClockActive}
          />
        )}

      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #E2E8F0', padding: '1.5rem 0', marginTop: 'auto', textAlign: 'center', fontSize: '0.78rem', color: '#94A3B8' }}>
        <p>
          KRAFTSTOFF PWA • Kartenansicht & Ersparnis-Rechner • Typische Woche Zyklus-Analyse • Garage: {activeVehicle?.name} ({activeVehicle?.consumptionL100km} L/100km)
        </p>
      </footer>

      {/* MODALS */}
      <VehicleGarageModal
        isOpen={isVehicleModalOpen}
        onClose={() => setIsVehicleModalOpen(false)}
        vehicles={vehicles}
        activeVehicleId={activeVehicleId}
        onSelectActiveVehicle={(id) => setActiveVehicleId(id)}
        onUpdateVehicles={(updated) => setVehicles([...updated])}
      />

      <LocationRouteModal
        isOpen={isLocRouteModalOpen}
        onClose={() => setIsLocRouteModalOpen(false)}
        locations={locations}
        activeLocationId={activeLocationId}
        onSelectLocation={handleSelectLocation}
        onUpdateLocations={(updated) => {
          setLocations([...updated]);
        }}
        routes={routes}
        activeRouteId={activeRouteId}
        onSelectRoute={(id) => setActiveRouteId(id)}
        onUpdateRoutes={(updated) => setRoutes([...updated])}
      />

      <LawTaxModal
        isOpen={isLawModalOpen}
        onClose={() => setIsLawModalOpen(false)}
        laws={laws}
        onUpdateLaws={handleUpdateLaws}
      />

      <PushNotificationManager
        isOpen={isPushModalOpen}
        onClose={() => setIsPushModalOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />

      <ICloudSyncModal
        isOpen={isICloudModalOpen}
        onClose={() => setIsICloudModalOpen(false)}
        onSyncComplete={handleICloudSyncComplete}
      />

      {selectedStationForDetail && (
        <StationDetailModal
          station={selectedStationForDetail}
          baseStation={baseStation}
          activeVehicle={activeVehicle}
          evaluation={selectedStationForDetail.evaluation}
          mlPrediction={selectedStationForDetail.mlPrediction}
          fuelType={selectedFuel}
          defaultDetourMode={detourMode}
          onClose={() => setSelectedStationForDetail(null)}
        />
      )}

    </div>
  );
}
