const CACHE_NAME = 'podiumagenda-v40';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/firebase.js',
  './js/emulator.js',
  './js/genre.js',
  './js/productions.js',
  './js/favorites.js',
  './js/watchlist.js',
  './js/gepland.js',
  './js/gezien.js',
  './js/profiel.js',
  './js/vrienden.js',
  './js/gedeeld.js',
  './js/plannen.js',
  './js/sterren.js',
  './js/titelMapping.js',
  './js/weergave.js',
  './manifest.json',
  './data/shows.json',
];

// Bestanden die bepalen welke versie van de app een bezoeker draait, dus
// altijd network-first — anders blijft een online bezoeker na een deploy
// vastzitten op oude app-code totdat de cache toevallig verloopt (net
// gebeurd: een geshipte feature leek te ontbreken door een stale cache).
// Alles onder js/ en css/ telt automatisch mee, zodat een nieuwe module
// (zoals genre.js/productions.js, die hier eerder ontbraken) niet vergeten
// kan worden.
const NETWORK_FIRST_PATHS = ['/', '/index.html', '/manifest.json', '/data/shows.json', '/data/scrape-status.json', '/data/theaters.json', '/bot.html', '/privacy.html'];
const NETWORK_FIRST_DIRS = ['/js/', '/css/'];

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

// Alleen eigen bestanden: cross-origin imports (Firebase van gstatic) staan
// op een versienummer in de URL en mogen gewoon cache-first blijven.
function isNetworkFirst(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    NETWORK_FIRST_PATHS.some((path) => url.pathname.endsWith(path)) ||
    NETWORK_FIRST_DIRS.some((dir) => url.pathname.includes(dir))
  );
}

// Network-first (met cache-fallback voor offline) voor de app shell, js/,
// css/ en de data, cache-first voor de rest (bv. icons), die zelden wijzigen.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (isNetworkFirst(url)) {
    event.respondWith(
      // cache: 'no-cache' = altijd bij de server navragen (goedkoop, via de
      // ETag). Een gewone fetch() gebruikt de HTTP-cache van de browser, en
      // GitHub Pages geeft max-age=600: tot 10 minuten na een deploy kon zo
      // een nieuwe index.html met een oude app.js samenkomen (30 sep 2026:
      // tabs Theaters en Profiel werkten niet). Een navigatie-request mag
      // niet met extra opties worden nagemaakt, dus die halen we op URL op.
      fetch(event.request.mode === 'navigate' ? event.request.url : event.request, { cache: 'no-cache', credentials: 'same-origin' })
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
