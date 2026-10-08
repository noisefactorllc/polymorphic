import assert from 'node:assert/strict'
import test from 'node:test'

import { dslTokens, patchProgramText } from '../../public/js/ui/editorActions.js'

const SKETCH = [
    'search synth, filter',
    '',
    'perlin(scale: 75, octaves: 2)',
    '  .adjust(',
    '    mode: hsv,',
    '    rotation: 120,',
    '    hueRange: 40',
    '  )',
    '  .write(o0)',
    '',
    'render(o0)',
].join('\n')

test('dslTokens keeps comments and strings whole and skips whitespace', () => {
    const tokens = dslTokens('text(text: "a // b", size: 1) // note\n/* block */ .write(o0)')
    assert.deepEqual(tokens.map(t => [t.kind, t.text]), [
        ['code', 'text'], ['code', '('], ['code', 'text'], ['code', ':'], ['string', '"a // b"'],
        ['code', ','], ['code', 'size'], ['code', ':'], ['code', '1'], ['code', ')'],
        ['comment', '// note'], ['comment', '/* block */'],
        ['code', '.write'], ['code', '('], ['code', 'o0'], ['code', ')'],
    ])
    for (const t of tokens) assert.equal(t.text, 'text(text: "a // b", size: 1) // note\n/* block */ .write(o0)'.slice(t.start, t.end))
})

test('a regenerated program that moves or drops comments patches only the changed value', () => {
    // The regenerated program puts a trailing comment on its own line, or
    // drops it; the patch keeps every comment where the user typed it.
    const cases = [
        [SKETCH.replace('filter', 'filter // user note'), 'search synth, filter\n\n// user note\n' + SKETCH.slice(SKETCH.indexOf('perlin'))],
        [SKETCH.replace('  .write(o0)', '  .write(o0) // user note'), SKETCH],
        [SKETCH.replace('render(o0)', 'render(o0) // user note'), `${SKETCH}\n// user note`],
    ]
    for (const [current, regenerated] of cases) {
        assert.equal(
            patchProgramText(current, regenerated.replace('scale: 75', 'scale: 27.98')),
            current.replace('scale: 75', 'scale: 27.98'),
        )
    }
})

test('code the regenerated program adds or removes is patched in with its spacing', () => {
    assert.equal(
        patchProgramText('perlin(octaves: 2) // c\n  .write(o0)', 'perlin(scale: 40, octaves: 2)\n  .write(o0)'),
        'perlin(scale: 40, octaves: 2) // c\n  .write(o0)',
    )
    assert.equal(
        patchProgramText('perlin(scale: 40, octaves: 2) // c\n  .write(o0)', 'perlin(octaves: 2)\n  .write(o0)'),
        'perlin(octaves: 2) // c\n  .write(o0)',
    )
    assert.equal(patchProgramText('perlin()\n  .write(o0)', 'perlin(scale: 40)\n  .write(o0)'), 'perlin(scale: 40)\n  .write(o0)')
    assert.equal(
        patchProgramText('a(x: 1) // c1\nb(y: 2)', 'a(x: 3)\nb(y: 4)'),
        'a(x: 3) // c1\nb(y: 4)',
    )
})

test('a string that contains comment marks is code, not a comment', () => {
    assert.equal(
        patchProgramText('text(text: "a // b", size: 1) // c', 'text(text: "a // b", size: 2)'),
        'text(text: "a // b", size: 2) // c',
    )
})

test('layout and comments alone are no change to write', () => {
    const current = 'perlin(scale:75,octaves:2) // mine\n  .write(o0)'
    assert.equal(patchProgramText(current, 'perlin(scale: 75, octaves: 2)\n  .write(o0)'), current)
})

test('no patch when the changed code would take a comment with it', () => {
    // The comment sits between two changed tokens: replacing them would
    // remove it, so the caller writes the regenerated program instead.
    assert.equal(patchProgramText('a(x: 1 /* c */ 2)', 'a(z: 3)'), null)
})
