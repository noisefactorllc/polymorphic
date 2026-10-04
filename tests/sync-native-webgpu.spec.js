// The webgpu receiver legs run in their own spec so the ANGLE Vulkan browser
// stack they need in GPU-less environments (see playwright.config.js) applies
// to them alone, and so their daemon is fresh instead of inheriting the state
// an earlier spec left behind.
import { test } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverTest } from './syncNativeHarness.js'

const getEndpoint = installNativeAudioDaemon()
const setup = createSetup(getEndpoint)
const runNativeReceiverTest = createNativeReceiverTest(setup, getEndpoint)

test('native receiver accepts webgpu renderer bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await runNativeReceiverTest(page, 'webgpu')
})

test('native receiver accepts odd webgpu frame geometry through the fallback queue', async ({ page }) => {
    test.slow()
    await runNativeReceiverTest(page, 'webgpu', { width: 1281, height: 723 })
})