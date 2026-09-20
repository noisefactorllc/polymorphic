import { test } from 'node:test'
import assert from 'node:assert'
import { parseErrorLocation, formatErrorLabel } from '../../public/js/ui/errorBanner.js'

test('parses "at line 7 col 11"', () => {
    assert.deepStrictEqual(
        parseErrorLocation("Unexpected character '@' at line 7 col 11"),
        { line: 7, col: 11 }
    )
})

test('parses "line 3, column 5"', () => {
    assert.deepStrictEqual(
        parseErrorLocation('Bad token (line 3, column 5)'),
        { line: 3, col: 5 }
    )
})

test('parses "line 12:5: syntax error"', () => {
    assert.deepStrictEqual(
        parseErrorLocation('line 12:5: syntax error'),
        { line: 12, col: 5 }
    )
})

test('parses "at line 12:5"', () => {
    assert.deepStrictEqual(
        parseErrorLocation('Unexpected token at line 12:5'),
        { line: 12, col: 5 }
    )
})

test('parses line without column and defaults col to 1', () => {
    assert.deepStrictEqual(
        parseErrorLocation('Error at line 42'),
        { line: 42, col: 1 }
    )
    assert.deepStrictEqual(
        parseErrorLocation('Line 15: unexpected token'),
        { line: 15, col: 1 }
    )
})

test('parses Noisemaker DSL format "--> line 8, column 28"', () => {
    assert.deepStrictEqual(
        parseErrorLocation('--> line 8, column 28\nosc() unknown parameter'),
        { line: 8, col: 28 }
    )
})

test('parses bracketed locations [line 4, col 2] and [3:5]', () => {
    assert.deepStrictEqual(
        parseErrorLocation('Error [line 4, col 2]'),
        { line: 4, col: 2 }
    )
    assert.deepStrictEqual(
        parseErrorLocation('Error [3:5]'),
        { line: 3, col: 5 }
    )
    assert.deepStrictEqual(
        parseErrorLocation('Error (3:5)'),
        { line: 3, col: 5 }
    )
})

test('parses GLSL shader compiler error logs', () => {
    assert.deepStrictEqual(
        parseErrorLocation("ERROR: 0:42: 'foo' : undeclared identifier"),
        { line: 42, col: 1 }
    )
    assert.deepStrictEqual(
        parseErrorLocation("ERROR: 0:42(10): 'foo' : syntax error"),
        { line: 42, col: 10 }
    )
    assert.deepStrictEqual(
        parseErrorLocation("0:19: 'bar' : syntax error"),
        { line: 19, col: 1 }
    )
})

test('parses WGSL compiler error logs', () => {
    assert.deepStrictEqual(
        parseErrorLocation('15:12: error: unresolved identifier'),
        { line: 15, col: 12 }
    )
    assert.deepStrictEqual(
        parseErrorLocation('15:12 error: syntax error'),
        { line: 15, col: 12 }
    )
})

test('parses error banner formatted message "line 7:11 — message"', () => {
    assert.deepStrictEqual(
        parseErrorLocation("line 7:11 — Unexpected character '@'"),
        { line: 7, col: 11 }
    )
})

test('returns null when no location or invalid', () => {
    assert.strictEqual(parseErrorLocation('Generic error'), null)
    assert.strictEqual(parseErrorLocation(''), null)
    assert.strictEqual(parseErrorLocation(null), null)
    assert.strictEqual(parseErrorLocation(undefined), null)
    assert.strictEqual(parseErrorLocation('HTTP 404: Not found'), null)
    assert.strictEqual(parseErrorLocation('Version 2.0.1 released'), null)
    assert.strictEqual(parseErrorLocation('line 0 col 0'), null)
    assert.strictEqual(parseErrorLocation('pipeline 12:4 finished'), null)
})

test('formatErrorLabel formats cleanly with location prefix', () => {
    assert.strictEqual(
        formatErrorLabel("Unexpected character '@' at line 7 col 11", { line: 7, col: 11 }),
        "line 7:11 — Unexpected character '@'"
    )
    assert.strictEqual(
        formatErrorLabel("SyntaxError: bad token at line 3 col 5", { line: 3, col: 5 }),
        "line 3:5 — bad token"
    )
    assert.strictEqual(
        formatErrorLabel("line 12:5: syntax error", { line: 12, col: 5 }),
        "line 12:5 — syntax error"
    )
    assert.strictEqual(
        formatErrorLabel("15:12: error: unresolved identifier", { line: 15, col: 12 }),
        "line 15:12 — unresolved identifier"
    )
    assert.strictEqual(
        formatErrorLabel("ERROR: 0:42: 'foo' : syntax error", { line: 42, col: 1 }),
        "line 42:1 — 'foo' : syntax error"
    )
    assert.strictEqual(
        formatErrorLabel("line 7:11 — Bad token", { line: 7, col: 11 }),
        "line 7:11 — Bad token"
    )
    assert.strictEqual(
        formatErrorLabel("Generic compiler error", null),
        "Generic compiler error"
    )
    assert.strictEqual(
        formatErrorLabel("", null),
        ""
    )
})

