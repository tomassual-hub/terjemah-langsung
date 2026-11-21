/* Terjemah Langsung service worker. tools/build.mjs fills in VERSION and PRECACHE.
 * - The app shell is cached on install, so the app opens without the internet (new translations of course need it).
 * - Requests to the translation services are never touched: they go straight to the network.
 * - A new version takes over at once (one bundle, nothing loaded lazily that could go missing); the page offers a reload.
 */
const VERSION = '__VERSION__';
const PRECACHE = '__PRECACHE__';
const SHELL = `tl-shell-${VERSION}`;
const FILES = JSON.parse(PRECACHE);

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tl-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// A navigation may not be answered with a redirected response: hand out a plain copy.
const plain = async res => (res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // translation services: network only

  if (req.mode === 'navigate') {
    // network first (a fresh index.html after a deploy), the cached shell when offline
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) return res;
        throw new Error(String(res.status));
      } catch {
        const cache = await caches.open(SHELL);
        const hit = (await cache.match('./index.html')) || (await cache.match('./'));
        return hit ? plain(hit) : Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
