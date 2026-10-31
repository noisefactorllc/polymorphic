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
const all = readdirSync(unitDir).filter(name => name.endsWith('.test.mjs')).sort()

const changed = (process.env.NM_CHANGED_FILES || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

let selected = all
if (changed.length > 0) {
    const changedTests = new Set(
        changed
            .map(file => path.basename(file))
            .filter(base => base.endsWith('.test.mjs'))
    )
    const sources = changed.filter(file => !file.endsWith('.test.mjs'))
    selected = all.filter(name => {
        if (changedTests.has(name)) return true
        const text = readFileSync(path.join(unitDir, name), 'utf8')
        return sources.some(file =>
            text.includes(file) || text.includes(path.basename(file)))
    })
}

const result = spawnSync(
    process.execPath,
    ['--test', ...selected.map(name => path.join('tests', 'unit', name))],
    { stdio: 'inherit', cwd: root }
)
process.exit(result.status ?? 1)
