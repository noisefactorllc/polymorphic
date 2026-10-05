import { test, expect } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverConnect, acceptNativeReceiverBytes } from './syncNativeHarness.js'

const getEndpoint = installNativeAudioDaemon()
const setup = createSetup(getEndpoint)
const connectNativeReceiver = createNativeReceiverConnect(setup, getEndpoint)

for (const channels of [1, 2, 8, 32]) {
    test(`native ${channels}-channel audio reaches every shader channel and releases capture`, async ({ page }) => {
        await setup(page)
        const id = `sync-audio:audio_${channels}`
        expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
        await expect.poll(() => page.evaluate(({ id, channels }) => Array.from({ length: channels }, (_, i) =>
            Math.round((window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw || 0) * 32)), { id, channels }))
            .toEqual(Array.from({ length: channels }, (_, i) => i + 1))
        await expect.poll(() => page.evaluate(() => window.audioState.raw)).toBeCloseTo((channels + 1) / 64)
        await page.evaluate(() => window.audio.disable())
        expect(await page.evaluate(() => window.audioState.rawReady)).toBe(false)
        expect(await page.evaluate(id => window.audioState.getDeviceChannelState({ id, channel: 1 }), id)).toBe(null)
        expect(await page.evaluate(() => window.audioState.getDeviceChannelState({ channel: 1 }))).toBe(null)
        await expect.poll(() => page.evaluate(async () => (await window.syncAudio.refreshSyncAudioDevices())
            .find(source => source.id === 'sync-audio:audio_active')?.name)).toBe('0 · Sync')
    })
}

test('native 32-channel pulse source guarantees zero crosstalk across all unmodulated channels', async ({ page }) => {
    await setup(page)
    const id = 'sync-audio:audio_32_pulse'
    expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
    await expect.poll(async () => {
        const vals = await page.evaluate(id => Array.from({ length: 32 }, (_, i) =>
            window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw ?? null), id)
        if (vals.some(v => v === null)) return false
        const active = vals.filter(v => v > 0.5).length
        const inactiveClean = vals.filter(v => v <= 0.5).every(v => v === 0)
        return active === 1 && inactiveClean
    }, { timeout: 10_000 }).toBe(true)
    await page.evaluate(() => window.audio.disable())
})

test('native 32-channel discrete mapping preserves channel ordering without inversion', async ({ page }) => {
    await setup(page)
    const id = 'sync-audio:audio_32'
    expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
    await expect.poll(async () => {
        const vals = await page.evaluate(id => Array.from({ length: 32 }, (_, i) =>
            window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw ?? null), id)
        if (vals.some(v => v === null)) return false
        if (Math.abs(vals[0] - (1 / 32)) > 0.01) return false
        if (Math.abs(vals[31] - (32 / 32)) > 0.01) return false
        for (let i = 0; i < 31; i++) {
            if (vals[i + 1] <= vals[i]) return false
        }
        return true
    }, { timeout: 10_000 }).toBe(true)
    await page.evaluate(() => window.audio.disable())
})

test('native read failure clears active state and permits a new source', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => window.audio.enable('sync-audio:audio_fail_after_2'))
    await expect.poll(() => page.evaluate(() => window.audio.enabled)).toBe(false)
    expect(await page.evaluate(() => window.audio.enable('sync-audio:audio_2'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.audioState.getDeviceChannelState({ id: 'sync-audio:audio_2', channel: 2 })?.raw)).toBeCloseTo(2 / 32)
    await page.evaluate(() => window.audio.disable())
})

test('native receiver accepts webgl2 renderer bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2')
    await acceptNativeReceiverBytes(page)
})

test('native receiver accepts odd webgl2 frame geometry through the fallback queue', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2', { width: 1281, height: 723 })
    await acceptNativeReceiverBytes(page)
})

test('the receiver acceptance poll rides out a lifecycle close mid-poll', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2')
    // Deterministic form of the measured race: a daemon deadline close ends
    // the sender between the poll's client/sender reads and its getStats
    // exchange, the controller recovers through its backoff, and the stale
    // exchange surfaces a lifecycle error that aborted the poll instead of
    // retrying. Inject exactly one such error on the first getStats; the poll
    // must ride it out inside its window, and the acceptance itself (receiver
    // checksum match, zero rejects, zero failures) is unchanged.
    await page.evaluate(async () => {
        const { SyncLifecycleError } = await import('/js/sync/sdk/0.3.3/browser/client.js')
        const client = window.__poly.syncOutputController._client
        const exchange = client._exchange.bind(client)
        let injected = false
        client._exchange = (...args) => {
            if (!injected && args[0]?.type === 'getStats') {
                injected = true
                return Promise.reject(new SyncLifecycleError('Sender does not exist'))
            }
            return exchange(...args)
        }
    })
    await acceptNativeReceiverBytes(page)
})

test('a failed native input keeps its selected identity and the enable button permits retry', async ({ page }) => {
    await setup(page, true)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    await page.click('[data-id=sync-audio-connect]')
    await expect(page.locator('[data-id=sync-audio-status]')).toHaveText('Select a Sync input, then enable audio.')
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_fail_after_2')
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.click('[data-id=audio-toggle]')
        await expect(page.locator('[data-id=audio-status]')).toContainText('Sync audio:')
        await expect(page.locator('[data-id=audio-toggle]')).toHaveText('enable')
        await expect(page.locator('[data-id=audio-device]')).toHaveValue('sync-audio:audio_fail_after_2')
    }
})