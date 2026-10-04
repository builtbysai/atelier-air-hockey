const CACHE = 'atelier-air-hockey-fd60454559ef';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './src/styles.css',
  './src/themes.js',
  './src/scoreboards.js',
  './src/vendor/qrcode.js',
  './src/net.js',
  './src/feel-events.js',
  './src/game.js',
  './src/share.js',
  './src/ui.js',
  './src/feel-lab.js'
];

self.addEventListener('install', event => {
  // Precache, then wait. The running game decides when it is safe to activate
  // this version so a match can never straddle two app generations.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE && key.startsWith('atelier-air-hockey-'))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) ||
      (await caches.match('./index.html')) ||
      Response.error();
  }
}

async function networkFirstAsset(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const update = fetch(request)
    .then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Game code and styles should never launch one version behind when online.
  // Network-first keeps installed PWAs current while preserving offline fallback.
  if (/\.(?:js|css|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
