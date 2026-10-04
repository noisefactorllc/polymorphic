import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const BOOT_DSL = 'search synth, filter\n\nperlin(scale: 75, octaves: 2)\n  .write(o0)\n\nrender(o0)'

test('every toolbar and bottom-row tooltip remains visible and on screen', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 550 })
    await page.goto(`/?dsl=${encodeURIComponent(BOOT_DSL)}`)
    await page.waitForFunction(() => !!document.querySelector('.status-row tempo-bar .tempo-bar__tap'))

    const targets = page.locator('#menu .tooltip, .status-row .tooltip')
    const count = await targets.count()
    expect(count).toBeGreaterThan(2)

    for (let i = 0; i < count; i++) {
        const target = targets.nth(i)
        await target.hover()
        const expected = await target.getAttribute('data-title')
        const tooltip = page.locator('#hf-tooltip-layer[data-visible="true"]')
        await expect(tooltip).toHaveText(expected)
        const bounds = await tooltip.evaluate(el => {
            const rect = el.getBoundingClientRect()
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
        })
        expect(bounds.left, expected).toBeGreaterThanOrEqual(0)
        expect(bounds.top, expected).toBeGreaterThanOrEqual(0)
        expect(bounds.right, expected).toBeLessThanOrEqual(bounds.width)
        expect(bounds.bottom, expected).toBeLessThanOrEqual(bounds.height)
        if (await target.evaluate(el => !!el.closest('.status-row'))) {
            await expect(tooltip).toHaveAttribute('data-position', 'above')
        }
        expect(await target.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
    }

    await page.locator('.status-row .tempo-bar__tap').focus()
    await expect(page.locator('#hf-tooltip-layer[data-visible="true"]')).toHaveText('Tap tempo')
})
