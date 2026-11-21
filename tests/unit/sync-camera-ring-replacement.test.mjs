import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SyncCameraFrameQueue } from '../../public/js/sync/cameraFrameQueue.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// The desktop-shell shared-memory reader is owned by the shared desktop shell
// repository. These checks run that exact source — not a mirror — when the
// sibling checkout is present, so the shell's delivered-sequence contract for
// a replaced ring cannot drift without this product's tests noticing.
const shellLib = resolve(root, '../scaffold/apps/desktop-shell/lib/sync-camera-shm.js')

const require = createRequire(import.meta.url)
// Only an availability failure may fall back to a skip; a loadable-but-broken
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
const { SyncCameraShmReader, SYNC_MAGIC, SYNC_VERSION, FRAME_RING_SLOTS,
    CANVAS_WIDTH, CANVAS_HEIGHT, FRAME_SLOT_BYTES, HEADER_BYTES } = mod || {}

// A ring file with its header, plus the writer-shaped helpers the checks need.
function makeRingFixture(fs, os, path) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-camera-ring-test-'))
    const ringPath = path.join(tmpDir, 'SyncCamera.frames')
    const writeHeader = fd => {
        const header = Buffer.alloc(HEADER_BYTES)
        header.writeUInt32LE(SYNC_MAGIC, 0)
        header.writeUInt32LE(SYNC_VERSION, 4)
        header.writeUInt32LE(FRAME_RING_SLOTS, 8)
        header.writeUInt32LE(FRAME_SLOT_BYTES, 12)
        header.writeBigUInt64LE(0n, 16) // newest
        header.writeBigUInt64LE(0n, 24) // last_demand_us
        fs.writeSync(fd, header, 0, HEADER_BYTES, 0)
    }
    const fd = fs.openSync(ringPath, 'w+')
    fs.ftruncateSync(fd, HEADER_BYTES + FRAME_RING_SLOTS * FRAME_SLOT_BYTES)
    writeHeader(fd)
    fs.closeSync(fd)
    return {
        ringPath,
        // Re-creates a removed ring file with its header, as the Sync daemon
        // does when its camera starts again.
        recreate() {
            const fd = fs.openSync(ringPath, 'w+')
            writeHeader(fd)
            fs.closeSync(fd)
        },
        // Publishes one complete frame, mirroring the writer's seqlock.
        writeFrame(fs, sequence, presentationTimeUs) {
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
            fs.writeSync(fd, Buffer.alloc(16, 0xab), 0, 16, payloadOffset)
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

// Subscribes the queue through the shell reader's own subscriber contract, the
// one the shell's IPC wiring drives: start(onFrame) registers, stop(onFrame)
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

const poll = reader => reader._poll()

// Sync removes its camera ring when its camera closes and creates a new file
// when the camera starts again. A new ring counts from one again, and this
// product drops a frame whose sequence is not above the last one it saw, so
// the old shell delivered a restarting sequence here and the product failed
// the camera on it. The shell now keeps the delivered sequence rising across
// a replacement; these checks bind the product to that contract at the exact
// reader source.
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
    const fixture = makeRingFixture(fs, os, path)
    const reader = new SyncCameraShmReader({ ringPath: fixture.ringPath })
    let queue = null
    try {
        const { queue: owned, uploads, errors, delivered } = startQueue(makeTrack(), reader)
        queue = owned

        fixture.writeFrame(fs, 1n, 1000n)
        t.mock.timers.tick(300)
        poll(reader)
        fixture.writeFrame(fs, 2n, 2000n)
        t.mock.timers.tick(300)
        poll(reader)
        queue.consume()
        assert.equal(uploads.length, 1)
        assert.deepEqual(delivered, [1, 2])

        // Sync's camera closed: the ring file is gone. The reader must let go
        // of the removed ring, keep its subscriber, and raise no product
        // error — a missing ring is a restart, not a camera failure.
        fs.unlinkSync(fixture.ringPath)
        t.mock.timers.tick(300)
        poll(reader)
        assert.equal(reader.fd, null)
        assert.equal(queue.active, true, 'a replaced ring is not a camera error')

        // Sync's camera starts again: a new ring counts from one again, and
        // the shell delivers its frame above the watermark the product
        // already holds (2) by continuing the delivered sequence.
        fixture.recreate()
        fixture.writeFrame(fs, 1n, 3000n)
        t.mock.timers.tick(300)
        poll(reader)
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
        try { reader.subscribers.clear() } catch {}
        try { reader.stop() } catch {}
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
    const fixture = makeRingFixture(fs, os, path)
    const reader = new SyncCameraShmReader({ ringPath: fixture.ringPath })
    let first = null, second = null
    try {
        const track = makeTrack()
        first = startQueue(track, reader)
        fixture.writeFrame(fs, 1n, 1000n)
        t.mock.timers.tick(300)
        poll(reader)
        fixture.writeFrame(fs, 2n, 2000n)
        t.mock.timers.tick(300)
        poll(reader)
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
        poll(reader)
        assert.deepEqual(second.delivered, [3])
        // The queue buffers two frames before its first upload, so the new
        // ring's second frame arrives too — still above the watermark.
        fixture.writeFrame(fs, 2n, 4000n)
        t.mock.timers.tick(300)
        poll(reader)
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
        try { reader.subscribers.clear() } catch {}
        try { reader.stop() } catch {}
        fixture.cleanup()
    }
})
