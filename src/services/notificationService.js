/**
 * KRAFTSTOFF - Benachrichtigungs- & Alarm-Service
 *
 * 1. Mitteilungen über den Service Worker (macOS, iOS ab 16.4 als Home-Bildschirm-App)
 * 2. Dezenter Signalton per Web Audio API (auf dem iPhone nach der ersten Berührung freigeschaltet)
 * 3. Automatische Preisalarme bei neuen Daten – solange die App geöffnet ist (respektiert die Pause)
 *
 * Bereits gemeldete Tiefpreise werden 24 h gemerkt, damit ein Neustart der App nicht erneut alarmiert.
 */

import { fuelLabel, fmtNum, fmtPrice, fmtKm } from '../utils/format';

const ALERT_LOG_KEY = 'kraftstoff_alert_log';
const ALERT_LOG_TTL_MS = 24 * 60 * 60 * 1000;
const SAME_STATION_COOLDOWN_MS = 60 * 60 * 1000;
const ICON = '/icons/icon-192.png';

function readLog(now = Date.now()) {
  try {
    const raw = JSON.parse(localStorage.getItem(ALERT_LOG_KEY) || '{}');
    const out = {};
    for (const [id, e] of Object.entries(raw || {})) {
      if (e && Number.isFinite(e.at) && now - e.at < ALERT_LOG_TTL_MS) out[id] = e;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLog(log) {
  try {
    localStorage.setItem(ALERT_LOG_KEY, JSON.stringify(log));
  } catch {}
}

class NotificationService {
  constructor() {
    this.audioCtx = null;
    this.audioArmed = false;
  }

  /** Mitteilungen grundsätzlich möglich (iPhone: nur als Home-Bildschirm-App ab iOS 16.4). */
  isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  /** Läuft als installierte App (Home-Bildschirm / Dock). */
  isStandalone() {
    try {
      return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  }

  /** iOS-Safari erlaubt Audio erst nach einer Berührung: Kontext beim ersten Tippen freischalten. */
  armAudioUnlock() {
    if (this.audioArmed || typeof document === 'undefined') return;
    this.audioArmed = true;
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!this.audioCtx) this.audioCtx = new Ctx();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      } catch {}
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  playAlertChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      osc2.frequency.setValueAtTime(880, now);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.6);
      osc2.stop(now + 0.6);
    } catch (e) {
      console.warn('Signalton konnte nicht abgespielt werden:', e);
    }
  }

  getPermission() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  }

  async requestPermission() {
    if (!this.isSupported()) {
      throw new Error(this.isIOS() && !this.isStandalone()
        ? 'Auf dem iPhone gehen Mitteilungen nur, wenn KRAFTSTOFF über „Teilen → Zum Home-Bildschirm“ installiert ist (ab iOS 16.4).'
        : 'Dieser Browser unterstützt keine Mitteilungen.');
    }
    return Notification.requestPermission();
  }

  isIOS() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch {
      return false;
    }
  }

  /** Zeigt eine Mitteilung (bevorzugt über den Service Worker, damit ein Tippen die App öffnet). */
  async sendNotification({ title, body, tag = 'price-alert', playChime = true, url = '/' }) {
    if (playChime) this.playAlertChime();
    if (this.getPermission() !== 'granted') return false;
    const options = {
      body,
      icon: ICON,
      badge: ICON,
      tag,
      renotify: true,
      data: { url },
    };
    try {
      if ('serviceWorker' in navigator) {
        const reg = await Promise.race([
          navigator.serviceWorker.getRegistration(),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (reg && reg.active) {
          await reg.showNotification(title, {
            ...options,
            actions: [
              { action: 'open', title: 'Öffnen' },
              { action: 'pause_30', title: '30 Min. pausieren' },
            ],
          });
          return true;
        }
      }
      // Ohne Service Worker (z. B. lokaler Test über http): einfache Mitteilung
      const n = new Notification(title, options);
      n.onclick = () => {
        try { window.focus(); } catch {}
        n.close();
      };
      return true;
    } catch (e) {
      console.warn('Mitteilung konnte nicht gesendet werden:', e);
      return false;
    }
  }

  /**
   * Prüft die bewerteten Stationen und alarmiert, wenn die günstigste geöffnete Station deutlich unter
   * ihrem üblichen Preis für diese Uhrzeit ODER unter dem Regionsmedian liegt.
   */
  checkAndTriggerPriceAlerts(stations, settings, fuelType = 'diesel', regionNow = null) {
    if (!Array.isArray(stations) || stations.length === 0) return;
    if (this.getPermission() !== 'granted') return;
    if (settings?.pausedUntil && Date.now() < new Date(settings.pausedUntil).getTime()) return;

    const thresholdCent = Number(settings?.alertThresholdCent) || 3.0;
    const open = stations.filter((s) => s && s.isOpen !== false && Number.isFinite(s.currentPrice) && !s.isFromCache);
    if (open.length === 0) return;
    const cheapest = [...open].sort((a, b) => a.currentPrice - b.currentPrice)[0];

    const now = Date.now();
    const log = readLog(now);
    const last = log[cheapest.id];
    // Gleicher Preis bereits gemeldet oder kürzlich gemeldet: still bleiben
    if (last && (last.price === cheapest.currentPrice || now - last.at < SAME_STATION_COOLDOWN_MS)) return;

    const ownDelta = cheapest.evaluation?.hasHistory ? cheapest.evaluation.deltaCent : null;
    const regionDelta = Number.isFinite(regionNow?.median) && open.length >= 3 ? (cheapest.currentPrice - regionNow.median) * 100 : null;

    let reason = null;
    if (ownDelta !== null && ownDelta <= -thresholdCent) {
      reason = `${fmtNum(Math.abs(ownDelta), 1)} ct unter ihrem üblichen Preis um diese Zeit`;
    } else if (regionDelta !== null && regionDelta <= -thresholdCent) {
      reason = `${fmtNum(Math.abs(regionDelta), 1)} ct unter dem Regionsmedian`;
    }
    if (!reason) return;

    log[cheapest.id] = { at: now, price: cheapest.currentPrice };
    writeLog(log);
    const where = Number.isFinite(cheapest.distanceKm) ? ` • ${fmtKm(cheapest.distanceKm)} entfernt` : '';
    this.sendNotification({
      title: `Tankwart-Tipp: ${cheapest.name}`,
      body: `${fuelLabel(fuelType)} jetzt ${fmtPrice(cheapest.currentPrice)}/L – ${reason}${where}.`,
      tag: `price-drop-${cheapest.id}`,
    });
  }
}

export const notificationService = new NotificationService();
