// Service worker: app shell works offline; API calls always go to the network.
// __BUILD__ and __ASSETS__ are filled in by the server on every deploy.
const BUILD = '__BUILD__';
const CACHE = `makon-${BUILD}`;
const RUNTIME = 'makon-runtime';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('/', { cacheName: CACHE });
      if (cached) return cached;
      try { return await fetch(req); } catch (_) { return Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && url.pathname.startsWith('/vendor/')) {
      const copy = res.clone();
      caches.open(RUNTIME).then((c) => c.put(req, copy));
    }
    return res;
  })());
});
