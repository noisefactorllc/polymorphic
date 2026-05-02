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
// Bare-digit recall must NOT fire while editor textarea is focused
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p2.waitForTimeout(3500)
// Save scene 1 first (with the editor focused; the save shortcut doesn't require unfocused editor)
await p2.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p2.waitForTimeout(1000)
await p2.keyboard.press('Control+Shift+1')
await p2.waitForTimeout(300)
// Now change DSL, focus the textarea at end of value, type "1"
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
console.log('digit-while-focused did NOT recall scene:', recalled ? 'FAIL (recalled)' : 'PASS')
if (recalled) process.exit(1)
await b.close()
process.exit(ok ? 0 : 1)
