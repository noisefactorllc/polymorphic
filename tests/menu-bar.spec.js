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

// Fixed light boot program passed to every test via the documented ?dsl=
// scheme. A fresh visit boots a random gallery example whose compile time
// under software GL varies from ~1s to tens of seconds, which turned several
// tests in this spec into load-dependent 60s timeouts. This program must stay
// light AND different from the clipboard test's copied value so its reset
// assertion remains meaningful.
const BOOT_DSL = 'search synth, filter\n\nperlin(scale: 75, octaves: 2)\n  .write(o0)\n\nrender(o0)'

async function boot(page, { dsl } = {}) {
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
    // An explicit dsl boots via the documented ?dsl= scheme for deterministic
    // boot cost; the default keeps the random gallery example.
    await page.goto(dsl ? `/?dsl=${encodeURIComponent(dsl)}` : '/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })
    // Boot is done when the render loop is running (same observable signal
    // context-loss.spec uses) — not a fixed sleep.
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true, { timeout: 30000 })
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
    await boot(page, { dsl: BOOT_DSL })
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

    // Tooltips on toolbar buttons reflect accelerators and clarified names
    const inputsTitle = await page.locator('#inputs-toggle-btn').getAttribute('data-title')
    expect(inputsTitle).toMatch(/live inputs \((⌘I|Ctrl\+I)\)/)
    expect(await page.locator('#inputs-toggle-btn').getAttribute('aria-label')).toBe('Toggle live inputs')
    const perfTitle = await page.locator('#perf-toggle-btn').getAttribute('data-title')
    expect(perfTitle).toBe('performance overlay')
    expect(await page.locator('#perf-toggle-btn').getAttribute('aria-label')).toBe('Toggle performance overlay')

    // View menu items declare their keyboard accelerators
    const shortcuts = await page.evaluate(() => {
        const getSc = id => document.getElementById(id)?.querySelector('.hf-menu-shortcut')?.textContent?.trim() ?? null
        return {
            liveInputs: getSc('viewMenuItem-live-inputs'),
            status: getSc('viewMenuItem-status'),
            shortcuts: getSc('viewMenuItem-shortcuts'),
            perfMode: getSc('viewMenuItem-performance-mode')
        }
    })
    expect(shortcuts.liveInputs).toMatch(/^(⌘I|Ctrl\+I)$/)
    expect(shortcuts.status).toMatch(/^(⌘;|Ctrl\+;)$/)
    expect(shortcuts.shortcuts).toBe('?')
    expect(shortcuts.perfMode).toMatch(/^(⇧⌘H|Ctrl\+Shift\+H)$/)
})

test('dialog and overlay items open their targets; downloads fire', async ({ page }) => {
    await boot(page, { dsl: BOOT_DSL })
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
    await boot(page, { dsl: BOOT_DSL })
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
    await boot(page, { dsl: BOOT_DSL })
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
    await boot(page, { dsl: BOOT_DSL })
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
    // wait for observable app state (editor value restored) instead of a fixed sleep
    await expect.poll(() => page.evaluate(() => document.getElementById('dsl-editor').value), { timeout: 10000 })
        .toBe('osc(3).write(o0)')

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

    // reset to original restores the boot program exactly
    await page.evaluate(() => document.getElementById('resetMenuItem').click())
    // wait for observable app state (editor value restored) instead of a fixed sleep
    await expect.poll(() => page.evaluate(() => document.getElementById('dsl-editor').value), { timeout: 10000 })
        .toBe(BOOT_DSL)
})

test('icon toolbar: play/pause, code editor, perf, record; palette delegation; performance mode + Escape', async ({ page }) => {
    await boot(page, { dsl: BOOT_DSL })
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

    // perf overlay button active pull and visual styling (Handfish toolbar button guidelines)
    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect(page.locator('#perf-toggle-btn')).toHaveClass(/active/)
    const activeBtnStyle = await page.locator('#perf-toggle-btn').evaluate(el => {
        const cs = window.getComputedStyle(el)
        return {
            paddingTop: cs.paddingTop,
            paddingRight: cs.paddingRight,
            borderRadius: cs.borderRadius,
            width: cs.width,
            height: cs.height,
        }
    })
    expect(activeBtnStyle.paddingTop).toBe('4px')
    expect(activeBtnStyle.paddingRight).toBe('4px')
    expect(activeBtnStyle.borderRadius).toBe('6px')
    expect(activeBtnStyle.width).toBe('28px')
    expect(activeBtnStyle.height).toBe('28px')

    // The active pull's background comes from color-mix(..., transparent), which
    // headless Chromium serializes as oklab(...) or color(...) depending on
    // where the 0.15s background transition stands when it is sampled, so the
    // background cannot be asserted as an exact rgba string. Resolve the
    // computed color's alpha channel on a canvas instead: the active toggle
    // must show a visible tint, and after toggling off the background must be
    // fully transparent again.
    const backgroundAlpha = (locator) => locator.evaluate(el => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = window.getComputedStyle(el).backgroundColor
        ctx.fillRect(0, 0, 1, 1)
        return ctx.getImageData(0, 0, 1, 1).data[3]
    })
    await expect.poll(() => backgroundAlpha(page.locator('#perf-toggle-btn'))).toBeGreaterThan(0)

    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect.poll(() => backgroundAlpha(page.locator('#perf-toggle-btn'))).toBe(0)

    // The same alpha cycle must hold in the light theme (Handfish tokens
    // re-resolve under [data-theme="light"]; the tint color differs, the
    // transparency contract does not). Restore the default theme afterwards.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect(page.locator('#perf-toggle-btn')).toHaveClass(/active/)
    await expect.poll(() => backgroundAlpha(page.locator('#perf-toggle-btn'))).toBeGreaterThan(0)
    await page.evaluate(() => document.getElementById('perf-toggle-btn').click())
    await expect.poll(() => backgroundAlpha(page.locator('#perf-toggle-btn'))).toBe(0)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

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
    const dl = page.waitForEvent('download', { timeout: 30000 })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
    await expect(page.locator('.cmd-palette-overlay')).toHaveClass(/visible/)
    await expect(page.locator('.cmd-palette-input')).toBeFocused()
    await page.keyboard.type('save as png')
    // The palette filters asynchronously (action search is scored per
    // keystroke and the manifest loads off the CDN), so poll for the matched
    // action row instead of a fixed sleep; Enter then runs it.
    await expect(page.locator('.cmd-palette-item.active')).toHaveText(/Save canvas as PNG/)
    // The palette's Enter-invoked download is emitted 0.6-0.8s after Enter in
    // this headless build and intermittently seconds later under renderer
    // load (measured up to 16.4s with a 25s listener; direct menu-item clicks
    // always emit in ~100ms), so the wait is generous; the listener above is
    // registered before Ctrl+K per Playwright's race guidance.
    await page.keyboard.press('Enter')
    const download = await dl
    expect(download.suggestedFilename()).toBe('polymorphic.png')
    await download.cancel()

    // performance mode hides the whole bar; Escape restores it
    await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
    await expect(page.locator('#menu .hf-menubar')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('#menu .hf-menubar')).toBeVisible()

    // Mod+I toggles live inputs panel and updates toolbar active state
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modKey}+i`)
    await expect(page.locator('.live-inputs-panel')).toHaveClass(/visible/)
    await expect(page.locator('#inputs-toggle-btn')).toHaveClass(/active/)
    await page.keyboard.press(`${modKey}+i`)
    await expect(page.locator('.live-inputs-panel')).not.toHaveClass(/visible/)
    await expect(page.locator('#inputs-toggle-btn')).not.toHaveClass(/active/)
})

test('theme switching preserves contrast across menu dropdowns and modals', async ({ page }) => {
    await boot(page, { dsl: BOOT_DSL })

    const viewTrigger = page.locator('#viewMenuTitle')
    const dropdownPanel = page.locator('#viewMenuTitle ~ .hf-menubar-panel')
    const firstItem = dropdownPanel.locator('.hf-menu-item').first()

    // Contrast the way the user sees it, measured against the RENDERED
    // backdrop. The menu panel and shortcuts overlay are translucent
    // (color-mix(..., transparent) surfaces) with backdrop-filter blur over a
    // full-viewport animated WebGL canvas, so computed-style background
    // chains cannot represent what is actually painted. For each measured
    // element: its own and its descendants' glyph colors are hidden inline,
    // the element is screenshot-sampled, and the modal color of its rendered
    // pixels is the backdrop a user sees beneath the text. The foreground is
    // the element's computed color (canvas-parsed to sRGB), alpha-composited
    // over that backdrop before the WCAG ratio is computed.
    const textColorOf = (locator) => locator.evaluate(el => {
        const c = document.createElement('canvas')
        c.width = c.height = 1
        const g = c.getContext('2d', { willReadFrequently: true })
        // sRGB [r,g,b,a] of the computed color; the canvas readback resolves
        // oklch()/color()/color-mix(...) exactly as painted.
        g.clearRect(0, 0, 1, 1)
        g.fillStyle = window.getComputedStyle(el).color
        g.fillRect(0, 0, 1, 1)
        return [...g.getImageData(0, 0, 1, 1).data]
    })

    const backdropColorOf = async (locator) => {
        // Checked items paint a ✓ glyph from a stylesheet rule, which inline
        // styles cannot reach; the appended rule outranks it (same
        // specificity, later in the cascade).
        const glyphNeutralizer = await page.addStyleTag({
            content: '#menu .hf-menubar-panel .view-item::before { color: transparent }',
        })
        try {
            await locator.evaluate(el => {
                for (const node of [el, ...el.querySelectorAll('*')]) {
                    node.dataset.contrastSavedColor = node.style.color
                    node.style.color = 'transparent'
                }
            })
            const shot = await locator.screenshot({ animations: 'disabled' })
            return await page.evaluate(async (png) => {
                const img = new Image()
                await new Promise((resolve, reject) => {
                    img.onload = resolve
                    img.onerror = reject
                    img.src = `data:image/png;base64,${png}`
                })
                const c = document.createElement('canvas')
                c.width = img.width
                c.height = img.height
                const g = c.getContext('2d', { willReadFrequently: true })
                g.drawImage(img, 0, 0)
                const px = g.getImageData(0, 0, img.width, img.height).data
                // Modal (channel-quantized) color of the rendered pixels: the
                // translucent surface over its blurred backdrop is
                // near-uniform across the box, so the mode rejects stray
                // antialiasing and border pixels.
                const counts = new Map()
                for (let i = 0; i < px.length; i += 4) {
                    const key = `${px[i] & ~3},${px[i + 1] & ~3},${px[i + 2] & ~3}`
                    counts.set(key, (counts.get(key) || 0) + 1)
                }
                let bestKey = null
                let bestN = 0
                for (const [k, n] of counts) {
                    if (n > bestN) { bestKey = k; bestN = n }
                }
                // Rendered screenshots are opaque.
                return [...bestKey.split(',').map(Number), 255]
            }, shot.toString('base64'))
        } finally {
            await locator.evaluate(el => {
                for (const node of [el, ...el.querySelectorAll('*')]) {
                    node.style.color = node.dataset.contrastSavedColor
                    delete node.dataset.contrastSavedColor
                }
            })
            await glyphNeutralizer.evaluate(el => el.remove())
        }
    }

    // Straight-alpha composite of the text over the backdrop (premultiplied,
    // normalized), then the WCAG ratio.
    const over = (top, bottom) => {
        const a = top[3] / 255
        const outA = a + (bottom[3] / 255) * (1 - a)
        if (!outA) return [0, 0, 0]
        const mix = (t, b) => Math.round((t * a + b * (bottom[3] / 255) * (1 - a)) / outA)
        return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2])]
    }
    const luminance = ([r, g, b]) => {
        const [lr, lg, lb] = [r, g, b].map(v => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
        })
        return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
    }
    const contrastOf = async (locator) => {
        // Read the text color before any glyph hiding happens.
        const textColor = await textColorOf(locator)
        const backdrop = await backdropColorOf(locator)
        const fg = over(textColor, backdrop)
        const l1 = Math.max(luminance(fg), luminance(backdrop))
        const l2 = Math.min(luminance(fg), luminance(backdrop))
        return (l1 + 0.05) / (l2 + 0.05)
    }

    // Theme tokens and panel entrance animations resolve across animation
    // frames; wait until the computed styles stop changing instead of
    // sleeping a fixed delay.
    const awaitStableStyles = (locator, props) => locator.evaluate(async (el, props) => {
        const read = () => props.map(p => window.getComputedStyle(el)[p]).join('|')
        let prev = read()
        for (let i = 0; i < 120; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve))
            const next = read()
            if (next === prev) return true
            prev = next
        }
        return false
    }, props)

    const sampleStyles = (locator) => locator.evaluate(el => {
        const cs = window.getComputedStyle(el)
        return { background: cs.backgroundColor, color: cs.color }
    })

    // 1. Dark theme: dropdown items stay readable over the translucent panel
    await viewTrigger.click()
    await expect(dropdownPanel).toBeVisible()
    expect(await awaitStableStyles(dropdownPanel, ['opacity', 'backgroundColor'])).toBe(true)
    const darkPanel = await sampleStyles(dropdownPanel)
    const darkItem = await sampleStyles(firstItem)
    const darkPanelShadow = await dropdownPanel.evaluate(el => window.getComputedStyle(el).boxShadow)
    expect(darkPanelShadow).not.toBe('none')
    expect(await contrastOf(firstItem)).toBeGreaterThan(4.5)

    // 2. Light theme. The app exposes no theme toggle UI, so the html
    // attribute is the theme control; the dropdown is closed first and
    // reopened after the change so every surface re-resolves its tokens (a
    // panel left open was seen to keep the stale dark accent). Colors settle
    // on computed styles.
    await page.evaluate(() => document.getElementById('menu').closeAll())
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await viewTrigger.click()
    await expect(dropdownPanel).toBeVisible()
    expect(await awaitStableStyles(dropdownPanel, ['opacity', 'backgroundColor'])).toBe(true)
    const lightPanel = await sampleStyles(dropdownPanel)
    const lightItem = await sampleStyles(firstItem)
    // The reopened panel must re-resolve its tokens: keeping the dark theme's
    // background or accent is exactly the stale-surface regression.
    expect(lightPanel.background).not.toBe(darkPanel.background)
    expect(lightItem.color).not.toBe(darkItem.color)
    expect(await contrastOf(firstItem)).toBeGreaterThan(4.5)

    // 3. Open shortcuts dialog under light theme and verify contrast
    await page.evaluate(() => document.getElementById('viewMenuItem-shortcuts').click())
    const shortcutsModal = page.locator('.shortcuts-modal')
    await expect(shortcutsModal).toBeVisible()
    // The overlay fades in behind the modal; both must settle before the
    // backdrop pixels are sampled.
    expect(await awaitStableStyles(shortcutsModal, ['opacity', 'backgroundColor'])).toBe(true)
    expect(await awaitStableStyles(page.locator('.shortcuts-overlay'), ['opacity'])).toBe(true)
    expect(await contrastOf(shortcutsModal.locator('.shortcuts-title'))).toBeGreaterThan(4.5)
    expect(await contrastOf(shortcutsModal.locator('.shortcut-desc').first())).toBeGreaterThan(4.5)
    expect(await contrastOf(shortcutsModal.locator('kbd').first())).toBeGreaterThan(4.5)

    // Close dialog
    await page.locator('.shortcuts-close').click()
    await expect(shortcutsModal).toBeHidden()
})
