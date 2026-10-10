import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// A two-surface program: with the picker on, one live preview renderer runs
// per written surface (o0 and o1).
const DSL = 'search synth, render\n\nnoise(xScale: 80, yScale: 80).write(o0)\nnoise(xScale: 40, yScale: 40).write(o1)\n\nrender(o0)'

// The hidden preview renderers' live state, read through the app's own debug
// surface (`window.__poly.outputPicker`): one entry per written surface whose
// renderer reports whether its render loop still runs.
function pipStates(page) {
    return page.evaluate(() => {
        const previews = window.__poly.outputPicker?._previews
        if (!previews) return null
        return [...previews.values()].map(entry => ({
            running: entry.renderer?.isRunning === true,
        }))
    })
}

async function waitForBooted(page) {
    await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
}

test('switching the surface pips off through the View menu stops the hidden pip render loops and back on recreates them', async ({ page }) => {
    test.slow() // software-GL shader compiles for the app and both pips

    await page.addInitScript(() => localStorage.setItem('polymorphic-output-picker', '1'))
    await page.goto('/?dsl=' + encodeURIComponent(DSL))
    await waitForBooted(page)

    // The picker builds one live preview per written surface and starts each
    // render loop.
    await page.waitForFunction(() => window.__poly.outputPicker?._previews?.size === 2, null, { timeout: 30000 })
    const before = await pipStates(page)
    expect(before).toHaveLength(2)
    for (const state of before) expect(state.running, 'pip render loop runs while the picker is on').toBe(true)
    await expect(page.locator('.output-picker.visible .output-pip')).toHaveCount(2)

    // Count real dispose() calls so the disable path is asserted on the
    // renderers themselves, not just on the map going empty.
    await page.evaluate(() => {
        window.__pipDisposals = 0
        for (const entry of window.__poly.outputPicker._previews.values()) {
            const renderer = entry.renderer
            const original = renderer.dispose.bind(renderer)
            renderer.dispose = async (...args) => {
                window.__pipDisposals++
                return original(...args)
            }
        }
    })

    // Toggle off through the real menu path: View > surface pips.
    await page.evaluate(() => document.getElementById('menu').openMenu('viewMenu'))
    await page.evaluate(() => document.getElementById('viewMenuItem-surface-pips').click())

    // Every hidden preview renderer stops: its loop is stopped and its GL
    // context released via dispose, and the pip leaves the DOM.
    await expect.poll(() => page.evaluate(() => window.__pipDisposals), { timeout: 15000 }).toBe(2)
    expect(await pipStates(page)).toEqual([])
    await expect(page.locator('.output-pip')).toHaveCount(0)
    await expect(page.locator('.output-picker.visible')).toHaveCount(0)

    // Toggle back on through the same menu path: previews are recreated for
    // the surfaces the program still writes.
    await page.evaluate(() => document.getElementById('menu').openMenu('viewMenu'))
    await page.evaluate(() => document.getElementById('viewMenuItem-surface-pips').click())
    await page.waitForFunction(() => window.__poly.outputPicker?._previews?.size === 2, null, { timeout: 30000 })
    const after = await pipStates(page)
    expect(after).toHaveLength(2)
    for (const state of after) expect(state.running, 'recreated pip render loop runs again').toBe(true)
    await expect(page.locator('.output-picker.visible .output-pip')).toHaveCount(2)
})

test('with the pips off from boot, no hidden preview renderer is ever built', async ({ page }) => {
    test.slow()

    await page.addInitScript(() => localStorage.setItem('polymorphic-output-picker', '0'))
    await page.goto('/?dsl=' + encodeURIComponent(DSL))
    await waitForBooted(page)

    // The program writes two surfaces, yet the picker stays renderer-free:
    // per-frame work matches a session where the picker was never enabled.
    await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
    await page.waitForTimeout(1000)
    expect(await pipStates(page)).toEqual([])
    await expect(page.locator('.output-pip')).toHaveCount(0)
})
