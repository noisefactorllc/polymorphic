import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RgbaExportQueue } from '../../public/js/sync/bundle.js'

const DESCRIPTOR = Object.freeze({
    width: 2, height: 3, format: 'rgba8unorm',
    colorSpace: 'srgb', alphaMode: 'premultiplied', fps: 60,
})
const OUTPUT_BYTES = DESCRIPTOR.width * DESCRIPTOR.height * 4

// The vendored output snapshot must admit a contiguous RGBA source with one
// write per frame. A source whose row stride equals width * 4 is one block;
// a per-row admission pays height subarray allocations and set() dispatches
// per frame, which a 1080p60 stream pays 1080 times a second (sync c1e58d4).
function admitWhileCountingCopies(queue, source) {
    const sourceBuffer = source.data.buffer
    let subarrayCalls = 0
    let setCalls = 0
    const subarray = Uint8Array.prototype.subarray
    const set = Uint8Array.prototype.set
    Uint8Array.prototype.subarray = function (...args) {
        if (this.buffer === sourceBuffer) subarrayCalls += 1
        return subarray.apply(this, args)
    }
    Uint8Array.prototype.set = function (...args) {
        if (this.length === OUTPUT_BYTES) setCalls += 1
        return set.apply(this, args)
    }
    let frame
    try {
        assert.equal(queue.enqueue(source, 1, (value) => { frame = value }, 1), true)
    } finally {
        Uint8Array.prototype.subarray = subarray
        Uint8Array.prototype.set = set
    }
    return { frame, subarrayCalls, setCalls }
}

test('the vendored RGBA admission copies a contiguous source with one write per frame', () => {
    const queue = new RgbaExportQueue()
    queue.configure(DESCRIPTOR)
    // Distinct pixels prove every byte of the contiguous block lands in the
    // output, unlike a padded source whose trailing bytes are stripped.
    const source = new Uint8Array(OUTPUT_BYTES)
    for (let pixel = 0; pixel < DESCRIPTOR.width * DESCRIPTOR.height; pixel += 1) {
        source.set([pixel, pixel * 2, pixel * 3, 255], pixel * 4)
    }
    const expected = [...source]
    const contiguous = {
        width: DESCRIPTOR.width, height: DESCRIPTOR.height,
        rowStride: DESCRIPTOR.width * 4, data: source,
    }
    const { frame, subarrayCalls, setCalls } = admitWhileCountingCopies(queue, contiguous)
    assert.equal(subarrayCalls, 1, 'admission must slice the contiguous source once')
    assert.equal(setCalls, 1, 'admission must write the contiguous source with one set()')
    assert.equal(frame.rowStride, DESCRIPTOR.width * 4)
    assert.deepEqual([...frame.data], expected)
    source.fill(7)
    assert.deepEqual([...frame.data], expected, 'admission copied the contiguous block')
})

test('the vendored RGBA admission keeps the per-row copy for padded sources', () => {
    const queue = new RgbaExportQueue()
    queue.configure(DESCRIPTOR)
    const rowStride = DESCRIPTOR.width * 4 + 8
    const source = new Uint8Array((DESCRIPTOR.height - 1) * rowStride + DESCRIPTOR.width * 4)
    for (let row = 0; row < DESCRIPTOR.height; row += 1) {
        source.set([row, row * 2, row * 3, 255, 200, 210, 220, 255], row * rowStride)
        source.fill(9, row * rowStride + DESCRIPTOR.width * 4, row * rowStride + rowStride)
    }
    const expected = []
    for (let row = 0; row < DESCRIPTOR.height; row += 1) {
        expected.push(row, row * 2, row * 3, 255, 200, 210, 220, 255)
    }
    const padded = { width: DESCRIPTOR.width, height: DESCRIPTOR.height, rowStride, data: source }
    const { frame, subarrayCalls, setCalls } = admitWhileCountingCopies(queue, padded)
    assert.equal(subarrayCalls, DESCRIPTOR.height, 'padded sources keep the row loop')
    assert.equal(frame.rowStride, DESCRIPTOR.width * 4)
    assert.deepEqual([...frame.data], expected, 'padded admission copies only active bytes')
    assert.ok(!frame.data.includes(9), 'padded admission strips the trailing bytes')
    source.fill(7)
    assert.equal(frame.data[0], 0, 'padded admission copied the source bytes')
})
