// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

async function boot(page) {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })
    await page.waitForTimeout(500)
}

test.describe('Storage Quota Guard & Storage Resilience', () => {
    test('Scene save displays error toast and rolls back on quota exceeded', async ({ page }) => {
        await boot(page)

        // Inject quota exceeded error into localStorage.setItem for polymorphic-scenes
        await page.evaluate(() => {
            const originalSetItem = localStorage.setItem.bind(localStorage)
            localStorage.setItem = (key, val) => {
                if (key === 'polymorphic-scenes') {
                    const err = new Error('Quota exceeded')
                    err.name = 'QuotaExceededError'
                    throw err
                }
                return originalSetItem(key, val)
            }
        })

        // Ensure the editor has content
        await page.evaluate(() => {
            const editor = document.querySelector('code-editor') || document.querySelector('textarea')
            if (editor) editor.value = 'gradient().write(o0)'
        })

        // Press Cmd/Ctrl+Shift+1 to save to scene slot 1
        await page.keyboard.press('Control+Shift+Digit1')

        // Assert error toast is displayed
        const toast = page.locator('.polymorphic-toast')
        await expect(toast).toBeVisible({ timeout: 5000 })
        await expect(toast).toHaveAttribute('data-type', 'error')
        await expect(toast).toContainText('storage quota exceeded')
    })

    test('Program modal displays error toast when saving under quota pressure', async ({ page }) => {
        await boot(page)

        // Open save program modal
        await page.evaluate(() => {
            document.getElementById('saveProgram')?.click()
        })
        const modal = page.locator('#programModal')
        await expect(modal).toBeVisible()

        // Fill program name
        await page.fill('#programNameInput', 'quota-test')

        // Inject quota exceeded error for polymorphic-programs
        await page.evaluate(() => {
            const originalSetItem = localStorage.setItem.bind(localStorage)
            localStorage.setItem = (key, val) => {
                if (key === 'polymorphic-programs') {
                    const err = new Error('Quota exceeded')
                    err.name = 'QuotaExceededError'
                    throw err
                }
                return originalSetItem(key, val)
            }
        })

        // Click save button
        await page.click('#programSaveBtn')

        // Assert error toast is shown and modal remains open
        const toast = page.locator('.polymorphic-toast')
        await expect(toast).toBeVisible({ timeout: 5000 })
        await expect(toast).toHaveAttribute('data-type', 'error')
        await expect(toast).toContainText('storage quota exceeded')
        await expect(modal).toBeVisible()
    })
})
