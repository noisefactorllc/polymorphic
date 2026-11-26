/**
 * The output picker on the WebGPU renderer. A WebGPU canvas reads back blank
 * through drawImage(), so pixel evidence comes from the engine's presented
 * texture through the agent's thumbnail. The file name matches the shared
 * WebGPU spec regex, so Playwright runs it in the ANGLE Vulkan project.
 */
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)
test.describe.configure({ timeout: 90000 })

const ID_DSL = 'search synth, render\n\nnoise(scaleX: 80, scaleY: 80, _id: "a").write(o0, _id: "w1")\nnoise(scaleX: 40, scaleY: 40, _id: "b").write(o1, _id: "w2")\n\nrender(o0)'

test('an id-carrying write program boots on WebGPU, builds its pips and renders real pixels', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('polymorphic-output-picker', '1'))
    await page.goto('/?dsl=' + encodeURIComponent(ID_DSL) + '&backend=webgpu')
    await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
    expect(await page.evaluate(() => window.__poly.backend)).toBe('webgpu')

    // The picker builds one live preview per written surface despite the ids.
    await page.waitForFunction(() => window.__poly.outputPicker?._previews?.size === 2, null, { timeout: 30000 })
    await expect(page.locator('.output-picker.visible .output-pip')).toHaveCount(2)

    // Count the native readbacks from the presented texture: the path this
    // evidence is for.
    await page.evaluate(() => {
        const backend = window.__poly.renderer.inner.pipeline.backend
        const readPixels = backend.readPixels
        window.readbacks = 0
        backend.readPixels = function (...args) {
            window.readbacks++
            return readPixels.apply(this, args)
        }
    })
    const out = await page.evaluate(async (dsl) => {
        const A = window.PolymorphicAgent
        await A.setProgram({ dsl })
        await A.pause()
        const env = await A.getThumbnail({ maxDimension: 64, format: 'png' })
        const bytes = Uint8Array.from(atob(env.result.bytes), c => c.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0)
        const data = ctx.getImageData(0, 0, image.width, image.height).data
        const colors = new Set()
        for (let i = 0; i < data.length; i += 4) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
        return { backend: env.state.backend, colors: colors.size }
    }, ID_DSL)
    expect(out.backend).toBe('webgpu')
    expect(await page.evaluate(() => window.readbacks)).toBeGreaterThan(0)
    expect(out.colors, 'the WebGPU thumbnail renders varied pixels for the id-carrying program').toBeGreaterThan(1)
})
