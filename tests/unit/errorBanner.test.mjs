import { test } from 'node:test'
import assert from 'node:assert'
import { parseErrorLocation } from '../../public/js/ui/errorBanner.js'

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

test('returns null when no location', () => {
    assert.strictEqual(parseErrorLocation('Generic error'), null)
})
