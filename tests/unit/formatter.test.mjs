import { test } from 'node:test'
import assert from 'node:assert'
import { formatDsl } from '../../public/js/ui/formatter.js'

test('formatDsl indents chain steps', () => {
    const input = 'noise(scaleX:80).palette(index:vaporwave).write(o0)'
    const expected = 'noise(scaleX: 80)\n  .palette(index: vaporwave)\n  .write(o0)'
    assert.strictEqual(formatDsl(input), expected)
})

test('formatDsl normalizes search line', () => {
    const input = 'search   synth ,filter\nnoise().write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.startsWith('search synth, filter\n'))
})

test('formatDsl preserves blank-line block separators', () => {
    const input = 'search synth, render\n\nnoise().write(o0)\n\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('\n\n'), 'blank line preserved between blocks')
})

test('formatDsl is idempotent', () => {
    const input = 'search synth, render\n\nnoise(scaleX: 80)\n  .write(o0)\n\nrender(o0)'
    assert.strictEqual(formatDsl(formatDsl(input)), formatDsl(input))
})

test('formatDsl collapses multi-line argument blocks', () => {
    const input = 'noise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\nrender(o0)'
    const out = formatDsl(input)
    assert.ok(out.includes('  .adjust(mode: hsv, rotation: 120)'),
        'multi-line .adjust(...) collapses onto one indented line')
    assert.ok(!/^[a-z]/m.test(out.split('\n').filter(l => l.includes('mode:')).join('')),
        'argument-only lines never appear at column 0')
})

test('formatDsl idempotent across multi-line input', () => {
    const input = 'search synth, filter, render\n\nnoise()\n  .adjust(\n    mode: hsv,\n    rotation: 120\n  )\n  .write(o0)\n\nrender(o0)'
    const once = formatDsl(input)
    const twice = formatDsl(once)
    assert.strictEqual(twice, once)
})
