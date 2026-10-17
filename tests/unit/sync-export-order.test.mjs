import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SyncOutputController } from '../../public/js/syncOutput.js'
import { SyncFrameSink, decodeFrameHeaderV1 } from '../../public/js/sync/bundle.js'

const descriptor = { width: 2, height: 2, fps: 60, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'premultiplied' }
const frame = () => ({ width: 2, height: 2, rowStride: 8, data: new Uint8Array(16).fill(255) })
async function fixture() {
    const records = new Map(), writes = []
    const queue = {
        available: true, configure() {}, poll() {}, close() {},
        enqueue(texture, timestamp, callback, context) {
            records.set(context, { timestamp, callback, context }); return true
        }
    }
    const canvas = { width: 2, height: 2 }
    let sender, attached, resolveClosed
    const socket = { readyState: 1, bufferedAmount: 0, send(bytes) { writes.push(bytes.slice(0)) }, close() { this.readyState = 3; resolveClosed?.() } }
    const client = {
        async pair() { return { protocolVersion: 1, token: 'a'.repeat(64) } },
        async connect() { return { protocolVersion: 1, version: '0.2.19', capabilities: { send: true, providers: [{ id: 'syphon', direction: 'send', available: true, selected: true }] } } },
        async createSender(name, options) {
            sender = new SyncFrameSink({ socket, ...options })
            sender.closed = new Promise(resolve => { resolveClosed = resolve })
            return sender
        }, close() {}
    }
    const controller = new SyncOutputController({
        renderer: { pipeline: {}, createFrameExportQueue: () => queue, addSink(sink) { attached = sink; sink.configure(descriptor); return () => sink.close() } },
        getCanvas: () => canvas, connectionProvider: { createClient: () => client },
        setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {}
    })
    await controller.connect(); await controller.start('Ordered output')
    return { controller, sender, attached, records, writes, queue, socket,
        complete(sequence, value = frame()) { const r = records.get(sequence); r.callback(value, r.timestamp, r.context) } }
}

test('a valid late GPU completion is dropped without counting a failed Sync frame', async t => {
    const f = await fixture(); t.after(() => f.controller.dispose())
    for (let i = 1; i <= 4; i++) assert.equal(f.attached.submit(i, i * 16), true)
    for (const sequence of [1, 3, 4, 2]) f.complete(sequence)
    assert.deepEqual(f.writes.map(bytes => decodeFrameHeaderV1(bytes).sequence), [1, 3, 4])
    assert.equal(f.sender.stats.failed, 0)
    assert.equal(f.sender.stats.accepted, 4)
    assert.equal(f.sender.stats.sent, 3)
    await f.controller.stop()
})

for (const [name, mutate] of [
    ['wrong dimensions', value => ({ ...value, width: 3 })],
    ['short data', value => ({ ...value, data: new Uint8Array(15) })],
    ['invalid stride', value => ({ ...value, rowStride: 7 })],
    ['non-byte data', value => ({ ...value, data: new Array(16) })]
]) {
    test(`malformed stale completion remains a failed frame: ${name}`, async t => {
        const f = await fixture(); t.after(() => f.controller.dispose())
        f.attached.submit(1, 16); f.attached.submit(2, 32)
        f.complete(2); f.complete(1, mutate(frame()))
        assert.equal(f.sender.stats.failed, 1)
        assert.equal(f.writes.length, 1)
    })
}

test('a duplicate completion is never hidden as a stale first completion', async t => {
    const f = await fixture(); t.after(() => f.controller.dispose())
    f.attached.submit(1, 16); f.attached.submit(2, 32)
    f.complete(2); f.complete(1); f.complete(1)
    assert.equal(f.sender.stats.failed, 1)
})

for (const [name, invalidate] of [
    ['reconfigure', f => f.attached.configure(descriptor)],
    ['close', f => f.sender.close()]
]) {
    test(`completion after ${name} remains a failure`, async t => {
        const f = await fixture(); t.after(() => f.controller.dispose())
        f.attached.submit(1, 16); f.attached.submit(2, 32)
        f.complete(2); invalidate(f); f.complete(1)
        assert.equal(f.sender.stats.failed, 1)
    })
}

test('a rejected enqueue cannot gain permission to drop its later callback', async t => {
    const f = await fixture(); t.after(() => f.controller.dispose())
    const enqueue = f.queue.enqueue
    f.queue.enqueue = (...args) => { enqueue(...args); return false }
    assert.equal(f.attached.submit(1, 16), false)
    f.queue.enqueue = enqueue
    assert.equal(f.attached.submit(2, 32), true)
    f.complete(2); f.complete(1)
    assert.equal(f.sender.stats.failed, 2)
})

for (const [name, timestamp, context] of [
    ['changed timestamp', 99, 1], ['invalid timestamp', NaN, 1], ['wrong context', 16, 99]
]) {
    test(`invalid callback ownership remains visible: ${name}`, async t => {
        const f = await fixture(); t.after(() => f.controller.dispose())
        f.attached.submit(1, 16); f.attached.submit(2, 32); f.complete(2)
        f.records.get(1).callback(frame(), timestamp, context)
        assert.equal(f.sender.stats.failed, 1)
    })
}
