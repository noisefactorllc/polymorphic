import { test } from 'node:test'
import assert from 'node:assert'
import { computeBarSeconds, DIVIDER_OPTIONS } from '../../public/js/ui/bpm.js'

test('computeBarSeconds returns one bar (4 beats) of seconds at the given BPM', () => {
    // 120 BPM → 0.5s per beat → 2.0s per bar
    assert.strictEqual(computeBarSeconds(120), 2)
    // 60 BPM → 1s per beat → 4.0s per bar
    assert.strictEqual(computeBarSeconds(60), 4)
})

test('computeBarSeconds multiplies loop duration by the divider', () => {
    // /4 at 120 BPM → bar that's 4× longer (8.0s) → animation runs 4× slower
    assert.strictEqual(computeBarSeconds(120, 4), 8)
    assert.strictEqual(computeBarSeconds(120, 8), 16)
    assert.strictEqual(computeBarSeconds(120, 32), 64)
})

test('computeBarSeconds defaults divider to 1 (no slowdown)', () => {
    assert.strictEqual(computeBarSeconds(120), computeBarSeconds(120, 1))
})

test('DIVIDER_OPTIONS exposes the supported divisors in ascending order', () => {
    assert.deepStrictEqual(DIVIDER_OPTIONS, [1, 2, 4, 8, 16, 32])
})
