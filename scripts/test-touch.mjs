import { chromium, devices } from 'playwright'
const b = await chromium.launch()
// Polymorphic shows a "rotate to landscape" overlay in portrait that intercepts
// all touches, so use the landscape variant of iPad Pro 11.
const ctx = await b.newContext({ ...devices['iPad Pro 11 landscape'], hasTouch: true })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
// Set a sketch and instrument the editor so we can detect that double-tap
// triggered a recompile. We can't reliably check `.code-editor-flash` because
// the handfish CDN registers `<code-editor>` first (with an older class that
// lacks `flashLines`); the local override is skipped via the
// `customElements.get` guard. Instead, listen for the `forcerecompile` event
// the touch handler should dispatch.
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise(scaleX: 80).write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
    window.__forceRecompileFired = false
    ed.addEventListener('forcerecompile', () => { window.__forceRecompileFired = true })
})
await p.waitForTimeout(1000)
// Double-tap on the canvas. The dsl-overlay covers most of the viewport,
// so we tap the top strip (above the editor overlay) where the canvas is exposed.
const tapX = 600, tapY = 10
await p.touchscreen.tap(tapX, tapY)
await p.touchscreen.tap(tapX + 2, tapY + 2)
await p.waitForTimeout(800)
const fired = await p.evaluate(() => window.__forceRecompileFired)
console.log(fired ? 'PASS' : 'FAIL')
// Touch-tap on a number must focus the textarea, not start scrubbing.
// The scrubber must require 300ms long-press OR 10px drag — a quick tap
// should fall through so the textarea gets focus + caret placement.
const p5 = await ctx.newPage()
await p5.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p5.waitForTimeout(3500)
await p5.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'noise(scaleX: 80).write(o0)\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
    // Hide the output-picker overlay that floats over the top-right of
    // the editor on iPad — otherwise it intercepts our touch.
    const op = document.querySelector('.output-picker')
    if (op) op.style.display = 'none'
})
await p5.waitForTimeout(800)
// Compute the on-screen position of the '80' literal in the textarea.
const litCoords = await p5.evaluate(() => {
    const ta = document.querySelector('code-editor').getTextarea()
    const idx = ta.value.indexOf('80')
    const cs = getComputedStyle(ta)
    const lineH = parseFloat(cs.lineHeight) || 24
    const charW = parseFloat(cs.fontSize) * 0.6
    const before = ta.value.slice(0, idx)
    const lineNum = (before.match(/\n/g) || []).length
    const lastNL = before.lastIndexOf('\n')
    const colNum = idx - lastNL - 1
    const r = ta.getBoundingClientRect()
    const padTop = parseFloat(cs.paddingTop) || 0
    const padLeft = parseFloat(cs.paddingLeft) || 0
    return {
        x: r.x + padLeft + colNum * charW + 4,
        y: r.y + padTop + lineNum * lineH + lineH / 2
    }
})
await p5.evaluate(() => document.activeElement?.blur())
await p5.waitForTimeout(100)
await p5.touchscreen.tap(litCoords.x, litCoords.y)
await p5.waitForTimeout(200)
const focusedTag = await p5.evaluate(() =>
    document.activeElement?.tagName + '|' + (document.activeElement?.shadowRoot?.activeElement?.tagName || '-')
)
const ok5 = focusedTag.startsWith('TEXTAREA')
console.log('tap focused textarea (not scrubber):', ok5 ? 'PASS' : `FAIL (${focusedTag})`)
if (!ok5) process.exit(1)
// Mobile-layout assertion (Task 2.3)
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
// Verify: a two-finger drift (pinch-like) does NOT toggle performance mode
const p4 = await ctx.newPage()
await p4.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p4.waitForTimeout(3500)
const before = await p4.evaluate(() => document.body.classList.contains('performance-mode'))
const cb = await (await p4.locator('#canvas').elementHandle()).boundingBox()
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
await b.close()
process.exit(fired ? 0 : 1)
