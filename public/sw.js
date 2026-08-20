// DEX Labs service worker - v1.6.2.
//
// Installed only in a secure context (localhost or HTTPS; index.html
// gates registration). Gives Edge/Brave/Chrome the installable-app
// criteria (a fetch handler is part of the installability checks) and
// makes the app shell load offline.
//
// Deliberately conservative: every /api/* request is left untouched
// (live data - Study sessions, timers, CCTV streams/snapshots must
// never be cached or queued behind a promise), and everything else is
// network-first, so updates are always seen the moment the server
// changes a file. The cache only ever serves as an offline fallback.
const CACHE = 'dex-labs-shell-v1.6.2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data - never intercept
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});