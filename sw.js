// holoTCG service worker — app shell precache + runtime image cache.
const VERSION = 'v4';
const SHELL = 'shell-' + VERSION;
const IMGS  = 'imgs-' + VERSION;
const DATA  = 'data-' + VERSION;

const SHELL_FILES = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/data.js', './js/db.js', './js/deck.js',
  './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
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
