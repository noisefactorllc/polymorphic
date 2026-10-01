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

    // Drag to the right by 20px (scale: 75 -> 95 within bounds [0, 100])
    await page.mouse.move(coords.x + 20, coords.y, { steps: 5 })
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
    expect(guardState.currentValue).toContain('scale: 95')

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

test('scrubber fine-tunes with Shift and displays modifier rate badge in tooltip', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)

    // Calculate position of literal "120"
    const coords = await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const ta = ed.getTextarea()
        const idx = ta.value.indexOf('120')
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
            x: r.x + padLeft + colNum * charW + 8,
            y: r.y + padTop + lineNum * lineH + lineH / 2,
        }
    })

    // Move mouse over 120 and start scrubbing with Alt + Shift
    await page.mouse.move(coords.x, coords.y)
    await page.keyboard.down('Alt')
    await page.keyboard.down('Shift')
    await page.waitForTimeout(50)
    await page.mouse.down()
    await page.waitForTimeout(50)

    // Drag 20px to the right (at 0.1x acceleration = +2 units)
    await page.mouse.move(coords.x + 20, coords.y, { steps: 5 })
    await page.waitForTimeout(50)

    const scrubState = await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        const tooltip = document.querySelector('.scrubber-tooltip')
        const hint = tooltip?.querySelector('.scrubber-tooltip-hint')?.textContent || ''
        const val = tooltip?.querySelector('.scrubber-tooltip-value')?.textContent || ''
        return {
            value: ta.value,
            hint,
            tooltipValue: val,
        }
    })

    expect(scrubState.hint).toContain('0.1×')
    expect(scrubState.value).toContain('rotation: 122')
    expect(scrubState.tooltipValue).toBe('122')

    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.keyboard.up('Alt')
})

test('scrubber clamps parameter bounds with zero turnaround lag', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)

    // Find position of literal "2" in octaves: 2
    const coords = await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        const ta = ed.getTextarea()
        const idx = ta.value.indexOf('octaves: 2') + 'octaves: '.length
        const cs = getComputedStyle(ta)
        const lineH = parseFloat(cs.lineHeight) || 24
        const charW = parseFloat(cs.fontSize) * 0.6
        const before = ta.value.slice(0, idx)
        const lineNum = (before.match(/\n/g) || []).length
        const lastNL = before.lastIndexOf('\n')
        const colNum = idx - lastNL - 1
        const r = ta.getBoundingClientRect()
        const x0 = r.x + (parseFloat(cs.paddingLeft) || 0) + colNum * charW + 4
        const y = r.y + (parseFloat(cs.paddingTop) || 0) + lineNum * lineH + lineH / 2
        // The estimated x can drift off the digit under different font
        // metrics; probe nearby x positions until the caret lands on the
        // literal's offset (idx or idx+1). Mirror the scrubber's own caret
        // resolution order: caretPositionFromPoint first (textarea offsets),
        // caretRangeFromPoint only when it actually hit the textarea — the
        // display wrapper returns offsets meaningless for ta.value.
        const caretAt = (x) => {
            if (typeof document.caretPositionFromPoint === 'function') {
                const cp = document.caretPositionFromPoint(x, y)
                if (cp && cp.offsetNode === ta) return cp.offset
            }
            if (typeof document.caretRangeFromPoint === 'function') {
                const cr = document.caretRangeFromPoint(x, y)
                if (cr && cr.startContainer === ta) return cr.startOffset
            }
            return null
        }
        let best = null
        for (let dx = -4; dx <= 4; dx += 0.25) {
            const off = caretAt(x0 + dx * charW)
            if (off === idx || off === idx + 1) { best = x0 + dx * charW; break }
        }
        if (best == null) throw new Error(`could not land caret on octaves literal (idx ${idx})`)
        return { x: best, y }
    })

    // Drag left by 50px (octaves minimum is 1)
    await page.mouse.move(coords.x, coords.y)
    await page.keyboard.down('Alt')
    await page.waitForTimeout(50)
    await page.mouse.down()
    await page.waitForTimeout(50)

    await page.mouse.move(coords.x - 50, coords.y, { steps: 5 })
    await page.waitForTimeout(50)

    const minState = await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        const tooltip = document.querySelector('.scrubber-tooltip')
        const val = tooltip?.querySelector('.scrubber-tooltip-value')?.textContent || ''
        return {
            value: ta.value,
            tooltipValue: val,
        }
    })

    expect(minState.value).toContain('octaves: 1')
    expect(minState.tooltipValue).toContain('(min)')

    // Reverse direction by +2px immediately: value should turnaround instantly without dead-zone lag
    await page.mouse.move(coords.x - 48, coords.y, { steps: 2 })
    await page.waitForTimeout(50)

    const turnaroundState = await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        const tooltip = document.querySelector('.scrubber-tooltip')
        const val = tooltip?.querySelector('.scrubber-tooltip-value')?.textContent || ''
        return {
            value: ta.value,
            tooltipValue: val,
        }
    })

    // Turnaround must immediately register +2 to 3, without having to re-traverse the dead-zone
    expect(turnaroundState.value).toContain('octaves: 3')
    expect(turnaroundState.tooltipValue).toBe('3')

    await page.mouse.up()
    await page.keyboard.up('Alt')
})

