import assert from 'node:assert/strict'
import { test } from 'node:test'

// The v1 receiver refuses a frame wider or taller than 4096 and a payload
// above 64 MiB, and the refreshed SDK snapshot now refuses the same limits
// before it encodes. The output controller's descriptor validation must apply
// the receiver limits up front so an oversized canvas fails at start with the
// product's own error instead of a raw SDK RangeError mid-pipeline.

function descriptorOf(width, height) {
    return Object.freeze({
        width,
        height,
        format: 'rgba8unorm',
        colorSpace: 'srgb',
        alphaMode: 'premultiplied',
        fps: 60
    })
}

async function controllerWithDescriptor(descriptor) {
    const syncModule = await import('../../public/js/syncOutput.js')
    const controller = new syncModule.SyncOutputController({
        renderer: { canvasRenderer: { canvas: { width: 1280, height: 720 } }, pipeline: { backend: 'webgl2' } },
        getCanvas: () => ({ width: 1280, height: 720 }),
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
    controller._getDescriptor = () => descriptor
    return controller
}

test('the output controller refuses frame geometry beyond the v1 receiver limits', async () => {
    for (const [width, height] of [[4097, 720], [1280, 4097]]) {
        const controller = await controllerWithDescriptor(descriptorOf(width, height))
        assert.throws(
            () => controller._readDescriptor(),
            error => error?.message === 'Renderer output dimensions exceed Sync v1 limits',
            `${width}x${height} must fail with the product's v1-limits error`)
    }
})

test('a 4096 by 4096 frame stays within the v1 receiver limits', async () => {
    const controller = await controllerWithDescriptor(descriptorOf(4096, 4096))
    const descriptor = controller._readDescriptor()
    assert.equal(descriptor.width, 4096)
    assert.equal(descriptor.height, 4096)
})
