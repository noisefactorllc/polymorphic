import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

// embed.js wires the Sync output controller with
// getCanvas: () => renderer.canvasRenderer.canvas. The engine replaces the
// canvas element after a WebGL context loss, so a canvas captured at
// initialization would keep output pointed at the dead element. These tests
// pin the embed.js wiring and the controller behavior it relies on: identity
// checks and descriptor reads go through the live canvas provider.

test('embed.js hands the controller the renderer live canvas provider', async () => {
    const source = await readFile(new URL('../../public/js/embed.js', import.meta.url), 'utf8')
    assert.match(source, /getCanvas: \(\) => renderer\.canvasRenderer\.canvas/)
})

test('the live canvas provider drives identity checks and descriptor reads after a context-loss rebuild', async () => {
    const syncModule = await import('../../public/js/syncOutput.js')
    const dead = { width: 1280, height: 720 }
    const fresh = { width: 1280, height: 720 }
    const renderer = { canvasRenderer: { canvas: dead }, pipeline: { backend: 'webgl2' } }
    // The exact closure shape embed.js passes as getCanvas.
    const controller = new syncModule.SyncOutputController({
        renderer,
        getCanvas: () => renderer.canvasRenderer.canvas,
        connectionProvider: {
            createClient() {
                throw new Error('no connection is needed for these checks')
            }
        },
        clock: { timeOrigin: 1_700_000_000_000 },
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: () => 2,
        clearTimeout: () => {}
    })

    const descriptorOf = canvas => ({
        width: canvas.width,
        height: canvas.height,
        format: 'rgba8unorm',
        colorSpace: 'srgb',
        alphaMode: 'premultiplied',
        fps: 60
    })

    assert.deepEqual(controller._readDescriptor(), descriptorOf(dead))

    // The engine rebuilds on a fresh canvas; the provider follows it.
    renderer.canvasRenderer.canvas = fresh
    assert.deepEqual(controller._readDescriptor(), descriptorOf(fresh))

    // Identity captured before the rebuild no longer matches: the sending
    // loop must treat the session as renderer-replaced instead of keeping
    // the dead canvas pinned.
    const staleIdentity = Object.freeze({
        pipeline: renderer.pipeline,
        canvas: dead,
        width: dead.width,
        height: dead.height
    })
    assert.throws(
        () => controller._assertRendererIdentity(staleIdentity),
        error => error.code === 'SYNC_RENDERER_REPLACED'
    )

    // Identity captured after the rebuild matches through the same check.
    const liveIdentity = Object.freeze({
        pipeline: renderer.pipeline,
        canvas: fresh,
        width: fresh.width,
        height: fresh.height
    })
    controller._assertRendererIdentity(liveIdentity)
})
