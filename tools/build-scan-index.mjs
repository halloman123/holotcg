// Build data/scan-index.bin + data/scan-index.json for the Scan tab.
//
//   npm i playwright && node tools/build-scan-index.mjs
//
// Every official scan (Japanese, and English where it exists — not proxies,
// nobody owns one) is fingerprinted with js/scanhash.js. The hashing runs
// inside a real browser so the index and the phone use the same code and the
// same image decoder, and cannot drift apart.
//
// The assets host sends `access-control-allow-origin: *`, so the page can be
// served locally and still read the scans into an untainted canvas.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://qrimpuff.github.io/hocg-fan-sim-assets';
const CONCURRENCY = 24;
const PORT = 8731;

const cards = await (await fetch(SRC + '/hocg_cards.json')).json();

const targets = [];
for (const [num, card] of Object.entries(cards)) {
  for (const [i, ill] of (card.illustrations || []).entries()) {
    const m = ill.manage_id || {};
    const id = (m.jp || [])[0] != null ? num + '#j' + m.jp[0]
      : (m.en || [])[0] != null ? num + '#e' + m.en[0]
      : num + '#i' + i;
    const p = ill.img_path || {};
    if (p.jp) targets.push({ id, lang: 'jp', url: SRC + '/img/' + p.jp });
    if (p.en && !p.en.startsWith('proxies/')) targets.push({ id, lang: 'en', url: SRC + '/img_en/' + p.en });
  }
}
console.log('fingerprinting', targets.length, 'official scans');

const scanhash = fs.readFileSync(path.join(ROOT, 'js/scanhash.js'));
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/scanhash.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(scanhash);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><title>indexer</title>');
});
await new Promise(r => srv.listen(PORT, r));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(() => import('/scanhash.js').then(m => { window.SH = m; }));

const entries = [];
let done = 0;
const failures = [];
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const batch = targets.slice(i, i + CONCURRENCY);
  const res = await page.evaluate(async batch => Promise.all(batch.map(async t => {
    try {
      const r = await fetch(t.url, { mode: 'cors' });
      if (!r.ok) return { err: 'HTTP ' + r.status };
      const bmp = await createImageBitmap(await r.blob());
      const fp = Array.from(window.SH.hashSource(bmp));
      bmp.close();
      return { fp };
    } catch (e) { return { err: String(e && e.message || e) }; }
  })), batch);
  res.forEach((r, k) => {
    if (r.fp) entries.push({ id: batch[k].id, lang: batch[k].lang, fp: r.fp });
    else failures.push(batch[k].url + ' — ' + r.err);
  });
  done += batch.length;
  if (done % 480 < CONCURRENCY) console.log(' ', done, '/', targets.length, failures.length ? '(' + failures.length + ' failed)' : '');
}
await browser.close();
srv.close();

if (!entries.length) throw new Error('nothing hashed: ' + (failures[0] || ''));

const ENTRY_BYTES = entries[0].fp.length;
const bin = new Uint8Array(entries.length * ENTRY_BYTES);
entries.forEach((e, i) => bin.set(e.fp, i * ENTRY_BYTES));

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/scan-index.bin'), bin);
fs.writeFileSync(path.join(ROOT, 'data/scan-index.json'), JSON.stringify({
  version: 1,
  built: new Date().toISOString(),
  entryBytes: ENTRY_BYTES,
  count: entries.length,
  cards: Object.keys(cards).length,
  ids: entries.map(e => e.id),
  langs: entries.map(e => e.lang[0]).join(''),
}));
console.log('wrote', entries.length, 'entries,', (bin.length / 1024).toFixed(0) + 'KB bin,', failures.length, 'failed');
if (failures.length) console.log(failures.slice(0, 5).join('\n'));
