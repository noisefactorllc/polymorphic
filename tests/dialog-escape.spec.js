// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

async function boot(page) {
    // The escape-stack layer under test is DOM-only: it does not exercise the
    // shader. Load a minimal DSL program so the render loop compiles a
    // trivial shader — full default programs peg SwiftShader's software
    // rasterizer and starve the main thread past the 60s test timeout when
    // several workers boot at once (reproducible "keyboard.press: Test
    // timeout" wedges on this host).
    const dsl = encodeURIComponent('render(o0)')
    await page.goto(`/?dsl=${dsl}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })
    await page.waitForTimeout(500)
}

test.describe('Dialog and Overlay Escape Key Hygiene', () => {
    test('Escape dismisses Gallery overlay without side effects', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('viewMenuItem-gallery').click())
        const overlay = page.locator('.gallery-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        // Dismissal is synchronous on keydown; the 5s default window is the
        // documented budget for one expect roundtrip under host load.
        await expect(overlay).toBeHidden()
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Shortcuts dialog overlay', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('viewMenuItem-shortcuts').click())
        const overlay = page.locator('.shortcuts-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(overlay).toBeHidden()
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Share modal', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('shareProgram').click())
        const overlay = page.locator('.share-modal-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(overlay).toBeHidden()
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Import From URL dialog', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('importFromUrlMenuItem').click())
        const overlay = page.locator('.import-url-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(overlay).toBeHidden()
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Import Effect From ZIP dialog', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('importFromZipMenuItem').click())
        const overlay = page.locator('.import-effect-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(overlay).toBeHidden()
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Command Palette', async ({ page }) => {
        await boot(page)

        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        await page.keyboard.press('Escape')
        await expect(overlay).not.toHaveClass(/visible/)
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape in Performance Mode dismisses dialog without exiting performance mode', async ({ page }) => {
        await boot(page)

        // 1. Enter performance mode
        await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
        await expect(page.locator('body')).toHaveClass(/performance-mode/)
        await expect(page.locator('#menu .hf-menubar')).toBeHidden()

        // 2. Open Command Palette while in performance mode
        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        // 3. Press Escape: dismisses palette, but DOES NOT exit performance mode
        await page.keyboard.press('Escape')
        await expect(overlay).not.toHaveClass(/visible/)
        await expect(page.locator('body')).toHaveClass(/performance-mode/)
        await expect(page.locator('#menu .hf-menubar')).toBeHidden()

        // 4. Press Escape again: now that no dialogs/overlays are open, exits performance mode
        await page.keyboard.press('Escape')
        await expect(page.locator('body')).not.toHaveClass(/performance-mode/)
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    // Latency-focused behavioral check: Escape dismissal is synchronous (the
    // keydown handler removes the class/hides the element before returning),
    // so the FIRST animation frame after the real keydown must already show
    // the overlay gone. The measurement runs inside the page around the
    // CDP-injected keydown, so host polling delay between Playwright
    // roundtrips cannot inflate it — a genuinely delayed dismissal fails
    // this check while slow test plumbing does not.
    test('Escape dismissal completes within one animation frame of keydown', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('viewMenuItem-shortcuts').click())
        const overlay = page.locator('.shortcuts-overlay')
        await expect(overlay).toBeVisible()

        // Pre-arm a one-frame probe keyed on the actual Escape keydown, then
        // press the key. t0 is taken inside the page's own keydown handler,
        // so the Playwright press() roundtrip cannot inflate the measurement;
        // the 8s guard only bounds the test itself.
        await page.evaluate(() => {
            window.__escapeProbe = new Promise((resolve) => {
                const overlayEl = document.querySelector('.shortcuts-overlay')
                document.addEventListener('keydown', (e) => {
                    if (e.key !== 'Escape') return
                    const t0 = performance.now()
                    requestAnimationFrame(() => {
                        const gone = overlayEl.style.display === 'none' || !overlayEl.classList.contains('visible')
                        resolve({ gone, latencyMs: performance.now() - t0 })
                    })
                }, { once: true, capture: true })
                setTimeout(() => resolve({ gone: false, latencyMs: -1 }), 8000)
            })
        })
        await page.keyboard.press('Escape')
        const result = await page.evaluate(() => window.__escapeProbe)
        expect(result.gone).toBe(true)
        expect(result.latencyMs).toBeGreaterThanOrEqual(0)
        expect(result.latencyMs).toBeLessThan(50)
    })
})
