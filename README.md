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
| Camera scanning | next |

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
js/deck.js              deck model, legality rules, holoDelta import/export
js/app.js               views, sheets, interaction
icons/                  app icons — icon.svg is the source, the PNGs are generated
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
