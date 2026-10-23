/**
 * KRAFTSTOFF - iCloud & Lokaler Datei-Sync Service
 * 
 * Unterstützt 2 nahtlose Modi:
 * 1. Direkter Server-Sync (Mac & Heim-WLAN): Liest & schreibt direkt auf den angegebenen Pfad (z.B. ~/Library/Mobile Documents/com~apple~CloudDocs/kraftstoff_daten.json) ohne Dateiauswahldialog!
 * 2. File-Picker / Download Fallback (Unterwegs auf iPhone oder statische Deployments).
 */

import { vehicleService } from './vehicleService';
import { locationService } from './locationService';
import { routeService } from './routeService';
import { dataService } from './dataService';

const STORAGE_KEY_PATH = 'KRAFTSTOFF_ICLOUD_PATH';
const DEFAULT_MAC_PATH = '~/Library/Mobile Documents/com~apple~CloudDocs/kraftstoff_daten.json';

class BackupService {
  constructor() {
    this.customPath = this.getCustomPath();
  }

  getCustomPath() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PATH);
      return stored || DEFAULT_MAC_PATH;
    } catch {
      return DEFAULT_MAC_PATH;
    }
  }

  setCustomPath(newPath) {
    this.customPath = (newPath || DEFAULT_MAC_PATH).trim();
    localStorage.setItem(STORAGE_KEY_PATH, this.customPath);
    return this.customPath;
  }

  /**
   * Prüft, ob der lokale Vite/Mac Server für direkten Pfad-Zugriff erreichbar ist.
   */
  async checkServerStatus() {
    try {
      const res = await fetch(`/api/icloud-sync/check?path=${encodeURIComponent(this.getCustomPath())}`);
      if (!res.ok) return { isAvailable: false };
      const data = await res.json();
      return { isAvailable: true, ...data };
    } catch (e) {
      return { isAvailable: false, error: e.message };
    }
  }

  /**
   * Sammelt alle lokalen Daten zu einem vollständigen Backup-Objekt.
   */
  exportAllData() {
    return {
      appName: 'KRAFTSTOFF',
      version: 1,
      exportedAt: new Date().toISOString(),
      vehicles: vehicleService.vehicles,
      activeVehicleId: vehicleService.activeVehicleId,
      locations: locationService.locations,
      activeLocationId: locationService.activeLocationId,
      routes: routeService.routes,
      activeRouteId: routeService.activeRouteId,
      userSettings: dataService.userSettings,
      lawsTaxes: dataService.lawsTaxes,
      credentials: dataService.getCredentials(),
    };
  }

  /**
   * Wendet ein eingelesenes Daten-Objekt sofort auf alle Services an.
   */
  applyImportedData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Ungültiges Datenformat.');
    }

    // 1. Fahrzeuge
    if (Array.isArray(data.vehicles) && data.vehicles.length > 0) {
      vehicleService.saveVehicles(data.vehicles);
      if (data.activeVehicleId) {
        vehicleService.setActiveVehicleId(data.activeVehicleId);
      }
    }

    // 2. Standorte
    if (Array.isArray(data.locations) && data.locations.length > 0) {
      locationService.saveLocations(data.locations);
      if (data.activeLocationId) {
        locationService.setActiveLocationId(data.activeLocationId);
      }
    }

    // 3. Routen
    if (Array.isArray(data.routes) && data.routes.length > 0) {
      routeService.saveRoutes(data.routes);
      if (data.activeRouteId) {
        routeService.setActiveRouteId(data.activeRouteId);
      }
    }

    // 4. Nutzereinstellungen
    if (data.userSettings && typeof data.userSettings === 'object') {
      dataService.saveSettings(data.userSettings);
    }

    // 5. Gesetze & Steuern
    if (Array.isArray(data.lawsTaxes)) {
      dataService.saveLaws(data.lawsTaxes);
    }

    // 6. API-Credentials (Schützt vorhandenen Tankerkönig Key vor Überschreiben mit leeren Daten)
    const currentCreds = dataService.getCredentials();
    const incomingCreds = data.credentials && typeof data.credentials === 'object' ? data.credentials : {};
    const incomingTk = (incomingCreds.tankerkoenigKey || incomingCreds.tankerkoenigApiKey || '').trim();

    const mergedCreds = {
      ...currentCreds,
      ...incomingCreds,
      tankerkoenigKey: incomingTk || currentCreds.tankerkoenigKey || '',
      tankerkoenigApiKey: incomingTk || currentCreds.tankerkoenigKey || '',
    };
    dataService.saveCredentials(mergedCreds);

    return {
      success: true,
      exportedAt: data.exportedAt,
      vehicleCount: data.vehicles?.length || 0,
      locationCount: data.locations?.length || 0,
      routeCount: data.routes?.length || 0,
      data,
    };
  }

  /**
   * 1-KLICK DIREKT-SYNC AUS ICLOUD:
   * Versucht zuerst die Datei direkt über den lokalen Server vom Mac-Dateipfad zu laden (ohne Dialog!).
   */
  async directSyncFromICloud() {
    const customPath = this.getCustomPath();
    const serverStatus = await this.checkServerStatus();

    if (serverStatus.isAvailable) {
      const res = await fetch(`/api/icloud-sync?path=${encodeURIComponent(customPath)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Datei konnte unter "${serverStatus.path}" nicht gelesen werden.`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error('Datei enthält keine gültigen KRAFTSTOFF-Daten.');
      }

      const applied = this.applyImportedData(json.data);
      return {
        ...applied,
        directPath: json.path,
        lastModified: json.lastModified,
        method: 'direct-file',
      };
    }

    // Falls kein Server erreichbar ist (z.B. Standalone iPhone ohne WLAN-Verbindung zum Mac)
    return {
      requiresManualFile: true,
      message: 'Server nicht direkt erreichbar. Bitte Datei manuell auswählen.',
    };
  }

  /**
   * 1-KLICK DIREKT-SYNC IN ICLOUD:
   * Schreibt die Daten direkt über den lokalen Server in die iCloud-Datei auf dem Mac (ohne Dialog!).
   */
  async directSyncToICloud() {
    const customPath = this.getCustomPath();
    const serverStatus = await this.checkServerStatus();

    if (serverStatus.isAvailable) {
      const dataToSave = this.exportAllData();
      const res = await fetch('/api/icloud-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataToSave, path: customPath }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Fehler beim Schreiben der Datei.');
      }

      const json = await res.json();
      return {
        success: true,
        directPath: json.path,
        savedAt: json.lastModified || new Date().toISOString(),
        method: 'direct-file',
      };
    }

    // Fallback: Browser-Download
    this.downloadBackupFile('kraftstoff_daten.json');
    return {
      success: true,
      method: 'download',
    };
  }

  /**
   * Manueller Datei-Download (Fallback)
   */
  downloadBackupFile(customFileName = 'kraftstoff_daten.json') {
    const data = this.exportAllData();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = customFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return data;
  }

  /**
   * Liest eine vom Nutzer manuell ausgewählte JSON-Datei ein (Fallback)
   */
  async importBackupFile(file) {
    if (!file) {
      throw new Error('Keine Datei ausgewählt.');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const data = JSON.parse(content);
          const result = this.applyImportedData(data);
          resolve(result);
        } catch (err) {
          reject(new Error(`Fehler beim Lesen der Datei: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('Fehler beim Dateizugriff.'));
      reader.readAsText(file);
    });
  }
}

export const backupService = new BackupService();
