# Noisedeck Examples Tab — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third tab ("Noisedeck Examples") to Polymorphic's gallery modal that pulls programs from the existing shuffleset gallery at `https://shuffleset.stream/noisedeck/video/product-examples/example-programs/`. Clicking a card loads the DSL into the editor.

**Architecture:** Two-repo change. **shuffleset** exposes a new `listing.json` JSON endpoint (CORS `*`) for any gallery episode and adds CORS headers to its existing per-file route. **polymorphic** adds a tab, loader, and renderer that reads that endpoint and fetches `.dsl` files on click. Phase 1 is functional only — no per-card live preview/thumbnails (deferred to phase 2).

**Tech Stack:** Python 3 / aiohttp (shuffleset), vanilla ES modules (polymorphic), `node:test` for polymorphic unit tests, `pytest-aiohttp` for shuffleset.

**Spec:** `docs/superpowers/specs/2026-05-06-noisedeck-examples-tab-design.md`

**File Structure:**

| Repo | File | Purpose |
|---|---|---|
| shuffleset | `bin/app.py` | New route handler `handle_episode_listing`, CORS header on `handle_video_file`, route registration |
| shuffleset | `tests/test_listing_json.py` | New tests for `listing.json` shape + CORS |
| polymorphic | `public/js/ui/gallery.js` | Constants, `loadNoisedeckExamples`, `_renderNoisedeckExamples`, third tab button, tab dispatch branch |
| polymorphic | `tests/unit/gallery-noisedeck-examples.test.mjs` | Unit test for `loadNoisedeckExamples` |

**Order of operations:** Land shuffleset (Tasks A1–A3) and verify in production before starting polymorphic (Tasks B1–B3). This avoids shipping a Polymorphic UI that 404s during the deploy gap.

---

## Part A — Shuffleset

Working directory: `~/platform/shuffleset`

### Task A1: Failing test for listing.json shape

**Files:**
- Create: `tests/test_listing_json.py`

The test fixture mirrors the existing gallery episode in `tests/test_oembed.py` (a `style: gallery` episode with one file). We add a second `.dsl` file to better mimic the production shape.

- [ ] **Step 1: Create the test file**

```python
# tests/test_listing_json.py
"""Tests for the gallery listing.json endpoint and CORS on file serving."""
import json
import os
import pytest


@pytest.fixture
def gallery_dirs(tmp_path):
    """Create a temp video dir with one gallery episode containing a .dsl file."""
    video_dir = tmp_path / 'video'
    vartist = video_dir / 'testartist'
    gallery_ep_files = vartist / 'test-show' / 'gallery-ep' / 'files'
    gallery_ep_files.mkdir(parents=True)

    (vartist / 'index.json').write_text(json.dumps({
        'metadata': {'title': 'Test Artist'}
    }))
    (vartist / 'test-show' / 'index.json').write_text(json.dumps({
        'metadata': {'title': 'Test Show'}
    }))
    (vartist / 'test-show' / 'gallery-ep' / 'index.json').write_text(json.dumps({
        'metadata': {'title': 'Gallery Episode', 'style': 'gallery'},
        'files': [
            {'file': 'one.dsl', 'title': 'One', 'type': 'noisemaker', 'duration': 30},
            {'file': 'two.dsl', 'title': 'Two', 'type': 'noisemaker', 'duration': 30},
        ]
    }))
    (gallery_ep_files / 'one.dsl').write_text('noise().write(o0)\n')
    (gallery_ep_files / 'two.dsl').write_text('noise().write(o0)\n')

    # Non-gallery episode for negative cases
    plain_ep_files = vartist / 'test-show' / 'plain-ep' / 'files'
    plain_ep_files.mkdir(parents=True)
    (vartist / 'test-show' / 'plain-ep' / 'index.json').write_text(json.dumps({
        'metadata': {'title': 'Plain Episode'},
        'files': [{'file': 'clip01.mp4', 'title': 'Clip One'}]
    }))
    (plain_ep_files / 'clip01.mp4').write_bytes(b'\x00' * 2048)

    return {'video': str(video_dir), 'tmp': tmp_path}


@pytest.fixture
def app_with_galleries(gallery_dirs, tmp_path):
    """Fresh app pointed at temp media dirs."""
    import sys
    import importlib
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'bin'))
    import app as app_module
    importlib.reload(app_module)
    # Audio dir must exist but can be empty.
    audio_dir = tmp_path / 'audio'
    audio_dir.mkdir(exist_ok=True)
    app_module.AUDIO_DIR = str(audio_dir)
    app_module.VIDEO_DIR = gallery_dirs['video']
    return app_module.app


@pytest.mark.asyncio
async def test_listing_json_returns_expected_shape(aiohttp_client, app_with_galleries):
    client = await aiohttp_client(app_with_galleries)
    resp = await client.get('/testartist/video/test-show/gallery-ep/listing.json')
    assert resp.status == 200
    assert resp.headers.get('Content-Type', '').startswith('application/json')
    body = await resp.json()
    assert body['artist'] == 'testartist'
    assert body['show'] == 'test-show'
    assert body['episode'] == 'gallery-ep'
    assert body['filesUrl'] == '/testartist/video/test-show/gallery-ep/files/'
    assert isinstance(body['files'], list)
    assert len(body['files']) == 2
    titles = sorted(f['title'] for f in body['files'])
    assert titles == ['One', 'Two']


@pytest.mark.asyncio
async def test_listing_json_has_cors_header(aiohttp_client, app_with_galleries):
    client = await aiohttp_client(app_with_galleries)
    resp = await client.get('/testartist/video/test-show/gallery-ep/listing.json')
    assert resp.status == 200
    assert resp.headers.get('Access-Control-Allow-Origin') == '*'


@pytest.mark.asyncio
async def test_listing_json_404_for_non_gallery(aiohttp_client, app_with_galleries):
    client = await aiohttp_client(app_with_galleries)
    resp = await client.get('/testartist/video/test-show/plain-ep/listing.json')
    assert resp.status == 404


@pytest.mark.asyncio
async def test_listing_json_404_for_missing_episode(aiohttp_client, app_with_galleries):
    client = await aiohttp_client(app_with_galleries)
    resp = await client.get('/testartist/video/test-show/no-such-ep/listing.json')
    assert resp.status == 404


@pytest.mark.asyncio
async def test_dsl_file_has_cors_header(aiohttp_client, app_with_galleries):
    client = await aiohttp_client(app_with_galleries)
    resp = await client.get('/testartist/video/test-show/gallery-ep/files/one.dsl')
    assert resp.status == 200
    assert resp.headers.get('Access-Control-Allow-Origin') == '*'
    text = await resp.text()
    assert 'noise()' in text
```

- [ ] **Step 2: Run the new tests, confirm they fail**

```bash
cd ~/platform/shuffleset
pytest tests/test_listing_json.py -v
```

Expected: All five tests **FAIL** — the listing.json route does not yet exist (404 from the catch-all), and the file route does not yet emit `Access-Control-Allow-Origin`.

### Task A2: Implement listing.json route + CORS on file route

**Files:**
- Modify: `bin/app.py` — add `handle_episode_listing`, modify `handle_video_file` to add CORS, register the new route.

The handler reuses `_is_gallery_episode` and `_get_gallery_files`. The route registration goes BEFORE the catch-all `/{artist}/video/{show}/{episode}/{subpath:.+/[^/]+}` so it doesn't collide.

- [ ] **Step 1: Add the new handler**

In `bin/app.py`, immediately above the line `async def handle_video_file(request):` (currently around line 2143), insert:

```python
async def handle_episode_listing(request):
    """Return a JSON listing of a gallery episode's files.

    Public, CORS-enabled contract consumed by polymorphic (and any other
    cross-product client). Mirrors the GALLERY_DATA payload embedded in the
    gallery template.
    """
    artist = request.match_info['artist']
    show = request.match_info['show']
    episode = request.match_info['episode']
    _validate_name(artist)
    _validate_name(show)
    _validate_name(episode)

    if not _is_gallery_episode(artist, show, episode):
        raise web.HTTPNotFound(text='Episode not found')

    gallery_files = _get_gallery_files(artist, show, episode)
    if not gallery_files:
        raise web.HTTPNotFound(text='Episode not found')

    return web.json_response(
        {
            'artist': artist,
            'show': show,
            'episode': episode,
            'filesUrl': f'/{artist}/video/{show}/{episode}/files/',
            'files': gallery_files,
        },
        headers={
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60',
        },
    )
```

- [ ] **Step 2: Add CORS to `handle_video_file`**

`handle_video_file` currently returns three different `web.FileResponse` shapes (DSL, video, image) plus a webp-thumb path. Add `Access-Control-Allow-Origin: *` to each.

In `bin/app.py`, locate the DSL branch in `handle_video_file` (around line 2178):

```python
    if ext == '.dsl':
        return web.FileResponse(_cached_path(filepath), headers={'Content-Type': 'text/plain'})
```

Replace with:

```python
    if ext == '.dsl':
        return web.FileResponse(_cached_path(filepath), headers={
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
        })
```

Locate the video branch immediately below:

```python
    if os.path.splitext(filepath)[1].lower() in VIDEO_EXTENSIONS:
        return web.FileResponse(filepath)
```

Replace with:

```python
    if os.path.splitext(filepath)[1].lower() in VIDEO_EXTENSIONS:
        return web.FileResponse(filepath, headers={'Access-Control-Allow-Origin': '*'})
```

Locate the WebP cached path return inside the `thumb_w` branch (around line 2197):

```python
                    return web.FileResponse(webp_path, headers={
                        'Content-Type': 'image/webp',
                        'Cache-Control': 'max-age=86400',
                    })
```

Replace with:

```python
                    return web.FileResponse(webp_path, headers={
                        'Content-Type': 'image/webp',
                        'Cache-Control': 'max-age=86400',
                        'Access-Control-Allow-Origin': '*',
                    })
```

Then locate the final fallback `web.FileResponse(filepath)` at the bottom of `handle_video_file` (the catch-all return after the webp generation block). Add CORS the same way:

```python
    return web.FileResponse(filepath, headers={'Access-Control-Allow-Origin': '*'})
```

(If the function has any additional return paths producing webp from the on-the-fly generation block, add `'Access-Control-Allow-Origin': '*'` to those `headers={}` dicts too. Read the full function and patch every `web.FileResponse(...)` return to include the header.)

- [ ] **Step 3: Register the new route**

In `bin/app.py`, locate the route registration block (around line 2994):

```python
app.router.add_get('/{artist}/video/{show}/{episode}/files/{filename}', handle_video_file)
app.router.add_get('/{artist}/video/{show}/{episode}/{segment}', handle_hls_segment)
```

Insert the listing route **before** the `{segment}` catch-all line and **before** the `{subpath:.+/[^/]+}` line:

```python
app.router.add_get('/{artist}/video/{show}/{episode}/files/{filename}', handle_video_file)
app.router.add_get('/{artist}/video/{show}/{episode}/listing.json', handle_episode_listing)
app.router.add_get('/{artist}/video/{show}/{episode}/{segment}', handle_hls_segment)
```

The listing route is more specific than the `{segment}` route, so it must be registered first (aiohttp matches in registration order for plain segments).

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
cd ~/platform/shuffleset
pytest tests/test_listing_json.py -v
```

Expected: All five tests **PASS**.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
cd ~/platform/shuffleset
pytest -x
```

Expected: All tests pass. Pay particular attention to `test_oembed.py` (which exercises gallery episodes) and any test that hits `/files/<filename>`.

### Task A3: Commit shuffleset changes

- [ ] **Step 1: Stage and commit**

```bash
cd ~/platform/shuffleset
git add bin/app.py tests/test_listing_json.py
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(api): listing.json endpoint + CORS on /files for cross-product galleries

Adds GET /{artist}/video/{show}/{episode}/listing.json — a CORS-enabled
JSON view of the same payload currently embedded as window.GALLERY_DATA
in the gallery template. Lets polymorphic (and other future clients)
consume any shuffleset gallery without scraping HTML.

Also adds Access-Control-Allow-Origin: * to handle_video_file's DSL,
video, image, and webp returns so the listed files are fetchable from
other origins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify the commit**

```bash
cd ~/platform/shuffleset
git log --oneline -3
git show --stat HEAD
```

Expected: A single commit with `bin/app.py` and `tests/test_listing_json.py` modified/added.

- [ ] **Step 3: STOP and request authorization to push.**

Per HARD BAN, never push without explicit authorization. Surface to the user:

> "Shuffleset side committed locally on `main` (commit `<hash>`). Push to deploy via CI?"

Wait for explicit approval before running `git push`. **Do not push autonomously.**

- [ ] **Step 4 (post-approval): Push and verify deploy**

```bash
cd ~/platform/shuffleset
git push origin main
```

Wait for the CI deploy to finish (watch `gh run watch` or the user's preferred channel). Then smoke-test from a different origin:

```bash
curl -i -H "Origin: https://polymorphic.noisedeck.app" \
  https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json
```

Expected: `200`, `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, body containing `"files": [...]` with the expected program titles.

```bash
curl -i -H "Origin: https://polymorphic.noisedeck.app" \
  "https://shuffleset.stream/noisedeck/video/product-examples/example-programs/files/abstract%20squiggletown.dsl"
```

Expected: `200`, `Content-Type: text/plain`, `Access-Control-Allow-Origin: *`, body is the DSL source.

Only proceed to Part B once both curls return the expected headers from production.

---

## Part B — Polymorphic

Working directory: `~/platform/polymorphic`

### Task B1: Failing unit test for `loadNoisedeckExamples`

**Files:**
- Create: `tests/unit/gallery-noisedeck-examples.test.mjs`

`loadExamples` and `loadBlasterFeed` in `gallery.js` are top-level fetchers. We follow the existing pattern: export the loader, write a unit test that stubs `globalThis.fetch`.

- [ ] **Step 1: Create the test file**

```js
// tests/unit/gallery-noisedeck-examples.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'

// gallery.js eagerly imports browser-coupled modules (CanvasRenderer);
// stub them before importing the SUT.
const origFetch = globalThis.fetch

function stubFetch(impl) {
    globalThis.fetch = impl
}

function restoreFetch() {
    globalThis.fetch = origFetch
}

async function loadModule() {
    // Import lazily so each test gets a clean module-level cache.
    // node:test does not isolate modules per-test, so we use the
    // {force: true} option on the loader to bypass the cache.
    const mod = await import('../../public/js/ui/gallery.js')
    return mod
}

test('loadNoisedeckExamples returns the listing payload from the JSON endpoint', async () => {
    const fakeListing = {
        artist: 'noisedeck',
        show: 'product-examples',
        episode: 'example-programs',
        filesUrl: '/noisedeck/video/product-examples/example-programs/files/',
        files: [
            { file: 'one.dsl', title: 'one', type: 'noisemaker', duration: 30 },
            { file: 'two.dsl', title: 'two', type: 'noisemaker', duration: 30 },
        ],
    }
    let calls = 0
    stubFetch(async (url) => {
        calls += 1
        assert.match(String(url), /listing\.json$/)
        return new Response(JSON.stringify(fakeListing), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    })
    try {
        const { loadNoisedeckExamples } = await loadModule()
        const out = await loadNoisedeckExamples({ force: true })
        assert.strictEqual(out.files.length, 2)
        assert.strictEqual(out.filesUrl, fakeListing.filesUrl)
        assert.strictEqual(calls, 1)
    } finally {
        restoreFetch()
    }
})

test('loadNoisedeckExamples throws on non-2xx', async () => {
    stubFetch(async () =>
        new Response('boom', { status: 503 }))
    try {
        const { loadNoisedeckExamples } = await loadModule()
        await assert.rejects(
            () => loadNoisedeckExamples({ force: true }),
            /503/
        )
    } finally {
        restoreFetch()
    }
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd ~/platform/polymorphic
node --test tests/unit/gallery-noisedeck-examples.test.mjs
```

Expected: Both tests **FAIL** — `loadNoisedeckExamples` is not yet exported.

> **Note on browser-coupled imports:** `gallery.js` imports `CanvasRenderer` from `../noisemaker/bundle.js`. If running this test fails to import the module at all (rather than failing inside the test), pull the loader into a small standalone module to keep the unit test surface clean. See Step 3 below — we choose that path up front for testability.

### Task B2: Extract loader into a small module + add tab

**Files:**
- Create: `public/js/ui/noisedeckExamples.js` — pure data layer (constants + loader). No DOM or WebGL imports, so it's unit-testable in node.
- Modify: `public/js/ui/gallery.js` — import from `noisedeckExamples.js`, add tab button, add `_renderNoisedeckExamples`, dispatch in `_renderTab`.
- Modify: `tests/unit/gallery-noisedeck-examples.test.mjs` — import from the new module instead of `gallery.js`.

- [ ] **Step 1: Create `public/js/ui/noisedeckExamples.js`**

```js
/**
 * Noisedeck Examples — data layer for the gallery's third tab.
 *
 * Pulls program metadata from shuffleset's listing.json endpoint and
 * fetches individual .dsl files on demand. No DOM dependencies, so this
 * module is unit-testable under node:test.
 */

export const NOISEDECK_EXAMPLES_LISTING_URL =
    'https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json'

export const NOISEDECK_EXAMPLES_BASE = 'https://shuffleset.stream'

export const NOISEDECK_EXAMPLES_CACHE_MS = 60_000

let cachedListing = null
let cachedFetchedAt = 0

/**
 * Fetch the gallery listing. Cached for NOISEDECK_EXAMPLES_CACHE_MS so
 * re-opening the modal is cheap; pass {force: true} to bypass.
 *
 * @returns {Promise<{artist:string, show:string, episode:string, filesUrl:string, files:Array<{file:string,title:string,type:string,duration:number}>}>}
 */
export async function loadNoisedeckExamples({ force = false } = {}) {
    const stale = (Date.now() - cachedFetchedAt) > NOISEDECK_EXAMPLES_CACHE_MS
    if (cachedListing && !force && !stale) return cachedListing
    const res = await fetch(NOISEDECK_EXAMPLES_LISTING_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Noisedeck Examples listing HTTP ${res.status}`)
    const data = await res.json()
    cachedListing = data
    cachedFetchedAt = Date.now()
    return cachedListing
}

/**
 * Fetch a single DSL file's source. Returns plain text.
 *
 * @param {{filesUrl:string}} listing - the listing returned by loadNoisedeckExamples
 * @param {string} fileName - e.g. "abstract squiggletown.dsl"
 * @returns {Promise<string>}
 */
export async function fetchNoisedeckExampleSource(listing, fileName) {
    const url = NOISEDECK_EXAMPLES_BASE + listing.filesUrl + encodeURIComponent(fileName)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Noisedeck Examples DSL HTTP ${res.status}`)
    return res.text()
}
```

- [ ] **Step 2: Update the test to import from the new module**

Replace the body of `tests/unit/gallery-noisedeck-examples.test.mjs` with:

```js
// tests/unit/gallery-noisedeck-examples.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'

const origFetch = globalThis.fetch
function stubFetch(impl) { globalThis.fetch = impl }
function restoreFetch() { globalThis.fetch = origFetch }

test('loadNoisedeckExamples returns the listing payload from the JSON endpoint', async () => {
    const fakeListing = {
        artist: 'noisedeck',
        show: 'product-examples',
        episode: 'example-programs',
        filesUrl: '/noisedeck/video/product-examples/example-programs/files/',
        files: [
            { file: 'one.dsl', title: 'one', type: 'noisemaker', duration: 30 },
            { file: 'two.dsl', title: 'two', type: 'noisemaker', duration: 30 },
        ],
    }
    let calls = 0
    stubFetch(async (url) => {
        calls += 1
        assert.match(String(url), /listing\.json$/)
        return new Response(JSON.stringify(fakeListing), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    })
    try {
        const { loadNoisedeckExamples } = await import('../../public/js/ui/noisedeckExamples.js')
        const out = await loadNoisedeckExamples({ force: true })
        assert.strictEqual(out.files.length, 2)
        assert.strictEqual(out.filesUrl, fakeListing.filesUrl)
        assert.strictEqual(calls, 1)
    } finally {
        restoreFetch()
    }
})

test('loadNoisedeckExamples throws on non-2xx', async () => {
    stubFetch(async () => new Response('boom', { status: 503 }))
    try {
        const { loadNoisedeckExamples } = await import('../../public/js/ui/noisedeckExamples.js')
        await assert.rejects(
            () => loadNoisedeckExamples({ force: true }),
            /503/
        )
    } finally {
        restoreFetch()
    }
})

test('fetchNoisedeckExampleSource builds the right URL and returns text', async () => {
    const listing = { filesUrl: '/noisedeck/video/product-examples/example-programs/files/' }
    let seenUrl = null
    stubFetch(async (url) => {
        seenUrl = String(url)
        return new Response('noise().write(o0)', { status: 200 })
    })
    try {
        const { fetchNoisedeckExampleSource } = await import('../../public/js/ui/noisedeckExamples.js')
        const text = await fetchNoisedeckExampleSource(listing, 'abstract squiggletown.dsl')
        assert.strictEqual(text, 'noise().write(o0)')
        assert.strictEqual(
            seenUrl,
            'https://shuffleset.stream/noisedeck/video/product-examples/example-programs/files/abstract%20squiggletown.dsl'
        )
    } finally {
        restoreFetch()
    }
})
```

- [ ] **Step 3: Run the unit test, confirm green**

```bash
cd ~/platform/polymorphic
node --test tests/unit/gallery-noisedeck-examples.test.mjs
```

Expected: All three tests **PASS**.

- [ ] **Step 4: Wire the new tab into `gallery.js`**

In `public/js/ui/gallery.js`:

**4a.** At the top of the file (after the existing `import { loadFromCode } ...` line, around line 18), add:

```js
import {
    loadNoisedeckExamples,
    fetchNoisedeckExampleSource,
} from './noisedeckExamples.js'
```

**4b.** Update the file's leading docblock (lines 1–16) to mention the third tab. Replace:

```js
/**
 * Program Browser
 *
 * Modal browser for example programs and community-published compositions.
 * Two tabs:
 *
 *   - Curated     — static /data/examples.json roster shipped with the app.
 *   - NoiseBLASTER — live feed pulled from blaster.noisedeck.app/api/feed,
 *                    showing the latest published compositions across the
 *                    Noisemaker ecosystem. These are ephemeral and rotate
 *                    daily; clicking a card resolves the composition via
 *                    sharing.noisedeck.app and loads it into the editor.
 *
 * On a fresh visit (no ?dsl, no ?code), we boot a random Curated example so
 * the landing page feels welcoming.
 */
```

With:

```js
/**
 * Program Browser
 *
 * Modal browser for example programs and community-published compositions.
 * Three tabs:
 *
 *   - Curated           — static /data/examples.json roster shipped with the app.
 *   - Noisedeck Examples — live JSON listing from shuffleset's product-examples
 *                          gallery; .dsl files fetched on click.
 *   - NoiseBLASTER       — live feed pulled from blaster.noisedeck.app/api/feed,
 *                          showing the latest published compositions across the
 *                          Noisemaker ecosystem. These are ephemeral and rotate
 *                          daily; clicking a card resolves the composition via
 *                          sharing.noisedeck.app and loads it into the editor.
 *
 * On a fresh visit (no ?dsl, no ?code), we boot a random Curated example so
 * the landing page feels welcoming.
 */
```

**4c.** In the `Gallery` constructor (around line 371), update the activeTab comment:

```js
        this._activeTab = 'curated'  // 'curated' | 'blaster'
```

Replace with:

```js
        this._activeTab = 'curated'  // 'curated' | 'noisedeck-examples' | 'blaster'
```

**4d.** In `_build()` (around line 564), update the tabs strip. Replace:

```js
                <div class="gallery-tabs">
                    <button class="gallery-tab" data-tab="curated">Curated</button>
                    <button class="gallery-tab" data-tab="blaster">NoiseBLASTER!</button>
                </div>
```

With:

```js
                <div class="gallery-tabs">
                    <button class="gallery-tab" data-tab="curated">Curated</button>
                    <button class="gallery-tab" data-tab="noisedeck-examples">Noisedeck Examples</button>
                    <button class="gallery-tab" data-tab="blaster">NoiseBLASTER!</button>
                </div>
```

**4e.** In `_renderTab()` (around line 585), add the third branch. Replace:

```js
        if (tab === 'curated') {
            await this._renderCurated(body)
        } else if (tab === 'blaster') {
            await this._renderBlaster(body)
        }
```

With:

```js
        if (tab === 'curated') {
            await this._renderCurated(body)
        } else if (tab === 'noisedeck-examples') {
            await this._renderNoisedeckExamples(body)
        } else if (tab === 'blaster') {
            await this._renderBlaster(body)
        }
```

**4f.** Immediately after `_renderBlaster` (around line 636, before `_shuffle()`), add the new renderer:

```js
    async _renderNoisedeckExamples(body) {
        body.innerHTML = `<div class="gallery-loading">Loading Noisedeck Examples…</div>`
        let listing
        try {
            listing = await loadNoisedeckExamples()
        } catch (err) {
            console.warn('[Gallery] Noisedeck Examples listing failed:', err)
            body.innerHTML = `<div class="gallery-error">Couldn't reach Noisedeck Examples. Try again in a moment.</div>`
            return
        }
        if (!listing?.files?.length) {
            body.innerHTML = `<div class="gallery-empty">No Noisedeck Examples found.</div>`
            return
        }
        const grid = document.createElement('div')
        grid.className = 'gallery-grid'
        for (const file of listing.files) {
            grid.appendChild(this._buildNoisedeckExampleCard(listing, file))
        }
        body.innerHTML = ''
        body.appendChild(grid)
    }

    _buildNoisedeckExampleCard(listing, file) {
        const card = document.createElement('div')
        card.className = 'gallery-card'

        // Phase 1: no per-card preview rendering. Use the existing
        // "(no preview)" fallback styling that NoiseBLASTER cards use when
        // a screenshot is missing. Phase 2 will lazy-fetch the .dsl on
        // scroll-in and register a LivePreview, mirroring the curated tab.
        const thumb = document.createElement('div')
        thumb.className = 'gallery-card-thumb'
        const fb = document.createElement('div')
        fb.className = 'gallery-card-thumb-fallback'
        fb.textContent = '(no preview)'
        thumb.appendChild(fb)

        const bodyEl = document.createElement('div')
        bodyEl.className = 'gallery-card-body'
        bodyEl.innerHTML = `
            <div class="gallery-card-title">${escapeHtml(file.title || file.file)}</div>
            <div class="gallery-card-meta"><span class="gallery-card-meta-app">noisedeck</span></div>
        `
        card.appendChild(thumb)
        card.appendChild(bodyEl)

        card.addEventListener('click', async () => {
            await this._loadNoisedeckExample(listing, file, card)
        })
        return card
    }

    async _loadNoisedeckExample(listing, file, card) {
        if (card) card.classList.add('loading')
        try {
            const dsl = await fetchNoisedeckExampleSource(listing, file.file)
            this._onLoad({
                title: file.title || file.file,
                dsl,
                tagline: '',
                tags: ['noisedeck'],
            })
            this.close()
        } catch (err) {
            console.error('[Gallery] Failed to load Noisedeck Example:', err)
            if (card) {
                card.classList.remove('loading')
                card.querySelector('.gallery-card-meta')?.insertAdjacentHTML(
                    'beforeend',
                    `<span style="color:#ff7b72">load failed</span>`
                )
            }
        }
    }
```

**4g.** Extend `_shuffle()` (around line 638) to handle the new tab. Replace:

```js
    _shuffle() {
        if (this._activeTab === 'curated') {
            loadExamples().then(list => {
                if (!list.length) return
                const ex = list[Math.floor(Math.random() * list.length)]
                this._onLoad(ex)
                this.close()
            })
        } else if (this._activeTab === 'blaster') {
            loadBlasterFeed().then(async (feed) => {
                if (!feed?.length) return
                const item = feed[Math.floor(Math.random() * feed.length)]
                await this._loadBlasterItem(item)
            }).catch(err => console.warn('[Gallery] shuffle failed:', err))
        }
    }
```

With:

```js
    _shuffle() {
        if (this._activeTab === 'curated') {
            loadExamples().then(list => {
                if (!list.length) return
                const ex = list[Math.floor(Math.random() * list.length)]
                this._onLoad(ex)
                this.close()
            })
        } else if (this._activeTab === 'noisedeck-examples') {
            loadNoisedeckExamples().then(async (listing) => {
                if (!listing?.files?.length) return
                const file = listing.files[Math.floor(Math.random() * listing.files.length)]
                await this._loadNoisedeckExample(listing, file)
            }).catch(err => console.warn('[Gallery] shuffle failed:', err))
        } else if (this._activeTab === 'blaster') {
            loadBlasterFeed().then(async (feed) => {
                if (!feed?.length) return
                const item = feed[Math.floor(Math.random() * feed.length)]
                await this._loadBlasterItem(item)
            }).catch(err => console.warn('[Gallery] shuffle failed:', err))
        }
    }
```

- [ ] **Step 5: Re-run the unit test to confirm no regression**

```bash
cd ~/platform/polymorphic
node --test tests/unit/gallery-noisedeck-examples.test.mjs
```

Expected: All three tests **PASS**.

- [ ] **Step 6: Run the full unit test suite to confirm nothing else broke**

```bash
cd ~/platform/polymorphic
node --test tests/unit/*.test.mjs
```

Expected: All existing tests still pass; the new tests pass.

### Task B3: Manual browser verification

- [ ] **Step 1: Start the dev server**

```bash
cd ~/platform/polymorphic
npm start
```

This serves `public/` on port 3000.

- [ ] **Step 2: Manually verify each acceptance criterion**

Open `http://localhost:3000` in a browser. Open the gallery modal (the existing affordance — typically a button in the toolbar or the `#` shortcut depending on UI). Verify each of:

1. Three tab buttons render in order: **Curated**, **Noisedeck Examples**, **NoiseBLASTER!**.
2. Click **Noisedeck Examples** → loading state appears, then a grid of cards (one per program — should be ~22 entries based on production listing).
3. Each card shows the program title (e.g. "abstract squiggletown") with a `(no preview)` placeholder thumb.
4. Click any card → modal closes, the editor swaps to the chosen program, and it renders on the canvas without errors.
5. Click the gallery **shuffle** button while the Noisedeck Examples tab is active → modal closes, a random Noisedeck program loads.
6. Switch back to **Curated** and **NoiseBLASTER!** → both still work as before.
7. Open DevTools Network tab and confirm:
   - On tab open: a single `GET listing.json` to `shuffleset.stream` with status 200.
   - On card click: a single `GET <program>.dsl` to `shuffleset.stream` with status 200, and the response is `text/plain` DSL.
   - No CORS errors in the console.

If any of 1–7 fails, fix the issue and re-verify before moving on. Do not skip browser verification — this is the only end-to-end check we have.

- [ ] **Step 3: Stop the dev server**

`Ctrl+C` in the terminal running `npm start`.

### Task B4: Commit polymorphic changes

- [ ] **Step 1: Stage and commit**

```bash
cd ~/platform/polymorphic
git add public/js/ui/gallery.js public/js/ui/noisedeckExamples.js tests/unit/gallery-noisedeck-examples.test.mjs
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
feat(gallery): Noisedeck Examples tab

Adds a third tab that pulls programs from shuffleset's product-examples
gallery via its new listing.json endpoint. Clicking a card fetches the
.dsl file and loads it into the editor — same shape as the existing
Curated and NoiseBLASTER tabs.

Phase 1: no per-card live preview/thumbnails (cards show the existing
"(no preview)" fallback). Phase 2 will lazy-fetch the DSL on scroll-in
and register a LivePreview, matching the Curated tab's behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify the commit**

```bash
cd ~/platform/polymorphic
git log --oneline -3
git show --stat HEAD
```

Expected: A single commit touching three files (`gallery.js` modified, `noisedeckExamples.js` added, the test added).

- [ ] **Step 3: STOP and request authorization to push.**

> "Polymorphic side committed locally on `main` (commit `<hash>`). Push to deploy via CI?"

Wait for explicit approval. **Do not push autonomously.**

- [ ] **Step 4 (post-approval): Push and verify the live site**

```bash
cd ~/platform/polymorphic
git push origin main
```

Wait for CI to deploy. Then verify on `https://polymorphic.noisedeck.app`:

1. Same browser checklist as Task B3 Step 2, against the live site.
2. Hard-refresh to defeat any service-worker caching of the old `gallery.js`.

If anything fails on the live site that worked locally, fix forward (do not roll back).

---

## Self-review checklist (run before handing off)

- ✅ Spec coverage: every spec section maps to a task above (listing.json route → A2; CORS on file route → A2 step 2; tab button → B2 step 4d; renderer → B2 step 4f; click→`onLoad` with `{title, dsl}` → B2 step 4f; tests → A1 + B1; deploy order → ordering of Part A vs Part B).
- ✅ No placeholders.
- ✅ Type/name consistency: tab id is `noisedeck-examples` everywhere; loader is `loadNoisedeckExamples` everywhere; the `onLoad` payload uses `dsl` (not `code`) to match the existing curated/blaster shape.
- ✅ Bite-sized: every step is one observable action (write code, run test, commit, etc.).
- ✅ Both repos commit but **do not push** without explicit user approval.
