import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebGPUExportQueue } from '../../public/js/sync/bundle.js'

// The vendored output snapshot must copy the mapped WebGPU readback in one
// write when bytesPerRow equals the packed stride, and swap BGRA channels
// without a per-pixel pair allocation. A per-row copy and a destructuring
// swap allocate and dispatch on the hot poll path of a 1080p60 stream
// (sync 7b35db4).
const DESCRIPTOR = Object.freeze({ width: 1, height: 2, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 })
const TOP_DOWN = Object.freeze([255, 0, 0, 255, 0, 0, 255, 128])

function gpuFixture({ width = 1, height = 2, pixels = new Uint8Array([0, 0, 255, 255, 255, 0, 0, 128]) } = {}) {
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256
    const buffers = []
    const device = {
        limits: { maxBufferSize: 1024 * 1024 },
        lost: new Promise(() => {}),
        pushErrorScope() {}, popErrorScope() { return Promise.resolve(null) },
        createBuffer({ size, usage }) {
            assert.equal(usage, 9)
            const buffer = {
                bytes: new Uint8Array(size), mapState: 'unmapped', destroyed: false,
                mapAsync(mode) {
                    assert.equal(mode, 1)
                    this.mapState = 'pending'
                    return new Promise((resolve, reject) => {
                        this.resolve = () => { this.mapState = 'mapped'; resolve() }
                        this.reject = reject
                    })
                },
                getMappedRange() { assert.equal(this.mapState, 'mapped'); return this.bytes.buffer },
                unmap() { this.mapState = 'unmapped' },
                destroy() { this.destroyed = true; this.mapState = 'unmapped' },
            }
            buffers.push(buffer)
            return buffer
        },
        createCommandEncoder() {
            return {
                copyTextureToBuffer(source, target, extent) { this.copy = { source, target, extent } },
                finish() { return this.copy },
            }
        },
        queue: {
            submit(commands) {
                for (const { source, target, extent } of commands) {
                    assert.equal(target.bytesPerRow, bytesPerRow)
                    assert.equal(extent.width, width)
                    assert.equal(extent.height, height)
                    for (let row = 0; row < height; row += 1) {
                        target.buffer.bytes.set(source.texture.pixels.subarray(row * width * 4, (row + 1) * width * 4), row * bytesPerRow)
                    }
                }
            },
        },
    }
    const texture = { width, height, depthOrArrayLayers: 1, dimension: '2d', sampleCount: 1, format: 'bgra8unorm', usage: 1, pixels }
    return { device, buffers, texture }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('the vendored WebGPU readback strips padded rows with one copy per row', async () => {
    const { device, buffers, texture } = gpuFixture()
    const queue = new WebGPUExportQueue({ device, slots: 1 })
    queue.configure(DESCRIPTOR)
    let frame
    assert.equal(queue.enqueue(texture, 30, (value) => { frame = value }, 4), true)
    buffers[0].resolve()
    await flush()
    const outputBytes = DESCRIPTOR.width * DESCRIPTOR.height * 4
    const { subarrayCalls, setCalls } = (() => {
        let mappedBuffer = null
        for (const slot of queue._slots ?? []) mappedBuffer = slot.buffer
        const mappedSource = mappedBuffer.bytes
        let subarrayCalls = 0
        let setCalls = 0
        const subarray = Uint8Array.prototype.subarray
        const set = Uint8Array.prototype.set
        Uint8Array.prototype.subarray = function (...args) {
            if (this.buffer === mappedSource.buffer) subarrayCalls += 1
            return subarray.apply(this, args)
        }
        Uint8Array.prototype.set = function (...args) {
            if (this.length === outputBytes) setCalls += 1
            return set.apply(this, args)
        }
        try {
            queue.poll()
        } finally {
            Uint8Array.prototype.subarray = subarray
            Uint8Array.prototype.set = set
        }
        return { subarrayCalls, setCalls }
    })()
    // width * 4 < bytesPerRow (256): the readback is padded, so the row loop
    // stays and pays one slice and one write per row.
    assert.equal(subarrayCalls, DESCRIPTOR.height, 'padded readbacks keep the row loop')
    assert.equal(setCalls, DESCRIPTOR.height, 'padded readbacks write one row per copy')
    assert.deepEqual([...frame.data], TOP_DOWN, 'padded rows are stripped and swapped to RGBA')
    assert.equal(frame.rowStride, DESCRIPTOR.width * 4)
    queue.close()
    assert.ok(buffers.every(buffer => buffer.destroyed))
})

test('the vendored WebGPU readback coalesces a contiguous readback into one copy per frame', async () => {
    // 64 pixels fill a 256-byte row exactly, so bytesPerRow equals the packed
    // stride and the mapped readback is one contiguous block. Distinct rows
    // prove every row of the block lands on its own output row, unlike the
    // padded-row test above which strips trailing bytes.
    const width = 64
    const height = 2
    const expected = new Uint8Array(width * height * 4)
    const pixels = new Uint8Array(width * height * 4)
    for (let k = 0; k < width * height; k += 1) {
        expected.set([k & 255, (k * 2) & 255, 255 - (k & 255), 255], k * 4)
        // The texture holds BGRA bytes; poll swaps R and B into RGBA.
        pixels.set([255 - (k & 255), (k * 2) & 255, k & 255, 255], k * 4)
    }
    const { device, buffers, texture } = gpuFixture({ width, height, pixels })
    const queue = new WebGPUExportQueue({ device, slots: 1 })
    queue.configure({ width, height, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode: 'straight', fps: 60 })
    let frame
    assert.equal(queue.enqueue(texture, 7, value => { frame = value }, 1), true)
    buffers[0].resolve()
    await flush()
    const outputBytes = width * height * 4
    const { subarrayCalls, setCalls } = (() => {
        let mappedBuffer = null
        for (const slot of queue._slots ?? []) mappedBuffer = slot.buffer
        const mappedSource = mappedBuffer.bytes
        let subarrayCalls = 0
        let setCalls = 0
        const subarray = Uint8Array.prototype.subarray
        const set = Uint8Array.prototype.set
        Uint8Array.prototype.subarray = function (...args) {
            if (this.buffer === mappedSource.buffer) subarrayCalls += 1
            return subarray.apply(this, args)
        }
        Uint8Array.prototype.set = function (...args) {
            if (this.length === outputBytes) setCalls += 1
            return set.apply(this, args)
        }
        try {
            queue.poll()
        } finally {
            Uint8Array.prototype.subarray = subarray
            Uint8Array.prototype.set = set
        }
        return { subarrayCalls, setCalls }
    })()
    assert.equal(subarrayCalls, 1, 'a contiguous readback must be sliced once')
    assert.equal(setCalls, 1, 'a contiguous readback must be written with one set()')
    assert.deepEqual([...frame.data], [...expected])
    assert.equal(frame.rowStride, width * 4)
    queue.close()
    assert.ok(buffers.every(buffer => buffer.destroyed))
})

test('the vendored WebGPU readback swaps BGRA channels without a per-pixel array allocation', async () => {
    const { device, buffers, texture } = gpuFixture()
    const queue = new WebGPUExportQueue({ device, slots: 1 })
    queue.configure(DESCRIPTOR)
    let frame
    queue.enqueue(texture, 30, (value) => { frame = value }, 4)
    buffers[0].resolve()
    await flush()
    // Array destructuring (`[a, b] = [b, a]`) consumes the iterator once per
    // swapped pixel; the vendored swap uses a temp variable instead. The
    // pinned poll's remaining iterator consumers are its slot-copy spread and
    // the for-of over that copy.
    let iteratorCalls = 0
    const original = Array.prototype[Symbol.iterator]
    Array.prototype[Symbol.iterator] = function (...args) {
        iteratorCalls += 1
        return original.apply(this, args)
    }
    try {
        queue.poll()
    } finally {
        Array.prototype[Symbol.iterator] = original
    }
    assert.equal(iteratorCalls, 2, 'poll must not allocate a swap pair per pixel')
    assert.deepEqual([...frame.data], TOP_DOWN, 'BGRA bytes still swap into RGBA')
    queue.close()
    assert.ok(buffers.every(buffer => buffer.destroyed))
})
