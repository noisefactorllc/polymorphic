import { test } from 'node:test'
import assert from 'node:assert'
import { Programs } from '../../public/js/programs.js'

function createMockStorage(initial = {}) {
    const data = new Map(Object.entries(initial))
    return {
        _data: data,
        getItem(k) { return data.has(k) ? data.get(k) : null },
        setItem(k, v) { data.set(k, String(v)) },
        removeItem(k) { data.delete(k) },
        clear() { data.clear() }
    }
}

test('Programs initializes safely without storage', () => {
    const p = new Programs(null)
    assert.deepStrictEqual(p.current, {})
    assert.deepStrictEqual(p.getNames(), [])
    assert.strictEqual(p.get('foo'), null)
    assert.strictEqual(p.has('foo'), false)
    assert.strictEqual(p.deleteProgram('foo'), false)
})

test('Programs loads existing programs from storage', () => {
    const mock = createMockStorage({
        'polymorphic-programs': JSON.stringify({
            bravo: { name: 'bravo', dsl: 'gradient().write(o0)', savedAt: 100 },
            alpha: { name: 'alpha', dsl: 'noise().write(o0)', savedAt: 200 }
        })
    })

    const p = new Programs(mock)
    assert.deepStrictEqual(p.getNames(), ['alpha', 'bravo'])
    assert.strictEqual(p.get('alpha').dsl, 'noise().write(o0)')
    assert.strictEqual(p.has('bravo'), true)
    assert.strictEqual(p.has('charlie'), false)
})

test('Programs saveProgram and deleteProgram update storage and in-memory state', () => {
    const mock = createMockStorage()
    const p = new Programs(mock)

    const res = p.saveProgram('my-shader', 'synth().write(o0)')
    assert.strictEqual(res.success, true)
    assert.strictEqual(p.has('my-shader'), true)
    assert.strictEqual(p.get('my-shader').dsl, 'synth().write(o0)')

    // Verify stored JSON
    const stored = JSON.parse(mock.getItem('polymorphic-programs'))
    assert.strictEqual(stored['my-shader'].dsl, 'synth().write(o0)')

    // Delete
    const deleted = p.deleteProgram('my-shader')
    assert.strictEqual(deleted, true)
    assert.strictEqual(p.has('my-shader'), false)
    assert.strictEqual(JSON.parse(mock.getItem('polymorphic-programs'))['my-shader'], undefined)
})

test('Programs saveProgram rolls back on quota exceeded error', () => {
    const mock = createMockStorage({
        'polymorphic-programs': JSON.stringify({
            existing: { name: 'existing', dsl: 'prev().write(o0)', savedAt: 50 }
        })
    })

    const p = new Programs(mock)

    // Make setItem throw QuotaExceededError
    mock.setItem = () => {
        const err = new Error('Quota exceeded')
        err.name = 'QuotaExceededError'
        throw err
    }

    // Attempting to overwrite existing program fails and rolls back to previous
    const overwriteRes = p.saveProgram('existing', 'new_content().write(o0)')
    assert.strictEqual(overwriteRes.success, false)
    assert.strictEqual(overwriteRes.quotaExceeded, true)
    assert.strictEqual(p.get('existing').dsl, 'prev().write(o0)')

    // Attempting to save new program fails and rolls back (removes it)
    const newRes = p.saveProgram('brand-new', 'fail().write(o0)')
    assert.strictEqual(newRes.success, false)
    assert.strictEqual(newRes.quotaExceeded, true)
    assert.strictEqual(p.has('brand-new'), false)
})

test('Programs deleteProgram rolls back on storage failure', () => {
    const mock = createMockStorage({
        'polymorphic-programs': JSON.stringify({
            saved: { name: 'saved', dsl: 'code', savedAt: 10 }
        })
    })

    const p = new Programs(mock)
    assert.strictEqual(p.has('saved'), true)

    // Make setItem fail
    mock.setItem = () => {
        throw new Error('Disk error')
    }

    const deleted = p.deleteProgram('saved')
    assert.strictEqual(deleted, false)
    // Must remain retained in memory
    assert.strictEqual(p.has('saved'), true)
    assert.strictEqual(p.get('saved').dsl, 'code')
})

