/**
 * Regression tests for text-effect parameter extraction.
 *
 * The fixtures in this file are verbatim `extractEffectsFromDsl()` output from
 * the Noisemaker compiler, so these tests pin the contract between the compiler
 * and the renderer without needing the CDN bundle at test time.
 *
 * Run: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TEXT_DEFAULTS, textEffectsFromParsed, toRgb } from '../../public/js/noisemaker/textParams.js'

/**
 * Compiler output for:
 *
 *   solid(alpha: 0)
 *     .text(
 *       text: """genart
 *   .social""",
 *       font: "Monaspace",
 *       size: 0.33
 *     )
 *     .write(o0)
 *
 * A composition like this rendered "Hello World" because the old regex parser
 * could not read a triple-quoted string and silently fell back to the effect
 * default. The unparser emits triple quotes for any multi-line text.
 */
const TRIPLE_QUOTED = [
    { effectKey: 'synth.solid', name: 'solid', fullName: 'synth.solid', args: { color: [0.5, 0.5, 0.5], alpha: 0 }, stepIndex: 0, temp: 0 },
    {
        effectKey: 'filter.text',
        name: 'text',
        fullName: 'filter.text',
        args: {
            text: 'genart\n.social', font: 'Monaspace', size: 0.33,
            posX: 0.5, posY: 0.5, rotation: 0, color: '#ffffff',
            matteColor: '#000000', matteOpacity: 0, justify: 'center'
        },
        stepIndex: 1,
        temp: 1
    },
    { effectKey: '_write', name: '_write', fullName: '_write', args: {}, stepIndex: 2, temp: 2 }
]

test('multi-line triple-quoted text survives extraction', () => {
    const found = textEffectsFromParsed(TRIPLE_QUOTED)

    assert.equal(found.length, 1)
    assert.equal(found[0].params.text, 'genart\n.social')
    assert.notEqual(found[0].params.text, TEXT_DEFAULTS.text)
})

test('text effect binds to the temp index, not the global step index', () => {
    const found = textEffectsFromParsed(TRIPLE_QUOTED)
    assert.equal(found[0].stepIndex, 1)
})

test('explicitly authored params are preserved', () => {
    const [{ params }] = textEffectsFromParsed(TRIPLE_QUOTED)
    assert.equal(params.font, 'Monaspace')
    assert.equal(params.size, 0.33)
})

test('unspecified params fall back to compiler-resolved defaults', () => {
    const [{ params }] = textEffectsFromParsed(TRIPLE_QUOTED)
    assert.equal(params.posX, 0.5)
    assert.equal(params.posY, 0.5)
    assert.equal(params.rotation, 0)
    assert.equal(params.justify, 'center')
})

test('a DSL with no text effect yields nothing to render', () => {
    const found = textEffectsFromParsed([
        { name: 'solid', fullName: 'synth.solid', args: { alpha: 0 }, stepIndex: 0, temp: 0 }
    ])
    assert.deepEqual(found, [])
})

test('malformed input does not throw', () => {
    assert.deepEqual(textEffectsFromParsed(null), [])
    assert.deepEqual(textEffectsFromParsed(undefined), [])
    assert.deepEqual(textEffectsFromParsed([]), [])
    assert.deepEqual(textEffectsFromParsed([{ name: 'text' }])[0].params.text, TEXT_DEFAULTS.text)
})

test('every text effect in a chain gets its own texture', () => {
    // solid(alpha: 0).text(text: "first").text(text: "second", size: 0.4)
    const found = textEffectsFromParsed([
        { name: 'solid', fullName: 'synth.solid', args: { alpha: 0 }, stepIndex: 0, temp: 0 },
        { name: 'text', fullName: 'filter.text', args: { text: 'first', size: 0.1 }, stepIndex: 1, temp: 1 },
        { name: 'text', fullName: 'filter.text', args: { text: 'second', size: 0.4 }, stepIndex: 2, temp: 2 }
    ])

    assert.equal(found.length, 2)
    assert.deepEqual(found.map(f => f.params.text), ['first', 'second'])
    assert.deepEqual(found.map(f => f.stepIndex), [1, 2])
})

test('quotes and parens inside text are not truncated', () => {
    const [{ params }] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: "don't stop :) ok" }, stepIndex: 0, temp: 0 }
    ])
    assert.equal(params.text, "don't stop :) ok")
})

test('negative rotation is preserved', () => {
    const [{ params }] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', rotation: -45 }, stepIndex: 0, temp: 0 }
    ])
    assert.equal(params.rotation, -45)
})

test('zero-valued params are not swallowed by falsy checks', () => {
    const [{ params }] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', posX: 0, posY: 0, size: 0 }, stepIndex: 0, temp: 0 }
    ])
    assert.equal(params.posX, 0)
    assert.equal(params.posY, 0)
    assert.equal(params.size, 0)
})

test('empty text renders as empty, not as the default', () => {
    const [{ params }] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: '' }, stepIndex: 0, temp: 0 }
    ])
    assert.equal(params.text, '')
})

test('matte params drive the background, under either spelling', () => {
    const [canonical] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', matteColor: '#112233', matteOpacity: 0.5 }, stepIndex: 0, temp: 0 }
    ])
    assert.deepEqual(canonical.params.bgColor, toRgb('#112233'))
    assert.equal(canonical.params.bgOpacity, 0.5)

    const [alias] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', bgColor: '#112233', bgOpacity: 0.5 }, stepIndex: 0, temp: 0 }
    ])
    assert.deepEqual(alias.params.bgColor, canonical.params.bgColor)
    assert.equal(alias.params.bgOpacity, 0.5)
})

test('an authored color survives whichever form the compiler emits', () => {
    // The compiler emits a hex string for a defaulted color and an RGBA float
    // array for an authored one. Both must reach the canvas as the same RGB.
    const [asArray] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', color: [1, 0, 0, 1] }, stepIndex: 0, temp: 0 }
    ])
    assert.deepEqual(asArray.params.color, [1, 0, 0])

    const [asHex] = textEffectsFromParsed([
        { name: 'text', fullName: 'filter.text', args: { text: 'hi', color: '#ff0000' }, stepIndex: 0, temp: 0 }
    ])
    assert.deepEqual(asHex.params.color, [1, 0, 0])
})

test('toRgb handles both compiler color encodings', () => {
    assert.deepEqual(toRgb('#ffffff'), [1, 1, 1])
    assert.deepEqual(toRgb('#000000'), [0, 0, 0])
    assert.deepEqual(toRgb('ff0000'), [1, 0, 0])
    assert.deepEqual(toRgb([0.5, 0.25, 0.125, 1]), [0.5, 0.25, 0.125])
    assert.deepEqual(toRgb('not a color'), [1, 1, 1])
    assert.deepEqual(toRgb(null), [1, 1, 1])
})

test('the effect is matched by name or by fully-qualified name', () => {
    assert.equal(textEffectsFromParsed([{ effectKey: 'filter.text', args: { text: 'a' }, temp: 0 }]).length, 1)
    assert.equal(textEffectsFromParsed([{ fullName: 'filter.text', args: { text: 'a' }, temp: 0 }]).length, 1)
    assert.equal(textEffectsFromParsed([{ name: 'text', args: { text: 'a' }, temp: 0 }]).length, 1)
})

test('effects whose names merely contain "text" are not treated as text', () => {
    assert.deepEqual(textEffectsFromParsed([
        { name: 'testPattern', fullName: 'synth.testPattern', args: {}, temp: 0 },
        { name: 'glyphMap', fullName: 'filter.glyphMap', args: {}, temp: 1 }
    ]), [])
})
