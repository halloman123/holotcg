// "A new version is live" detection.
//
// Deliberately build-step free: nothing to stamp, no version.json to keep in
// sync, no change to however the site gets deployed. The app hashes the actual
// bytes of its own files, fetched past every cache, and compares that with the
// hash it took when this session started. Any real change anywhere shows up;
// a rebuild that changes nothing does not, so there are no phantom prompts.
//
// The service worker is a second, instant trigger: when a new sw.js installs it
// parks in `waiting` rather than taking over, and we prompt straight away.

const WATCHED = [
  'index.html', 'sw.js', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/data.js', 'js/db.js', 'js/deck.js',
  'js/sets.js', 'js/scan.js', 'js/scanhash.js', 'js/update.js', 'js/prices.js',
];

const MIN_GAP_MS = 15 * 60 * 1000;   // don't re-check more often than this
const SNOOZE_MS = 60 * 60 * 1000;    // "Later" quietens this build for an hour

let bootBuild = null;
let lastCheck = 0;
let waitingWorker = null;
let onAvailable = () => {};

async function buildHash() {
  const parts = await Promise.all(WATCHED.map(async f => {
    try {
      const res = await fetch(f, { cache: 'no-store' });
      if (!res.ok) return new Uint8Array(0);
      return new Uint8Array(await res.arrayBuffer());
    } catch { return null; }   // offline: signal "unknown", never "changed"
  }));
  if (parts.some(p => p === null)) return null;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  const digest = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function snoozed(build) {
  try {
    const raw = localStorage.getItem('holotcg.updateSnooze');
    if (!raw) return false;
    const { build: b, until } = JSON.parse(raw);
    return b === build && Date.now() < until;
  } catch { return false; }
}

export function snooze(build) {
  try {
    localStorage.setItem('holotcg.updateSnooze', JSON.stringify({ build, until: Date.now() + SNOOZE_MS }));
  } catch { /* private mode */ }
}

/** Force a check. Returns the new build id when an update is waiting. */
export async function check({ force = false } = {}) {
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return null;
  lastCheck = Date.now();
  if (navigator.serviceWorker) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) reg.update().catch(() => {});
  }
  const now = await buildHash();
  if (!now || !bootBuild || now === bootBuild) return null;
  if (snoozed(now)) return null;
  onAvailable(now);
  return now;
}

/** Apply the update: let any waiting worker take over, then reload. */
export async function apply() {
  try { localStorage.removeItem('holotcg.updateSnooze'); } catch { /* ignore */ }
  if (waitingWorker) {
    const done = new Promise(res => {
      navigator.serviceWorker.addEventListener('controllerchange', res, { once: true });
      setTimeout(res, 2500);
    });
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    await done;
  }
  location.reload();
}

export function start(handler) {
  onAvailable = handler;

  buildHash().then(h => { bootBuild = h; });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const offer = w => {
        if (!w || w.state !== 'installed' || !navigator.serviceWorker.controller) return;
        waitingWorker = w;
        check({ force: true });
      };
      offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => offer(w));
      });
    }).catch(() => {});
  }

  // Coming back to the app is the natural moment to look, and it keeps the
  // traffic down to a handful of small requests a day.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('online', () => check({ force: true }));
  setTimeout(() => check({ force: true }), 60_000);
}
