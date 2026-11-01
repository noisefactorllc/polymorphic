import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chooseSuite, selectTests } from '../../scripts/run-unit-tests.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

test('the entrypoint exits without spawning node for a Playwright-only change', () => {
    // Process-level check of scripts/run-unit-tests.mjs: with NM_CHANGED_FILES
    // naming only a Playwright spec, the focused selection is empty and the
    // entrypoint must print its notice and exit 0 without spawning node
    // --test. The spec path is assembled at run time so this file's text never
    // contains the full spec basename: the runner selects unit tests whose
    // text names a changed path, and a self-match here would make the spawned
    // run select this file again and recurse.
    const changed = ['tests', 'sync-native-' + 'webgpu.spec.js'].join('/')
    const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts', 'run-unit-tests.mjs')],
        {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, NM_CHANGED_FILES: changed },
        })
    assert.equal(result.status, 0)
    assert.match(
        result.stdout,
        /no unit tests exercise the changed paths; nothing to run/)
    // A node --test summary would mean the focused run spawned the suite.
    assert.doesNotMatch(result.stdout, /pass \d+/)
})

test('a changed source path and its test select both together', () => {
    const selected = selectTests(
        ['public/js/syncOutput.js', 'tests/unit/syncOutput.test.mjs'], ALL, readTest)
    assert.deepEqual(selected, ['syncOutput.test.mjs'])
})
