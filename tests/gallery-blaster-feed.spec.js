// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// The NoiseBLASTER! tab asks for a 250-composition feed page, the most
// NoiseBLASTER!'s default listing keeps, so one request covers the whole corpus.
test('the NoiseBLASTER! tab requests a 250-composition feed page', async ({ page }) => {
    const feedUrls = []
    await page.route('https://blaster.noisedeck.app/api/feed*', route => {
        feedUrls.push(route.request().url())
        return route.fulfill({
            json: { compositions: [], page: 0, limit: 250, total: 0, hasMore: false },
            headers: { 'access-control-allow-origin': '*' },
        })
    })
    await page.goto(`/?dsl=${encodeURIComponent('render(o0)')}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })

    await page.evaluate(() => document.getElementById('viewMenuItem-gallery').click())
    await page.click('.gallery-tab[data-tab="blaster"]')
    await expect.poll(() => feedUrls.length).toBeGreaterThan(0)
    for (const url of feedUrls) expect(new URL(url).searchParams.get('limit')).toBe('250')
})
