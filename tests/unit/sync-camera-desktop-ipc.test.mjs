import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// The desktop-shell IPC and shared-memory reader are owned by the scaffold
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
        if (unavailable) skipReason = `scaffold desktop-shell library not readable here (${error.code})`
        else throw error
    }
} else {
    skipReason = 'scaffold desktop-shell checkout not present'
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
