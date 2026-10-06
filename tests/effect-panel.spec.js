import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'


installHandfishLocal(test)

const SKETCH = [
    'search synth, filter',
    '',
    'perlin(scale: 75, octaves: 2)',
    '  .adjust(',
    '    mode: hsv,',
    '    rotation: 120,',
    '    hueRange: 40',
    '  )',
    '  .write(o0)',
    '',
    'render(o0)',
].join('\n')
const PAGE_URL = `/?dsl=${encodeURIComponent(SKETCH)}`

async function waitForApp(page) {
    await page.waitForFunction(() => !!(window.__poly && document.getElementById('dsl-editor')?.value), null, { timeout: 30000 })
    await page.waitForTimeout(500)
}

test("a parameter edit from the effect panel leaves the editor's native undo usable", async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)
    const readValue = () => page.evaluate(() => document.getElementById('dsl-editor').getTextarea().value)

    // Marker edit through the real keyboard path.
    await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
    })
    await page.keyboard.type(' // user note')
    // Wait out the hot-reload compile so the panel's program state matches.
    await page.waitForTimeout(1600)
    expect(await readValue()).toContain('// user note')

    // Open the effect panel on the perlin call. 'effectclick' is the
    // synthetic-dispatch path the editor itself uses for real clicks.
    await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const dsl = ed.value
        const idx = dsl.indexOf('perlin')
        ed.dispatchEvent(new CustomEvent('effectclick', { detail: { caretOffset: idx + 1, dsl }, bubbles: true }))
    })
    await expect(page.locator('#effect-controls-panel')).toBeVisible()

    // Real pointer interaction with the panel moves focus off the editor, as
    // when a user works the panel after typing. Click the title bar.
    await page.locator('#effect-controls-panel .ec-name').click()

    // Change the scale parameter through the panel's slider: its value is set
    // and its input event dispatched — the same handler a pointer drag drives.
    await page.evaluate(() => {
        const sliders = [...document.querySelectorAll('#effect-controls-panel slider-value')]
        const scale = sliders.find(s => Number(s.value) === 75)
        if (!scale) throw new Error('scale slider (value 75) not found')
        scale.value = 40
        scale.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(400)

    // The panel edit rewrote the program and kept the user's edit.
    const edited = await readValue()
    expect(edited).toContain('scale: 40')
    expect(edited).toContain('// user note')

    // Return to the editor (a real click placing the caret) and undo: one
    // Ctrl+Z removes the user's typed edit — the panel's programmatic
    // rewrite is transparent to the native undo stack.
    await page.locator('#dsl-editor').click()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(150)
    const undone = await readValue()
    expect(undone.trimEnd()).not.toContain("// user")
    expect(undone).toContain('perlin(')
})

test('chained panel edits keep the single-press undo transparent', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)
    const readValue = () => page.evaluate(() => document.getElementById('dsl-editor').getTextarea().value)

    // Marker edit through the real keyboard path.
    await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
    })
    await page.keyboard.type(' // user note')
    // Wait out the hot-reload compile so the panel's program state matches.
    await page.waitForTimeout(1600)
    expect(await readValue()).toContain('// user note')

    // Open the effect panel on the perlin call.
    await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const dsl = ed.value
        const idx = dsl.indexOf('perlin')
        ed.dispatchEvent(new CustomEvent('effectclick', { detail: { caretOffset: idx + 1, dsl }, bubbles: true }))
    })
    await expect(page.locator('#effect-controls-panel')).toBeVisible()
    await page.locator('#effect-controls-panel .ec-name').click()

    // Two consecutive panel edits: the second must chain onto the first
    // instead of leaving it as a stack entry Ctrl+Z has to undo first.
    await page.evaluate(() => {
        const sliders = [...document.querySelectorAll('#effect-controls-panel slider-value')]
        const scale = sliders.find(s => Number(s.value) === 75)
        if (!scale) throw new Error('scale slider (value 75) not found')
        scale.value = 40
        scale.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(400)
    expect(await readValue()).toContain('scale: 40')
    await page.evaluate(() => {
        const sliders = [...document.querySelectorAll('#effect-controls-panel slider-value')]
        const scale = sliders.find(s => Number(s.value) === 40)
        if (!scale) throw new Error('scale slider (value 40) not found')
        scale.value = 60
        scale.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(400)

    // The chained edits rewrote the program and kept the user's edit.
    const edited = await readValue()
    expect(edited).toContain('scale: 60')
    expect(edited).toContain('// user note')

    // One Ctrl+Z still removes the user's typed edit.
    await page.locator('#dsl-editor').click()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(150)
    const undone = await readValue()
    expect(undone.trimEnd()).not.toContain("// user")
    expect(undone).toContain('perlin(')
})
