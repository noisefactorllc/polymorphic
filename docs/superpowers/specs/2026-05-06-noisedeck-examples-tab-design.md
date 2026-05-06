# Noisedeck Examples tab in Polymorphic gallery

**Date:** 2026-05-06
**Repos touched:** `noisefactorllc/polymorphic`, `noisefactorllc/shuffleset`

## Goal

Add a third tab to the Polymorphic example-programs gallery modal that pulls from the existing shuffleset gallery at `https://shuffleset.stream/noisedeck/video/product-examples/example-programs/`. Clicking a card loads the program's DSL into the editor — identical behavior to the existing **Curated** and **NoiseBLASTER!** tabs.

The gallery currently has two tabs:
- **Curated** — static `/data/examples.json` shipped with Polymorphic (23 entries).
- **NoiseBLASTER!** — live feed from `blaster.noisedeck.app/api/feed`.

The shuffleset gallery is a separate, larger curated set ("abstract squiggletown", "colorful gloop", …) authored by Noisedeck. Surfacing it inside Polymorphic gives users a third source of working programs without duplicating the file content.

## Phasing

This spec covers **phase 1**: a working **Noisedeck Examples** tab without per-card thumbnails. Cards use the same blank/placeholder treatment as Curated/NoiseBLASTER cards when art is unavailable.

**Phase 2 (separate spec, after phase 1 is live):** add per-card thumbnails. The shuffleset thumb viewer was the reference implementation for Polymorphic's gallery, so the polymorphic side already knows how to consume thumbnails — phase 2 will be primarily a shuffleset change to render per-clip thumbnails for `.dsl` files (today only episode-level `thumbnail.jpg` exists; a probe of `<file>.dsl/thumbnail` returns 404). Phase 2 is deliberately out of scope here so phase 1 can ship cleanly.

## Non-goals (this phase)

- Per-card thumbnails (deferred to phase 2).
- "View on shuffleset" links or attribution overlays on cards.
- Generalizing Polymorphic to consume arbitrary shuffleset galleries (other artist/show/episode triples). The single URL is hardcoded; parameterization can come later if a second gallery is added.
- Re-rendering or re-shipping the actual `.dsl` content inside Polymorphic. The files stay on shuffleset; Polymorphic fetches them on demand.

## Architecture

```
polymorphic gallery modal
  └── tab "Noisedeck Examples"
       └── GET listing.json   →  shuffleset.stream/.../example-programs/listing.json   (CORS: *)
       └── on card click       →  GET <filesUrl><name>.dsl                              (CORS: *)
       └── pass DSL text into the existing onLoad(example) callback
```

Two well-bounded changes, one per repo. The new public contract between them is `listing.json`.

## Shuffleset changes (`bin/app.py`)

### New route: `GET /{artist}/{show}/{episode}/listing.json`

Returns the same gallery metadata that is currently embedded inline as `window.GALLERY_DATA` in the gallery template, as a standalone JSON document.

Response body:
```json
{
  "artist": "noisedeck",
  "show": "product-examples",
  "episode": "example-programs",
  "filesUrl": "/noisedeck/video/product-examples/example-programs/files/",
  "files": [
    { "file": "abstract squiggletown.dsl", "title": "abstract squiggletown", "type": "noisemaker", "duration": 30 },
    ...
  ]
}
```

Behavior:
- 200 with the JSON body when the episode exists and `_is_gallery_episode(...)` returns true.
- 404 when the episode does not exist or is not a gallery.
- Reuses existing helpers `_is_gallery_episode` and `_get_gallery_files`.

Response headers:
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *`
- `Cache-Control: public, max-age=60`

### CORS on existing file route

`GET /{artist}/{show}/{episode}/files/{filename}` already serves the `.dsl` content as `text/plain`. Add `Access-Control-Allow-Origin: *` to its response headers. Scope is exactly that route — auth-gated routes are untouched.

### Tests (`tests/`)

Add tests against a tmp gallery episode fixture (the existing `test_oembed.py` already builds one — reuse the pattern):

- `listing.json` returns 200 with the expected shape (`artist`, `show`, `episode`, `filesUrl`, `files[]`).
- `listing.json` includes `Access-Control-Allow-Origin: *`.
- `listing.json` returns 404 for non-gallery episodes.
- `/files/<name>` includes `Access-Control-Allow-Origin: *`.

## Polymorphic changes (`public/js/ui/gallery.js`)

### Constants

```js
const NOISEDECK_EXAMPLES_LISTING_URL =
  'https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json'
const NOISEDECK_EXAMPLES_BASE = 'https://shuffleset.stream'
const NOISEDECK_EXAMPLES_CACHE_MS = 60_000
```

### Cache + loader

Mirror the existing `loadBlasterFeed` pattern:

```js
let cachedNoisedeckListing = null   // { artist, show, episode, filesUrl, files[] }
let cachedNoisedeckFetchedAt = 0

async function loadNoisedeckExamples({ force = false } = {}) { ... }
```

Stores the whole listing payload so the click handler can resolve `filesUrl + file`.

### Tab button

In the tabs strip, between Curated and NoiseBLASTER!:

```html
<button class="gallery-tab" data-tab="noisedeck-examples">Noisedeck Examples</button>
```

State machine (`this._activeTab`) gains a third value: `'noisedeck-examples'`. Initial tab remains `'curated'`.

### Renderer

`_renderNoisedeckExamples(body)`:
1. Show spinner placeholder while loading.
2. `await loadNoisedeckExamples()`.
3. Render one card per `file`. Title from `file.title`. No thumbnail — fall back to whatever placeholder Curated/NoiseBLASTER use when art is unavailable.
4. Card click handler:
   ```js
   const url = NOISEDECK_EXAMPLES_BASE + cachedNoisedeckListing.filesUrl + encodeURIComponent(file.file)
   const code = await fetch(url, { cache: 'no-store' }).then(r => r.text())
   this._onLoad({ title: file.title, code, source: 'noisedeck-examples' })
   ```
5. On listing fetch error: render a short error message + retry affordance, matching the NoiseBLASTER tab's existing failure UI.
6. On file fetch error (per click): inline notice on the card; modal stays open; gallery state preserved.

### `_renderTab` branch

Add an `else if (tab === 'noisedeck-examples') { await this._renderNoisedeckExamples(body) }` branch.

## Data flow

1. User opens the gallery modal.
2. User clicks **Noisedeck Examples**.
3. Polymorphic fetches `listing.json` (cached for 60s, same window as blaster).
4. Cards render.
5. User clicks a card → Polymorphic fetches the `.dsl` file → calls existing `onLoad({title, code})` → editor swaps to the new program → modal closes.

The existing `onLoad` contract is unchanged; the new tab is a third producer of `{title, code}` objects.

## Error handling

| Failure | Surface | Recovery |
|---|---|---|
| `listing.json` 5xx / network | Inline error in tab body | "Try again" button → `loadNoisedeckExamples({force: true})` |
| `listing.json` CORS missing | Browser-level block | Caught by shuffleset CORS test; deploy smoke-checks `listing.json` from a different origin |
| `.dsl` fetch fails on click | Inline notice on card | User clicks again; modal state unchanged |
| Non-gallery episode | 404 from shuffleset | Same path as listing failure (we don't expose this URL outside Noisedeck Examples) |

## Testing

**Shuffleset:**
- Python tests as listed above.
- After deploy: `curl -i -H "Origin: https://polymorphic.noisedeck.app" https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json` — verify 200, JSON body, CORS header.
- Same curl against a sample `.dsl` file — verify CORS header.

**Polymorphic:**
- Manual: `npm start`, open gallery, click each tab, click a card from each tab, confirm program loads.
- If a `gallery.js` test harness exists, add an assertion that three tab buttons render and `_renderNoisedeckExamples` produces ≥1 card given a stub listing.
- After deploy: same flow on `polymorphic.noisedeck.app`.

## Deploy / order of operations

1. Land the shuffleset change first. Verify `listing.json` and CORS headers in production.
2. Then land the polymorphic change.

This order avoids shipping a Polymorphic UI that hits a 404 on the listing endpoint during the gap between the two deploys.

## Open questions

None at design time for phase 1. The URL, tab name, and click behavior are all confirmed. Phase 2 (thumbnails) gets its own design pass once phase 1 is live.
