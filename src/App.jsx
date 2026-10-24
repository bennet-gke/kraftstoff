import React, { useState, useEffect, useMemo } from 'react';
import {
  Fuel,
  Map as MapIcon,
  BarChart3,
  Sparkles,
  Scale,
  BellRing,
  Settings,
  Car,
  MapPin,
  RefreshCw,
  ChevronRight,
  Cloud,
} from 'lucide-react';

import { dataService } from './services/dataService';
import { vehicleService } from './services/vehicleService';
import { locationService } from './services/locationService';
import { routeService } from './services/routeService';
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
  // iCloud Sync Handler (wird vom ICloudSyncModal aufgerufen)
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
              <Fuel size={19} strokeWidth={2.4} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="brand-title">KRAFTSTOFF</span>
                <span className="live-status-pill">
                  <span className="live-dot" />
                  <span>LIVE</span>
                </span>
              </div>
              <div className="brand-subtitle">Intelligenter Tankradar</div>
            </div>
          </div>

          {/* Navigation Tabs (Desktop only; on mobile rendered in iOS bottom bar) */}
          <nav className="nav-pill-group desktop-nav-pills">
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

          {/* Action Dock (Apple-Style Frosted Capsule) */}
          <div className="header-action-dock" role="toolbar" aria-label="Schnellaktionen">
            
            {/* Auto Garage Button */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsVehicleModalOpen(true)}
              title={`Garage: ${activeVehicle?.name || 'Fahrzeuge'}`}
              aria-label="Fahrzeug-Garage"
            >
              <Car size={16} />
            </button>

            {/* Standorte & Routen Button */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsLocRouteModalOpen(true)}
              title="Standorte & Routen"
              aria-label="Standorte und Routen"
            >
              <MapPin size={16} />
            </button>

            {/* Marktregeln & 12-Uhr-Verordnung Icon */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsLawModalOpen(true)}
              title="Marktregeln & 12-Uhr-Verordnung"
              aria-label="Marktregeln"
            >
              <Scale size={16} />
              {isTwelveClockActive && (
                <span
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: '#059669',
                    boxShadow: '0 0 0 1.5px #FFFFFF',
                  }}
                  title="12-Uhr-Spritpreisverordnung aktiv"
                />
              )}
            </button>

            {/* Web Push Manager */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsPushModalOpen(true)}
              title="Push-Benachrichtigungen"
              aria-label="Push-Benachrichtigungen"
            >
              <BellRing size={16} />
            </button>

            {/* iCloud Sync Button */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsICloudModalOpen(true)}
              title="iCloud Drive Sync"
              aria-label="iCloud Sync"
            >
              <Cloud size={16} color="#0284C7" />
            </button>

            {/* Einstellungen */}
            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Einstellungen"
              aria-label="Einstellungen"
            >
              <Settings size={16} />
            </button>

          </div>

        </div>
      </header>

      {/* Hauptinhalt */}
      <main className="main-content-mobile" style={{ flex: 1, paddingBottom: '2.5rem' }}>





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

        {/* Aufgeräumte zentrale Steuerungsleiste (Fahrzeug, Standort, Radius, Route, Kraftstoff, Sortierung) */}
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
          locations={locations}
          onSelectLocation={handleSelectLocation}
          onUpdateRadius={handleUpdateRadius}
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
            {/* Top-Empfehlung Banner mit kombinierter Literpreis- & Mehrweg-Rechnung */}
            {bestStation && (
              <div className="top-recommendation-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.85rem' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span className="badge badge-favorable">
                        <Sparkles size={12} />
                        <span>Top-Empfehlung ({activeVehicle?.name || 'Fahrzeug'})</span>
                      </span>
                      {bestStation.isOnRouteCorridor && (
                        <span className="badge badge-blue">Auf aktiver Route</span>
                      )}
                      {baseStation && bestStation.id !== baseStation.id && bestStation.detour?.priceDiffCent > 0 && (
                        <span className="badge badge-favorable" style={{ fontWeight: 700 }}>
                          -{bestStation.detour.priceDiffCent.toFixed(1)} ct/L günstiger
                        </span>
                      )}
                    </div>

                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
                      {bestStation.name}
                    </h2>
                    <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.2rem', lineHeight: 1.4 }}>
                      {bestStation.street} • {bestStation.distanceKm} km entfernt •{' '}
                      {bestStation.detour?.isProfitable && baseStation && bestStation.id !== baseStation.id ? (
                        <strong style={{ color: '#059669' }}>
                          +{Number(bestStation.detour?.netSavingsEuro || 0).toFixed(2)} € Reingewinn ({bestStation.detour.formulaSummary})
                        </strong>
                      ) : (
                        <span>Niedrigster Zapfsäulenpreis vor Ort</span>
                      )}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="num-mono" style={{ fontSize: '1.9rem', fontWeight: 800, color: '#059669', lineHeight: 1 }}>
                        {Number(bestStation.currentPrice || 1.70).toFixed(3)}
                        <span style={{ fontSize: '0.85rem', color: '#64748B', marginLeft: '0.2rem' }}>€/L</span>
                      </div>
                      <span style={{ fontSize: '0.7rem', color: '#94A3B8', textTransform: 'uppercase', fontWeight: 700 }}>
                        {selectedFuel}
                      </span>
                    </div>

                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setSelectedStationForDetail(bestStation)}
                      style={{ padding: '0.55rem 0.95rem', borderRadius: '9999px' }}
                    >
                      <span>Analyse</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Aufgeräumter Listenkopf mit klarer Referenz-Station */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.85rem',
                padding: '0 0.2rem',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>
                {sortedStations.length} Tankstellen im Radius ({Number(activeLocation?.radiusKm || 5)} km um {activeLocation?.name || 'Mein Standort'})
                {baseStation && (
                  <span style={{ color: '#64748B', fontWeight: 500, marginLeft: '0.4rem' }}>
                    • Basis: <strong>{baseStation.name}</strong> ({baseStation.distanceKm} km • <span className="num-mono">{baseStation.currentPrice.toFixed(3)} €</span>)
                  </span>
                )}
              </div>

              <button
                className="btn btn-secondary btn-sm"
                onClick={() => loadData(selectedFuel)}
                disabled={isRefreshing}
                title="Preise aktualisieren"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.74rem', borderRadius: '9999px' }}
              >
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                <span>Aktualisieren</span>
              </button>
            </div>

            {/* Grid aller Stationen */}
            <div className="station-cards-grid">
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

      {/* iOS Floating Capsule Navigation Dock (Apple-Style Glass Island) */}
      <nav className="mobile-bottom-nav" aria-label="Hauptnavigation">
        <button
          type="button"
          className={`bottom-nav-item ${activeTab === 'stations' ? 'active' : ''}`}
          onClick={() => setActiveTab('stations')}
          aria-label="Radar"
        >
          <Fuel size={16} strokeWidth={activeTab === 'stations' ? 2.4 : 2} />
          <span className="bottom-nav-label">Radar</span>
        </button>

        <button
          type="button"
          className={`bottom-nav-item ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
          aria-label="Karte"
        >
          <MapIcon size={16} strokeWidth={activeTab === 'map' ? 2.4 : 2} />
          <span className="bottom-nav-label">Karte</span>
        </button>

        <button
          type="button"
          className={`bottom-nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
          aria-label="Trends"
        >
          <BarChart3 size={16} strokeWidth={activeTab === 'analytics' ? 2.4 : 2} />
          <span className="bottom-nav-label">Trends</span>
        </button>

        <button
          type="button"
          className={`bottom-nav-item ${activeTab === 'ml' ? 'active' : ''}`}
          onClick={() => setActiveTab('ml')}
          aria-label="KI Prognosen"
        >
          <Sparkles size={16} strokeWidth={activeTab === 'ml' ? 2.4 : 2} />
          <span className="bottom-nav-label">KI</span>
        </button>
      </nav>

    </div>
  );
}
