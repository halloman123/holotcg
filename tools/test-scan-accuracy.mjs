// Measure how well the scan index retrieves a card from a camera-like photo.
//
//   node tools/test-scan-accuracy.mjs [sample size] [--sweep]
//
// Takes random official scans, degrades them the way a hand-held phone does
// (crop jitter, rotation, shear, exposure and white-balance shift, sensor
// noise, blur, downscale) and reports where the true card lands.
//
// Two numbers matter. "exact print" is the right card AND the right rarity;
// "same card" only asks for the right card number, because parallel rarities
// of one card are near-identical by design and the app offers the other
// prints alongside the top hit. --sweep also tries other component weights.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://qrimpuff.github.io/hocg-fan-sim-assets';
const N = Number(process.argv[2] || 200);
const SWEEP = process.argv.includes('--sweep');
const PORT = 8732;

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/scan-index.json'), 'utf8'));
const bin = fs.readFileSync(path.join(ROOT, 'data/scan-index.bin'));
const cards = await (await fetch(SRC + '/hocg_cards.json')).json();

const pool = [];
for (const [num, card] of Object.entries(cards)) {
  for (const [i, ill] of (card.illustrations || []).entries()) {
    const m = ill.manage_id || {};
    const id = (m.jp || [])[0] != null ? num + '#j' + m.jp[0]
      : (m.en || [])[0] != null ? num + '#e' + m.en[0]
      : num + '#i' + i;
    const p = ill.img_path || {};
    if (p.jp) pool.push({ id, url: SRC + '/img/' + p.jp });
    if (p.en && !p.en.startsWith('proxies/')) pool.push({ id, url: SRC + '/img_en/' + p.en });
  }
}
for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
const sample = pool.slice(0, N);

const scanhash = fs.readFileSync(path.join(ROOT, 'js/scanhash.js'));
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/scanhash.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(scanhash); }
  if (req.url.startsWith('/index.bin')) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(bin); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><title>accuracy</title>');
});
await new Promise(r => srv.listen(PORT, r));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(async () => {
  window.SH = await import('/scanhash.js');
  window.BIN = new Uint8Array(await (await fetch('/index.bin')).arrayBuffer());
});

// 1. fingerprint the degraded photos once
const queries = await page.evaluate(async sample => {
  const SH = window.SH;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function degrade(bmp) {
    const W = 480, H = Math.round(W / (63 / 88));
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2 + rnd(-W * 0.04, W * 0.04), H / 2 + rnd(-H * 0.04, H * 0.04));
    g.rotate(rnd(-4, 4) * Math.PI / 180);
    g.transform(1, rnd(-0.03, 0.03), rnd(-0.03, 0.03), 1, 0, 0);
    const s = rnd(0.94, 1.08);
    g.drawImage(bmp, -W * s / 2, -H * s / 2, W * s, H * s);
    g.restore();
    const d = g.getImageData(0, 0, W, H), px = d.data;
    const gain = rnd(0.78, 1.25), lift = rnd(-14, 16);
    const wb = [rnd(0.92, 1.1), rnd(0.95, 1.05), rnd(0.9, 1.12)];
    for (let i = 0; i < px.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const v = px[i + k] * gain * wb[k] + lift + (Math.random() - 0.5) * 12;
        px[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    g.putImageData(d, 0, 0);
    const blur = new OffscreenCanvas(W, H), bg = blur.getContext('2d');
    bg.filter = 'blur(' + rnd(0.3, 1.3).toFixed(2) + 'px)';
    bg.drawImage(c, 0, 0);
    return blur;
  }
  const out = [];
  for (const t of sample) {
    try {
      const r = await fetch(t.url);
      if (!r.ok) continue;
      const bmp = await createImageBitmap(await r.blob());
      const fake = degrade(bmp);
      bmp.close();
      out.push({ id: t.id, fp: Array.from(SH.hashSource(fake)) });
    } catch { /* skip */ }
  }
  return out;
}, sample);
console.log('fingerprinted', queries.length, 'degraded photos');

// 2. score them, optionally over a grid of weights
async function evaluate(w) {
  return page.evaluate(({ queries, ids, entryBytes, count, w }) => {
    const SH = window.SH, BIN = window.BIN;
    let exact = 0, sameCard = 0, top5 = 0;
    const okDist = [], badDist = [];
    for (const q of queries) {
      const fp = Uint8Array.from(q.fp);
      const best = new Map();
      for (let i = 0; i < count; i++) {
        const d = SH.distance(fp, BIN, i * entryBytes, w);
        const id = ids[i];
        const cur = best.get(id);
        if (cur === undefined || d < cur) best.set(id, d);
      }
      const ranked = [...best].sort((a, b) => a[1] - b[1]);
      const rank = ranked.findIndex(([id]) => id === q.id);
      const num = q.id.split('#')[0];
      if (rank === 0) { exact++; okDist.push(ranked[0][1]); }
      else badDist.push(ranked[0][1]);
      if (ranked[0][0].split('#')[0] === num) sameCard++;
      if (rank >= 0 && rank < 5) top5++;
    }
    const n = queries.length;
    const q = (a, p) => { a.sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN; };
    return { n, exact: exact / n, sameCard: sameCard / n, top5: top5 / n,
             okP50: q(okDist, .5), okP90: q(okDist, .9), badP10: q(badDist, .1) };
  }, { queries, ids: meta.ids, entryBytes: meta.entryBytes, count: meta.count, w });
}

const fmt = r => `exact ${(r.exact * 100).toFixed(1)}%  same-card ${(r.sameCard * 100).toFixed(1)}%  top5 ${(r.top5 * 100).toFixed(1)}%  ok(p50 ${r.okP50.toFixed(3)} p90 ${r.okP90.toFixed(3)})  miss(p10 ${(r.badP10 || NaN).toFixed(3)})`;

console.log('current weights:', fmt(await evaluate(null)));

if (SWEEP) {
  const grid = [];
  for (const dh of [0.2, 0.3, 0.4]) for (const dv of [0.2, 0.3, 0.4])
    for (const luma of [0, 0.1, 0.2]) for (const chrm of [0.2, 0.3, 0.4, 0.5]) {
      const t = dh + dv + luma + chrm;
      grid.push({ dh: dh / t, dv: dv / t, luma: luma / t, chrm: chrm / t, label: `dh${dh} dv${dv} l${luma} c${chrm}` });
    }
  const scored = [];
  for (const w of grid) scored.push({ w, r: await evaluate(w) });
  scored.sort((a, b) => (b.r.sameCard - a.r.sameCard) || (b.r.exact - a.r.exact));
  console.log('\ntop weight combos by same-card accuracy:');
  for (const s of scored.slice(0, 8)) console.log(' ', s.w.label.padEnd(24), fmt(s.r));
}

await browser.close();
srv.close();
