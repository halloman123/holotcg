// holoTCG service worker — app shell precache + runtime image cache.
const VERSION = 'v8';
const SHELL = 'shell-' + VERSION;
const IMGS  = 'imgs-' + VERSION;
const DATA  = 'data-' + VERSION;

const SHELL_FILES = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/data.js', './js/db.js', './js/deck.js', './js/sets.js', './js/scan.js', './js/scanhash.js', './js/update.js',
  './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // Cache each file on its own. addAll() rejects the whole install if a single
  // entry 404s, which would leave the app with no offline mode at all and no
  // obvious reason why.
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const results = await Promise.allSettled(SHELL_FILES.map(f => cache.add(f)));
    const failed = SHELL_FILES.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) console.warn('[sw] not precached:', failed);
    // No skipWaiting() here on purpose: the new worker parks in `waiting` so
    // the page can show the update prompt. It takes over when the user says so
    // (js/update.js posts SKIP_WAITING), or when every tab has closed.
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, IMGS, DATA];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // card images: cache-first, keep forever
  if (/qrimpuff\.github\.io\/hocg-fan-sim-assets\/img/.test(url.href)) {
    e.respondWith(cacheFirst(req, IMGS));
    return;
  }
  // scan index: cache-first, it only changes when it is rebuilt
  if (url.origin === self.location.origin && url.pathname.includes('/data/scan-index')) {
    e.respondWith(cacheFirst(req, DATA));
    return;
  }
  // card json: network-first, fall back to cache
  if (url.href.includes('hocg_cards.json')) {
    e.respondWith(networkFirst(req, DATA));
    return;
  }
  // own assets: network-first, so a redeploy shows up on the next load
  // and the cached copy only kicks in when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, SHELL));
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req) || await cache.match('./index.html');
    if (hit) return hit;
    throw err;
  }
}
