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

test('scrubber guards text selection with user-select: none during Alt-drag', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)

    const editor = page.locator('#dsl-editor')
    await expect(editor).toBeVisible()

    // Calculate position of literal "75"
    const coords = await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const ta = ed.getTextarea()
        const idx = ta.value.indexOf('75')
        const span75 = Array.from(ed.querySelectorAll('*')).find(el => el.textContent === '75' || el.textContent === '75,')
        const spanRect = span75 ? span75.getBoundingClientRect() : null
        if (spanRect && spanRect.width > 0) {
            return { x: spanRect.x + spanRect.width / 2, y: spanRect.y + spanRect.height / 2 }
        }
        const cs = getComputedStyle(ta)
        const lineH = parseFloat(cs.lineHeight) || 24
        const charW = parseFloat(cs.fontSize) * 0.6
        const before = ta.value.slice(0, idx)
        const lineNum = (before.match(/\n/g) || []).length
        const lastNL = before.lastIndexOf('\n')
        const colNum = idx - lastNL - 1
        const r = ta.getBoundingClientRect()
        const padTop = parseFloat(cs.paddingTop) || 0
        const padLeft = parseFloat(cs.paddingLeft) || 0
        return {
            x: r.x + padLeft + colNum * charW + 4,
            y: r.y + padTop + lineNum * lineH + lineH / 2,
        }
    })

    // Move mouse over the number without Alt
    await page.mouse.move(coords.x, coords.y)
    let hasHover = await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        return ta.classList.contains('scrubber-hover-target')
    })
    expect(hasHover).toBe(false)

    // Press Alt
    await page.keyboard.down('Alt')
    await page.waitForTimeout(50)
    hasHover = await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        return ta.classList.contains('scrubber-hover-target')
    })
    expect(hasHover).toBe(true)

    // Mouse down with Alt to start scrubbing
    await page.mouse.down()
    await page.waitForTimeout(50)

    // Drag to the right
    await page.mouse.move(coords.x + 40, coords.y, { steps: 5 })
    await page.waitForTimeout(50)

    // Check selection guard while dragging
    const guardState = await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const ta = ed.getTextarea()
        const tooltip = document.querySelector('.scrubber-tooltip')
        return {
            editorHasClass: ed.classList.contains('scrubber-active'),
            editorUserSelect: ed.style.userSelect,
            textareaUserSelect: ta.style.userSelect,
            bodyHasCursorClass: document.body.classList.contains('scrubber-active-cursor'),
            hasTooltip: !!tooltip,
            currentValue: ta.value,
        }
    })

    expect(guardState.editorHasClass).toBe(true)
    expect(guardState.editorUserSelect).toBe('none')
    expect(guardState.textareaUserSelect).toBe('none')
    expect(guardState.bodyHasCursorClass).toBe(true)
    expect(guardState.hasTooltip).toBe(true)
    expect(guardState.currentValue).not.toContain('scale: 75')
    expect(guardState.currentValue).toContain('scale: 115')

    // Release mouse
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForTimeout(100)

    // Check that guard is removed
    const releasedState = await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const ta = ed.getTextarea()
        const tooltip = document.querySelector('.scrubber-tooltip')
        return {
            editorHasClass: ed.classList.contains('scrubber-active'),
            editorUserSelect: ed.style.userSelect,
            textareaUserSelect: ta.style.userSelect,
            bodyHasCursorClass: document.body.classList.contains('scrubber-active-cursor'),
            hasTooltip: !!tooltip,
        }
    })

    expect(releasedState.editorHasClass).toBe(false)
    expect(releasedState.editorUserSelect).toBe('')
    expect(releasedState.textareaUserSelect).toBe('')
    expect(releasedState.bodyHasCursorClass).toBe(false)
    expect(releasedState.hasTooltip).toBe(false)
})
