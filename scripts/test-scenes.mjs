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
// Click outside the textarea so the bare '1' key isn't typed
await p.evaluate(() => document.activeElement?.blur?.())
await p.waitForTimeout(200)
// Recall scene 1
await p.keyboard.press('1')   // bare number key recalls
await p.waitForTimeout(800)
const v1 = await p.evaluate(() => document.querySelector('code-editor').value)
const ok = v1.includes('vaporwave')
console.log(ok ? 'PASS' : 'FAIL: ' + v1.slice(0, 100))
await b.close()
process.exit(ok ? 0 : 1)
