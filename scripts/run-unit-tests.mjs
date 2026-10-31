/**
 * Unit test runner for the polymorphic test entrypoint.
 *
 * With NM_CHANGED_FILES unset this runs the whole unit suite, exactly as the
 * previous `node --test tests/unit/*.test.mjs` invocation did. With
 * NM_CHANGED_FILES set (one changed repository path per line, provided by the
 * supervisor) it runs only the unit tests that exercise those paths: the
 * changed test files themselves, plus every unit test whose source names a
 * changed file by repository path or module basename.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const unitDir = path.join(root, 'tests', 'unit')

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
 * Choose the suite to run. A focused selection may be empty when the changed
 * paths name only tests this runner cannot execute (for example Playwright
 * specs). Such a run executes no unit test: the specs run through the
 * repository's browser entrypoint and exact-source CI, and a whole-suite
 * fallback would only rerun unrelated unit tests.
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
    const changed = (process.env.NM_CHANGED_FILES || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    const selected = selectTests(changed, all, name => readFileSync(path.join(unitDir, name), 'utf8'))
    const suite = chooseSuite(selected, changed)
    if (suite.length === 0) {
        // `node --test` with no file arguments runs a default discovery over
        // the repository, which fails on unrelated environment-dependent
        // files. An empty focused run must therefore exit instead of spawning.
        console.log('no unit tests exercise the changed paths; nothing to run')
        process.exit(0)
    }

    const result = spawnSync(
        process.execPath,
        ['--test', ...suite.map(name => path.join('tests', 'unit', name))],
        { stdio: 'inherit', cwd: root }
    )
    process.exit(result.status ?? 1)
}
