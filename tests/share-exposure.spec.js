import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// The sentence beside Share says what anyone with the link can open. It names
// the original images and custom shader code only when the share carries them,
// follows the loaded portable effects while the dialog is open, and keeps what
// a running share carries until that share ends. Each open of the dialog starts
// at the form.

const RESULT = " This link doesn't expire automatically. To share only the finished result, export an image or video."
const SENTENCE = {
    all: 'Anyone with the link can open the editable program, including the original images and custom shader code it uses.' + RESULT,
    images: 'Anyone with the link can open the editable program, including the original images it uses.' + RESULT,
    shaders: 'Anyone with the link can open the editable program, including custom shader code it uses.' + RESULT,
    program: 'Anyone with the link can open the editable program.' + RESULT,
}
// A 1x1 PNG, inline, so the program names an image without a network request.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const PLAIN = 'search synth\nsolid(color: #ffff00).write(o0)\nrender(o0)'
const PICTURE = `search synth\nmedia(url: "${PIXEL}").write(o0)\nrender(o0)`
const PROBE = {
    namespace: 'user', name: 'exposureProbe', func: 'exposureProbe', globals: {},
    shaders: { main: { glsl: '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(0.2, 0.4, 0.6, 1.0); }' } },
    passes: [{ name: 'main', program: 'main', outputs: { fragColor: 'outputTex' } }],
}
const PROBED = 'search user, synth\nexposureProbe().write(o0)\nrender(o0)'

async function boot(page, dsl) {
    await page.goto('/?dsl=' + encodeURIComponent(dsl))
    await page.waitForFunction(() => !!window.PolymorphicAgent)
    await page.evaluate(() => window.PolymorphicAgent.ready)
}

const openShare = page => page.evaluate(() => document.getElementById('shareProgram').click())
const sentence = page => page.locator('#share-exposure')
const registerProbe = page => page.evaluate(async probe => {
    const { registerPortableEffect } = await import('/js/sharingLoader.js')
    await registerPortableEffect(probe)
}, PROBE)
const clearEffects = page => page.evaluate(async () => {
    const { clearLoadedPortableEffects } = await import('/js/sharingLoader.js')
    clearLoadedPortableEffects()
})

// Keeps each share the dialog runs, so a test can wait until that share ends.
const trackShares = page => page.evaluate(async () => {
    const { shareModal } = await import('/js/shareModal.js')
    const share = shareModal._handleShare
    window.__shares = []
    shareModal._handleShare = function () {
        const run = share.call(this)
        window.__shares.push(run)
        return run
    }
})
const shareEnded = (page, index) => page.evaluate(i => window.__shares[i], index)

// Stand-in sharing service. Each shorten request waits until the test answers it.
async function holdShares(page) {
    const held = []
    let arrived = () => {}
    await page.route('https://sharing.noisedeck.app/api/images', route => route.fulfill({ status: 201, json: { id: 'f'.repeat(64), url: 'unused', mimeType: 'image/jpeg', width: 1, height: 1 } }))
    await page.route('https://sharing.noisedeck.app/api/embed/shorten', route => {
        held.push(route)
        arrived()
    })
    return {
        async next() {
            if (!held.length) await new Promise(resolve => { arrived = resolve })
            return held.shift()
        },
    }
}

test('the sentence names only what the share carries', async ({ page }) => {
    await boot(page, PLAIN)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.program)
    await page.click('#share-close-btn')

    await boot(page, PICTURE)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.images)
})

test('a loaded effect the program names adds custom shader code while the dialog is open', async ({ page }) => {
    await boot(page, PROBED)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.program)
    await registerProbe(page)
    await expect(sentence(page)).toHaveText(SENTENCE.shaders)
    await clearEffects(page)
    await expect(sentence(page)).toHaveText(SENTENCE.program)
})

test('a running share keeps what it carries, and a failed share follows the effects again', async ({ page }) => {
    const shares = await holdShares(page)
    await boot(page, PROBED)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.program)
    await page.click('#share-submit-btn')
    const share = await shares.next()
    // This share packages no effect: it read the loaded effects at the click.
    expect(share.request().postDataJSON().effects).toEqual([])
    await registerProbe(page)
    await expect(sentence(page)).toHaveText(SENTENCE.program)
    await share.fulfill({ status: 503, body: 'unavailable' })
    await expect(page.locator('#share-submit-btn')).toBeEnabled()
    await expect(sentence(page)).toHaveText(SENTENCE.shaders)
})

test('a share sends the program it checked at the click, though the dialog is opened again on another', async ({ page }) => {
    const shares = await holdShares(page)
    // Packaging the effect loads JSZip, the first time in a page: the share waits there.
    let releaseZip
    const zipHeld = new Promise(resolve => { releaseZip = resolve })
    let zipRequested
    const zipArrived = new Promise(resolve => { zipRequested = resolve })
    await page.route('**/js/lib/jszip.min.js', async route => {
        zipRequested()
        await zipHeld
        await route.continue()
    })
    await boot(page, PROBED)
    await registerProbe(page)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.shaders)
    await page.click('#share-submit-btn')
    await zipArrived

    await page.click('#share-close-btn')
    await page.evaluate(dsl => window.PolymorphicAgent.setProgram({ dsl }), PICTURE)
    await openShare(page)
    await expect(sentence(page)).toHaveText(SENTENCE.images)
    releaseZip()

    const share = await shares.next()
    const payload = share.request().postDataJSON()
    expect(payload.dsl).toBe(PROBED)
    expect(payload.effects).toHaveLength(1)
    await share.fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/probe' } })
})

test('the dialog opens at the form after a share made its link', async ({ page }) => {
    const shares = await holdShares(page)
    await boot(page, PLAIN)
    await openShare(page)
    await page.click('#share-submit-btn')
    await (await shares.next()).fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/first', expiresAt: '2030-01-01T00:00:00Z' } })
    await expect(page.locator('#share-url')).toHaveValue('https://sharing.noisedeck.app/s/first')
    await expect(page.locator('#share-expires')).not.toBeEmpty()
    await page.click('#share-done-btn')

    await openShare(page)
    await expect(page.locator('#share-form')).toBeVisible()
    await expect(page.locator('#share-result')).toBeHidden()
    await expect(page.locator('#share-submit-btn')).toBeEnabled()
    await expect(page.locator('#share-submit-btn')).toHaveText('Share')
    await expect(page.locator('#share-url')).toHaveValue('')
    await expect(page.locator('#share-expires')).toBeEmpty()
    await expect(sentence(page)).toHaveText(SENTENCE.program)

    // A second share shows only its own link.
    await page.click('#share-submit-btn')
    await (await shares.next()).fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/second' } })
    await expect(page.locator('#share-url')).toHaveValue('https://sharing.noisedeck.app/s/second')
    await expect(page.locator('#share-expires')).toBeEmpty()
})

test('a share from an earlier open does not change the dialog opened after it', async ({ page }) => {
    const shares = await holdShares(page)
    await boot(page, PLAIN)
    await trackShares(page)
    await openShare(page)
    await page.click('#share-submit-btn')
    const first = await shares.next()
    await page.click('#share-close-btn')

    await openShare(page)
    await page.click('#share-submit-btn')
    const second = await shares.next()
    // The first share fails, and the second share's dialog keeps running it.
    await first.fulfill({ status: 503, body: 'unavailable' })
    await shareEnded(page, 0)
    await expect(page.locator('#share-submit-btn')).toBeDisabled()
    await expect(page.locator('#share-submit-btn')).toHaveText('Sharing...')
    await second.fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/second' } })
    await expect(page.locator('#share-url')).toHaveValue('https://sharing.noisedeck.app/s/second')
    await page.click('#share-done-btn')

    // A late link from an earlier open does not replace the form of a later one.
    await openShare(page)
    await page.click('#share-submit-btn')
    const third = await shares.next()
    await page.click('#share-close-btn')
    await openShare(page)
    await third.fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/s/third' } })
    await shareEnded(page, 2)
    await expect(page.locator('#share-form')).toBeVisible()
    await expect(page.locator('#share-result')).toBeHidden()
    await expect(page.locator('#share-url')).toHaveValue('')
})
