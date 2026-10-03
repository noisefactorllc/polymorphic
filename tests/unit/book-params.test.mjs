/**
 * The resolution rules in scripts/check-book-params.mjs.
 *
 * The check is only worth having if it fails on the drift that actually
 * happened, so the cases below are the real ones: synth/cell's `metric`, which
 * had been renamed to `shape`, and its `smooth`, which had been renamed to
 * `cellSmooth`. The second is the interesting one. `smooth` is also the name
 * of an effect, and synth/cell has a parameter *labelled* "cell smooth", so a
 * naive check resolved the stale name twice over and passed. Both holes are
 * pinned here.
 *
 * The program-level cases pin argument precision the same way: a value of the
 * wrong type (`text(text: 42)`), an unknown argument, a positional argument
 * matched to the signature order, and `media()` — which the book gives no
 * page but a program may still call — checked against the engine's extracted
 * signature. A page whose arguments drift from the compiler's signature must
 * fail here, not reach readers as code that does not run.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildIndex, checkParagraph, checkProgram, extractCalls, parseCallArgs, parseNamedArgs } from '../../scripts/check-book-params.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A miniature engine, shaped like book/data/effects.json. */
const data = {
    effects: [
        {
            id: 'synth/cell',
            func: 'cell',
            params: [
                { name: 'shape', label: 'shape', choices: ['circle', 'diamond', 'hexagon'] },
                { name: 'cellSmooth', label: 'cell smooth', choices: null },
                { name: 'speed', label: 'speed', choices: null },
            ],
        },
        {
            id: 'synth/polygon',
            func: 'polygon',
            params: [{ name: 'smooth', label: 'smooth', choices: null }],
        },
        // An effect that shares its name with synth/polygon's parameter.
        { id: 'filter/smooth', func: 'smooth', params: [{ name: 'amount', label: 'amount', choices: null }] },
        {
            id: 'render/pointsRender',
            func: 'pointsRender',
            params: [{ name: 'viewMode', label: 'view mode', type: 'int', choices: ['flat', 'ortho'] }],
        },
        // text() and media(), shaped like the engine's filter/text and
        // synth/media: free-form string parameters with no choices, numeric
        // parameters, and — for media — an alias the engine resolves to its
        // declared global.
        {
            id: 'filter/text',
            func: 'text',
            params: [
                { name: 'text', label: 'text', type: 'string', choices: null },
                { name: 'font', label: 'font', type: 'string', choices: ['serif', 'mono'] },
                { name: 'size', label: 'size', type: 'float', choices: null },
            ],
        },
        {
            id: 'synth/media',
            func: 'media',
            params: [
                { name: 'position', label: 'position', type: 'int', choices: ['midCenter', 'topRight'] },
                { name: 'scaleAmt', label: 'scale %', type: 'float', choices: null },
                { name: 'bgColor', label: 'bg color', type: 'color', choices: null },
                { name: 'bgAlpha', label: 'bg opacity', type: 'float', choices: null },
            ],
            aliases: { backgroundColor: 'bgColor' },
        },
    ],
}
const index = buildIndex(data)
const cell = data.effects[0]
const check = (paragraph, effect = cell) => checkParagraph(paragraph, effect, index)

test('a parameter of the page\'s own effect resolves', () => {
    assert.deepEqual(check('`shape` is the parameter that changes the character most.'), [])
    assert.deepEqual(check('`cellSmooth` rounds the joins, and `speed` lets the points drift.'), [])
})

test('an enum choice of the page\'s own effect resolves', () => {
    assert.deepEqual(check('It can measure to a `diamond` or a `hexagon`.'), [])
})

test('a renamed parameter is caught', () => {
    assert.deepEqual(check('`metric` is the parameter that changes the character most.'), ['metric'])
})

test('a renamed parameter is caught even when an effect shares its name', () => {
    // The regression that motivated the call-form rule: `smooth` is an effect,
    // so a bare mention used to resolve as a cross reference and hide the fact
    // that cell's parameter had become `cellSmooth`.
    assert.deepEqual(check('`smooth` rounds the joins between neighbouring cells.'), ['smooth'])
})

test('a multi-word parameter label does not lend its words to the prose', () => {
    // cell has a parameter labelled "cell smooth". Splitting that label into
    // words would resolve the stale `smooth` above against the very parameter
    // it had been renamed away from.
    assert.deepEqual(check('`cell` is not a parameter.'), ['cell'])
})

test('an effect cross reference resolves in call form only', () => {
    assert.deepEqual(check('The counterpart of `polygon()` from the first chapter.'), [])
    assert.deepEqual(check('The counterpart of `polygon` from the first chapter.'), ['polygon'])
})

test('an effect called in the paragraph lends its parameters to that paragraph', () => {
    // points/attractor's page says to watch it with `pointsRender(viewMode: ortho)`.
    // `viewMode` and `ortho` belong to pointsRender, not to the page's effect.
    assert.deepEqual(check('Worth watching with `pointsRender(viewMode: ortho)`.'), [])
    // The same names with nothing naming their owner are unresolved.
    assert.deepEqual(check('Set `viewMode` to `ortho`.'), ['viewMode', 'ortho'])
})

test('the lending is scoped to one paragraph, not the whole page', () => {
    assert.deepEqual(check('Use `pointsRender(viewMode: ortho)`.'), [])
    assert.deepEqual(check('Then set `ortho`.'), ['ortho'])
})

test('DSL vocabulary and literals resolve', () => {
    assert.deepEqual(check('`cell().write(o0)` then `render(o0)`.'), [])
    assert.deepEqual(check('Try `speed: 0.5` or `shape: 3`.'), [])
})

test('prose with no code spans is always fine', () => {
    assert.deepEqual(check('A field of cells, like foam or cracked mud.'), [])
})

const checkProg = (program, effect = cell) => checkProgram(program, effect, index)

test('a demonstration program with valid parameters and choices resolves', () => {
    assert.deepEqual(checkProg('cell(shape: hexagon, speed: 0.5).write(o0)\nrender(o0)'), [])
    assert.deepEqual(checkProg('cell().pointsRender(viewMode: ortho).write(o0)\nrender(o0)'), [])
})

test('a demonstration program calling an unknown effect fails', () => {
    const fails = checkProg('unknownEffect().write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].call, 'unknownEffect')
    assert.match(fails[0].why, /unknown effect/)
})

test('a demonstration program with an invalid parameter name fails', () => {
    const fails = checkProg('cell(metric: hexagon).write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].param, 'metric')
    assert.match(fails[0].why, /not a parameter of cell\(\)/)
})

test('a demonstration program with an invalid enum choice fails', () => {
    const fails = checkProg('pointsRender(viewMode: invalidChoice).write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].param, 'viewMode')
    assert.equal(fails[0].value, 'invalidChoice')
    assert.match(fails[0].why, /not a valid choice/)
})

test('a demonstration program passing a numeric literal to an enum parameter fails', () => {
    const fails = checkProg('pointsRender(viewMode: 1).write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].param, 'viewMode')
    assert.equal(fails[0].value, '1')
    assert.match(fails[0].why, /not a valid choice/)
})

test('a demonstration program with dynamic expressions or buffer arguments resolves', () => {
    assert.deepEqual(checkProg('cell(speed: read(o1)).write(o0)\nrender(o0)'), [])
    assert.deepEqual(checkProg('cell(shape: read3d(o1)).write(o0)\nrender(o0)'), [])
    assert.deepEqual(checkProg('cell(shape: palette.warm).write(o0)\nrender(o0)'), [])
})

test('parseNamedArgs preserves strings with commas and colons without misinterpreting parameters', () => {
    const args = parseNamedArgs('text: "Hello, note: world", size: 24, font: \'sans, serif\'')
    assert.deepEqual(args, [
        { name: 'text', value: '"Hello, note: world"' },
        { name: 'size', value: '24' },
        { name: 'font', value: "'sans, serif'" },
    ])
})

test('extractCalls handles strings with parens and line comments without cutting off arguments', () => {
    const dsl = `
        // noise(ignored: true)
        noise(scale: 50)
          .text(text: "smile :) (really)", font: "mono")
          .write(o0)
        render(o0)
    `
    const calls = extractCalls(dsl)
    assert.equal(calls.length, 4)
    assert.equal(calls[0].name, 'noise')
    assert.equal(calls[1].name, 'text')
    assert.equal(calls[1].argsStr.includes('smile :) (really)'), true)
    assert.equal(calls[1].argsStr.includes('font: "mono"'), true)
    assert.equal(calls[2].name, 'write')
    assert.equal(calls[3].name, 'render')
})

test('parseCallArgs keeps positional and named arguments in source order', () => {
    const args = parseCallArgs('"hello", font: serif, 0.2, size: 0.4')
    assert.deepEqual(args, [
        { name: null, value: '"hello"' },
        { name: 'font', value: 'serif' },
        { name: null, value: '0.2' },
        { name: 'size', value: '0.4' },
    ])
})

test('a number passed to text()\'s string parameter fails', () => {
    const fails = checkProg('text(text: 42).write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].call, 'text')
    assert.equal(fails[0].param, 'text')
    assert.equal(fails[0].value, '42')
    assert.match(fails[0].why, /expects a string/)
})

test('a string passed to a float parameter fails', () => {
    const fails = checkProg('text(size: "big").write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].param, 'size')
    assert.equal(fails[0].value, '"big"')
    assert.match(fails[0].why, /expects a number/)
})

test('an unknown argument on text() fails', () => {
    const fails = checkProg('text(wibble: 1).write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].param, 'wibble')
    assert.match(fails[0].why, /"wibble" is not a parameter of text\(\)/)
})

test('a valid text() call resolves', () => {
    assert.deepEqual(checkProg('text(text: "hello", font: serif, size: 0.2).write(o0)\nrender(o0)'), [])
    // The engine writes a bare identifier for a string value that reads as
    // one, and a quoted literal otherwise.
    assert.deepEqual(checkProg('text(font: "serif", text: """two\nlines""").write(o0)\nrender(o0)'), [])
})

test('positional arguments are matched to the signature order', () => {
    // The engine's filter/text signature: text, font, size.
    assert.deepEqual(checkProg('text("hello").write(o0)\nrender(o0)'), [])
    assert.deepEqual(checkProg('text("hello", serif, 0.2).write(o0)\nrender(o0)'), [])
    // A positional argument still gets its parameter's type check...
    const typeMismatch = checkProg('text(42).write(o0)\nrender(o0)')
    assert.equal(typeMismatch.length, 1)
    assert.equal(typeMismatch[0].param, 'text')
    assert.match(typeMismatch[0].why, /expects a string/)
    // ...and too many positional arguments is an unknown argument.
    const overflow = checkProg('text("a", serif, 0.1, "extra").write(o0)\nrender(o0)')
    assert.equal(overflow.length, 1)
    assert.match(overflow[0].why, /exceeds the 3 parameter\(s\) of text\(\)/)
})

test('a media() argument the engine does not accept fails', () => {
    const fails = checkProg('media(src: "x").write(o0)\nrender(o0)')
    assert.equal(fails.length, 1)
    assert.equal(fails[0].call, 'media')
    assert.equal(fails[0].param, 'src')
    assert.match(fails[0].why, /"src" is not a parameter of media\(\)/)
})

test('a valid media() call resolves, including its alias and app-owned url', () => {
    assert.deepEqual(checkProg('media(position: midCenter, scaleAmt: 100).write(o0)\nrender(o0)'), [])
    assert.deepEqual(checkProg('media(backgroundColor: #ff0000, bgAlpha: 1).write(o0)\nrender(o0)'), [])
    // url is not an engine parameter — the engine rejects it at compile — but
    // the app strips it before compiling (dslSanitize.js), so it still runs.
    assert.deepEqual(checkProg('media(url: "https://example.com/x.png").write(o0)\nrender(o0)'), [])
    // A url is carried as a string, not a number.
    const badUrl = checkProg('media(url: 42).write(o0)\nrender(o0)')
    assert.equal(badUrl.length, 1)
    assert.match(badUrl[0].why, /"url" is not a parameter of media\(\)/)
})

test('the committed engine signatures for text() and media() resolve against the book index', () => {
    const book = JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'book', 'data', 'effects.json'), 'utf8'))
    const bookIndex = buildIndex(book)
    assert.equal(bookIndex.funcs.has('text'), true, 'filter/text missing from the book index')
    assert.equal(bookIndex.funcs.has('media'), true, 'the excluded synth/media signature is missing from the book index')
    const program = (call) => `${call}.write(o0)\nrender(o0)`
    assert.deepEqual(checkProgram(program('text(text: "hello", font: serif, size: 0.2)'), null, bookIndex), [])
    assert.deepEqual(checkProgram(program('media(position: midCenter, scaleAmt: 100)'), null, bookIndex), [])
    const mediaUnknown = checkProgram(program('media(orientation: topRight)'), null, bookIndex)
    assert.equal(mediaUnknown.length, 1)
    assert.match(mediaUnknown[0].why, /"orientation" is not a parameter of media\(\)/)
    const textNumber = checkProgram(program('text(text: 42)'), null, bookIndex)
    assert.equal(textNumber.length, 1)
    assert.match(textNumber[0].why, /expects a string/)
})

