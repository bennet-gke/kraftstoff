// Service Worker for KRAFTSTOFF Tankpreis-App (v3 - Network-First for HTML to prevent stale white screen)
const CACHE_NAME = 'kraftstoff-v3-stable';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Precache notice:', err);
      });
    })
  );
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
    }).then(() => self.clients.claim())
  );
});

// Fetch Strategy:
// 1. Navigation (HTML): Network-First with short timeout, fallback to cache
// 2. Static Assets (/assets/): Cache-First with Network fallback
// 3. APIs: Network-Only (bypass SW)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);

  // Ignore external APIs, geocoders, and cloud sync
  if (
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/api/') ||
    url.origin.includes('supabase') ||
    url.origin.includes('tankerkoenig') ||
    url.origin.includes('openstreetmap') ||
    url.origin.includes('arcgisonline') ||
    url.origin.includes('open-meteo') ||
    url.origin.includes('komoot')
  ) {
    return;
  }

  // 1. HTML Navigation Requests (Network-First: Immer neueste Version holen, damit Asset-Hashes übereinstimmen)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return caches.match('/');
        })
    );
    return;
  }

  // 2. Static Hashed Assets (/assets/)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Alle weiteren statischen Anfragen (Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);

      return cached || fetchPromise;
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
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'PAUSE_ALERTS_30_MIN' });
        }
      })
    );
    return;
  }

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
