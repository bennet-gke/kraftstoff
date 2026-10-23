/**
 * KRAFTSTOFF - Intelligenter Benachrichtigungs- & Alert-Service
 * 
 * Behandelt:
 * 1. Web-Push / Browser-Benachrichtigungen (macOS, Windows, iOS PWA)
 * 2. Akustischen Gong/Chime via Web Audio API (keine externen MP3-Dateien nötig)
 * 3. Automatische Preisschwellen-Prüfung bei neuen Daten
 */

class NotificationService {
  constructor() {
    this.lastNotifiedPrices = {};
    this.audioCtx = null;
  }

  /**
   * Erzeugt einen dezenten, edlen Chime-Ton per Web Audio Synthesizer
   */
  playAlertChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContext();
      }

      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // 2 harmonische Sinustöne (F4 -> C5, typischer Apple-ähnlicher Notification Ping)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

      osc2.frequency.setValueAtTime(880, now); // A5
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12); // D6

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
      console.warn('Audio chime could not be played:', e);
    }
  }

  /**
   * Prüft den aktuellen Berechtigungsstatus
   */
  getPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Fordert Berechtigung an
   */
  async requestPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      throw new Error('Benachrichtigungen werden von diesem Browser nicht unterstützt.');
    }
    const result = await Notification.requestPermission();
    return result;
  }

  /**
   * Sendet eine System-Benachrichtigung mit Ton
   */
  sendNotification({ title, body, icon = '/icon.svg', tag = 'price-alert', playChime = true }) {
    if (playChime) {
      this.playAlertChime();
    }

    if (this.getPermission() !== 'granted') {
      return false;
    }

    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, {
            body,
            icon,
            badge: icon,
            tag,
            vibrate: [200, 100, 200],
          });
        });
        return true;
      } else if ('Notification' in window) {
        new Notification(title, {
          body,
          icon,
          tag,
        });
        return true;
      }
    } catch (e) {
      console.warn('Error sending notification:', e);
    }
    return false;
  }

  /**
   * Prüft eine Liste von Tankstellen und sendet bei Preistiefststand oder Schwellwert einen Alarm
   */
  checkAndTriggerPriceAlerts(stations, settings, fuelType = 'diesel') {
    if (!stations || stations.length === 0) return;
    if (this.getPermission() !== 'granted') return;

    const thresholdCent = settings?.alertThresholdCent || 3.0;
    const now = Date.now();

    // Suche die günstigste Station
    const sorted = [...stations].sort((a, b) => a.currentPrice - b.currentPrice);
    const cheapest = sorted[0];

    if (!cheapest) return;

    // Nur einmal alle 60 Minuten für dieselbe Station alarmieren, um Spam zu verhindern
    const lastTime = this.lastNotifiedPrices[cheapest.id] || 0;
    if (now - lastTime < 60 * 60 * 1000) {
      return;
    }

    // Wenn Ersparnis >= Schwellwert oder Preis unter Schwellwert
    const evalData = cheapest.evaluation;
    const deltaCent = evalData?.deltaToDynAverage ? evalData.deltaToDynAverage * 100 : 0;

    // Wenn der Preis günstig ist (z.B. >= 3ct unter Marktschnitt)
    if (deltaCent <= -thresholdCent || evalData?.status === 'FAVORABLE') {
      this.lastNotifiedPrices[cheapest.id] = now;

      const priceStr = cheapest.currentPrice.toFixed(3).replace('.', ',');
      const diffStr = Math.abs(deltaCent).toFixed(1).replace('.', ',');

      this.sendNotification({
        title: `KRAFTSTOFF Alarm ⚡️ ${cheapest.name}`,
        body: `${fuelType.toUpperCase()} jetzt für ${priceStr} €/L (${diffStr} ct unter Marktschnitt)!`,
        tag: `price-drop-${cheapest.id}`,
      });
    }
  }
}

export const notificationService = new NotificationService();
