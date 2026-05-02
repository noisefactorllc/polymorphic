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
