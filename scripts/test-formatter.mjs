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
