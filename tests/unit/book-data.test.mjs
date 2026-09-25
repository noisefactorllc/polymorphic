/**
 * Integrity of the book's data and prose. Offline, so it runs in `npm test`
 * and in CI.
 *
 * What these guard against, in order: an engine release that drops or renames
 * an effect without the book noticing; a page whose demonstration program does
 * not actually render anything; a page shipped with no writing under the title;
 * and a page that has quietly grown into an essay.
 *
 * Identifiers in the prose are checked separately, by
 * scripts/check-book-params.mjs, which resolves every backticked name against
 * the engine's own definitions.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { splitProseFile } from '../../scripts/build-book.mjs'
import { buildIndex, checkProgram } from '../../scripts/check-book-params.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = join(REPO, 'book', 'data', 'effects.json')
const CONTENT = join(REPO, 'book', 'content')

const book = JSON.parse(await readFile(DATA, 'utf8'))

/**
 * An editorial limit, not a layout one.
 *
 * It used to be a layout one: the plate was a fixed box sized in vh, and prose
 * past about 342px of it pushed the further-reading row out of sight. The
 * reading page now scrolls, so length no longer breaks anything, and a budget
 * justified by a box that no longer exists would be enforcing a rule nobody
 * could explain.
 *
 * What is worth keeping is the house style. A page introduces one effect,
 * shows the program, and gets out of the way; the longest page in the book is
 * just over a thousand characters and the median is around 850. The cap sits
 * above the longest current page with room to write, so it catches a page that
 * has turned into an essay without nagging anyone writing a normal one.
 */
const PROSE_CHAR_BUDGET = 1400

async function exists(path) {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

test('every effect belongs to a declared chapter', () => {
    const ids = new Set(book.chapters.map(c => c.id))
    assert.ok(ids.size > 0, 'no chapters declared')
    for (const effect of book.effects) {
        assert.ok(ids.has(effect.chapter), `${effect.id}: chapter "${effect.chapter}" is not in the contents`)
    }
})

test('classicNoisedeck is excluded', () => {
    const stragglers = book.effects.filter(e => e.chapter === 'classicNoisedeck')
    assert.equal(stragglers.length, 0, `classicNoisedeck effects leaked in: ${stragglers.map(e => e.id).join(', ')}`)
})

test('effect ids and page slugs are unique', () => {
    const seen = new Set()
    for (const effect of book.effects) {
        const url = `${effect.chapter}/${effect.slug}`
        assert.ok(!seen.has(url), `duplicate page: ${url}`)
        seen.add(url)
    }
    assert.equal(seen.size, book.effects.length)
})

test('every page has a program that renders and calls its own effect', () => {
    for (const effect of book.effects) {
        const program = effect.program || ''
        assert.match(program, /\brender\s*\(\s*o\d\s*\)/, `${effect.id}: program never renders`)
        assert.match(program, /\.write\s*\(\s*o\d\s*\)/, `${effect.id}: program never writes a surface`)
        assert.ok(
            program.includes(`${effect.func}(`),
            `${effect.id}: program does not call ${effect.func}()`,
        )
        assert.ok(!program.includes('undefined'), `${effect.id}: program contains "undefined"`)
    }
})

test('every page has a demonstration program with valid parameters and enum choices', () => {
    const index = buildIndex(book)
    const failures = []
    for (const effect of book.effects) {
        const fails = checkProgram(effect.program, effect, index)
        for (const f of fails) {
            failures.push(`${effect.id}: ${f.why}`)
        }
    }
    assert.deepEqual(failures, [], `found parameter/enum mismatches:\n${failures.join('\n')}`)
})

test('every page has a title and a one-line description', () => {
    for (const effect of book.effects) {
        assert.ok(effect.title?.trim().length > 1, `${effect.id}: no human-readable title`)
        assert.ok(effect.description?.trim().length > 0, `${effect.id}: no description`)
    }
})

test('every effect has prose, and it stays a page rather than an essay', async () => {
    const missing = []
    const overlong = []

    for (const effect of book.effects) {
        const file = join(CONTENT, effect.chapter, `${effect.slug}.md`)
        if (!(await exists(file))) {
            missing.push(`${effect.chapter}/${effect.slug}.md`)
            continue
        }
        const raw = await readFile(file, 'utf8')
        const { prose } = splitProseFile(raw)
        const text = prose.trim()
        assert.ok(text.length > 0, `${effect.id}: prose file is empty`)

        const paragraphs = text.split(/\n\s*\n/).filter(Boolean)
        assert.ok(paragraphs.length >= 1 && paragraphs.length <= 5,
            `${effect.id}: ${paragraphs.length} paragraphs (expected 1 to 5)`)

        const chars = text.replace(/\s*\n\s*/g, ' ').replace(/`/g, '').trim().length
        if (chars > PROSE_CHAR_BUDGET) {
            overlong.push(`${effect.chapter}/${effect.slug} (${chars} characters, ${paragraphs.length} paragraphs)`)
        }
    }

    assert.equal(missing.length, 0, `prose missing for:\n  ${missing.join('\n  ')}`)
    assert.equal(overlong.length, 0,
        `prose past the ${PROSE_CHAR_BUDGET}-character house limit:\n  ${overlong.join('\n  ')}`)
})

test('every page sends the reader somewhere else', async () => {
    const seen = new Map()

    for (const effect of book.effects) {
        const file = join(CONTENT, effect.chapter, `${effect.slug}.md`)
        if (!(await exists(file))) continue
        const { links } = splitProseFile(await readFile(file, 'utf8'))

        assert.ok(links.length >= 2, `${effect.id}: ${links.length} further-reading links (expected 2 or more)`)
        const urls = new Set()
        for (const { label, url } of links) {
            assert.ok(label?.length > 1, `${effect.id}: link with no label`)
            assert.ok(url?.startsWith('https://'), `${effect.id}: ${url} is not https`)
            assert.ok(!urls.has(url), `${effect.id}: ${url} listed twice`)
            urls.add(url)
            seen.set(url, (seen.get(url) ?? 0) + 1)
        }
    }

    // Not an assertion, a report. Reachability is checked over the network by
    // `npm run check:links`, which cannot run offline or in a sandbox.
    assert.ok(seen.size > 0, 'no further-reading links anywhere')
})

test('no prose file is orphaned by an effect that no longer exists', async () => {
    const known = new Set(book.effects.map(e => `${e.chapter}/${e.slug}.md`))
    const orphans = []

    for (const chapter of await readdir(CONTENT).catch(() => [])) {
        const dir = join(CONTENT, chapter)
        if (!(await stat(dir)).isDirectory()) continue
        for (const file of await readdir(dir)) {
            if (!file.endsWith('.md')) continue
            if (!known.has(`${chapter}/${file}`)) orphans.push(`${chapter}/${file}`)
        }
    }

    assert.equal(orphans.length, 0,
        `prose files with no matching effect (renamed or removed upstream):\n  ${orphans.join('\n  ')}`)
})

test('prose avoids em-dashes', async () => {
    const offenders = []
    for (const effect of book.effects) {
        const file = join(CONTENT, effect.chapter, `${effect.slug}.md`)
        if (!(await exists(file))) continue
        const text = await readFile(file, 'utf8')
        if (text.includes('—') || text.includes('--')) {
            offenders.push(`${effect.chapter}/${effect.slug}`)
        }
    }
    assert.equal(offenders.length, 0, `em-dashes in:\n  ${offenders.join('\n  ')}`)
})
