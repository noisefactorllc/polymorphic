/**
 * Test entrypoint for the polymorphic repository.
 *
 * With NM_CHANGED_FILES unset this runs the whole unit suite, exactly as the
 * previous `node --test tests/unit/*.test.mjs` invocation did. With
 * NM_CHANGED_FILES set (one changed repository path per line, provided by the
 * changed-paths harness) it runs only the tests that exercise those paths: the changed
 * unit tests themselves, every unit test whose source names a changed file by
 * repository path or module basename, and every Playwright spec that is
 * changed or whose source names a changed path or module basename, run
 * through the repository's browser entrypoint.
 */
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const unitDir = path.join(root, 'tests', 'unit')
const testsDir = path.join(root, 'tests')

/**
 * Select the unit test files that exercise the changed paths.
 * @param {string[]} changed - Changed repository paths, one per entry
 * @param {string[]} all - Every unit test file name
 * @param {(name: string) => string} readTest - Reads one unit test file's text
 * @returns {string[]} Selected unit test file names, in `all` order
 */
export function selectTests(changed, all, readTest) {
    if (!changed || changed.length === 0) return all.slice()
    const changedTests = new Set(
        changed
            .map(file => path.basename(file))
            .filter(base => base.endsWith('.test.mjs'))
    )
    const sources = changed.filter(file => !file.endsWith('.test.mjs'))
    return all.filter(name => {
        if (changedTests.has(name)) return true
        const text = readTest(name)
        return sources.some(file =>
            text.includes(file) || text.includes(path.basename(file)))
    })
}

/**
 * Select the Playwright specs that exercise the changed paths, mirroring
 * selectTests: the changed spec files themselves, plus every spec whose
 * source names a changed file by repository path or module basename (this
 * covers spec-support helpers and app sources that only specs exercise).
 * With no changed paths the whole-suite behavior stays unit-only, exactly as
 * before the focused mode existed.
 * @param {string[]} changed - Changed repository paths, one per entry
 * @param {string[]} all - Every Playwright spec file name
 * @param {(name: string) => string} readSpec - Reads one spec file's text
 * @returns {string[]} Selected spec file names, in `all` order
 */
export function selectSpecs(changed, all, readSpec) {
    if (!changed || changed.length === 0) return []
    const changedSpecs = new Set(
        changed
            .map(file => path.basename(file))
            .filter(base => base.endsWith('.spec.js'))
    )
    const sources = changed.filter(file => !file.endsWith('.spec.js'))
    return all.filter(name => {
        if (changedSpecs.has(name)) return true
        const text = readSpec(name)
        return sources.some(file =>
            text.includes(file) || text.includes(path.basename(file)))
    })
}

/**
 * Build the argv for the browser entrypoint run of the selected specs.
 * @param {string[]} specPaths - Spec paths, relative to the repository root
 * @param {{index: number, count: number} | null} [shard=null] - When set, run
 *   only one shard of the selected tests (Playwright shards are 1-based; the
 *   entrypoint's NM_SHARD_INDEX is 0-based, so the argv converts it).
 * @returns {string[]} The spawn argv after the executable
 */
export function specCommand(specPaths, shard = null) {
    const argv = ['node_modules/@playwright/test/cli.js', 'test', ...specPaths, '--workers=1']
    if (shard) argv.push(`--shard=${shard.index + 1}/${shard.count}`)
    return argv
}

/**
 * Choose the suite to run. A focused selection may be empty when the changed
 * paths name only tests this runner cannot execute directly (for example
 * Playwright specs, which selectSpecs routes to the browser entrypoint). Such
 * a run executes no unit test: a whole-suite fallback would only rerun
 * unrelated unit tests.
 * @param {string[]} selected - Focused selection from selectTests
 * @param {string[]} changed - Changed repository paths
 * @returns {string[]} Unit test files to run ([] runs nothing)
 */
export function chooseSuite(selected, changed) {
    return selected.length || changed.length === 0 ? selected : []
}

/**
 * Resolve the Playwright browsers directory. PLAYWRIGHT_BROWSERS_PATH wins.
 * Otherwise prefer a scratch directory next to the system temp dir: a home
 * directory on a noexec mount makes every browser launch fail with EACCES,
 * while the temp area stays executable on the hosts that run these tests.
 * A candidate that cannot hold an executable file is skipped, so a noexec
 * temp dir falls through to the home cache.
 * @param {{probe?: (candidate: string) => boolean}} [options]
 * @returns {string} A browsers directory Playwright may install into
 */
export function resolveBrowsersPath({ probe = defaultProbe } = {}) {
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
    const candidates = [
        path.join(os.tmpdir(), 'pw-browsers'),
        path.join(os.homedir(), '.cache', 'pw-browsers')
    ]
    for (const candidate of candidates) {
        if (probe(candidate)) return candidate
    }
    return candidates[0]
}

/**
 * Whether the mount holding a directory executes files: write a tiny script,
 * mark it executable and run it. Any failure means noexec or a read-only
 * mount.
 * @param {string} candidate - Directory to probe (created when missing)
 * @returns {boolean} Whether a file from the directory could be executed
 */
function defaultProbe(candidate) {
    try {
        mkdirSync(candidate, { recursive: true })
        const probe = path.join(candidate, `.exec-probe-${process.pid}`)
        writeFileSync(probe, '#!/bin/sh\n')
        chmodSync(probe, 0o755)
        const run = spawnSync(probe, [], { timeout: 5000 })
        rmSync(probe, { force: true })
        return run.status === 0
    } catch {
        return false
    }
}

/**
 * Install the Chromium builds the specs launch, into the resolved browsers
 * directory. A cached install revalidates in seconds; a cold one downloads
 * once and every later invocation reuses it.
 * @param {string} browsersPath - Directory to install into
 * @returns {number | null} The installer's exit status (null on spawn failure)
 */
function installBrowsers(browsersPath) {
    const install = spawnSync(
        process.execPath,
        [path.join('node_modules', 'playwright', 'cli.js'), 'install', 'chromium'],
        { stdio: 'inherit', cwd: root, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath } }
    )
    return install.status
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
    const all = readdirSync(unitDir).filter(name => name.endsWith('.test.mjs')).sort()
    const allSpecs = readdirSync(testsDir).filter(name => name.endsWith('.spec.js')).sort()
    const changed = (process.env.NM_CHANGED_FILES || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    const specs = selectSpecs(changed, allSpecs, name => readFileSync(path.join(testsDir, name), 'utf8'))
    const selected = selectTests(changed, all, name => readFileSync(path.join(unitDir, name), 'utf8'))
    const suite = chooseSuite(selected, changed)

    // Shard mode. The changed-paths harness sets NM_SHARD_INDEX and
    // NM_SHARD_COUNT when .nm-test-shards declares a count. The selected
    // tests exceed one invocation's time budget, so each invocation runs
    // shard NM_SHARD_INDEX (0-based) of the selected browser tests and only
    // shard 0 also runs the unit suite. Together the shards cover every
    // selected test exactly once.
    const shardIndex = Number.parseInt(process.env.NM_SHARD_INDEX ?? '', 10)
    const shardCount = Number.parseInt(process.env.NM_SHARD_COUNT ?? '', 10)
    const sharded = Number.isInteger(shardIndex) && shardIndex >= 0 &&
        Number.isInteger(shardCount) && shardCount >= 2 && shardIndex < shardCount
    const unitSuite = sharded && shardIndex !== 0 ? [] : suite

    if (unitSuite.length === 0 && specs.length === 0) {
        // `node --test` with no file arguments runs a default discovery over
        // the repository, which fails on unrelated environment-dependent
        // files. An empty focused run must therefore exit instead of spawning.
        console.log('no unit tests exercise the changed paths; nothing to run')
        process.exit(0)
    }

    if (unitSuite.length > 0) {
        const unit = spawnSync(
            process.execPath,
            ['--test', ...suite.map(name => path.join('tests', 'unit', name))],
            { stdio: 'inherit', cwd: root }
        )
        if ((unit.status ?? 1) !== 0) process.exit(unit.status ?? 1)
    }

    if (specs.length > 0) {
        // The selected specs run through the repository's browser entrypoint,
        // one worker, so a focused run still enforces the regression specs
        // its changed paths carry, directly or through a spec-support helper.
        // The browsers install into an executable mount first: a missing or
        // noexec browser cache would fail every launch.
        const browsersPath = resolveBrowsersPath()
        if ((installBrowsers(browsersPath) ?? 1) !== 0) process.exit(1)
        const e2e = spawnSync(
            process.execPath,
            specCommand(specs.map(name => path.join('tests', name)), sharded ? { index: shardIndex, count: shardCount } : null),
            { stdio: 'inherit', cwd: root, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath } }
        )
        process.exit(e2e.status ?? 1)
    }

    process.exit(0)
}
