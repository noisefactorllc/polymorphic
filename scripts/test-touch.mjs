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
await b.close()
process.exit(fired ? 0 : 1)
