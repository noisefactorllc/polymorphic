# Polymorphic Roadmap Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Address every issue from the pre-merge code review of the 20-commit roadmap landing — 3 Critical, 7 Important (some merged from B.5/B.6), 6 Minor.

**Architecture:** Targeted fixes across ~8 files. No new modules. Each task touches 1–3 files and lands as its own commit.

**Tech stack:** Vanilla ES modules, `node:test` for unit, Playwright for integration. No build step.

---

## Phase A — Critical (block merge)

### Task A.1: Formatter handles multi-line argument blocks

**Why:** `formatDsl` splits by `\n` and treats each physical line independently. Lines inside a paren block (`adjust(\n  mode: hsv,\n  rotation: 120\n)`) emit unindented and the `)` flush-left. The bundled `DEFAULT_DSL` is broken every time a user presses Cmd+Shift+F.

**Files:**
- Modify: `public/js/ui/formatter.js`
- Test: `tests/unit/formatter.test.mjs`

- [ ] **Step 1: Add failing test for multi-line collapse**

Append to `tests/unit/formatter.test.mjs`:

```js
test('formatDsl collapses multi-line argument blocks', () => {
    const input = 'noise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('  .adjust(mode: hsv, rotation: 120)'),
        'multi-line .adjust(...) collapses onto one indented line')
    assert.ok(!/^[a-z]/m.test(out.split('\n').filter(l => l.includes('mode:')).join('')),
        'argument-only lines never appear at column 0')
})

test('formatDsl idempotent across multi-line input', () => {
    const input = 'search synth, filter, render\n\nnoise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\n\nrender(o0)'
    const once = formatDsl(input)
    const twice = formatDsl(once)
    assert.strictEqual(twice, once)
})
```

- [ ] **Step 2: Run, expect FAIL on the first new test**

```
node --test tests/unit/formatter.test.mjs
```

- [ ] **Step 3: Add a paren-aware logical-line pass before per-line formatting**

In `public/js/ui/formatter.js`, replace the `for (const raw of lines)` loop with a two-pass approach. First pass: walk physical lines and join any block where parens are unbalanced into a single logical line. Second pass: the existing per-line logic operates on logical lines.

Replace the entire body of `formatDsl(input)` (keep helpers `formatChain` and `formatArgs` unchanged) with:

```js
export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''

    const formatChain = (text) => {
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

    const formatArgs = (text) => text
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')

    // Pass 1: collapse multi-line statements (unbalanced parens) into logical lines.
    // Blank physical lines become real blank logical lines (block separators).
    const physical = input.split('\n')
    const logical = []
    let buf = ''
    let depth = 0
    for (const raw of physical) {
        const line = raw
        // Count parens outside of strings (DSL has no string literals to speak of, so we ignore quoting)
        for (const c of line) {
            if (c === '(') depth++
            else if (c === ')') depth = Math.max(0, depth - 1)
        }
        if (buf) {
            buf += ' ' + line.trim()
        } else {
            buf = line.trim()
        }
        if (depth === 0) {
            logical.push(buf)
            buf = ''
        }
    }
    if (buf) logical.push(buf)  // unbalanced input — emit what we have

    // Pass 2: per-logical-line formatting (existing semantics)
    const out = []
    let pendingBlank = false
    for (const raw of logical) {
        const line = raw.trim()
        if (!line) {
            if (out.length && !pendingBlank) pendingBlank = true
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

- [ ] **Step 4: Run, expect PASS on all six tests**

```
node --test tests/unit/formatter.test.mjs
```

- [ ] **Step 5: Sanity-check on DEFAULT_DSL via REPL**

```bash
node -e "
import('./public/js/ui/formatter.js').then(m => {
    const dsl = \`search synth, filter, render

noise(scaleX: 60, scaleY: 60)
  .adjust(
    mode: hsv,
    rotation: 120,
    hueRange: 40
  )
  .write(o0)

render(o0)\`
    console.log(m.formatDsl(dsl))
})
"
```

Expected: every `.step()` indented two spaces, no flush-left orphan args, no flush-left `)`.

- [ ] **Step 6: Commit**

```bash
git add public/js/ui/formatter.js tests/unit/formatter.test.mjs
git commit -m "fix(formatter): collapse multi-line argument blocks before reformatting"
```

---

### Task A.2: Service worker honors no-store and bypasses freshness-critical paths

**Why:** Current `sw.js` cache-firsts every same-origin request, so `fetch('/deployment-meta.json', { cache: 'no-store' })` returns a stale cached copy after deploys. The about-dialog and gallery silently lie about build identity and example freshness.

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Add network-only bypass list and respect cache mode**

Replace the `fetch` listener body in `public/sw.js`:

```js
const NETWORK_ONLY = new Set([
    '/deployment-meta.json',
    '/data/examples.json'
])

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url)
    if (url.origin !== location.origin) return

    // Always-fresh paths: do not intercept at all
    if (NETWORK_ONLY.has(url.pathname)) return

    // Respect the request's cache directive
    if (e.request.cache === 'no-store' || e.request.cache === 'no-cache' || e.request.cache === 'reload') {
        return
    }

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

- [ ] **Step 2: Manual smoke test — about dialog reads fresh deployment-meta.json**

Run the local server, register the SW once, then change `public/deployment-meta.json` (or just touch its mtime) and reload — the about dialog should reflect the new build hash, not the cached one.

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  curl -s http://localhost:3000/sw.js | grep -E 'NETWORK_ONLY|cache ===' && \
  pkill -f 'serve -l 3000' || true
```

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "fix(pwa): SW honors no-store/no-cache and bypasses deployment-meta + examples"
```

---

### Task A.3: Performance-mode and embed-mode CSS both hide `.output-picker`

**Why:** `body.performance-mode` rule in `public/index.html` lists eight elements to hide but omits `.output-picker`. Cmd+Shift+H on a multi-output sketch leaves the pip strip floating. Embed-mode already hides it, but performance-mode is the ground-truth for "clean canvas."

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Find and update the rule**

```bash
grep -n "body.performance-mode" public/index.html
```

In the existing rule that lists hidden elements (around line 192), add `body.performance-mode .output-picker,` to the selector list (alphabetical / logical placement next to other panel selectors).

- [ ] **Step 2: Manual smoke test**

Open a multi-output sketch (e.g. the Task 1.2 test DSL with two `.write(oN)` calls), press Cmd+Shift+H — pip strip must disappear with all the other UI.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "fix(performance-mode): hide output-picker pip strip with the rest of the UI"
```

---

## Phase B — Important

### Task B.1: Format shortcut row in shortcuts dialog

**Why:** `/superpowers:requesting-code-review` flagged that Cmd+Shift+F is in the command palette but missing from the `?`-key shortcuts dialog. Discoverability gap.

**Files:**
- Modify: `public/js/ui/shortcutsDialog.js`

- [ ] **Step 1: Inspect existing SECTIONS structure**

```bash
grep -n "Format\|live-coding\|Live coding\|⌘.*Enter\|Editor" public/js/ui/shortcutsDialog.js | head -10
```

Find the section that lists editor / live-coding shortcuts (likely a "Live coding" or "Editor" section).

- [ ] **Step 2: Add the row**

Add to the appropriate section's `rows` array, placed near other Cmd+key editor shortcuts:

```js
['Format DSL', ['⌘/Ctrl', '⇧', 'F']],
```

- [ ] **Step 3: Smoke check**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node -e "
    const { chromium } = require('playwright');
    (async () => {
        const b = await chromium.launch();
        const p = await (await b.newContext()).newPage();
        await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
        await p.waitForTimeout(2000);
        await p.keyboard.press('?');
        await p.waitForTimeout(300);
        const found = await p.evaluate(() => document.body.innerText.includes('Format DSL'));
        console.log(found ? 'PASS' : 'FAIL');
        await b.close();
        process.exit(found ? 0 : 1);
    })();
  " ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/shortcutsDialog.js
git commit -m "docs(shortcuts): list Cmd+Shift+F in the shortcuts dialog"
```

---

### Task B.2: Two-finger tap deferred to touchend with movement + duration gate

**Why:** Current `touchControls.js` `touchstart` handler calls `e.preventDefault()` and toggles performance mode the instant a second finger lands. Kills pinch-zoom; toggles on every pinch attempt.

**Files:**
- Modify: `public/js/ui/touchControls.js`

- [ ] **Step 1: Replace the two-finger handler with a deferred gesture**

Replace the existing `canvas.addEventListener('touchstart', ...)` block with:

```js
const TWO_FINGER_MAX_MS = 250
const TWO_FINGER_MAX_DRIFT_PX = 30
let twoFingerStart = 0
let twoFingerOriginX = 0
let twoFingerOriginY = 0
let twoFingerMoved = false
let twoFingerArmed = false  // we saw exactly 2 fingers and never went above 2

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        twoFingerStart = Date.now()
        twoFingerArmed = true
        twoFingerMoved = false
        twoFingerOriginX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        twoFingerOriginY = (e.touches[0].clientY + e.touches[1].clientY) / 2
    } else if (e.touches.length > 2) {
        twoFingerArmed = false
    }
}, { passive: true })

canvas.addEventListener('touchmove', (e) => {
    if (!twoFingerArmed || e.touches.length < 2) return
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
    const dx = Math.abs(cx - twoFingerOriginX)
    const dy = Math.abs(cy - twoFingerOriginY)
    if (dx > TWO_FINGER_MAX_DRIFT_PX || dy > TWO_FINGER_MAX_DRIFT_PX) twoFingerMoved = true
}, { passive: true })

canvas.addEventListener('touchend', (e) => {
    if (twoFingerArmed && e.touches.length === 0) {
        const elapsed = Date.now() - twoFingerStart
        if (!twoFingerMoved && elapsed < TWO_FINGER_MAX_MS) {
            onTogglePerformanceMode?.()
        }
        twoFingerArmed = false
    }
}, { passive: true })
```

The handler is now `passive: true` everywhere — no `preventDefault`, so pinch-zoom works.

- [ ] **Step 2: Update existing Playwright touch test (or add a new one) to verify pinch doesn't toggle**

In `scripts/test-touch.mjs`, append:

```js
// Verify: a two-finger drift (pinch-like) does NOT toggle performance mode
const p4 = await ctx.newPage()
await p4.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p4.waitForTimeout(3500)
const before = await p4.evaluate(() => document.body.classList.contains('performance-mode'))
const cb = await (await p4.locator('#canvas').elementHandle()).boundingBox()
// Simulate a pinch via two-finger touch with drift > 30px between start and end
await p4.touchscreen.tap(cb.x + 200, cb.y + 200)  // warmup
await p4.evaluate(() => {
    const c = document.getElementById('canvas')
    const t1 = new Touch({ identifier: 0, target: c, clientX: 100, clientY: 100 })
    const t2 = new Touch({ identifier: 1, target: c, clientX: 300, clientY: 100 })
    c.dispatchEvent(new TouchEvent('touchstart', { touches: [t1, t2], targetTouches: [t1, t2], changedTouches: [t1, t2], bubbles: true }))
    const t1m = new Touch({ identifier: 0, target: c, clientX: 50, clientY: 100 })
    const t2m = new Touch({ identifier: 1, target: c, clientX: 350, clientY: 100 })
    c.dispatchEvent(new TouchEvent('touchmove', { touches: [t1m, t2m], targetTouches: [t1m, t2m], changedTouches: [t1m, t2m], bubbles: true }))
    c.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t1m, t2m], bubbles: true }))
})
await p4.waitForTimeout(300)
const after = await p4.evaluate(() => document.body.classList.contains('performance-mode'))
console.log('pinch did not toggle perf mode:', before === after ? 'PASS' : 'FAIL')
if (before !== after) process.exit(1)
```

- [ ] **Step 3: Run, expect PASS**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-touch.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/touchControls.js scripts/test-touch.mjs
git commit -m "fix(touch): two-finger tap requires touchend within 250ms and <30px drift"
```

---

### Task B.3: Format event preserves textarea selection

**Why:** `dslEditor.value = after` resets caret to position 0. User formatting mid-edit loses their place.

**Files:**
- Modify: `public/js/embed.js`

- [ ] **Step 1: Replace the format listener**

Find the existing `dslEditor.addEventListener('format', ...)` listener (added in Phase 6 Task 6.2). Replace its body with:

```js
dslEditor.addEventListener('format', () => {
    const before = dslEditor.value
    const after = formatDsl(before)
    if (after === before) return
    const ta = dslEditor.getTextarea?.()
    const sel = ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null
    if (before.trim()) snapshotHistory.push(before)  // also covers Task C.1
    dslEditor.value = after
    if (ta && sel) {
        const len = after.length
        ta.selectionStart = Math.min(sel.start, len)
        ta.selectionEnd = Math.min(sel.end, len)
    }
    scheduleHotReload()
})
```

(Note: this also addresses Task C.1, which is otherwise a duplicate edit. C.1 is still listed as a separate task for traceability but ships in this commit.)

- [ ] **Step 2: Smoke test**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node -e "
    const { chromium } = require('playwright');
    (async () => {
        const b = await chromium.launch();
        const p = await (await b.newContext()).newPage();
        await p.goto('http://localhost:3000', { waitUntil: 'networkidle' });
        await p.waitForTimeout(3500);
        await p.evaluate(() => {
            const ed = document.querySelector('code-editor')
            ed.value = 'noise(scaleX:80).palette(index:vaporwave).write(o0)\nrender(o0)'
            const ta = ed.getTextarea()
            ta.focus()
            ta.selectionStart = ta.selectionEnd = 30  // somewhere in the middle
        });
        await p.keyboard.press('Control+Shift+F');
        await p.waitForTimeout(400);
        const sel = await p.evaluate(() => {
            const ta = document.querySelector('code-editor').getTextarea()
            return { start: ta.selectionStart, end: ta.selectionEnd, len: ta.value.length }
        });
        console.log(sel);
        const ok = sel.start > 0 && sel.start <= sel.len;
        console.log(ok ? 'PASS' : 'FAIL');
        await b.close();
        process.exit(ok ? 0 : 1);
    })();
  " ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 3: Commit (covers C.1 + B.3)**

```bash
git add public/js/embed.js
git commit -m "fix(formatter): preserve textarea selection and snapshot pre-format value"
```

---

### Task B.4: Touch-scrubber engages only after movement or long-press

**Why:** Phase 2 Task 2.2 dropped the alt-key requirement on touch/pen, but didn't add a replacement gate. Tapping any numeric literal now starts a scrub, blocking textarea focus. The editor is unusable on iOS for any line containing numbers.

**Files:**
- Modify: `public/js/ui/scrubber.js`
- Test: append to `scripts/test-touch.mjs`

- [ ] **Step 1: Read current scrub flow**

```bash
grep -n "onPointerDown\|onPointerMove\|onPointerUp\|preventDefault\|setPointerCapture" public/js/ui/scrubber.js | head -20
```

Note where `e.preventDefault()` is currently called and where the scrub-state is "engaged."

- [ ] **Step 2: Add a "pending vs engaged" two-stage state for touch/pen**

Inside `attachScrubber(editor, options = {})` (or wherever `onPointerDown` is defined), restructure the touch path so:

1. On `pointerdown` with `pointerType === 'touch' || 'pen'`:
   - Find the literal at coords. If absent, return immediately (don't preventDefault — let textarea focus).
   - Set `pendingTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now(), lit }`.
   - Set a 300ms `setTimeout` that promotes `pendingTouch` to engaged scrub if still pending.
   - Do NOT call `preventDefault` or `setPointerCapture` yet.

2. On `pointermove` matching `pendingTouch.id`:
   - If `Math.hypot(e.clientX - pendingTouch.x, e.clientY - pendingTouch.y) > 10`:
     - Promote to engaged scrub (cancel timeout, capture pointer, preventDefault from here on).

3. On `pointerup` matching `pendingTouch.id`:
   - If still pending (never promoted), clear the pending state — let the tap fall through to native textarea focus.
   - If engaged, finalize as before.

Keep the mouse path unchanged: if `!isTouch && altKey && button === 0`, engage immediately as before.

Concrete shape:

```js
const TOUCH_LONG_PRESS_MS = 300
const TOUCH_DRAG_THRESHOLD_PX = 10
let pendingTouch = null
let pendingTimer = null

function engageScrub(e, lit) {
    // ...existing engaged-scrub setup that was in onPointerDown after the gate:
    //    setPointerCapture, store start value, preventDefault, etc.
}

function onPointerDown(e) {
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen'
    if (!isTouch) {
        if (!e.altKey || e.button !== 0) return
        const lit = findLiteralAtPointer(e.clientX, e.clientY)
        if (!lit) return
        engageScrub(e, lit)
        return
    }
    // Touch path
    if (e.button !== 0) return
    const lit = findLiteralAtPointer(e.clientX, e.clientY)
    if (!lit) return
    pendingTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, lit }
    pendingTimer = setTimeout(() => {
        if (pendingTouch && pendingTouch.id === e.pointerId) {
            engageScrub(e, pendingTouch.lit)
            pendingTouch = null
        }
    }, TOUCH_LONG_PRESS_MS)
}

function onPointerMove(e) {
    if (pendingTouch && e.pointerId === pendingTouch.id) {
        const dx = e.clientX - pendingTouch.x
        const dy = e.clientY - pendingTouch.y
        if (Math.hypot(dx, dy) > TOUCH_DRAG_THRESHOLD_PX) {
            clearTimeout(pendingTimer); pendingTimer = null
            const lit = pendingTouch.lit
            pendingTouch = null
            engageScrub(e, lit)
        }
        return
    }
    // ... existing engaged-scrub move logic
}

function onPointerUp(e) {
    if (pendingTouch && e.pointerId === pendingTouch.id) {
        clearTimeout(pendingTimer); pendingTimer = null
        pendingTouch = null
        return  // tap fell through, no scrub
    }
    // ... existing engaged-scrub up logic
}
```

The structure of the existing `engageScrub` body is a verbatim copy of the current `onPointerDown` body from `setPointerCapture` onward. Move that block into `engageScrub`.

- [ ] **Step 3: Append touch-tap test**

In `scripts/test-touch.mjs`, replace the existing "touch scrub no errors" assertion with a stronger one that verifies a tap on a number does NOT consume the focus:

```js
// Touch-tap on a number must focus the textarea, not start scrubbing
const p5 = await ctx.newPage()
await p5.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p5.waitForTimeout(3500)
await p5.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'noise(scaleX: 80).write(o0)\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p5.waitForTimeout(800)
const editorBox = await (await p5.locator('code-editor').elementHandle()).boundingBox()
await p5.touchscreen.tap(editorBox.x + 50, editorBox.y + 30)
await p5.waitForTimeout(150)
const focusedTag = await p5.evaluate(() => document.activeElement?.tagName)
console.log('tap focused textarea (not scrubber):', focusedTag === 'TEXTAREA' ? 'PASS' : `FAIL (${focusedTag})`)
if (focusedTag !== 'TEXTAREA') process.exit(1)
```

- [ ] **Step 4: Run, expect PASS**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-touch.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 5: Commit**

```bash
git add public/js/ui/scrubber.js scripts/test-touch.mjs
git commit -m "fix(scrubber): touch/pen requires long-press or 10px drag before engaging"
```

---

### Task B.5: Service worker cache name versioned by deployment hash

**Why:** Hardcoded `CACHE = 'polymorphic-v1'` requires manual bump on every deploy. Forgetting = users stuck on old cache forever.

**Files:**
- Modify: `public/index.html` (registration)
- Modify: `public/sw.js` (cache name from query param)

- [ ] **Step 1: Update index.html SW registration to attach build hash**

Find the existing SW registration block (added in Phase 7 Task 7.2). Replace with:

```html
<script>
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        let v = 'unknown'
        try {
            const r = await fetch('/deployment-meta.json', { cache: 'no-store' })
            if (r.ok) {
                const m = await r.json()
                v = m.git_hash || m.deployedAt || 'unknown'
            }
        } catch {}
        navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(v))
            .catch(err => console.warn('SW failed', err))
    })
}
</script>
```

- [ ] **Step 2: Update sw.js to derive cache name from query string**

In `public/sw.js`, replace the top-level `const CACHE = 'polymorphic-v1'` line with:

```js
const VERSION = (() => {
    try { return new URL(self.location.href).searchParams.get('v') || 'dev' }
    catch { return 'dev' }
})()
const CACHE = `polymorphic-${VERSION}`
```

Now each deploy registers `/sw.js?v=<hash>`, browser keys the registration on the URL, the new SW gets a new cache name, the activate handler purges old caches.

- [ ] **Step 3: Smoke test (cache cleanup)**

Manual: open DevTools > Application > Service Workers, register once, then reload after editing `deployment-meta.json` to a different hash. Old cache (`polymorphic-<old>`) must be deleted by the activate handler.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/sw.js
git commit -m "feat(pwa): SW cache name derived from deployment hash; auto-purge on deploy"
```

---

### Task B.6: SW install resilient to per-URL precache failure

**Why:** `c.addAll(PRECACHE)` rejects atomically if any URL 404s. A future rename of `/css/touch.css` could leave users stuck forever on the old SW.

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Replace the install handler**

```js
self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const c = await caches.open(CACHE)
        for (const url of PRECACHE) {
            try { await c.add(url) } catch (err) {
                console.warn('[sw] precache miss:', url, err?.message || err)
            }
        }
        await self.skipWaiting()
    })())
})
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "fix(pwa): SW precache tolerates per-URL failures so install always succeeds"
```

---

### Task B.7: embed-mode drops the `cursor: default` override

**Why:** `body.embed-mode * { cursor: default }` overrides `body.performance-mode { cursor: none }` because both classes apply and the universal selector wins. Spec says embed mode "applies same effect as performance mode" — including hidden cursor. Drop the override.

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Remove the rule**

In `public/index.html`, find:

```css
body.embed-mode,
body.embed-mode * { cursor: default; }
```

Delete both lines. Performance-mode's `cursor: none` rule will now apply uniformly.

- [ ] **Step 2: Manual smoke test**

Visit `http://localhost:3000?embed=1&dsl=...` — cursor should be hidden over the canvas, identical to Cmd+Shift+H performance mode.

- [ ] **Step 3: Commit (also covers Minor 15)**

```bash
git add public/index.html
git commit -m "fix(embed-mode): align cursor behavior with performance mode (hidden)"
```

---

## Phase C — Minor

### Task C.1: Format snapshots pre-format value to history

**Why:** A user formats, dislikes the result, wants Cmd+Alt+Left to step back. Without snapshotting the pre-format value, the history-rewind skips past the formatting boundary.

**Status:** SHIPPED in Task B.3 (`snapshotHistory.push(before)` was included in the same edit). No additional work.

---

### Task C.2: OutputPicker.dispose clears `_pending`

**Why:** Hypothetical post-dispose `setDsl` would chain off the dead promise and NPE on `this._el.appendChild`. Latent bug — not currently reachable, but the contract should be safe.

**Files:**
- Modify: `public/js/ui/outputPicker.js`

- [ ] **Step 1: Edit dispose()**

In the `OutputPicker.dispose()` method, add as the first line of the method body:

```js
this._pending = null
```

- [ ] **Step 2: Smoke test (existing tests must still pass)**

```
node --test tests/unit/outputPicker.test.mjs
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-output-picker.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 3: Commit**

```bash
git add public/js/ui/outputPicker.js
git commit -m "fix(outputPicker): dispose clears pending setDsl chain"
```

---

### Task C.3: Touch double-tap canvas-edge flash for visual feedback

**Why:** Mobile users who double-tap to force-eval get zero visible feedback (CDN editor lacks `flashLines`). Add a brief canvas-border ring so they know it registered.

**Files:**
- Modify: `public/js/ui/touchControls.js`
- Modify: `public/css/touch.css`

- [ ] **Step 1: Add CSS**

Append to `public/css/touch.css`:

```css
@keyframes canvas-flash {
    0%   { box-shadow: inset 0 0 0 6px rgba(165,184,255,0.65); }
    100% { box-shadow: inset 0 0 0 6px rgba(165,184,255,0);    }
}
#canvas.canvas-flash { animation: canvas-flash 350ms ease-out; }
```

- [ ] **Step 2: Trigger from touchControls.js double-tap**

In `attachTouchControls`, after the `dslEditor?.dispatchEvent(... 'forcerecompile' ...)` line:

```js
canvas.classList.remove('canvas-flash')
// Force reflow so re-adding the class restarts the animation
void canvas.offsetWidth
canvas.classList.add('canvas-flash')
```

- [ ] **Step 3: Smoke test (no functional regression)**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-touch.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/touchControls.js public/css/touch.css
git commit -m "feat(touch): visual canvas-edge flash confirms double-tap eval"
```

---

### Task C.4: Drop-on-busy compile shows brief flash

**Why:** Mashing Cmd+Enter while a compile is in flight silently drops calls. No feedback — feels broken.

**Files:**
- Modify: `public/js/embed.js`
- Modify: existing CSS for `#compiler-error` or `#dsl-overlay` (add a subtle pulse class)

- [ ] **Step 1: Add CSS pulse for the editor frame**

In the existing `<style>` block in `public/index.html`, add:

```css
@keyframes editor-busy {
    0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,255,255,0); }
    50%      { box-shadow: inset 0 0 0 2px rgba(255,200,80,0.4); }
}
#dsl-overlay.busy { animation: editor-busy 250ms ease-out; }
```

- [ ] **Step 2: Trigger from embed.js drop branches**

In `forcerecompile` and `forceevalblock` handlers, replace the bare `if (_compileInFlight) return` with:

```js
if (_compileInFlight) {
    const overlay = document.getElementById('dsl-overlay')
    if (overlay) {
        overlay.classList.remove('busy')
        void overlay.offsetWidth
        overlay.classList.add('busy')
    }
    return
}
```

(Hot-reload path stays as-is — it re-arms, no flash needed.)

- [ ] **Step 3: Run existing tests, ensure no regression**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-block-eval-race.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 4: Commit**

```bash
git add public/js/embed.js public/index.html
git commit -m "feat(embed): editor frame pulses when a compile is dropped due to in-flight"
```

---

### Task C.5: Trim `touchControls.js` docstring

**Why:** Docstring claims "Long-press on the BPM indicator → tap-tempo" but the function only implements canvas double-tap and two-finger tap. Stale aspirational text.

**Files:**
- Modify: `public/js/ui/touchControls.js`

- [ ] **Step 1: Edit the leading docstring**

Replace:

```js
/**
 * Touch-only gestures that don't have a desktop equivalent.
 *  - Double-tap on the canvas → force-eval (Cmd+Enter analogue)
 *  - Two-finger tap on the canvas → toggle UI visibility (performance mode)
 *  - Long-press on the BPM indicator → tap-tempo
 */
```

With:

```js
/**
 * Touch-only gestures that don't have a desktop equivalent.
 *  - Double-tap on the canvas → force-eval (Cmd+Enter analogue)
 *  - Two-finger tap on the canvas → toggle UI visibility (performance mode)
 */
```

- [ ] **Step 2: Commit**

```bash
git add public/js/ui/touchControls.js
git commit -m "docs(touch): drop unimplemented long-press tap-tempo line from docstring"
```

---

### Task C.6: Playwright test verifies bare-digit recall doesn't fire while editor focused

**Why:** Easiest silent regression for a future contributor: swap the `tag === 'TEXTAREA'` check and bare-digit recall starts firing while typing. Add a test that pins the contract.

**Files:**
- Modify: `scripts/test-scenes.mjs`

- [ ] **Step 1: Append to scripts/test-scenes.mjs (before the existing `await b.close()`)**

```js
// Bare-digit recall must NOT fire while editor textarea is focused
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p2.waitForTimeout(3500)
// Save scene 1 first
await p2.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p2.waitForTimeout(1000)
await p2.keyboard.press('Control+Shift+1')
await p2.waitForTimeout(300)
// Now change DSL, focus the textarea, type "1"
await p2.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\ngradient().write(o0)\n\nrender(o0)'
    ed.getTextarea().focus()
    const ta = ed.getTextarea()
    ta.selectionStart = ta.selectionEnd = ta.value.length
})
await p2.waitForTimeout(150)
await p2.keyboard.press('1')
await p2.waitForTimeout(300)
const v = await p2.evaluate(() => document.querySelector('code-editor').value)
const recalled = v.includes('noise().write(o0)') && !v.includes('gradient')
const typed1 = /1\s*$/.test(v) || v.includes('gradient')
console.log('digit-while-focused:', recalled ? 'FAIL (recalled)' : (typed1 ? 'PASS' : 'AMBIGUOUS'))
if (recalled) process.exit(1)
```

- [ ] **Step 2: Run**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
  node scripts/test-scenes.mjs ; pkill -f 'serve -l 3000' || true
```

- [ ] **Step 3: Commit**

```bash
git add scripts/test-scenes.mjs
git commit -m "test(scenes): bare-digit recall must not fire while editor focused"
```

---

## Final wrap-up

After all tasks land:

- [ ] **Run every unit test**

```
node --test tests/unit/*.mjs
```

Expected: 18+ pass / 0 fail (formatter test now has 6, others unchanged).

- [ ] **Run every Playwright test**

```
(cd public && npx serve -l 3000 > /tmp/serve.log 2>&1 &) && sleep 2 && \
for f in scripts/test-*.mjs; do
    echo "=== $f ==="
    node "$f" 2>&1 | tail -5 || echo "FAIL: $f"
done ; pkill -f 'serve -l 3000' || true
```

Expected: every PASS still PASS; only `test-pip-snapshot.mjs` may still FAIL (pre-existing card-0 IntersectionObserver flake — not in scope here).

---

## Self-review

**Coverage:** Every Critical (3), Important (7), and Minor (5 actionable; 1 pre-existing skipped) item from the code review maps to a task here.

**Type consistency:** `formatDsl`, `attachTouchControls`, `outputPicker.setDsl/_pending/dispose`, `attachScrubber`, `Scenes.save/load`, `_compileInFlight`, `parseErrorLocation` — all referenced by the same names as in the code being modified.

**Placeholders:** None. Each step has either real code, a real command, or a concrete file path + line region.

**Scope check:** Single implementation pass. Each task is 1–3 files, ~10–60 lines of change. Tests added where they pin a contract that's easy to silently break.

**Sequencing:** Tasks within a phase are independent (no cross-task references). Task B.3 ships C.1 inline (noted) to avoid duplicate edits to the same listener.

**Skipped from the review (pre-existing, not introduced by this PR):**
- `dragCounter` underflow guard (`embed.js:466`) — pre-existing, reviewer flagged as "not introduced by this PR."
- `test-pip-snapshot.mjs` failure — pre-existing flake (verified at base SHA).
