// SPDX-License-Identifier: MIT
//
// Handfish token/theme sweep for the surfaces GAP-009 hardened: the boot
// chrome (body, loading, spinner, error), the shared toast, the copy-feedback
// checkmark class, and the viewport popup mirror page.
//
// GAP-010 adds an accessibility-name case: the effect parameter panel and the
// live-inputs device selectors must announce their visible label.
//
// A hard-coded color yields the same computed value in every theme, so the
// core property under test is: every audited surface's computed colors come
// from resolved --hf-* tokens (oklch()/color() serializations, not the
// removed rgb/rgba literals) AND flip when data-theme switches dark↔light.
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// tokens.css must be loaded and resolving before any read: the dark default
// is oklch-serialized, while the var() fallbacks would show as rgb()/rgba().
async function waitForShell(page) {
    await page.waitForFunction(() => {
        const el = document.getElementById('loading')
        return !!el && getComputedStyle(el).color.includes('oklch')
    }, null, { timeout: 30000 })
}

// Wait for a compiled, running program before touching the parameter panel:
// the panel is fed from the engine's effect definitions for the live program.
async function bootSettled(page, dsl) {
    await page.goto(`/?dsl=${encodeURIComponent(dsl)}`)
    await page.waitForFunction(
        () =>
            document.getElementById('canvas')?.classList.contains('visible') &&
            window.__poly?.renderer?.isRunning === true,
        null,
        { timeout: 45000 }
    )
}

/**
 * Read an element's own accessibility node (role + name) through CDP, the way
 * assistive technology sees it. nodes[0] of getPartialAXTree is the requested
 * element; the rest is its subtree and ancestors.
 */
async function axNode(cdp, expression) {
    const { result } = await cdp.send('Runtime.evaluate', { expression })
    expect(result.objectId, `${expression} must resolve to an element`).toBeTruthy()
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId })
    return nodes[0]
}

test('parameter and device controls announce accessible names', async ({ page }) => {
    const BOOT_DSL = 'search synth, filter\n\nperlin(scale: 75, octaves: 2)\n  .write(o0)\n\nrender(o0)'
    await bootSettled(page, BOOT_DSL)

    // Open the perlin parameter panel on its call site, the way a click on
    // the effect name does.
    await page.evaluate((dsl) => {
        document.getElementById('dsl-editor').dispatchEvent(
            new CustomEvent('effectclick', { detail: { caretOffset: dsl.indexOf('perlin') + 3, dsl } })
        )
    }, BOOT_DSL)
    await page.waitForSelector('#effect-controls-panel:not([hidden])', { timeout: 15000 })

    const cdp = await page.context().newCDPSession(page)

    // Tag every focusable widget inside the panel, each with the visible
    // label of the parameter group it belongs to (null for panel chrome).
    const widgets = await page.evaluate(() => {
        const panel = document.getElementById('effect-controls-panel')
        const els = [
            ...panel.querySelectorAll('input, button, select, textarea, [contenteditable="true"], [tabindex]'),
        ].filter(el => el.getAttribute('tabindex') !== '-1')
        return els.map((el, i) => {
            el.dataset.axProbe = String(i)
            const group = el.closest('.ec-control-group')
            return {
                probe: String(i),
                label: group ? group.querySelector('.ec-control-label')?.textContent.trim() : null,
            }
        })
    })
    expect(widgets.length, 'the panel renders focusable parameter widgets').toBeGreaterThan(5)

    for (const { probe, label } of widgets) {
        const node = await axNode(cdp, `document.querySelector('[data-ax-probe="${probe}"]')`)
        const role = node.role?.value
        if (node.ignored || role === 'none') {
            // ui-gated (inert) or not-yet-shown widget: assistive technology
            // announces nothing for it by design.
            continue
        }
        if (label === null) {
            // Panel chrome (info, close) already carries its own visible text.
            expect(node.name?.value, 'panel chrome must announce a name').toBeTruthy()
            continue
        }
        expect(node.name?.value, `the ${role} widget for "${label}" must announce its visible label, not "${node.name?.value}"`)
            .toBe(label)
    }

    // The live-inputs device selectors: native selects whose visible labels
    // are sibling spans.
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    await page.waitForSelector('.live-inputs-panel.visible', { timeout: 15000 })

    const camera = await axNode(cdp, `document.querySelector('.live-inputs-panel [data-id="camera-device"]')`)
    expect(camera.role?.value).toBe('combobox')
    expect(camera.name?.value, 'the camera device select must announce "camera"').toBe('camera')

    const source = await axNode(cdp, `document.querySelector('.live-inputs-panel [data-id="audio-device"]')`)
    expect(source.role?.value).toBe('combobox')
    expect(source.name?.value, 'the audio device select must announce "source"').toBe('source')
})

test('boot chrome reads Handfish tokens and flips between dark and light themes', async ({ page }) => {
    await page.goto('/')
    await waitForShell(page)

    const readChrome = () => {
        const probe = document.createElement('div')
        probe.className = 'share-copy-check'
        document.body.appendChild(probe)
        const reads = {
            bodyBg: getComputedStyle(document.body).backgroundColor,
            loadingColor: getComputedStyle(document.getElementById('loading')).color,
            spinnerTrack: getComputedStyle(document.querySelector('.spinner')).borderTopColor,
            spinnerAccent: getComputedStyle(document.querySelector('.spinner')).borderBottomColor,
            errorColor: getComputedStyle(document.getElementById('error')).color,
            errorBorder: getComputedStyle(document.getElementById('error')).borderTopColor,
            copyCheck: getComputedStyle(probe).color,
        }
        probe.remove()
        return reads
    }

    const dark = await page.evaluate(readChrome)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const light = await page.evaluate(readChrome)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

    for (const key of Object.keys(dark)) {
        expect(dark[key], `${key} must resolve from --hf-* tokens, not a literal`)
            .toMatch(/oklch|color\(/)
        expect(light[key], `${key} must flip with the theme`)
            .not.toBe(dark[key])
    }
    // The published literals these surfaces used to carry must never return.
    expect(dark.bodyBg).not.toBe('rgb(10, 10, 15)')
    expect(dark.loadingColor).not.toBe('rgb(136, 136, 136)')
    expect(dark.spinnerTrack).not.toBe('rgb(34, 34, 34)')
    expect(dark.spinnerAccent).not.toBe('rgb(102, 126, 234)')
    expect(dark.errorColor).not.toBe('rgb(255, 107, 107)')
})

test('the shared toast resolves token colors and flips with the theme', async ({ page }) => {
    // Deterministically force the WebGPU → WebGL2 fallback toast.
    await page.addInitScript(() => {
        try {
            Object.defineProperty(Navigator.prototype, 'gpu', {
                get: () => undefined,
                configurable: true,
            })
        } catch {
            try {
                Object.defineProperty(navigator, 'gpu', {
                    get: () => undefined,
                    configurable: true,
                })
            } catch {}
        }
    })
    await page.goto('/?backend=webgpu')

    // The toast dismisses itself after ~4s; read it in one evaluation.
    const readToast = () => {
        const t = document.querySelector('.polymorphic-toast')
        if (!t) return null
        return {
            bg: getComputedStyle(t).backgroundColor,
            color: getComputedStyle(t).color,
        }
    }
    const darkToast = await (await page.waitForFunction(() => {
        const t = document.querySelector('.polymorphic-toast')
        return t ? { bg: getComputedStyle(t).backgroundColor, color: getComputedStyle(t).color } : null
    }, null, { timeout: 30000 })).jsonValue()

    expect(darkToast.bg).toMatch(/oklch|color\(/)
    expect(darkToast.bg).not.toMatch(/rgba\(102,\s*126,\s*234/)
    expect(darkToast.bg).not.toBe('rgba(102, 126, 234, 0.95)')

    // Flip the theme, then trigger a second showToast call (a bare digit
    // recalls scene 1; the empty-slot toast takes the same token-based path)
    // and read it under the light theme — the first toast is gone by then.
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await page.keyboard.press('1')
    const lightToast = await (await page.waitForFunction(() => {
        const t = document.querySelector('.polymorphic-toast')
        return t ? { bg: getComputedStyle(t).backgroundColor, color: getComputedStyle(t).color } : null
    }, null, { timeout: 15000 })).jsonValue()
    expect(lightToast.bg).toMatch(/oklch|color\(/)
    // Both toasts come from the same token chain; the theme flipped its value.
    expect(lightToast.bg).not.toBe(darkToast.bg)
    // The text token (--hf-text-bright) flips near-white ↔ near-black.
    expect(lightToast.color).not.toBe(darkToast.color)
})

test('the viewport popup mirror page loads Handfish tokens and flips with the theme', async ({ page }) => {
    await page.goto('/')
    await waitForShell(page)

    // While any route is active, Playwright stalls the subresource requests of
    // a popup written with document.write: the popup stays "loading" and never
    // fetches tokens.css. Drop the local-Handfish route first, so the popup
    // loads the CDN stylesheet its markup names, as it does in a browser.
    await page.unrouteAll({ behavior: 'wait' })

    const popupPromise = page.waitForEvent('popup')
    await page.evaluate(async () => {
        const vw = await import('/js/ui/viewportWindow.js')
        vw.configureViewportWindow({ canvas: document.getElementById('canvas') })
        vw.openViewportWindow()
    })
    const popup = await popupPromise

    // The popup ships no data-theme of its own; pin the dark default first
    // (headless Chromium's prefers-color-scheme is light).
    await popup.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

    // tokens.css must be present and resolving in the popup (oklch body bg),
    // and the hint must sit on token offsets, not hard-coded pixels.
    const dark = await (await popup.waitForFunction(() => {
        const hint = document.querySelector('.hint')
        if (!hint) return null
        const bg = getComputedStyle(document.body).backgroundColor
        if (!bg.includes('oklch')) return null
        return {
            bodyBg: bg,
            hintColor: getComputedStyle(hint).color,
            hintBottom: getComputedStyle(hint).bottom,
            hintRight: getComputedStyle(hint).right,
        }
    }, null, { timeout: 30000 })).jsonValue()

    expect(dark.bodyBg, 'popup body must resolve var(--hf-bg-base)').toMatch(/oklch/)
    expect(dark.bodyBg).not.toBe('rgb(0, 0, 0)')
    expect(dark.hintColor).toMatch(/oklch/)
    expect(dark.hintColor).not.toBe('rgba(255, 255, 255, 0.3)')
    // var(--hf-space-2)=8px and var(--hf-space-3)=12px: token-driven offsets.
    expect(dark.hintBottom).toBe('8px')
    expect(dark.hintRight).toBe('12px')

    await popup.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    const light = await popup.evaluate(() => {
        const hint = document.querySelector('.hint')
        return {
            bodyBg: getComputedStyle(document.body).backgroundColor,
            hintColor: getComputedStyle(hint).color,
        }
    })
    expect(light.bodyBg).not.toBe(dark.bodyBg)
    expect(light.hintColor).not.toBe(dark.hintColor)

    // Rendered letterbox: draw(null) paints only the token-resolved
    // background across the whole popup canvas, so a hard-coded fill would
    // show as pure black pixels in both themes. Read the actual pixels
    // (the theme is still 'light' from the style read above).
    const readLetterboxPixel = () => popup.evaluate(() => {
        const out = document.getElementById('out')
        const ctx = out.getContext('2d')
        window._polymorphicViewport.draw(null)
        const d = ctx.getImageData(0, 0, 1, 1).data
        return [d[0], d[1], d[2]]
    })
    const lightPixel = await readLetterboxPixel()
    await popup.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    const darkPixel = await readLetterboxPixel()

    // Letterbox came from the resolved token, not a hard-coded #000.
    expect(lightPixel, 'light-theme letterbox must not stay black')
        .not.toEqual([0, 0, 0])
    expect(darkPixel, 'dark-theme letterbox must resolve the token, not #000')
        .not.toEqual([0, 0, 0])
    expect(lightPixel).not.toEqual(darkPixel)
    await popup.close()
})
