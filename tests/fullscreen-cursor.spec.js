// SPDX-License-Identifier: MIT
// The pointer stays hidden over a fullscreen canvas. Polymorphic shows the
// canvas alone in fullscreen in two views: performance mode with the page
// fullscreen (entered from the toolbar, menu or palette, or by the agent's
// setFullscreen command), and the viewport popup (its F key). In both, the
// computed cursor is none across the whole screen, including the corners,
// and leaving fullscreen restores the cursor the view had before. The dot
// that stands in for the pointer in performance mode is not drawn while the
// page is fullscreen, and it comes back when fullscreen ends.
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const BOOT_DSL = 'search synth\n\nperlin(scale: 75, octaves: 2)\n  .write(o0)\n\nrender(o0)'

// The page never reaches a Sync companion on this machine: every loopback
// request and socket except the test server is refused.
test.beforeEach(async ({ page, baseURL }) => {
    const testOrigin = new URL(baseURL).origin
    const otherLoopback = url => LOOPBACK.has(url.hostname) && url.origin !== testOrigin
    await page.route(otherLoopback, route => route.abort('connectionrefused'))
    // Context-wide, so the viewport popup's sockets are refused too.
    await page.context().routeWebSocket(otherLoopback, socket => socket.close())
    // The popup test must drop HTTP routes (see below), so fetch and XHR to
    // other loopback origins are also refused inside every page.
    await page.context().addInitScript(origin => {
        const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
        const refused = target => {
            try {
                const url = new URL(target instanceof Request ? target.url : String(target), location.href)
                return loopback.has(url.hostname) && url.origin !== origin
            } catch {
                return false
            }
        }
        const fetch = window.fetch
        window.fetch = function (input, init) {
            return refused(input) ? Promise.reject(new TypeError('loopback refused')) : fetch.call(this, input, init)
        }
        const open = XMLHttpRequest.prototype.open
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (refused(url)) throw new TypeError('loopback refused')
            return open.call(this, method, url, ...rest)
        }
    }, testOrigin)
})

async function boot(page) {
    await page.goto(`/?dsl=${encodeURIComponent(BOOT_DSL)}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, null, { timeout: 30000 })
    await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true, null, { timeout: 30000 })
}

// The computed cursor of whatever is under the centre, each corner, and a
// grid over the whole screen.
function cursors(target) {
    return target.evaluate(() => {
        const w = innerWidth
        const h = innerHeight
        const at = (x, y) => {
            const element = document.elementFromPoint(x, y)
            return element ? getComputedStyle(element).cursor : 'nothing'
        }
        const everywhere = new Set()
        for (let y = 0; y < h; y += 16) {
            for (let x = 0; x < w; x += 16) everywhere.add(at(x, y))
        }
        return {
            points: {
                centre: at(w / 2, h / 2),
                topLeft: at(0, 0),
                topRight: at(w - 1, 0),
                bottomLeft: at(0, h - 1),
                bottomRight: at(w - 1, h - 1)
            },
            everywhere: [...everywhere].sort()
        }
    })
}

const HIDDEN = {
    points: { centre: 'none', topLeft: 'none', topRight: 'none', bottomLeft: 'none', bottomRight: 'none' },
    everywhere: ['none']
}

// The performance-mode cursor dot: absent, present but not drawn, or drawn.
function dot(page) {
    return page.evaluate(() => {
        const element = document.querySelector('body > .cursor-fade-dot')
        if (!element) return 'absent'
        return getComputedStyle(element).display !== 'none' && element.offsetWidth > 0 ? 'drawn' : 'hidden'
    })
}

for (const [entry, enter, leave] of [
    ['toolbar button',
        page => page.locator('#fullscreen-btn-menu').click(),
        page => page.evaluate(() => document.exitFullscreen())],
    ['agent command',
        page => page.evaluate(() => window.PolymorphicAgent.setFullscreen({ fullscreen: true })),
        page => page.evaluate(() => window.PolymorphicAgent.setFullscreen({ fullscreen: false }))]
]) {
    test(`performance mode fullscreen from the ${entry} hides the pointer over the whole screen`, async ({ page }) => {
        await boot(page)
        if (entry === 'agent command') await page.evaluate(() => window.PolymorphicAgent.ready)
        const windowed = await cursors(page)
        expect(windowed.everywhere).not.toEqual(['none'])

        await enter(page)
        await page.waitForFunction(() => !!document.fullscreenElement)
        await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
        await expect(page.locator('body')).toHaveClass(/performance-mode/)
        expect(await cursors(page)).toEqual(HIDDEN)

        // Moving the mouse does not bring the pointer or its dot back.
        await page.mouse.move(200, 150)
        await page.mouse.move(640, 360, { steps: 4 })
        expect(await cursors(page)).toEqual(HIDDEN)
        expect(await dot(page)).toBe('hidden')

        // Leaving fullscreen keeps performance mode's own hidden pointer and
        // draws its dot again; leaving performance mode then restores the
        // windowed cursor.
        await leave(page)
        await page.waitForFunction(() => !document.fullscreenElement)
        expect(await cursors(page)).toEqual(HIDDEN)
        await page.mouse.move(400, 300)
        expect(await dot(page)).toBe('drawn')
        await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
        await expect(page.locator('body')).not.toHaveClass(/performance-mode/)
        expect(await cursors(page)).toEqual(windowed)
    })
}

test('going fullscreen in performance mode stops drawing the cursor dot until fullscreen ends', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => document.getElementById('viewMenuItem-performance-mode').click())
    await expect(page.locator('body')).toHaveClass(/performance-mode/)
    await page.mouse.move(400, 300)
    expect(await dot(page)).toBe('drawn')

    await page.evaluate(() => document.getElementById('viewMenuItem-fullscreen').click())
    await page.waitForFunction(() => !!document.fullscreenElement)
    expect(await dot(page)).toBe('hidden')
    await page.mouse.move(640, 360, { steps: 4 })
    expect(await dot(page)).toBe('hidden')
    expect(await cursors(page)).toEqual(HIDDEN)

    await page.evaluate(() => document.getElementById('viewMenuItem-fullscreen').click())
    await page.waitForFunction(() => !document.fullscreenElement)
    expect(await dot(page)).toBe('drawn')
    expect(await cursors(page)).toEqual(HIDDEN)
})

test('the viewport popup hides the pointer over the whole screen in fullscreen', async ({ page }) => {
    await boot(page)
    // While an HTTP route is active, Playwright stalls the subresources of a
    // popup written with document.write, and its script never runs. The
    // WebSocket guard and the in-page fetch and XHR guard stay in place.
    await page.unrouteAll({ behavior: 'wait' })

    const popupOpened = page.waitForEvent('popup')
    await page.evaluate(() => document.getElementById('viewMenuItem-open-viewport-window').click())
    const popup = await popupOpened
    await popup.waitForFunction(() => !!window._polymorphicViewport)
    const windowed = await cursors(popup)

    await popup.bringToFront()
    await popup.keyboard.press('f')
    await popup.waitForFunction(() => !!document.fullscreenElement)
    expect(await cursors(popup)).toEqual(HIDDEN)

    await popup.mouse.move(100, 80)
    await popup.mouse.move(640, 360, { steps: 4 })
    expect(await cursors(popup)).toEqual(HIDDEN)

    await popup.keyboard.press('f')
    await popup.waitForFunction(() => !document.fullscreenElement)
    expect(await cursors(popup)).toEqual(windowed)
    await popup.close()
})
