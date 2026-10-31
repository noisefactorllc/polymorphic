import { test, expect } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverConnect, pollReceiverAccepted } from './syncNativeHarness.js'

const getEndpoint = installNativeAudioDaemon()
const connectNativeReceiver = createNativeReceiverConnect(createSetup(getEndpoint), getEndpoint)

test('native receiver keeps accepting real webgl2 bytes from the fresh canvas after a context-loss rebuild', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2')

    // Baseline before the loss: the original sender's own acceptance proves
    // the output path delivers real bytes, and records the sender identity
    // that the post-rebuild legs must replace. The daemon keeps receiver
    // counters and the publisher checksum per sender, so a restart creates a
    // sender whose counters start at zero.
    await pollReceiverAccepted(page)
    await page.evaluate(() => {
        window.__preLossSender = window.__poly.syncOutputController._sender.id
    })
    expect(await page.evaluate(() => window.__preLossSender)).toBeTruthy()

    // Lose the context the way a GPU reset would: the engine rebuilds on a
    // fresh canvas element in the old canvas's place, the wrapper adopts that
    // fresh canvas, and the Sync output controller's identity checks route the
    // replacement through its recovery path. The receiver must keep accepting
    // real rendered bytes from the fresh canvas.
    await page.evaluate(() => {
        window.__preRebuildCanvas = window.__poly.renderer.canvas
        const gl = window.__preRebuildCanvas.getContext('webgl2')
        const ext = gl?.getExtension('WEBGL_lose_context')
        if (!ext) throw new Error('WEBGL_lose_context is required to simulate a GPU reset')
        window.__loseContext = ext
        ext.loseContext()
    })
    // The engine rebuilds on a fresh canvas element and the wrapper adopts it.
    await page.waitForFunction(
        () => window.__poly.renderer.canvas !== window.__preRebuildCanvas,
        null,
        { timeout: 30000 },
    )
    // Wait for the rebuilt program to be live again on the adopted canvas.
    await page.waitForFunction(() => window.__poly.renderer.isRunning, null, { timeout: 30000 })
    expect(await page.evaluate(() => window.__poly.renderer.contextLost)).toBe(false)
    // The wrapper moved onto the engine's fresh canvas element, which sits in
    // the DOM where the dead one was.
    expect(await page.evaluate(
        () => document.querySelector('canvas') === window.__poly.renderer.canvas,
    )).toBe(true)
    // A replaced renderer is the product's designed stop: output ends with
    // SYNC_RENDERER_REPLACED and the user restarts it, which now reads the
    // fresh canvas instead of the dead element.
    expect(await page.evaluate(
        () => window.__poly.syncOutputController.state.error?.code,
    )).toBe('SYNC_RENDERER_REPLACED')
    expect(await page.evaluate(() => window.__poly.syncOutputController.state.status)).toBe('error')
    // The observed-socket set still holds every frame sent before the loss,
    // and a deterministic page can resend byte-identical frames, so a hash
    // alone cannot date a frame. Clear the set here, with the output stopped,
    // so the acceptance below can only match a frame the fresh canvas sent
    // after the restart.
    await page.evaluate(() => window.nativeFrameChecksums.clear())
    await page.evaluate(async () => {
        const output = window.__poly.syncOutputController
        await output.connect()
        await output.start('Polymorphic native receiver')
    })

    // The post-rebuild acceptance: pollReceiverAccepted reads the daemon's
    // getStats for the current sender only, and this sender did not exist
    // before the rebuild, so its accepted count covers post-rebuild frames
    // alone.
    await pollReceiverAccepted(page)
    const fresh = await page.evaluate(() => {
        const stats = window.nativeReceiverStats
        return {
            senderId: window.__poly.syncOutputController._sender.id,
            accepted: Number(stats.accepted),
            rejected: Number(stats.rejected),
            failed: Number(stats.failed),
            checksum: Number(stats.checksum),
            sentAfterRebuild: window.nativeFrameChecksums.has(Number(stats.checksum)),
        }
    })
    // The restart replaced the sender: the accepted stats and the accepted
    // checksum belong to a sender created after the rebuild, never to the
    // pre-loss one.
    expect(fresh.senderId).toBeTruthy()
    expect(fresh.senderId).not.toBe(await page.evaluate(() => window.__preLossSender))
    expect(fresh.accepted).toBeGreaterThanOrEqual(2)
    expect(fresh.rejected).toBe(0)
    expect(fresh.failed).toBe(0)
    // The accepted checksum must match a frame this page sent after the
    // rebuild: actual rendered pixel bytes from the fresh canvas, not
    // counters or fake SDK calls.
    expect(fresh.sentAfterRebuild).toBe(true)
    await page.evaluate(() => window.__poly.syncOutputController.stop())
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(true)
})
