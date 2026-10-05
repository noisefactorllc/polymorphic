import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Programs } from '../../public/js/programs.js'
import { decodeImageText, hasImageText, referencedImageIds } from '../../public/js/programImages.js'

const RED = Buffer.from([137, 80, 78, 71, 1, 2, 3])
const BLUE = Buffer.from([137, 80, 78, 71, 4, 5, 6, 7])
const id = bytes => createHash('sha256').update(bytes).digest('hex')
const text = bytes => `data:image/png;base64,${bytes.toString('base64')}`
const embedded = [{ id: id(BLUE), dataUrl: text(BLUE) }]
const inlineDsl = `search synth\nmedia(url: "${text(RED)}").write(o0)\nrender(o0)`
const referenceDsl = `search synth\nmedia(url: "image:${id(RED)}").write(o0)\nrender(o0)`

function storage(initial = {}) {
    const values = new Map(Object.entries(initial))
    return {
        values,
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
    }
}
const stored = s => JSON.parse(s.values.get('polymorphic-programs'))
const legacyPrograms = () => storage({
    'polymorphic-programs': JSON.stringify({
        inline: { name: 'inline', dsl: inlineDsl, images: [], savedAt: 1 },
        listed: { name: 'listed', dsl: `media(url:"image:${id(BLUE)}").write(o0)`, images: embedded, savedAt: 2 },
        plain: { name: 'plain', dsl: 'noise().write(o0)\nrender(o0)', savedAt: 3 },
    })
})
// What programImages.storeImageText resolves with, without IndexedDB.
const fakeStore = calls => async (dsl, images) => {
    calls?.push({ dsl, images })
    return (await decodeImageText(dsl, images)).dsl
}

test('image references and image text are recognised in DSL', () => {
    assert.deepEqual(referencedImageIds(`${referenceDsl}\nmedia(url: "image:${id(RED)}").write(o1)\nmedia(url: "image:${id(BLUE)}")`), [id(RED), id(BLUE)])
    assert.deepEqual(referencedImageIds('noise().write(o0)'), [])
    assert.deepEqual(referencedImageIds(undefined), [])
    assert.equal(hasImageText(inlineDsl), true)
    assert.equal(hasImageText(`media(url: '${text(RED)}')`), true)
    assert.equal(hasImageText(referenceDsl), false)
    assert.equal(hasImageText('media(url: "https://example.com/a.png")'), false)
    assert.equal(hasImageText(null), false)
})

test('image text decodes to the original bytes, named by their SHA-256', async () => {
    const twice = `${inlineDsl}\nmedia(url: '${text(RED)}').write(o1)`
    const decoded = await decodeImageText(twice, embedded)
    assert.equal(decoded.dsl, `${referenceDsl}\nmedia(url: 'image:${id(RED)}').write(o1)`)
    assert.deepEqual(decoded.images.map(image => image.id).sort(), [id(RED), id(BLUE)].sort())
    for (const { id: imageId, blob } of decoded.images) {
        assert.equal(blob.type, 'image/png')
        assert.deepEqual(Buffer.from(await blob.arrayBuffer()), imageId === id(RED) ? RED : BLUE)
    }
    assert.deepEqual(await decodeImageText(referenceDsl), { dsl: referenceDsl, images: [] })
})

test('listed images must match their id and be image data URLs', async () => {
    await assert.rejects(decodeImageText('', [{ id: id(RED), dataUrl: text(BLUE) }]), /do not match their id/)
    await assert.rejects(decodeImageText('', [{ id: id(RED), dataUrl: 'original bytes' }]), /Invalid program image/)
    await assert.rejects(decodeImageText('', [{ id: 'a', dataUrl: text(RED) }]), /Invalid program image/)
})

test('a saved program stores its DSL and never image bytes', () => {
    const s = storage()
    const res = new Programs(s).saveProgram('Image', referenceDsl, [{ id: id(RED), dataUrl: text(RED) }])
    assert.equal(res.success, true)
    assert.deepEqual(Object.keys(stored(s).Image).sort(), ['dsl', 'name', 'savedAt'])
    assert.equal(new Programs(s).get('Image').dsl, referenceDsl)
    assert.equal(s.values.get('polymorphic-programs').includes('data:image'), false)
})

test('moving embedded images rewrites programs only after their images are stored', async () => {
    const s = legacyPrograms()
    const calls = []
    const programs = new Programs(s)
    assert.equal(await programs.moveEmbeddedImages(fakeStore(calls)), 2)
    assert.deepEqual(calls.map(call => call.images), [[], embedded])
    assert.equal(s.values.get('polymorphic-programs').includes('data:image'), false)
    assert.deepEqual(stored(s).inline, { name: 'inline', dsl: referenceDsl, savedAt: 1 })
    assert.deepEqual(stored(s).listed, { name: 'listed', dsl: `media(url:"image:${id(BLUE)}").write(o0)`, savedAt: 2 })
    assert.deepEqual(stored(s).plain, { name: 'plain', dsl: 'noise().write(o0)\nrender(o0)', savedAt: 3 })
    assert.deepEqual(programs.get('inline'), stored(s).inline)
    assert.equal(await programs.moveEmbeddedImages(async () => { throw new Error('nothing left to move') }), 0)
})

test('a program whose images cannot be stored keeps them', async () => {
    const s = legacyPrograms()
    const before = s.values.get('polymorphic-programs')
    const programs = new Programs(s)
    assert.equal(await programs.moveEmbeddedImages(async () => { throw new Error('IndexedDB unavailable') }), 0)
    assert.equal(s.values.get('polymorphic-programs'), before)
    assert.equal(programs.get('inline').dsl, inlineDsl)
    assert.deepEqual(programs.get('listed').images, embedded)
})

test('a save made while images are moving is kept, and a program changed meanwhile keeps its text', async () => {
    const s = legacyPrograms()
    const programs = new Programs(s)
    const other = new Programs(s)
    const changed = `${inlineDsl}\n// edited elsewhere`
    let first = true
    await programs.moveEmbeddedImages(async (dsl, images) => {
        if (first) {
            first = false
            assert.equal(other.saveProgram('saved meanwhile', 'noise().write(o0)').success, true)
            assert.equal(other.saveProgram('inline', changed).success, true)
        }
        return fakeStore()(dsl, images)
    })
    assert.deepEqual(Object.keys(stored(s)).sort(), ['inline', 'listed', 'plain', 'saved meanwhile'])
    assert.equal(stored(s).inline.dsl, changed)
    assert.equal(stored(s).listed.images, undefined)
    assert.equal(programs.get('saved meanwhile').dsl, 'noise().write(o0)')
})

test('a failed write leaves storage and memory with the embedded images', async () => {
    const s = legacyPrograms()
    const before = s.values.get('polymorphic-programs')
    const programs = new Programs(s)
    s.setItem = () => { throw new Error('Disk error') }
    assert.equal(await programs.moveEmbeddedImages(fakeStore()), 0)
    assert.equal(s.values.get('polymorphic-programs'), before)
    assert.equal(programs.get('inline').dsl, inlineDsl)
    assert.deepEqual(programs.get('listed').images, embedded)
})
