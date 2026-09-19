import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = new URL('../../', import.meta.url)
const data = JSON.parse(readFileSync(new URL('book/data/effects.json', repo), 'utf8'))

function fixture(t, prose = 'A generated page.') {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'polymorphic-book-build-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const effect = data.effects[0]
    const chapter = data.chapters.find(value => value.id === effect.chapter)
    for (const dir of ['scripts', 'book/data', 'book/assets', `book/content/${effect.chapter}`]) {
        mkdirSync(join(root, dir), { recursive: true })
    }
    for (const file of ['build-book.mjs', 'check-book-params.mjs']) {
        copyFileSync(new URL(`scripts/${file}`, repo), join(root, 'scripts', file))
    }
    writeFileSync(join(root, 'book/data/effects.json'), JSON.stringify({ chapters: [chapter], effects: [effect] }))
    const source = join(root, 'book/content', effect.chapter, `${effect.slug}.md`)
    if (prose !== null) {
        writeFileSync(source, `${prose}\n\nFurther reading:\n- Reference | https://example.com/reference\n`)
    }
    return {
        build(setting) {
            const env = { ...process.env }
            delete env.POLYMORPHIC_LINT_DOCUMENTATION
            if (setting !== undefined) env.POLYMORPHIC_LINT_DOCUMENTATION = setting
            return spawnSync(process.execPath, [join(root, 'scripts/build-book.mjs'), '--out', join(root, 'output')], {
                env, encoding: 'utf8', timeout: 10000,
            })
        },
        page: () => readFileSync(join(root, 'output', effect.chapter, effect.slug, 'index.html'), 'utf8'),
    }
}

test('ordinary and documentation builds reject unresolved prose identifiers', t => {
    const book = fixture(t, 'The parameter `definitelyMissingParameter` controls the effect.')
    for (const setting of [undefined, 'true']) {
        const result = book.build(setting)
        assert.equal(result.status, 1, result.stderr)
        assert.match(result.stderr, /identifier\(s\) in the prose do not resolve/)
    }
})

test('source-only builds skip prose identifier lint and still render the page', t => {
    const book = fixture(t, 'The parameter `definitelyMissingParameter` controls the effect.')
    const result = book.build('false')
    assert.equal(result.status, 0, result.stderr)
    assert.match(book.page(), /<code>definitelyMissingParameter<\/code>/)
})

test('both lint modes generate identical valid product pages', t => {
    const book = fixture(t)
    assert.equal(book.build('true').status, 0)
    const checked = book.page()
    assert.equal(book.build('false').status, 0)
    assert.equal(book.page(), checked)
})

test('disabling prose lint preserves missing source and empty prose failures', t => {
    for (const prose of [null, '']) {
        const result = fixture(t, prose).build('false')
        assert.equal(result.status, 1, result.stderr)
        assert.match(result.stderr, prose === null ? /missing prose/ : /prose file is empty/)
    }
})

test('invalid lint settings fail instead of silently disabling checks', t => {
    const result = fixture(t).build('False')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /POLYMORPHIC_LINT_DOCUMENTATION must be true or false/)
})
