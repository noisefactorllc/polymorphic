import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// Document-level single-key shortcuts (T tap-tempo, bare-digit scene recall,
// ? shortcuts dialog) must not fire from states where the key belongs to
// something else: a focused handfish custom-control trigger (the effect
// panel's select-dropdown type-ahead, a toggle switch, a menu-bar trigger) or
// an open overlay (the View menu dropdown, the shortcuts dialog itself).
//
// The key presses are real (trusted) key events: the defect was the
// document-level handler firing in addition to the control's own handling of
// the very same press.
const SKETCH = [
    'search synth',
    '',
    'pattern(type: spiral)',
    '  .write(o0)',
    '',
    'render(o0)',
].join('\n')
const PAGE_URL = `/?dsl=${encodeURIComponent(SKETCH)}`

async function waitForApp(page) {
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true, null, { timeout: 30000 })
}

/** Count the taps the scheduler actually registers, from a clean 120 BPM. */
async function startTapCounting(page) {
    await page.evaluate(() => {
        const sch = document.getElementById('tempo-bar').scheduler
        sch.bpm = 120
        window.__taps = 0
        sch.onTap(() => { window.__taps++ })
    })
}

const taps = page => page.evaluate(() => window.__taps)
const bpm = page => page.evaluate(() => document.getElementById('tempo-bar').scheduler.bpm)

// Open the effect panel with a real click on the effect's name in the editor
// (same path as effect-panel.spec.js), then focus the pattern-type
// select-dropdown trigger without opening its popup.
async function focusPatternTypeTrigger(page) {
    const at = await page.evaluate(() => {
        const display = document.querySelector('#dsl-editor .code-editor-display')
        const el = [...display.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent === 'pattern')
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    expect(at, 'pattern is not shown in the editor').not.toBeNull()
    await page.mouse.click(at.x, at.y)
    await expect(page.locator('#effect-controls-panel')).toBeVisible()

    const handle = await page.evaluateHandle(() => {
        const sel = [...document.querySelectorAll('#effect-controls-panel select-dropdown')]
            .find(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'pattern type')
        return sel?.querySelector('button.select-trigger')
    })
    const el = handle.asElement()
    expect(el, 'no pattern-type select trigger in the panel').not.toBeNull()
    await el.focus()
    await page.waitForFunction(() =>
        document.activeElement?.classList.contains('select-trigger'))
    return el
}

test('with a select-dropdown trigger focused, T does not tap tempo while type-ahead still selects', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)
    await startTapCounting(page)

    const trigger = await focusPatternTypeTrigger(page)
    const before = await page.evaluate(() =>
        [...document.querySelectorAll('#effect-controls-panel select-dropdown')]
            .find(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'pattern type')
            .value)

    // Two real presses: type-ahead must move the value to a t-choice, and the
    // tempo state must stay untouched.
    await page.keyboard.press('t')
    await page.waitForFunction((before) => {
        const sel = [...document.querySelectorAll('#effect-controls-panel select-dropdown')]
            .find(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent?.trim() === 'pattern type')
        return sel && sel.value !== before
    }, before, { timeout: 5000 })
    await page.keyboard.press('t')

    expect(await taps(page)).toBe(0)
    expect(await bpm(page)).toBe(120)
    // Selection handling itself still works: the value moved off the booted
    // spiral choice to a t-choice (asserted by the waitForFunction above).
})

test('with the View menu open, T does not tap and ? does not open the shortcuts dialog', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)
    await startTapCounting(page)

    // Open the View menu with a real click on its trigger.
    const at = await page.evaluate(() => {
        const el = [...document.querySelectorAll('#menu button.hf-menubar-trigger')]
            .find(b => b.textContent?.trim() === 'view')
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    expect(at, 'no View menu trigger').not.toBeNull()
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction(() =>
        document.querySelector('#menu [aria-expanded="true"]') !== null, null, { timeout: 5000 })

    await page.keyboard.press('t')
    await page.keyboard.press('t')
    expect(await taps(page)).toBe(0)
    expect(await bpm(page)).toBe(120)

    await page.keyboard.press('?')
    await page.waitForTimeout(300)
    await expect(page.locator('.shortcuts-overlay')).toHaveCount(0)
    // The menu is still the open surface.
    expect(await page.locator('#menu [aria-expanded="true"]').count()).toBe(1)
})

test('with the shortcuts dialog open, a bare digit does not replace the editor program', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)

    // Save the booted program to slot 3, then type a marker into the editor
    // through the real keyboard so a later recall is observable.
    await page.keyboard.press('Control+Shift+Digit3')
    await expect(page.locator('.polymorphic-toast')).toContainText('Saved scene 3', { timeout: 5000 })

    await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
    })
    await page.keyboard.type(' // mk3')
    await page.waitForFunction(() =>
        document.getElementById('dsl-editor').getTextarea().value.includes(' // mk3'), null, { timeout: 10000 })

    // Blur the editor, open the shortcuts dialog with ?, then press a bare 3.
    await page.evaluate(() => document.activeElement?.blur?.())
    await page.keyboard.press('?')
    await expect(page.locator('.shortcuts-overlay')).toHaveCount(1)

    await page.keyboard.press('3')
    await page.waitForTimeout(300)

    // The program is untouched and no scene was loaded; the dialog stays open.
    const value = await page.evaluate(() => document.getElementById('dsl-editor').getTextarea().value)
    expect(value).toContain(' // mk3')
    const toastText = await page.evaluate(() =>
        [...document.querySelectorAll('.polymorphic-toast')].map(t => t.textContent).join(' | '))
    expect(toastText).not.toContain('Loaded scene 3')
    await expect(page.locator('.shortcuts-overlay')).toHaveCount(1)
})

test('genuine typing in the code editor still suppresses T, bare digits and ?', async ({ page }) => {
    await page.goto(PAGE_URL)
    await waitForApp(page)
    await startTapCounting(page)

    // Focus the editor's textarea like a user who is about to type.
    await page.evaluate(() => {
        const ta = document.getElementById('dsl-editor').getTextarea()
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
    })

    await page.keyboard.press('t')
    expect(await taps(page)).toBe(0)

    await page.keyboard.press('?')
    await page.waitForTimeout(300)
    await expect(page.locator('.shortcuts-overlay')).toHaveCount(0)

    // A digit typed into the editor must go into the program text, not recall
    // a scene (no "Loaded scene" toast on the empty-slot path either).
    await page.keyboard.press('3')
    await page.waitForTimeout(300)
    const value = await page.evaluate(() => document.getElementById('dsl-editor').getTextarea().value)
    expect(value.includes('3')).toBe(true)
    await expect(page.locator('.polymorphic-toast')).toHaveCount(0)
})
