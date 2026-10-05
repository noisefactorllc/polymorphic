// SPDX-License-Identifier: MIT
//
// Handfish token/theme sweep for the surfaces GAP-009 hardened: the boot
// chrome (body, loading, spinner, error), the shared toast, the copy-feedback
// checkmark class, and the viewport popup mirror page.
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
