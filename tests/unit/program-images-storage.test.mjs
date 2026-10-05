import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

// programImages.js against a minimal in-memory IndexedDB, installed before
// the module first opens a connection.
const records = new Map()
const transactions = []
const connections = []
let blockNextOpen = false
let writes = 0
globalThis.indexedDB = {
    open() {
        const request = {}
        setTimeout(() => {
            if (blockNextOpen) {
                blockNextOpen = false
                request.onblocked?.()
                return
            }
            const db = {
                closed: false,
                objectStoreNames: { contains: () => connections.length > 0 },
                createObjectStore() {},
                close() { db.closed = true },
                transaction(_name, mode, options) {
                    if (db.closed) throw new Error('The database connection is closing')
                    transactions.push({ mode, options })
                    const queued = []
                    const tx = {
                        objectStore: () => ({
                            put(value) { writes++; queued.push(() => records.set(value.id, value)); return {} },
                            get(id) { return { result: records.get(id) } },
                            getAllKeys() { return { result: [...records.keys()] } },
                        }),
                    }
                    setTimeout(() => {
                        for (const write of queued) write()
                        tx.oncomplete?.()
                    })
                    return tx
                },
            }
            request.result = db
            if (!connections.length) request.onupgradeneeded?.({ target: { result: db } })
            connections.push(db)
            request.onsuccess?.()
        })
        return request
    },
}

const {
    storeProgramImages, getProgramImage, storeImageFile, storeImageText, imageId, sha256Hex,
    migrateProgramImages, programImagesMigrated,
} = await import('../../public/js/programImages.js')

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const RED = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const text = bytes => `data:image/png;base64,${bytes.toString('base64')}`

/** Run `fn` with crypto.subtle missing, as on a page served over plain HTTP. */
async function withoutSubtle(fn) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true })
    try {
        return await fn()
    } finally {
        Object.defineProperty(globalThis, 'crypto', descriptor)
    }
}

/** Run `fn` counting crypto.subtle.digest calls. */
async function countingDigests(fn) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    const subtle = globalThis.crypto.subtle
    const counter = { digests: 0 }
    const digest = (...args) => { counter.digests++; return subtle.digest(...args) }
    Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest } }, configurable: true, writable: true })
    try {
        await fn(counter)
    } finally {
        Object.defineProperty(globalThis, 'crypto', descriptor)
    }
}

test('image writes ask for strict durability, and reads do not', async () => {
    transactions.length = 0
    await storeProgramImages([{ id: sha256(RED), blob: new Blob([RED], { type: 'image/png' }) }])
    assert.deepEqual(transactions, [{ mode: 'readwrite', options: { durability: 'strict' } }])
    transactions.length = 0
    assert.ok(await getProgramImage(sha256(RED)))
    assert.deepEqual(transactions, [{ mode: 'readonly', options: undefined }])
})

test('a picked file is read once, and its stored copy survives the file going away', async () => {
    const bytes = randomBytes(4096)
    let reads = 0
    // Like a File whose file on disk is deleted after it was picked.
    class PickedFile extends Blob {
        async arrayBuffer() {
            if (reads++) throw new DOMException('The requested file could not be read', 'NotReadableError')
            return super.arrayBuffer()
        }
    }
    const file = new PickedFile([bytes], { type: 'image/png' })
    assert.equal(await storeImageFile(file), `image:${sha256(bytes)}`)
    assert.equal(reads, 1)
    const stored = await getProgramImage(sha256(bytes))
    assert.notEqual(stored, file)
    assert.equal(stored.type, 'image/png')
    assert.deepEqual(Buffer.from(await stored.arrayBuffer()), bytes)
})

test('the plain JavaScript SHA-256 matches the published test vectors', () => {
    const vectors = [
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
        ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu', 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
        ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
    ]
    for (const [message, digest] of vectors) {
        assert.equal(sha256Hex(new TextEncoder().encode(message)), digest)
        assert.equal(sha256Hex(new TextEncoder().encode(message).buffer), digest)
    }
})

test('the plain JavaScript SHA-256 matches crypto.subtle on random input', async () => {
    const hex = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
    // Every length across the padding boundaries, then larger inputs.
    const lengths = [...Array(200).keys(), 1000, 4095, 4096, 65537, 1_048_576 + 3]
    for (let i = 0; i < 40; i++) lengths.push(Math.floor(Math.random() * 300_000))
    for (const length of lengths) {
        const bytes = randomBytes(length)
        assert.equal(sha256Hex(bytes), await hex(bytes), `length ${length}`)
    }
    // A view into a larger buffer hashes only its own bytes.
    const buffer = randomBytes(1000)
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset + 17, 500)
    assert.equal(sha256Hex(view), await hex(view.slice()))
})

test('dropping, picking and saving work without crypto.subtle', async () => {
    const bytes = randomBytes(2048)
    const other = randomBytes(512)
    await withoutSubtle(async () => {
        assert.equal(globalThis.crypto.subtle, undefined)
        assert.equal(await storeImageFile(new Blob([bytes], { type: 'image/png' })), `image:${sha256(bytes)}`)
        assert.equal(await imageId(new Blob([other])), sha256(other))
        const dsl = await storeImageText(`media(url: "${text(other)}").write(o0)`)
        assert.equal(dsl, `media(url: "image:${sha256(other)}").write(o0)`)
    })
    assert.deepEqual(Buffer.from(await (await getProgramImage(sha256(bytes))).arrayBuffer()), bytes)
    assert.deepEqual(Buffer.from(await (await getProgramImage(sha256(other))).arrayBuffer()), other)
})

test('storing the same image text again does not decode, hash or write it again', async () => {
    const image = randomBytes(1024)
    const program = suffix => `media(url: "${text(image)}").write(o0)\n${suffix}`
    await countingDigests(async counter => {
        const before = writes
        assert.equal(await storeImageText(program('render(o0)')), `media(url: "image:${sha256(image)}").write(o0)\nrender(o0)`)
        assert.equal(counter.digests, 1)
        assert.equal(writes, before + 1)
        // An edit elsewhere in the program, compiled again.
        assert.equal(await storeImageText(program('// edited\nrender(o0)')), `media(url: "image:${sha256(image)}").write(o0)\n// edited\nrender(o0)`)
        assert.equal(counter.digests, 1)
        assert.equal(writes, before + 1)
        // Once the connection closes the image may be gone, so it is stored again.
        connections.at(-1).onversionchange()
        assert.equal(connections.at(-1).closed, true)
        const opened = connections.length
        await storeImageText(program('render(o0)'))
        assert.equal(counter.digests, 2)
        assert.equal(writes, before + 2)
        assert.equal(connections.length, opened + 1)
    })
})

test('a blocked open fails the call, and the next call opens again', async () => {
    connections.at(-1).onclose()
    blockNextOpen = true
    await assert.rejects(storeProgramImages([{ id: sha256(RED), blob: new Blob([RED]) }]), /blocked by another Polymorphic tab/)
    await storeProgramImages([{ id: sha256(RED), blob: new Blob([RED]) }])
    assert.ok(await getProgramImage(sha256(RED)))
})

test('saves can wait for the startup migration, which never fails them and never waits forever', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const order = []
    migrateProgramImages([{ moveEmbeddedImages: async () => { await gate; order.push('moved') } }])
    const waited = programImagesMigrated().then(() => order.push('saved'))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(order, [])
    release()
    await waited
    assert.deepEqual(order, ['moved', 'saved'])

    const failed = migrateProgramImages([{ moveEmbeddedImages: async () => { throw new Error('IndexedDB unavailable') } }])
    await assert.rejects(failed, /IndexedDB unavailable/)
    await programImagesMigrated()

    migrateProgramImages([{ moveEmbeddedImages: () => new Promise(() => {}) }])
    const started = Date.now()
    await programImagesMigrated(50)
    assert.ok(Date.now() - started < 5000)
})
