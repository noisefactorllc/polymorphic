/**
 * Integrity of the book's data and prose. Offline, so it runs in `npm test`
 * and in CI.
 *
 * What these guard against, in order: an engine release that drops or renames
 * an effect without the book noticing; a page whose demonstration program does
 * not actually render anything; a page shipped with no writing under the title;
 * and prose long enough to push the plate past the lower third of the screen,
 * which is the layout the book is built around.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { splitProseFile } from '../../scripts/build-book.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = join(REPO, 'book', 'data', 'effects.json')
const CONTENT = join(REPO, 'book', 'content')

const book = JSON.parse(await readFile(DATA, 'utf8'))

/**
 * Measured, not guessed. At 1440x900 the plate's scroll box is 459px, of which
 * the eyebrow, title, rule and further-reading row take a fixed 129px. A line
 * of prose is 24px and the gap between paragraphs is 12px, so the writing fits
 * when `24 * lines + 12 * paragraphs` stays inside 342. Prose sets about 100
 * characters to the line at the book's measure.
 *
 * This is an estimate: where a line breaks depends on the words, so it can be
 * a line out either way. The authoritative check is in tests/book.spec.js,
 * which measures the real box in a real browser on every page. This one is
 * here so `npm test` catches an overlong page without starting Chromium.
 *
 * Narrower phones scroll by design; a normal desktop window should not have to.
 */
const PLATE_LINE_BUDGET = 342
const CHARS_PER_LINE = 100

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

test('every page has a title and a one-line description', () => {
    for (const effect of book.effects) {
        assert.ok(effect.title?.trim().length > 1, `${effect.id}: no human-readable title`)
        assert.ok(effect.description?.trim().length > 0, `${effect.id}: no description`)
    }
})

test('every effect has prose, and it fits the plate', async () => {
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

        const lines = paragraphs.reduce((total, para) => {
            const chars = para.replace(/\s*\n\s*/g, ' ').replace(/`/g, '').trim().length
            return total + Math.max(1, Math.ceil(chars / CHARS_PER_LINE))
        }, 0)
        const height = 24 * lines + 12 * paragraphs.length
        if (height > PLATE_LINE_BUDGET) {
            overlong.push(`${effect.chapter}/${effect.slug} (${lines} lines, ${paragraphs.length} paragraphs)`)
        }
    }

    assert.equal(missing.length, 0, `prose missing for:\n  ${missing.join('\n  ')}`)
    assert.equal(overlong.length, 0,
        `prose too tall for the plate, the reader would arrive scrolling:\n  ${overlong.join('\n  ')}`)
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
