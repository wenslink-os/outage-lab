// Service worker: caches this app's own files so the simulator itself survives an outage.
// Bump VERSION whenever any file in ASSETS changes (tests/sw.test.js checks the list is complete).

const VERSION = 'outage-lab-v1.1.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './icon.svg',
  './manifest.webmanifest',
  './ui/app.js',
  './ui/graph.js',
  './core/clients.js',
  './core/clock.js',
  './core/dependencies.js',
  './core/engine.js',
  './core/features.js',
  './core/i18n.js',
  './core/patterns.js',
  './core/scenarios.js',
  './core/services.js',
  './core/store.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('outage-lab-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for freshness, cache as the fallback when the network is gone.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
