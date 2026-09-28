import * as D from './data.js';
import * as DK from './deck.js';
import * as db from './db.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

const ui = {
  view: 'cards',
  page: 0,
  pageSize: 60,
  results: [],
  decks: [],
  deckId: null,     // open deck in the Decks tab
  picker: null,     // deck id being filled from the Cards tab
};

const deckOf = id => ui.decks.find(d => d.id === id);

// ---------------------------------------------------------------- boot
(async function boot() {
  const bar = $('#boot-bar'), status = $('#boot-status');
  const prog = (msg, pct) => { status.textContent = msg; bar.style.width = pct + '%'; };
  try {
    await D.load(prog);
  } catch (err) {
    prog(err.message + ' — retry when online.', 100);
    return;
  }
  ui.decks = await DK.all();
  $('#lang-toggle').textContent = D.state.lang.toUpperCase();
  wire();
  render();
  setTimeout(() => {
    const boot = $('#boot');
    boot.classList.add('is-done');
    setTimeout(() => boot.remove(), 600);
  }, 200);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// ---------------------------------------------------------------- wiring
function wire() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('is-active', x === b));
    if (b.dataset.view !== 'decks' || (ui.view === 'decks' && ui.deckId)) ui.deckId = null;
    ui.view = b.dataset.view;
    ui.page = 0;
    window.scrollTo(0, 0);
    render();
  }));

  let debounce;
  $('#search').addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { D.filters.q = e.target.value; ui.page = 0; render(); }, 180);
  });

  $('#lang-toggle').addEventListener('click', () => {
    D.setLang(D.state.lang === 'en' ? 'jp' : 'en');
    $('#lang-toggle').textContent = D.state.lang.toUpperCase();
    render();
  });

  $('#sync-btn').addEventListener('click', async () => {
    toast('Refreshing card data…');
    try { const n = await D.refresh(); toast(n + ' cards updated'); render(); }
    catch { toast('Refresh failed — offline?'); }
  });

  $('#filter-btn').addEventListener('click', openFilters);
  $('#sheet').addEventListener('click', e => { if (e.target.dataset.close !== undefined) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  window.addEventListener('scroll', () => {
    if (ui.view !== 'cards') return;
    if (window.innerHeight + window.scrollY > document.body.offsetHeight - 900) growPage();
  }, { passive: true });
}

// ---------------------------------------------------------------- render
function render() {
  const titles = { cards: 'Cards', collection: 'Collection', decks: 'Decks', scan: 'Scan' };
  const openDeck = ui.view === 'decks' ? deckOf(ui.deckId) : null;
  $('#view-title').textContent = openDeck ? openDeck.name : titles[ui.view];
  $('#topbar').classList.toggle('is-plain', ui.view !== 'cards');
  const v = $('#view');
  v.innerHTML = '';
  if (ui.view === 'cards') renderCards(v);
  else if (ui.view === 'collection') renderCollection(v);
  else if (ui.view === 'decks') { const d = deckOf(ui.deckId); d ? renderDeckEditor(v, d) : renderDeckList(v); }
  else renderStub(v, 'Scan', 'Camera scanning comes last. The dataset ships perceptual hashes for every illustration, so matching can run fully on-device — no upload.');
  renderQuickbar();
}

function renderQuickbar() {
  const q = $('#quickbar');
  q.innerHTML = '';
  if (ui.view !== 'cards') return;
  const modes = [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing']];
  for (const [val, label] of modes) {
    const b = el('button', 'chip' + (D.filters.owned === val ? ' is-on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { D.filters.owned = val; ui.page = 0; render(); });
    q.appendChild(b);
  }
  for (const c of D.COLOR_LIST) {
    const b = el('button', 'chip' + (D.filters.colors.has(c) ? ' is-on' : ''), cap(c));
    b.type = 'button';
    b.addEventListener('click', () => { toggle(D.filters.colors, c); ui.page = 0; render(); });
    q.appendChild(b);
  }
  const n = D.activeFilterCount();
  const badge = $('#filter-count');
  badge.hidden = n === 0;
  badge.textContent = n;
  $('#filter-btn').classList.toggle('is-on', n > 0);
}

function renderCards(root) {
  if (ui.picker) {
    const d = deckOf(ui.picker);
    if (d) {
      const bar = el('div', 'picker');
      const txt = el('div', 'picker__txt');
      const val = DK.validate(d);
      txt.appendChild(el('strong', null, 'Adding to ' + d.name));
      txt.appendChild(el('span', null, 'Deck ' + val.main + '/' + DK.MAIN_SIZE + ' · Cheer ' + val.cheer + '/' + DK.CHEER_SIZE + (d.oshi ? ' · Oshi set' : ' · no Oshi')));
      bar.appendChild(txt);
      const done = el('button', 'btn btn--primary picker__done', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => {
        ui.deckId = ui.picker; ui.picker = null;
        document.querySelector('.tab[data-view="decks"]').click();
      });
      bar.appendChild(done);
      root.appendChild(bar);
    } else ui.picker = null;
  }
  ui.results = D.queryVariants();
  const note = el('p', 'view__note',
    ui.results.length.toLocaleString() + ' of ' + D.state.variants.length.toLocaleString() + ' prints · ' +
    D.state.cards.length.toLocaleString() + ' unique cards');
  root.appendChild(note);
  if (!ui.results.length) { root.appendChild(el('div', 'view__empty', 'Nothing matches those filters.')); return; }
  const grid = el('div', 'grid');
  grid.id = 'grid';
  root.appendChild(grid);
  ui.page = 0;
  appendTiles(grid, 0, ui.pageSize);
}

function growPage() {
  const grid = $('#grid');
  if (!grid) return;
  const start = (ui.page + 1) * ui.pageSize;
  if (start >= ui.results.length) return;
  ui.page++;
  appendTiles(grid, start, start + ui.pageSize);
}

function appendTiles(grid, from, to) {
  const frag = document.createDocumentFragment();
  for (const v of ui.results.slice(from, to)) frag.appendChild(tile(v));
  grid.appendChild(frag);
}

function tile(v) {
  const n = D.qty(v.id);
  const a = el('button', 'card' + (n ? '' : ' is-unowned'));
  a.type = 'button';
  a.dataset.vid = v.id;
  const img = el('img', 'card__img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = D.t(v.card.name) + ' ' + v.rarity;
  img.src = D.imgUrl(v.ill);
  a.appendChild(img);
  a.appendChild(el('span', 'card__rar', v.rarity));
  if (ui.picker) {
    const d = deckOf(ui.picker);
    const pile = DK.pileOf(v.card);
    const inDeck = pile === 'oshi' ? (d && d.oshi === v.id ? 1 : 0) : ((d && d[pile][v.id]) || 0);
    a.appendChild(el('span', 'card__badge' + (inDeck ? ' card__badge--deck' : ' card__badge--zero'), inDeck ? '+' + inDeck : '+'));
    a.addEventListener('click', () => addFromPicker(v));
  } else {
    a.appendChild(el('span', 'card__badge' + (n ? '' : ' card__badge--zero'), n ? '×' + n : '0'));
    a.addEventListener('click', () => openCard(v.card, v.id));
  }
  return a;
}

async function addFromPicker(v) {
  const d = deckOf(ui.picker);
  if (!d) return;
  const pile = DK.pileOf(v.card);
  const err = DK.change(d, v.id, 1);
  if (err) return toast(err);
  await DK.save(d);
  const inDeck = pile === 'oshi' ? 1 : d[pile][v.id];
  const tileEl = document.querySelector('.card[data-vid="' + CSS.escape(v.id) + '"]');
  if (tileEl) {
    const b = tileEl.querySelector('.card__badge');
    b.className = 'card__badge card__badge--deck';
    b.textContent = '+' + inDeck;
  }
  if (pile === 'oshi') {
    document.querySelectorAll('.card__badge--deck').forEach(b => {
      if (!tileEl || b !== tileEl.querySelector('.card__badge')) { b.className = 'card__badge card__badge--zero'; b.textContent = '+'; }
    });
  }
  const val = DK.validate(d);
  const sub = document.querySelector('.picker__txt span');
  if (sub) sub.textContent = 'Deck ' + val.main + '/' + DK.MAIN_SIZE + ' · Cheer ' + val.cheer + '/' + DK.CHEER_SIZE + (d.oshi ? ' · Oshi set' : ' · no Oshi');
  toast((pile === 'oshi' ? 'Oshi: ' : '+ ') + D.t(v.card.name) + (pile === 'oshi' ? '' : ' (' + inDeck + ')'));
}

function renderStub(root, title, body) {
  const w = el('div', 'view__empty');
  w.appendChild(el('h2', null, title));
  w.appendChild(el('p', null, body));
  root.appendChild(w);
}

function renderCollection(root) {
  const s = D.collectionStats();
  const stats = el('div', 'stats');
  const add = (n, l) => { const d = el('div', 'stat'); d.appendChild(el('div', 'stat__n', n)); d.appendChild(el('div', 'stat__l', l)); stats.appendChild(d); };
  add(s.copies.toLocaleString(), 'Cards owned');
  add(s.uniq.toLocaleString(), 'Unique prints');
  add(Math.round(s.uniq / s.totalVariants * 100) + '%', 'Of all prints');
  root.appendChild(stats);

  root.appendChild(el('h2', 'sheet__h', 'Completion by set'));
  const list = el('div', 'setlist');
  for (const e of s.perSet) {
    const row = el('button', 'setrow');
    row.type = 'button';
    const top = el('div', 'setrow__top');
    top.appendChild(el('span', 'setrow__name', D.setName(e.set, D.state.lang)));
    top.appendChild(el('span', 'setrow__n', e.have + '/' + e.total));
    row.appendChild(top);
    const sub = el('div', 'setrow__sub');
    sub.appendChild(el('span', 'setrow__id', e.set));
    const kind = D.setKind(e.set);
    if (kind) sub.appendChild(el('span', null, kind));
    if (D.isUnreleased(e.set)) sub.appendChild(el('span', 'tagjp', 'unreleased'));
    else if (D.isJpOnly(e.set)) sub.appendChild(el('span', 'tagjp', 'JP only'));
    row.appendChild(sub);
    const bar = el('span', 'setrow__bar');
    const i = document.createElement('i');
    i.style.width = (e.total ? e.have / e.total * 100 : 0) + '%';
    bar.appendChild(i);
    row.appendChild(bar);
    row.addEventListener('click', () => {
      D.clearFilters();
      D.filters.sets.add(e.set);
      document.querySelector('.tab[data-view="cards"]').click();
    });
    list.appendChild(row);
  }
  root.appendChild(list);
}


// ---------------------------------------------------------------- decks
function renderDeckList(root) {
  const head = el('div', 'deckhead');
  const mk = el('button', 'btn btn--primary', '+ New deck');
  mk.type = 'button';
  mk.addEventListener('click', async () => {
    const d = DK.blank('Deck ' + (ui.decks.length + 1));
    await DK.save(d);
    ui.decks.push(d);
    ui.deckId = d.id;
    render();
  });
  const imp = el('button', 'btn', 'Import');
  imp.type = 'button';
  imp.addEventListener('click', openImport);
  head.append(mk, imp);
  root.appendChild(head);

  if (!ui.decks.length) {
    root.appendChild(el('div', 'view__empty', 'No decks yet. A deck is 1 Oshi, exactly 50 main-deck cards and exactly 20 cheer.'));
    return;
  }

  const list = el('div', 'decklist');
  for (const d of [...ui.decks].sort((a, b) => b.updated - a.updated)) {
    const val = DK.validate(d);
    const row = el('button', 'deckcard');
    row.type = 'button';
    const o = D.state.byVariant.get(d.oshi);
    const thumb = el('div', 'deckcard__thumb');
    if (o) { const i = el('img'); i.loading = 'lazy'; i.src = D.imgUrl(o.ill); i.alt = ''; thumb.appendChild(i); }
    else thumb.appendChild(el('span', 'deckcard__ph', '?'));
    row.appendChild(thumb);
    const body = el('div', 'deckcard__body');
    body.appendChild(el('div', 'deckcard__name', d.name));
    body.appendChild(el('div', 'deckcard__meta', (o ? D.t(o.card.name) : 'No Oshi') + ' · ' + val.main + '/' + DK.MAIN_SIZE + ' · ' + val.cheer + '/' + DK.CHEER_SIZE));
    row.appendChild(body);
    row.appendChild(el('span', 'dotstate ' + (val.legal ? 'is-ok' : 'is-bad'), val.legal ? '✓' : String(val.errors.length)));
    row.addEventListener('click', () => { ui.deckId = d.id; window.scrollTo(0, 0); render(); });
    list.appendChild(row);
  }
  root.appendChild(list);
}

function renderDeckEditor(root, d) {
  const val = DK.validate(d);

  const back = el('button', 'backlink', '\u2039 All decks');
  back.type = 'button';
  back.addEventListener('click', () => { ui.deckId = null; window.scrollTo(0, 0); render(); });
  root.appendChild(back);

  const bar = el('div', 'deckbar');
  for (const [label, have, want] of [['Oshi', d.oshi ? 1 : 0, 1], ['Deck', val.main, DK.MAIN_SIZE], ['Cheer', val.cheer, DK.CHEER_SIZE]]) {
    const c = el('div', 'deckbar__cell' + (have === want ? ' is-ok' : ''));
    c.appendChild(el('span', 'deckbar__n', have + '/' + want));
    c.appendChild(el('span', 'deckbar__l', label));
    bar.appendChild(c);
  }
  root.appendChild(bar);

  const acts = el('div', 'deckhead');
  const add = el('button', 'btn btn--primary', '+ Add cards');
  add.type = 'button';
  add.addEventListener('click', () => {
    ui.picker = d.id;
    document.querySelector('.tab[data-view="cards"]').click();
  });
  const more = el('button', 'btn', '⋯');
  more.type = 'button';
  more.addEventListener('click', () => openDeckMenu(d));
  acts.append(add, more);
  root.appendChild(acts);

  if (val.errors.length || val.warnings.length) {
    const box = el('div', 'checks');
    for (const e of val.errors) box.appendChild(el('div', 'checks__row checks__row--err', '✕ ' + e));
    for (const w of val.warnings) box.appendChild(el('div', 'checks__row checks__row--warn', '! ' + w));
    root.appendChild(box);
  } else {
    root.appendChild(el('div', 'checks checks--ok', '✓ Legal deck'));
  }

  // oshi
  root.appendChild(el('h2', 'sheet__h', 'Oshi holomem'));
  const o = D.state.byVariant.get(d.oshi);
  if (o) root.appendChild(deckRow(d, { vid: d.oshi, n: 1, v: o }, 'oshi'));
  else root.appendChild(el('div', 'view__note', 'Pick one from Add cards — Oshi cards are the ones with a LIFE value.'));

  // main deck grouped
  const groups = [
    ['Holomem — Debut', e => e.v.card.bloom_level === 'debut'],
    ['Holomem — 1st Bloom', e => e.v.card.bloom_level === 'first'],
    ['Holomem — 2nd Bloom', e => e.v.card.bloom_level === 'second'],
    ['Holomem — Spot', e => e.v.card.bloom_level === 'spot'],
    ['Support', e => e.v.card._type.startsWith('support')],
  ];
  const mainEntries = DK.entries(d.main);
  const shown = new Set();
  root.appendChild(el('h2', 'sheet__h', 'Main deck · ' + val.main + '/' + DK.MAIN_SIZE));
  for (const [title, test] of groups) {
    const rows = mainEntries.filter(e => !shown.has(e.vid) && test(e));
    if (!rows.length) continue;
    rows.forEach(e => shown.add(e.vid));
    const n = rows.reduce((a, e) => a + e.n, 0);
    root.appendChild(el('h3', 'deckgroup', title + ' (' + n + ')'));
    for (const e of rows) root.appendChild(deckRow(d, e, 'main'));
  }
  const rest = mainEntries.filter(e => !shown.has(e.vid));
  if (rest.length) {
    root.appendChild(el('h3', 'deckgroup', 'Other (' + rest.reduce((a, e) => a + e.n, 0) + ')'));
    for (const e of rest) root.appendChild(deckRow(d, e, 'main'));
  }
  if (!mainEntries.length) root.appendChild(el('div', 'view__note', 'Empty.'));

  // cheer
  root.appendChild(el('h2', 'sheet__h', 'Cheer deck · ' + val.cheer + '/' + DK.CHEER_SIZE));
  const cheerEntries = DK.entries(d.cheer);
  for (const e of cheerEntries) root.appendChild(deckRow(d, e, 'cheer'));
  if (!cheerEntries.length) root.appendChild(el('div', 'view__note', 'Empty.'));

  // stats
  const st = DK.stats(d);
  if (val.main || val.cheer) {
    root.appendChild(el('h2', 'sheet__h', 'Mix'));
    root.appendChild(barRow('Deck colours', st.colors));
    root.appendChild(barRow('Cheer colours', st.cheerColors));
  }
}

function barRow(title, map) {
  const wrap = el('div', 'mix');
  wrap.appendChild(el('div', 'mix__h', title));
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  if (!total) { wrap.appendChild(el('div', 'view__note', '—')); return wrap; }
  const bar = el('div', 'mix__bar');
  for (const [c, n] of [...map].sort((a, b) => b[1] - a[1])) {
    const seg = el('i');
    seg.style.width = (n / total * 100) + '%';
    seg.style.background = colorHex(c);
    seg.title = c + ' ' + n;
    bar.appendChild(seg);
  }
  wrap.appendChild(bar);
  const legend = el('div', 'mix__legend');
  for (const [c, n] of [...map].sort((a, b) => b[1] - a[1])) {
    const t = el('span', 'mix__tag');
    const dot = el('i'); dot.style.background = colorHex(c);
    t.append(dot, document.createTextNode(cap(c) + ' ' + n));
    legend.appendChild(t);
  }
  wrap.appendChild(legend);
  return wrap;
}

function deckRow(d, e, pile) {
  const row = el('div', 'art');
  const thumb = el('img', 'art__img');
  thumb.loading = 'lazy';
  thumb.src = D.imgUrl(e.v.ill);
  thumb.alt = '';
  thumb.addEventListener('click', () => openCard(e.v.card, e.vid));
  row.appendChild(thumb);
  const main = el('div', 'art__main');
  main.appendChild(el('div', 'art__name', D.t(e.v.card.name)));
  const have = D.qty(e.vid);
  const meta = e.v.card.card_number + ' · ' + e.v.rarity + ' · ' + D.setName(e.v.card._set, D.state.lang) +
    (have < e.n ? ' · you own ' + have : '');
  const sub = el('div', 'art__by', meta);
  if (have < e.n) sub.classList.add('is-short');
  main.appendChild(sub);
  row.appendChild(main);

  const box = el('div', 'stepper');
  const minus = el('button', null, '−'); minus.type = 'button';
  const out = document.createElement('output');
  out.textContent = e.n;
  const plus = el('button', null, '+'); plus.type = 'button';
  const bump = async delta => {
    const err = DK.change(d, e.vid, delta);
    if (err) return toast(err);
    await DK.save(d);
    render();
  };
  minus.addEventListener('click', () => bump(-1));
  plus.addEventListener('click', () => bump(1));
  if (pile === 'oshi') { box.append(minus); } else { box.append(minus, out, plus); }
  row.appendChild(box);
  return row;
}

function openDeckMenu(d) {
  openSheet(panel => {
    panel.appendChild(el('h2', 'sheet__title', 'Deck'));

    const nameWrap = el('div', 'fgroup');
    nameWrap.appendChild(el('h3', 'fgroup__h', 'Name'));
    const input = el('input', 'search');
    input.value = d.name;
    input.addEventListener('change', async () => { d.name = input.value.trim() || 'Untitled deck'; await DK.save(d); render(); });
    nameWrap.appendChild(input);
    panel.appendChild(nameWrap);

    panel.appendChild(el('h3', 'sheet__h', 'Export'));
    const hd = JSON.stringify(DK.toHoloDelta(d));
    panel.appendChild(exportRow('holoDelta JSON', 'Opens in holoDelta, and in the hOCG Deck Converter for Deck Log, proxy sheets and Tabletop Sim.', hd, d.name + '.holodelta.json'));
    panel.appendChild(exportRow('Plain text list', 'A readable decklist to paste anywhere.', DK.toText(d), d.name + '.txt'));

    panel.appendChild(el('h3', 'sheet__h', 'Danger zone'));
    const del = el('button', 'btn btn--danger', 'Delete this deck');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
      await DK.remove(d.id);
      ui.decks = ui.decks.filter(x => x.id !== d.id);
      ui.deckId = null;
      closeSheet();
      render();
    });
    panel.appendChild(del);
  });
}

function exportRow(title, hint, text, filename) {
  const box = el('div', 'ability');
  box.appendChild(el('div', 'ability__name', title));
  box.appendChild(el('p', 'ability__txt', hint));
  const row = el('div', 'fgroup__row');
  const copy = el('button', 'chip', 'Copy');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch { toast('Clipboard blocked — use Download'); }
  });
  const dl = el('button', 'chip', 'Download');
  dl.type = 'button';
  dl.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  row.append(copy, dl);
  box.appendChild(row);
  return box;
}

function openImport() {
  openSheet(panel => {
    panel.appendChild(el('h2', 'sheet__title', 'Import deck'));
    panel.appendChild(el('p', 'fgroup__note', 'Paste a holoDelta deck (the JSON with deckName, oshi, deck and cheerDeck), or pick the file.'));
    const ta = document.createElement('textarea');
    ta.className = 'ta';
    ta.rows = 6;
    ta.placeholder = '{"deckName":"…","oshi":["hBP01-001",0],"deck":[["hBP01-009",4,0]],"cheerDeck":[["hY01-001",10,0]]}';
    panel.appendChild(ta);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.className = 'filein';
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (f) ta.value = await f.text();
    });
    panel.appendChild(file);

    const foot = el('div', 'sheet__foot');
    const go = el('button', 'btn btn--primary', 'Import');
    go.type = 'button';
    go.addEventListener('click', async () => {
      let json;
      try { json = JSON.parse(ta.value); } catch { return toast('That is not valid JSON'); }
      const { deck, skipped } = DK.fromHoloDelta(json);
      await DK.save(deck);
      ui.decks.push(deck);
      ui.deckId = deck.id;
      closeSheet();
      render();
      toast(skipped.length ? 'Imported, ' + skipped.length + ' unknown card(s) skipped' : 'Imported');
    });
    foot.appendChild(go);
    panel.appendChild(foot);
  });
}

// ---------------------------------------------------------------- sheets
function openSheet(build) {
  const panel = $('#sheet-panel');
  panel.innerHTML = '';
  const grab = el('div', 'sheet__grab');
  grab.addEventListener('click', closeSheet);
  panel.appendChild(grab);
  const close = el('button', 'sheet__close', '\u2715');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeSheet);
  panel.appendChild(close);
  build(panel);
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

function openCard(card, focusVariantId) {
  openSheet(panel => {
    panel.appendChild(el('h2', 'sheet__title', D.t(card.name)));
    panel.appendChild(el('p', 'sheet__sub', card.card_number + ' · ' + D.typeLabel(card._type) +
      (card.bloom_level ? ' · ' + cap(card.bloom_level) : '')));
    panel.appendChild(el('p', 'sheet__set', D.setFullName(card._set, D.state.lang)));

    const focus = card._variants.find(v => v.id === focusVariantId) || card._variants[0];
    const hero = el('div', 'detail__hero');
    const img = el('img');
    img.src = D.imgUrl(focus.ill);
    img.alt = D.t(card.name);
    hero.appendChild(img);

    const meta = el('div', 'detail__meta');
    for (const c of card.colors || []) meta.appendChild(el('span', 'pill pill--' + c, cap(c)));
    if (card.hp) meta.appendChild(el('span', 'pill', 'HP ' + card.hp));
    if (card.life) meta.appendChild(el('span', 'pill', 'LIFE ' + card.life));
    if (card.buzz) meta.appendChild(el('span', 'pill', 'Buzz'));
    if (card.limited) meta.appendChild(el('span', 'pill', 'LIMITED'));
    if (card.baton_pass && card.baton_pass.length) meta.appendChild(el('span', 'pill', 'Baton ' + card.baton_pass.length));
    for (const tg of card._tags) meta.appendChild(el('span', 'pill', tg));
    hero.appendChild(meta);
    panel.appendChild(hero);

    // abilities
    const abil = [];
    for (const s of card.oshi_skills || []) abil.push({ name: s.name, text: s.text, cost: null, pow: s.holo_power != null ? 'SP ' + s.holo_power : '' });
    for (const a of card.arts || []) abil.push({ name: a.name, text: a.text, cost: a.cheers, pow: a.power });
    for (const k of card.keywords || []) abil.push({ name: k.name, text: k.text, cost: null, pow: '' });
    if (card.text) abil.push({ name: null, text: card.text, cost: null, pow: '' });
    if (card.extra) abil.push({ name: null, text: card.extra, cost: null, pow: '' });

    if (abil.length) {
      panel.appendChild(el('h3', 'sheet__h', 'Abilities'));
      for (const a of abil) {
        const box = el('div', 'ability');
        if (a.name || a.pow) {
          const top = el('div', 'ability__top');
          top.appendChild(el('span', 'ability__name', a.name ? D.t(a.name) : '—'));
          if (a.pow) top.appendChild(el('span', 'ability__pow', a.pow));
          box.appendChild(top);
        }
        if (a.cost && a.cost.length) {
          const row = el('div', 'ability__cost');
          for (const c of a.cost) { const d = el('span', 'dot'); d.style.background = colorHex(c); row.appendChild(d); }
          box.appendChild(row);
        }
        if (a.text) box.appendChild(el('p', 'ability__txt', D.t(a.text)));
        panel.appendChild(box);
      }
    }

    // prints + owned steppers
    panel.appendChild(el('h3', 'sheet__h', 'Prints you own'));
    for (const v of card._variants) {
      const row = el('div', 'art');
      const thumb = el('img', 'art__img');
      thumb.loading = 'lazy';
      thumb.src = D.imgUrl(v.ill);
      thumb.alt = v.rarity;
      thumb.addEventListener('click', () => { img.src = thumb.src; });
      row.appendChild(thumb);
      const main = el('div', 'art__main');
      main.appendChild(el('div', 'art__rar', v.rarity));
      main.appendChild(el('div', 'art__by', v.illustrator || '—'));
      row.appendChild(main);
      row.appendChild(stepper(v));
      panel.appendChild(row);
    }
  });
}

function stepper(v) {
  const box = el('div', 'stepper');
  const minus = el('button', null, '−'); minus.type = 'button';
  const out = document.createElement('output');
  const plus = el('button', null, '+'); plus.type = 'button';
  out.textContent = D.qty(v.id);
  const bump = async d => {
    const n = await D.setQty(v.id, D.qty(v.id) + d);
    out.textContent = n;
    syncTile(v.id, n);
  };
  minus.addEventListener('click', () => bump(-1));
  plus.addEventListener('click', () => bump(1));
  box.append(minus, out, plus);
  return box;
}

function syncTile(vid, n) {
  const tileEl = document.querySelector('.card[data-vid="' + CSS.escape(vid) + '"]');
  if (!tileEl) return;
  tileEl.classList.toggle('is-unowned', n === 0);
  const badge = tileEl.querySelector('.card__badge');
  badge.className = 'card__badge' + (n ? '' : ' card__badge--zero');
  badge.textContent = n ? '\u00d7' + n : '0';
}

function openFilters() {
  openSheet(panel => {
    panel.appendChild(el('h2', 'sheet__title', 'Filters & display'));

    const disp = el('div', 'fgroup');
    disp.appendChild(el('h3', 'fgroup__h', 'Card images'));
    const drow = el('div', 'fgroup__row');
    for (const [val, label] of [['auto', 'Official scans'], ['en', 'English + proxies'], ['jp', 'Japanese only']]) {
      const b = el('button', 'chip' + (D.state.imgMode === val ? ' is-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => {
        D.setImgMode(val);
        drow.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-on', x === b));
      });
      drow.appendChild(b);
    }
    disp.appendChild(drow);
    disp.appendChild(el('p', 'fgroup__note', 'About a quarter of prints have no English release yet, so the dataset only has a fan-made proxy scan for them \u2014 the ones stamped PROXY. Official scans shows the real card in English where it exists and Japanese where it does not. Card text always follows the EN/JP button in the header.'));
    panel.appendChild(disp);

    setGroup(panel);
    group(panel, 'Card type', ['oshi_holomem', 'holomem', 'cheer', 'support_event', 'support_item', 'support_tool', 'support_mascot', 'support_fan', 'support_staff'], D.filters.types, D.typeLabel);
    group(panel, 'Bloom level', D.BLOOMS, D.filters.blooms, cap);
    group(panel, 'Rarity', D.state.rarities, D.filters.rarities, x => x);
    group(panel, 'Tag', D.state.tags, D.filters.tags, x => x);

    const foot = el('div', 'sheet__foot');
    const clear = el('button', 'btn', 'Clear all'); clear.type = 'button';
    clear.addEventListener('click', () => { D.clearFilters(); closeSheet(); ui.page = 0; render(); });
    const done = el('button', 'btn btn--primary', 'Show results'); done.type = 'button';
    done.addEventListener('click', () => { closeSheet(); ui.page = 0; render(); });
    foot.append(clear, done);
    panel.appendChild(foot);
  });
}

function setGroup(panel) {
  const byKind = new Map();
  for (const code of D.state.sets) {
    const kind = D.setKind(code) || 'Other';
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(code);
  }
  const order = ['Booster Pack', 'Extra Booster', 'Start Deck', 'Live Start Deck', 'Accessory', 'Promo', 'Cheer', 'Other'];
  for (const kind of order) {
    const codes = byKind.get(kind);
    if (!codes) continue;
    const g = el('div', 'fgroup');
    g.appendChild(el('h3', 'fgroup__h', kind));
    const row = el('div', 'fgroup__row');
    for (const code of codes) {
      const b = el('button', 'chip' + (D.filters.sets.has(code) ? ' is-on' : ''), D.setName(code, D.state.lang));
      b.type = 'button';
      b.title = code;
      if (D.isUnreleased(code)) b.appendChild(el('span', 'chip__tag', 'soon'));
      else if (D.isJpOnly(code)) b.appendChild(el('span', 'chip__tag', 'JP'));
      b.addEventListener('click', () => { toggle(D.filters.sets, code); b.classList.toggle('is-on', D.filters.sets.has(code)); });
      row.appendChild(b);
    }
    g.appendChild(row);
    panel.appendChild(g);
  }
}

function group(panel, title, values, set, label) {
  const g = el('div', 'fgroup');
  g.appendChild(el('h3', 'fgroup__h', title));
  const row = el('div', 'fgroup__row');
  for (const v of values) {
    const b = el('button', 'chip' + (set.has(v) ? ' is-on' : ''), label(v));
    b.type = 'button';
    b.addEventListener('click', () => { toggle(set, v); b.classList.toggle('is-on', set.has(v)); });
    row.appendChild(b);
  }
  g.appendChild(row);
  panel.appendChild(g);
}

// ---------------------------------------------------------------- helpers
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function colorHex(c) {
  return ({ white: '#f2f2f4', green: '#3f9c63', red: '#d4485c', blue: '#4a86d4', purple: '#8a63c9', yellow: '#e0b23c', colorless: '#6b6b76' })[c] || '#6b6b76';
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
