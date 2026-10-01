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
        // Dismissal is synchronous; the long window only absorbs host-load
        // latency in the expect roundtrip (documented 5s race under load ~9).
        await expect(overlay).toBeHidden({ timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Shortcuts dialog overlay', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('viewMenuItem-shortcuts').click())
        const overlay = page.locator('.shortcuts-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        // Dismissal is synchronous; the long window only absorbs host-load
        // latency in the expect roundtrip (documented 5s race under load ~9).
        await expect(overlay).toBeHidden({ timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Share modal', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('shareProgram').click())
        const overlay = page.locator('.share-modal-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        // Dismissal is synchronous; the long window only absorbs host-load
        // latency in the expect roundtrip (documented 5s race under load ~9).
        await expect(overlay).toBeHidden({ timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Import From URL dialog', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('importFromUrlMenuItem').click())
        const overlay = page.locator('.import-url-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        // Dismissal is synchronous; the long window only absorbs host-load
        // latency in the expect roundtrip (documented 5s race under load ~9).
        await expect(overlay).toBeHidden({ timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Import Effect From ZIP dialog', async ({ page }) => {
        await boot(page)

        await page.evaluate(() => document.getElementById('importFromZipMenuItem').click())
        const overlay = page.locator('.import-effect-overlay')
        await expect(overlay).toBeVisible()

        await page.keyboard.press('Escape')
        // Dismissal is synchronous; the long window only absorbs host-load
        // latency in the expect roundtrip (documented 5s race under load ~9).
        await expect(overlay).toBeHidden({ timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })

    test('Escape dismisses Command Palette', async ({ page }) => {
        await boot(page)

        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        await page.keyboard.press('Escape')
        await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 })
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
        await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 })
        await expect(page.locator('body')).toHaveClass(/performance-mode/)
        await expect(page.locator('#menu .hf-menubar')).toBeHidden()

        // 4. Press Escape again: now that no dialogs/overlays are open, exits performance mode
        await page.keyboard.press('Escape')
        await expect(page.locator('body')).not.toHaveClass(/performance-mode/, { timeout: 15000 })
        await expect(page.locator('#menu .hf-menubar')).toBeVisible()
    })
})
