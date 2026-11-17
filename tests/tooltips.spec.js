import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const BOOT_DSL = 'search synth, filter\n\nperlin(scale: 75, octaves: 2)\n  .write(o0)\n\nrender(o0)'

test('every toolbar and bottom-row tooltip remains visible and on screen', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 550 })
    await page.goto(`/?dsl=${encodeURIComponent(BOOT_DSL)}`)
    await page.waitForFunction(() => !!document.querySelector('.status-row tempo-bar .tempo-bar__tap'))

    const targets = page.locator('#menu .tooltip, .status-row .tooltip')
    const count = await targets.count()
    expect(count).toBeGreaterThan(2)

    for (let i = 0; i < count; i++) {
        const target = targets.nth(i)
        await target.hover()
        const expected = await target.getAttribute('data-title')
        const tooltip = page.locator('#hf-tooltip-layer[data-visible="true"]')
        await expect(tooltip).toHaveText(expected)
        const bounds = await tooltip.evaluate(el => {
            const rect = el.getBoundingClientRect()
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
        })
        expect(bounds.left, expected).toBeGreaterThanOrEqual(0)
        expect(bounds.top, expected).toBeGreaterThanOrEqual(0)
        expect(bounds.right, expected).toBeLessThanOrEqual(bounds.width)
        expect(bounds.bottom, expected).toBeLessThanOrEqual(bounds.height)
        if (await target.evaluate(el => !!el.closest('.status-row'))) {
            await expect(tooltip).toHaveAttribute('data-position', 'above')
        }
        expect(await target.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
    }

    await page.locator('.status-row .tempo-bar__tap').focus()
    await expect(page.locator('#hf-tooltip-layer[data-visible="true"]')).toHaveText('Tap tempo')
})

const EFFECT_DSL = [
    'search synth, filter',
    '',
    'perlin(scale: 75, octaves: 2)',
    '  .adjust(mode: hsv, rotation: 120, hueRange: 40)',
    '  .write(o0)',
    '',
    'noise(scaleX: 40, scaleY: 40).write(o1)',
    '',
    'render(o0)',
].join('\n')

const nativeTitles = page => page.evaluate(() => [...document.querySelectorAll('[title]')]
    .filter(el => el.tagName !== 'IFRAME')
    .map(el => el.outerHTML.slice(0, 120)))

async function expectHandfishTooltip(page, locator, text) {
    await expect(locator).toHaveClass(/\btooltip\b/)
    await expect(locator).toHaveAttribute('data-title', text)
    expect(await locator.getAttribute('title')).toBeNull()
    await locator.hover()
    await expect(page.locator('#hf-tooltip-layer[data-visible="true"]')).toHaveText(text)
}

test('controls built in code carry Handfish tooltips and no native title', async ({ page }) => {
    test.slow() // software-GL shader compiles for the app and both pips
    await page.addInitScript(() => localStorage.setItem('polymorphic-output-picker', '1'))
    await page.goto(`/?dsl=${encodeURIComponent(EFFECT_DSL)}`)
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true && !!document.getElementById('dsl-editor')?.value, null, { timeout: 30000 })
    expect(await nativeTitles(page)).toEqual([])

    await expect(page.locator('.output-picker.visible .output-pip')).toHaveCount(2)
    await expectHandfishTooltip(page, page.locator('.output-pip').first(), 'Switch to o0 (Shift+click to reset feedback)')

    const at = await page.evaluate(() => {
        const display = document.querySelector('#dsl-editor .code-editor-display')
        const el = [...display.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent === 'adjust')
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    await page.mouse.click(at.x, at.y)
    await expect(page.locator('#effect-controls-panel')).toBeVisible()
    const actions = page.locator('#effect-controls-panel .ec-action-btn')
    await expectHandfishTooltip(page, actions.filter({ hasText: 'info' }), 'effect help')
    await expectHandfishTooltip(page, actions.filter({ hasText: 'close' }), 'close')
    expect(await nativeTitles(page)).toEqual([])

    await page.evaluate((text) => {
        const textarea = document.getElementById('dsl-editor').getTextarea()
        textarea.focus()
        textarea.value = text
        textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    }, `${EFFECT_DSL}\nthis is not valid dsl @#%`)
    const banner = page.locator('#compiler-error')
    await expect(banner).toHaveClass(/visible/, { timeout: 15000 })
    await expect(banner).toHaveAttribute('data-title', /^Click to jump to line \d+, column \d+$/)
    expect(await banner.getAttribute('title')).toBeNull()
    expect(await nativeTitles(page)).toEqual([])

    await expect(page.locator('#share-copy-btn')).toHaveAttribute('data-title', 'Copy URL')
    expect(await page.locator('#share-copy-btn').getAttribute('title')).toBeNull()
})

// The tooltip's natural width: its text on one layer with no viewport cap,
// limited by the inline max-width Handfish sets from the viewport.
const tooltipBox = layer => layer.evaluate((el) => {
    const probe = el.cloneNode(true)
    Object.assign(probe.style, { position: 'fixed', left: '0px', top: '0px', transform: 'none', width: 'max-content', maxWidth: el.style.maxWidth, visibility: 'hidden' })
    document.body.appendChild(probe)
    const natural = probe.getBoundingClientRect().width
    probe.remove()
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, natural, vw: document.documentElement.clientWidth, vh: innerHeight }
})

// Polymorphic asks a portrait phone to rotate, so the narrow case is a narrow landscape window.
for (const viewport of [{ width: 1000, height: 600 }, { width: 480, height: 320 }]) {
    test(`tooltips keep their natural width at the page edges at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(`/?dsl=${encodeURIComponent(BOOT_DSL)}`)
        await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true, null, { timeout: 30000 })
        const text = 'Switch render output to o3 and reset its feedback'
        const probes = { centre: 'left:50%;top:50%', left: 'left:0;top:50%', right: 'right:0;top:50%', 'bottom-right': 'right:0;bottom:0' }
        await page.evaluate(({ text, probes }) => {
            for (const [name, css] of Object.entries(probes)) {
                const el = document.createElement('div')
                el.className = 'tooltip edge-probe'
                el.dataset.probe = name
                el.dataset.title = text
                el.style.cssText = `position:fixed;${css};width:12px;height:12px;z-index:2147483647`
                document.body.appendChild(el)
            }
        }, { text, probes })
        for (const name of Object.keys(probes)) {
            await page.locator(`.edge-probe[data-probe="${name}"]`).hover()
            const layer = page.locator('#hf-tooltip-layer[data-visible="true"]')
            await expect(layer).toHaveText(text)
            const box = await tooltipBox(layer)
            expect(box.left, name).toBeGreaterThanOrEqual(0)
            expect(box.top, name).toBeGreaterThanOrEqual(0)
            expect(box.right, name).toBeLessThanOrEqual(box.vw)
            expect(box.bottom, name).toBeLessThanOrEqual(box.vh)
            expect(Math.abs(box.width - box.natural), `${name}: width ${box.width} vs natural ${box.natural}`).toBeLessThan(1)
        }
    })
}
