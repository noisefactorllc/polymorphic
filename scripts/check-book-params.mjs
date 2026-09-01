#!/usr/bin/env node
/**
 * Check every identifier the book's prose puts in backticks against what the
 * engine actually exposes.
 *
 *   node scripts/check-book-params.mjs
 *   node scripts/check-book-params.mjs --verbose   # also list what resolved and how
 *
 * Why this exists. The prose was written against an older engine and drifted:
 * synth/cell's page described a `metric` parameter that had been renamed to
 * `shape`, filter/vignette named `vignetteBrightness` for what is now
 * `brightness`, and filter/fibers and filter/lensWarp each documented a
 * parameter (`kink`, `speed`) the effect does not have at all. Nothing caught
 * any of it, because a page can compile, render and read perfectly while
 * telling the reader to type a parameter name that no longer exists.
 *
 * The rule is that every identifier in a code span has to resolve to something
 * the engine knows about, from the vantage point of the page it appears on:
 *
 *   1. a parameter, parameter label, or enum choice of this page's own effect;
 *   2. a parameter or enum choice of another effect CALLED IN THE SAME
 *      PARAGRAPH — so `pointsRender(viewMode: ortho)` on the attractor page
 *      resolves, and so does "`noise()` and its relatives have a `ridges`
 *      option" on the ridge page;
 *   3. an effect cross reference, which the prose writes as a call:
 *      `shape()`, not `shape`;
 *   4. DSL vocabulary — `render`, `write`, the `o0`-`o3` buffers, literals.
 *
 * Anything else is a name the reader cannot type, and the check fails.
 *
 * Rule 3 is why cross references carry their parentheses. Without them the
 * check has a hole exactly where the drift was worst: `smooth` is both an
 * effect and the old name of synth/cell's `cellSmooth`, so a bare `smooth` on
 * the cell page read as a legitimate mention of the smooth effect and the
 * stale parameter sailed through. Requiring the call form makes the two
 * unambiguous in the source, and it matches the `cell()` notation the contents
 * page already uses. The paragraph scope in rule 2 does the same job for
 * parameters: a bare `speed` on a page for an effect with no speed parameter
 * is a bug precisely because nothing nearby says whose speed it is.
 *
 * Reads book/data/effects.json, which is extracted from the engine by
 * scripts/extract-book-data.mjs, so the check is always against the shipped
 * definitions rather than a second copy of them maintained by hand.
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DATA = join(REPO, 'book', 'data', 'effects.json')
const CONTENT = join(REPO, 'book', 'content')

const VERBOSE = process.argv.includes('--verbose')

/**
 * DSL vocabulary that is not an effect and not a parameter. Kept deliberately
 * short: anything longer would start hiding the drift this check exists to
 * find.
 */
const DSL_WORDS = new Set([
    'search', 'render', 'write', 'palette',
    'o0', 'o1', 'o2', 'o3',
    'true', 'false',
])

/** Identifiers inside a code span, so `pointsRender(viewMode: ortho)` yields all three. */
function identifiers(span) {
    return [...span.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0])
}

/**
 * Identifiers written as a call — `warp()`, or the `pointsRender` in
 * `pointsRender(viewMode: ortho)`. These are the only ones allowed to name an
 * effect; see rule 3.
 */
function calledIdentifiers(span) {
    return [...span.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(m => m[1])
}

function codeSpans(text) {
    return [...text.matchAll(/`([^`]+)`/g)].map(m => m[1])
}

/** Paragraphs, matching how the book itself splits prose (blank-line separated). */
function paragraphs(text) {
    return text.trim().split(/\n\s*\n/).filter(Boolean)
}

export function buildIndex(data) {
    const byId = new Map()
    const funcs = new Set()
    // func name -> the vocabulary that effect legitimately brings with it
    const vocabulary = new Map()

    for (const effect of data.effects) {
        byId.set(effect.id, effect)
        funcs.add(effect.func)
        const words = new Set()
        for (const param of effect.params || []) {
            words.add(param.name)
            // Labels and choices count only when they are a single bare
            // identifier — something a reader could actually type. Splitting a
            // multi-word label into its words is what let the drift hide: the
            // label "cell smooth" contributed `smooth`, so synth/cell's stale
            // `smooth` resolved against the very parameter it had been renamed
            // away from. A code span never contains a label with a space in
            // it, so nothing legitimate is lost.
            const bare = (value) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
            if (bare(param.label)) words.add(param.label)
            for (const choice of param.choices || []) {
                if (bare(choice)) words.add(choice)
            }
        }
        // An effect can be named more than once across chapters; union rather
        // than overwrite, so a cross reference resolves against all of them.
        const prior = vocabulary.get(effect.func)
        vocabulary.set(effect.func, prior ? new Set([...prior, ...words]) : words)
    }
    return { byId, funcs, vocabulary }
}

/**
 * Resolve one paragraph's identifiers. Returns the tokens that resolve to
 * nothing the engine knows about.
 */
export function checkParagraph(paragraph, effect, index) {
    const { funcs, vocabulary } = index
    const spans = codeSpans(paragraph)
    if (!spans.length) return []

    // Rule 2: any effect *called* anywhere in this paragraph lends its
    // vocabulary to the whole paragraph.
    const called = new Set()
    for (const span of spans) {
        for (const word of calledIdentifiers(span)) if (funcs.has(word)) called.add(word)
    }

    const allowed = new Set(DSL_WORDS)
    for (const word of vocabulary.get(effect.func) || []) allowed.add(word)  // rule 1
    for (const func of called) {
        for (const word of vocabulary.get(func) || []) allowed.add(word)     // rule 2
    }

    const unresolved = []
    for (const span of spans) {
        const isCall = new Set(calledIdentifiers(span))
        for (const token of identifiers(span)) {
            if (allowed.has(token)) continue
            // Rule 3: an effect name resolves only in call form. A bare token
            // that merely happens to match an effect name does not.
            if (funcs.has(token) && isCall.has(token)) continue
            if (/^-?[\d.]+$/.test(token)) continue                            // rule 4
            unresolved.push(token)
        }
    }
    return unresolved
}

async function main() {
    const data = JSON.parse(await readFile(DATA, 'utf8'))
    const index = buildIndex(data)

    const failures = []
    let pages = 0
    let resolved = 0

    for (const chapter of (await readdir(CONTENT, { withFileTypes: true }))
        .filter(d => d.isDirectory()).map(d => d.name).sort()) {
        for (const file of (await readdir(join(CONTENT, chapter))).sort()) {
            if (!file.endsWith('.md')) continue
            const id = `${chapter}/${file.replace(/\.md$/, '')}`
            const effect = index.byId.get(id)
            if (!effect) {
                failures.push({ id, token: '', why: 'no entry in book/data/effects.json' })
                continue
            }
            pages++
            const text = await readFile(join(CONTENT, chapter, file), 'utf8')
            for (const paragraph of paragraphs(text)) {
                for (const token of checkParagraph(paragraph, effect, index)) {
                    const owners = data.effects
                        .filter(e => (e.params || []).some(p => p.name === token))
                        .map(e => e.id)
                    failures.push({
                        id,
                        token,
                        why: owners.length
                            ? `not a parameter of ${effect.func}(); it belongs to ${owners.slice(0, 3).join(', ')}${owners.length > 3 ? ` and ${owners.length - 3} more` : ''}`
                            : index.funcs.has(token)
                                ? `${token}() is an effect, not a parameter of ${effect.func}(). Write a cross reference as \`${token}()\`; if a parameter was meant, it has been renamed.`
                                : 'not a parameter, choice, or effect the engine defines',
                    })
                }
                resolved += codeSpans(paragraph).length
            }
        }
    }

    if (VERBOSE) {
        console.log(`checked ${resolved} code spans across ${pages} pages`)
    }

    if (failures.length) {
        console.error(`\nbook: ${failures.length} identifier(s) in the prose do not resolve\n`)
        for (const f of failures) {
            console.error(`  ${f.id}`)
            console.error(`      \`${f.token}\` — ${f.why}\n`)
        }
        console.error('The prose has drifted from the engine, or the name is a typo.')
        console.error('book/data/effects.json is the authority; regenerate it with')
        console.error('scripts/extract-book-data.mjs if the engine itself has changed.\n')
        process.exit(1)
    }

    console.log(`book: ${resolved} code spans across ${pages} pages all resolve`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
