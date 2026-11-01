import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

async function boot(page) {
    await page.goto('/?dsl=' + encodeURIComponent('render(o0)'))
    await page.waitForFunction(() => !!window.PolymorphicAgent)
    await page.evaluate(() => window.PolymorphicAgent.ready)
    await page.evaluate(() => {
        window.__notificationTicks = 0
        const tick = () => { window.__notificationTicks++; requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
    })
}

for (const kind of ['empty program', 'share failure', 'clipboard failure', 'blocked viewport']) {
    test(`existing ${kind} error uses a nonblocking toast`, async ({ page }) => {
        const dialogs = []
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
        await page.route('https://sharing.noisedeck.app/**', route => route.fulfill({
            status: kind === 'share failure' ? 503 : 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ shortUrl: 'https://noisedeck.app/s/error-test', expiresAt: '2030-01-01T00:00:00Z' }),
        }))
        await boot(page)
        let message
        if (kind === 'blocked viewport') {
            message = 'Viewport window blocked. Allow pop-ups for Polymorphic to use the secondary output.'
            await page.evaluate(() => { window.open = () => null })
        } else {
            if (kind === 'empty program') {
                await page.evaluate(() => { document.getElementById('dsl-editor').value = '' })
            }
            await page.evaluate(() => document.getElementById('shareProgram').click())
            await expect(page.locator('#share-modal')).toBeVisible()
            if (kind === 'clipboard failure') {
                await page.locator('#share-submit-btn').click()
                await expect(page.locator('#share-result')).toBeVisible()
                await page.evaluate(() => {
                    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                        writeText: async () => { throw new Error('clipboard denied') },
                    } })
                })
                message = 'Failed to copy URL to clipboard'
            } else {
                message = kind === 'empty program' ? 'No program to share' : 'Failed to share program. Please try again.'
            }
        }
        const before = await page.evaluate(() => window.__notificationTicks)
        if (kind === 'blocked viewport') {
            await page.evaluate(() => document.getElementById('viewMenuItem-open-viewport-window').click())
        } else {
            await page.locator(kind === 'clipboard failure' ? '#share-copy-btn' : '#share-submit-btn').click()
        }
        expect(dialogs).toEqual([])
        const toast = page.locator('.polymorphic-toast[data-type="error"]')
        await expect(toast).toBeVisible()
        await expect(toast).toHaveText(message)
        await expect(toast).toHaveAttribute('role', 'status')
        await expect.poll(() => page.evaluate(() => window.__notificationTicks)).toBeGreaterThan(before)
        expect(dialogs).toEqual([])
        if (kind === 'share failure') await expect(page.locator('#share-submit-btn')).toBeEnabled()
    })
}
