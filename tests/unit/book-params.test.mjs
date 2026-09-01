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
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildIndex, checkParagraph } from '../../scripts/check-book-params.mjs'

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
            params: [{ name: 'viewMode', label: 'view mode', choices: ['flat', 'ortho'] }],
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
