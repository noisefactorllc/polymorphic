import { test } from 'node:test'
import assert from 'node:assert'
import { recentCcsFromMidiState } from '../../public/js/ui/liveInputsPanel.js'

test('recentCcsFromMidiState extracts {ch, cc, value} tuples', () => {
    const fake = {
        _channels: {
            '1': { _cc: { 0: 0, 1: 0.5, 2: 0 } },
            '2': { _cc: { 12: 0.75 } }
        }
    }
    const out = recentCcsFromMidiState(fake)
    assert.strictEqual(out.length, 2)
    assert.deepStrictEqual(
        out.find(r => r.cc === 1),
        { ch: '1', cc: 1, value: 0.5 }
    )
})

test('returns [] on null/empty', () => {
    assert.deepStrictEqual(recentCcsFromMidiState(null), [])
    assert.deepStrictEqual(recentCcsFromMidiState({}), [])
})
