import * as D from './data.js';
import * as db from './db.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

const ui = {
  view: 'cards',
  page: 0,
  pageSize: 60,
  results: [],
};

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
  $('#lang-toggle').textContent = D.state.lang.toUpperCase();
  wire();
  render();
  setTimeout(() => { $('#boot').classList.add('is-done'); }, 200);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// ---------------------------------------------------------------- wiring
function wire() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('is-active', x === b));
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
  $('#view-title').textContent = titles[ui.view];
  $('#topbar').classList.toggle('is-plain', ui.view !== 'cards');
  const v = $('#view');
  v.innerHTML = '';
  if (ui.view === 'cards') renderCards(v);
  else if (ui.view === 'collection') renderCollection(v);
  else if (ui.view === 'decks') renderStub(v, 'Decks', 'Deck builder comes next: Oshi + 50-card main deck + 20 cheer, with live legality checks and an export you can paste into Deck Log.');
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
  a.appendChild(el('span', 'card__badge' + (n ? '' : ' card__badge--zero'), n ? '×' + n : '0'));
  a.addEventListener('click', () => openCard(v.card, v.id));
  return a;
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
    row.appendChild(el('span', 'setrow__id', e.set));
    const bar = el('span', 'setrow__bar');
    const i = document.createElement('i');
    i.style.width = (e.total ? e.have / e.total * 100 : 0) + '%';
    bar.appendChild(i);
    row.appendChild(bar);
    row.appendChild(el('span', 'setrow__n', e.have + '/' + e.total));
    row.addEventListener('click', () => {
      D.clearFilters();
      D.filters.sets.add(e.set);
      document.querySelector('.tab[data-view="cards"]').click();
    });
    list.appendChild(row);
  }
  root.appendChild(list);
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
    panel.appendChild(el('h2', 'sheet__title', 'Filters'));
    group(panel, 'Set', D.state.sets, D.filters.sets, x => x);
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
