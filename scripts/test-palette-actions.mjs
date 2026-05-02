/**
 * Smoke test: open the command palette and confirm a known action renders.
 *
 * Verifies the paletteActions registry loads without errors and that the
 * "reset" action is reachable via fuzzy search.
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errs = []
page.on('pageerror', e => errs.push('[pe] ' + e.message))
page.on('console', m => { if (m.type() === 'error') errs.push('[ce] ' + m.text().slice(0, 200)) })

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// Open the palette (Cmd/Ctrl+K — the canonical shortcut wired in commandPalette.js)
await page.keyboard.press('Meta+K')
await page.waitForTimeout(400)

// Type "reset" — the "reset" action should appear in results
await page.keyboard.type('reset')
await page.waitForTimeout(400)

const items = await page.evaluate(() =>
    [...document.querySelectorAll('.cmd-palette-item')]
        .map(el => el.textContent?.trim())
        .filter(Boolean)
)

console.log('palette items matching "reset":', items)

const hasResetAction = items.some(t => /reset to original/i.test(t))
const ok = hasResetAction && errs.length === 0

if (errs.length) console.log('errs:', errs.slice(0, 3))
console.log(ok ? 'PASS' : 'FAIL')

await browser.close()
process.exit(ok ? 0 : 1)
