import { test } from 'node:test'
import assert from 'node:assert'
import { parseMidiStatus, bpmFromTickIntervals } from '../../public/js/ui/midiClock.js'

test('parseMidiStatus recognizes MIDI System Real-Time transport bytes', () => {
    assert.strictEqual(parseMidiStatus(0xF8), 'clock')
    assert.strictEqual(parseMidiStatus(0xFA), 'start')
    assert.strictEqual(parseMidiStatus(0xFB), 'continue')
    assert.strictEqual(parseMidiStatus(0xFC), 'stop')
})

test('parseMidiStatus returns null for non-transport bytes', () => {
    assert.strictEqual(parseMidiStatus(0x90), null) // note on
    assert.strictEqual(parseMidiStatus(0xB0), null) // CC
    assert.strictEqual(parseMidiStatus(0xF2), null) // song position pointer (out of scope)
    assert.strictEqual(parseMidiStatus(0xF9), null) // undefined real-time
    assert.strictEqual(parseMidiStatus(0), null)
})

test('bpmFromTickIntervals returns null for fewer than 2 timestamps', () => {
    assert.strictEqual(bpmFromTickIntervals([]), null)
    assert.strictEqual(bpmFromTickIntervals([1000]), null)
})

test('bpmFromTickIntervals computes 120 BPM from 24 evenly-spaced ticks at 20.833ms', () => {
    // 120 BPM → 1 beat = 500ms → 24 PPQN → 500/24 ≈ 20.833ms per tick
    const tickInterval = 500 / 24
    const ts = []
    for (let i = 0; i < 24; i++) ts.push(1000 + i * tickInterval)
    const bpm = bpmFromTickIntervals(ts)
    assert.ok(Math.abs(bpm - 120) < 0.01, `expected ~120, got ${bpm}`)
})

test('bpmFromTickIntervals computes 60 BPM from ticks at 41.666ms', () => {
    // 60 BPM → 1 beat = 1000ms → 24 PPQN → 1000/24 ≈ 41.666ms
    const tickInterval = 1000 / 24
    const ts = []
    for (let i = 0; i < 24; i++) ts.push(2000 + i * tickInterval)
    const bpm = bpmFromTickIntervals(ts)
    assert.ok(Math.abs(bpm - 60) < 0.01, `expected ~60, got ${bpm}`)
})

test('bpmFromTickIntervals averages uneven intervals', () => {
    // Two ticks 100ms apart, two more 50ms apart → avg 75ms per tick → bpm = 60000 / (75 * 24) = 33.33
    const ts = [1000, 1100, 1150, 1200]
    const bpm = bpmFromTickIntervals(ts)
    // (100 + 50 + 50) / 3 = 66.67ms avg → 60000 / (66.67 * 24) = 37.5
    const expected = 60000 / (66.6666666 * 24)
    assert.ok(Math.abs(bpm - expected) < 0.1, `expected ~${expected}, got ${bpm}`)
})

test('bpmFromTickIntervals returns null when intervals contain a non-finite gap', () => {
    // If timestamps are bad (e.g. clock source paused mid-window), guard against NaN/Infinity
    const ts = [1000, 1000] // zero-interval pair
    const bpm = bpmFromTickIntervals(ts)
    assert.strictEqual(bpm, null)
})
