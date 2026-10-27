/**
 * KRAFTSTOFF Service Worker
 *
 * - Beim Build trägt vite.config.js eine Build-ID und die Liste aller Dateien ein (Offline-Start, sauberes Update).
 * - Navigation: Netzwerk zuerst (mit Timeout), sonst die zwischengespeicherte App.
 * - /assets/*: Cache zuerst (Dateinamen enthalten einen Hash und ändern sich bei jedem Build).
 * - APIs und fremde Server (Tankerkönig-Proxy, Karten-Kacheln, Routing, Geocoding) laufen nie über den Cache.
 * - Updates: Die neue Version wartet, bis die App "Jetzt aktualisieren" sendet (SKIP_WAITING).
 */
const BUILD_ID = '__KRAFTSTOFF_BUILD_ID__';
const BUILD_ASSETS = [] /*__KRAFTSTOFF_PRECACHE__*/;
const CACHE_PREFIX = 'kraftstoff-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const APP_SHELL = '/index.html';
const NAV_TIMEOUT_MS = 4000;
const CORE_ASSETS = ['/', APP_SHELL, '/manifest.json', '/favicon.svg', '/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const all = Array.from(new Set([...CORE_ASSETS, ...BUILD_ASSETS]));
      // Einzeln laden: eine fehlende Datei darf die Installation nicht scheitern lassen
      await Promise.all(all.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function putInCache(key, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(key, response);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Fremde Server (Kacheln, Routing, Geocoding, Tankerkönig) nie über den Cache
  if (url.origin !== self.location.origin) return;
  // Eigene APIs und Entwicklungs-Pfade direkt durchreichen
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return;

  // 1. App-Aufruf: Netzwerk zuerst (kurzer Timeout), sonst zwischengespeicherte App
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
        if (response && response.status === 200) event.waitUntil(putInCache(APP_SHELL, response.clone()));
        return response;
      } catch {
        const cached = (await caches.match(APP_SHELL)) || (await caches.match('/'));
        if (cached) return cached;
        return fetch(request);
      }
    })());
    return;
  }

  // 2. Gehashte Build-Dateien: Cache zuerst
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      event.waitUntil(putInCache(request, response.clone()));
      return response;
    })());
    return;
  }

  // 3. Übrige eigene Dateien (Icons, Manifest, Schriften): Cache sofort, im Hintergrund aktualisieren
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then((response) => {
        event.waitUntil(putInCache(request, response.clone()));
        return response;
      })
      .catch(() => cached);
    return cached || network;
  })());
});

// Web-Push (falls künftig ein Push-Server angebunden wird)
self.addEventListener('push', (event) => {
  let data = {
    title: 'KRAFTSTOFF Preisalarm',
    body: 'Ein günstiger Tankzeitpunkt wurde erkannt.',
    data: { url: '/' },
  };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: data.badge || '/icons/icon-192.png',
      tag: data.tag || 'price-alert',
      data: data.data || { url: '/' },
      actions: [
        { action: 'open', title: 'Öffnen' },
        { action: 'pause_30', title: '30 Min pausieren' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  if (event.action === 'pause_30') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'PAUSE_ALERTS_30_MIN' });
      })
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
