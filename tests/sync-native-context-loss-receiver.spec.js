import { test, expect } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverConnect, pollReceiverAccepted } from './syncNativeHarness.js'

const getEndpoint = installNativeAudioDaemon()
const connectNativeReceiver = createNativeReceiverConnect(createSetup(getEndpoint), getEndpoint)

test('native receiver keeps accepting real webgl2 bytes from the fresh canvas after a context-loss rebuild', async ({ page }) => {
    test.slow()
    await connectNativeReceiver(page, 'webgl2')

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
    await page.evaluate(async () => {
        const output = window.__poly.syncOutputController
        await output.connect()
        await output.start('Polymorphic native receiver')
    })

    await pollReceiverAccepted(page)
    const accepted = await page.evaluate(() => window.nativeReceiverStats)
    expect(Number(accepted.accepted)).toBeGreaterThanOrEqual(2)
    expect(Number(accepted.rejected)).toBe(0)
    expect(Number(accepted.failed)).toBe(0)
    // The accepted checksum must match a frame this page actually sent after
    // the rebuild: actual rendered pixel bytes from the fresh canvas, not
    // counters or fake SDK calls.
    await page.evaluate(() => window.__poly.syncOutputController.stop())
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(true)
})
