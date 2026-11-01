// SPDX-License-Identifier: MIT
export const keyboardBootDsl = 'search synth, render\nsolid(color: #003366).write(o0)\nrender(o0)'
export const keyboardCurated = [
    { id: 'keyboard-red', title: 'Keyboard red', dsl: 'search synth, render\nsolid(color: #ff0000).write(o0)\nrender(o0)', tags: [], tagline: 'Test author' },
    { id: 'keyboard-green', title: 'Keyboard green', dsl: 'search synth, render\nsolid(color: #00ff00).write(o0)\nrender(o0)', tags: [], tagline: 'Test author' },
]
export const keyboardBlaster = [
    { code: 'keyboard-blue', title: 'Keyboard blue', app: 'polymorphic', username: 'test', dsl: 'search synth, render\nsolid(color: #0000ff).write(o0)\nrender(o0)' },
    { code: 'keyboard-yellow', title: '', app: 'polymorphic', username: 'test', dsl: 'search synth, render\nsolid(color: #ffff00).write(o0)\nrender(o0)' },
]
export const keyboardNoisedeck = [
    { file: 'keyboard-cyan.dsl', title: 'Keyboard cyan', dsl: 'search synth, render\nsolid(color: #00ffff).write(o0)\nrender(o0)' },
    { file: 'keyboard-magenta.dsl', dsl: 'search synth, render\nsolid(color: #ff00ff).write(o0)\nrender(o0)' },
]

export async function routeKeyboardGallery(page, { curated = true } = {}) {
    if (curated) await page.route('**/data/examples.json', route => route.fulfill({ json: keyboardCurated }))
    await page.route('https://blaster.noisedeck.app/api/feed*', route => route.fulfill({
        json: { compositions: keyboardBlaster, page: 0, limit: 250, total: keyboardBlaster.length, hasMore: false },
        headers: { 'access-control-allow-origin': '*' },
    }))
    await page.route('https://sharing.noisedeck.app/api/composition/*', route => {
        const code = new URL(route.request().url()).pathname.split('/').at(-1)
        const item = keyboardBlaster.find(item => item.code === code)
        return route.fulfill({ json: { ...item, effects: [], images: [] }, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route('https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json', route => route.fulfill({
        json: { filesUrl: '/keyboard-gallery/', files: keyboardNoisedeck.map(({ dsl, ...file }) => file) },
        headers: { 'access-control-allow-origin': '*' },
    }))
    await page.route('https://shuffleset.stream/keyboard-gallery/*', route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1))
        return route.fulfill({ body: keyboardNoisedeck.find(item => item.file === file).dsl, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' } })
    })
}

export async function expectKeyboardGalleryLoads(page, expect, tab, examples) {
    for (const [index, example] of examples.entries()) {
        for (const key of ['Enter', 'Space']) {
            await page.goto(`/?dsl=${encodeURIComponent(keyboardBootDsl)}`)
            await page.waitForFunction(() => window.__poly?.renderer?.isRunning)
            await page.evaluate(() => window.__poly.gallery.open())
            if (tab !== 'curated') await page.locator(`.gallery-tab[data-tab="${tab}"]`).click()
            await expect(page.locator('.gallery-card')).toHaveCount(examples.length)
            const card = page.locator('.gallery-card').nth(index)
            await expect(card).toHaveRole('button')
            await expect(card).toHaveAccessibleName(example.title || example.file || '(untitled)')
            await expect(card).toHaveAttribute('tabindex', '0')
            await card.focus()
            await page.keyboard.press('Shift+Tab')
            await page.keyboard.press('Tab')
            await expect(card).toBeFocused()
            await card.dispatchEvent('keydown', { key: key === 'Space' ? ' ' : key, repeat: true })
            await expect(page.locator('.gallery-overlay')).toBeVisible()
            expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(keyboardBootDsl)
            await page.keyboard.press(key)
            await expect(page.locator('.gallery-overlay')).toBeHidden()
            await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
            await expect(page.locator('#dsl-editor')).toHaveJSProperty('value', example.dsl)
        }
    }
}
