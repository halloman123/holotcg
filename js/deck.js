// Deck model, legality checking and interchange formats.
//
// Rules from the hOCG Comprehensive Rules Ver. 1.5.0, section 6.1:
//   6.1.2    exactly one Oshi holomem
//   6.1.3.1  the cheer deck may only contain cheer cards
//   6.1.3.2  the cheer deck contains exactly 20 cards
//   6.1.3.3  any number of copies of the same card number in the cheer deck
//   6.1.4.1  the main deck contains no Oshi holomem and no cheer cards
//   6.1.4.2  the main deck contains exactly 50 cards
//   6.1.4.3  at most 4 copies of each card number
//   6.1.5    card abilities may replace that limit — the dataset's `max_amount`
//            already carries the real per-card number (1 / 4 / 20 / 50)
// There is NO colour restriction between the Oshi and the rest of the deck.
import * as D from './data.js';
import * as db from './db.js';

export const MAIN_SIZE = 50;
export const CHEER_SIZE = 20;
export const DEFAULT_MAX = 4;

// Tournament restricted list — max 1 per deck. English edition, effective
// 17 Apr 2026. Checked 28 Sep 2026 against
// https://en.hololive-official-cardgame.com/news/post/03/
// (the Oct 2025 – Apr 2026 list, hBP01-010 and hBP01-014, has lapsed).
export const RESTRICTED = new Set(['hBP01-030']);

export function blank(name = 'New deck') {
  const now = Date.now();
  return { id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 6), name, oshi: null, main: {}, cheer: {}, created: now, updated: now };
}

export const all = () => db.decks.all();
export async function save(deck) {
  deck.updated = Date.now();
  await db.decks.put(deck);
  return deck;
}
export const remove = id => db.decks.del(id);

// ---- helpers ---------------------------------------------------------------
export function pileOf(card) {
  if (card._type === 'oshi_holomem') return 'oshi';
  if (card._type === 'cheer') return 'cheer';
  return 'main';
}

/** Per-deck copy limit for a card number, from the dataset. */
export function maxCopies(card) {
  const m = card.max_amount || {};
  const n = m[D.state.lang] ?? m.en ?? m.jp;
  return Number.isFinite(n) ? n : DEFAULT_MAX;
}

export const count = pile => Object.values(pile).reduce((a, b) => a + b, 0);

/** {cardNumber: copies} across a pile of variantIds. */
export function byCardNumber(pile) {
  const out = new Map();
  for (const [vid, n] of Object.entries(pile)) {
    const num = vid.split('#')[0];
    out.set(num, (out.get(num) || 0) + n);
  }
  return out;
}

export function entries(pile) {
  return Object.entries(pile)
    .map(([vid, n]) => ({ vid, n, v: D.state.byVariant.get(vid) }))
    .filter(e => e.v)
    .sort((a, b) =>
      a.v.card._set.localeCompare(b.v.card._set, 'en', { numeric: true }) ||
      a.v.card.card_number.localeCompare(b.v.card.card_number, 'en', { numeric: true }));
}

/** Add/remove copies. Returns a short reason string when it refused. */
export function change(deck, variantId, delta) {
  const v = D.state.byVariant.get(variantId);
  if (!v) return 'Unknown card';
  const card = v.card;
  const pile = pileOf(card);

  if (pile === 'oshi') {
    if (delta < 0) { deck.oshi = null; return null; }
    deck.oshi = variantId;
    return null;
  }

  const bag = deck[pile];
  const now = bag[variantId] || 0;
  const next = now + delta;
  if (next <= 0) { delete bag[variantId]; return null; }

  if (delta > 0) {
    const limit = maxCopies(card);
    const already = byCardNumber(bag).get(card.card_number) || 0;
    if (already + delta > limit) {
      return limit === 1
        ? 'Only 1 copy of ' + card.card_number + ' allowed'
        : 'Already at ' + limit + ' copies of ' + card.card_number;
    }
    const size = pile === 'main' ? MAIN_SIZE : CHEER_SIZE;
    if (count(bag) + delta > size) return (pile === 'main' ? 'Main deck' : 'Cheer deck') + ' is full (' + size + ')';
  }
  bag[variantId] = next;
  return null;
}

// ---- legality --------------------------------------------------------------
export function validate(deck) {
  const errors = [], warnings = [];
  const main = count(deck.main), cheer = count(deck.cheer);

  if (!deck.oshi) errors.push('No Oshi holomem chosen');
  else if (!D.state.byVariant.get(deck.oshi)) errors.push('Oshi card is not in the database');

  if (main !== MAIN_SIZE) errors.push('Main deck has ' + main + ' cards, needs exactly ' + MAIN_SIZE);
  if (cheer !== CHEER_SIZE) errors.push('Cheer deck has ' + cheer + ' cards, needs exactly ' + CHEER_SIZE);

  for (const [num, n] of byCardNumber(deck.main)) {
    const card = D.state.byNumber.get(num);
    if (!card) continue;
    if (card._type === 'oshi_holomem' || card._type === 'cheer') errors.push(num + ' cannot go in the main deck');
    const limit = maxCopies(card);
    if (n > limit) errors.push(n + '× ' + num + ' ' + D.t(card.name) + ' — limit is ' + limit);
    if (RESTRICTED.has(num) && n > 1) warnings.push(num + ' ' + D.t(card.name) + ' is restricted to 1 copy in official tournaments');
  }
  for (const [num] of byCardNumber(deck.cheer)) {
    const card = D.state.byNumber.get(num);
    if (card && card._type !== 'cheer') errors.push(num + ' is not a cheer card');
  }

  // practical checks, not rules
  let debut = 0;
  for (const e of entries(deck.main)) if (e.v.card.bloom_level === 'debut') debut += e.n;
  if (main > 0 && debut === 0) warnings.push('No Debut holomem — you cannot set up the stage');
  else if (main >= MAIN_SIZE && debut < 6) warnings.push('Only ' + debut + ' Debut holomem; most decks run 8–14');

  const cheerColors = new Set();
  for (const e of entries(deck.cheer)) for (const c of e.v.card.colors || []) cheerColors.add(c);
  const needed = new Set();
  for (const e of entries(deck.main)) for (const a of e.v.card.arts || []) for (const c of a.cheers || []) if (c !== 'colorless') needed.add(c);
  const missing = [...needed].filter(c => !cheerColors.has(c));
  if (cheer > 0 && missing.length) warnings.push('No ' + missing.join('/') + ' cheer, but arts in the deck need it');

  let short = 0;
  for (const pile of ['main', 'cheer']) {
    for (const e of entries(deck[pile])) { const have = D.qty(e.vid); if (have < e.n) short += e.n - have; }
  }
  if (deck.oshi && D.qty(deck.oshi) < 1) short += 1;
  if (short) warnings.push(short + ' card' + (short > 1 ? 's' : '') + ' in this deck ' + (short > 1 ? 'are' : 'is') + ' not in your collection');

  return { errors, warnings, main, cheer, debut, legal: errors.length === 0 };
}

export function stats(deck) {
  const colors = new Map(), blooms = new Map(), types = new Map();
  for (const e of entries(deck.main)) {
    for (const c of e.v.card.colors || []) colors.set(c, (colors.get(c) || 0) + e.n);
    const b = e.v.card.bloom_level;
    if (b) blooms.set(b, (blooms.get(b) || 0) + e.n);
    const t = D.typeLabel(e.v.card._type);
    types.set(t, (types.get(t) || 0) + e.n);
  }
  const cheerColors = new Map();
  for (const e of entries(deck.cheer)) for (const c of e.v.card.colors || []) cheerColors.set(c, (cheerColors.get(c) || 0) + e.n);
  return { colors, blooms, types, cheerColors };
}

// ---- interchange -----------------------------------------------------------
const deltaIdx = v => (v.ill && Number.isFinite(v.ill.delta_art_index)) ? v.ill.delta_art_index : 0;

/** holoDelta deck JSON — also what qrimpuff.github.io/hocg-deck-convert reads,
 *  which is the bridge to Deck Log, HoloDuel, Tabletop Sim and proxy sheets. */
export function toHoloDelta(deck) {
  const rows = pile => {
    const merged = new Map();          // cardNumber|artIdx -> amount
    for (const e of entries(pile)) {
      const k = e.v.card.card_number + '|' + deltaIdx(e.v);
      merged.set(k, (merged.get(k) || 0) + e.n);
    }
    return [...merged].map(([k, n]) => { const [num, idx] = k.split('|'); return [num, n, +idx]; });
  };
  const o = D.state.byVariant.get(deck.oshi);
  return {
    deckName: deck.name,
    oshi: o ? [o.card.card_number, deltaIdx(o)] : ['', 0],
    deck: rows(deck.main),
    cheerDeck: rows(deck.cheer),
  };
}

function findVariant(cardNumber, artIdx) {
  const card = D.state.byNumber.get(cardNumber);
  if (!card) return null;
  return card._variants.find(v => deltaIdx(v) === artIdx) || card._variants[0] || null;
}

export function fromHoloDelta(json) {
  const d = blank(json.deckName || 'Imported deck');
  const skipped = [];
  const o = Array.isArray(json.oshi) ? json.oshi : [json.oshi, 0];
  const ov = findVariant(o[0], o[1] || 0);
  if (ov) d.oshi = ov.id; else if (o[0]) skipped.push(o[0]);
  for (const [key, pile] of [['deck', 'main'], ['cheerDeck', 'cheer']]) {
    for (const row of json[key] || []) {
      const [num, amount, artIdx] = Array.isArray(row) ? row : [row, 1, 0];
      const v = findVariant(num, artIdx || 0);
      if (!v) { skipped.push(num); continue; }
      d[pile][v.id] = (d[pile][v.id] || 0) + (amount || 1);
    }
  }
  return { deck: d, skipped };
}

export function toText(deck) {
  const line = e => e.n + '× ' + e.v.card.card_number + ' ' + D.t(e.v.card.name) + ' (' + e.v.rarity + ')';
  const o = D.state.byVariant.get(deck.oshi);
  const out = [deck.name, ''];
  out.push('Oshi: ' + (o ? o.card.card_number + ' ' + D.t(o.card.name) : '—'), '');
  out.push('Deck (' + count(deck.main) + ')');
  for (const e of entries(deck.main)) out.push('  ' + line(e));
  out.push('', 'Cheer (' + count(deck.cheer) + ')');
  for (const e of entries(deck.cheer)) out.push('  ' + line(e));
  return out.join('\n');
}
