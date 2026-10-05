import { test } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { Scenes } from '../../public/js/ui/scenes.js'
import { decodeImageText } from '../../public/js/programImages.js'

test('Scenes saves + restores up to 9 slots', () => {
    const store = { data: null,
        get() { return this.data }, set(d) { this.data = d } }
    const s = new Scenes(store)
    s.save(1, 'noise().write(o0)')
    s.save(2, 'gradient().write(o0)')
    assert.strictEqual(s.load(1), 'noise().write(o0)')
    assert.strictEqual(s.load(2), 'gradient().write(o0)')
    assert.strictEqual(s.load(9), null)
})

test('Scenes rejects out-of-range slots', () => {
    const s = new Scenes()
    assert.throws(() => s.save(0, 'x'))
    assert.throws(() => s.save(10, 'x'))
})

test('Scenes restore from raw stored data round-trips', () => {
    const store = { data: null, get() { return this.data }, set(d) { this.data = d } }
    const s1 = new Scenes(store)
    s1.save(3, 'foo')
    const s2 = new Scenes(store)
    assert.strictEqual(s2.load(3), 'foo')
})

test('Scenes save rolls back and reports failure when store write fails', () => {
    const store = {
        data: { 1: 'original' },
        get() { return this.data },
        set() { return { success: false, quotaExceeded: true, error: new Error('Quota') } }
    }
    const s = new Scenes(store)
    const res = s.save(1, 'updated')
    assert.strictEqual(res.success, false)
    assert.strictEqual(res.quotaExceeded, true)
    // Slot 1 must remain rolled back to original
    assert.strictEqual(s.load(1), 'original')

    // Saving a new slot that fails must delete it from in-memory cache
    const res2 = s.save(2, 'new')
    assert.strictEqual(res2.success, false)
    assert.strictEqual(s.load(2), null)
})

test('Scenes clear rolls back when store write fails', () => {
    const store = {
        data: { 1: 'keep' },
        get() { return this.data },
        set() { return { success: false } }
    }
    const s = new Scenes(store)
    const ok = s.clear(1)
    assert.strictEqual(ok, false)
    assert.strictEqual(s.load(1), 'keep')
})

const RED = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const imageId = bytes => createHash('sha256').update(bytes).digest('hex')
const imageText = bytes => `data:image/png;base64,${bytes.toString('base64')}`
const reference = `media(url:"image:${imageId(RED)}").write(o0)`
// Copies on every read and write, as the localStorage store does.
const jsonStore = data => ({
    data: JSON.stringify(data),
    get() { return JSON.parse(this.data) },
    set(value) { this.data = JSON.stringify(value) },
})
const fakeStore = async (dsl, images) => (await decodeImageText(dsl, images)).dsl

test('a saved scene keeps its DSL and image references, never image bytes', () => {
    const store = jsonStore(null)
    new Scenes(store).save(1, reference, [{ id: imageId(RED), dataUrl: imageText(RED) }])
    assert.strictEqual(store.data, JSON.stringify({ 1: reference }))
    const reloaded = new Scenes(store)
    assert.strictEqual(reloaded.load(1), reference)
    assert.deepStrictEqual(reloaded.images(1), [])
})

test('scenes saved with images as text keep them readable until they are moved', async () => {
    const images = [{ id: imageId(RED), dataUrl: imageText(RED) }]
    const store = jsonStore({
        1: { dsl: reference, images },
        2: `media(url: "${imageText(RED)}").write(o0)`,
        3: 'noise().write(o0)',
    })
    const scenes = new Scenes(store)
    assert.deepStrictEqual(scenes.images(1), images)
    const received = []
    assert.strictEqual(await scenes.moveEmbeddedImages(async (dsl, list) => {
        received.push(list)
        return fakeStore(dsl, list)
    }), 2)
    assert.deepStrictEqual(received, [images, []])
    assert.strictEqual(store.data.includes('data:image'), false)
    assert.deepStrictEqual(JSON.parse(store.data), {
        1: reference,
        2: `media(url: "image:${imageId(RED)}").write(o0)`,
        3: 'noise().write(o0)',
    })
    assert.strictEqual(scenes.load(2), `media(url: "image:${imageId(RED)}").write(o0)`)
    assert.deepStrictEqual(scenes.images(1), [])
})

test('a scene whose images cannot be stored, or that changed meanwhile, keeps its text', async () => {
    const legacy = { 1: `media(url: "${imageText(RED)}").write(o0)`, 2: `media(url: "${imageText(RED)}").write(o1)` }
    const failing = jsonStore(legacy)
    const scenes = new Scenes(failing)
    assert.strictEqual(await scenes.moveEmbeddedImages(async () => { throw new Error('IndexedDB unavailable') }), 0)
    assert.strictEqual(failing.data, JSON.stringify(legacy))
    assert.strictEqual(scenes.load(1), legacy[1])

    const changing = jsonStore(legacy)
    const moving = new Scenes(changing)
    const other = new Scenes(changing)
    assert.strictEqual(await moving.moveEmbeddedImages(async (dsl, list) => {
        if (dsl === legacy[1]) other.save(1, `${legacy[1]} // edited elsewhere`)
        return fakeStore(dsl, list)
    }), 1)
    assert.deepStrictEqual(JSON.parse(changing.data), {
        1: `${legacy[1]} // edited elsewhere`,
        2: `media(url: "image:${imageId(RED)}").write(o1)`,
    })
})

test('a failed scene write leaves the scenes with their images as text', async () => {
    const legacy = { 1: `media(url: "${imageText(RED)}").write(o0)` }
    const store = { ...jsonStore(legacy), set() { return { success: false, quotaExceeded: true } } }
    const scenes = new Scenes(store)
    assert.strictEqual(await scenes.moveEmbeddedImages(fakeStore), 0)
    assert.strictEqual(scenes.load(1), legacy[1])
    assert.strictEqual(store.data, JSON.stringify(legacy))
})
