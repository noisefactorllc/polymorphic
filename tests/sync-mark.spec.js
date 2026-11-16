// SPDX-License-Identifier: MIT
// Every button that connects to Sync carries Sync's overpass mark. The mark is
// a CSS mask over currentColor, so it takes the text colour of the button that
// holds it in every theme, and the Sync output action keeps it through every
// relabel.
import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const MARK = '/img/sync-mark.svg'
const THEMES = ['dark', 'light']
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

// The page never reaches a Sync companion on this machine: every loopback
// request and socket except the test server is refused.
test.beforeEach(async ({ page, baseURL }) => {
    const testOrigin = new URL(baseURL).origin
    const otherLoopback = url => LOOPBACK.has(url.hostname) && url.origin !== testOrigin
    await page.route(otherLoopback, route => route.abort('connectionrefused'))
    await page.routeWebSocket(otherLoopback, socket => socket.close())
})

async function boot(page) {
    await page.goto(`/?dsl=${encodeURIComponent('render(o0)')}`, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!customElements.get('menu-bar') && !!document.getElementById('menu')?.config, { timeout: 30000 })
    await page.waitForFunction(() => !!window.__poly?.syncOutputController, { timeout: 30000 })
}

// The mark a button holds: its place, rendered size, colour and resolved mask.
function readMark(button) {
    return button.evaluate(element => {
        const marks = element.querySelectorAll('.sync-mark')
        const mark = marks[0]
        if (!mark) return { count: 0 }
        const style = getComputedStyle(mark)
        const box = mark.getBoundingClientRect()
        const buttonBox = element.getBoundingClientRect()
        return {
            count: marks.length,
            first: element.firstChild === mark,
            ariaHidden: mark.getAttribute('aria-hidden'),
            width: box.width,
            height: box.height,
            inside: box.left >= buttonBox.left && box.right <= buttonBox.right &&
                box.top >= buttonBox.top && box.bottom <= buttonBox.bottom,
            centred: Math.abs((box.top + box.bottom) / 2 - (buttonBox.top + buttonBox.bottom) / 2) <= 1,
            colour: style.backgroundColor,
            textColour: getComputedStyle(element).color,
            mask: style.maskImage !== 'none' ? style.maskImage : style.webkitMaskImage,
            accessibleText: element.textContent.trim()
        }
    })
}

async function expectMark(page, button, label) {
    const markUrl = new URL(MARK, page.url()).href
    await expect(button).toHaveText(label)
    const mark = await readMark(button)
    expect(mark).toMatchObject({
        count: 1,
        first: true,
        ariaHidden: 'true',
        inside: true,
        centred: true,
        mask: `url("${markUrl}")`,
        accessibleText: label
    })
    expect(mark.colour).toBe(mark.textColour)
    expect(mark.width).toBeGreaterThan(0)
    expect(mark.width).toBe(mark.height)
    // The computed mask URL loads and decodes as an image; decode() rejects
    // for a missing or broken file.
    await page.evaluate(async url => {
        const image = new Image()
        image.src = url
        await image.decode()
    }, markUrl)
    return mark
}

test('the Sync mark asset is the overpass glyph', async ({ request }) => {
    const response = await request.get(MARK)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^image\/svg\+xml/)
    expect(await response.text()).toContain('data-sync-mark="overpass"')
})

test('the Sync output action keeps the mark through every relabel', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => document.getElementById('syncOutputMenuItem').click())
    const action = page.locator('#syncOutputAction')
    await expect(action).toBeVisible()
    // Opening the dialog runs one availability check; let it settle before
    // the test drives the controller state.
    await page.waitForFunction(() => window.__poly.syncOutputController.state.status !== 'checking')

    const setState = next => page.evaluate(state => window.__poly.syncOutputController._setState(state), next)
    const sizes = new Set()
    for (const theme of THEMES) {
        await page.evaluate(name => { document.documentElement.dataset.theme = name }, theme)
        for (const [state, label] of [
            [{ status: 'idle', connected: false, error: null }, 'Check again'],
            [{ status: 'checking' }, 'Checking…'],
            [{ status: 'ready', connected: false }, 'Connect Sync'],
            [{ status: 'ready', connected: true }, 'Start sending'],
            [{ status: 'starting' }, 'Starting…'],
            [{ status: 'sending', connected: true }, 'Stop sending'],
            [{ status: 'stopping' }, 'Stopping…']
        ]) {
            await setState(state)
            const mark = await expectMark(page, action, label)
            sizes.add(`${mark.width}x${mark.height}`)
        }

        // Connect Sync relabels the action to Connecting… while pairing runs.
        await setState({ status: 'ready', connected: false, error: null })
        await page.evaluate(() => {
            const controller = window.__poly.syncOutputController
            controller.connect = () => new Promise(resolve => { window.__finishConnect = resolve })
        })
        await action.click()
        await expectMark(page, action, 'Connecting…')
        // The dialog paints the notice before it calls connect().
        await page.waitForFunction(() => typeof window.__finishConnect === 'function')
        await page.evaluate(() => { window.__finishConnect(); delete window.__finishConnect })
        await expectMark(page, action, 'Connect Sync')
        await page.evaluate(() => { delete window.__poly.syncOutputController.connect })
    }
    // One size in every state and theme.
    expect([...sizes]).toHaveLength(1)
})

test('the Sync audio connect button carries the mark', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    const button = page.locator('.live-inputs-panel [data-id=sync-audio-connect]')
    await expect(button).toBeVisible()
    for (const theme of THEMES) {
        await page.evaluate(name => { document.documentElement.dataset.theme = name }, theme)
        await expectMark(page, button, 'Connect Sync audio')
    }
})
