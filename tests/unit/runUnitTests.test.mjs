import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chooseSuite, selectSpecs, selectTests, specCommand } from '../../scripts/run-unit-tests.mjs'

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
    // The unit runner cannot execute Playwright specs directly. For such a
    // change the focused unit selection stays empty: the spec itself is
    // routed to the browser entrypoint by selectSpecs, and a whole-suite
    // fallback would only rerun unrelated unit tests.
    const changed = ['tests/sync-native-context-loss-receiver.spec.js']
    assert.deepEqual(selectTests(changed, ALL, readTest), [])
    assert.deepEqual(chooseSuite([], changed), [])
})

const ALL_SPECS = [
    'context-loss.spec.js',
    'gallery.spec.js',
    'sync-native.spec.js'
]

const readSpec = name => {
    if (name === 'context-loss.spec.js') {
        return "import { installHandfishLocal } from './handfishLocal.js'"
    }
    if (name === 'sync-native.spec.js') {
        return "import { harness } from './syncNativeHarness.js'"
    }
    return "import ... from './galleryKeyboardFixtures.js'"
}

test('selectSpecs selects nothing when NM_CHANGED_FILES is unset', () => {
    assert.deepEqual(selectSpecs([], ALL_SPECS, readSpec), [])
    assert.deepEqual(selectSpecs(undefined, ALL_SPECS, readSpec), [])
})

test('a changed spec selects itself', () => {
    assert.deepEqual(
        selectSpecs(['tests/context-loss.spec.js'], ALL_SPECS, readSpec),
        ['context-loss.spec.js'])
})

test('a changed spec-support helper selects the specs that name it', () => {
    assert.deepEqual(
        selectSpecs(['tests/syncNativeHarness.js'], ALL_SPECS, readSpec),
        ['sync-native.spec.js'])
})

test('a changed app source selects specs whose text names it', () => {
    assert.deepEqual(
        selectSpecs(['public/js/app.js'], ALL_SPECS, name =>
            name === 'gallery.spec.js' ? "import ... from '../../public/js/app.js'" : 'no match'),
        ['gallery.spec.js'])
})

test('specCommand builds the browser entrypoint argv', () => {
    assert.deepEqual(
        specCommand(['tests/context-loss.spec.js']),
        ['node_modules/@playwright/test/cli.js', 'test', 'tests/context-loss.spec.js', '--workers=1'])
})

test('the entrypoint exits without spawning for a change nothing exercises', () => {
    // Process-level check of scripts/run-unit-tests.mjs: with NM_CHANGED_FILES
    // naming a path no unit test mentions and that is not a Playwright spec,
    // the focused selection is empty and the entrypoint must print its notice
    // and exit 0 without spawning node --test or the browser entrypoint.
    const result = spawnSync(
        process.execPath,
        [join(ROOT, 'scripts', 'run-unit-tests.mjs')],
        {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, NM_CHANGED_FILES: 'docs/unrelated-' + 'topic.md' },
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
