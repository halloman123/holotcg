// Card scanning: camera frame -> fingerprint -> nearest neighbour in the index.
// Everything runs on the device; no image ever leaves the phone.
import * as SH from './scanhash.js';
import * as D from './data.js';
import * as db from './db.js';

export const CARD_RATIO = 63 / 88;
const INDEX_JSON = 'data/scan-index.json';
const INDEX_BIN = 'data/scan-index.bin';

let index = null;        // { ids, langs, bin, entryBytes, count, built }
let loading = null;

// Calibrated from tools/test-scan-accuracy.mjs: correct matches sit at p50
// 0.144 / p90 0.188, while the best wrong match starts around 0.110.
export function confidence(dist) {
  if (dist < 0.13) return 'certain';
  if (dist < 0.20) return 'likely';
  if (dist < 0.28) return 'maybe';
  return 'weak';
}

export async function loadIndex(onProgress = () => {}) {
  if (index) return index;
  if (loading) return loading;
  loading = (async () => {
    const cached = await db.meta.get('scanIndex');
    if (cached && cached.version === SH.VERSION) {
      index = { ...cached, bin: new Uint8Array(cached.bin) };
      return index;
    }
    onProgress('Downloading card fingerprints…');
    const [metaRes, binRes] = await Promise.all([fetch(INDEX_JSON), fetch(INDEX_BIN)]);
    if (!metaRes.ok || !binRes.ok) throw new Error('Scan index not available offline yet');
    const meta = await metaRes.json();
    const bin = new Uint8Array(await binRes.arrayBuffer());
    if (bin.length !== meta.count * meta.entryBytes) throw new Error('Scan index is corrupt');
    index = { ...meta, bin, version: SH.VERSION };
    await db.meta.set('scanIndex', { ...meta, version: SH.VERSION, bin: bin.buffer });
    return index;
  })();
  try { return await loading; } finally { loading = null; }
}

export const indexInfo = () => index;

/**
 * Best matches grouped by card, which is how the errors actually fall: the
 * scanner picks the right card 98.8% of the time but the right *print* only
 * 74.8%, because parallel rarities of one card are near-identical. So the UI
 * offers the card first and lets you pick the print.
 */
export function matchCards(fp, topCards = 4) {
  const prints = match(fp, 400);
  const byCard = new Map();
  for (const p of prints) {
    const num = p.variant.card.card_number;
    if (!byCard.has(num)) byCard.set(num, { card: p.variant.card, dist: p.dist, prints: [] });
    byCard.get(num).prints.push(p);
  }
  return [...byCard.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, topCards)
    .map(c => ({ ...c, confidence: confidence(c.dist), prints: c.prints.sort((a, b) => a.dist - b.dist) }));
}

/** Best matches for a fingerprint, one row per card print. */
export function match(fp, topN = 5) {
  if (!index) return [];
  const { ids, bin, entryBytes, count, langs } = index;
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const d = SH.distance(fp, bin, i * entryBytes);
    const id = ids[i];
    const cur = best.get(id);
    if (!cur || d < cur.dist) best.set(id, { id, dist: d, lang: langs[i] === 'e' ? 'en' : 'jp' });
  }
  return [...best.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, topN)
    .map(m => ({ ...m, variant: D.state.byVariant.get(m.id), confidence: confidence(m.dist) }))
    .filter(m => m.variant);
}

// --- camera -----------------------------------------------------------------
export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}

/**
 * The guide rectangle, in the video's own pixel coordinates.
 * `box` is the on-screen rect of the guide; `view` the rect of the video element.
 * The video is displayed with object-fit: cover, so work out the scale and the
 * cropped-away margins to convert screen pixels back to source pixels.
 */
export function guideToSource(video, view, box) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.max(view.width / vw, view.height / vh);
  const offX = (vw * scale - view.width) / 2;
  const offY = (vh * scale - view.height) / 2;
  return {
    x: (box.x - view.x + offX) / scale,
    y: (box.y - view.y + offY) / scale,
    w: box.width / scale,
    h: box.height / scale,
  };
}

export function scanFrame(video, rect) {
  return SH.hashSource(video, rect);
}

/** Largest centred card-shaped rectangle of a still image. */
export function centreCrop(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  let cw = w, ch = w / CARD_RATIO;
  if (ch > h) { ch = h; cw = h * CARD_RATIO; }
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}
