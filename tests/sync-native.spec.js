import { test, expect } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverConnect, createNativeOutputDialogDrive, acceptNativeReceiverBytes, pollReceiverAccepted, installSenderTransportCut, clickSyncAudioConnectRidingHelloDeadline, clickSyncAudioEnableRidingHelloDeadline, enableSyncAudioInputRidingHelloDeadline } from './syncNativeHarness.js'

const getEndpoint = installNativeAudioDaemon()
const cut = installSenderTransportCut(getEndpoint)
const setup = createSetup(getEndpoint)
const connectNativeReceiver = createNativeReceiverConnect(setup, getEndpoint)
const driveNativeOutputDialog = createNativeOutputDialogDrive(setup, getEndpoint)

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

test('a real sender transport close is recovered through the acceptance poll', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2', null, cut.endpoint)
    // Reproduce the measured race for real, not by injection: the acceptance
    // poll's first getStats runs against a sender whose data transport is cut
    // underneath the controller — an abrupt teardown with no WebSocket close
    // frame, exactly the shape a network drop takes — so the daemon reaps the
    // sender from the data socket it owns, the stale exchange surfaces a
    // lifecycle error against the still-cached client/sender pair, and the
    // controller recovers through its backoff onto a replacement sender. The
    // poll must ride the window out and the acceptance itself (receiver
    // checksum match over real rendered bytes, zero rejects, zero failures)
    // is unchanged.
    const preCutSenderId = await page.evaluate(cutUrl => {
        const output = window.__poly.syncOutputController
        const client = output._client
        const sender = output._sender
        if (!client || !sender) throw new Error('receiver leg lost its client or sender')
        window.__staleLifecycleErrors = []
        const lifecycleNames = ['SyncLifecycleError', 'SyncUnavailableError', 'SyncTimeoutError', 'SyncSenderLostError']
        const record = error => {
            if (lifecycleNames.includes(error?.name)) {
                window.__staleLifecycleErrors.push(`${error.name}: ${error.message}`)
            }
        }
        const exchange = client._exchange.bind(client)
        client._exchange = (...args) => {
            const staged = (async () => {
                if (args[0]?.type === 'getStats' && !window.__senderCloseStaged) {
                    window.__senderCloseStaged = true
                    await fetch(cutUrl, { mode: 'no-cors' })
                    await new Promise(resolve => setTimeout(resolve, 50))
                }
                return exchange(...args)
            })()
            staged.catch(record)
            return staged
        }
        const schedule = client._scheduleControl.bind(client)
        client._scheduleControl = (session, operation) => {
            const result = schedule(session, operation)
            result.catch(record)
            return result
        }
        return sender.id
    }, cut.controlUrl())
    const acceptance = acceptNativeReceiverBytes(page)
    await page.waitForFunction(preId => {
        const output = window.__poly.syncOutputController
        const cause = output._lastRecoveryCause
        return Boolean(cause && Number(cause.recoveryCount) >= 1 &&
            output._sender && output._sender.id !== preId &&
            output.state.status === 'sending')
    }, preCutSenderId, { timeout: 30000 })
    const observed = await page.evaluate(() => window.__staleLifecycleErrors.slice())
    expect(observed.length, `stale-exchange lifecycle errors: ${observed.join('; ')}`).toBeGreaterThan(0)
    expect(Number((await page.evaluate(() => window.__poly.syncOutputController._lastRecoveryCause))?.recoveryCount))
        .toBeGreaterThanOrEqual(1)
    await acceptance
})

test('a failed native input keeps its selected identity and the enable button permits retry', async ({ page }) => {
    await setup(page, true)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    // The connect opens its own control connection, so the daemon's 1 s
    // control-hello deadline can close it on a saturated page; the panel
    // surfaces that close for an explicit retry. Ride out exactly that close
    // the way the harness's grant path does.
    await clickSyncAudioConnectRidingHelloDeadline(page)
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_fail_after_2')
    for (let attempt = 0; attempt < 2; attempt++) {
        await clickSyncAudioEnableRidingHelloDeadline(page, 'Sync audio:')
        await expect(page.locator('[data-id=audio-status]')).toContainText('Sync audio:')
        await expect(page.locator('[data-id=audio-toggle]')).toHaveText('enable')
        await expect(page.locator('[data-id=audio-device]')).toHaveValue('sync-audio:audio_fail_after_2')
    }
})

test('a permission-denied native input reports the denial and a working source stays selectable', async ({ page }) => {
    await setup(page, true)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    await clickSyncAudioConnectRidingHelloDeadline(page)
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_permission_denied')
    await clickSyncAudioEnableRidingHelloDeadline(page, /audio input failed: (?!control connection closed)/)
    // The daemon rejects the open with "Audio permission denied"; the panel
    // surfaces it as an audio-input failure, keeps the enable button on
    // "enable" for an explicit retry, and never falls back to the microphone.
    await expect(page.locator('[data-id=audio-status]')).toContainText('audio input failed')
    await expect(page.locator('[data-id=audio-toggle]')).toHaveText('enable')
    await expect.poll(() => page.evaluate(() => window.__poly.liveInputsPanel._audioMgr?.enabled)).toBe(false)
    // The denial is transient to that source: a healthy fixture on the same
    // daemon still opens and reaches its channels, and the selection moves.
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_2')
    await enableSyncAudioInputRidingHelloDeadline(page)
    await expect(page.locator('[data-id=audio-toggle]')).toHaveText('disable')
    await expect.poll(() => page.evaluate(() =>
        window.__poly.liveInputsPanel._innerRenderer?.audioState
            ?.getDeviceChannelState({ id: 'sync-audio:audio_2', channel: 2 })?.raw)).toBeCloseTo(2 / 32)
    await expect.poll(() => page.evaluate(async () =>
        (await import('/js/sync/audioInput.js')).refreshSyncAudioDevices()
            .then(devices => devices.find(source => source.id === 'sync-audio:audio_permission_denied')?.name)))
        .toBe('Restricted device · Sync')
    await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.disable())
})

test('the Sync output dialog drives connect, start, stop, and reconnect against the native receiver', async ({ page }) => {
    test.slow()
    // The brief requires real browser controls for the output lifecycle, so
    // every state transition here is a click on the product's own dialog —
    // menu open, check on open, Connect Sync, Start sending — never a direct
    // controller call. The audio grant is still earned through the live-inputs
    // panel (the harness), and the video client refuses to pair again, so the
    // dialog's connect must reuse the shared grant.
    const { action, state, dialog } = await driveNativeOutputDialog(page, 'webgl2')
    // The counters the dialog renders are the controller's real local stats:
    // actual sender frames, not fake SDK calls.
    await expect.poll(async () => Number(await page.locator('#syncOutputSent').textContent()), { timeout: 15_000 })
        .toBeGreaterThan(0)
    // The native receiver accepts real rendered bytes while the dialog runs
    // the output.
    await pollReceiverAccepted(page)
    // Stop through the dialog's own Stop sending button: the output keeps the
    // connected client and lands on Ready with the connect action offered
    // again for an explicit reconnect.
    await expect(action).toHaveText('Stop sending')
    await action.click()
    await expect(state).toHaveText('Ready', { timeout: 15_000 })
    // Reconnect through the same controls and send again.
    await expect(action).toHaveText('Connect Sync')
    await action.click()
    await expect(state).toHaveText('Connected', { timeout: 15_000 })
    await expect(action).toHaveText('Start sending')
    await action.click()
    await expect(state).toHaveText('Sending', { timeout: 15_000 })
    await expect(page.locator('#syncOutputLiveBadge')).toBeVisible()
    await pollReceiverAccepted(page)
    // Stop again through the dialog, then close it. A synthetic pagehide must
    // afterwards disable the still-enabled audio input and idle the output.
    await expect(action).toHaveText('Stop sending')
    await action.click()
    await expect(state).toHaveText('Ready', { timeout: 15_000 })
    await expect(page.locator('#syncOutputFailed')).toHaveText('0')
    await page.click('#syncOutputCloseBtn')
    await expect(dialog).not.toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    await expect.poll(() => page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(false)
    await expect.poll(() => page.evaluate(() => window.__poly.syncOutputController.state.status)).toBe('idle')
})