import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const p = await ctx.newPage()

const errs = []
p.on('pageerror', e => errs.push('[pe] ' + e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('[ce] ' + m.text().slice(0, 200)) })

await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)

// Set a 3-chain program
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth, render\n\nnoise(scaleX: 80).write(o0)\n\ngradient().write(o1)\n\nrender(o0)'
    ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }))
})
await p.waitForTimeout(700)

// Place caret in the gradient line
await p.evaluate(() => {
    const ta = document.querySelector('code-editor').getTextarea()
    const idx = ta.value.indexOf('gradient')
    ta.selectionStart = ta.selectionEnd = idx
    ta.focus()
})

// Fire block-eval and immediately type — this is the race
await p.keyboard.press('Alt+Enter')
await p.keyboard.type(' /* race */ ')
await p.waitForTimeout(2500)  // let hot-reload's 500ms debounce fire and finish

// Check that no errors fired AND the editor's final value is the typed-in version
const finalDsl = await p.evaluate(() => document.querySelector('code-editor').value)
const containsTyped = finalDsl.includes('/* race */')

console.log('errors during race:', errs)
console.log('final DSL contains typed text:', containsTyped)
const ok = errs.length === 0 && containsTyped
console.log(ok ? 'PASS' : 'FAIL')

await b.close()
process.exit(ok ? 0 : 1)
