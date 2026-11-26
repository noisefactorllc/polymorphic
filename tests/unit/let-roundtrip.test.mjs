import { test } from 'node:test'
import assert from 'node:assert'
import { formatDsl } from '../../public/js/ui/formatter.js'
import { patchProgramText } from '../../public/js/ui/editorActions.js'

// Noisemaker 1.5.7 keeps a let binding's expression arguments as DSL when it
// unparse the program: a call argument stays a call, an oscillator stays
// `osc(type: oscKind.sine)`, and a let binding whose value is a chain unparse
// onto two lines, the continuation starting with `.`. The engine's expander
// inlines the let into each use, so the saved program carries the binding and
// the inlined producer chain. These fixtures are the engine's verbatim
// `unparse()` output for a program that binds a layer and blends it twice,
// captured from the live CDN bundle this app loads.
//
// Source program:
//
//   search synth, filter, mixer
//
//   let amount = 0.25
//   let layer = scene().blendMode(tex: noise(octaves: 3), mix: osc(type: oscKind.sine))
//
//   noise().blendMode(tex: layer).write(o0)
//
//   render(o0)
const ENGINE_UNPARSE = [
    'search synth, filter, mixer',
    '',
    'let amount = 0.25',
    'let layer = scene()',
    '  .blendMode(tex: noise(octaves: 3), mix: osc(type: oscKind.sine))',
    '',
    'noise()',
    '  .blendMode(tex: scene()',
    '  .blendMode(tex: noise(octaves: 3), mix: osc(type: oscKind.sine)))',
    '  .write(o0)',
    '',
    'render(o0)',
].join('\n')

test('the formatter keeps the engine-written let bindings and stays idempotent', () => {
    const once = formatDsl(ENGINE_UNPARSE)
    assert.ok(once.includes('let amount = 0.25'), `formatter dropped the amount binding:\n${once}`)
    assert.ok(once.includes('let layer = scene() .blendMode(tex: noise(octaves: 3), mix: osc(type: oscKind.sine))'),
        `formatter dropped the layer binding:\n${once}`)
    assert.strictEqual(formatDsl(once), once)
})

test('the formatter keeps the inlined producer chain with its expression argument', () => {
    const once = formatDsl(ENGINE_UNPARSE)
    assert.ok(once.includes('noise()\n  .blendMode(tex: scene() .blendMode(tex: noise(octaves: 3), mix: osc(type: oscKind.sine)))\n  .write(o0)'),
        `formatter did not fold the producer chain:\n${once}`)
})

test('patchProgramText keeps the editor layout when the engine output differs only in layout', () => {
    const base = formatDsl(ENGINE_UNPARSE)
    const patched = patchProgramText(base, ENGINE_UNPARSE)
    assert.strictEqual(patched, base)
})

test('patchProgramText applies a value change to the let binding and keeps the other use', () => {
    const base = formatDsl(ENGINE_UNPARSE)
    const regenerated = ENGINE_UNPARSE.replace('octaves: 3', 'octaves: 4')
    const patched = patchProgramText(base, regenerated)
    assert.ok(patched.includes('let layer = scene() .blendMode(tex: noise(octaves: 4), mix: osc(type: oscKind.sine))'),
        `patch lost the binding edit:\n${patched}`)
    assert.ok(patched.includes('noise(octaves: 3), mix: osc(type: oscKind.sine)))'),
        `patch changed the other occurrence:\n${patched}`)
    assert.strictEqual((patched.match(/octaves: 4/g) || []).length, 1)
    assert.strictEqual(formatDsl(patched), patched)
})
