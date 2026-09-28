// Card data: fetch, normalise, index, search.
import * as db from './db.js';

export const SRC = 'https://qrimpuff.github.io/hocg-fan-sim-assets';
export const CARDS_URL = SRC + '/hocg_cards.json';

export const state = {
  cards: [],            // normalised card objects
  byNumber: new Map(),
  variants: [],         // one entry per illustration
  byVariant: new Map(),
  owned: new Map(),     // variantId -> qty
  lang: localStorage.getItem('holotcg.lang') || 'en',
  // Image source is separate from text language. The dataset has three kinds of
  // scan: official Japanese (img/), official English (img_en/<set>/EN_*) and
  // fan-made English proxies (img_en/proxies/*, watermarked PROXY) for cards that
  // have no English release yet. 'auto' never shows a proxy.
  imgMode: localStorage.getItem('holotcg.imgmode') || 'auto',   // auto | en | jp
  sets: [],
  rarities: [],
  tags: [],
};

const COLORS = ['white', 'green', 'red', 'blue', 'purple', 'yellow', 'colorless'];
export const COLOR_LIST = COLORS;

export const BLOOMS = ['debut', 'first', 'second', 'spot'];

export function t(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[state.lang] || field.en || field.jp || '';
}

export function typeOf(card) {
  const ct = card.card_type;
  if (typeof ct === 'string') return ct;
  if (ct && ct.support) return 'support_' + ct.support;
  return 'unknown';
}

export function typeLabel(key) {
  return ({
    oshi_holomem: 'Oshi',
    holomem: 'Holomem',
    cheer: 'Cheer',
    support_event: 'Event',
    support_item: 'Item',
    support_tool: 'Tool',
    support_mascot: 'Mascot',
    support_fan: 'Fan',
    support_staff: 'Staff',
  })[key] || key;
}

const SET_ORDER = ['hBP', 'hSD', 'hEB', 'hY', 'hYS', 'hCO', 'hCS', 'hWF', 'hBD', 'hPR'];
export function setRank(set) {
  const i = SET_ORDER.findIndex(p => set.startsWith(p));
  return i < 0 ? SET_ORDER.length : i;
}
function bySet(a, b) {
  return setRank(a) - setRank(b) || a.localeCompare(b, 'en', { numeric: true });
}

export function setOf(cardNumber) {
  const i = cardNumber.indexOf('-');
  return i > 0 ? cardNumber.slice(0, i) : cardNumber;
}

export function variantId(cardNumber, ill, idx) {
  const m = ill.manage_id || {};
  const jp = (m.jp || [])[0];
  const en = (m.en || [])[0];
  if (jp != null) return cardNumber + '#j' + jp;
  if (en != null) return cardNumber + '#e' + en;
  return cardNumber + '#i' + idx;
}

export function isProxy(ill) {
  const en = (ill.img_path || {}).en;
  return !!en && en.startsWith('proxies/');
}

export function imgUrl(ill) {
  const p = ill.img_path || {};
  const jp = p.jp ? SRC + '/img/' + p.jp : '';
  const en = p.en ? SRC + '/img_en/' + p.en : '';
  if (state.imgMode === 'jp') return jp || en;
  if (state.imgMode === 'en') return en || jp;
  return (en && !isProxy(ill)) ? en : (jp || en);   // auto: official scans only
}

function normalise(raw) {
  const cards = [];
  for (const [num, c] of Object.entries(raw)) {
    const card = { ...c, card_number: num };
    card._type = typeOf(c);
    card._set = setOf(num);
    card._nameEn = (c.name && c.name.en) || '';
    card._nameJp = (c.name && c.name.jp) || '';
    card._tags = (c.tags || []).map(x => x.en || x.jp);
    // one searchable haystack (lowercased)
    const bits = [num, card._nameEn, card._nameJp, ...card._tags];
    for (const a of c.arts || []) {
      if (a.name) bits.push(a.name.en, a.name.jp);
      if (a.text) bits.push(a.text.en, a.text.jp);
    }
    for (const s of c.oshi_skills || []) {
      if (s.name) bits.push(s.name.en, s.name.jp);
      if (s.text) bits.push(s.text.en, s.text.jp);
    }
    for (const k of c.keywords || []) {
      if (k.name) bits.push(k.name.en, k.name.jp);
      if (k.text) bits.push(k.text.en, k.text.jp);
    }
    if (c.text) bits.push(c.text.en, c.text.jp);
    card._hay = bits.filter(Boolean).join(' ').toLowerCase();
    card._variants = (c.illustrations || []).map((ill, i) => ({
      id: variantId(num, ill, i),
      cardNumber: num,
      idx: i,
      rarity: ill.rarity || '?',
      illustrator: ill.illustrator || '',
      ill,
    }));
    cards.push(card);
  }
  cards.sort((a, b) => bySet(a._set, b._set) || a.card_number.localeCompare(b.card_number, 'en', { numeric: true }));
  return cards;
}

function reindex() {
  state.byNumber = new Map(state.cards.map(c => [c.card_number, c]));
  state.variants = [];
  state.byVariant = new Map();
  const sets = new Set(), rar = new Set(), tags = new Set();
  for (const c of state.cards) {
    sets.add(c._set);
    for (const tg of c._tags) tags.add(tg);
    for (const v of c._variants) {
      v.card = c;
      state.variants.push(v);
      state.byVariant.set(v.id, v);
      rar.add(v.rarity);
    }
  }
  const rarOrder = ['C', 'U', 'R', 'RR', 'S', 'SR', 'SEC', 'UR', 'HR', 'OSR', 'OUR', 'OC', 'SY', 'P'];
  state.sets = [...sets].sort(bySet);
  state.rarities = [...rar].sort((a, b) => rarOrder.indexOf(a) - rarOrder.indexOf(b));
  state.tags = [...tags].sort();
}

export async function load(onProgress = () => {}) {
  onProgress('Reading local database…', 10);
  let list = await db.cards.all();
  state.owned = await db.owned.all();

  if (!list.length) {
    onProgress('Downloading card data…', 25);
    list = await download(onProgress);
  } else {
    onProgress('Loaded ' + list.length + ' cards', 80);
  }
  state.cards = list;
  reindex();
  onProgress('Ready', 100);

  // background refresh once a day
  const last = await db.meta.get('lastSync');
  if (!last || Date.now() - last > 864e5) refresh().catch(() => {});
  return state;
}

async function download(onProgress = () => {}) {
  const res = await fetch(CARDS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Card data unavailable (' + res.status + ')');
  onProgress('Parsing…', 60);
  const raw = await res.json();
  const list = normalise(raw);
  await db.cards.replaceAll(list);
  await db.meta.set('lastSync', Date.now());
  await db.meta.set('cardCount', list.length);
  return list;
}

export async function refresh(onProgress = () => {}) {
  const list = await download(onProgress);
  state.cards = list;
  reindex();
  return list.length;
}

export function qty(variantId) {
  return state.owned.get(variantId) || 0;
}
export async function setQty(variantId, n) {
  n = Math.max(0, Math.min(99, n | 0));
  if (n > 0) state.owned.set(variantId, n); else state.owned.delete(variantId);
  await db.owned.set(variantId, n);
  return n;
}
export function ownedOf(card) {
  let n = 0;
  for (const v of card._variants) n += qty(v.id);
  return n;
}

export function setLang(l) {
  state.lang = l;
  localStorage.setItem('holotcg.lang', l);
}

export function setImgMode(m) {
  state.imgMode = m;
  localStorage.setItem('holotcg.imgmode', m);
}

// ---- filtering -------------------------------------------------------------
export const filters = {
  q: '',
  sets: new Set(),
  colors: new Set(),
  types: new Set(),
  blooms: new Set(),
  rarities: new Set(),
  tags: new Set(),
  owned: 'all', // all | owned | missing
};

export function activeFilterCount() {
  return filters.sets.size + filters.colors.size + filters.types.size +
    filters.blooms.size + filters.rarities.size + filters.tags.size +
    (filters.owned === 'all' ? 0 : 1);
}

export function clearFilters() {
  filters.sets.clear(); filters.colors.clear(); filters.types.clear();
  filters.blooms.clear(); filters.rarities.clear(); filters.tags.clear();
  filters.owned = 'all';
}

/** Returns a filtered list of variants (one tile per illustration). */
export function queryVariants() {
  const q = filters.q.trim().toLowerCase();
  const out = [];
  for (const v of state.variants) {
    const c = v.card;
    if (filters.sets.size && !filters.sets.has(c._set)) continue;
    if (filters.types.size && !filters.types.has(c._type)) continue;
    if (filters.rarities.size && !filters.rarities.has(v.rarity)) continue;
    if (filters.blooms.size && !filters.blooms.has(c.bloom_level)) continue;
    if (filters.colors.size) {
      const cols = c.colors || [];
      if (!cols.some(x => filters.colors.has(x))) continue;
    }
    if (filters.tags.size) {
      if (!c._tags.some(x => filters.tags.has(x))) continue;
    }
    if (filters.owned !== 'all') {
      const has = qty(v.id) > 0;
      if (filters.owned === 'owned' && !has) continue;
      if (filters.owned === 'missing' && has) continue;
    }
    if (q && !c._hay.includes(q)) continue;
    out.push(v);
  }
  return out;
}

export function collectionStats() {
  let copies = 0, uniq = 0;
  for (const [, n] of state.owned) { copies += n; if (n > 0) uniq++; }
  const perSet = new Map();
  for (const v of state.variants) {
    const s = v.card._set;
    let e = perSet.get(s);
    if (!e) perSet.set(s, e = { set: s, total: 0, have: 0 });
    e.total++;
    if (qty(v.id) > 0) e.have++;
  }
  return {
    copies, uniq,
    totalVariants: state.variants.length,
    totalCards: state.cards.length,
    perSet: [...perSet.values()].sort((a, b) => bySet(a.set, b.set)),
  };
}
