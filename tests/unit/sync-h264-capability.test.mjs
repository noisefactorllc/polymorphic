import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SyncH264CanvasSender } from '../../public/js/syncH264CanvasSender.js'

const cases = [
    [640, 480, 60, '29'], [1280, 720, 60, '29'],
    [1920, 1080, 30, '29'], [1920, 1080, 60, '2a'],
    [1080, 1920, 60, '2a'], [2560, 1440, 30, '32'],
    [2560, 1440, 60, '33'], [3840, 2160, 60, '34'],
    [2160, 3840, 60, '34'], [4096, 4096, 60, '3c'],
    [7680, 4320, 60, '3d'], [7680, 4320, 120, '3e']
]
for (const [width, height, fps, level] of cases) {
    test(`H.264 request covers ${width}x${height} at ${fps} FPS and 50 Mbps`, async t => {
        const original = globalThis.VideoEncoder
        t.after(() => { globalThis.VideoEncoder = original })
        let requested
        globalThis.VideoEncoder = class {
            static async isConfigSupported(config) { requested = config; return { supported: false } }
        }
        await assert.rejects(SyncH264CanvasSender.create({
            client: { createH264StreamSender() { assert.fail('unsupported format must not open transport') } },
            name: 'Capability check', canvas: { width, height }, descriptor: { width, height, fps }
        }), { code: 'SYNC_CAPABILITY' })
        assert.equal(requested.codec, 'avc1.6400' + level)
        assert.equal(requested.bitrate, 50_000_000)
        assert.equal(requested.framerate, fps)
        assert.deepEqual([requested.width, requested.height], [width, height])
    })
}

test('H.264 rejects a frame axis beyond every supported level before probing hardware', async t => {
    const original = globalThis.VideoEncoder
    t.after(() => { globalThis.VideoEncoder = original })
    let probes = 0
    globalThis.VideoEncoder = class { static async isConfigSupported() { probes++; return { supported: false } } }
    await assert.rejects(SyncH264CanvasSender.create({
        client: { createH264StreamSender() { assert.fail('invalid geometry must not open transport') } },
        name: 'Axis check', canvas: { width: 20000, height: 16 },
        descriptor: { width: 20000, height: 16, fps: 60 }
    }), { code: 'SYNC_CAPABILITY' })
    assert.equal(probes, 0)
})
