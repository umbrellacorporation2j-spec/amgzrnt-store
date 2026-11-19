'use strict';
/* AMGZRNT STORE — Service Worker V4
   - Precache is tolerant: one missing file can no longer break the whole install.
   - Pages: network first (3.5s) then cached copy, so the store always opens even on slow/no network.
   - Same-origin assets: stale-while-revalidate.
   - Fonts / icons / Firebase SDK scripts (cross-origin): cached so the UI also loads offline.
   - Firestore / Auth / app websites are never cached. */
const VERSION = 'v45';
const CACHE_NAME = 'amgzrnt-store-' + VERSION;
const RUNTIME = 'amgzrnt-store-runtime-' + VERSION;
const APP_SHELL = [
  './', './index.html', './manifest.json', './icon.svg',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'www.gstatic.com'];
const MAX_RUNTIME_ENTRIES = 90;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith('amgzrnt-store-') && k !== CACHE_NAME && k !== RUNTIME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin: only CDN assets (fonts, Font Awesome, Firebase SDK scripts).
  if (url.origin !== self.location.origin) {
    if (!CDN_HOSTS.includes(url.hostname)) return;
    if (url.hostname === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
    event.respondWith(
      caches.open(RUNTIME).then(cache =>
        cache.match(request).then(cached => {
          const network = fetch(request).then(res => {
            if (res && (res.ok || res.type === 'opaque')) { cache.put(request, res.clone()).then(() => trim(RUNTIME, MAX_RUNTIME_ENTRIES)); }
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Page navigations.
  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.race([fetch(request), timeout(3500)]).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put('./index.html', copy)); }
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Same-origin static files.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(request, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
