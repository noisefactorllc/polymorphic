import { test } from 'node:test'
import assert from 'node:assert'
import { formatDsl } from '../../public/js/ui/formatter.js'
import { patchProgramText } from '../../public/js/ui/editorActions.js'
import { stripMediaUrlArg, restoreMediaUrls } from '../../public/js/noisemaker/dslSanitize.js'
import { textEffectsFromParsed } from '../../public/js/noisemaker/textParams.js'

// Noisemaker 1.5.2 keeps a chain element's `_id:` meta keyword and writes it
// back first among the keywords; builtin `read` steps come back in keyword
// form. The engine's expander skips `_id` as a uniform, so ids compile to the
// same graph and render the same pixels. These fixtures are the engine's
// verbatim `unparse()` and `extractEffectsFromDsl()` output for a program that
// carries ids on chain elements and builtin steps, captured from the live CDN
// bundle this app loads.
//
// Source program:
//
//   search synth, filter
//
//   noise(_id: "a").write(o0)
//
//   read(o0, _id: "r").invert(_id: "f1").invert(_id: "f2")
//     .text(text: """Hello scene""", _id: "t1")
//     .write(o0, _id: "w1")
//
//   render(o0)
const ENGINE_UNPARSE = [
    'search synth, filter',
    '',
    'noise(_id: "a")',
    '  .write(o0)',
    '',
    'read(_id: "r", surface: o0)',
    '  .invert(_id: "f1")',
    '  .invert(_id: "f2")',
    '  .text(_id: "t1", text: "Hello scene")',
    '  .write(o0, _id: "w1")',
    '',
    'render(o0)',
].join('\n')

const ENGINE_EXTRACT = [
    {
        effectKey: 'synth.noise', name: 'noise', fullName: 'synth.noise',
        args: { type: 10, octaves: 2, scaleX: 75, scaleY: 75, seed: 1, wrap: true, ridges: false, loopOffset: 300, loopScale: 75, speed: 25, colorMode: 1, _id: 'a' },
        rawKwargs: { _id: { type: 'String', value: 'a' } },
        stepIndex: 0, temp: 0,
    },
    {
        effectKey: '_write', name: '_write', fullName: '_write',
        args: { tex: { kind: 'output', name: 'o0' } },
        rawKwargs: {},
        stepIndex: 1, temp: 1,
    },
    {
        effectKey: '_read', name: '_read', fullName: '_read',
        args: { tex: { kind: 'output', name: 'o0' }, _id: 'r' },
        rawKwargs: {},
        stepIndex: 2, temp: 2,
    },
    {
        effectKey: 'filter.invert', name: 'invert', fullName: 'filter.invert',
        args: { mode: 0, _id: 'f1' },
        rawKwargs: { _id: { type: 'String', value: 'f1' } },
        stepIndex: 3, temp: 3,
    },
    {
        effectKey: 'filter.invert', name: 'invert', fullName: 'filter.invert',
        args: { mode: 0, _id: 'f2' },
        rawKwargs: { _id: { type: 'String', value: 'f2' } },
        stepIndex: 4, temp: 4,
    },
    {
        effectKey: 'filter.text', name: 'text', fullName: 'filter.text',
        args: { text: 'Hello scene', font: 'Nunito', size: 0.1, posX: 0.5, posY: 0.5, rotation: 0, color: '#ffffff', matteColor: [0, 0, 0], matteOpacity: 0, justify: 'center', style: '', _id: 't1' },
        rawKwargs: { _id: { type: 'String', value: 't1' } },
        stepIndex: 5, temp: 5,
    },
    {
        effectKey: '_write', name: '_write', fullName: '_write',
        args: { tex: { kind: 'output', name: 'o0' }, _id: 'w1' },
        rawKwargs: {},
        stepIndex: 6, temp: 6,
    },
]

const WITHOUT_IDS = ENGINE_UNPARSE
    .replace('noise(_id: "a")', 'noise()')
    .replace('read(_id: "r", surface: o0)', 'read(o0)')
    .replace('invert(_id: "f1")', 'invert()')
    .replace('invert(_id: "f2")', 'invert()')
    .replace('.text(_id: "t1", text: "Hello scene")', '.text(text: "Hello scene")')
    .replace('write(o0, _id: "w1")', 'write(o0)')

test('the formatter keeps the engine-written ids and stays idempotent', () => {
    const once = formatDsl(ENGINE_UNPARSE)
    assert.ok(once.includes('noise(_id: "a")'), `formatter dropped the chain id:\n${once}`)
    assert.ok(once.includes('read(_id: "r", surface: o0)'), `formatter dropped the read id:\n${once}`)
    assert.ok(once.includes('invert(_id: "f1")'), `formatter dropped the first invert id:\n${once}`)
    assert.ok(once.includes('invert(_id: "f2")'), `formatter dropped the second invert id:\n${once}`)
    assert.ok(once.includes('write(o0, _id: "w1")'), `formatter dropped the write id:\n${once}`)
    assert.strictEqual(formatDsl(once), once)
})

test('the formatter keeps the ids when the engine output changes shape', () => {
    // A one-line program round-trips into the same formatted text as the
    // multi-line engine output, so a saved program never loses its ids.
    const single = 'search synth, filter\nnoise(_id: "a").write(o0)\n\nread(o0, _id: "r").invert(_id: "f1").write(o0)\n\nrender(o0)'
    const once = formatDsl(single)
    assert.ok(once.includes('_id: "a"'), `formatter dropped the chain id:\n${once}`)
    assert.ok(once.includes('_id: "r"'), `formatter dropped the read id:\n${once}`)
    assert.ok(once.includes('_id: "f1"'), `formatter dropped the invert id:\n${once}`)
    assert.strictEqual(formatDsl(once), once)
})

test('patchProgramText applies a value change and keeps the ids', () => {
    const base = formatDsl(ENGINE_UNPARSE)
    const regenerated = base.replace('invert(_id: "f1")', 'invert(_id: "f1", amount: 0.5)')
    const patched = patchProgramText(base, regenerated)
    assert.ok(patched.includes('amount: 0.5'), `patch lost the change:\n${patched}`)
    assert.ok(patched.includes('_id: "a"'), `patch dropped the chain id:\n${patched}`)
    assert.ok(patched.includes('_id: "r"'), `patch dropped the read id:\n${patched}`)
    assert.ok(patched.includes('_id: "f2"'), `patch dropped the second invert id:\n${patched}`)
    assert.ok(patched.includes('_id: "w1"'), `patch dropped the write id:\n${patched}`)
})

test('media url strip and restore keep the ids', () => {
    const source = 'search synth\nnoise(_id: "a").media(url: "https://x/img.png", _id: "m").write(o0)\nrender(o0)'
    const stripped = stripMediaUrlArg(source)
    assert.ok(!stripped.includes('url:'), `strip left the url:\n${stripped}`)
    assert.ok(stripped.includes('_id: "a"'), `strip dropped the chain id:\n${stripped}`)
    assert.ok(stripped.includes('_id: "m"'), `strip dropped the media id:\n${stripped}`)
    assert.strictEqual(restoreMediaUrls(source, stripped), source)
})

test('text extraction reads an id-carrying text step at its own step index', () => {
    const found = textEffectsFromParsed(ENGINE_EXTRACT)
    assert.strictEqual(found.length, 1)
    assert.strictEqual(found[0].stepIndex, 5)
    assert.strictEqual(found[0].params.text, 'Hello scene')
    assert.deepEqual(found[0].params.matteColor, [0, 0, 0])
})

test('the id-carrying text step indexes the same as the program without ids', () => {
    const withoutIds = ENGINE_EXTRACT.map(entry => {
        const args = { ...entry.args }
        delete args._id
        return { ...entry, args, rawKwargs: {} }
    })
    assert.strictEqual(textEffectsFromParsed(ENGINE_EXTRACT)[0].stepIndex,
        textEffectsFromParsed(withoutIds)[0].stepIndex)
})
