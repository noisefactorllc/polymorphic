import { test } from 'node:test'
import assert from 'node:assert'
import { Scenes } from '../../public/js/ui/scenes.js'

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

test('scene image bytes survive a fresh storage reader alongside their DSL', () => {
    const image = { id: 'a', dataUrl: 'original bytes' }
    const store = { data: null, get() { return this.data }, set(value) { this.data = JSON.parse(JSON.stringify(value)) } }
    new Scenes(store).save(1, 'media(url:"image:a")', [image])
    const reloaded = new Scenes(store)
    assert.strictEqual(reloaded.load(1), 'media(url:"image:a")')
    assert.deepStrictEqual(reloaded.images(1), [image])
})
