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
