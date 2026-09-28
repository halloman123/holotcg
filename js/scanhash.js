// Perceptual fingerprint for card images.
//
// The same code runs in two places: tools/build-scan-index.mjs fingerprints
// every official scan into data/scan-index.bin, and the Scan tab fingerprints
// the camera crop. Identical code on both sides means index and query cannot
// drift — change anything here and the index must be rebuilt.
//
// 256 bytes per image, four components. The weights were tuned against
// tools/test-scan-accuracy.mjs, which retrieves degraded photos of known cards.
//
//   dH   32B  16x16 horizontal gradient  — layout and art structure
//   dV   32B  16x16 vertical gradient    — the other half of the structure
//   luma 48B  6x8 grid, contrast-normalised
//   chrm 144B 6x8 grid of grey-world-normalised RGB
//
// Gradients are differential, so exposure does not move them. The colour grids
// are averages, which survive the small framing errors a hand-held phone makes,
// and grey-world normalisation cancels the camera's white balance.

export const VERSION = 2;
export const CANON_W = 128;
export const CANON_H = 179;      // 63:88 card ratio
export const INSET = 0.03;       // drop the outer 3% — a camera crop rarely hits the edge exactly

export const DH = 16;                       // gradient grid
export const GC = 6, GR = 8;                // colour grid, cols x rows
export const OFF_DH = 0,  LEN_DH = (DH * DH) / 8;          // 32
export const OFF_DV = 32, LEN_DV = (DH * DH) / 8;          // 32
export const OFF_LUMA = 64,  LEN_LUMA = GC * GR;           // 48
export const OFF_CHRM = 112, LEN_CHRM = GC * GR * 3;       // 144
export const ENTRY_BYTES = 256;

// Tuned by the weight sweep in tools/test-scan-accuracy.mjs (250 degraded
// photos against the full index): 98.8% same-card, 74.8% exact print, 99.6%
// top-5. Colour carries the most because grey-world normalisation makes it
// both discriminative and camera-proof. Weights apply at match time, so
// changing them does not require rebuilding the index.
export const W_DH = 0.18, W_DV = 0.18, W_LUMA = 0.18, W_CHRM = 0.46;

let _ctx = null;
function scratch() {
  if (!_ctx) {
    const c = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(CANON_W, CANON_H)
      : Object.assign(document.createElement('canvas'), { width: CANON_W, height: CANON_H });
    _ctx = c.getContext('2d', { willReadFrequently: true });
  }
  return _ctx;
}

/** Normalise any drawable source into the canonical card rectangle. */
export function normalise(src, rect) {
  const ctx = scratch();
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const { x = 0, y = 0, w = sw, h = sh } = rect || {};
  const ix = w * INSET, iy = h * INSET;
  ctx.clearRect(0, 0, CANON_W, CANON_H);
  ctx.drawImage(src, x + ix, y + iy, w - ix * 2, h - iy * 2, 0, 0, CANON_W, CANON_H);
  return ctx.getImageData(0, 0, CANON_W, CANON_H);
}

export function fingerprint(imageData) {
  const { data } = imageData;
  const out = new Uint8Array(ENTRY_BYTES);

  // --- gradient grids need one extra sample in each direction --------------
  const gw = DH + 1, gh = DH + 1;
  const grey = new Float32Array(gw * gh);
  const gn = new Uint32Array(gw * gh);
  // --- colour grid ---------------------------------------------------------
  const cells = GC * GR;
  const csum = new Float64Array(cells * 3);
  const cn = new Uint32Array(cells);
  const lsum = new Float64Array(cells);
  let meanR = 0, meanG = 0, meanB = 0;

  for (let y = 0; y < CANON_H; y++) {
    const gy = (y * gh / CANON_H) | 0;
    const cy = (y * GR / CANON_H) | 0;
    for (let x = 0; x < CANON_W; x++) {
      const i = (y * CANON_W + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = gy * gw + ((x * gw / CANON_W) | 0);
      grey[k] += lum; gn[k]++;
      const c = cy * GC + ((x * GC / CANON_W) | 0);
      csum[c * 3] += r; csum[c * 3 + 1] += g; csum[c * 3 + 2] += b;
      lsum[c] += lum; cn[c]++;
      meanR += r; meanG += g; meanB += b;
    }
  }
  const px = CANON_W * CANON_H;
  meanR = Math.max(1, meanR / px); meanG = Math.max(1, meanG / px); meanB = Math.max(1, meanB / px);
  for (let k = 0; k < grey.length; k++) grey[k] /= gn[k] || 1;

  // horizontal then vertical gradient bits
  let bit = 0;
  for (let y = 0; y < DH; y++)
    for (let x = 0; x < DH; x++, bit++)
      if (grey[y * gw + x] > grey[y * gw + x + 1]) out[OFF_DH + (bit >> 3)] |= 128 >> (bit & 7);
  bit = 0;
  for (let y = 0; y < DH; y++)
    for (let x = 0; x < DH; x++, bit++)
      if (grey[y * gw + x] > grey[(y + 1) * gw + x]) out[OFF_DV + (bit >> 3)] |= 128 >> (bit & 7);

  // luma grid, stretched to use the full byte range so exposure drops out
  const luma = new Float64Array(cells);
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < cells; c++) {
    luma[c] = lsum[c] / (cn[c] || 1);
    if (luma[c] < lo) lo = luma[c];
    if (luma[c] > hi) hi = luma[c];
  }
  const span = Math.max(1, hi - lo);
  for (let c = 0; c < cells; c++) out[OFF_LUMA + c] = Math.round((luma[c] - lo) / span * 255);

  // grey-world normalised colour: cell channel over image channel mean,
  // with 1.0 landing on 128, so the camera's white balance cancels out
  for (let c = 0; c < cells; c++) {
    const n = cn[c] || 1;
    const ch = [csum[c * 3] / n / meanR, csum[c * 3 + 1] / n / meanG, csum[c * 3 + 2] / n / meanB];
    for (let k = 0; k < 3; k++) {
      out[OFF_CHRM + c * 3 + k] = Math.max(0, Math.min(255, Math.round(ch[k] * 128)));
    }
  }
  return out;
}

export const hashSource = (src, rect) => fingerprint(normalise(src, rect));

// --- distance ---------------------------------------------------------------
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

/** 0 = identical, 1 = maximally different. */
export function distance(a, b, o = 0, w) {
  const { dh = W_DH, dv = W_DV, luma = W_LUMA, chrm = W_CHRM } = w || {};
  let bh = 0, bv = 0, dl = 0, dc = 0;
  for (let i = 0; i < LEN_DH; i++) bh += POPCOUNT[a[OFF_DH + i] ^ b[o + OFF_DH + i]];
  for (let i = 0; i < LEN_DV; i++) bv += POPCOUNT[a[OFF_DV + i] ^ b[o + OFF_DV + i]];
  for (let i = 0; i < LEN_LUMA; i++) dl += Math.abs(a[OFF_LUMA + i] - b[o + OFF_LUMA + i]);
  for (let i = 0; i < LEN_CHRM; i++) dc += Math.abs(a[OFF_CHRM + i] - b[o + OFF_CHRM + i]);
  return dh * (bh / (DH * DH)) + dv * (bv / (DH * DH))
       + luma * (dl / (LEN_LUMA * 255)) + chrm * (dc / (LEN_CHRM * 255));
}
