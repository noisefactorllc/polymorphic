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
