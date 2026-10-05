# holoTCG — collection app

Offline-first PWA for tracking a **hololive OFFICIAL CARD GAME** collection.
No build step, no backend, no accounts. Plain ES modules + IndexedDB + a service worker.

## Status

| Area | State |
|---|---|
| Card browser, search, filters | done |
| Collection tracking (per print) | done |
| Offline / installable | done |
| Deck builder | done |
| Camera scanning | done |
| How to play (video + rule book) | done |
| Collection value | done |
| Automatic deck building | done |
| Collection export / backup | next |

## Running it

Any static server will do — it just needs HTTPS (or `localhost`) for the service worker:

```bash
npx serve .          # or: python3 -m http.server 8000
```

On the phone: open the URL in Chrome/Safari → *Add to home screen*.
First launch downloads ~3.8 MB of card data once; after that it works offline.
Card images are cached as you scroll past them.

## Data

Card data comes from **[hocg-fan-sim-assets](https://github.com/Qrimpuff/hocg-fan-sim-assets)**
(MIT, rebuilt daily from Deck Log + the official site + @ogbajoj's translation sheet):

- `https://qrimpuff.github.io/hocg-fan-sim-assets/hocg_cards.json` — 1,399 cards / 3,176 prints
- `…/img/<path>` — official Japanese scans (every print)
- `…/img_en/<set>/EN_<n>.webp` — official English scans (1,953 prints, 61%)
- `…/img_en/proxies/<path>` — fan-made English proxies, watermarked PROXY (865 prints, 27%),
  for cards with no English release yet — nearly all of hBP07–09, hBD24 and the recent starter decks
- 358 prints have no English image of any kind

**Card images** in Filters & display picks between these:

| Mode | Behaviour |
|---|---|
| `auto` (default) | official English scan where one exists, official Japanese otherwise — never a proxy |
| `en` | English wherever possible, proxies included |
| `jp` | always the Japanese scan |

Text language is a separate control (the EN/JP button in the header) and always uses the dataset's translations.

The ↻ button in the header re-downloads it; the app also refreshes in the background once a day.
Card names, art and text are property of Cover Corp. — this is a personal, non-commercial tool.

## Storage

IndexedDB `holotcg`:

- `cards` — the normalised card list
- `owned` — `variantId → quantity`, where `variantId` is `hBP01-009#j40` (card number + the dataset's stable `manage_id`)
- `decks` — `{id, name, oshi, main:{variantId:qty}, cheer:{variantId:qty}}`
- `meta` — last sync timestamp

Everything is local to the device. Export/import is on the list before the deck builder ships,
so the collection can be backed up.

## Files

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker (shell precache + image cache)
css/app.css             all styling
js/db.js                IndexedDB wrapper
js/data.js              fetch, normalise, index, filter, collection stats
js/sets.js              set/product names, browse order
js/scanhash.js          the image fingerprint — shared by the app and the indexer
js/scan.js              camera, index loading, nearest-neighbour matching
js/update.js            "a new version is live" detection
js/prices.js            price data, currency conversion, collection value
js/deck.js              deck model, legality rules, holoDelta import/export
js/autodeck.js          automatic deck building from owned cards
js/app.js               views, sheets, interaction
icons/                  app icons — icon.svg is the source, the PNGs are generated
docs/                   the official rule book PDF
data/scan-index.bin     4,968 fingerprints, 1.2 MB
data/scan-index.json    ids and metadata for the above
tools/                  index builder and accuracy test (dev only, not shipped)
```

## Deck rules

From the [Comprehensive Rules Ver. 1.5.0](https://en.hololive-official-cardgame.com/wp-content/themes/tcg_en/assets/img/rule/comprehensive_rules_ver150.pdf), §6.1:

- exactly one Oshi holomem (6.1.2)
- main deck exactly 50 cards, no Oshi and no cheer cards (6.1.4.1–6.1.4.2)
- at most 4 copies of a card number (6.1.4.3), unless the card says otherwise (6.1.5) —
  the dataset's `max_amount` carries the real number, so "you may include any number" cards allow 50
- cheer deck exactly 20 cards, cheer type only, unlimited copies (6.1.3)
- **no colour restriction** between the Oshi and the rest of the deck

Beyond the rules the builder also warns about the [restricted list](https://en.hololive-official-cardgame.com/news/post/03/)
(`RESTRICTED` in `js/deck.js` — edit it when Cover updates it), a missing Debut holomem,
cheer colours that no art in the deck can pay for, and cards you do not own.

Decks export as **holoDelta JSON**, which is also what the
[hOCG Deck Converter](https://qrimpuff.github.io/hocg-deck-convert/) reads — that gets you
Deck Log, HoloDuel, Tabletop Simulator, printable proxy sheets and price checks for free.

## Regenerating the icons

`icons/icon.svg` is the source. **Do not rasterise it with ImageMagick** — `convert` here falls
back to MSVG, its own SVG renderer, which silently mangles `transform="rotate(...)"` and puts the
fanned cards in the wrong place. Render with a real browser engine:

```js
// node render.mjs icons/icon.svg icons/icon-master-1024.png
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync(process.argv[2], 'utf8');
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1024, height: 1024 } })).newPage();
await pg.setContent(`<style>html,body{margin:0;background:transparent}svg{width:1024px;height:1024px;display:block}</style>${svg}`);
await pg.screenshot({ path: process.argv[3], omitBackground: true });
await b.close();
```

Then downscale the master to 512/192/180 with Pillow (LANCZOS). The maskable variant is the art at
80% on an opaque `#0d0d11` square; `apple-touch-icon.png` is flattened and square-cornered, since
iOS composites transparency onto black and applies its own mask.

The icon is an original mark — three fanned cards and a cheer star. It deliberately does **not**
use Cover Corp's hololive logo or any official mark: the app is served publicly, and an official
logo on a home screen reads as an officially endorsed app.

## Set names

The card dataset only carries set codes (`hBP01`, `hSD14`, …), so `js/sets.js` maps each one to
its product name:

- English names and release dates from the official
  [English card list](https://en.hololive-official-cardgame.com/cardlist/) — 18 sets
- Japanese names from the [Japanese card list](https://hololive-official-cardgame.com/cardlist/)
- For JP-only Start Decks the English label uses the Oshi's name **as the dataset spells it**
  (`Start Deck – FLOW GLOW Koganei Niko`), so it matches the card rather than a hand transliteration
- `hY01`–`hY06` are not products — they're cheer cards numbered by colour, labelled as such
- `hSD20` / `hSD21` are not announced yet and are tagged `soon`

Sets with no English printing are tagged **JP only**, which is also why their cards show Japanese art
in the default image mode. Set names are searchable, so typing `blooming` or `diva fever` filters
to that set.

Unknown codes fall back to the bare code, so a new set that ships before this file is updated still
works — it just shows as `hBP10` until a row is added.

## Card scanning

Point the camera at a card, line it up with the guide, tap **Scan card**. Everything runs on the
phone — no image is uploaded anywhere. There is also a **Use a photo** button, which centre-crops
the picture to card shape; handy on a desktop, and the only option if the camera is blocked.

### How it works

`js/scanhash.js` reduces any card image to a 256-byte fingerprint:

| Bytes | Component | Why |
|---|---|---|
| 32 | 16×16 horizontal gradient | layout and art structure; differential, so exposure doesn't move it |
| 32 | 16×16 vertical gradient | the other half of the structure |
| 48 | 6×8 luma grid, contrast-stretched | coarse tone, tolerant of small framing errors |
| 144 | 6×8 grid of grey-world-normalised RGB | the strongest signal; normalisation cancels white balance |

`tools/build-scan-index.mjs` fingerprints every official scan — Japanese, plus English where it
exists, skipping proxies since nobody owns one — into `data/scan-index.*`. The indexer runs the
hashing **inside a real browser using the very same module the app uses**, so the index and the
phone can't drift apart. Matching is a linear scan of all 4,968 entries and takes about 7 ms.

The index is fetched once (1.2 MB) and kept in IndexedDB, so scanning works offline.

### Accuracy

`node tools/test-scan-accuracy.mjs 250 --sweep` degrades random official scans the way a hand-held
phone does — crop jitter, rotation, shear, exposure and white-balance shift, sensor noise, blur,
downscale — and looks up each one:

- **98.8%** right card
- **74.8%** right card *and* right print
- **99.6%** in the top 5

The gap between those first two numbers is the whole reason the result sheet is shaped the way it
is: parallel rarities of one card share their artwork, so the scanner names the card confidently
and then asks you which print you're holding. The `--sweep` flag re-tunes the component weights;
weights are applied at match time, so changing them does **not** require rebuilding the index.

### Rebuilding

```bash
npm i playwright
node tools/build-scan-index.mjs      # ~4 minutes, writes data/scan-index.*
node tools/test-scan-accuracy.mjs    # sanity-check before committing
```

Rebuild when new sets are released. The Scan tab compares the index's card count against the live
card data and tells you how many cards it is missing, so you'll notice.

## Update prompt

When a new version is published, the app shows a modal offering to reload. **Nothing about the
deploy needs to change for this to work** — there is no version file to stamp and no workflow step
to add.

Two independent triggers:

1. **Content hash.** The app fetches its own files (`index.html`, `sw.js`, the manifest, the CSS
   and every JS module — about 30 KB gzipped) with `cache: 'no-store'`, hashes the bytes, and
   compares that with the hash taken when the session started. Any real change fires; a rebuild
   that produces identical bytes does not, so there are no phantom prompts. If the fetch fails
   the result is "unknown", never "changed", so being offline never prompts.
2. **Service worker.** A new `sw.js` now parks in `waiting` instead of calling `skipWaiting()`
   during install, so it cannot swap the code out from under you mid-scan. The page notices the
   waiting worker and prompts immediately; pressing **Reload** posts `SKIP_WAITING`, waits for
   `controllerchange`, then reloads.

Checks run when the app becomes visible again (at most once every 15 minutes), when the network
comes back, and once a minute after launch. **Later** silences that particular build for an hour;
a newer build than the one you dismissed still prompts.

Rebuilding the scan index alone does not trigger the prompt — `data/scan-index.*` is deliberately
outside the watched set, since it is 1.2 MB. The Scan tab reports index staleness on its own.

## How to play

The **?** button in the header opens a sheet with:

- the tutorial video, embedded from `youtube-nocookie.com` (needs a connection — the sheet says so
  when offline)
- the **Official Rule Book** PDF, served from `docs/`
- links to the Comprehensive Rules and the official Rules & Q&A
- a quick reference that works offline: setup, every phase in turn order, and the win conditions,
  taken from the rule book itself rather than written from memory

The PDF is Cover's own 36-page rule book, recompressed from 20 MB to 4.2 MB with Ghostscript
(images downsampled to 150 dpi; the text layer is vector and untouched, so it stays sharp and
searchable):

```bash
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.7 -dNOPAUSE -dQUIET -dBATCH \
   -dDetectDuplicateImages=true -dCompressFonts=true -dSubsetFonts=true \
   -dDownsampleColorImages=true -dColorImageDownsampleType=/Bicubic -dColorImageResolution=150 \
   -dDownsampleGrayImages=true -dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=150 \
   -dAutoFilterColorImages=false -dColorImageFilter=/DCTEncode -dJPEGQ=72 \
   -sOutputFile=out.pdf in.pdf
```

It is not precached by the service worker — 4 MB is too much to hold for a file you open rarely,
and it downloads on demand.

## Collection value

The Collection tab shows what the collection would cost to buy, with the five most valuable cards
and a per-set subtotal on each set row. Card prices also appear on each print in the card sheet,
and a deck's total appears in the deck editor.

Prices come from **[hocg-fan-sim-prices](https://github.com/Qrimpuff/hocg-fan-sim-prices)** (MIT),
the price companion to the card dataset — one JSON keyed by shop URL:

```json
"https://yuyu-tei.jp/sell/hocg/card/hbp01/10001": ["2026-09-21T…", {"y": 680}]
"https://www.tcgplayer.com/product/635585":       ["2026-08-18T…", {"d": 711}]
```

`y` is whole yen, `d` is US cents. Cards link to those rows through `yuyutei_sell_paths` and
`tcgplayer_product_ids` in the card dataset. Coverage: **96% of the 3,176 prints** have at least
one price (56% have both, 35% Yuyu-tei only, 5% TCGplayer only).

Settings live behind the chip in the value card's corner:

- **Currency** — EUR, USD or JPY. Rates come from `open.er-api.com` (with `frankfurter.dev` as a
  backup), cached for a day. With no rate available, prices stay in their own currency.
- **Source** — Auto prefers TCGplayer and falls back to Yuyu-tei. Yuyu-tei covers more prints;
  TCGplayer matches the English cards more closely. Where a card has several listings the lowest
  is used.

These are shop listing prices from one Japanese retailer and one US marketplace, and the UI says
so: a guide to replacement cost, not an appraisal. The price file is cached for a day; the "as of"
date shown is the newest timestamp in the data.

## Automatic deck building

**✨ Build** in the Decks tab. Three ways in: around a specific Oshi you own, around a colour, or
Surprise me. The pool is **strictly cards you own** — nothing you would have to buy is ever added.

### Why bloom lines drive the algorithm

Comprehensive Rules 8.3.3: the card you bloom with must have the **same card name** as the
holomem on stage, a 1st Bloom goes onto a Debut or 1st, a 2nd onto a 1st or 2nd. So a deck is not
a pile of strong holomem — it is a set of *lines*, each a Debut plus the 1st and 2nd Bloom cards
sharing that name. A 1st Bloom with no matching Debut in the deck is a dead card.

`js/autodeck.js` therefore groups owned holomem by card name, scores each line (in the Oshi's
colour, how deep it runs, how many copies you have), and fills from the best lines down. **A line
only contributes its 1st Bloom once its Debut is in the deck, and its 2nd once the 1st is in.**

### The rest of the build

1. **Oshi** — given, picked from the chosen colour, or random. No Oshi owned → it says so and stops.
2. **Holomem** — bloom lines in the Oshi's colour first, aiming at roughly 12 Debut / 10 1st /
   7 2nd. If your collection is too thin in that colour it widens to off-colour lines and says so.
   Spot holomem are free filler, since they cannot bloom and need no line.
3. **Support** — draw and search effects first, then colour match, then whatever you have most of.
4. **Anything left owned**, to close the gap to 50.
5. **Cheer** — the colours your arts actually cost, weighted by how often each appears. Every
   needed colour gets two copies before the proportional split, so a colour can never round down
   to zero and leave an art you cannot pay for.

A per-print ledger is shared by both piles, so a print is never put in a deck more times than you
own it. Copy limits come from the card's own `max_amount` (1 / 4 / 20 / 50) and the restricted
list is honoured.

### When your collection is short

The deck is still created, and the editor shows what the builder could not do:

```
✨ Built from your collection:
· Added off-colour holomem — you do not own enough green bloom lines yet.
· 11 main-deck cards short — you do not own enough yet.
· 20 cheer cards short.
```

That is more useful than refusing to build, and the normal legality errors sit right underneath.

### Verified

With a two-starter-deck collection: **25 of 25** random builds legal at 50/20, zero cards used
beyond what is owned, zero orphaned 1st/2nd Bloom cards, and every cheer colour the deck's arts
require present. With a single starter deck at one copy each it builds 39/50 and reports the
shortfall instead of inventing cards. With nothing owned it explains that a deck needs an Oshi.
