// SPDX-License-Identifier: MIT
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { routeSeanceSdkLocal, startSeanceServer } from './seanceLocal.js'

const examples = JSON.parse(readFileSync('public/data/examples.json', 'utf8'))

const bootDsl = 'search synth, render\nsolid(color: #003366).write(o0)\nrender(o0)'

async function boot(page, url = `/?dsl=${encodeURIComponent(bootDsl)}`) {
    await page.goto(url)
    await page.waitForFunction(() => Boolean(window.__poly?.renderer?.isRunning && document.getElementById('dsl-editor')?.value), null, { timeout: 45000 })
}

test('curated gallery shows the complete collection with author attribution', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => window.__poly.gallery.open())
    await expect(page.locator('.gallery-card')).toHaveCount(157)
    await expect(page.locator('.gallery-card-title').first()).toHaveText('chaos voxicles 2')
    await expect(page.locator('.gallery-card-tagline').first()).toHaveText('Alex Ayars')
    await expect(page.locator('.gallery-card-tagline', { hasText: 'Jess Hewitt' })).toHaveCount(9)
    await page.evaluate(() => window.__poly.gallery.close())
})

test('custom curated program boots and registers its shaders for export', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    expect(example, 'prismatic chemtrails must be in the curated collection').toBeTruthy()
    await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
    await boot(page, '/')
    const loaded = await page.evaluate(async () => {
        const { getLoadedPortableEffects } = await import('/js/sharingLoader.js')
        return [...getLoadedPortableEffects().keys()]
    })
    expect(loaded).toContain('user/prismaticChemtrails')
    expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
})


test('custom curated cards and shuffle load their shader definitions', async ({ page }) => {
    const custom = examples.filter(e => e.effects?.length)
    expect(custom).toHaveLength(5)
    await page.route('**/data/examples.json', route => route.fulfill({ json: custom }))
    await boot(page)
    for (const example of custom) {
        await page.evaluate(() => window.__poly.gallery.open())
        await page.locator('.gallery-card', { has: page.locator('.gallery-card-title', { hasText: example.title }) }).click()
        await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl), { timeout: 30000 }).toBe(example.dsl)
    }
    await page.evaluate(() => window.__poly.gallery.open())
    await page.evaluate(() => { window.__savedRandom = Math.random; Math.random = () => 0 })
    try {
        await page.evaluate(() => window.__poly.gallery._shuffle())
        await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl), { timeout: 30000 }).toBe(custom[0].dsl)
        await expect(page.locator('.gallery-overlay')).not.toBeVisible()
    } finally {
        await page.evaluate(() => { Math.random = window.__savedRandom; delete window.__savedRandom })
    }
})

test('all curated programs compile and paint on WebGL2', async ({ page }, testInfo) => {
    test.setTimeout(600000)
    await boot(page)
    await page.evaluate(() => {
        window.__poly.renderer.stop()
        window.__poly.renderer.resize(256, 144)
    })
    const results = []
    for (const example of examples) {
        const result = await page.evaluate(async example => {
            const { prepareExample } = await import('/js/ui/gallery.js')
            const renderer = window.__poly.renderer
            try {
                await prepareExample(example)
                const compiled = await renderer.compile(example.dsl)
                if (!compiled.success) return { code: example.code, error: compiled.error }
                const engine = renderer.canvasRenderer
                const canvas = document.getElementById('canvas')
                const gl = canvas.getContext('webgl2')
                for (let frame = 0; frame < 16; frame++) engine.render(frame / 60)
                const pixels = new Uint8Array(canvas.width * canvas.height * 4)
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
                const colors = new Set()
                for (let i = 0; i < pixels.length; i += 4) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
                return { code: example.code, title: example.title, colors: colors.size, glError: gl.getError() }
            } catch (error) {
                return { code: example.code, error: error.message }
            }
        }, example)
        results.push(result)
        console.log(JSON.stringify(result))
    }
    await testInfo.attach('curated-render-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
    expect(results.filter(r => r.error || r.glError || r.colors < 2)).toEqual([])
})


test('curated previews preserve an active same-name custom shader until selection', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
    await boot(page)
    await page.evaluate(async example => {
        const { registerPortableEffect } = await import('/js/sharingLoader.js')
        await registerPortableEffect({ ...example.effects[0], description: 'Active imported definition' })
        await window.__poly.gallery.open()
    }, example)
    await page.waitForFunction(() => {
        const [entry] = window.__poly.gallery._previewsByCard.values()
        return entry?.warmedUp && !entry.warmingUp && !entry.preview
    })
    expect(await page.evaluate(async () => {
        const { getLoadedPortableEffects } = await import('/js/sharingLoader.js')
        return getLoadedPortableEffects().get('user/prismaticChemtrails').description
    })).toBe('Active imported definition')
    await page.locator('.gallery-card').click()
    await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
    expect(await page.evaluate(async () => {
        const { getLoadedPortableEffects } = await import('/js/sharingLoader.js')
        return getLoadedPortableEffects().get('user/prismaticChemtrails').description
    })).toBe(example.effects[0].description)
})


test('cancelled curated preview preparation does not register shaders', async ({ page }) => {
    await boot(page)
    const result = await page.evaluate(async example => {
        const { prepareExample } = await import('/js/ui/gallery.js')
        const { getLoadedPortableEffects } = await import('/js/sharingLoader.js')
        let cancelled = false
        const pending = prepareExample(example, { preview: true, isCancelled: () => cancelled })
        cancelled = true
        await pending
        return getLoadedPortableEffects().has('user/prismaticChemtrails')
    }, examples.find(e => e.code === '7INvow'))
    expect(result).toBe(false)
})


test('GLSL-only curated startup selects WebGL2 when WebGPU was requested', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
    await boot(page, '/?backend=webgpu')
    expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe('webgl2')
    expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
})

for (const action of ['card', 'shuffle']) {
    test(`GLSL-only curated ${action} transitions from WebGPU with the selected program`, async ({ page }) => {
        const example = examples.find(e => e.code === '7INvow')
        await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
        await boot(page, `/?backend=webgpu&dsl=${encodeURIComponent(bootDsl)}`)
        expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe('webgpu')
        await page.evaluate(() => window.__poly.gallery.open())
        if (action === 'card') await page.locator('.gallery-card').click()
        else await page.evaluate(() => window.__poly.gallery._shuffle())
        await page.waitForURL(url => url.searchParams.get('backend') === 'webgl2' && url.searchParams.get('curated') === example.id)
        await page.waitForFunction(() => window.__poly?.renderer?.isRunning && document.getElementById('dsl-editor')?.value)
        expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe('webgl2')
        expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
    })
}


test('edited curated URLs reload with their custom shaders', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    const edited = example.dsl + '\n// edited program'
    const params = new URLSearchParams({ curated: example.id, dsl: edited, backend: 'webgpu' })
    await boot(page, '/?' + params)
    expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe('webgl2')
    expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(edited)
})

test('explicit backend command overrides a curated fallback URL', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    const compatible = { id: 'test-compatible', code: 'compatible', title: 'Compatible', dsl: bootDsl, tags: [], tagline: 'Test author' }
    await page.route('**/data/examples.json', route => route.fulfill({ json: [example, compatible] }))
    await boot(page, '/?' + new URLSearchParams({ curated: example.id, backend: 'webgl2' }))
    await page.evaluate(() => window.__poly.gallery.open())
    await page.locator('.gallery-card', { has: page.locator('.gallery-card-title', { hasText: 'Compatible' }) }).click()
    await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(bootDsl)
    await page.evaluate(() => window.__poly.commandPalette.open())
    await page.locator('.cmd-palette-input').fill('Switch to WebGPU')
    await page.locator('.cmd-palette-item', { hasText: 'Switch to WebGPU backend' }).click()
    await page.waitForURL(url => url.searchParams.get('backend') === 'webgpu')
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning)
    expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe('webgpu')
    expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(bootDsl)
})

test('online curated selection survives the WebGPU reload in its existing session', async ({ page }, testInfo) => {
    const server = await startSeanceServer({ origin: testInfo.project.use.baseURL })
    try {
        await routeSeanceSdkLocal(page)
        const example = examples.find(e => e.code === '7INvow')
        await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
        const params = new URLSearchParams({ backend: 'webgpu', dsl: bootDsl, seanceUrl: server.url })
        await boot(page, '/?' + params)
        const sessionId = await page.evaluate(() => window.__poly.onlineAdapter.takeOnline())
        expect(sessionId).toBeTruthy()
        await page.waitForFunction(() => window.__poly.onlineAdapter.isOnline())
        await page.evaluate(() => window.__poly.gallery.open())
        await page.locator('.gallery-card').click()
        await page.waitForURL(url => url.searchParams.get('backend') === 'webgl2')
        await page.waitForFunction(() => window.__poly?.renderer?.isRunning && window.__poly.onlineAdapter.isOnline())
        expect(new URL(page.url()).searchParams.get('seance')).toBe(sessionId)
        await expect.poll(() => page.evaluate(() => document.getElementById('dsl-editor').value)).toBe(example.dsl)
        await expect.poll(() => page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(example.dsl)
    } finally {
        await server.stop()
    }
})


test('random curated startup retains shader context through an edit and reload', async ({ page }) => {
    const example = examples.find(e => e.code === '7INvow')
    await page.route('**/data/examples.json', route => route.fulfill({ json: [example] }))
    await boot(page, '/')
    expect(new URL(page.url()).searchParams.get('curated')).toBe(example.id)
    const edited = example.dsl.replace('dispersion: 0.46', 'dispersion: 0.4')
    await page.evaluate(edited => {
        const editor = document.getElementById('dsl-editor')
        editor.value = edited
        editor.dispatchEvent(new Event('input', { bubbles: true }))
    }, edited)
    await expect.poll(() => new URL(page.url()).searchParams.get('dsl')).toBe(edited)
    await page.reload()
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning)
    expect(await page.evaluate(() => window.__poly.renderer._currentDsl)).toBe(edited)
})


test('every visible curated card paints a still thumbnail before hover', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await boot(page)
    await page.evaluate(() => window.__poly.gallery.open())
    await page.waitForFunction(() => {
        const entries = [...window.__poly.gallery._previewsByCard.values()]
        return entries.filter(e => e.warmedUp).length >= 9 && entries.every(e => !e.warmingUp && !e.warmUpPending)
    })
    const results = await page.evaluate(async () => {
        const results = []
        for (const [card, entry] of window.__poly.gallery._previewsByCard) {
            if (!entry.warmedUp) continue
            const title = card.querySelector('.gallery-card-title').textContent
            const image = entry.snapshotImg
            if (!image) { results.push({ title, colors: 0 }); continue }
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            const colors = new Set()
            for (let i = 0; i < pixels.length; i += 4) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
            results.push({ title, colors: colors.size })
        }
        return results
    })
    expect(results.filter(r => r.colors < 2)).toEqual([])
    await page.evaluate(() => window.__poly.gallery.close())
})


async function delayFirstPreviewManifest(page) {
    let release
    const gate = new Promise(resolve => { release = resolve })
    let blocked = false
    await page.route('**/effects/manifest.json', async route => {
        if (!blocked) { blocked = true; await gate }
        await route.continue()
    })
    return { release, isBlocked: () => blocked }
}

test('hover promotes a queued curated preview to a visible canvas', async ({ page }) => {
    await boot(page)
    const gate = await delayFirstPreviewManifest(page)
    try {
        await page.evaluate(() => window.__poly.gallery.open())
        await expect.poll(gate.isBlocked).toBe(true)
        const card = page.locator('.gallery-card').nth(1)
        await card.hover()
        await expect(card.locator('.gallery-card-preview-canvas')).toBeVisible()
        await page.waitForFunction(() => [...window.__poly.gallery._previewsByCard.values()][1]?.preview?._ready)
    } finally {
        gate.release()
        await page.evaluate(() => window.__poly.gallery.close())
    }
})

test('a curated warm-up cancelled during loading retries when scrolled into view', async ({ page }) => {
    await boot(page)
    const gate = await delayFirstPreviewManifest(page)
    try {
        await page.evaluate(() => window.__poly.gallery.open())
        await expect.poll(gate.isBlocked).toBe(true)
        await page.locator('.gallery-body').evaluate(el => { el.scrollTop = el.scrollHeight })
        await page.waitForFunction(() => [...window.__poly.gallery._previewsByCard.values()][0]?.inView === false)
        gate.release()
        await page.evaluate(() => window.__poly.gallery._warmUpQueue)
        await page.locator('.gallery-body').evaluate(el => { el.scrollTop = 0 })
        await expect(page.locator('.gallery-card').first().locator('.gallery-card-snapshot')).toBeVisible({ timeout: 30000 })
    } finally {
        gate.release()
        await page.evaluate(() => window.__poly.gallery.close())
    }
})


test('gallery keyboard: curated cards load their actual programs with Enter and Space', async ({ page }) => {
    const { routeHandfishLocal } = await import('./handfishLocal.js')
    const { routeKeyboardGallery, expectKeyboardGalleryLoads, keyboardCurated } = await import('./galleryKeyboardFixtures.js')
    await routeHandfishLocal(page)
    await routeKeyboardGallery(page)
    await expectKeyboardGalleryLoads(page, expect, 'curated', keyboardCurated)
})

test('gallery keyboard: Noisedeck cards load their actual programs with Enter and Space', async ({ page }) => {
    const { routeHandfishLocal } = await import('./handfishLocal.js')
    const { routeKeyboardGallery, expectKeyboardGalleryLoads, keyboardNoisedeck } = await import('./galleryKeyboardFixtures.js')
    await routeHandfishLocal(page)
    await routeKeyboardGallery(page)
    await expectKeyboardGalleryLoads(page, expect, 'noisedeck-examples', keyboardNoisedeck)
})
