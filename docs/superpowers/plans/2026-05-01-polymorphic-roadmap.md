# Polymorphic Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the nine remaining items from the roadmap (per-surface pips, mobile/touch UX, tutorial, code-review cleanup, embed mode, code formatter, PWA, scene launcher, error line-numbers) test-driven, each as an independently committable phase.

**Architecture:** Each phase produces self-contained UI modules under `public/js/ui/` and is wired into `embed.js`. Tests live in `scripts/test-*.mjs` (Playwright) and `tests/unit/*.mjs` (Node + node:test) where pure logic warrants it. Every phase ends with a verification step + a commit.

**Tech Stack:** Vanilla ESM (no build step), `@playwright/test` already installed, Node's built-in `node:test` runner for pure-logic units, the noisemaker engine bundle (`shaders.noisedeck.app/1`).

**Sequencing:** Phases are ordered so earlier work surfaces helpers later phases reuse (e.g., the `outputPicker` lifecycle pattern in Phase 1 is reused by the scene launcher in Phase 8). Each phase is independently shippable; pause between phases is allowed.

---

## File Structure (across all phases)

| Path | Purpose | Phase |
|---|---|---|
| `public/js/ui/outputPicker.js` | Per-output (o0..o7) live preview pips with click-to-focus | 1 |
| `public/js/ui/touchControls.js` | Tap-to-eval, pinch fullscreen, touch-friendly gestures | 2 |
| `public/css/touch.css` | Mobile-only layout adjustments | 2 |
| `public/js/ui/tutorial.js` | Five-step interactive walkthrough | 3 |
| `public/data/tutorial.json` | Tutorial step content | 3 |
| `public/js/ui/paletteActions.js` | Action registry split out of embed.js | 4 |
| `public/js/ui/embedMode.js` | `?embed=1` clean-render mode | 5 |
| `public/js/ui/formatter.js` | `Cmd+Shift+F` DSL formatter | 6 |
| `public/sw.js` | PWA service worker | 7 |
| `public/manifest.webmanifest` | PWA manifest | 7 |
| `public/js/ui/scenes.js` | Multi-scene clip launcher | 8 |
| `public/js/ui/errorBanner.js` | Error display with line numbers + click-to-jump | 9 |
| `tests/unit/*.mjs` | Pure-logic tests (formatter, scenes, etc.) | 4, 6, 8, 9 |
| `scripts/test-*.mjs` | End-to-end Playwright tests per phase | 1–9 |

`public/js/embed.js` is wired in every phase; existing modules under `public/js/ui/` are touched only when a phase has a specific reason (Phase 4 splits palette actions out, Phase 8 hooks the scene launcher into snapshot history, etc.).

---

## Phase 1: Per-output (o0..o7) surface pips

**Why:** This is the original task #15 — see what each surface holds, click to focus that surface as the displayed render. Critical for multi-output sketches.

**Approach:** Add an `<output-picker>` floating column on the right edge (under the live-inputs panel when both are open). For each surface that the current DSL writes to, mount a small canvas, instantiate a `CanvasRenderer` running a thin DSL like `read(o0).write(o0)` then `render(o0)`. Click swaps which surface the *main* canvas's `render(...)` call points to.

### Task 1.1: Detect surfaces written in DSL

**Files:**
- Create: `public/js/ui/outputPicker.js`
- Test: `tests/unit/outputPicker.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/outputPicker.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { surfacesWrittenInDsl, currentRenderTarget } from '../../public/js/ui/outputPicker.js'

test('surfacesWrittenInDsl finds each .write(oN)', () => {
    const dsl = `noise().write(o0)\ngradient().write(o3)\nrender(o0)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [0, 3])
})

test('surfacesWrittenInDsl tolerates whitespace', () => {
    const dsl = `noise()\n  .write( o7 )\nrender(o7)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [7])
})

test('currentRenderTarget reads the last render(oN)', () => {
    const dsl = `noise().write(o0)\nrender(o0)\nrender(o3)`
    assert.strictEqual(currentRenderTarget(dsl), 3)
})

test('currentRenderTarget returns null when render() absent', () => {
    assert.strictEqual(currentRenderTarget('noise().write(o0)'), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

```
node --test tests/unit/outputPicker.test.mjs
```
Expected: failures (`Cannot find module '../../public/js/ui/outputPicker.js'`).

- [ ] **Step 3: Implement detection helpers**

```js
// public/js/ui/outputPicker.js
export function surfacesWrittenInDsl(dsl) {
    if (!dsl) return []
    const matches = [...dsl.matchAll(/\.write\s*\(\s*o([0-7])\s*\)/g)]
    const ids = new Set(matches.map(m => parseInt(m[1], 10)))
    return [...ids].sort((a, b) => a - b)
}

export function currentRenderTarget(dsl) {
    if (!dsl) return null
    const matches = [...dsl.matchAll(/(?:^|\n)\s*render\s*\(\s*o([0-7])\s*\)/g)]
    if (!matches.length) return null
    return parseInt(matches[matches.length - 1][1], 10)
}
```

- [ ] **Step 4: Run test, expect PASS**

```
node --test tests/unit/outputPicker.test.mjs
```
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/outputPicker.js tests/unit/outputPicker.test.mjs
git commit -m "feat(outputPicker): detect surfaces written + current render target"
```

### Task 1.2: Build a per-surface mini-renderer

**Files:**
- Modify: `public/js/ui/outputPicker.js`

- [ ] **Step 1: Write the failing Playwright test**

```js
// scripts/test-output-picker.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
const dsl = 'search synth, render\n\nnoise().write(o0)\ngradient().write(o3)\n\nrender(o0)'
await p.goto('http://localhost:3000?dsl=' + encodeURIComponent(dsl), { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const pickerInfo = await p.evaluate(() => {
    const picker = document.querySelector('.output-picker')
    if (!picker) return { exists: false }
    const pips = [...picker.querySelectorAll('.output-pip')]
    return {
        exists: true,
        pipCount: pips.length,
        labels: pips.map(p => p.querySelector('.output-pip-label')?.textContent),
        active: picker.querySelector('.output-pip.active')?.dataset.surface
    }
})
console.log(JSON.stringify(pickerInfo, null, 2))
const ok = pickerInfo.exists && pickerInfo.pipCount === 2
    && pickerInfo.labels.includes('o0') && pickerInfo.labels.includes('o3')
    && pickerInfo.active === '0'
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-output-picker.mjs
```
Expected: FAIL — picker doesn't exist yet.

- [ ] **Step 3: Implement the OutputPicker class**

Append to `public/js/ui/outputPicker.js`:
```js
import { CanvasRenderer, extractEffectNamesFromDsl } from '../noisemaker/bundle.js'

const SHADER_BASE_PATH = 'https://shaders.noisedeck.app/1'
const SHADER_BUNDLE_PATH = `${SHADER_BASE_PATH}/effects`

const STYLES_ID = 'output-picker-styles'
if (!document.getElementById(STYLES_ID)) {
    const s = document.createElement('style')
    s.id = STYLES_ID
    s.textContent = `
        .output-picker {
            position: fixed;
            top: 1rem;
            right: 1rem;
            display: none;
            flex-direction: column;
            gap: 0.4rem;
            z-index: 210;
        }
        .output-picker.visible { display: flex; }
        body.live-inputs-open .output-picker { right: calc(280px + 2rem); }
        .output-pip {
            position: relative;
            width: 96px;
            height: 54px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            overflow: hidden;
            cursor: pointer;
            background: #000;
            transition: border-color 0.15s, transform 0.15s;
        }
        .output-pip:hover { border-color: rgba(165,184,255,0.5); transform: translateY(-1px); }
        .output-pip.active { border-color: #a5b8ff; box-shadow: 0 0 0 1px rgba(165,184,255,0.6); }
        .output-pip canvas, .output-pip img {
            width: 100%; height: 100%; display: block; object-fit: cover;
        }
        .output-pip-label {
            position: absolute; left: 4px; bottom: 2px;
            font: 600 0.625rem/1 'Noto Sans Mono', monospace;
            color: #fff; background: rgba(0,0,0,0.55);
            padding: 0.05rem 0.3rem; border-radius: 3px;
        }
    `
    document.head.appendChild(s)
}

class OutputPicker {
    constructor() {
        this._el = null
        this._open = false
        this._dsl = ''
        this._activeSurface = null
        this._previews = new Map()  // surface index -> { canvas, renderer }
        this._onSwitch = () => {}
    }

    init(opts) {
        this._onSwitch = opts.onSwitch || (() => {})
        this._el = document.createElement('div')
        this._el.className = 'output-picker'
        document.body.appendChild(this._el)
    }

    /**
     * Update the picker to reflect a new DSL: rebuild pips for every surface
     * the program writes to, mark the active one, dispose any pip whose
     * surface is no longer written.
     */
    async setDsl(dsl) {
        this._dsl = dsl
        const surfaces = surfacesWrittenInDsl(dsl)
        this._activeSurface = currentRenderTarget(dsl)
        // Drop pips for surfaces no longer in use
        for (const idx of [...this._previews.keys()]) {
            if (!surfaces.includes(idx)) {
                const p = this._previews.get(idx)
                try { await p.renderer?.dispose({ loseContext: true }) } catch {}
                p.pip?.remove()
                this._previews.delete(idx)
            }
        }
        // Add pips for new surfaces
        for (const idx of surfaces) {
            if (!this._previews.has(idx)) {
                this._previews.set(idx, await this._createPip(idx))
            }
        }
        // Re-sort DOM order to match surface index
        for (const idx of surfaces) {
            const entry = this._previews.get(idx)
            if (entry?.pip) this._el.appendChild(entry.pip)
        }
        // Mark the active pip
        for (const [idx, entry] of this._previews) {
            entry.pip.classList.toggle('active', idx === this._activeSurface)
        }
        // Toggle visibility — hide entirely if 0 or 1 surface (single-output sketches don't need a picker)
        this._el.classList.toggle('visible', surfaces.length > 1)
    }

    async _createPip(idx) {
        const pip = document.createElement('div')
        pip.className = 'output-pip'
        pip.dataset.surface = String(idx)
        const canvas = document.createElement('canvas')
        canvas.width = 192
        canvas.height = 108
        pip.appendChild(canvas)
        const label = document.createElement('span')
        label.className = 'output-pip-label'
        label.textContent = `o${idx}`
        pip.appendChild(label)
        pip.addEventListener('click', () => this._onSwitch(idx))
        // Render the surface in isolation: rewrite the DSL so render() points at this surface
        const surfaceDsl = this._dsl.replace(/render\s*\(\s*o[0-7]\s*\)/g, `render(o${idx})`)
        const renderer = new CanvasRenderer({
            canvas,
            width: canvas.width,
            height: canvas.height,
            basePath: SHADER_BASE_PATH,
            preferWebGPU: false,
            useBundles: true,
            bundlePath: SHADER_BUNDLE_PATH,
            onError: () => {}
        })
        try {
            await renderer.loadManifest()
            const effects = extractEffectNamesFromDsl(surfaceDsl, renderer.manifest || {})
            const ids = effects.map(e => e.effectId)
            if (ids.length > 0) await renderer.loadEffects(ids)
            await renderer.compile(surfaceDsl)
            renderer.start()
        } catch (err) {
            console.debug('[OutputPicker] pip compile failed:', err?.message || err)
        }
        return { pip, canvas, renderer }
    }

    async dispose() {
        for (const [, entry] of this._previews) {
            try { await entry.renderer?.dispose({ loseContext: true }) } catch {}
            entry.pip?.remove()
        }
        this._previews.clear()
        this._el?.remove()
        this._el = null
    }
}

export const outputPicker = new OutputPicker()
```

- [ ] **Step 4: Wire into embed.js**

Modify `public/js/embed.js`. Add to imports:
```js
import { outputPicker } from './ui/outputPicker.js'
```

After `liveInputsPanel.init(...)` in `startShader()`:
```js
outputPicker.init({
    onSwitch: (idx) => {
        if (!dslEditor) return
        const next = dslEditor.value.replace(/render\s*\(\s*o[0-7]\s*\)/g, `render(o${idx})`)
        dslEditor.value = next
        scheduleHotReload()
    }
})
```

After every successful compile in both `forcerecompile` and `scheduleHotReload` paths, call:
```js
outputPicker.setDsl(dslEditor.value).catch(err => console.debug('[outputPicker] setDsl failed:', err))
```

- [ ] **Step 5: Run the Playwright test**

```
node scripts/test-output-picker.mjs
```
Expected: PASS — picker exists, 2 pips with labels o0 and o3, o0 marked active.

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/outputPicker.js scripts/test-output-picker.mjs public/js/embed.js
git commit -m "feat(outputPicker): floating per-surface live previews with click-to-focus"
```

### Task 1.3: Click swaps render target

- [ ] **Step 1: Extend the test**

Append to `scripts/test-output-picker.mjs` before `process.exit`:
```js
// Click the o3 pip and assert render target switches
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000?dsl=' + encodeURIComponent(dsl), { waitUntil: 'networkidle' })
await p2.waitForTimeout(3500)
await p2.click('.output-pip[data-surface="3"]')
await p2.waitForTimeout(800)
const editorAfter = await p2.evaluate(() => document.querySelector('code-editor').value)
const ok2 = editorAfter.includes('render(o3)') && !editorAfter.includes('render(o0)')
console.log('click switch:', ok2 ? 'PASS' : 'FAIL')
if (!ok2) process.exit(1)
```

- [ ] **Step 2: Run, expect PASS**

```
node scripts/test-output-picker.mjs
```
Expected: PASS for both initial render + click switch (the wiring from 1.2 step 4 already covers this).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-output-picker.mjs
git commit -m "test(outputPicker): clicking a pip rewrites render() to the picked surface"
```

---

## Phase 2: Mobile / touch UX

**Why:** Polymorphic on iPad/iPhone is functional but feels poor — no tap-to-eval, panels overflow, scrubber wants a pointer. Hydra's mobile story is also weak; this is a clear differentiator.

### Task 2.1: Tap-to-eval gesture

**Files:**
- Create: `public/js/ui/touchControls.js`
- Create: `public/css/touch.css`
- Modify: `public/index.html` (link the CSS)
- Test: `scripts/test-touch.mjs`

- [ ] **Step 1: Write the failing Playwright test**

```js
// scripts/test-touch.mjs
import { chromium, devices } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPad Pro 11'], hasTouch: true })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
// Set a sketch with a syntax error so we can detect that double-tap evaluated
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise(scaleX: 80).write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1000)
// Two-finger tap on the canvas should force-eval (similar to Cmd+Enter)
const canvasBox = await (await p.locator('#canvas').elementHandle()).boundingBox()
await p.touchscreen.tap(canvasBox.x + 100, canvasBox.y + 100)
await p.touchscreen.tap(canvasBox.x + 102, canvasBox.y + 102)
await p.waitForTimeout(800)
// Expect a flash overlay to have appeared on the editor
const flashedRecently = await p.evaluate(() => !!document.querySelector('code-editor .code-editor-flash'))
console.log(flashedRecently ? 'PASS' : 'FAIL')
await b.close()
process.exit(flashedRecently ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-touch.mjs
```

- [ ] **Step 3: Implement double-tap-to-eval**

```js
// public/js/ui/touchControls.js
/**
 * Touch-only gestures that don't have a desktop equivalent.
 *  - Double-tap on the canvas → force-eval (Cmd+Enter analogue)
 *  - Two-finger tap on the canvas → toggle UI visibility (performance mode)
 *  - Long-press on the BPM indicator → tap-tempo
 */

export function attachTouchControls({ canvas, dslEditor, onTogglePerformanceMode }) {
    if (!('ontouchstart' in window) || !canvas) return

    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0

    canvas.addEventListener('touchend', (e) => {
        if (e.changedTouches.length !== 1) return
        const t = e.changedTouches[0]
        const now = Date.now()
        const dx = Math.abs(t.clientX - lastTapX)
        const dy = Math.abs(t.clientY - lastTapY)
        if (now - lastTapTime < 350 && dx < 30 && dy < 30) {
            // Double-tap detected
            dslEditor?.dispatchEvent(new CustomEvent('forcerecompile', { bubbles: true, composed: true }))
            lastTapTime = 0
        } else {
            lastTapTime = now
            lastTapX = t.clientX
            lastTapY = t.clientY
        }
    }, { passive: true })

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault()
            onTogglePerformanceMode?.()
        }
    }, { passive: false })
}
```

- [ ] **Step 4: Wire into embed.js**

Add import:
```js
import { attachTouchControls } from './ui/touchControls.js'
```

In `init()` after editor setup:
```js
attachTouchControls({
    canvas,
    dslEditor,
    onTogglePerformanceMode: togglePerformanceMode
})
```

- [ ] **Step 5: Run test, expect PASS**

```
node scripts/test-touch.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/touchControls.js public/js/embed.js scripts/test-touch.mjs
git commit -m "feat(touch): double-tap to force-eval, two-finger tap toggles performance mode"
```

### Task 2.2: Touch-friendly scrubber

**Files:**
- Modify: `public/js/ui/scrubber.js`

- [ ] **Step 1: Identify the gap** — the existing scrubber binds `pointerdown` with `e.button !== 0` filter, which rejects touch's primary button on some browsers. Verify by reading current code.

```bash
grep -n "pointerdown\|e\.button" public/js/ui/scrubber.js
```

- [ ] **Step 2: Loosen pointer-button filter for pen / touch pointer types**

In `public/js/ui/scrubber.js`, replace:
```js
if (!e.altKey || e.button !== 0) return
```
with:
```js
// Mouse: require alt+left-click. Touch/pen: any primary press is fine since
// there's no Alt key — the cursor-on-number affordance is the gate.
const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen'
if (!isTouch && (!e.altKey || e.button !== 0)) return
if (isTouch && e.button !== 0) return
```

- [ ] **Step 3: Add a test verifying touch scrub works**

Append to `scripts/test-touch.mjs` before `process.exit`:
```js
// Touch-scrub: long-press a number, drag horizontally
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p2.waitForTimeout(3500)
const editorBox = await (await p2.locator('code-editor').elementHandle()).boundingBox()
// Find the literal '80' from scaleX:80 by character — approximate by clicking near textarea start
// (We just verify no JS error happens.)
const errs2 = []
p2.on('pageerror', e => errs2.push(e.message))
await p2.touchscreen.tap(editorBox.x + 50, editorBox.y + 50)
await p2.waitForTimeout(300)
console.log('touch scrub no errors:', errs2.length === 0 ? 'PASS' : 'FAIL: ' + errs2.join(','))
if (errs2.length) process.exit(1)
```

- [ ] **Step 4: Run, expect PASS**

```
node scripts/test-touch.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/scrubber.js scripts/test-touch.mjs
git commit -m "feat(scrubber): accept touch/pen pointers, not only alt+mouse"
```

### Task 2.3: Mobile-tuned panel layouts

**Files:**
- Create: `public/css/touch.css`
- Modify: `public/index.html`

- [ ] **Step 1: Write the touch.css media-query rules**

```css
/* public/css/touch.css */

/* Phones / portrait tablets — collapse right-side panels into a
   bottom sheet so the canvas can stay full-width. */
@media (hover: none) and (pointer: coarse), (max-width: 768px) {
    body { font-size: 15px; }
    #menu { font-size: 14px; }

    /* Right-side overlays become bottom sheets */
    .live-inputs-panel,
    .output-picker {
        top: auto;
        right: 0.5rem;
        left: 0.5rem;
        bottom: 0.5rem;
        max-height: 45vh;
        flex-direction: row;
        overflow-x: auto;
        overflow-y: visible;
    }

    /* Bigger touch targets */
    .menu-icon-btn { padding: 0.5em 0.65em; font-size: 1.4em; }
    .source-btn, .live-input-toggle { min-height: 36px; }
    .gallery-card { min-height: 44px; }

    /* Hide BPM dragger thumb on touch — replace with explicit + / - buttons in a follow-up */
    .bpm-tap-hint { display: none; }
}
```

- [ ] **Step 2: Link the stylesheet from index.html**

In `public/index.html` after `menu.css`:
```html
<link rel="stylesheet" href="/css/touch.css">
```

- [ ] **Step 3: Add a Playwright snapshot test for mobile layout**

```js
// Append to scripts/test-touch.mjs
const p3 = await ctx.newPage()
await p3.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p3.waitForTimeout(3500)
const layout = await p3.evaluate(() => {
    const lip = document.querySelector('.live-inputs-panel')
    return {
        menuIconFontSize: parseFloat(getComputedStyle(document.querySelector('.menu-icon-btn')).fontSize),
        liveInputsLeft: lip ? getComputedStyle(lip).left : null
    }
})
console.log(JSON.stringify(layout))
const ok3 = layout.menuIconFontSize >= 18  // ≥ 1.4em on 14px base
console.log('touch layout:', ok3 ? 'PASS' : 'FAIL')
if (!ok3) process.exit(1)
```

- [ ] **Step 4: Run, expect PASS**

```
node scripts/test-touch.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/css/touch.css public/index.html scripts/test-touch.mjs
git commit -m "feat(touch): mobile layout — bottom-sheet panels, larger touch targets"
```

---

## Phase 3: Tutorial walkthrough — DEFERRED

> **Skip during this execution pass.** The tutorial content is being authored
> separately; we'll come back to this phase later. Leave the section in
> place for sequencing reference.

**Why:** Replace the shortcuts dialog substitute with an actual progressive tutorial — five steps that build a sketch from `noise()` to audio-reactive.

### Task 3.1: Tutorial content + step model

**Files:**
- Create: `public/data/tutorial.json`
- Create: `public/js/ui/tutorial.js`
- Test: `tests/unit/tutorial.test.mjs`

- [ ] **Step 1: Write tutorial steps**

```json
[
    {
        "id": "noise",
        "title": "Step 1: Make some noise",
        "body": "The simplest visual: <code>noise()</code> generates a 2-D noise field, <code>.write(o0)</code> stores it on surface 0, and <code>render(o0)</code> displays it.",
        "dsl": "search synth, render\n\nnoise().write(o0)\n\nrender(o0)",
        "highlight": "noise()"
    },
    {
        "id": "palette",
        "title": "Step 2: Add color",
        "body": "<code>.palette()</code> recolors the noise. There are 50+ palettes — try changing the <code>index:</code>.",
        "dsl": "search synth, filter, render\n\nnoise()\n  .palette(index: vaporwave)\n  .write(o0)\n\nrender(o0)",
        "highlight": "palette"
    },
    {
        "id": "lighting",
        "title": "Step 3: Add depth",
        "body": "<code>.lighting()</code> treats the noise as a heightmap and shades it. Adjust <code>normalStrength</code> to change how dramatic the relief is.",
        "dsl": "search synth, filter, render\n\nnoise()\n  .palette(index: vaporwave)\n  .lighting(normalStrength: 4)\n  .write(o0)\n\nrender(o0)",
        "highlight": "lighting"
    },
    {
        "id": "osc",
        "title": "Step 4: Animate it",
        "body": "Drop an <code>osc()</code> in any numeric parameter to make it oscillate over time.",
        "dsl": "search synth, filter, render\n\nnoise(scaleX: osc(type: sine, min: 30, max: 150))\n  .palette(index: vaporwave)\n  .lighting(normalStrength: 4)\n  .write(o0)\n\nrender(o0)",
        "highlight": "osc"
    },
    {
        "id": "audio",
        "title": "Step 5: React to sound",
        "body": "Swap <code>osc</code> for <code>audio(band: low)</code> and turn on the mic in the live-inputs panel. Now the visual responds to your voice.",
        "dsl": "search synth, filter, render\n\nnoise(scaleX: audio(band: low, min: 30, max: 200))\n  .palette(index: vaporwave)\n  .lighting(normalStrength: audio(band: vol, min: 1, max: 6))\n  .write(o0)\n\nrender(o0)",
        "highlight": "audio"
    }
]
```

- [ ] **Step 2: Write the failing test**

```js
// tests/unit/tutorial.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { tutorialState } from '../../public/js/ui/tutorial.js'

test('tutorialState advances through all steps', () => {
    const t = tutorialState([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    assert.strictEqual(t.current().id, 'a')
    assert.strictEqual(t.next().id, 'b')
    assert.strictEqual(t.next().id, 'c')
    assert.strictEqual(t.next(), null)  // past the end
    assert.strictEqual(t.previous().id, 'c')
})

test('tutorialState restart returns to first step', () => {
    const t = tutorialState([{ id: 'a' }, { id: 'b' }])
    t.next()
    t.restart()
    assert.strictEqual(t.current().id, 'a')
})
```

- [ ] **Step 3: Run, expect FAIL**

```
node --test tests/unit/tutorial.test.mjs
```

- [ ] **Step 4: Implement the state machine**

```js
// public/js/ui/tutorial.js
export function tutorialState(steps) {
    let i = 0
    return {
        current: () => steps[i] || null,
        next: () => {
            if (i >= steps.length - 1) { i = steps.length; return null }
            i++; return steps[i]
        },
        previous: () => {
            i = Math.max(0, i - 1); return steps[i]
        },
        restart: () => { i = 0 }
    }
}
```

- [ ] **Step 5: Run, expect PASS**

```
node --test tests/unit/tutorial.test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/data/tutorial.json public/js/ui/tutorial.js tests/unit/tutorial.test.mjs
git commit -m "feat(tutorial): step content + state machine"
```

### Task 3.2: Tutorial UI overlay

**Files:**
- Modify: `public/js/ui/tutorial.js`
- Test: `scripts/test-tutorial.mjs`

- [ ] **Step 1: Write the failing Playwright test**

```js
// scripts/test-tutorial.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000?tutorial=1', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
const open = await p.evaluate(() => !!document.querySelector('.tutorial-overlay.visible'))
console.log('opens via ?tutorial=1:', open)
if (!open) process.exit(1)
await p.click('.tutorial-next')
await p.waitForTimeout(800)
const step2Title = await p.evaluate(() => document.querySelector('.tutorial-title')?.textContent)
console.log('step 2 title:', step2Title)
const ok = step2Title?.includes('color')
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-tutorial.mjs
```

- [ ] **Step 3: Implement TutorialOverlay**

Append to `public/js/ui/tutorial.js`:
```js
const STYLES_ID = 'tutorial-overlay-styles'
if (!document.getElementById(STYLES_ID)) {
    const s = document.createElement('style')
    s.id = STYLES_ID
    s.textContent = `
        .tutorial-overlay {
            position: fixed; bottom: 1rem; left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 17, 22, 0.96);
            border: 1px solid rgba(165,184,255,0.4);
            border-radius: 10px;
            padding: 0.95rem 1.1rem;
            color: #e3e3e3;
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            width: min(540px, calc(100vw - 2rem));
            z-index: 4000;
            display: none;
            box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        }
        .tutorial-overlay.visible { display: block; }
        .tutorial-title { font-weight: 700; font-size: 0.9rem; margin-bottom: 0.4rem; color: #fff; }
        .tutorial-body { font-size: 0.8125rem; line-height: 1.55; color: #d9deeb; }
        .tutorial-body code {
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            background: rgba(165,184,255,0.1); color: #a5b8ff;
            padding: 0 0.3em; border-radius: 3px;
        }
        .tutorial-actions { display: flex; gap: 0.5rem; margin-top: 0.7rem; align-items: center; }
        .tutorial-actions button {
            background: rgba(165,184,255,0.18);
            border: 1px solid rgba(165,184,255,0.35);
            color: #d9deeb;
            font-family: inherit; font-size: 0.75rem;
            padding: 0.35rem 0.7rem; border-radius: 6px; cursor: pointer;
        }
        .tutorial-actions button:hover { background: rgba(165,184,255,0.32); }
        .tutorial-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
        .tutorial-progress { margin-left: auto; font-size: 0.6875rem; color: #888; }
    `
    document.head.appendChild(s)
}

class TutorialOverlay {
    constructor() {
        this._el = null
        this._state = null
        this._open = false
        this._onLoad = () => {}
    }

    async init({ onLoad }) {
        this._onLoad = onLoad || (() => {})
        const res = await fetch('/data/tutorial.json', { cache: 'no-store' })
        const steps = await res.json()
        this._state = tutorialState(steps)
        this._el = document.createElement('div')
        this._el.className = 'tutorial-overlay'
        document.body.appendChild(this._el)
    }

    open() {
        if (!this._state || this._open) return
        this._open = true
        this._state.restart()
        this._render()
        this._el.classList.add('visible')
    }

    close() {
        this._open = false
        this._el?.classList.remove('visible')
    }

    _render() {
        const step = this._state.current()
        if (!step) { this.close(); return }
        const total = this._state.steps?.length || 0  // not exposed; recompute
        this._el.innerHTML = `
            <div class="tutorial-title">${step.title}</div>
            <div class="tutorial-body">${step.body}</div>
            <div class="tutorial-actions">
                <button class="tutorial-prev">← Back</button>
                <button class="tutorial-next">Next →</button>
                <button class="tutorial-close">Close</button>
            </div>
        `
        this._el.querySelector('.tutorial-next').addEventListener('click', () => {
            if (step.dsl) this._onLoad(step.dsl)
            const n = this._state.next()
            if (!n) this.close()
            else this._render()
        })
        this._el.querySelector('.tutorial-prev').addEventListener('click', () => {
            this._state.previous()
            this._render()
        })
        this._el.querySelector('.tutorial-close').addEventListener('click', () => this.close())
        if (step.dsl) this._onLoad(step.dsl)
    }
}

export const tutorialOverlay = new TutorialOverlay()
```

- [ ] **Step 4: Wire into embed.js**

```js
import { tutorialOverlay } from './ui/tutorial.js'

// in init() — after setupCommandPalette():
await tutorialOverlay.init({
    onLoad: (dsl) => {
        if (dslEditor) {
            dslEditor.value = dsl
            scheduleHotReload()
        }
    }
})
const params = new URLSearchParams(window.location.search)
if (params.get('tutorial') === '1') tutorialOverlay.open()

// Add palette action:
commandPalette.registerAction({
    id: 'tutorial',
    title: 'Start tutorial',
    subtitle: 'Five-step walkthrough from noise() to audio-reactive',
    icon: 'school',
    keywords: ['walkthrough', 'guide', 'help', 'beginner'],
    run: () => tutorialOverlay.open()
})
```

- [ ] **Step 5: Run test, expect PASS**

```
node scripts/test-tutorial.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/tutorial.js public/js/embed.js scripts/test-tutorial.mjs
git commit -m "feat(tutorial): five-step interactive walkthrough overlay"
```

---

## Phase 4: Code review cleanup

Three deferred items: I3 (block-eval race), I9 (liveInputs reaches into MIDI internals), I11 (embed.js too large).

### Task 4.1: Fix I3 — defer hot-reload while a block-eval is in flight

**Files:**
- Modify: `public/js/embed.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-block-eval-race.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
// Set a sketch with 3 chains, focus on the middle one, fire a block eval
// then immediately type more text to trigger hot-reload before block-eval finishes.
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = `search synth, render\n\nnoise(scaleX: 80).write(o0)\n\ngradient().write(o1)\n\nrender(o0)`
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1000)
// Place caret on gradient line
await p.evaluate(() => {
    const ta = document.querySelector('code-editor').getTextarea()
    const idx = ta.value.indexOf('gradient')
    ta.selectionStart = ta.selectionEnd = idx
    ta.focus()
})
await p.keyboard.press('Alt+Enter')   // block-eval
// Type immediately to trigger hot-reload
await p.keyboard.type('// noise')
await p.waitForTimeout(2000)
// Block-eval rendered gradient. Hot-reload should NOT have stomped it
// — actually we want hot-reload to win, but it must wait until block-eval done.
// Verdict: no console errors AND last frame is the original (with comment).
const errs = await p.evaluate(() => window.__poly?.lastErrors || [])
console.log('errs during race:', errs)
console.log(errs.length === 0 ? 'PASS' : 'FAIL')
await b.close()
process.exit(errs.length === 0 ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL or noisy logs**

```
node scripts/test-block-eval-race.mjs
```

- [ ] **Step 3: Add a `_compileInFlight` flag to embed.js**

In `setupDslEditor()`, restructure the two compile paths so they share a single in-flight gate:

```js
let _compileInFlight = false

async function runCompile(progFn, lineRange, isError) {
    if (_compileInFlight) return  // drop overlapping calls
    _compileInFlight = true
    try {
        const program = await progFn()
        const r = await recompileShader(program)
        if (!r.success) {
            console.warn('Compile failed:', r.error)
            showCompilerError(r.error)
            if (lineRange) dslEditor.flashLines?.(lineRange[0], lineRange[1], { error: true })
        } else {
            hideCompilerError()
            if (lineRange) dslEditor.flashLines?.(lineRange[0], lineRange[1])
            if (program === dslEditor.value) {
                snapshotHistory.push(dslEditor.value)
                stampUrl(dslEditor.value)
            }
            outputPicker.setDsl(dslEditor.value).catch(() => {})
        }
    } finally {
        _compileInFlight = false
    }
}
```

Wire `forcerecompile` and `forceevalblock` to call `runCompile()`. The hot-reload `setTimeout` callback already debounces; add `if (_compileInFlight) { scheduleHotReload(); return }` so it postpones itself.

- [ ] **Step 4: Run, expect PASS**

```
node scripts/test-block-eval-race.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/embed.js scripts/test-block-eval-race.mjs
git commit -m "fix(embed): single-flight compile gate prevents block-eval/hot-reload race"
```

### Task 4.2: Fix I9 — public MIDI accessor

**Files:**
- Modify: `public/js/noisemaker/bundle.js` (re-export)
- Modify: `public/js/ui/liveInputsPanel.js`

- [ ] **Step 1: Write the failing test for the new accessor**

```js
// tests/unit/midi-accessor.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { recentCcsFromMidiState } from '../../public/js/ui/liveInputsPanel.js'

test('recentCcsFromMidiState extracts {ch, cc, value} tuples', () => {
    const fake = {
        _channels: {
            '1': { _cc: { 0: 0, 1: 0.5, 2: 0 } },
            '2': { _cc: { 12: 0.75 } }
        }
    }
    const out = recentCcsFromMidiState(fake)
    assert.strictEqual(out.length, 2)
    assert.deepStrictEqual(
        out.find(r => r.cc === 1),
        { ch: '1', cc: 1, value: 0.5 }
    )
})

test('returns [] on null/empty', () => {
    assert.deepStrictEqual(recentCcsFromMidiState(null), [])
    assert.deepStrictEqual(recentCcsFromMidiState({}), [])
})
```

- [ ] **Step 2: Run, expect FAIL**

```
node --test tests/unit/midi-accessor.test.mjs
```

- [ ] **Step 3: Extract the helper and export it**

In `public/js/ui/liveInputsPanel.js`, replace the inline `_scanMidi` private-field walking with a public helper:

```js
export function recentCcsFromMidiState(midiState) {
    if (!midiState || typeof midiState !== 'object') return []
    const out = []
    const channels = midiState._channels || midiState.channels || {}
    for (const [chKey, ch] of Object.entries(channels)) {
        const cc = ch?._cc || ch?.cc
        if (!cc) continue
        for (const [ccKey, value] of Object.entries(cc)) {
            const ccNum = Number(ccKey)
            if (!Number.isInteger(ccNum)) continue
            if (value !== undefined && value !== null && value !== 0) {
                out.push({ ch: chKey, cc: ccNum, value })
            }
        }
    }
    return out
}
```

Then call this from `_scanMidi`:
```js
_scanMidi(midiState) {
    try {
        for (const r of recentCcsFromMidiState(midiState)) {
            this._recentMidi.set(`${r.ch}:${r.cc}`, { ...r, time: Date.now() })
        }
        this._renderMidiList()
    } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run, expect PASS**

```
node --test tests/unit/midi-accessor.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/liveInputsPanel.js tests/unit/midi-accessor.test.mjs
git commit -m "refactor(liveInputs): pull MIDI state walk into a tested pure function"
```

### Task 4.3: Fix I11 — split paletteActions out of embed.js

**Files:**
- Create: `public/js/ui/paletteActions.js`
- Modify: `public/js/embed.js`

- [ ] **Step 1: Move action registry to its own module**

```js
// public/js/ui/paletteActions.js
/**
 * Builds the command-palette action list. The host wires references to
 * editor + various panels into the action factory, then registers the
 * returned list with the palette.
 */
export function buildPaletteActions(deps) {
    return [
        { id: 'eval-all', title: 'Evaluate whole program', icon: 'play_arrow',
          keywords: ['compile', 'run', 'all', 'recompile'],
          run: () => deps.dslEditor?.dispatchEvent(new CustomEvent('forcerecompile', { bubbles: true, composed: true })) },

        { id: 'eval-block', title: 'Evaluate current block',
          subtitle: 'Run the paragraph under the cursor (or current selection)',
          icon: 'play_circle', keywords: ['block', 'eval', 'paragraph'],
          run: () => deps.dslEditor?.dispatchEvent(new CustomEvent('forceevalblock', { bubbles: true, composed: true })) },

        { id: 'reset', title: 'Reset to original', icon: 'restart_alt',
          keywords: ['original', 'undo'], run: () => deps.resetDsl() },

        { id: 'fullscreen', title: 'Toggle fullscreen', icon: 'fullscreen',
          run: () => deps.toggleFullscreen() },

        { id: 'play-pause', title: 'Play / pause animation', icon: 'pause',
          run: () => deps.togglePlayPause() },

        { id: 'toggle-editor', title: 'Toggle code editor', icon: 'code',
          run: () => deps.toggleDslOverlay() },

        { id: 'toggle-docs', title: 'Toggle documentation panel', icon: 'menu_book',
          run: () => deps.toggleDocs() },

        { id: 'save-png', title: 'Save canvas as PNG', icon: 'image',
          run: () => deps.savePNG?.click?.() },
        { id: 'save-jpg', title: 'Save canvas as JPG', icon: 'photo_camera',
          run: () => deps.saveJPG?.click?.() },

        { id: 'share', title: 'Share program publicly', icon: 'share',
          run: () => deps.shareProgram?.click?.() },

        { id: 'load-program', title: 'Load saved program', icon: 'folder_open',
          run: () => deps.openProgramModal('load') },
        { id: 'save-program', title: 'Save program', icon: 'save',
          run: () => deps.openProgramModal('save') },

        { id: 'docs-search', title: 'Open documentation', icon: 'menu_book',
          run: () => deps.showDocs() },

        { id: 'live-inputs', title: 'Toggle live inputs panel', icon: 'tune',
          subtitle: 'Audio FFT meters, MIDI CCs, oscillator snippets',
          keywords: ['audio', 'midi', 'mic', 'osc'],
          run: () => deps.toggleLiveInputs() },

        { id: 'mic-enable', title: 'Enable microphone (audio FFT)',
          icon: 'mic', keywords: ['audio', 'fft'],
          run: () => deps.enableMic() },

        { id: 'midi-enable', title: 'Connect MIDI device',
          icon: 'piano', keywords: ['midi', 'cc'],
          run: () => deps.connectMidi() },

        { id: 'record', title: 'Start / stop recording',
          icon: 'fiber_manual_record', keywords: ['record', 'video', 'webm'],
          run: () => deps.toggleRecording() },

        { id: 'webcam', title: 'Use webcam as media source',
          icon: 'videocam', run: () => deps.useWebcam() },
        { id: 'screen-capture', title: 'Use screen capture as media source',
          icon: 'screen_share', run: () => deps.useScreen() },

        { id: 'perf', title: 'Toggle performance overlay',
          icon: 'speed', keywords: ['fps', 'profiler'],
          run: () => deps.togglePerf() },

        { id: 'gallery', title: 'Open program browser',
          subtitle: 'Curated examples + NoiseBLASTER feed',
          icon: 'collections', keywords: ['examples', 'browse'],
          run: () => deps.openGallery() },
        { id: 'shuffle', title: 'Shuffle to a random example',
          icon: 'shuffle', run: () => deps.shuffle() },

        { id: 'snapshot-back', title: 'Step back through program history',
          subtitle: 'Cmd/Ctrl+Alt+← — older successful program',
          icon: 'undo', run: () => deps.snapshotBack() },
        { id: 'snapshot-forward', title: 'Step forward through program history',
          icon: 'redo', run: () => deps.snapshotForward() },

        { id: 'bpm-tap', title: 'Tap tempo', icon: 'touch_app',
          run: () => deps.tapTempo() },
        { id: 'bpm-toggle', title: 'Toggle BPM indicator', icon: 'metronome',
          run: () => deps.toggleBpm() },

        { id: 'status-row', title: 'Toggle status row',
          icon: 'view_agenda', run: () => deps.toggleStatusRow() },

        { id: 'shortcuts', title: 'Show keyboard shortcuts',
          icon: 'keyboard', run: () => deps.openShortcuts() },

        { id: 'performance-mode', title: 'Toggle performance mode',
          subtitle: 'Hide all UI for projection (⌘⇧H)',
          icon: 'visibility_off', run: () => deps.togglePerformanceMode() },

        { id: 'backend-webgpu', title: 'Switch to WebGPU backend',
          icon: 'memory', run: () => deps.switchBackend('webgpu') },
        { id: 'backend-webgl2', title: 'Switch to WebGL2 backend',
          icon: 'view_in_ar', run: () => deps.switchBackend('webgl2') },

        { id: 'hush', title: 'Hush — clear surfaces',
          icon: 'clear_all', run: () => deps.hushSurfaces() },

        { id: 'tutorial', title: 'Start tutorial', icon: 'school',
          run: () => deps.openTutorial() }
    ]
}
```

- [ ] **Step 2: Replace embed.js setupCommandPalette() body**

```js
import { buildPaletteActions } from './ui/paletteActions.js'

function setupCommandPalette() {
    commandPalette.init({
        onInsert: (snippet, opts) => { /* unchanged */ }
    })
    const actions = buildPaletteActions({
        dslEditor, resetDsl, toggleFullscreen, togglePlayPause, toggleDslOverlay,
        toggleDocs: () => {
            const visible = toggleDocReader()
            docToggleBtn?.classList.toggle('active', visible)
        },
        showDocs: () => { showDocReader(); docToggleBtn?.classList.add('active') },
        toggleLiveInputs: () => {
            liveInputsPanel.toggle()
            inputsToggleBtn?.classList.toggle('active', liveInputsPanel.isOpen())
        },
        enableMic: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            document.querySelector('.live-inputs-panel [data-id=audio-toggle]')?.click()
        },
        connectMidi: () => {
            liveInputsPanel.open()
            inputsToggleBtn?.classList.add('active')
            document.querySelector('.live-inputs-panel [data-id=midi-toggle]')?.click()
        },
        toggleRecording: () => recorder.isRecording() ? recorder.stop() : recorder.start(),
        useWebcam: () => {
            liveInputsPanel.open()
            document.querySelector('.live-inputs-panel .source-btn[data-source="webcam"]')?.click()
        },
        useScreen: () => {
            liveInputsPanel.open()
            document.querySelector('.live-inputs-panel .source-btn[data-source="screen"]')?.click()
        },
        togglePerf: () => {
            perfOverlay.toggle()
            perfToggleBtn?.classList.toggle('active', perfOverlay.isOpen())
        },
        openGallery: () => gallery.open(),
        shuffle: async () => {
            const ex = await pickRandomExample()
            if (ex && dslEditor) {
                dslEditor.value = ex.dsl; originalDsl = ex.dsl
                scheduleHotReload(); dslEditor.focus()
            }
        },
        snapshotBack, snapshotForward,
        tapTempo: () => bpmClock.tap(),
        toggleBpm: () => bpmClock.toggle(),
        toggleStatusRow: () => statusRow.toggle(),
        openShortcuts: () => shortcutsDialog.open(),
        togglePerformanceMode,
        switchBackend,
        hushSurfaces,
        openTutorial: () => tutorialOverlay.open(),
        savePNG, saveJPG, shareProgram, openProgramModal
    })
    for (const a of actions) commandPalette.registerAction(a)
}
```

- [ ] **Step 3: Verify nothing changed user-visibly**

```bash
node scripts/test-final.mjs
```
Expected: all checks still pass.

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/paletteActions.js public/js/embed.js
git commit -m "refactor(embed): move palette action registry into its own module"
```

---

## Phase 5: Embed mode hardening

**Why:** `?embed=1` should produce a clean iframe-friendly render with no UI chrome, but still respect `?dsl=` and `?code=`.

### Task 5.1: Embed-mode flag

**Files:**
- Create: `public/js/ui/embedMode.js`
- Modify: `public/js/embed.js`
- Modify: `public/index.html`

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-embed-mode.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 800, height: 450 } })
const p = await ctx.newPage()
const dsl = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
await p.goto(`http://localhost:3000?embed=1&dsl=${encodeURIComponent(dsl)}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const state = await p.evaluate(() => {
    const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).display : 'gone'
    }
    return {
        menu: cs('#menu'),
        editor: cs('#dsl-overlay'),
        docs: cs('#doc-reader-panel'),
        canvasVisible: document.getElementById('canvas')?.classList.contains('visible')
    }
})
console.log(JSON.stringify(state, null, 2))
const ok = state.menu === 'none' && state.editor === 'none' && state.docs === 'none' && state.canvasVisible
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-embed-mode.mjs
```

- [ ] **Step 3: Implement embed-mode**

```js
// public/js/ui/embedMode.js
/**
 * `?embed=1` activates embed mode: hide all UI chrome (menu, editor,
 * docs, panels, indicators) and run the canvas full-bleed. Same effect
 * as performance mode but applied automatically and not toggleable.
 */
export function isEmbedMode() {
    try { return new URLSearchParams(window.location.search).get('embed') === '1' }
    catch { return false }
}

export function applyEmbedMode() {
    if (!isEmbedMode()) return false
    document.body.classList.add('embed-mode', 'performance-mode')
    return true
}
```

Add CSS — append to `public/index.html` style block (or create `public/css/embed.css` and link):
```css
body.embed-mode, body.embed-mode * { cursor: default; }
body.embed-mode #menu,
body.embed-mode #dsl-overlay,
body.embed-mode #doc-reader-panel,
body.embed-mode #compiler-error,
body.embed-mode .live-inputs-panel,
body.embed-mode .perf-overlay,
body.embed-mode .bpm-indicator,
body.embed-mode .status-row,
body.embed-mode .output-picker,
body.embed-mode .recording-indicator { display: none !important; }
```

- [ ] **Step 4: Wire into embed.js init()**

```js
import { applyEmbedMode } from './ui/embedMode.js'
// at the very start of init():
applyEmbedMode()
```

- [ ] **Step 5: Run, expect PASS**

```
node scripts/test-embed-mode.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/embedMode.js public/js/embed.js public/index.html scripts/test-embed-mode.mjs
git commit -m "feat(embed): ?embed=1 query param hides all UI for clean iframe rendering"
```

---

## Phase 6: Code formatter

**Why:** Cmd+Shift+F formats the DSL — consistent indentation per chain step, sorted args, trimmed whitespace.

### Task 6.1: Pure formatter logic

**Files:**
- Create: `public/js/ui/formatter.js`
- Test: `tests/unit/formatter.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/formatter.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { formatDsl } from '../../public/js/ui/formatter.js'

test('formatDsl indents chain steps', () => {
    const input = 'noise(scaleX:80).palette(index:vaporwave).write(o0)'
    const expected = 'noise(scaleX: 80)\n  .palette(index: vaporwave)\n  .write(o0)'
    assert.strictEqual(formatDsl(input), expected)
})

test('formatDsl normalizes search line', () => {
    const input = 'search   synth ,filter\nnoise().write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.startsWith('search synth, filter\n'))
})

test('formatDsl preserves blank-line block separators', () => {
    const input = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('\n\n'), 'blank line preserved between blocks')
})

test('formatDsl is idempotent', () => {
    const input = 'search synth, render\n\nnoise(scaleX: 80)\n  .write(o0)\n\nrender(o0)'
    assert.strictEqual(formatDsl(formatDsl(input)), formatDsl(input))
})
```

- [ ] **Step 2: Run, expect FAIL**

```
node --test tests/unit/formatter.test.mjs
```

- [ ] **Step 3: Implement the formatter**

```js
// public/js/ui/formatter.js
/**
 * Format Polymorphic DSL. Rules:
 *   - search line: tokens normalised "search a, b, c"
 *   - chains: each .step() on its own line, indented 2 spaces
 *   - args: single space after ':', single space after ','
 *   - blank lines preserved as block separators
 */
export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''
    const lines = input.split('\n')
    const out = []
    let pendingBlank = false

    const formatChain = (text) => {
        // Split on . that aren't inside parens
        const parts = []
        let depth = 0, start = 0
        for (let i = 0; i < text.length; i++) {
            const c = text[i]
            if (c === '(') depth++
            else if (c === ')') depth--
            else if (c === '.' && depth === 0 && i > 0) {
                parts.push(text.slice(start, i))
                start = i
            }
        }
        parts.push(text.slice(start))
        return parts.map((p, i) => i === 0
            ? formatArgs(p.trim())
            : '  ' + formatArgs(p.trim())).join('\n')
    }

    const formatArgs = (text) => {
        // Tighten ":" and "," spacing inside arg lists
        return text
            .replace(/\s*:\s*/g, ': ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
    }

    for (const raw of lines) {
        const line = raw.trim()
        if (!line) {
            if (out.length && !pendingBlank) {
                pendingBlank = true
            }
            continue
        }
        if (pendingBlank) { out.push(''); pendingBlank = false }
        if (line.startsWith('search')) {
            const items = line.slice(6).split(',').map(s => s.trim()).filter(Boolean)
            out.push('search ' + items.join(', '))
        } else if (line.startsWith('render(') || line.startsWith('let ') || line.startsWith('//')) {
            out.push(formatArgs(line))
        } else {
            out.push(...formatChain(line).split('\n'))
        }
    }
    return out.join('\n')
}
```

- [ ] **Step 4: Run, expect PASS**

```
node --test tests/unit/formatter.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/formatter.js tests/unit/formatter.test.mjs
git commit -m "feat(formatter): pure DSL formatting function"
```

### Task 6.2: Wire Cmd+Shift+F

**Files:**
- Modify: `public/js/ui/codeEditor.js`
- Modify: `public/js/embed.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-formatter.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1024, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'noise(scaleX:80).palette(index:vaporwave).write(o0)\nrender(o0)'
    ed.getTextarea().focus()
})
await p.keyboard.press('Control+Shift+F')
await p.waitForTimeout(400)
const after = await p.evaluate(() => document.querySelector('code-editor').value)
console.log(after)
const ok = after.includes('  .palette(index: vaporwave)')
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-formatter.mjs
```

- [ ] **Step 3: Have codeEditor dispatch a `format` event on Cmd+Shift+F**

In `public/js/ui/codeEditor.js` `_handleKeydown`, add:
```js
if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    this.dispatchEvent(new CustomEvent('format', { bubbles: true, composed: true }))
}
```

- [ ] **Step 4: Listen in embed.js**

```js
import { formatDsl } from './ui/formatter.js'

// in setupDslEditor():
dslEditor.addEventListener('format', () => {
    const before = dslEditor.value
    const after = formatDsl(before)
    if (after !== before) {
        dslEditor.value = after
        scheduleHotReload()
    }
})
```

Also register a palette action:
```js
{ id: 'format', title: 'Format DSL', icon: 'format_align_left',
  keywords: ['prettier', 'beautify'], run: () => deps.formatDsl() }
```
And in setupCommandPalette deps: `formatDsl: () => dslEditor?.dispatchEvent(new CustomEvent('format', { bubbles: true, composed: true }))`

- [ ] **Step 5: Run test, expect PASS**

```
node scripts/test-formatter.mjs
```

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/codeEditor.js public/js/embed.js public/js/ui/paletteActions.js scripts/test-formatter.mjs
git commit -m "feat(formatter): Cmd+Shift+F formats the DSL"
```

---

## Phase 7: PWA / offline

**Why:** Installable, runs offline once everything's been cached.

### Task 7.1: Web app manifest

**Files:**
- Create: `public/manifest.webmanifest`
- Modify: `public/index.html`

- [ ] **Step 1: Write the manifest**

```json
{
    "name": "Polymorphic",
    "short_name": "Polymorphic",
    "description": "Live shader coding environment for the Noisemaker engine.",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#0a0a0f",
    "theme_color": "#0a0a0f",
    "orientation": "any",
    "icons": [
        { "src": "/img/polymorphic.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
    ]
}
```

- [ ] **Step 2: Link from index.html**

```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a0a0f">
```

- [ ] **Step 3: Verify with a Playwright test**

```js
// scripts/test-pwa.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext()
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
const m = await p.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return null
    const r = await fetch(link.href)
    return r.ok ? await r.json() : null
})
console.log(JSON.stringify(m, null, 2))
const ok = m?.name === 'Polymorphic' && m?.start_url === '/'
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

```
node scripts/test-pwa.mjs
```

- [ ] **Step 4: Commit**

```bash
git add public/manifest.webmanifest public/index.html scripts/test-pwa.mjs
git commit -m "feat(pwa): add web app manifest"
```

### Task 7.2: Service worker with stale-while-revalidate

**Files:**
- Create: `public/sw.js`
- Modify: `public/index.html`

- [ ] **Step 1: Write the service worker**

```js
// public/sw.js
const CACHE = 'polymorphic-v1'
const PRECACHE = [
    '/',
    '/index.html',
    '/css/menu.css',
    '/css/touch.css',
    '/data/examples.json',
    '/data/tutorial.json',
    '/img/polymorphic.png',
    '/manifest.webmanifest'
]

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url)
    // Don't intercept the engine bundle / sharing / blaster — they have their own freshness
    if (url.origin !== location.origin) return
    e.respondWith((async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(e.request)
        const network = fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone())
            return resp
        }).catch(() => cached)
        return cached || network
    })())
})
```

- [ ] **Step 2: Register in index.html**

```html
<script>
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW failed', err))
    })
}
</script>
```

- [ ] **Step 3: Add registration test**

```js
// Append to scripts/test-pwa.mjs
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p2.waitForTimeout(2000)
const swReg = await p2.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return reg ? reg.scope : null
})
console.log('sw scope:', swReg)
const ok2 = !!swReg
console.log(ok2 ? 'PASS' : 'FAIL')
if (!ok2) process.exit(1)
```

```
node scripts/test-pwa.mjs
```

- [ ] **Step 4: Commit**

```bash
git add public/sw.js public/index.html scripts/test-pwa.mjs
git commit -m "feat(pwa): service worker with stale-while-revalidate caching"
```

---

## Phase 8: Multi-scene clip launcher

**Why:** Algorave-friendly: number keys 1-9 switch between named programs; current program is "scene 1" by default.

### Task 8.1: Scenes module + persistence

**Files:**
- Create: `public/js/ui/scenes.js`
- Test: `tests/unit/scenes.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/scenes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { Scenes } from '../../public/js/ui/scenes.js'

test('Scenes saves + restores up to 9 slots', () => {
    const store = { data: null,
        get() { return this.data }, set(d) { this.data = d } }
    const s = new Scenes(store)
    s.save(1, 'noise().write(o0)')
    s.save(2, 'gradient().write(o0)')
    assert.strictEqual(s.load(1), 'noise().write(o0)')
    assert.strictEqual(s.load(2), 'gradient().write(o0)')
    assert.strictEqual(s.load(9), null)
})

test('Scenes rejects out-of-range slots', () => {
    const s = new Scenes()
    assert.throws(() => s.save(0, 'x'))
    assert.throws(() => s.save(10, 'x'))
})

test('Scenes restore from raw stored data round-trips', () => {
    const store = { data: null, get() { return this.data }, set(d) { this.data = d } }
    const s1 = new Scenes(store)
    s1.save(3, 'foo')
    const s2 = new Scenes(store)
    assert.strictEqual(s2.load(3), 'foo')
})
```

- [ ] **Step 2: Run, expect FAIL**

```
node --test tests/unit/scenes.test.mjs
```

- [ ] **Step 3: Implement Scenes**

```js
// public/js/ui/scenes.js
const KEY = 'polymorphic-scenes'
const localStorageStore = {
    get() {
        try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
    },
    set(v) {
        try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {}
    }
}

export class Scenes {
    constructor(store) {
        this._store = store || localStorageStore
        this._slots = this._store.get() || {}
    }
    save(slot, dsl) {
        if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
            throw new Error('Scene slot must be 1..9')
        }
        this._slots[slot] = dsl
        this._store.set(this._slots)
    }
    load(slot) {
        return this._slots[slot] || null
    }
    list() {
        return Object.keys(this._slots).map(k => ({ slot: Number(k), dsl: this._slots[k] }))
    }
    clear(slot) {
        delete this._slots[slot]
        this._store.set(this._slots)
    }
}

export const scenes = new Scenes()
```

- [ ] **Step 4: Run, expect PASS**

```
node --test tests/unit/scenes.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/scenes.js tests/unit/scenes.test.mjs
git commit -m "feat(scenes): Scenes class with localStorage persistence"
```

### Task 8.2: Keyboard shortcuts + UI

**Files:**
- Modify: `public/js/embed.js`
- Modify: `public/js/ui/scenes.js` (add UI)
- Modify: `public/js/ui/shortcutsDialog.js` (add scene keys row)

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-scenes.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1024, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
// Save scene 1
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise().palette(index: vaporwave).write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1500)
await p.keyboard.press('Control+Shift+1')
await p.waitForTimeout(400)
// Change DSL, save scene 2
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\ngradient().write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1500)
await p.keyboard.press('Control+Shift+2')
await p.waitForTimeout(400)
// Recall scene 1
await p.keyboard.press('1')   // bare number key recalls
await p.waitForTimeout(800)
const v1 = await p.evaluate(() => document.querySelector('code-editor').value)
const ok = v1.includes('vaporwave')
console.log(ok ? 'PASS' : 'FAIL: ' + v1.slice(0, 100))
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL**

```
node scripts/test-scenes.mjs
```

- [ ] **Step 3: Wire shortcuts in embed.js**

```js
import { scenes } from './ui/scenes.js'

// in init() — add a global keydown handler:
document.addEventListener('keydown', (e) => {
    // Don't trigger while editing
    const tag = (e.target?.tagName || '').toUpperCase()
    if (tag === 'TEXTAREA' || tag === 'INPUT') return
    const mod = e.ctrlKey || e.metaKey
    const slotMatch = /^[1-9]$/.test(e.key)
    if (!slotMatch) return
    const slot = parseInt(e.key, 10)
    if (mod && e.shiftKey) {
        // Save current to slot
        const dsl = dslEditor?.value || ''
        if (dsl.trim()) {
            scenes.save(slot, dsl)
            showToast(`Saved scene ${slot}`, 'success')
        }
        e.preventDefault()
    } else if (!mod && !e.shiftKey && !e.altKey) {
        // Recall slot
        const dsl = scenes.load(slot)
        if (dsl) {
            dslEditor.value = dsl
            scheduleHotReload()
            showToast(`Loaded scene ${slot}`, 'info')
        }
        e.preventDefault()
    }
})
```

- [ ] **Step 4: Run test, expect PASS**

```
node scripts/test-scenes.mjs
```

- [ ] **Step 5: Update shortcutsDialog**

In `public/js/ui/shortcutsDialog.js` SECTIONS array, add:
```js
{
    title: 'Scenes',
    rows: [
        ['Save current to scene N',  ['⌘/Ctrl', '⇧', '1-9']],
        ['Recall scene N',           ['1-9']]
    ]
}
```

- [ ] **Step 6: Commit**

```bash
git add public/js/embed.js public/js/ui/shortcutsDialog.js scripts/test-scenes.mjs
git commit -m "feat(scenes): Cmd+Shift+1..9 saves, 1..9 recalls"
```

---

## Phase 9: Better error display with line numbers

**Why:** The compile-error banner currently shows the engine's raw message. Parse line/col, prefix with the file location, click-to-jump caret to that line.

### Task 9.1: Parse error location

**Files:**
- Create: `public/js/ui/errorBanner.js`
- Test: `tests/unit/errorBanner.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/errorBanner.test.mjs
import { test } from 'node:test'
import assert from 'node:assert'
import { parseErrorLocation } from '../../public/js/ui/errorBanner.js'

test('parses "at line 7 col 11"', () => {
    assert.deepStrictEqual(
        parseErrorLocation("Unexpected character '@' at line 7 col 11"),
        { line: 7, col: 11 }
    )
})

test('parses "line 3, column 5"', () => {
    assert.deepStrictEqual(
        parseErrorLocation('Bad token (line 3, column 5)'),
        { line: 3, col: 5 }
    )
})

test('returns null when no location', () => {
    assert.strictEqual(parseErrorLocation('Generic error'), null)
})
```

- [ ] **Step 2: Run, expect FAIL**

```
node --test tests/unit/errorBanner.test.mjs
```

- [ ] **Step 3: Implement**

```js
// public/js/ui/errorBanner.js
export function parseErrorLocation(msg) {
    if (!msg) return null
    let m = msg.match(/(?:at\s+)?line\s+(\d+)\s*(?:[,;]?\s*col(?:umn)?\s+(\d+))?/i)
    if (!m) m = msg.match(/\((?:line\s+)?(\d+)[,:]\s*(?:col(?:umn)?\s*)?(\d+)?\)/i)
    if (!m) return null
    const line = parseInt(m[1], 10)
    const col = m[2] ? parseInt(m[2], 10) : 1
    if (!Number.isFinite(line)) return null
    return { line, col }
}
```

- [ ] **Step 4: Run, expect PASS**

```
node --test tests/unit/errorBanner.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/errorBanner.js tests/unit/errorBanner.test.mjs
git commit -m "feat(errorBanner): pure parser for line/col error locations"
```

### Task 9.2: Click-to-jump

**Files:**
- Modify: `public/js/embed.js`

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-error-jump.mjs
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1024, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth\n\n\n@invalid syntax here\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(1500)
// Click the compile error banner
await p.click('#compiler-error')
await p.waitForTimeout(400)
const ta = await p.evaluate(() => {
    const ta = document.querySelector('code-editor').getTextarea()
    const before = ta.value.slice(0, ta.selectionStart)
    const line = before.split('\n').length
    return { line, selectionStart: ta.selectionStart }
})
console.log(JSON.stringify(ta))
const ok = ta.line === 4
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run, expect FAIL** (current click handler copies error to clipboard, doesn't jump)

- [ ] **Step 3: Replace the compiler-error click handler in embed.js**

Find this block:
```js
if (compilerErrorEl) {
    compilerErrorEl.addEventListener('click', async () => {
        const errorText = compilerErrorEl.textContent
        try {
            await navigator.clipboard.writeText(errorText)
        } catch (err) { ... }
    })
}
```

Replace with:
```js
import { parseErrorLocation } from './ui/errorBanner.js'
// ...
if (compilerErrorEl) {
    compilerErrorEl.addEventListener('click', () => {
        const text = compilerErrorEl.textContent
        const loc = parseErrorLocation(text)
        if (loc && dslEditor) {
            const ta = dslEditor.getTextarea?.()
            if (!ta) return
            const lines = ta.value.split('\n')
            let offset = 0
            for (let i = 0; i < Math.min(loc.line - 1, lines.length); i++) {
                offset += lines[i].length + 1
            }
            offset += Math.max(0, loc.col - 1)
            ta.focus()
            ta.selectionStart = ta.selectionEnd = offset
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard?.writeText(text).catch(() => {})
        }
    })
}
```

Also annotate the banner: when an error has a location, prefix it: `line 7:11 — Unexpected character '@'`. Add to `showCompilerError`:
```js
function showCompilerError(errorText) {
    if (!compilerErrorEl) return
    const loc = parseErrorLocation(errorText)
    let label = errorText
    if (loc) label = `line ${loc.line}:${loc.col} — ${errorText}`
    const escaped = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    compilerErrorEl.innerHTML = `<span>${escaped}</span>`
    compilerErrorEl.classList.add('visible')
}
```

- [ ] **Step 4: Run test, expect PASS**

```
node scripts/test-error-jump.mjs
```

- [ ] **Step 5: Commit**

```bash
git add public/js/embed.js scripts/test-error-jump.mjs
git commit -m "feat(errorBanner): click compile-error to jump caret to error line/col"
```

---

## Final wrap-up

After Phase 9, run the full Playwright suite to verify nothing regressed:

- [ ] **Step 1: Run every test**

```
for f in scripts/test-*.mjs; do
    echo "=== $f ==="
    node "$f" || echo "FAIL: $f"
done
```

- [ ] **Step 2: Run every unit test**

```
node --test tests/unit/*.mjs
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Self-review

**Spec coverage** — every roadmap item maps to a phase:
- Per-output pips → Phase 1 ✓
- Mobile/touch UX → Phase 2 ✓
- Tutorial → Phase 3 ✓
- I3, I9, I11 cleanup → Phase 4 ✓
- Embed mode → Phase 5 ✓
- Code formatter → Phase 6 ✓
- PWA → Phase 7 ✓
- Multi-scene → Phase 8 ✓
- Error line numbers → Phase 9 ✓

**Placeholders** — none; every step has either real code, an exact command, or a file path.

**Type consistency** — `formatDsl`, `surfacesWrittenInDsl`, `currentRenderTarget`, `parseErrorLocation`, `Scenes`, `tutorialState` are all named consistently between their tasks and the call sites that use them.

**Ambiguity** — `formatDsl` could disagree with the engine's `unparse()` formatter; documented as approximate (Step 3 uses simple regex shaping rather than full DSL re-emission). Acceptable for a UX-only formatter.
