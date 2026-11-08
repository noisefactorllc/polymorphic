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

// The perlin() legs above never reach the text-texture upload, so this leg
// drives the same native receiver with a program whose only visible content
// is a text effect: the receiver must accept the real rendered bytes that
// pipeline produces on WebGPU.
const textDsl = 'search synth, filter\nsolid(color: [0, 0, 0]).text(text: "Hello", font: "Nunito", size: 0.1).write(o0)\nrender(o0)'
const textSetup = (page, fullApp, backend) => createSetup(getEndpoint)(page, fullApp, backend, textDsl)
const runTextReceiverTest = createNativeReceiverTest(textSetup, getEndpoint)

test('native receiver accepts webgpu text-effect bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await runTextReceiverTest(page, 'webgpu')
})

// Two reactionDiffusion instances in one chain used to share one state
// texture and one zoom size; the engine now gives each instance its own.
// This leg drives the same native receiver with exactly that program, so
// the receiver must accept the real rendered bytes that the per-instance
// pipeline produces on WebGPU.
const statefulDsl = 'search synth, mixer\nreactionDiffusion(zoom: x4).blendMode(tex: reactionDiffusion(zoom: x16)).write(o0)\nrender(o0)'
const statefulSetup = (page, fullApp, backend) => createSetup(getEndpoint)(page, fullApp, backend, statefulDsl)
const runStatefulReceiverTest = createNativeReceiverTest(statefulSetup, getEndpoint)

test('native receiver accepts webgpu stateful-instance bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await runStatefulReceiverTest(page, 'webgpu')
})