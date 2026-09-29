// Card prices.
//
// Source: https://github.com/Qrimpuff/hocg-fan-sim-prices (MIT), the price
// companion to the card dataset, published as one JSON keyed by shop URL:
//
//   "https://yuyu-tei.jp/sell/hocg/card/hbp01/10001": ["2026-09-21T…", {"y": 680}]
//   "https://www.tcgplayer.com/product/635585":       ["2026-08-18T…", {"d": 711}]
//
// `y` is whole yen, `d` is US cents. Those are shop listing prices from one
// Japanese retailer and one US marketplace — a rough guide to what a card
// costs to buy, not a valuation. The UI says so.
import * as db from './db.js';
import * as D from './data.js';

const PRICES_URL = 'https://qrimpuff.github.io/hocg-fan-sim-prices/hocg_prices.json';
const FX_URL = 'https://open.er-api.com/v6/latest/EUR';
const FX_FALLBACK_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=JPY,USD';
const DAY = 864e5;

export const CURRENCIES = { EUR: '€', USD: '$', JPY: '¥' };

export const settings = {
  currency: localStorage.getItem('holotcg.currency') || 'EUR',
  source: localStorage.getItem('holotcg.priceSource') || 'auto',   // auto | tcg | yuyu
};
export function setCurrency(c) { settings.currency = c; localStorage.setItem('holotcg.currency', c); }
export function setSource(s) { settings.source = s; localStorage.setItem('holotcg.priceSource', s); }

let table = null;      // Map variantId -> { usd?: cents, jpy?: yen, at: iso }
let rates = null;      // { USD, JPY } per 1 EUR
let loading = null;

function indexPrices(raw) {
  const t = new Map();
  for (const card of D.state.cards) {
    for (const v of card._variants) {
      const ill = v.ill;
      let usd, jpy, at = null;
      for (const p of ill.yuyutei_sell_paths || []) {
        const row = raw['https://yuyu-tei.jp/sell' + p];
        if (row && row[1] && row[1].y != null) {
          jpy = jpy == null ? row[1].y : Math.min(jpy, row[1].y);
          if (!at || row[0] > at) at = row[0];
        }
      }
      for (const id of ill.tcgplayer_product_ids || []) {
        const row = raw['https://www.tcgplayer.com/product/' + id];
        if (row && row[1] && row[1].d != null) {
          usd = usd == null ? row[1].d : Math.min(usd, row[1].d);
          if (!at || row[0] > at) at = row[0];
        }
      }
      if (usd != null || jpy != null) t.set(v.id, { usd, jpy, at });
    }
  }
  return t;
}

async function fetchRates() {
  try {
    const r = await fetch(FX_URL);
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.USD && j.rates.JPY) return { USD: j.rates.USD, JPY: j.rates.JPY };
    }
  } catch { /* try the backup */ }
  try {
    const r = await fetch(FX_FALLBACK_URL);
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.USD && j.rates.JPY) return { USD: j.rates.USD, JPY: j.rates.JPY };
    }
  } catch { /* offline */ }
  return null;
}

export async function load(onProgress = () => {}) {
  if (table) return { table, rates };
  if (loading) return loading;
  loading = (async () => {
    const cached = await db.meta.get('prices');
    let raw = null;
    if (cached && Date.now() - cached.at < DAY) raw = cached.raw;
    if (!raw) {
      onProgress('Fetching prices…');
      try {
        const res = await fetch(PRICES_URL);
        if (res.ok) {
          raw = await res.json();
          await db.meta.set('prices', { at: Date.now(), raw });
        }
      } catch { /* fall through to the cache */ }
    }
    if (!raw && cached) raw = cached.raw;          // stale beats nothing
    if (!raw) throw new Error('Prices are not available offline yet');
    table = indexPrices(raw);

    const fxCached = await db.meta.get('fx');
    if (fxCached && Date.now() - fxCached.at < DAY) rates = fxCached.rates;
    else {
      const fresh = await fetchRates();
      if (fresh) { rates = fresh; await db.meta.set('fx', { at: Date.now(), rates: fresh }); }
      else if (fxCached) rates = fxCached.rates;
    }
    return { table, rates };
  })();
  try { return await loading; } finally { loading = null; }
}

export const loaded = () => !!table;
export const haveRates = () => !!rates;

/** Price of one copy, in the display currency. null when unknown. */
export function priceOf(variantId) {
  if (!table) return null;
  const row = table.get(variantId);
  if (!row) return null;

  const pick = [];
  if (settings.source !== 'yuyu' && row.usd != null) pick.push({ cur: 'USD', amount: row.usd / 100, src: 'TCGplayer' });
  if (settings.source !== 'tcg' && row.jpy != null) pick.push({ cur: 'JPY', amount: row.jpy, src: 'Yuyu-tei' });
  if (!pick.length) return null;
  const chosen = pick[0];   // 'auto' lists TCGplayer first

  const out = convert(chosen.amount, chosen.cur, settings.currency);
  if (out == null) return { amount: chosen.amount, currency: chosen.cur, source: chosen.src, at: row.at, unconverted: true };
  return { amount: out, currency: settings.currency, source: chosen.src, at: row.at };
}

export function convert(amount, from, to) {
  if (from === to) return amount;
  if (!rates) return null;
  const perEur = c => (c === 'EUR' ? 1 : rates[c]);
  const a = perEur(from), b = perEur(to);
  if (!a || !b) return null;
  return amount / a * b;
}

export function format(amount, currency = settings.currency, { whole = false } = {}) {
  if (amount == null) return '—';
  const digits = (currency === 'JPY' || whole || amount >= 100) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: digits }).format(amount);
  } catch {
    return (CURRENCIES[currency] || '') + amount.toFixed(digits);
  }
}

/** Total of everything owned, plus what could not be priced. */
export function collectionValue() {
  let total = 0, priced = 0, unpriced = 0, copies = 0;
  const rows = [];
  for (const [vid, qty] of D.state.owned) {
    copies += qty;
    const p = priceOf(vid);
    if (!p || p.unconverted) { unpriced += qty; continue; }
    total += p.amount * qty;
    priced += qty;
    const v = D.state.byVariant.get(vid);
    if (v) rows.push({ vid, v, qty, unit: p.amount, total: p.amount * qty, source: p.source });
  }
  rows.sort((a, b) => b.total - a.total);
  return { total, priced, unpriced, copies, currency: settings.currency, top: rows.slice(0, 10), rows };
}

export function deckValue(deck) {
  let total = 0, unpriced = 0;
  const add = (vid, n) => {
    const p = priceOf(vid);
    if (!p || p.unconverted) { unpriced += n; return; }
    total += p.amount * n;
  };
  if (deck.oshi) add(deck.oshi, 1);
  for (const [vid, n] of Object.entries(deck.main)) add(vid, n);
  for (const [vid, n] of Object.entries(deck.cheer)) add(vid, n);
  return { total, unpriced, currency: settings.currency };
}

/** Newest timestamp in the price data, for the "as of" line. */
export function dataDate() {
  if (!table) return null;
  let newest = null;
  for (const row of table.values()) if (row.at && (!newest || row.at > newest)) newest = row.at;
  return newest;
}
