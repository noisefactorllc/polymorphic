import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SyncCameraFrameQueue } from '../../public/js/sync/cameraFrameQueue.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// The desktop-shell IPC and shared-memory reader are owned by a private
// repository (@nf/desktop-shell). These checks run that exact source — not a
// mirror — when the sibling checkout is present, so a desktop contract change
// (frame fields, sequence delivery, concurrent consumers, cleanup) cannot land
// without the product tests noticing.
const shellLib = resolve(root, '../scaffold/apps/desktop-shell/lib/sync-camera-shm.js')

const require = createRequire(import.meta.url)
// Some environments stage sibling checkouts as unreadable stubs, where even
// stat() succeeds but the loader cannot open the file. Only such
// availability failures may fall back to a skip; a loadable-but-broken
// library must still fail the suite.
let mod = null
let skipReason = null
if (existsSync(shellLib)) {
    try {
        mod = require(shellLib)
    } catch (error) {
        const unavailable = (error.code === 'EACCES' || error.code === 'EPERM') ||
            (error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(shellLib))
        if (unavailable) skipReason = `desktop-shell library not readable here (${error.code})`
        else throw error
    }
} else {
    skipReason = 'desktop-shell checkout not present'
}
const { wireSyncCameraIpc, SyncCameraShmReader, SYNC_MAGIC, SYNC_VERSION, FRAME_RING_SLOTS,
    CANVAS_WIDTH, CANVAS_HEIGHT, FRAME_SLOT_BYTES, HEADER_BYTES } = mod || {}

function makeTempRingFile(fs, os, path) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-camera-ipc-test-'))
    const ringPath = path.join(tmpDir, 'SyncCamera.frames')
    const fd = fs.openSync(ringPath, 'w+')
    fs.ftruncateSync(fd, HEADER_BYTES + FRAME_RING_SLOTS * FRAME_SLOT_BYTES)
    const header = Buffer.alloc(HEADER_BYTES)
    header.writeUInt32LE(SYNC_MAGIC, 0)
    header.writeUInt32LE(SYNC_VERSION, 4)
    header.writeUInt32LE(FRAME_RING_SLOTS, 8)
    header.writeUInt32LE(FRAME_SLOT_BYTES, 12)
    header.writeBigUInt64LE(0n, 16) // newest
    header.writeBigUInt64LE(0n, 24) // last_demand_us
    fs.writeSync(fd, header, 0, HEADER_BYTES, 0)
    fs.closeSync(fd)
    return {
        ringPath,
        // Re-creates a removed ring file with its header, as the Sync daemon
        // does when it starts after the shell already looked for the ring.
        recreate() {
            const fd = fs.openSync(ringPath, 'w+')
            const header = Buffer.alloc(HEADER_BYTES)
            header.writeUInt32LE(SYNC_MAGIC, 0)
            header.writeUInt32LE(SYNC_VERSION, 4)
            header.writeUInt32LE(FRAME_RING_SLOTS, 8)
            header.writeUInt32LE(FRAME_SLOT_BYTES, 12)
            header.writeBigUInt64LE(0n, 16) // newest
            header.writeBigUInt64LE(0n, 24) // last_demand_us
            fs.writeSync(fd, header, 0, HEADER_BYTES, 0)
            fs.closeSync(fd)
        },
        // Publishes one complete frame into the ring, mirroring the writer's
        // seqlock: odd sequence while the payload is written, even after.
        // `fill` distinguishes a later overwrite from the original payload.
        writeFrame(fs, sequence, presentationTimeUs, fill = 0xab) {
            const slotIndex = Number(sequence % BigInt(FRAME_RING_SLOTS))
            const slotHeaderOffset = 32 + slotIndex * 32
            const payloadOffset = HEADER_BYTES + slotIndex * FRAME_SLOT_BYTES
            const fd = fs.openSync(ringPath, 'r+')
            const slotHeader = Buffer.alloc(32)
            slotHeader.writeBigUInt64LE(sequence * 2n, 0)
            slotHeader.writeBigUInt64LE(presentationTimeUs, 8)
            slotHeader.writeUInt32LE(CANVAS_WIDTH, 16)
            slotHeader.writeUInt32LE(CANVAS_HEIGHT, 20)
            slotHeader.writeUInt32LE(CANVAS_WIDTH * 4, 24)
            fs.writeSync(fd, slotHeader, 0, 32, slotHeaderOffset)
            fs.writeSync(fd, Buffer.alloc(16, fill), 0, 16, payloadOffset)
            const seqBuf = Buffer.alloc(8)
            seqBuf.writeBigUInt64LE(sequence, 0)
            fs.writeSync(fd, seqBuf, 0, 8, 16)
            fs.closeSync(fd)
        },
        cleanup() {
            try { fs.unlinkSync(ringPath) } catch {}
            try { fs.rmdirSync(tmpDir) } catch {}
        }
    }
}

function fakeIpcMain() {
    const handlers = new Map()
    const listeners = new Map()
    return {
        handle: (channel, fn) => handlers.set(channel, fn),
        on: (channel, fn) => {
            if (!listeners.has(channel)) listeners.set(channel, [])
            listeners.get(channel).push(fn)
        },
        removeListener: (channel, fn) => {
            const all = listeners.get(channel) || []
            const index = all.indexOf(fn)
            if (index >= 0) all.splice(index, 1)
        },
        listenerCount: (channel) => (listeners.get(channel) || []).length,
        emit: (channel, event) => {
            for (const fn of [...(listeners.get(channel) || [])]) fn(event)
        },
        isAvailable: () => handlers.get('sync-camera:is-available')()
    }
}

function fakeWebContents() {
    const destroyedCallbacks = []
    const state = { destroyed: false }
    const contents = {
        sent: [],
        isDestroyed: () => state.destroyed,
        send: (channel, frame) => contents.sent.push({ channel, frame }),
        once: (event, callback) => {
            if (event === 'destroyed') destroyedCallbacks.push(callback)
        },
        removeListener: () => {},
        destroy: () => {
            state.destroyed = true
            for (const callback of destroyedCallbacks) callback()
        }
    }
    return contents
}

test('desktop-shell IPC forwards Sync camera frames by sequence to concurrent consumers and cleans up',
    { skip: skipReason || false }, async () => {
    if (!mod) return // Skipped through the option above with its reason.
    // Bind to the implementation source: the loaded file must define the
    // reader and the IPC wiring itself, not re-export them from a stub
    // mirror. These checks read content properties a stub cannot satisfy.
    const loadedSource = readFileSync(shellLib, 'utf8')
    assert.match(loadedSource, /\bclass SyncCameraShmReader\b/,
        'the loaded desktop-shell file must define the ring reader')
    assert.match(loadedSource, /\bfunction wireSyncCameraIpc\b/,
        'the loaded desktop-shell file must define the IPC wiring')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const fixture = makeTempRingFile(fs, os, path)
    let reader = null
    try {
        const ipc = fakeIpcMain()
        reader = wireSyncCameraIpc({
            ipcMain: ipc,
            reader: new SyncCameraShmReader({ ringPath: fixture.ringPath })
        })
        assert.equal(ipc.isAvailable(), true)

        // Two renderer processes subscribe through the one shared desktop session.
        const windowA = fakeWebContents()
        const windowB = fakeWebContents()
        ipc.emit('sync-camera:start', { sender: windowA })
        ipc.emit('sync-camera:start', { sender: windowB })
        assert.equal(reader.active, true)
        assert.equal(reader.subscribers.size, 2)

        const poll = () => reader._poll()
        fixture.writeFrame(fs, 1n, 1000n)
        poll()
        fixture.writeFrame(fs, 2n, 2000n)
        poll()
        for (const window of [windowA, windowB]) {
            assert.equal(window.sent.length, 2)
            assert.deepEqual(
                window.sent.map(({ frame }) => frame.sequence), [1, 2])
            assert.deepEqual(
                window.sent.map(({ frame }) => frame.presentationTimeUs), [1000, 2000])
            const frame = window.sent[0].frame
            assert.equal(frame.width, CANVAS_WIDTH)
            assert.equal(frame.height, CANVAS_HEIGHT)
            // The reader reuses its slot buffers, so the shell delivers one
            // stable copy of the slot bytes per frame — never the buffer it
            // will overwrite on a later poll — and the product copies the
            // delivered bytes into a WebCodecs VideoFrame before queueing.
            const slot = reader.slotBuffers[Number(1n % BigInt(FRAME_RING_SLOTS))]
            assert.notEqual(frame.buffer, slot)
            assert.equal(frame.buffer.equals(slot.subarray(0, frame.buffer.length)), true)
            assert.equal(window.sent[0].channel, 'sync-camera:frame')
        }

        // Deferred consumers must observe their delivered bytes unchanged
        // across a full wrap of the three-slot ring: frame 1 lives in slot
        // 1 until frame 4 rewrites it, frame 2 lives in slot 2 until frame 5
        // rewrites it, and frame 3 passes through slot 0. A shell that
        // delivered a reused slot buffer — or handed one subscriber's copy
        // to both — would surface the newer 0xcd payload here instead of
        // each window's own stable copy.
        for (let sequence = 3n; sequence <= 5n; sequence++) {
            fixture.writeFrame(fs, sequence, sequence * 1000n, 0xcd)
            poll()
        }
        // The overwrite actually happened: all three slots now begin with
        // the 0xcd payload, and the wrap delivered frames 3–5 to both
        // windows by sequence.
        for (const slot of reader.slotBuffers) {
            assert.equal(slot.subarray(0, 16).equals(Buffer.alloc(16, 0xcd)), true)
        }
        for (const window of [windowA, windowB]) {
            assert.deepEqual(window.sent.slice(0, 5).map(({ frame }) => frame.sequence), [1, 2, 3, 4, 5])
            for (const frame of window.sent.slice(0, 2).map(({ frame }) => frame)) {
                assert.equal(frame.buffer.subarray(0, 16).equals(Buffer.alloc(16, 0xab)), true,
                    `frame ${frame.sequence} must keep its own bytes after its ring slot is reused`)
                assert.equal(frame.buffer.includes(0xcd), false)
            }
        }

        // One window going away must not disturb the other consumer.
        windowA.destroy()
        assert.equal(reader.subscribers.size, 1)
        fixture.writeFrame(fs, 6n, 6000n)
        poll()
        assert.equal(windowA.sent.length, 5)
        assert.ok(windowB.sent.some(({ frame }) => frame.sequence === 6))

        // The last consumer unsubscribing stops the shared reader entirely.
        ipc.emit('sync-camera:stop', { sender: windowB })
        assert.equal(reader.active, false)
        assert.equal(reader.fd, null)
        const deliveredAfterStop = windowB.sent.length
        fixture.writeFrame(fs, 7n, 7000n)
        poll()
        assert.equal(windowB.sent.length, deliveredAfterStop)

        // A returning consumer restarts the shared reader from a fresh watermark.
        ipc.emit('sync-camera:start', { sender: windowB })
        assert.equal(reader.active, true)
        fixture.writeFrame(fs, 8n, 8000n)
        poll()
        assert.ok(windowB.sent.some(({ frame }) => frame.sequence === 8))
        ipc.emit('sync-camera:stop', { sender: windowB })
        assert.equal(reader.active, false)
        assert.equal(reader.fd, null)
    } finally {
        if (reader) {
            try { reader.subscribers.clear() } catch {}
            try { reader.stop() } catch {}
        }
        fixture.cleanup()
    }
})

test('a failed desktop-shell ring start leaves no subscriber for a later successful start',
    { skip: skipReason || false }, () => {
    if (!mod) return
    const fs = require('node:fs')
    const fixture = makeTempRingFile(fs, require('node:os'), require('node:path'))
    let reader = null
    try {
        // No ring file yet: the Sync daemon has not created it, so the shell's
        // start must report unavailable. It must also register nothing — a
        // subscriber added before the ring opens would stay registered, and a
        // later successful start could then never stop the shared reader once
        // the real subscriber leaves.
        fs.unlinkSync(fixture.ringPath)
        const ipc = fakeIpcMain()
        reader = wireSyncCameraIpc({
            ipcMain: ipc,
            reader: new SyncCameraShmReader({ ringPath: fixture.ringPath })
        })
        const window = fakeWebContents()
        ipc.emit('sync-camera:start', { sender: window })
        assert.equal(reader.subscribers.size, 0)
        assert.equal(reader.active, false)

        // The daemon comes up and creates the ring; the renderer retries.
        fixture.recreate()
        ipc.emit('sync-camera:start', { sender: window })
        assert.equal(reader.active, true)
        assert.equal(reader.subscribers.size, 1)
        fixture.writeFrame(fs, 1n, 1000n)
        reader._poll()
        assert.equal(window.sent.length, 1)
        assert.equal(window.sent[0].frame.sequence, 1)

        // The one real subscriber leaving stops the shared reader entirely;
        // a stale failed-start subscriber would keep it alive here.
        ipc.emit('sync-camera:stop', { sender: window })
        assert.equal(reader.active, false)
        assert.equal(reader.fd, null)
        assert.equal(reader.subscribers.size, 0)
    } finally {
        if (reader) {
            try { reader.subscribers.clear() } catch {}
            try { reader.stop() } catch {}
        }
        fixture.cleanup()
    }
})

test('a destroyed renderer drops the shell stop listener without disturbing the surviving consumer',
    { skip: skipReason || false }, () => {
    if (!mod) return
    const fs = require('node:fs')
    const fixture = makeTempRingFile(fs, require('node:os'), require('node:path'))
    let reader = null
    try {
        const ipc = fakeIpcMain()
        reader = wireSyncCameraIpc({
            ipcMain: ipc,
            reader: new SyncCameraShmReader({ ringPath: fixture.ringPath })
        })
        const windowA = fakeWebContents()
        const windowB = fakeWebContents()
        ipc.emit('sync-camera:start', { sender: windowA })
        ipc.emit('sync-camera:start', { sender: windowB })
        assert.equal(reader.subscribers.size, 2)
        assert.equal(ipc.listenerCount('sync-camera:stop'), 2)

        // The shell keeps ipcMain listeners alive for the whole process, and
        // the desktop app can outlive every window, so a renderer that dies
        // without an explicit stop must drop its own stop listener — a stale
        // listener pinned to a dead webContents would leak on every window
        // cycle.
        windowA.destroy()
        assert.equal(ipc.listenerCount('sync-camera:stop'), 1)
        assert.equal(reader.subscribers.size, 1)

        // A further explicit stop from the dead renderer must not disturb the
        // surviving consumer's subscription.
        ipc.emit('sync-camera:stop', { sender: windowA })
        assert.equal(reader.subscribers.size, 1)
        assert.equal(reader.active, true)
        fixture.writeFrame(fs, 1n, 1000n)
        reader._poll()
        assert.equal(windowA.sent.length, 0)
        assert.equal(windowB.sent.length, 1)
        assert.equal(windowB.sent[0].frame.sequence, 1)

        // The surviving consumer's explicit stop removes the last listener
        // and stops the shared reader.
        ipc.emit('sync-camera:stop', { sender: windowB })
        assert.equal(ipc.listenerCount('sync-camera:stop'), 0)
        assert.equal(reader.active, false)
        assert.equal(reader.fd, null)
    } finally {
        if (reader) {
            try { reader.subscribers.clear() } catch {}
            try { reader.stop() } catch {}
        }
        fixture.cleanup()
    }
})

// The product side of the shell's replaced-ring contract. Sync removes its
// camera ring when its camera closes and creates a new file when the camera
// starts again. A new ring counts from one again, and this product drops a
// frame whose sequence is not above the last one it saw, so the shell's
// delivered sequence must keep rising across a replacement — a restart at one
// would fail this product's camera on its retained watermark.
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function installBrowserGlobals(t) {
    const saved = new Map(['MediaStreamTrackProcessor', 'createImageBitmap', 'VideoFrame']
        .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    // The native shared-memory path must never reach for the browser fallback.
    globalThis.MediaStreamTrackProcessor = class {
        constructor() { throw new Error('the browser fallback must not start while the native path runs') }
    }
    globalThis.createImageBitmap = () => {
        throw new Error('the native path never converts frames through createImageBitmap')
    }
    globalThis.VideoFrame = class MockVideoFrame {
        constructor(buffer, options) {
            this.buffer = buffer
            this.timestamp = options.timestamp
            this.width = options.codedWidth
            this.height = options.codedHeight
            this.closes = 0
        }
        close() { this.closes++ }
    }
    t.after(() => {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor)
            else delete globalThis[key]
        }
    })
}

function makeTrack() {
    return Object.assign(new EventTarget(), { kind: 'video', label: 'Sync Camera', readyState: 'live' })
}

// Subscribes the queue through the reader's own subscriber contract, the one
// the shell's IPC wiring drives: start(onFrame) registers, stop(onFrame)
// leaves, and the last subscriber leaving stops the shared reader.
function subscribeThroughReader(reader, delivered) {
    return callback => {
        const onFrame = frame => {
            delivered.push(frame.sequence)
            callback(frame)
        }
        assert.equal(reader.start(onFrame), true)
        return () => reader.stop(onFrame)
    }
}

function startQueue(track, reader) {
    const uploads = [], errors = [], delivered = []
    const queue = new SyncCameraFrameQueue(track, {
        isCurrent: () => true,
        upload: bitmap => {
            uploads.push(bitmap)
            return { width: bitmap.width, height: bitmap.height }
        },
        onError: error => errors.push(error),
        useNativeShm: true,
        shmSubscriber: subscribeThroughReader(reader, delivered),
    })
    return { queue, uploads, errors, delivered }
}

test('a shared reader that follows a replaced ring keeps one product consumer uploading',
    { skip: skipReason || false }, async t => {
    if (!mod) return // Skipped through the option above with its reason.
    // The reader checks its ring four times a second against Date.now(); mock
    // timers make those checks and its poll tails deterministic. The queue's
    // 2000 ms startup fallback never comes due: the ticks stay below it.
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
    installBrowserGlobals(t)
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const fixture = makeTempRingFile(fs, os, path)
    const reader = new SyncCameraShmReader({ ringPath: fixture.ringPath })
    let queue = null
    try {
        const { queue: owned, uploads, errors, delivered } = startQueue(makeTrack(), reader)
        queue = owned

        fixture.writeFrame(fs, 1n, 1000n)
        t.mock.timers.tick(300)
        reader._poll()
        fixture.writeFrame(fs, 2n, 2000n)
        t.mock.timers.tick(300)
        reader._poll()
        queue.consume()
        assert.equal(uploads.length, 1)
        assert.deepEqual(delivered, [1, 2])

        // Sync's camera closed: the ring file is gone. The reader must let go
        // of the removed ring, keep its subscriber, and raise no product
        // error — a missing ring is a restart, not a camera failure.
        fs.unlinkSync(fixture.ringPath)
        t.mock.timers.tick(300)
        reader._poll()
        assert.equal(reader.fd, null)
        assert.equal(queue.active, true, 'a replaced ring is not a camera error')

        // Sync's camera starts again: a new ring counts from one again, and
        // the shell delivers its frame above the watermark the product
        // already holds (2) by continuing the delivered sequence.
        fixture.recreate()
        fixture.writeFrame(fs, 1n, 3000n)
        t.mock.timers.tick(300)
        reader._poll()
        assert.deepEqual(delivered, [1, 2, 3])
        // The FIFO first releases the frame the old ring delivered last, then
        // the replacement ring's frame under its continued sequence.
        queue.consume()
        assert.equal(uploads.length, 2)
        assert.equal(uploads[1].timestamp, 2000)
        queue.consume()
        assert.equal(uploads.length, 3)
        assert.equal(uploads[2].timestamp, 3000)
        assert.deepEqual(errors, [])
        assert.equal(queue.active, true)
    } finally {
        if (queue) { try { await queue.stop() } catch {} }
        if (reader) {
            try { reader.subscribers.clear() } catch {}
            try { reader.stop() } catch {}
        }
        fixture.cleanup()
    }
})

test('a product restart across a replaced ring continues above the retained watermark',
    { skip: skipReason || false }, async t => {
    if (!mod) return
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2_000_000 })
    installBrowserGlobals(t)
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const fixture = makeTempRingFile(fs, os, path)
    const reader = new SyncCameraShmReader({ ringPath: fixture.ringPath })
    let first = null, second = null
    try {
        const track = makeTrack()
        first = startQueue(track, reader)
        fixture.writeFrame(fs, 1n, 1000n)
        t.mock.timers.tick(300)
        reader._poll()
        fixture.writeFrame(fs, 2n, 2000n)
        t.mock.timers.tick(300)
        reader._poll()
        first.queue.consume()
        assert.equal(first.uploads.length, 1)
        assert.deepEqual(first.delivered, [1, 2])

        // The deck's source ends: the queue unsubscribes, and the last
        // consumer leaving stops the shared reader entirely.
        await first.queue.stop()
        assert.equal(reader.active, false)
        assert.equal(reader.fd, null)

        // Sync's camera restarts with a fresh ring while no one reads it.
        fixture.recreate()
        fixture.writeFrame(fs, 1n, 3000n)

        // The same track's queue returns. The track keeps its earlier
        // watermark (sequence 2, timestamp 2000), so the restarted queue
        // accepts only a sequence above 2 — the shell's start-time rebase
        // delivers the new ring's frame 1 as sequence 3.
        second = startQueue(track, reader)
        t.mock.timers.tick(300)
        reader._poll()
        assert.deepEqual(second.delivered, [3])
        // The queue holds buffered frames before its first upload, so the new
        // ring's next frame arrives too — still above the watermark.
        fixture.writeFrame(fs, 2n, 4000n)
        t.mock.timers.tick(300)
        reader._poll()
        assert.deepEqual(second.delivered, [3, 4])
        second.queue.consume()
        assert.equal(second.uploads.length, 1)
        assert.equal(second.uploads[0].timestamp, 3000)
        assert.deepEqual(first.errors, [])
        assert.deepEqual(second.errors, [])
        assert.equal(second.queue.active, true)
    } finally {
        for (const owned of [first, second]) {
            if (owned) { try { await owned.queue.stop() } catch {} }
        }
        if (reader) {
            try { reader.subscribers.clear() } catch {}
            try { reader.stop() } catch {}
        }
        fixture.cleanup()
    }
})
