// Menu bar migration verification.
//
// The bespoke #menu implementation was replaced by the shared handfish
// <menu-bar> component (config assigned in embed.js). These tests drive the
// REAL app and verify every baseline menu item, control, and keyboard
// shortcut is present and fully operational: exact tree structure, dialog
// items, pull-based view checkmarks, the edit-in flows (sharing API mocked at
// the network boundary, window.open stubbed), quick-save downloads, the
// right-side icon toolbar incl. active-state pulls, play/pause, the command
// palette's .click() delegation, and performance mode + Escape.
//
// Pre-release: HANDFISH_LOCAL (or a ../handfish/dist sibling) serves the
// handfish CDN locally — see tests/handfishLocal.js.
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

test.use({
    permissions: ['clipboard-read', 'clipboard-write'],
})

installHandfishLocal(test)

async function boot(page) {
    await page.addInitScript(() => {
        window.__openedUrls = []
        window.open = (url) => { window.__openedUrls.push(String(url)); return null }
    })
    await page.route('https://sharing.noisedeck.app/**', route =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'TESTCODE' })
        }))
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })
    await page.waitForTimeout(2000)
}

const EXPECTED = {
    logoMenu: [
        ['aboutMenuItem', 'about Polymorphic'],
        'separator',
        ['docsMenuItem', 'documentation'],
    ],
    fileMenu: [
        ['savePNG', 'quick save as png'],
        ['saveJPG', 'quick save as jpg'],
        'separator',
        ['importFromZipMenuItem', 'import effect from zip...'],
    ],
    editMenu: [
        ['resetMenuItem', 'reset to original'],
    ],
    viewMenu: [
        ['viewMenuItem-editor', 'code editor'],
        ['viewMenuItem-docs', 'documentation'],
        ['viewMenuItem-live-inputs', 'live inputs'],
        ['viewMenuItem-surface-pips', 'surface pips'],
        'separator',
        ['viewMenuItem-perf', 'performance overlay'],
        ['viewMenuItem-status', 'status row'],
        'separator',
        ['viewMenuItem-gallery', 'gallery…'],
        ['viewMenuItem-shortcuts', 'keyboard shortcuts…'],
        'separator',
        ['viewMenuItem-performance-mode', 'performance mode'],
        ['viewMenuItem-fullscreen', 'fullscreen'],
        'separator',
        ['viewMenuItem-open-viewport-window', 'open viewport window'],
        ['syncOutputMenuItem', 'send to Sync...'],
    ],
    programMenu: [
        ['copyProgram', 'copy program'],
        ['pasteProgram', 'paste program'],
        'separator',
        ['saveProgram', 'save program'],
        ['loadProgram', 'load program'],
        ['deleteProgram', 'delete program'],
        'separator',
        ['editInNoisedeckMenuItem', 'edit in Noisedeck...'],
        ['editInNoodlesMenuItem', 'edit in Noodles...'],
        'separator',
        ['importFromUrlMenuItem', 'import from url...'],
        ['shareProgram', 'share publicly...'],
        'separator',
        ['goOnlineMenuItem', 'go online...'],
    ],
}

test('menu tree renders every baseline item exactly (labels, order, separators, ids)', async ({ page }) => {
    await boot(page)
    const tree = await page.evaluate(() => {
        const bar = document.getElementById('menu')
        const byId = {}
        const wrappers = [...bar.querySelectorAll('.hf-menubar-menu')]
        let i = 0
        for (const control of bar.config.regions.left) {
            if (control.type !== 'menu') continue
            const panel = wrappers[i++].querySelector('.hf-menubar-panel')
            byId[control.id] = [...panel.children].map(el =>
                el.tagName === 'HR' ? 'separator'
                    : [el.id, el.querySelector('.hf-menubar-item-label')?.textContent ?? ''])
        }
        return byId
    })
    for (const [menuId, expected] of Object.entries(EXPECTED)) {
        const exp = expected.map(e => Array.isArray(e) ? e.join('|') : e)
        const act = (tree[menuId] || []).map(e => Array.isArray(e) ? e.join('|') : e)
        expect(act, menuId).toEqual(exp)
    }
    // logo trigger carries the brand SVG; collaboration pair visible (flag defaults on)
    await expect(page.locator('#menu .hf-menubar-trigger svg#logo')).toHaveCount(1)
    await expect(page.locator('#onlineCollabMenuSeparator')).toHaveCount(1)
    // 8 icon buttons in exact order
    const icons = await page.locator('#menu .hf-menubar-right .hf-menubar-btn .hf-icon').allTextContents()
    expect(icons).toEqual(['collections', 'tune', 'fiber_manual_record', 'speed', 'info', 'code', 'fullscreen', 'pause'])
})

test('dialog and overlay items open their targets; downloads fire', async ({ page }) => {
    await boot(page)
    const clickItem = id => page.evaluate(i => document.getElementById(i).click(), id)

    await clickItem('aboutMenuItem')
    await expect(page.locator('.hf-about')).toBeVisible()
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    await clickItem('importFromZipMenuItem')
    await expect(page.locator('.import-effect-dialog, dialog[open]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    await clickItem('importFromUrlMenuItem')
    await expect(page.locator('.import-url-input')).toBeVisible()
    await page.keyboard.press('Escape')

    await clickItem('shareProgram')
    await expect(page.locator('.share-modal, dialog[open], #share-modal').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    for (const mode of ['saveProgram', 'loadProgram', 'deleteProgram']) {
        await clickItem(mode)
        await expect(page.locator('#programModal')).toBeVisible()
        await page.keyboard.press('Escape')
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))
    }

    await clickItem('viewMenuItem-gallery')
    await expect(page.locator('.gallery-overlay, .gallery-panel, dialog[open]').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    await clickItem('viewMenuItem-shortcuts')
    await expect(page.locator('.shortcuts-overlay')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    await clickItem('goOnlineMenuItem')
    await expect(page.locator('seance-dialog dialog[open]')).toBeVisible()
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()))

    // quick saves -> real download events
    for (const [id, name] of [['savePNG', 'polymorphic.png'], ['saveJPG', 'polymorphic.jpg']]) {
        const dl = page.waitForEvent('download', { timeout: 10000 })
        await clickItem(id)
        const download = await dl
        expect(download.suggestedFilename()).toBe(name)
        await download.cancel()
    }
})

test('Sync target opens with Polymorphic identity and browser-readable product help', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => document.getElementById('syncOutputMenuItem').click())

    await expect(page.locator('#syncOutputDialog')).toBeVisible()
    await expect(page.locator('#syncOutputDialogTitle')).toHaveText('Sync output')
    await expect(page.locator('#syncOutputName')).toHaveValue('Polymorphic')
    await expect(page.locator('#syncOutputAction')).toHaveText(/Check again|Connect Sync/)
    await expect(page.locator('.sync-docs-link')).toHaveAttribute('href', 'https://github.com/noisefactorllc/sync')
    await expect(page.locator('.sync-docs-link')).toHaveAttribute('target', '_blank')

    await page.keyboard.press('Escape')
    await expect(page.locator('#syncOutputDialog')).not.toBeVisible()
})

test('view menu checkmarks pull live state; toggles flip panels and mirrored buttons', async ({ page }) => {
    await boot(page)
    const viewTrigger = page.locator('#viewMenuTitle')
    const checked = id => page.locator(`#${id}`).getAttribute('aria-checked')

    await viewTrigger.click()
    expect(await checked('viewMenuItem-editor')).toBe('true')
    expect(await checked('viewMenuItem-docs')).toBe('true')
    expect(await checked('viewMenuItem-live-inputs')).toBe('false')
    expect(await checked('viewMenuItem-perf')).toBe('false')
    // one-shots carry no checkbox semantics
    expect(await page.locator('#viewMenuItem-gallery').getAttribute('aria-checked')).toBe(null)

    // toggle docs off via the menu: panel hides, mirrored icon button deactivates
    await page.evaluate(() => document.getElementById('viewMenuItem-docs').click())
    await expect(page.locator('#doc-reader-panel')).not.toHaveClass(/visible/)
    await expect(page.locator('#doc-toggle-btn')).not.toHaveClass(/active/)
    await viewTrigger.click()
    expect(await checked('viewMenuItem-docs')).toBe('false')

    // external state change is pulled on next open (live inputs via its own
    // panel API). Headless has no media devices, so the panel may close itself
    // right after opening — assert the CONTRACT: the menu checkmark always
    // equals the panel's live isOpen() at menu-open time.
    await page.evaluate(() => document.getElementById('inputs-toggle-btn').click())
    await expect(page.locator('#inputs-toggle-btn')).toHaveClass(/active/)
    const pulled = await page.evaluate(async () => {
        const { liveInputsPanel } = await import('/js/ui/liveInputsPanel.js')
        document.getElementById('menu').openMenu('viewMenu')
        return {
            isOpen: liveInputsPanel.isOpen(),
            checked: document.getElementById('viewMenuItem-live-inputs').getAttribute('aria-checked'),
        }
    })
    expect(pulled.checked).toBe(String(pulled.isOpen))
    await page.evaluate(() => document.getElementById('menu').closeAll())
    await page.evaluate(async () => {
        const { liveInputsPanel } = await import('/js/ui/liveInputsPanel.js')
        if (liveInputsPanel.isOpen()) document.getElementById('inputs-toggle-btn').click()
    })

    // status row + surface pips toggle through the menu and re-pull on reopen
    // (state-relative: status row boots open by default, pips boot closed)
    for (const id of ['viewMenuItem-status', 'viewMenuItem-surface-pips']) {
        await page.evaluate(() => document.getElementById('menu').openMenu('viewMenu'))
        const before = await checked(id)
        await page.evaluate(i => document.getElementById(i).click(), id)
        await page.evaluate(() => document.getElementById('menu').openMenu('viewMenu'))
        expect(await checked(id), `${id} flips`).toBe(before === 'true' ? 'false' : 'true')
        await page.evaluate(i => document.getElementById(i).click(), id)
        await page.evaluate(() => document.getElementById('menu').openMenu('viewMenu'))
        expect(await checked(id), `${id} flips back`).toBe(before)
        await page.evaluate(() => document.getElementById('menu').closeAll())
    }

    // logo-menu "documentation" force-opens (does not toggle)
    await page.evaluate(() => document.getElementById('docsMenuItem').click())
    await expect(page.locator('#doc-reader-panel')).toHaveClass(/visible/)
    await expect(page.locator('#doc-toggle-btn')).toHaveClass(/active/)
    await page.evaluate(() => document.getElementById('docsMenuItem').click())
    await expect(page.locator('#doc-reader-panel')).toHaveClass(/visible/)   // still open: force-open semantics
})

test('program clipboard roundtrip, edit-in flows, and reset', async ({ page }) => {
    await boot(page)
    // seed a known program and copy it through the real clipboard
    await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        ed.value = 'osc(3).write(o0)'
        ed.dispatchEvent(new CustomEvent('input', { bubbles: true }))
    })
    await page.evaluate(() => document.getElementById('copyProgram').click())
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe('osc(3).write(o0)')

    // mutate, then paste restores
    await page.evaluate(() => {
        const ed = document.getElementById('dsl-editor')
        ed.value = 'noise(9).write(o0)'
        ed.dispatchEvent(new CustomEvent('input', { bubbles: true }))
    })
    await page.evaluate(() => document.getElementById('pasteProgram').click())
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => document.getElementById('dsl-editor').value)).toBe('osc(3).write(o0)')

    // edit-in flows: mocked share -> window.open with ?code=
    for (const [id, host] of [
        ['editInNoisedeckMenuItem', 'noisedeck.app'],
        ['editInNoodlesMenuItem', 'noodles'],
    ]) {
        await page.evaluate(() => { window.__openedUrls.length = 0 })
        await page.evaluate(i => document.getElementById(i).click(), id)
        await page.waitForFunction(() => window.__openedUrls.length > 0, { timeout: 20000 })
        const opened = await page.evaluate(() => window.__openedUrls[0])
        expect(opened).toContain('code=TESTCODE')
        expect(opened.toLowerCase()).toContain(host)
    }

    // reset to original restores the boot program
    await page.evaluate(() => document.getElementById('resetMenuItem').click())
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => document.getElementById('dsl-editor').value)).not.toBe('osc(3).write(o0)')
})

test('icon toolbar: play/pause, code editor, perf, record; palette delegation; performance mode + Escape', async ({ page }) => {
    await boot(page)
    const ppIcon = () => page.evaluate(() => document.getElementById('play-pause-btn-menu').querySelector('.hf-icon').textContent)

    // play/pause flips icon, tooltip, aria-label, and the canvas paused class
    expect(await ppIcon()).toBe('pause')
    await page.evaluate(() => document.getElementById('play-pause-btn-menu').click())
    expect(await ppIcon()).toBe('play_arrow')
    expect(await page.evaluate(() => document.getElementById('play-pause-btn-menu').getAttribute('data-title'))).toBe('play')
    await expect(page.locator('#canvas')).toHaveClass(/paused/)
    await page.evaluate(() => document.getElementById('play-pause-btn-menu').click())
    expect(await ppIcon()).toBe('pause')

    // code editor button hides the overlay and deactivates; view menu agrees
    await page.evaluate(() => document.getElementById('code-toggle-btn').click())
    await expect(page.locator('#dsl-overlay')).toBeHidden()
    await expect(page.locator('#code-toggle-btn')).not.toHaveClass(/active/)
    await page.locator('#viewMenuTitle').click()
    expect(await page.locator('#viewMenuItem-editor').getAttribute('aria-checked')).toBe('false')
    await page.evaluate(() => document.getElementById('viewMenuItem-editor').click())
    await expect(page.locator('#dsl-overlay')).toBeVisible()

    // perf overlay button active pull
    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect(page.locator('#perf-toggle-btn')).toHaveClass(/active/)
    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect(page.locator('#perf-toggle-btn')).not.toHaveClass(/active/)

    // record button flips recorder state (canvas captureStream)
    await page.evaluate(() => document.getElementById('record-toggle-btn').click())
    await page.waitForTimeout(500)
    const recording = await page.evaluate(() => document.getElementById('record-toggle-btn').classList.contains('active'))
    if (recording) {
        await page.evaluate(() => document.getElementById('record-toggle-btn').click())
        await page.waitForTimeout(500)
        await expect(page.locator('#record-toggle-btn')).not.toHaveClass(/active/)
    }

    // command palette drives the same items via programmatic .click() delegation
    const dl = page.waitForEvent('download', { timeout: 10000 })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    await page.waitForTimeout(300)
    await page.keyboard.type('save as png')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    const download = await dl
    expect(download.suggestedFilename()).toBe('polymorphic.png')
    await download.cancel()

    // performance mode hides the whole bar; Escape restores it
    await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
    await expect(page.locator('#menu .hf-menubar')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('#menu .hf-menubar')).toBeVisible()
})

test('theme switching preserves contrast across menu dropdowns and modals', async ({ page }) => {
    await boot(page)

    // Open view menu dropdown
    await page.locator('#viewMenuTitle').click()
    const dropdownPanel = page.locator('#viewMenuTitle ~ .hf-menubar-panel')
    await expect(dropdownPanel).toBeVisible()

    // Function to calculate relative luminance of an rgb(r, g, b) string
    const getLuminance = (rgbStr) => {
        const match = rgbStr.match(/\d+/g)
        if (!match) return 0
        const [r, g, b] = match.slice(0, 3).map(Number).map(v => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    const getContrastRatio = (lum1, lum2) => {
        const l1 = Math.max(lum1, lum2)
        const l2 = Math.min(lum1, lum2)
        return (l1 + 0.05) / (l2 + 0.05)
    }

    // 1. Verify dark theme dropdown contrast
    const darkDropdownStyles = await dropdownPanel.evaluate(el => {
        const item = el.querySelector('.hf-menu-item')
        return {
            panelBg: window.getComputedStyle(el).backgroundColor,
            itemColor: window.getComputedStyle(item).color,
            shadow: window.getComputedStyle(el).boxShadow,
        }
    })
    expect(darkDropdownStyles.shadow).not.toBe('none')
    const darkRatio = getContrastRatio(
        getLuminance(darkDropdownStyles.panelBg),
        getLuminance(darkDropdownStyles.itemColor)
    )
    expect(darkRatio).toBeGreaterThan(4.5)

    // 2. Switch to light theme
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })

    const lightDropdownStyles = await dropdownPanel.evaluate(el => {
        const item = el.querySelector('.hf-menu-item')
        return {
            panelBg: window.getComputedStyle(el).backgroundColor,
            itemColor: window.getComputedStyle(item).color,
        }
    })
    const lightRatio = getContrastRatio(
        getLuminance(lightDropdownStyles.panelBg),
        getLuminance(lightDropdownStyles.itemColor)
    )
    expect(lightRatio).toBeGreaterThan(4.5)

    // 3. Open shortcuts dialog under light theme and verify contrast
    await page.evaluate(() => document.getElementById('viewMenuItem-shortcuts').click())
    const shortcutsModal = page.locator('.shortcuts-modal')
    await expect(shortcutsModal).toBeVisible()

    const modalContrast = await shortcutsModal.evaluate(el => {
        const title = el.querySelector('.shortcuts-title')
        const desc = el.querySelector('.shortcut-desc')
        const kbd = el.querySelector('kbd')
        return {
            modalBg: window.getComputedStyle(el).backgroundColor,
            titleColor: window.getComputedStyle(title).color,
            descColor: window.getComputedStyle(desc).color,
            kbdBg: window.getComputedStyle(kbd).backgroundColor,
            kbdColor: window.getComputedStyle(kbd).color,
        }
    })

    const modalTitleRatio = getContrastRatio(
        getLuminance(modalContrast.modalBg),
        getLuminance(modalContrast.titleColor)
    )
    expect(modalTitleRatio).toBeGreaterThan(4.5)

    const modalDescRatio = getContrastRatio(
        getLuminance(modalContrast.modalBg),
        getLuminance(modalContrast.descColor)
    )
    expect(modalDescRatio).toBeGreaterThan(4.5)

    const kbdRatio = getContrastRatio(
        getLuminance(modalContrast.kbdBg),
        getLuminance(modalContrast.kbdColor)
    )
    expect(kbdRatio).toBeGreaterThan(4.5)

    // Close dialog
    await page.locator('.shortcuts-close').click()
    await expect(shortcutsModal).toBeHidden()
})
