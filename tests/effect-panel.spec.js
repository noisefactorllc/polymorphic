import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'
import { typeAtHumanPace } from './keyboardTyping.js'


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

// The user's note goes at the end of the program's first line, of a line in
// its middle, and of its last line.
const NOTE_LINES = [
    ['first', 'search synth, filter'],
    ['middle', '  .write(o0)'],
    ['last', 'render(o0)'],
]

async function waitForApp(page) {
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true && !!document.getElementById('dsl-editor')?.value, null, { timeout: 30000 })
}

const readValue = page => page.evaluate(() => document.getElementById('dsl-editor').getTextarea().value)

// Wait until the renderer runs the editor's current text. The panel writes
// back only over the program it was built from, so a parameter edit made
// before the hot reload lands would not reach the editor.
async function waitForCompiledEditorText(page) {
    await page.waitForFunction(() => {
        const compiled = window.__poly?.renderer?.canvasRenderer?.currentDsl
        return compiled === document.getElementById('dsl-editor').getTextarea().value
    }, null, { timeout: 30000 })
}

// Type `text` through real key presses, at a person's steady pace, with the
// caret at the end of `line`. The presses carry their own times, so a loaded
// machine cannot stretch the pauses between them into separate undo steps.
async function typeAtEndOfLine(page, line, text) {
    await page.evaluate((line) => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        const lines = ta.value.split('\n')
        const index = lines.indexOf(line)
        if (index < 0) throw new Error(`line not found: ${line}`)
        const offset = lines.slice(0, index + 1).join('\n').length
        ta.focus()
        ta.setSelectionRange(offset, offset)
    }, line)
    await typeAtHumanPace(page, text)
    await waitForCompiledEditorText(page)
}

// Open the effect panel with a real click on the effect's name in the editor.
async function openPanelFor(page, name) {
    const at = await page.evaluate((name) => {
        const display = document.querySelector('#dsl-editor .code-editor-display')
        const el = [...display.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent === name)
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }, name)
    expect(at, `${name} is not shown in the editor`).not.toBeNull()
    await page.mouse.click(at.x, at.y)
    await expect(page.locator('#effect-controls-panel')).toBeVisible()
}

// Drag the panel's slider for `param` with real pointer input, from its thumb
// to `fraction` of its track. Returns the slider's value after the drag.
async function dragPanelSlider(page, param, fraction) {
    const track = await page.evaluate((param) => {
        const slider = [...document.querySelectorAll('#effect-controls-panel slider-value')]
            .find(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.trim() === param)
        const input = slider?.querySelector('input[type=range]')
        if (!input) return null
        const rect = input.getBoundingClientRect()
        return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width, min: Number(input.min), max: Number(input.max), value: Number(input.value) }
    }, param)
    expect(track, `no ${param} slider in the panel`).not.toBeNull()
    const thumb = track.x + track.width * (track.value - track.min) / (track.max - track.min)
    await page.mouse.move(thumb, track.y)
    await page.mouse.down()
    await page.mouse.move(track.x + track.width * fraction, track.y, { steps: 8 })
    await page.mouse.up()
    return page.evaluate((param) => {
        const slider = [...document.querySelectorAll('#effect-controls-panel slider-value')]
            .find(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.trim() === param)
        return Number(slider.value)
    }, param)
}

// Wait for the panel's write to reach the editor and return the scale literal
// it wrote.
async function writtenScale(page, value) {
    await expect.poll(() => readValue(page)).not.toContain('scale: 75,')
    const literal = (await readValue(page)).match(/scale: ([0-9.]+),/)?.[1]
    expect(literal, 'the panel wrote no scale literal').toBeTruthy()
    expect(Number(literal)).toBeCloseTo(value, 5)
    return literal
}

for (const [where, line] of NOTE_LINES) {
    test(`a parameter edit from the effect panel leaves the editor's native undo usable (note on the ${where} line)`, async ({ page }) => {
        test.slow()
        await page.goto(PAGE_URL)
        await waitForApp(page)

        // Marker edit through the real keyboard path.
        await typeAtEndOfLine(page, line, ' // user note')
        const typed = SKETCH.replace(line, `${line} // user note`)
        expect(await readValue(page)).toBe(typed)

        // Change the scale parameter with a real drag of the panel's slider.
        await openPanelFor(page, 'perlin')
        const value = await dragPanelSlider(page, 'scale', 0.3)
        expect(value).not.toBe(75)
        const scale = await writtenScale(page, value)

        // The panel edit changed the value and nothing else: the user's note
        // stays where it was typed. Soft, so the undo below is checked too.
        expect.soft(await readValue(page)).toBe(typed.replace('scale: 75,', `scale: ${scale},`))

        // Return to the editor (a real click placing the caret) and undo:
        // one Ctrl/Cmd+Z removes the typed note and keeps the panel's value.
        await page.locator('#dsl-editor').click()
        await page.keyboard.press('ControlOrMeta+z')
        expect(await readValue(page)).toBe(SKETCH.replace('scale: 75,', `scale: ${scale},`))
    })
}

test('chained panel edits keep the single-press undo transparent', async ({ page }) => {
    test.slow()
    await page.goto(PAGE_URL)
    await waitForApp(page)

    // Marker edit through the real keyboard path, on its own line.
    await typeAtEndOfLine(page, 'render(o0)', '\n// panel note')
    expect(await readValue(page)).toBe(`${SKETCH}\n// panel note`)

    // Two separate real drags of the scale slider: the second write must
    // chain onto the first instead of leaving it as a stack entry Ctrl+Z has
    // to undo first.
    await openPanelFor(page, 'perlin')
    const first = await writtenScale(page, await dragPanelSlider(page, 'scale', 0.3))
    const second = await dragPanelSlider(page, 'scale', 0.6)
    await expect.poll(() => readValue(page)).not.toContain(`scale: ${first},`)
    const scale = await writtenScale(page, second)
    expect.soft(await readValue(page)).toBe(`${SKETCH}\n// panel note`.replace('scale: 75,', `scale: ${scale},`))

    // One Ctrl/Cmd+Z removes the user's typed edit and the chained panel
    // value stays in place.
    await page.locator('#dsl-editor').click()
    await page.keyboard.press('ControlOrMeta+z')
    expect(await readValue(page)).toBe(SKETCH.replace('scale: 75,', `scale: ${scale},`))
})
