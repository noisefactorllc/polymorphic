import { test } from 'node:test'
import assert from 'node:assert'
import { SnapshotHistory } from '../../public/js/ui/snapshotHistory.js'

test('SnapshotHistory initializes safely without global localStorage', () => {
    const history = new SnapshotHistory()
    assert.strictEqual(history.canBack(), false)
    assert.strictEqual(history.canForward(), false)
    assert.strictEqual(history.back(), null)
    assert.strictEqual(history.forward(), null)
})

test('SnapshotHistory supports push, back, and forward navigation', () => {
    const history = new SnapshotHistory()
    history.push('step 1')
    history.push('step 2')
    history.push('step 3')

    assert.strictEqual(history.canBack(), true)
    assert.strictEqual(history.canForward(), false)

    const prev = history.back()
    assert.strictEqual(prev, 'step 2')
    assert.strictEqual(history.canForward(), true)

    const next = history.forward()
    assert.strictEqual(next, 'step 3')
})

test('SnapshotHistory silence suppresses automatic snapshots', () => {
    const history = new SnapshotHistory()
    history.push('init')

    history.silence(() => {
        history.push('ignored 1')
        history.push('ignored 2')
    })

    assert.strictEqual(history.canBack(), false)
    assert.strictEqual(history.back(), null)
})

test('SnapshotHistory prune reduces entries while maintaining cursor position', () => {
    const history = new SnapshotHistory()
    for (let i = 1; i <= 20; i++) {
        history.push(`entry ${i}`)
    }

    assert.strictEqual(history._entries.length, 20)
    assert.strictEqual(history._cursor, 19)

    const pruned = history.prune(5)
    assert.strictEqual(pruned, true)
    assert.strictEqual(history._entries.length, 5)
    // The cursor was pointing to entry 20, which is still the last item
    assert.strictEqual(history._entries[history._cursor].dsl, 'entry 20')
})

test('SnapshotHistory prune preserves active item when cursor is navigated to the past', () => {
    const history = new SnapshotHistory()
    for (let i = 1; i <= 20; i++) {
        history.push(`entry ${i}`)
    }

    // Step back 15 times so we are viewing entry 5
    for (let i = 0; i < 15; i++) {
        history.back()
    }
    assert.strictEqual(history._entries[history._cursor].dsl, 'entry 5')

    // Prune down to 6 items
    const pruned = history.prune(6)
    assert.strictEqual(pruned, true)
    assert.strictEqual(history._entries.length, 6)

    // Active item must still be entry 5!
    assert.strictEqual(history._entries[history._cursor].dsl, 'entry 5')
})

test('SnapshotHistory prune rolls back in-memory entries if storage fails', () => {
    const map = new Map()
    const storage = {
        getItem(k) { return map.get(k) ?? null },
        setItem() { throw new Error('Storage write failed') }
    }

    const history = new SnapshotHistory(storage)
    history._entries = [
        { dsl: 'a', time: 1 },
        { dsl: 'b', time: 2 },
        { dsl: 'c', time: 3 }
    ]
    history._cursor = 2

    const pruned = history.prune(1)
    assert.strictEqual(pruned, false)
    // Entries and cursor rolled back
    assert.strictEqual(history._entries.length, 3)
    assert.strictEqual(history._cursor, 2)
})

test('SnapshotHistory prune notifies change listeners', () => {
    const history = new SnapshotHistory()
    history.push('1')
    history.push('2')
    history.push('3')

    let notified = false
    history.onChange(() => { notified = true })

    history.prune(2)
    assert.strictEqual(notified, true)
})

