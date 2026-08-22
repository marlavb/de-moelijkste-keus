const CACHE_NAME = 'podiumagenda-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/firebase.js',
  './manifest.json',
  './data/shows.json',
];

// Bestanden die bepalen welke versie van de app een bezoeker draait, dus
// altijd network-first — anders blijft een online bezoeker na een deploy
// vastzitten op oude app-code totdat de cache toevallig verloopt (net
// gebeurd: een geshipte feature leek te ontbreken door een stale cache).
const NETWORK_FIRST_PATHS = [
  '/',
  '/index.html',
  '/js/app.js',
  '/js/firebase.js',
  '/css/styles.css',
  '/manifest.json',
  '/data/shows.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

function isNetworkFirst(pathname) {
  return NETWORK_FIRST_PATHS.some((path) => pathname.endsWith(path));
}

// Network-first (met cache-fallback voor offline) voor de app shell +
// shows.json, cache-first voor de rest (bv. icons), die zelden wijzigen.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (isNetworkFirst(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
