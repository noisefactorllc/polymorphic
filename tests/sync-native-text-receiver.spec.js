// The perlin() receiver legs exercise the Sync output transport but never the
// text-texture upload, so this spec drives the native receiver with a program
// whose only visible content is a text effect: the receiver must accept the
// real rendered bytes that pipeline produces, on WebGL2. The WebGPU text leg
// lives in sync-native-webgpu.spec.js, which the config routes to the WebGPU
// project.
import { test } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverTest } from './syncNativeHarness.js'

const textDsl = 'search synth, filter\nsolid(color: [0, 0, 0]).text(text: "Hello", font: "Nunito", size: 0.1).write(o0)\nrender(o0)'
const getEndpoint = installNativeAudioDaemon()
const baseSetup = createSetup(getEndpoint)
const setup = (page, fullApp, backend) => baseSetup(page, fullApp, backend, textDsl)
const runNativeReceiverTest = createNativeReceiverTest(setup, getEndpoint)

test('native receiver accepts webgl2 text-effect bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await runNativeReceiverTest(page, 'webgl2')
})
