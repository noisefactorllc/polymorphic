// The webgpu receiver legs run in their own spec so the ANGLE Vulkan browser
// stack they need in GPU-less environments (see playwright.config.js) applies
// to them alone, and so their daemon is fresh instead of inheriting the state
// an earlier spec left behind.
import { test, expect } from '@playwright/test'
import { installNativeAudioDaemon, createSetup, createNativeReceiverTest, createNativeReceiverConnect, acceptNativeReceiverBytes } from './syncNativeHarness.js'

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

// The engine renders scene programs into a scene color texture before the
// pipeline's own output pass, so a scene's bytes reach the output sink the
// same way any other program's do. This leg drives the same native receiver
// with a scene program, so the receiver must accept those real rendered
// bytes on WebGPU.
const sceneDsl = 'search synth\nscene(camera(), mesh("box")).write(o0)\nrender(o0)'
const sceneSetup = (page, fullApp, backend) => createSetup(getEndpoint)(page, fullApp, backend, sceneDsl)
const connectSceneReceiver = createNativeReceiverConnect(sceneSetup, getEndpoint)

test('native receiver accepts webgpu scene bytes while audio and video share the grant', async ({ page }) => {
    test.slow()
    await connectSceneReceiver(page, 'webgpu')
    await acceptNativeReceiverBytes(page)
})

// A recompile can turn a node's output into a storage target at the same
// size. The pipeline must then recreate the reused texture with the usage
// the new spec needs; reusing the old texture without storage usage makes
// WebGPU reject the storage binding and the output stop delivering frames.
// This leg boots the native receiver on a plain program, recompiles the
// same renderer to a chain whose final pass is a compute write at the same
// size, and requires the receiver to keep accepting the real rendered bytes.
const plainDsl = 'search synth\nnoise(scaleX: 60).write(o0)\nrender(o0)'
const landscapeDsl = 'search synth, synth3d, render\nnoise3d().renderLandscape3d().write(o0)\nrender(o0)'
const recompileSetup = (page, fullApp, backend) => createSetup(getEndpoint)(page, fullApp, backend, plainDsl)
const connectRecompileReceiver = createNativeReceiverConnect(recompileSetup, getEndpoint)

test('native receiver keeps accepting webgpu bytes through a usage-changing recompile', async ({ page }) => {
    test.slow()
    await connectRecompileReceiver(page, 'webgpu')
    const before = await page.evaluate(() => window.nativeFrameChecksums.size)
    await page.evaluate(async dsl => {
        await window.PolymorphicAgent.setProgram({ dsl })
    }, landscapeDsl)
    await page.waitForFunction(() => {
        const dsl = document.getElementById('dsl-editor')?.querySelector('textarea')?.value
        return dsl && dsl.includes('renderLandscape3d')
    }, null, { timeout: 30_000 })
    // The recompiled program must actually reach the receiver: fresh frames
    // after the switch, then the full acceptance poll with zero rejects and
    // zero failures.
    await expect.poll(async () => page.evaluate(() => window.nativeFrameChecksums.size))
        .toBeGreaterThan(before)
    await acceptNativeReceiverBytes(page)
})