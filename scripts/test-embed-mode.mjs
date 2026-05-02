import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 800, height: 450 } })
const p = await ctx.newPage()
const dsl = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
await p.goto(`http://localhost:3000?embed=1&dsl=${encodeURIComponent(dsl)}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
const state = await p.evaluate(() => {
    const cs = (sel) => {
        const el = document.querySelector(sel)
        return el ? getComputedStyle(el).display : 'gone'
    }
    return {
        menu: cs('#menu'),
        editor: cs('#dsl-overlay'),
        docs: cs('#doc-reader-panel'),
        canvasVisible: document.getElementById('canvas')?.classList.contains('visible')
    }
})
console.log(JSON.stringify(state, null, 2))
const ok = state.menu === 'none' && state.editor === 'none' && state.docs === 'none' && state.canvasVisible
console.log(ok ? 'PASS' : 'FAIL')
await b.close()
process.exit(ok ? 0 : 1)
