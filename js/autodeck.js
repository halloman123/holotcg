// Automatic deck building, from cards you actually own.
//
// The hard constraint is blooming. Comprehensive Rules 8.3.3: the card you
// bloom with must have the SAME CARD NAME as the holomem on stage; a 1st
// blooms onto a Debut or 1st, a 2nd onto a 1st or 2nd. So a deck is not a pile
// of good holomem — it is a set of bloom LINES (Debut → 1st → 2nd of one
// name). Everything below is organised around finding and filling those lines.
//
// Pool is strictly what you own. When the collection cannot reach 50 + 20 the
// builder says what is missing rather than quietly adding cards you'd have to
// buy.
import * as D from './data.js';
import * as DK from './deck.js';

// Roughly what a sensible list looks like. Treated as targets to aim at, not
// quotas to enforce — the collection decides what is actually reachable.
const TARGET_HOLOMEM = 30;
const TARGET_DEBUT = 12;
const TARGET_FIRST = 10;
const TARGET_SECOND = 7;

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Owned copies per card number, with the prints they came from. */
function ownedByNumber() {
  const m = new Map();
  for (const [vid, qty] of D.state.owned) {
    if (qty <= 0) continue;
    const v = D.state.byVariant.get(vid);
    if (!v) continue;
    const num = v.card.card_number;
    let e = m.get(num);
    if (!e) m.set(num, e = { card: v.card, total: 0, prints: [] });
    e.total += qty;
    e.prints.push({ vid, qty });
  }
  for (const e of m.values()) e.prints.sort((a, b) => b.qty - a.qty);
  return m;
}

export function ownedOshi() {
  const out = [];
  for (const e of ownedByNumber().values()) if (e.card._type === 'oshi_holomem') out.push(e);
  return out.sort((a, b) => a.card.card_number.localeCompare(b.card.card_number, 'en', { numeric: true }));
}

export function ownedColors() {
  const counts = new Map();
  for (const e of ownedByNumber().values()) {
    for (const c of e.card.colors || []) counts.set(c, (counts.get(c) || 0) + e.total);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ color: c, count: n }));
}

const shares = (card, colors) => (card.colors || []).some(c => colors.has(c));

/** How much a card can contribute: copies owned, capped by the deck limit. */
function usable(entry) {
  const limit = DK.RESTRICTED.has(entry.card.card_number) ? 1 : DK.maxCopies(entry.card);
  return Math.min(entry.total, limit);
}

/** Group owned holomem into bloom lines keyed by card name. */
function buildLines(pool, colors) {
  const lines = new Map();
  for (const e of pool.values()) {
    if (e.card._type !== 'holomem') continue;
    const name = e.card._nameEn || e.card._nameJp;
    let L = lines.get(name);
    if (!L) lines.set(name, L = { name, debut: [], first: [], second: [], spot: [], onColor: false });
    const bucket = { debut: L.debut, first: L.first, second: L.second, spot: L.spot }[e.card.bloom_level];
    if (bucket) bucket.push(e);
    if (shares(e.card, colors)) L.onColor = true;
  }
  for (const L of lines.values()) {
    const avail = b => b.reduce((n, e) => n + usable(e), 0);
    L.nDebut = avail(L.debut); L.nFirst = avail(L.first);
    L.nSecond = avail(L.second); L.nSpot = avail(L.spot);
    // A line is playable if it can start. Depth is what makes it worth running.
    L.playable = L.nDebut > 0;
    L.depth = (L.nFirst > 0 ? 1 : 0) + (L.nSecond > 0 ? 1 : 0);
    L.score = (L.onColor ? 100 : 0) + L.depth * 25 + Math.min(12, L.nDebut + L.nFirst + L.nSecond);
  }
  return [...lines.values()].sort((a, b) => b.score - a.score);
}

/** Cheer colours the deck's arts actually ask for. */
function cheerDemand(numbers) {
  const demand = new Map();
  for (const num of numbers) {
    const card = D.state.byNumber.get(num);
    if (!card) continue;
    for (const a of card.arts || []) {
      for (const c of a.cheers || []) {
        if (c === 'colorless') continue;
        demand.set(c, (demand.get(c) || 0) + 1);
      }
    }
  }
  return demand;
}

/**
 * Build a deck.
 * seed: {kind:'oshi', cardNumber} | {kind:'color', color} | {kind:'random'}
 * Returns { deck, report } — report lists what it could not fill and why.
 */
export function build(seed) {
  const pool = ownedByNumber();
  const notes = [];

  // ---- 1. the Oshi --------------------------------------------------------
  const oshis = ownedOshi();
  if (!oshis.length) {
    return { deck: null, report: { ok: false, reason: 'You do not own an Oshi holomem yet. Every deck needs exactly one.' } };
  }
  let oshiEntry = null;
  if (seed.kind === 'oshi') {
    oshiEntry = oshis.find(e => e.card.card_number === seed.cardNumber) || null;
    if (!oshiEntry) return { deck: null, report: { ok: false, reason: 'That Oshi is not in your collection.' } };
  } else if (seed.kind === 'color') {
    const matching = oshis.filter(e => (e.card.colors || []).includes(seed.color));
    if (!matching.length) {
      return { deck: null, report: { ok: false, reason: 'You do not own a ' + seed.color + ' Oshi holomem.' } };
    }
    oshiEntry = shuffle(matching)[0];
  } else {
    oshiEntry = shuffle([...oshis])[0];
  }

  const colors = new Set(oshiEntry.card.colors || []);
  const deck = DK.blank(D.t(oshiEntry.card.name) + ' — auto');
  deck.oshi = oshiEntry.prints[0].vid;

  // ---- 2. spend from the pool --------------------------------------------
  // Track what is left so a print is never used twice across piles.
  const left = new Map();
  for (const [num, e] of pool) left.set(num, { ...e, remaining: usable(e), prints: e.prints.map(p => ({ ...p })) });
  left.get(oshiEntry.card.card_number).remaining = 0;   // the Oshi is not deck material

  // Per-print ledger. Both piles draw from this, so a print is never assigned
  // more copies than are actually owned.
  const printsLeft = new Map();
  for (const [num, e] of pool) printsLeft.set(num, e.prints.map(p => ({ vid: p.vid, left: p.qty })));
  function assign(pile, num, copies) {
    let need = copies, given = 0;
    for (const p of printsLeft.get(num) || []) {
      if (need <= 0) break;
      const n = Math.min(need, p.left);
      if (n <= 0) continue;
      p.left -= n;
      pile[p.vid] = (pile[p.vid] || 0) + n;
      need -= n; given += n;
    }
    return given;
  }

  const chosen = new Map();   // cardNumber -> copies
  function take(num, want) {
    const e = left.get(num);
    if (!e || e.remaining <= 0 || want <= 0) return 0;
    const n = Math.min(want, e.remaining, DK.MAIN_SIZE - total(chosen));
    if (n <= 0) return 0;
    e.remaining -= n;
    chosen.set(num, (chosen.get(num) || 0) + n);
    return n;
  }
  const total = m => [...m.values()].reduce((a, b) => a + b, 0);

  // ---- 3. holomem, by bloom line -----------------------------------------
  const lines = buildLines(left, colors).filter(L => L.playable);
  const onColor = lines.filter(L => L.onColor);
  const offColor = lines.filter(L => !L.onColor);

  const counts = { debut: 0, first: 0, second: 0, spot: 0 };
  const fillLines = (list, caps) => {
    for (const L of list) {
      if (total(chosen) >= TARGET_HOLOMEM) break;
      const want = (bucket, got, cap) => {
        let taken = 0;
        for (const e of bucket) {
          if (got() >= cap) break;
          const room = Math.min(4, cap - got());
          const n = take(e.card.card_number, room);
          counts[e.card.bloom_level] += n;
          taken += n;
        }
        return taken;
      };
      // A 1st Bloom can only be played onto a Debut of the same name, and a
      // 2nd onto a 1st or Debut of that name (Comprehensive Rules 8.3.3).
      // So the rest of a line only goes in once its Debut is actually in the
      // deck — otherwise those cards are dead cardboard.
      const gotDebut = want(L.debut, () => counts.debut, caps.debut);
      if (!gotDebut) continue;
      const gotFirst = want(L.first, () => counts.first, caps.first);
      if (gotFirst || L.nFirst === 0) want(L.second, () => counts.second, caps.second);
    }
  };
  fillLines(onColor, { debut: TARGET_DEBUT, first: TARGET_FIRST, second: TARGET_SECOND });
  if (total(chosen) < TARGET_HOLOMEM) {
    // Not enough in-colour depth — widen rather than hand back a half deck.
    const before = total(chosen);
    fillLines(offColor, { debut: TARGET_DEBUT, first: TARGET_FIRST, second: TARGET_SECOND });
    if (total(chosen) > before) notes.push('Added off-colour holomem — you do not own enough ' + [...colors].join('/') + ' bloom lines yet.');
  }
  // Spot holomem are a fine filler: they cannot bloom, so they need no line.
  for (const e of shuffle([...left.values()].filter(x => x.card._type === 'holomem' && x.card.bloom_level === 'spot' && x.remaining > 0))) {
    if (total(chosen) >= TARGET_HOLOMEM) break;
    counts.spot += take(e.card.card_number, 2);
  }

  const holomemTotal = total(chosen);
  if (!holomemTotal) notes.push('You do not own any holomem that can start a bloom line (a Debut holomem).');

  // ---- 4. support ---------------------------------------------------------
  const supports = [...left.values()]
    .filter(e => e.card._type.startsWith('support') && e.remaining > 0)
    .map(e => {
      const text = ((e.card.text && (e.card.text.en || e.card.text.jp)) || '').toLowerCase();
      // Draw and search keep a deck running; prefer them, then whatever there is most of.
      const useful = /draw|look at|reveal|search|from your deck/.test(text) ? 1 : 0;
      const tagged = shares(e.card, colors) ? 1 : 0;
      return { e, score: useful * 40 + tagged * 10 + Math.min(8, e.remaining) };
    })
    .sort((a, b) => b.score - a.score);
  for (const { e } of supports) {
    if (total(chosen) >= DK.MAIN_SIZE) break;
    take(e.card.card_number, 4);
  }

  // ---- 5. anything still owned, to close the gap --------------------------
  for (const e of shuffle([...left.values()].filter(x => x.remaining > 0 && DK.pileOf(x.card) === 'main'))) {
    if (total(chosen) >= DK.MAIN_SIZE) break;
    take(e.card.card_number, e.remaining);
  }

  // ---- 6. assign prints ---------------------------------------------------
  for (const [num, copies] of chosen) assign(deck.main, num, copies);

  // ---- 7. cheer -----------------------------------------------------------
  const demand = cheerDemand([...chosen.keys()]);
  const cheerPool = [...pool.values()].filter(e => e.card._type === 'cheer');
  const byColor = new Map();
  for (const e of cheerPool) {
    for (const c of e.card.colors || []) {
      if (!byColor.has(c)) byColor.set(c, []);
      byColor.get(c).push(e);
    }
  }
  const demandTotal = [...demand.values()].reduce((a, b) => a + b, 0);
  const wanted = new Map();
  if (demandTotal) {
    for (const [c, n] of demand) wanted.set(c, Math.round(n / demandTotal * DK.CHEER_SIZE));
  } else {
    for (const c of colors) wanted.set(c, Math.round(DK.CHEER_SIZE / Math.max(1, colors.size)));
  }
  // A colour the deck's arts need must not round down to nothing — a single
  // art you can never pay for is worse than a slightly lopsided cheer deck.
  // Two copies first for every needed colour we own, then the rest by share.
  const floors = [...demand.keys()].filter(c => (byColor.get(c) || []).length);
  const cheerLeft = new Map(cheerPool.map(e => [e.card.card_number, e.total]));
  const addCheer = (entry, n) => {
    const num = entry.card.card_number;
    const want = Math.min(n, cheerLeft.get(num) || 0, DK.CHEER_SIZE - DK.count(deck.cheer));
    if (want <= 0) return 0;
    const given = assign(deck.cheer, num, want);
    cheerLeft.set(num, (cheerLeft.get(num) || 0) - given);
    return given;
  };
  for (const c of floors) {
    let placed = 0;
    for (const e of byColor.get(c)) { if (placed >= 2) break; placed += addCheer(e, 2 - placed); }
  }
  for (const [c, n] of [...wanted].sort((a, b) => b[1] - a[1])) {
    const already = floors.includes(c) ? 2 : 0;
    for (const e of byColor.get(c) || []) addCheer(e, Math.max(0, n - already));
  }
  for (const e of cheerPool) {                     // top up with anything left
    if (DK.count(deck.cheer) >= DK.CHEER_SIZE) break;
    addCheer(e, DK.CHEER_SIZE);
  }

  // ---- 8. report ----------------------------------------------------------
  const mainShort = DK.MAIN_SIZE - DK.count(deck.main);
  const cheerShort = DK.CHEER_SIZE - DK.count(deck.cheer);
  if (mainShort > 0) notes.push(mainShort + ' main-deck card' + (mainShort > 1 ? 's' : '') + ' short — you do not own enough yet.');
  if (cheerShort > 0) notes.push(cheerShort + ' cheer card' + (cheerShort > 1 ? 's' : '') + ' short.');
  const missingColors = [...demand.keys()].filter(c => !(byColor.get(c) || []).length);
  if (missingColors.length) notes.push('No ' + missingColors.join('/') + ' cheer owned, but arts in this deck need it.');

  deck.auto = {
    seed, built: Date.now(),
    oshi: oshiEntry.card.card_number,
    lines: lines.filter(L => L.onColor).slice(0, 6).map(L => L.name),
    counts: { ...counts, holomem: holomemTotal, support: total(chosen) - holomemTotal },
    notes,
  };
  return { deck, report: { ok: true, notes, complete: mainShort <= 0 && cheerShort <= 0 } };
}
