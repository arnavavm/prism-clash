const CACHE_VERSION = 'king-battle-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' }))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navigation requests: Network-first with offline fallback to cached app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          const shellCache = await caches.open(SHELL_CACHE);
          return (
            (await shellCache.match(request, { ignoreSearch: true })) ||
            (await shellCache.match('./index.html')) ||
            (await shellCache.match('./'))
          );
        })
    );
    return;
  }

  // Google Fonts: Cache-first with runtime caching for offline typography
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // Same-origin static assets: Stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const copy = networkResponse.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || networkFetch;
      })
    );
  }
});
