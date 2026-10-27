/**
 * KRAFTSTOFF - Fahrzeug- & Garagen-Verwaltung
 * 
 * Ermöglicht das Anlegen und Verwalten von Fahrzeugen mit:
 * - Kraftstoffart (Diesel, Super E10, Super E5)
 * - Durchschnittsverbrauch (L/100 km)
 * - Tankgröße (L)
 * - Aktuellem Füllstand (%) zur Berechnung der benötigten Tankmenge
 */

import { num, neededLitersFor } from '../engine/vehicleMath';

export { neededLitersFor };

const STORAGE_KEY = 'kraftstoff_user_vehicles';
const ACTIVE_VEHICLE_KEY = 'kraftstoff_active_vehicle_id';

/** Startfahrzeug bei einer Neuinstallation – wird in der Garage an das eigene Auto angepasst. */
export const INITIAL_VEHICLES = [
  {
    id: 'veh-default',
    name: 'Mein Auto',
    brand: 'Auto',
    fuelType: 'diesel',
    consumptionL100km: 6.0,
    tankCapacityL: 50,
    currentFuelLevelPct: 25,
  },
];

/**
 * Beispielfahrzeuge früherer Versionen. Bleiben als "unveränderte Standardwerte" bekannt, damit sie bei der
 * Synchronisation nie gelöschte Fahrzeuge eines anderen Geräts zurückholen.
 */
export const LEGACY_DEFAULT_VEHICLES = [
  { id: 'veh-golf-tdi', name: 'VW Golf 2.0 TDI', brand: 'Volkswagen', fuelType: 'diesel', consumptionL100km: 5.4, tankCapacityL: 50, currentFuelLevelPct: 15 },
  { id: 'veh-bmw-3er', name: 'BMW 320i Touring', brand: 'BMW', fuelType: 'e10', consumptionL100km: 7.2, tankCapacityL: 59, currentFuelLevelPct: 20 },
  { id: 'veh-audi-a4', name: 'Audi A4 2.0 TFSI', brand: 'Audi', fuelType: 'e5', consumptionL100km: 7.8, tankCapacityL: 54, currentFuelLevelPct: 25 },
];

class VehicleService {
  constructor() {
    this.vehicles = this.loadVehicles();
    this.activeVehicleId = this.loadActiveVehicleId();
  }

  loadVehicles() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return [...INITIAL_VEHICLES];
  }

  loadActiveVehicleId() {
    try {
      const stored = localStorage.getItem(ACTIVE_VEHICLE_KEY);
      if (stored && this.vehicles.some((v) => v.id === stored)) return stored;
    } catch {}
    return this.vehicles[0]?.id || INITIAL_VEHICLES[0].id;
  }

  saveVehicles(newVehicles) {
    this.vehicles = newVehicles;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newVehicles));
    } catch (e) {
      console.warn('Could not persist vehicles:', e);
    }
    return this.vehicles;
  }

  getActiveVehicle() {
    return this.vehicles.find((v) => v.id === this.activeVehicleId) || this.vehicles[0];
  }

  setActiveVehicleId(id) {
    this.activeVehicleId = id;
    try {
      localStorage.setItem(ACTIVE_VEHICLE_KEY, id);
    } catch (e) {
      console.warn('Could not persist active vehicle ID:', e);
    }
    return this.getActiveVehicle();
  }

  addVehicle(vehicleData) {
    const newVehicle = {
      id: `veh-${Date.now()}`,
      name: vehicleData.name || 'Neues Fahrzeug',
      brand: vehicleData.brand || 'Auto',
      fuelType: vehicleData.fuelType || 'diesel',
      consumptionL100km: Math.max(1, num(vehicleData.consumptionL100km, 6.5)),
      tankCapacityL: Math.max(5, num(vehicleData.tankCapacityL, 50)),
      currentFuelLevelPct: Math.min(100, Math.max(0, num(vehicleData.currentFuelLevelPct, 20))),
    };
    const updated = [...this.vehicles, newVehicle];
    this.saveVehicles(updated);
    this.setActiveVehicleId(newVehicle.id);
    return newVehicle;
  }

  updateVehicle(id, updates) {
    const updated = this.vehicles.map((v) => (v.id === id ? { ...v, ...updates } : v));
    this.saveVehicles(updated);
    return updated;
  }

  deleteVehicle(id) {
    if (this.vehicles.length <= 1) return this.vehicles; // mindestens 1 Auto behalten
    const updated = this.vehicles.filter((v) => v.id !== id);
    this.saveVehicles(updated);
    if (this.activeVehicleId === id) {
      this.setActiveVehicleId(updated[0].id);
    }
    return updated;
  }

  /**
   * Berechnet die zu tankende Litermenge basierend auf Tankgröße und Füllstand.
   */
  getNeededLiters(vehicle = this.getActiveVehicle()) {
    return neededLitersFor(vehicle);
  }
}

export const vehicleService = new VehicleService();
