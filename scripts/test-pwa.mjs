import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext()
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
const m = await p.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    if (!link) return null
    const r = await fetch(link.href)
    return r.ok ? await r.json() : null
})
console.log(JSON.stringify(m, null, 2))
const ok = m?.name === 'Polymorphic' && m?.start_url === '/'
console.log(ok ? 'PASS' : 'FAIL')
const p2 = await ctx.newPage()
await p2.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p2.waitForTimeout(2000)
const swReg = await p2.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return reg ? reg.scope : null
})
console.log('sw scope:', swReg)
const ok2 = !!swReg
console.log(ok2 ? 'PASS' : 'FAIL')
if (!ok2) process.exit(1)
await b.close()
process.exit(ok ? 0 : 1)
