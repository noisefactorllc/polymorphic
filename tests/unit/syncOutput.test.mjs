import assert from 'node:assert/strict'
import { test } from 'node:test'

function deferred() {
    let resolve
    const promise = new Promise(resolvePromise => { resolve = resolvePromise })
    return { promise, resolve }
}

function syncCapabilities() {
    return {
        send: true,
        receive: false,
        providers: [
            { id: 'syphon', direction: 'send', available: true, selected: true }
        ]
    }
}

test('Polymorphic connects its renderer to a bounded Sync target sink', async () => {
    const syncModule = await import('../../public/js/syncOutput.js').catch(() => null)
    assert.ok(syncModule, 'Sync output target module must exist')

    const calls = []
    const token = 'f'.repeat(64)
    const senderClosed = deferred()
    const queue = { close() {} }
    const sender = {
        stats: {
            accepted: 2,
            droppedBusy: 0,
            droppedBackpressure: 0,
            sent: 2,
            failed: 0
        },
        closed: senderClosed.promise,
        configure(descriptor) { calls.push(['configure', descriptor]) },
        submit(texture, timestamp) { calls.push(['submit', texture, timestamp]); return true },
        close() { senderClosed.resolve() }
    }
    const clients = [
        {
            async pair(name) {
                calls.push(['pair', name])
                return { protocolVersion: 1, token }
            },
            close() { calls.push('pairing close') }
        },
        {
            async connect() {
                calls.push('connect')
                return {
                    type: 'welcome',
                    protocolVersion: 1,
                    version: '0.2.19',
                    instanceId: 'sync-test',
                    capabilities: syncCapabilities()
                }
            },
            async createSender(name, options) {
                calls.push(['createSender', name, options])
                return sender
            },
            close() { calls.push('client close') }
        }
    ]
    const connectionProvider = {
        createClient(options) {
            calls.push(['createClient', options])
            return clients.shift()
        }
    }
    let attachedSink
    const renderer = {
        pipeline: { backend: 'webgl2' },
        createFrameExportQueue(options) {
            calls.push(['queue', options])
            return queue
        },
        addSink(sink) {
            attachedSink = sink
            calls.push(['addSink', sink])
            return () => sink.close()
        }
    }
    const canvas = { width: 1280, height: 720 }
    const clock = { timeOrigin: 1_700_000_000_000 }
    const controller = new syncModule.SyncOutputController({
        renderer,
        getCanvas: () => canvas,
        connectionProvider,
        clock,
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: () => 2,
        clearTimeout: () => {}
    })

    await controller.connect()
    await controller.start('Polymorphic')

    assert.deepEqual(calls.slice(0, 5), [
        ['createClient', {}],
        ['pair', 'Polymorphic'],
        'pairing close',
        ['createClient', { token }],
        'connect'
    ])
    assert.deepEqual(calls[5], ['queue', { slots: 3 }])
    assert.equal(calls[6][0], 'createSender')
    assert.equal(calls[6][1], 'Polymorphic')
    assert.deepEqual(calls[6][2], {
        exportQueue: queue,
        maxBufferedFrames: 1,
        clock
    })
    assert.equal(calls[7][0], 'addSink')
    assert.equal(attachedSink, calls[7][1])

    const descriptor = {
        width: 1280,
        height: 720,
        format: 'rgba8unorm',
        colorSpace: 'srgb',
        alphaMode: 'premultiplied',
        fps: 60
    }
    attachedSink.configure(descriptor)
    assert.deepEqual(calls[8], ['configure', descriptor])
    assert.equal(controller.state.status, 'sending')
    assert.deepEqual(controller.state.providerIds, ['syphon'])
    assert.equal(controller.state.senderName, 'Polymorphic')
    assert.equal(controller.state.width, 1280)
    assert.equal(controller.state.height, 720)
    assert.equal(controller.state.fps, 60)
    assert.deepEqual(controller.state.stats, sender.stats)
    assert.notEqual(controller.state.stats, sender.stats)
})
