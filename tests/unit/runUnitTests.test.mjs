import assert from 'node:assert/strict'
import test from 'node:test'

import { chooseSuite, selectTests } from '../../scripts/run-unit-tests.mjs'

const ALL = [
    'contextLoss.test.mjs',
    'renderer-backend.test.mjs',
    'scrubber.test.mjs',
    'syncOutput.test.mjs'
]

const readTest = name => {
    if (name === 'contextLoss.test.mjs') {
        return "readFileSync(new URL('../../public/js/noisemaker/renderer.js', import.meta.url))"
    }
    if (name === 'renderer-backend.test.mjs') {
        return "import ... from '../../public/js/noisemaker/renderer.js'"
    }
    if (name === 'syncOutput.test.mjs') {
        return "import ... from '../../public/js/syncOutput.js'"
    }
    return "import ... from '../../public/js/ui/scrubber.js'"
}

test('no changed paths selects the whole unit suite', () => {
    assert.deepEqual(selectTests([], ALL, readTest), ALL)
    assert.deepEqual(selectTests(undefined, ALL, readTest), ALL)
})

test('a changed source path selects the tests that exercise it', () => {
    const selected = selectTests(['public/js/noisemaker/renderer.js'], ALL, readTest)
    assert.deepEqual(selected, ['contextLoss.test.mjs', 'renderer-backend.test.mjs'])
})

test('a changed test file selects itself', () => {
    const selected = selectTests(['tests/unit/scrubber.test.mjs'], ALL, readTest)
    assert.deepEqual(selected, ['scrubber.test.mjs'])
})

test('a changed path no unit test exercises selects nothing', () => {
    assert.deepEqual(selectTests(['docs/unrelated.md'], ALL, readTest), [])
})

test('a Playwright-only change runs no unit test through this entrypoint', () => {
    // The unit runner cannot execute Playwright specs. For such a change the
    // focused run stays empty and the entrypoint exits without spawning node:
    // the specs run through the browser entrypoint and exact-source CI, and a
    // whole-suite fallback would only rerun unrelated unit tests.
    const selected = selectTests(
        ['tests/sync-native-context-loss-receiver.spec.js'], ALL, readTest)
    assert.deepEqual(selected, [])
    assert.deepEqual(chooseSuite(selected, ['tests/sync-native-context-loss-receiver.spec.js']), [])
})

test('a changed source path and its test select both together', () => {
    const selected = selectTests(
        ['public/js/syncOutput.js', 'tests/unit/syncOutput.test.mjs'], ALL, readTest)
    assert.deepEqual(selected, ['syncOutput.test.mjs'])
})
