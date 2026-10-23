// Service Worker for KRAFTSTOFF Tankpreis-App
const CACHE_NAME = 'tankradar-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Precache failed for some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Cache-First with Network Fallback for static assets, Network-First for API
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  // Ignore API requests or Supabase/Tankerkönig requests for standard cache
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/rest/') || url.origin.includes('supabase') || url.origin.includes('tankerkoenig')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).catch(() => {
        // Fallback if offline
        return caches.match('/');
      });
    })
  );
});

// Web Push Notification Event
self.addEventListener('push', (event) => {
  let data = {
    title: 'KRAFTSTOFF Preisalarm ⚡️',
    body: 'Ein günstiger Tankzeitpunkt wurde erkannt!',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: 'price-alert',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const json = event.data.json();
      data = { ...data, ...json };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    vibrate: [150, 50, 150],
    data: data.data || { url: '/' },
    actions: [
      { action: 'open', title: 'Tankstelle öffnen' },
      { action: 'pause_30', title: '30 Min pausieren' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'pause_30') {
    // Notify clients that user requested 30 min snooze
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'PAUSE_ALERTS_30_MIN' });
        }
      })
    );
    return;
  }

  // Open or focus the app window
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
