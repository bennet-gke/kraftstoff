/**
 * KRAFTSTOFF - Service-Worker-Registrierung & Update-Hinweis
 *
 * Nur im Produktions-Build aktiv. In der Entwicklung werden alte Registrierungen entfernt,
 * damit der Cache keine veralteten Quelldateien ausliefert.
 */

const listeners = new Set();
let waitingRegistration = null;

/** Abonniert "neue Version bereit". Liefert eine Abmeldefunktion. */
export function onUpdateReady(fn) {
  listeners.add(fn);
  if (waitingRegistration) fn(waitingRegistration);
  return () => listeners.delete(fn);
}

function announce(reg) {
  waitingRegistration = reg;
  listeners.forEach((fn) => {
    try { fn(reg); } catch {}
  });
}

/** Aktiviert die wartende Version; die Seite lädt danach automatisch neu. */
export function applyUpdate() {
  const waiting = waitingRegistration && waitingRegistration.waiting;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
    if ('caches' in window) {
      caches.keys().then((keys) => keys.filter((k) => k.startsWith('kraftstoff')).forEach((k) => caches.delete(k))).catch(() => {});
    }
    return;
  }

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Erstinstallation übernimmt die Seite ohne Neuladen; nur echte Updates laden neu
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) announce(reg);
      };
      check();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') check();
        });
      });
      // Regelmäßig und beim Zurückkehren in die App nach neuen Versionen sehen
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (err) {
      console.warn('Service Worker nicht registriert:', err);
    }
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  // Nachgeladener Programmteil nach einem Update nicht mehr vorhanden: neu laden (höchstens alle 30 s)
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem('kraftstoff_chunk_reload_at')) || 0; } catch {}
    if (Date.now() - last < 30000) return;
    try { sessionStorage.setItem('kraftstoff_chunk_reload_at', String(Date.now())); } catch {}
    event.preventDefault();
    window.location.reload();
  });
}
