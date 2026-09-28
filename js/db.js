// Minimal promise wrapper around IndexedDB.
const NAME = 'holotcg';
const VERSION = 1;

let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'card_number' });
      if (!db.objectStoreNames.contains('owned')) db.createObjectStore('owned');          // variantId -> qty
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export const meta = {
  get: k => tx('meta', 'readonly').then(s => wrap(s.get(k))),
  set: (k, v) => tx('meta', 'readwrite').then(s => wrap(s.put(v, k))),
};

export const cards = {
  all: () => tx('cards', 'readonly').then(s => wrap(s.getAll())),
  count: () => tx('cards', 'readonly').then(s => wrap(s.count())),
  async replaceAll(list) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('cards', 'readwrite');
      const s = t.objectStore('cards');
      s.clear();
      for (const c of list) s.put(c);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  },
};

export const owned = {
  all: () => open().then(db => new Promise((res, rej) => {
    const s = db.transaction('owned', 'readonly').objectStore('owned');
    const out = new Map();
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return res(out);
      out.set(c.key, c.value);
      c.continue();
    };
    req.onerror = () => rej(req.error);
  })),
  set: (id, qty) => tx('owned', 'readwrite').then(s => wrap(qty > 0 ? s.put(qty, id) : s.delete(id))),
  clear: () => tx('owned', 'readwrite').then(s => wrap(s.clear())),
};

export const decks = {
  all: () => tx('decks', 'readonly').then(s => wrap(s.getAll())),
  put: d => tx('decks', 'readwrite').then(s => wrap(s.put(d))),
  del: id => tx('decks', 'readwrite').then(s => wrap(s.delete(id))),
};
