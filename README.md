# holoTCG — collection app

Offline-first PWA for tracking a **hololive OFFICIAL CARD GAME** collection.
No build step, no backend, no accounts. Plain ES modules + IndexedDB + a service worker.

## Status

| Area | State |
|---|---|
| Card browser, search, filters | done |
| Collection tracking (per print) | done |
| Offline / installable | done |
| Deck builder | next |
| Camera scanning | after that |

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
- `…/img/<path>` — Japanese scans, `…/img_en/<path>` — English (official where it exists, fan proxy otherwise)

The ↻ button in the header re-downloads it; the app also refreshes in the background once a day.
Card names, art and text are property of Cover Corp. — this is a personal, non-commercial tool.

## Storage

IndexedDB `holotcg`:

- `cards` — the normalised card list
- `owned` — `variantId → quantity`, where `variantId` is `hBP01-009#j40` (card number + the dataset's stable `manage_id`)
- `decks` — reserved for the deck builder
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
js/app.js               views, sheets, interaction
icons/                  app icons
```
