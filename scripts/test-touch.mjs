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
