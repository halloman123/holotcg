import * as D from "./data.js";
import * as DK from "./deck.js";
import * as SCAN from "./scan.js";
import * as UPDATE from "./update.js";
import * as PRICE from "./prices.js";
import * as AUTO from "./autodeck.js";
import * as db from "./db.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const ui = {
  view: "cards",
  page: 0,
  pageSize: 60,
  results: [],
  decks: [],
  deckId: null, // open deck in the Decks tab
  picker: null, // deck id being filled from the Cards tab
};

const deckOf = (id) => ui.decks.find((d) => d.id === id);

// ---------------------------------------------------------------- boot
(async function boot() {
  const bar = $("#boot-bar"),
    status = $("#boot-status");
  const prog = (msg, pct) => {
    status.textContent = msg;
    bar.style.width = pct + "%";
  };
  try {
    await D.load(prog);
  } catch (err) {
    prog(err.message + " — retry when online.", 100);
    return;
  }
  ui.decks = await DK.all();
  $("#lang-toggle").textContent = D.state.lang.toUpperCase();
  wire();
  render();
  setTimeout(() => {
    const boot = $("#boot");
    boot.classList.add("is-done");
    setTimeout(() => boot.remove(), 600);
  }, 200);
  UPDATE.start(showUpdateModal);
  PRICE.load()
    .then(() => {
      if (ui.view === "collection") render();
    })
    .catch(() => {});
})();

// ---------------------------------------------------------------- wiring
function wire() {
  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      document
        .querySelectorAll(".tab")
        .forEach((x) => x.classList.toggle("is-active", x === b));
      if (ui.view === "scan" && b.dataset.view !== "scan") stopScan();
      if (b.dataset.view !== "decks" || (ui.view === "decks" && ui.deckId))
        ui.deckId = null;
      ui.view = b.dataset.view;
      ui.page = 0;
      window.scrollTo(0, 0);
      render();
    }),
  );

  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      D.filters.q = e.target.value;
      ui.page = 0;
      render();
    }, 180);
  });

  $("#lang-toggle").addEventListener("click", () => {
    D.setLang(D.state.lang === "en" ? "jp" : "en");
    $("#lang-toggle").textContent = D.state.lang.toUpperCase();
    render();
  });

  $("#sync-btn").addEventListener("click", async () => {
    toast("Refreshing card data…");
    try {
      const n = await D.refresh();
      toast(n + " cards updated");
      render();
    } catch {
      toast("Refresh failed — offline?");
    }
  });

  $("#howto-btn").addEventListener("click", openHowTo);
  $("#filter-btn").addEventListener("click", openFilters);
  $("#sheet").addEventListener("click", (e) => {
    if (e.target.dataset.close !== undefined) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet").hidden) closeSheet();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (ui.view !== "cards") return;
      if (
        window.innerHeight + window.scrollY >
        document.body.offsetHeight - 900
      )
        growPage();
    },
    { passive: true },
  );
}

// ---------------------------------------------------------------- render
function render() {
  const titles = {
    cards: "Cards",
    collection: "Collection",
    decks: "Decks",
    scan: "Scan",
  };
  const openDeck = ui.view === "decks" ? deckOf(ui.deckId) : null;
  $("#view-title").textContent = openDeck ? openDeck.name : titles[ui.view];
  $("#topbar").classList.toggle("is-plain", ui.view !== "cards");
  const v = $("#view");
  v.innerHTML = "";
  if (ui.view === "cards") renderCards(v);
  else if (ui.view === "collection") renderCollection(v);
  else if (ui.view === "decks") {
    const d = deckOf(ui.deckId);
    d ? renderDeckEditor(v, d) : renderDeckList(v);
  } else renderScan(v);
  renderQuickbar();
}

function renderQuickbar() {
  const q = $("#quickbar");
  q.innerHTML = "";
  if (ui.view !== "cards") return;
  const modes = [
    ["all", "All"],
    ["owned", "Owned"],
    ["missing", "Missing"],
  ];
  for (const [val, label] of modes) {
    const b = el(
      "button",
      "chip" + (D.filters.owned === val ? " is-on" : ""),
      label,
    );
    b.type = "button";
    b.addEventListener("click", () => {
      D.filters.owned = val;
      ui.page = 0;
      render();
    });
    q.appendChild(b);
  }
  for (const c of D.COLOR_LIST) {
    const b = el(
      "button",
      "chip" + (D.filters.colors.has(c) ? " is-on" : ""),
      cap(c),
    );
    b.type = "button";
    b.addEventListener("click", () => {
      toggle(D.filters.colors, c);
      ui.page = 0;
      render();
    });
    q.appendChild(b);
  }
  const n = D.activeFilterCount();
  const badge = $("#filter-count");
  badge.hidden = n === 0;
  badge.textContent = n;
  $("#filter-btn").classList.toggle("is-on", n > 0);
}

function renderCards(root) {
  if (ui.picker) {
    const d = deckOf(ui.picker);
    if (d) {
      const bar = el("div", "picker");
      const txt = el("div", "picker__txt");
      const val = DK.validate(d);
      txt.appendChild(el("strong", null, "Adding to " + d.name));
      txt.appendChild(
        el(
          "span",
          null,
          "Deck " +
            val.main +
            "/" +
            DK.MAIN_SIZE +
            " · Cheer " +
            val.cheer +
            "/" +
            DK.CHEER_SIZE +
            (d.oshi ? " · Oshi set" : " · no Oshi"),
        ),
      );
      bar.appendChild(txt);
      const done = el("button", "btn btn--primary picker__done", "Done");
      done.type = "button";
      done.addEventListener("click", () => {
        ui.deckId = ui.picker;
        ui.picker = null;
        document.querySelector('.tab[data-view="decks"]').click();
      });
      bar.appendChild(done);
      root.appendChild(bar);
    } else ui.picker = null;
  }
  ui.results = D.queryVariants();
  const note = el(
    "p",
    "view__note",
    ui.results.length.toLocaleString() +
      " of " +
      D.state.variants.length.toLocaleString() +
      " prints · " +
      D.state.cards.length.toLocaleString() +
      " unique cards",
  );
  root.appendChild(note);
  if (!ui.results.length) {
    root.appendChild(
      el("div", "view__empty", "Nothing matches those filters."),
    );
    return;
  }
  const grid = el("div", "grid");
  grid.id = "grid";
  root.appendChild(grid);
  ui.page = 0;
  appendTiles(grid, 0, ui.pageSize);
}

function growPage() {
  const grid = $("#grid");
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
  const a = el("button", "card" + (n ? "" : " is-unowned"));
  a.type = "button";
  a.dataset.vid = v.id;
  const img = el("img", "card__img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = D.t(v.card.name) + " " + v.rarity;
  img.src = D.imgUrl(v.ill);
  a.appendChild(img);
  a.appendChild(el("span", "card__rar", v.rarity));
  if (ui.picker) {
    const d = deckOf(ui.picker);
    const pile = DK.pileOf(v.card);
    const inDeck =
      pile === "oshi"
        ? d && d.oshi === v.id
          ? 1
          : 0
        : (d && d[pile][v.id]) || 0;
    a.appendChild(
      el(
        "span",
        "card__badge" + (inDeck ? " card__badge--deck" : " card__badge--zero"),
        inDeck ? "+" + inDeck : "+",
      ),
    );
    a.addEventListener("click", () => addFromPicker(v));
  } else {
    a.appendChild(
      el(
        "span",
        "card__badge" + (n ? "" : " card__badge--zero"),
        n ? "×" + n : "0",
      ),
    );
    a.addEventListener("click", () => openCard(v.card, v.id));
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
  const inDeck = pile === "oshi" ? 1 : d[pile][v.id];
  const tileEl = document.querySelector(
    '.card[data-vid="' + CSS.escape(v.id) + '"]',
  );
  if (tileEl) {
    const b = tileEl.querySelector(".card__badge");
    b.className = "card__badge card__badge--deck";
    b.textContent = "+" + inDeck;
  }
  if (pile === "oshi") {
    document.querySelectorAll(".card__badge--deck").forEach((b) => {
      if (!tileEl || b !== tileEl.querySelector(".card__badge")) {
        b.className = "card__badge card__badge--zero";
        b.textContent = "+";
      }
    });
  }
  const val = DK.validate(d);
  const sub = document.querySelector(".picker__txt span");
  if (sub)
    sub.textContent =
      "Deck " +
      val.main +
      "/" +
      DK.MAIN_SIZE +
      " · Cheer " +
      val.cheer +
      "/" +
      DK.CHEER_SIZE +
      (d.oshi ? " · Oshi set" : " · no Oshi");
  toast(
    (pile === "oshi" ? "Oshi: " : "+ ") +
      D.t(v.card.name) +
      (pile === "oshi" ? "" : " (" + inDeck + ")"),
  );
}

function renderCollection(root) {
  const s = D.collectionStats();
  const stats = el("div", "stats");
  const add = (n, l) => {
    const d = el("div", "stat");
    d.appendChild(el("div", "stat__n", n));
    d.appendChild(el("div", "stat__l", l));
    stats.appendChild(d);
  };
  add(s.copies.toLocaleString(), "Cards owned");
  add(s.uniq.toLocaleString(), "Unique prints");
  add(Math.round((s.uniq / s.totalVariants) * 100) + "%", "Of all prints");
  root.appendChild(stats);

  renderValue(root, s);

  root.appendChild(el("h2", "sheet__h", "Completion by set"));
  const list = el("div", "setlist");
  for (const e of s.perSet) {
    const row = el("button", "setrow");
    row.type = "button";
    const top = el("div", "setrow__top");
    top.appendChild(el("span", "setrow__name", D.setName(e.set, D.state.lang)));
    top.appendChild(el("span", "setrow__n", e.have + "/" + e.total));
    row.appendChild(top);
    const sub = el("div", "setrow__sub");
    sub.appendChild(el("span", "setrow__id", e.set));
    const sv = setValue(e.set);
    if (sv != null && sv > 0)
      sub.appendChild(
        el(
          "span",
          "setrow__val",
          PRICE.format(sv, PRICE.settings.currency, { whole: true }),
        ),
      );
    const kind = D.setKind(e.set);
    if (kind) sub.appendChild(el("span", null, kind));
    if (D.isUnreleased(e.set))
      sub.appendChild(el("span", "tagjp", "unreleased"));
    else if (D.isJpOnly(e.set)) sub.appendChild(el("span", "tagjp", "JP only"));
    row.appendChild(sub);
    const bar = el("span", "setrow__bar");
    const i = document.createElement("i");
    i.style.width = (e.total ? (e.have / e.total) * 100 : 0) + "%";
    bar.appendChild(i);
    row.appendChild(bar);
    row.addEventListener("click", () => {
      D.clearFilters();
      D.filters.sets.add(e.set);
      document.querySelector('.tab[data-view="cards"]').click();
    });
    list.appendChild(row);
  }
  root.appendChild(list);
}

// ---------------------------------------------------------------- scan
let scanStream = null;
let scanBusy = false;

function stopScan() {
  SCAN.stopCamera(scanStream);
  scanStream = null;
}

function renderScan(root) {
  const wrap = el("div", "scan");

  const stage = el("div", "scan__stage");
  const video = document.createElement("video");
  video.className = "scan__video";
  video.playsInline = true;
  video.muted = true;
  stage.appendChild(video);
  const guide = el("div", "scan__guide");
  guide.appendChild(el("div", "scan__guidebox"));
  stage.appendChild(guide);
  const hint = el(
    "p",
    "scan__hint",
    "Fill the frame with one card, straight on, in even light.",
  );
  stage.appendChild(hint);
  wrap.appendChild(stage);

  const bar = el("div", "scan__bar");
  const shutter = el("button", "btn btn--primary", "Start camera");
  shutter.type = "button";
  const pick = el("button", "btn", "Use a photo");
  pick.type = "button";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  pick.addEventListener("click", () => file.click());
  bar.append(shutter, pick, file);
  wrap.appendChild(bar);

  const status = el("p", "scan__status", "");
  wrap.appendChild(status);
  root.appendChild(wrap);

  const setStatus = (msg, kind) => {
    status.textContent = msg || "";
    status.className = "scan__status" + (kind ? " is-" + kind : "");
  };

  SCAN.loadIndex((m) => setStatus(m))
    .then((ix) => {
      const behind = D.state.cards.length - (ix.cards || 0);
      setStatus(
        ix.count.toLocaleString() +
          " card images indexed · matching runs on this device" +
          (behind > 0
            ? " · " + behind + " newer cards are not in the index yet"
            : ""),
      );
    })
    .catch((err) => setStatus(err.message, "err"));

  shutter.addEventListener("click", async () => {
    if (!scanStream) {
      try {
        setStatus("Starting camera…");
        scanStream = await SCAN.startCamera(video);
        stage.classList.add("is-live");
        shutter.textContent = "Scan card";
        setStatus("");
      } catch (err) {
        setStatus(cameraError(err), "err");
      }
      return;
    }
    if (scanBusy) return;
    scanBusy = true;
    try {
      const view = video.getBoundingClientRect();
      const box = guide
        .querySelector(".scan__guidebox")
        .getBoundingClientRect();
      const rect = SCAN.guideToSource(video, view, box);
      if (!rect) {
        setStatus("Camera not ready yet", "err");
        return;
      }
      await showMatches(SCAN.scanFrame(video, rect), setStatus);
    } finally {
      scanBusy = false;
    }
  });

  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    setStatus("Reading photo…");
    try {
      const bmp = await createImageBitmap(f);
      const fp = SCAN.scanFrame(bmp, SCAN.centreCrop(bmp));
      bmp.close();
      await showMatches(fp, setStatus);
    } catch {
      setStatus("Could not read that image", "err");
    }
    file.value = "";
  });
}

function cameraError(err) {
  const n = err && err.name;
  if (n === "NotAllowedError")
    return "Camera access was blocked. Allow it for this site, then try again.";
  if (n === "NotFoundError")
    return "No camera on this device — use a photo instead.";
  if (n === "NotReadableError") return "The camera is in use by another app.";
  if (location.protocol !== "https:" && location.hostname !== "localhost")
    return "The camera needs HTTPS.";
  return "Camera failed: " + ((err && err.message) || "unknown error");
}

async function showMatches(fp, setStatus) {
  try {
    await SCAN.loadIndex();
  } catch (err) {
    return setStatus(err.message, "err");
  }
  const cards = SCAN.matchCards(fp, 4);
  if (!cards.length) return setStatus("No match found", "err");
  setStatus("");

  openSheet((panel) => {
    const top = cards[0];
    panel.appendChild(el("h2", "sheet__title", D.t(top.card.name)));
    panel.appendChild(
      el(
        "p",
        "sheet__sub",
        top.card.card_number + " · " + D.setName(top.card._set, D.state.lang),
      ),
    );
    panel.appendChild(
      el(
        "p",
        "verdict verdict--" + top.confidence,
        top.confidence === "certain"
          ? "Confident match"
          : top.confidence === "likely"
            ? "Probably this card"
            : top.confidence === "maybe"
              ? "Uncertain — check the alternatives below"
              : "Weak match — try again with better light",
      ),
    );

    panel.appendChild(el("h3", "sheet__h", "Which print?"));
    panel.appendChild(
      el(
        "p",
        "fgroup__note",
        "Parallel rarities share the same art, so pick the one in your hand.",
      ),
    );
    for (const p of top.prints) renderScanPrint(panel, p);

    if (cards.length > 1) {
      panel.appendChild(el("h3", "sheet__h", "Or was it one of these?"));
      for (const c of cards.slice(1)) {
        const row = el("button", "altcard");
        row.type = "button";
        const img = el("img", "art__img");
        img.loading = "lazy";
        img.src = D.imgUrl(c.prints[0].variant.ill);
        img.alt = "";
        row.appendChild(img);
        const m = el("div", "art__main");
        m.appendChild(el("div", "art__name", D.t(c.card.name)));
        m.appendChild(
          el(
            "div",
            "art__by",
            c.card.card_number + " · " + D.setName(c.card._set, D.state.lang),
          ),
        );
        row.appendChild(m);
        row.appendChild(meterEl(c.dist, c.confidence));
        row.addEventListener("click", () => {
          closeSheet();
          openCard(c.card, c.prints[0].variant.id);
        });
        panel.appendChild(row);
      }
    }

    const foot = el("div", "sheet__foot");
    const again = el("button", "btn btn--primary", "Scan another");
    again.type = "button";
    again.addEventListener("click", closeSheet);
    foot.appendChild(again);
    panel.appendChild(foot);
  });
}

function meterEl(dist, conf) {
  const meter = el("div", "meter");
  const fill = document.createElement("i");
  fill.style.width = Math.max(3, Math.round((1 - dist / 0.4) * 100)) + "%";
  fill.className = "is-" + conf;
  meter.appendChild(fill);
  meter.title = "distance " + dist.toFixed(3);
  return meter;
}

function renderScanPrint(panel, p) {
  const v = p.variant;
  const row = el("div", "art");
  const thumb = el("img", "art__img");
  thumb.loading = "lazy";
  thumb.src = D.imgUrl(v.ill);
  thumb.alt = "";
  thumb.addEventListener("click", () => {
    closeSheet();
    openCard(v.card, v.id);
  });
  row.appendChild(thumb);

  const main = el("div", "art__main");
  main.appendChild(
    el(
      "div",
      "art__name",
      v.rarity + (v.illustrator ? " · " + v.illustrator : ""),
    ),
  );
  main.appendChild(el("div", "art__by", "you own " + D.qty(v.id)));
  main.appendChild(meterEl(p.dist, p.confidence));
  row.appendChild(main);

  const acts = el("div", "scanacts");
  const own = el("button", "chip", "+1 owned");
  own.type = "button";
  own.addEventListener("click", async () => {
    const n = await D.setQty(v.id, D.qty(v.id) + 1);
    own.textContent = "✓ " + n;
    own.classList.add("is-on");
    main.querySelector(".art__by").textContent = "you own " + n;
  });
  acts.appendChild(own);
  const deck = deckOf(ui.picker || ui.deckId);
  if (deck) {
    const add = el("button", "chip", "+ deck");
    add.type = "button";
    add.addEventListener("click", async () => {
      const err = DK.change(deck, v.id, 1);
      if (err) return toast(err);
      await DK.save(deck);
      add.textContent = "✓ added";
      add.classList.add("is-on");
    });
    acts.appendChild(add);
  }
  row.appendChild(acts);
  panel.appendChild(row);
}

function setValue(set) {
  if (!PRICE.loaded()) return null;
  let total = 0;
  for (const [vid, qty] of D.state.owned) {
    if (vid.split("-")[0] !== set) continue;
    const p = PRICE.priceOf(vid);
    if (p && !p.unconverted) total += p.amount * qty;
  }
  return total;
}

function renderValue(root, stats) {
  const box = el("section", "value");
  root.appendChild(box);

  if (!PRICE.loaded()) {
    box.appendChild(el("div", "value__head", "Collection value"));
    const note = el("p", "value__note", "Loading prices…");
    box.appendChild(note);
    PRICE.load()
      .then(() => render())
      .catch((err) => {
        note.textContent = err.message;
        note.classList.add("is-err");
      });
    return;
  }

  const v = PRICE.collectionValue();
  const head = el("div", "value__head");
  head.appendChild(el("span", null, "Collection value"));
  const cfg = el(
    "button",
    "value__cfg",
    PRICE.settings.currency + " · " + srcLabel(PRICE.settings.source),
  );
  cfg.type = "button";
  cfg.addEventListener("click", openPriceSettings);
  head.appendChild(cfg);
  box.appendChild(head);

  box.appendChild(
    el(
      "div",
      "value__total",
      PRICE.format(v.total, v.currency, { whole: true }),
    ),
  );

  const bits = [];
  bits.push(
    v.priced.toLocaleString() +
      " of " +
      v.copies.toLocaleString() +
      " cards priced",
  );
  if (v.unpriced) bits.push(v.unpriced.toLocaleString() + " without a price");
  const at = PRICE.dataDate();
  if (at) bits.push("as of " + new Date(at).toLocaleDateString());
  box.appendChild(el("p", "value__note", bits.join(" · ")));
  box.appendChild(
    el(
      "p",
      "value__note",
      "Shop listing prices from TCGplayer and Yuyu-tei" +
        (PRICE.haveRates() ? ", converted at today’s rate" : "") +
        " — a guide to replacement cost, not an appraisal.",
    ),
  );

  if (v.top.length) {
    box.appendChild(el("h3", "sheet__h", "Most valuable"));
    for (const row of v.top.slice(0, 5)) {
      const r = el("button", "valrow");
      r.type = "button";
      const img = el("img", "art__img");
      img.loading = "lazy";
      img.src = D.imgUrl(row.v.ill);
      img.alt = "";
      r.appendChild(img);
      const m = el("div", "art__main");
      m.appendChild(el("div", "art__name", D.t(row.v.card.name)));
      m.appendChild(
        el(
          "div",
          "art__by",
          row.v.card.card_number +
            " · " +
            row.v.rarity +
            (row.qty > 1
              ? " · ×" + row.qty + " @ " + PRICE.format(row.unit)
              : ""),
        ),
      );
      r.appendChild(m);
      r.appendChild(el("span", "valrow__amt", PRICE.format(row.total)));
      r.addEventListener("click", () => openCard(row.v.card, row.vid));
      box.appendChild(r);
    }
  }
}

function srcLabel(s) {
  return s === "tcg" ? "TCGplayer" : s === "yuyu" ? "Yuyu-tei" : "Auto";
}

function openPriceSettings() {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "Prices"));

    const g1 = el("div", "fgroup");
    g1.appendChild(el("h3", "fgroup__h", "Show values in"));
    const r1 = el("div", "fgroup__row");
    for (const c of Object.keys(PRICE.CURRENCIES)) {
      const b = el(
        "button",
        "chip" + (PRICE.settings.currency === c ? " is-on" : ""),
        c,
      );
      b.type = "button";
      b.addEventListener("click", () => {
        PRICE.setCurrency(c);
        r1.querySelectorAll(".chip").forEach((x) =>
          x.classList.toggle("is-on", x === b),
        );
      });
      r1.appendChild(b);
    }
    g1.appendChild(r1);
    if (!PRICE.haveRates())
      g1.appendChild(
        el(
          "p",
          "fgroup__note",
          "No exchange rate yet — prices stay in their own currency until you are online.",
        ),
      );
    panel.appendChild(g1);

    const g2 = el("div", "fgroup");
    g2.appendChild(el("h3", "fgroup__h", "Price source"));
    const r2 = el("div", "fgroup__row");
    for (const [val, label] of [
      ["auto", "Auto"],
      ["tcg", "TCGplayer"],
      ["yuyu", "Yuyu-tei"],
    ]) {
      const b = el(
        "button",
        "chip" + (PRICE.settings.source === val ? " is-on" : ""),
        label,
      );
      b.type = "button";
      b.addEventListener("click", () => {
        PRICE.setSource(val);
        r2.querySelectorAll(".chip").forEach((x) =>
          x.classList.toggle("is-on", x === b),
        );
      });
      r2.appendChild(b);
    }
    g2.appendChild(r2);
    g2.appendChild(
      el(
        "p",
        "fgroup__note",
        "Auto prefers TCGplayer (US marketplace, dollars) and falls back to Yuyu-tei (Japanese shop, yen). " +
          "Yuyu-tei covers more prints; TCGplayer matches the English cards more closely.",
      ),
    );
    panel.appendChild(g2);

    const foot = el("div", "sheet__foot");
    const done = el("button", "btn btn--primary", "Done");
    done.type = "button";
    done.addEventListener("click", () => {
      closeSheet();
      render();
    });
    foot.appendChild(done);
    panel.appendChild(foot);
  });
}

// ---------------------------------------------------------------- decks
function renderDeckList(root) {
  const head = el("div", "deckhead");
  const mk = el("button", "btn btn--primary", "+ New deck");
  mk.type = "button";
  mk.addEventListener("click", async () => {
    const d = DK.blank("Deck " + (ui.decks.length + 1));
    await DK.save(d);
    ui.decks.push(d);
    ui.deckId = d.id;
    render();
  });
  const auto = el("button", "btn", "\u2728 Build");
  auto.type = "button";
  auto.addEventListener("click", openAutoBuild);
  const imp = el("button", "btn", "Import");
  imp.type = "button";
  imp.addEventListener("click", openImport);
  head.append(mk, auto, imp);
  root.appendChild(head);

  if (!ui.decks.length) {
    root.appendChild(
      el(
        "div",
        "view__empty",
        "No decks yet. A deck is 1 Oshi, exactly 50 main-deck cards and exactly 20 cheer.",
      ),
    );
    return;
  }

  const list = el("div", "decklist");
  for (const d of [...ui.decks].sort((a, b) => b.updated - a.updated)) {
    const val = DK.validate(d);
    const row = el("button", "deckcard");
    row.type = "button";
    const o = D.state.byVariant.get(d.oshi);
    const thumb = el("div", "deckcard__thumb");
    if (o) {
      const i = el("img");
      i.loading = "lazy";
      i.src = D.imgUrl(o.ill);
      i.alt = "";
      thumb.appendChild(i);
    } else thumb.appendChild(el("span", "deckcard__ph", "?"));
    row.appendChild(thumb);
    const body = el("div", "deckcard__body");
    body.appendChild(el("div", "deckcard__name", d.name));
    body.appendChild(
      el(
        "div",
        "deckcard__meta",
        (o ? D.t(o.card.name) : "No Oshi") +
          " · " +
          val.main +
          "/" +
          DK.MAIN_SIZE +
          " · " +
          val.cheer +
          "/" +
          DK.CHEER_SIZE,
      ),
    );
    row.appendChild(body);
    row.appendChild(
      el(
        "span",
        "dotstate " + (val.legal ? "is-ok" : "is-bad"),
        val.legal ? "✓" : String(val.errors.length),
      ),
    );
    row.addEventListener("click", () => {
      ui.deckId = d.id;
      window.scrollTo(0, 0);
      render();
    });
    list.appendChild(row);
  }
  root.appendChild(list);
}

function renderDeckEditor(root, d) {
  const val = DK.validate(d);

  const back = el("button", "backlink", "\u2039 All decks");
  back.type = "button";
  back.addEventListener("click", () => {
    ui.deckId = null;
    window.scrollTo(0, 0);
    render();
  });
  root.appendChild(back);

  const bar = el("div", "deckbar");
  for (const [label, have, want] of [
    ["Oshi", d.oshi ? 1 : 0, 1],
    ["Deck", val.main, DK.MAIN_SIZE],
    ["Cheer", val.cheer, DK.CHEER_SIZE],
  ]) {
    const c = el("div", "deckbar__cell" + (have === want ? " is-ok" : ""));
    c.appendChild(el("span", "deckbar__n", have + "/" + want));
    c.appendChild(el("span", "deckbar__l", label));
    bar.appendChild(c);
  }
  root.appendChild(bar);

  if (d.auto && d.auto.notes && d.auto.notes.length) {
    const box = el("div", "checks");
    box.appendChild(
      el(
        "div",
        "checks__row checks__row--warn",
        "\u2728 Built from your collection:",
      ),
    );
    for (const n of d.auto.notes)
      box.appendChild(el("div", "checks__row", "\u00b7 " + n));
    root.appendChild(box);
  }

  if (PRICE.loaded()) {
    const dv = PRICE.deckValue(d);
    if (dv.total > 0) {
      const line = el(
        "p",
        "view__note",
        "Deck value " +
          PRICE.format(dv.total) +
          (dv.unpriced ? " · " + dv.unpriced + " cards without a price" : ""),
      );
      root.appendChild(line);
    }
  }

  const acts = el("div", "deckhead");
  const add = el("button", "btn btn--primary", "+ Add cards");
  add.type = "button";
  add.addEventListener("click", () => {
    ui.picker = d.id;
    document.querySelector('.tab[data-view="cards"]').click();
  });
  const more = el("button", "btn", "⋯");
  more.type = "button";
  more.addEventListener("click", () => openDeckMenu(d));
  acts.append(add, more);
  root.appendChild(acts);

  if (val.errors.length || val.warnings.length) {
    const box = el("div", "checks");
    for (const e of val.errors)
      box.appendChild(el("div", "checks__row checks__row--err", "✕ " + e));
    for (const w of val.warnings)
      box.appendChild(el("div", "checks__row checks__row--warn", "! " + w));
    root.appendChild(box);
  } else {
    root.appendChild(el("div", "checks checks--ok", "✓ Legal deck"));
  }

  // oshi
  root.appendChild(el("h2", "sheet__h", "Oshi holomem"));
  const o = D.state.byVariant.get(d.oshi);
  if (o) root.appendChild(deckRow(d, { vid: d.oshi, n: 1, v: o }, "oshi"));
  else
    root.appendChild(
      el(
        "div",
        "view__note",
        "Pick one from Add cards — Oshi cards are the ones with a LIFE value.",
      ),
    );

  // main deck grouped
  const groups = [
    ["Holomem — Debut", (e) => e.v.card.bloom_level === "debut"],
    ["Holomem — 1st Bloom", (e) => e.v.card.bloom_level === "first"],
    ["Holomem — 2nd Bloom", (e) => e.v.card.bloom_level === "second"],
    ["Holomem — Spot", (e) => e.v.card.bloom_level === "spot"],
    ["Support", (e) => e.v.card._type.startsWith("support")],
  ];
  const mainEntries = DK.entries(d.main);
  const shown = new Set();
  root.appendChild(
    el("h2", "sheet__h", "Main deck · " + val.main + "/" + DK.MAIN_SIZE),
  );
  for (const [title, test] of groups) {
    const rows = mainEntries.filter((e) => !shown.has(e.vid) && test(e));
    if (!rows.length) continue;
    rows.forEach((e) => shown.add(e.vid));
    const n = rows.reduce((a, e) => a + e.n, 0);
    root.appendChild(el("h3", "deckgroup", title + " (" + n + ")"));
    for (const e of rows) root.appendChild(deckRow(d, e, "main"));
  }
  const rest = mainEntries.filter((e) => !shown.has(e.vid));
  if (rest.length) {
    root.appendChild(
      el(
        "h3",
        "deckgroup",
        "Other (" + rest.reduce((a, e) => a + e.n, 0) + ")",
      ),
    );
    for (const e of rest) root.appendChild(deckRow(d, e, "main"));
  }
  if (!mainEntries.length) root.appendChild(el("div", "view__note", "Empty."));

  // cheer
  root.appendChild(
    el("h2", "sheet__h", "Cheer deck · " + val.cheer + "/" + DK.CHEER_SIZE),
  );
  const cheerEntries = DK.entries(d.cheer);
  for (const e of cheerEntries) root.appendChild(deckRow(d, e, "cheer"));
  if (!cheerEntries.length) root.appendChild(el("div", "view__note", "Empty."));

  // stats
  const st = DK.stats(d);
  if (val.main || val.cheer) {
    root.appendChild(el("h2", "sheet__h", "Mix"));
    root.appendChild(barRow("Deck colours", st.colors));
    root.appendChild(barRow("Cheer colours", st.cheerColors));
  }
}

function barRow(title, map) {
  const wrap = el("div", "mix");
  wrap.appendChild(el("div", "mix__h", title));
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  if (!total) {
    wrap.appendChild(el("div", "view__note", "—"));
    return wrap;
  }
  const bar = el("div", "mix__bar");
  for (const [c, n] of [...map].sort((a, b) => b[1] - a[1])) {
    const seg = el("i");
    seg.style.width = (n / total) * 100 + "%";
    seg.style.background = colorHex(c);
    seg.title = c + " " + n;
    bar.appendChild(seg);
  }
  wrap.appendChild(bar);
  const legend = el("div", "mix__legend");
  for (const [c, n] of [...map].sort((a, b) => b[1] - a[1])) {
    const t = el("span", "mix__tag");
    const dot = el("i");
    dot.style.background = colorHex(c);
    t.append(dot, document.createTextNode(cap(c) + " " + n));
    legend.appendChild(t);
  }
  wrap.appendChild(legend);
  return wrap;
}

function deckRow(d, e, pile) {
  const row = el("div", "art");
  const thumb = el("img", "art__img");
  thumb.loading = "lazy";
  thumb.src = D.imgUrl(e.v.ill);
  thumb.alt = "";
  thumb.addEventListener("click", () => openCard(e.v.card, e.vid));
  row.appendChild(thumb);
  const main = el("div", "art__main");
  main.appendChild(el("div", "art__name", D.t(e.v.card.name)));
  const have = D.qty(e.vid);
  const meta =
    e.v.card.card_number +
    " · " +
    e.v.rarity +
    " · " +
    D.setName(e.v.card._set, D.state.lang) +
    (have < e.n ? " · you own " + have : "");
  const sub = el("div", "art__by", meta);
  if (have < e.n) sub.classList.add("is-short");
  main.appendChild(sub);
  row.appendChild(main);

  const box = el("div", "stepper");
  const minus = el("button", null, "−");
  minus.type = "button";
  const out = document.createElement("output");
  out.textContent = e.n;
  const plus = el("button", null, "+");
  plus.type = "button";
  const bump = async (delta) => {
    const err = DK.change(d, e.vid, delta);
    if (err) return toast(err);
    await DK.save(d);
    render();
  };
  minus.addEventListener("click", () => bump(-1));
  plus.addEventListener("click", () => bump(1));
  if (pile === "oshi") {
    box.append(minus);
  } else {
    box.append(minus, out, plus);
  }
  row.appendChild(box);
  return row;
}

function openDeckMenu(d) {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "Deck"));

    const nameWrap = el("div", "fgroup");
    nameWrap.appendChild(el("h3", "fgroup__h", "Name"));
    const input = el("input", "search");
    input.value = d.name;
    input.addEventListener("change", async () => {
      d.name = input.value.trim() || "Untitled deck";
      await DK.save(d);
      render();
    });
    nameWrap.appendChild(input);
    panel.appendChild(nameWrap);

    panel.appendChild(el("h3", "sheet__h", "Export"));
    const hd = JSON.stringify(DK.toHoloDelta(d));
    panel.appendChild(
      exportRow(
        "holoDelta JSON",
        "Opens in holoDelta, and in the hOCG Deck Converter for Deck Log, proxy sheets and Tabletop Sim.",
        hd,
        d.name + ".holodelta.json",
      ),
    );
    panel.appendChild(
      exportRow(
        "Plain text list",
        "A readable decklist to paste anywhere.",
        DK.toText(d),
        d.name + ".txt",
      ),
    );

    panel.appendChild(el("h3", "sheet__h", "Danger zone"));
    const del = el("button", "btn btn--danger", "Delete this deck");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.textContent = "Tap again to delete";
        return;
      }
      await DK.remove(d.id);
      ui.decks = ui.decks.filter((x) => x.id !== d.id);
      ui.deckId = null;
      closeSheet();
      render();
    });
    panel.appendChild(del);
  });
}

function exportRow(title, hint, text, filename) {
  const box = el("div", "ability");
  box.appendChild(el("div", "ability__name", title));
  box.appendChild(el("p", "ability__txt", hint));
  const row = el("div", "fgroup__row");
  const copy = el("button", "chip", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Clipboard blocked — use Download");
    }
  });
  const dl = el("button", "chip", "Download");
  dl.type = "button";
  dl.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  row.append(copy, dl);
  box.appendChild(row);
  return box;
}

function openAutoBuild() {
  const oshis = AUTO.ownedOshi();
  const colors = AUTO.ownedColors();

  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "Build a deck"));
    panel.appendChild(el("p", "sheet__sub", "From cards you own"));

    if (!oshis.length) {
      panel.appendChild(
        el(
          "p",
          "fgroup__note",
          "Every deck needs an Oshi holomem, and there is not one in your collection yet. " +
            "Scan a few cards or mark them owned, then come back.",
        ),
      );
      return;
    }

    let seed = { kind: "random" };
    const runBtn = el("button", "btn btn--primary", "Build it");

    const mark = (row, btn) =>
      row
        .querySelectorAll(".chip")
        .forEach((x) => x.classList.toggle("is-on", x === btn));

    // around an Oshi
    const g1 = el("div", "fgroup");
    g1.appendChild(el("h3", "fgroup__h", "Around an Oshi"));
    const r1 = el("div", "fgroup__row");
    for (const e of oshis) {
      const b = el("button", "chip", D.t(e.card.name));
      b.type = "button";
      b.title = e.card.card_number;
      b.addEventListener("click", () => {
        seed = { kind: "oshi", cardNumber: e.card.card_number };
        mark(r1, b);
        mark(r2, null);
        runBtn.textContent = "Build " + D.t(e.card.name);
      });
      r1.appendChild(b);
    }
    g1.appendChild(r1);
    panel.appendChild(g1);

    // around a colour
    const g2 = el("div", "fgroup");
    g2.appendChild(el("h3", "fgroup__h", "Around a colour"));
    const r2 = el("div", "fgroup__row");
    const oshiColors = new Set();
    for (const e of oshis)
      for (const c of e.card.colors || []) oshiColors.add(c);
    for (const { color, count } of colors) {
      if (!oshiColors.has(color)) continue; // no Oshi of that colour = no deck
      const b = el("button", "chip", cap(color));
      b.type = "button";
      b.appendChild(el("span", "chip__tag", String(count)));
      b.addEventListener("click", () => {
        seed = { kind: "color", color };
        mark(r2, b);
        mark(r1, null);
        runBtn.textContent = "Build " + cap(color);
      });
      r2.appendChild(b);
    }
    g2.appendChild(r2);
    if (!r2.children.length)
      g2.appendChild(
        el(
          "p",
          "fgroup__note",
          "Colours appear here once you own an Oshi in them.",
        ),
      );
    panel.appendChild(g2);

    panel.appendChild(
      el(
        "p",
        "fgroup__note",
        "Decks are built from bloom lines — a Debut plus the 1st and 2nd Bloom cards with the same name — " +
          "then support, then cheer matched to what your arts cost. Nothing you do not own is ever added; " +
          "if your collection cannot reach 50 and 20 the deck is still created and tells you what is short.",
      ),
    );

    const foot = el("div", "sheet__foot");
    const dice = el("button", "btn", " Surprise me");
    dice.type = "button";
    dice.addEventListener("click", () => runBuild({ kind: "random" }));
    runBtn.type = "button";
    runBtn.addEventListener("click", () => runBuild(seed));
    foot.append(dice, runBtn);
    panel.appendChild(foot);
  });
}

async function runBuild(seed) {
  let result;
  try {
    result = AUTO.build(seed);
  } catch (err) {
    return toast("Build failed: " + err.message);
  }
  if (!result.deck) return toast(result.report.reason);

  await DK.save(result.deck);
  ui.decks.push(result.deck);
  ui.deckId = result.deck.id;
  closeSheet();
  window.scrollTo(0, 0);
  render();
  toast(
    result.report.complete
      ? "Built a legal deck"
      : "Built what your collection allows",
  );
}

function openImport() {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "Import deck"));
    panel.appendChild(
      el(
        "p",
        "fgroup__note",
        "Paste a holoDelta deck (the JSON with deckName, oshi, deck and cheerDeck), or pick the file.",
      ),
    );
    const ta = document.createElement("textarea");
    ta.className = "ta";
    ta.rows = 6;
    ta.placeholder =
      '{"deckName":"…","oshi":["hBP01-001",0],"deck":[["hBP01-009",4,0]],"cheerDeck":[["hY01-001",10,0]]}';
    panel.appendChild(ta);

    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.className = "filein";
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (f) ta.value = await f.text();
    });
    panel.appendChild(file);

    const foot = el("div", "sheet__foot");
    const go = el("button", "btn btn--primary", "Import");
    go.type = "button";
    go.addEventListener("click", async () => {
      let json;
      try {
        json = JSON.parse(ta.value);
      } catch {
        return toast("That is not valid JSON");
      }
      const { deck, skipped } = DK.fromHoloDelta(json);
      await DK.save(deck);
      ui.decks.push(deck);
      ui.deckId = deck.id;
      closeSheet();
      render();
      toast(
        skipped.length
          ? "Imported, " + skipped.length + " unknown card(s) skipped"
          : "Imported",
      );
    });
    foot.appendChild(go);
    panel.appendChild(foot);
  });
}

// ---------------------------------------------------------------- sheets
function openSheet(build) {
  const panel = $("#sheet-panel");
  panel.innerHTML = "";
  const grab = el("div", "sheet__grab");
  grab.addEventListener("click", closeSheet);
  panel.appendChild(grab);
  const close = el("button", "sheet__close", "\u2715");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeSheet);
  panel.appendChild(close);
  build(panel);
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}

function openCard(card, focusVariantId) {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", D.t(card.name)));
    panel.appendChild(
      el(
        "p",
        "sheet__sub",
        card.card_number +
          " · " +
          D.typeLabel(card._type) +
          (card.bloom_level ? " · " + cap(card.bloom_level) : ""),
      ),
    );
    panel.appendChild(
      el("p", "sheet__set", D.setFullName(card._set, D.state.lang)),
    );

    const focus =
      card._variants.find((v) => v.id === focusVariantId) || card._variants[0];
    const hero = el("div", "detail__hero");
    const img = el("img");
    img.src = D.imgUrl(focus.ill);
    img.alt = D.t(card.name);
    hero.appendChild(img);

    const meta = el("div", "detail__meta");
    for (const c of card.colors || [])
      meta.appendChild(el("span", "pill pill--" + c, cap(c)));
    if (card.hp) meta.appendChild(el("span", "pill", "HP " + card.hp));
    if (card.life) meta.appendChild(el("span", "pill", "LIFE " + card.life));
    if (card.buzz) meta.appendChild(el("span", "pill", "Buzz"));
    if (card.limited) meta.appendChild(el("span", "pill", "LIMITED"));
    if (card.baton_pass && card.baton_pass.length)
      meta.appendChild(el("span", "pill", "Baton " + card.baton_pass.length));
    for (const tg of card._tags) meta.appendChild(el("span", "pill", tg));
    hero.appendChild(meta);
    panel.appendChild(hero);

    // abilities
    const abil = [];
    for (const s of card.oshi_skills || [])
      abil.push({
        name: s.name,
        text: s.text,
        cost: null,
        pow: s.holo_power != null ? "SP " + s.holo_power : "",
      });
    for (const a of card.arts || [])
      abil.push({ name: a.name, text: a.text, cost: a.cheers, pow: a.power });
    for (const k of card.keywords || [])
      abil.push({ name: k.name, text: k.text, cost: null, pow: "" });
    if (card.text)
      abil.push({ name: null, text: card.text, cost: null, pow: "" });
    if (card.extra)
      abil.push({ name: null, text: card.extra, cost: null, pow: "" });

    if (abil.length) {
      panel.appendChild(el("h3", "sheet__h", "Abilities"));
      for (const a of abil) {
        const box = el("div", "ability");
        if (a.name || a.pow) {
          const top = el("div", "ability__top");
          top.appendChild(
            el("span", "ability__name", a.name ? D.t(a.name) : "—"),
          );
          if (a.pow) top.appendChild(el("span", "ability__pow", a.pow));
          box.appendChild(top);
        }
        if (a.cost && a.cost.length) {
          const row = el("div", "ability__cost");
          for (const c of a.cost) {
            const d = el("span", "dot");
            d.style.background = colorHex(c);
            row.appendChild(d);
          }
          box.appendChild(row);
        }
        if (a.text) box.appendChild(el("p", "ability__txt", D.t(a.text)));
        panel.appendChild(box);
      }
    }

    // prints + owned steppers
    panel.appendChild(el("h3", "sheet__h", "Prints you own"));
    for (const v of card._variants) {
      const row = el("div", "art");
      const thumb = el("img", "art__img");
      thumb.loading = "lazy";
      thumb.src = D.imgUrl(v.ill);
      thumb.alt = v.rarity;
      thumb.addEventListener("click", () => {
        img.src = thumb.src;
      });
      row.appendChild(thumb);
      const main = el("div", "art__main");
      main.appendChild(el("div", "art__rar", v.rarity));
      const pr = PRICE.priceOf(v.id);
      const by = [
        v.illustrator || null,
        pr ? PRICE.format(pr.amount, pr.currency) + " · " + pr.source : null,
      ]
        .filter(Boolean)
        .join(" · ");
      main.appendChild(el("div", "art__by", by || "—"));
      row.appendChild(main);
      row.appendChild(stepper(v));
      panel.appendChild(row);
    }
  });
}

function stepper(v) {
  const box = el("div", "stepper");
  const minus = el("button", null, "−");
  minus.type = "button";
  const out = document.createElement("output");
  const plus = el("button", null, "+");
  plus.type = "button";
  out.textContent = D.qty(v.id);
  const bump = async (d) => {
    const n = await D.setQty(v.id, D.qty(v.id) + d);
    out.textContent = n;
    syncTile(v.id, n);
  };
  minus.addEventListener("click", () => bump(-1));
  plus.addEventListener("click", () => bump(1));
  box.append(minus, out, plus);
  return box;
}

function syncTile(vid, n) {
  const tileEl = document.querySelector(
    '.card[data-vid="' + CSS.escape(vid) + '"]',
  );
  if (!tileEl) return;
  tileEl.classList.toggle("is-unowned", n === 0);
  const badge = tileEl.querySelector(".card__badge");
  badge.className = "card__badge" + (n ? "" : " card__badge--zero");
  badge.textContent = n ? "\u00d7" + n : "0";
}

function openFilters() {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "Filters & display"));

    const disp = el("div", "fgroup");
    disp.appendChild(el("h3", "fgroup__h", "Card images"));
    const drow = el("div", "fgroup__row");
    for (const [val, label] of [
      ["auto", "Official scans"],
      ["en", "English + proxies"],
      ["jp", "Japanese only"],
    ]) {
      const b = el(
        "button",
        "chip" + (D.state.imgMode === val ? " is-on" : ""),
        label,
      );
      b.type = "button";
      b.addEventListener("click", () => {
        D.setImgMode(val);
        drow
          .querySelectorAll(".chip")
          .forEach((x) => x.classList.toggle("is-on", x === b));
      });
      drow.appendChild(b);
    }
    disp.appendChild(drow);
    disp.appendChild(
      el(
        "p",
        "fgroup__note",
        "About a quarter of prints have no English release yet, so the dataset only has a fan-made proxy scan for them \u2014 the ones stamped PROXY. Official scans shows the real card in English where it exists and Japanese where it does not. Card text always follows the EN/JP button in the header.",
      ),
    );
    panel.appendChild(disp);

    setGroup(panel);
    group(
      panel,
      "Card type",
      [
        "oshi_holomem",
        "holomem",
        "cheer",
        "support_event",
        "support_item",
        "support_tool",
        "support_mascot",
        "support_fan",
        "support_staff",
      ],
      D.filters.types,
      D.typeLabel,
    );
    group(panel, "Bloom level", D.BLOOMS, D.filters.blooms, cap);
    group(panel, "Rarity", D.state.rarities, D.filters.rarities, (x) => x);
    group(panel, "Tag", D.state.tags, D.filters.tags, (x) => x);

    const foot = el("div", "sheet__foot");
    const clear = el("button", "btn", "Clear all");
    clear.type = "button";
    clear.addEventListener("click", () => {
      D.clearFilters();
      closeSheet();
      ui.page = 0;
      render();
    });
    const done = el("button", "btn btn--primary", "Show results");
    done.type = "button";
    done.addEventListener("click", () => {
      closeSheet();
      ui.page = 0;
      render();
    });
    foot.append(clear, done);
    panel.appendChild(foot);
  });
}

function setGroup(panel) {
  const byKind = new Map();
  for (const code of D.state.sets) {
    const kind = D.setKind(code) || "Other";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(code);
  }
  const order = [
    "Booster Pack",
    "Extra Booster",
    "Start Deck",
    "Live Start Deck",
    "Accessory",
    "Promo",
    "Cheer",
    "Other",
  ];
  for (const kind of order) {
    const codes = byKind.get(kind);
    if (!codes) continue;
    const g = el("div", "fgroup");
    g.appendChild(el("h3", "fgroup__h", kind));
    const row = el("div", "fgroup__row");
    for (const code of codes) {
      const b = el(
        "button",
        "chip" + (D.filters.sets.has(code) ? " is-on" : ""),
        D.setName(code, D.state.lang),
      );
      b.type = "button";
      b.title = code;
      if (D.isUnreleased(code)) b.appendChild(el("span", "chip__tag", "soon"));
      else if (D.isJpOnly(code)) b.appendChild(el("span", "chip__tag", "JP"));
      b.addEventListener("click", () => {
        toggle(D.filters.sets, code);
        b.classList.toggle("is-on", D.filters.sets.has(code));
      });
      row.appendChild(b);
    }
    g.appendChild(row);
    panel.appendChild(g);
  }
}

function group(panel, title, values, set, label) {
  const g = el("div", "fgroup");
  g.appendChild(el("h3", "fgroup__h", title));
  const row = el("div", "fgroup__row");
  for (const v of values) {
    const b = el("button", "chip" + (set.has(v) ? " is-on" : ""), label(v));
    b.type = "button";
    b.addEventListener("click", () => {
      toggle(set, v);
      b.classList.toggle("is-on", set.has(v));
    });
    row.appendChild(b);
  }
  g.appendChild(row);
  panel.appendChild(g);
}

// ---------------------------------------------------------------- how to play
const VIDEO_ID = "_-9QjVI7vcg";

function openHowTo() {
  openSheet((panel) => {
    panel.appendChild(el("h2", "sheet__title", "How to play"));
    panel.appendChild(el("p", "sheet__sub", "hololive OFFICIAL CARD GAME"));

    // video
    panel.appendChild(el("h3", "sheet__h", "Watch"));
    if (navigator.onLine === false) {
      panel.appendChild(
        el(
          "p",
          "fgroup__note",
          "The tutorial video needs a connection. It will appear here when you are back online.",
        ),
      );
    } else {
      const frame = el("div", "video");
      const iframe = document.createElement("iframe");
      iframe.src =
        "https://www.youtube-nocookie.com/embed/" + VIDEO_ID + "?rel=0";
      iframe.title = "How to play the hololive OFFICIAL CARD GAME";
      iframe.loading = "lazy";
      iframe.allow =
        "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);
      panel.appendChild(frame);
    }

    // rule book
    panel.appendChild(el("h3", "sheet__h", "Read"));
    panel.appendChild(
      linkRow(
        "docs/official_rule_book_ver101.pdf",
        "Official Rule Book",
        "PDF · 36 pages · 4 MB",
      ),
    );
    panel.appendChild(
      linkRow(
        "https://en.hololive-official-cardgame.com/wp-content/themes/tcg_en/assets/img/rule/comprehensive_rules_ver150.pdf",
        "Comprehensive Rules",
        "Every edge case, straight from Cover",
      ),
    );
    panel.appendChild(
      linkRow(
        "https://en.hololive-official-cardgame.com/rules/",
        "Rules & Q&A",
        "Official site",
      ),
    );

    // offline quick reference, straight from the rule book
    panel.appendChild(el("h3", "sheet__h", "Quick reference"));

    const setup = el("div", "ability");
    setup.appendChild(el("div", "ability__name", "Setting up"));
    setup.appendChild(
      el(
        "p",
        "ability__txt",
        "1 Oshi holomem face up, a 50-card deck and a 20-card cheer deck, both shuffled face down.\n" +
          "Rock-paper-scissors decides who goes first. Draw 7.\n" +
          "No Debut holomem in hand? You must redraw — and each redraw after the first draws one card fewer.",
      ),
    );
    panel.appendChild(setup);

    const phases = [
      [
        "Reset",
        "Stand your resting holomem. Move the collab holomem back and rest it. No center holomem? Move one back. Skipped on the first turn.",
      ],
      ["Draw", "Draw one card. An empty deck here loses you the game."],
      [
        "Cheer",
        "Reveal the top cheer card and attach it to a holomem. An empty cheer deck is fine — you just skip it.",
      ],
      [
        "Main",
        "Any of these, any number of times, in any order: place a holomem, bloom, collab, use an Oshi skill, play a support card, baton pass.",
      ],
      [
        "Performance",
        "Use the Arts of your center holomem and your collab holomem, in either order.",
      ],
      [
        "End",
        '"During this turn" effects expire. Fill an empty center position, then pass the turn.',
      ],
    ];
    for (const [name, text] of phases) {
      const box = el("div", "ability");
      box.appendChild(el("div", "ability__name", name + " phase"));
      box.appendChild(el("p", "ability__txt", text));
      panel.appendChild(box);
    }

    const win = el("div", "ability");
    win.appendChild(el("div", "ability__name", "You win when"));
    win.appendChild(
      el(
        "p",
        "ability__txt",
        "• your opponent’s life reaches 0, or\n" +
          "• they cannot draw in their draw phase, or\n" +
          "• they have no holomem on stage besides their Oshi.",
      ),
    );
    panel.appendChild(win);

    panel.appendChild(
      el(
        "p",
        "fgroup__note",
        "Deck rules are checked for you in the Decks tab: exactly 1 Oshi, exactly 50 main-deck cards, exactly 20 cheer, at most 4 copies of a card number unless the card says otherwise.",
      ),
    );
  });
}

function linkRow(href, title, sub) {
  const a = document.createElement("a");
  a.className = "linkrow";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  const m = el("div", "linkrow__main");
  m.appendChild(el("div", "art__name", title));
  m.appendChild(el("div", "art__by", sub));
  a.appendChild(m);
  a.appendChild(el("span", "linkrow__go", "↗"));
  return a;
}

// ---------------------------------------------------------------- update prompt
let updateShowing = false;

function showUpdateModal(build) {
  if (updateShowing) return;
  updateShowing = true;

  const wrap = el("div", "modal");
  const scrim = el("div", "modal__scrim");
  wrap.appendChild(scrim);

  const box = el("div", "modal__box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "update-title");
  const h = el("h2", "modal__title", "Update available");
  h.id = "update-title";
  box.appendChild(h);
  box.appendChild(
    el(
      "p",
      "modal__body",
      "A newer version of holoTCG has been published. Your collection and decks are stored on this device, so reloading will not touch them.",
    ),
  );
  box.appendChild(el("p", "modal__meta", "build " + build));

  const acts = el("div", "modal__acts");
  const later = el("button", "btn", "Later");
  later.type = "button";
  const now = el("button", "btn btn--primary", "Reload");
  now.type = "button";
  acts.append(later, now);
  box.appendChild(acts);
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  const close = () => {
    wrap.remove();
    updateShowing = false;
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      UPDATE.snooze(build);
      close();
    }
  };
  document.addEventListener("keydown", onKey);
  later.addEventListener("click", () => {
    UPDATE.snooze(build);
    close();
  });
  scrim.addEventListener("click", () => {
    UPDATE.snooze(build);
    close();
  });
  now.addEventListener("click", async () => {
    now.disabled = true;
    now.textContent = "Reloading…";
    await UPDATE.apply();
  });
  now.focus();
}

// ---------------------------------------------------------------- helpers
function toggle(set, v) {
  set.has(v) ? set.delete(v) : set.add(v);
}
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function colorHex(c) {
  return (
    {
      white: "#f2f2f4",
      green: "#3f9c63",
      red: "#d4485c",
      blue: "#4a86d4",
      purple: "#8a63c9",
      yellow: "#e0b23c",
      colorless: "#6b6b76",
    }[c] || "#6b6b76"
  );
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 2200);
}
