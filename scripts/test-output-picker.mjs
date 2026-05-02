import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
// Surface-pips picker is hidden by default; enable it for this test session
await ctx.addInitScript(() => localStorage.setItem('polymorphic-output-picker', '1'))
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
await b.close()
process.exit(ok ? 0 : 1)
