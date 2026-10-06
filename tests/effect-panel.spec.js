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

    // The panel's programmatic rewrite must not have wiped the textarea's
    // native undo stack: Ctrl+Z steps back through the panel's own edit, then
    // reaches the user's typed edit and removes it.
    let value = edited
    let undid = false
    for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Control+z')
        await page.waitForTimeout(40)
        const next = await readValue()
        if (next === value) break
        undid = true
        value = next
        if (!next.includes('// user note')) break
    }
    expect(undid).toBe(true)
    expect(value).not.toContain('// user note')
    expect(value).toContain('perlin(')
})
