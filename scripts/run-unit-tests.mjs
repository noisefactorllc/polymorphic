/**
 * Test entrypoint for the polymorphic repository.
 *
 * With NM_CHANGED_FILES unset this runs the whole unit suite, exactly as the
 * previous `node --test tests/unit/*.test.mjs` invocation did. With
 * NM_CHANGED_FILES set (one changed repository path per line, provided by the
 * supervisor) it runs only the tests that exercise those paths: the changed
 * unit tests themselves, every unit test whose source names a changed file by
 * repository path or module basename, and every Playwright spec that is
 * changed or whose source names a changed path or module basename, run
 * through the repository's browser entrypoint.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
 * @returns {string[]} The spawn argv after the executable
 */
export function specCommand(specPaths) {
    return ['node_modules/@playwright/test/cli.js', 'test', ...specPaths, '--workers=1']
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
    if (suite.length === 0 && specs.length === 0) {
        // `node --test` with no file arguments runs a default discovery over
        // the repository, which fails on unrelated environment-dependent
        // files. An empty focused run must therefore exit instead of spawning.
        console.log('no unit tests exercise the changed paths; nothing to run')
        process.exit(0)
    }

    if (suite.length > 0) {
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
        const e2e = spawnSync(
            process.execPath,
            specCommand(specs.map(name => path.join('tests', name))),
            { stdio: 'inherit', cwd: root }
        )
        process.exit(e2e.status ?? 1)
    }

    process.exit(0)
}
