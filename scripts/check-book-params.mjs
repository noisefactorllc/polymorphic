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
 *
 * Demonstration programs get the same treatment, argument by argument: an
 * argument's name must be a parameter of the effect it is passed to, its
 * value must match that parameter's type (a string literal for `text()`, a
 * number for a float parameter, and so on — `read(...)`, `read3d(...)`,
 * `palette.*` and the output buffers stay acceptable as dynamic forms),
 * positional arguments are matched to the signature order, and effects the
 * book gives no page but a program may still call (media() above all, whose
 * signature the extraction carries in `excludedEffects`) are checked against
 * their engine definition rather than waved through.
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
    // func name -> list of effect definitions (to resolve parameters and choices)
    const effectsByFunc = new Map()

    for (const effect of data.effects) {
        byId.set(effect.id, effect)
        funcs.add(effect.func)
        const list = effectsByFunc.get(effect.func) || []
        list.push(effect)
        effectsByFunc.set(effect.func, list)

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

    // Effects the book deliberately gives no page (book/curation.json's
    // excludes) still have a real signature, extracted alongside the rest
    // into data.excludedEffects. A demonstration program may call them —
    // media() above all — so they are indexed for argument checking exactly
    // like page effects. `url` joins media's vocabulary: it is not an engine
    // parameter (the engine rejects it at compile), it is an argument the
    // app owns and strips before compiling — see
    // public/js/noisemaker/dslSanitize.js — so prose describing
    // `media(url: "...")` must still resolve.
    for (const effect of data.excludedEffects || []) {
        byId.set(effect.id, effect)
        funcs.add(effect.func)
        effectsByFunc.set(effect.func, [effect])

        const words = new Set()
        for (const param of effect.params || []) words.add(param.name)
        if (effect.func === 'media') words.add('url')
        vocabulary.set(effect.func, words)
    }
    return { byId, funcs, vocabulary, effectsByFunc }
}

/**
 * DSL operations, surfaces, search keywords, and pipeline stages that are part
 * of the language runtime rather than library effects.
 */
export const PROGRAM_BUILTINS = new Set([
    'render', 'write', 'write3d', 'read', 'read3d', 'search', 'subchain',
])

/** Strip line comments while preserving quoted strings. */
export function stripComments(code) {
    let out = ''
    let inQuote = null
    let isTriple = false
    for (let i = 0; i < code.length; i++) {
        const ch = code[i]
        if (!inQuote && ch === '/' && code[i + 1] === '/') {
            const next = code.indexOf('\n', i)
            if (next === -1) break
            i = next - 1
            continue
        }
        if (!inQuote && (ch === '"' || ch === "'")) {
            if (code.slice(i, i + 3) === ch.repeat(3)) {
                inQuote = ch
                isTriple = true
                out += code.slice(i, i + 3)
                i += 2
                continue
            } else {
                inQuote = ch
                isTriple = false
                out += ch
                continue
            }
        } else if (inQuote) {
            out += ch
            if (ch === '\\' && i + 1 < code.length) {
                out += code[++i]
                continue
            }
            if (isTriple) {
                if (ch === inQuote && code.slice(i, i + 3) === inQuote.repeat(3)) {
                    out += inQuote.repeat(2)
                    i += 2
                    inQuote = null
                    isTriple = false
                }
            } else if (ch === inQuote) {
                inQuote = null
            }
            continue
        }
        out += ch
    }
    return out
}

/** Extract function calls with balanced paren scanning to handle nested expressions. */
export function extractCalls(dsl) {
    const calls = []
    if (!dsl || typeof dsl !== 'string') return calls
    const cleaned = stripComments(dsl)
    const regex = /(?:^|[\s.])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
    let match
    while ((match = regex.exec(cleaned)) !== null) {
        const name = match[1]
        const openParenIndex = match.index + match[0].length - 1
        let depth = 1
        let i = openParenIndex + 1
        let inQuote = null
        let isTriple = false

        while (i < cleaned.length && depth > 0) {
            const ch = cleaned[i]

            if (!inQuote && (ch === '"' || ch === "'")) {
                if (cleaned.slice(i, i + 3) === ch.repeat(3)) {
                    inQuote = ch
                    isTriple = true
                    i += 3
                    continue
                } else {
                    inQuote = ch
                    isTriple = false
                    i++
                    continue
                }
            } else if (inQuote) {
                if (ch === '\\' && i + 1 < cleaned.length) {
                    i += 2
                    continue
                }
                if (isTriple) {
                    if (ch === inQuote && cleaned.slice(i, i + 3) === inQuote.repeat(3)) {
                        inQuote = null
                        isTriple = false
                        i += 3
                        continue
                    }
                } else if (ch === inQuote) {
                    inQuote = null
                    i++
                    continue
                }
                i++
                continue
            }

            if (ch === '(') depth++
            else if (ch === ')') depth--
            i++
        }
        const argsStr = cleaned.slice(openParenIndex + 1, i - 1)
        calls.push({ name, argsStr })
        regex.lastIndex = i
    }
    return calls
}

/** Split argument string on top-level commas. */
function splitArgs(argsStr) {
    const args = []
    let depth = 0
    let current = ''
    let inQuote = null
    let isTriple = false

    for (let i = 0; i < argsStr.length; i++) {
        const ch = argsStr[i]

        if (!inQuote && (ch === '"' || ch === "'")) {
            if (argsStr.slice(i, i + 3) === ch.repeat(3)) {
                inQuote = ch
                isTriple = true
                current += argsStr.slice(i, i + 3)
                i += 2
                continue
            } else {
                inQuote = ch
                isTriple = false
                current += ch
                continue
            }
        } else if (inQuote) {
            current += ch
            if (ch === '\\' && i + 1 < argsStr.length) {
                current += argsStr[++i]
                continue
            }
            if (isTriple) {
                if (ch === inQuote && argsStr.slice(i, i + 3) === inQuote.repeat(3)) {
                    current += inQuote.repeat(2)
                    i += 2
                    inQuote = null
                    isTriple = false
                }
            } else if (ch === inQuote) {
                inQuote = null
            }
            continue
        }

        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--

        if (ch === ',' && depth === 0) {
            if (current.trim()) args.push(current.trim())
            current = ''
        } else {
            current += ch
        }
    }
    if (current.trim()) args.push(current.trim())
    return args
}

/**
 * Parse an argument string into its arguments in source order. An argument is
 * named when it is written `name: value`; otherwise it is positional and gets
 * a null name, so the caller can match it against the signature order.
 */
export function parseCallArgs(argsStr) {
    const namedPattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]*)$/
    return splitArgs(argsStr).map(arg => {
        const m = arg.match(namedPattern)
        if (m) return { name: m[1], value: m[2].trim() }
        return { name: null, value: arg }
    })
}

/** Split argument string on top-level commas, extracting named arguments. */
export function parseNamedArgs(argsStr) {
    return parseCallArgs(argsStr).filter(arg => arg.name !== null)
}

/**
 * The value forms every parameter accepts no matter its type: a reference the
 * checker cannot resolve a literal type for, read from elsewhere in the
 * pipeline (`read(...)`, `read3d(...)`, a palette reference, an output
 * buffer).
 */
function isDynamic(value) {
    return value.startsWith('read(') ||
        value.startsWith('read3d(') ||
        value.startsWith('palette.') ||
        /^o\d+$/.test(value)
}

/** A string literal, single or triple quoted, in either quote character. */
function isQuotedString(value) {
    const triple = value.slice(0, 3)
    if (triple === '"""' || triple === "'''") return value.endsWith(triple) && value.length >= 6
    const q = value[0]
    if (q === '"' || q === "'") return value.length >= 2 && value.endsWith(q)
    return false
}

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENUM_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * What the engine's `formatValue` will write for a value of each parameter
 * type, and therefore what a hand-written demonstration program may pass.
 * Numeric parameters accept a (possibly negative) literal or one of the
 * dynamic forms the checker already accepts (`read(...)`, `read3d(...)`, a
 * palette reference, an output buffer); string parameters receive string
 * literals, written quoted unless the value reads as a bare identifier or an
 * enum path, exactly as the engine writes them back; booleans are
 * `true`/`false`; colors a bare or quoted `#rgb`/`#rrggbb` (+alpha) hex;
 * vectors `vecN(...)`. Anything outside the form the engine emits for that
 * type is a mismatch the compiler will reject or silently misread.
 */
export function valueMatchesType(value, pDef) {
    switch (pDef.type) {
        case 'string': return isQuotedString(value) || BARE_IDENTIFIER.test(value) || ENUM_PATH.test(value)
        case 'float':
        case 'int': return isDynamic(value) || NUMBER.test(value)
        case 'boolean': return value === 'true' || value === 'false'
        case 'color': return HEX_COLOR.test(value) || isQuotedString(value)
        case 'vec2': return isDynamic(value) || /^vec2\s*\(/.test(value) || /^\[[^[\]]*\]$/.test(value)
        case 'vec3': return isDynamic(value) || /^vec3\s*\(/.test(value) || /^\[[^[\]]*\]$/.test(value) || HEX_COLOR.test(value)
        // surface / volume / geometry / member / mat3 and types the checker
        // does not model yet are left unchecked rather than guessed at: the
        // dynamic forms above cover how the book writes them.
        default: return true
    }
}

const TYPE_EXPECTATION = {
    string: 'a string',
    float: 'a number',
    int: 'a number',
    boolean: 'true or false',
    color: 'a color (#rrggbb)',
    vec2: 'vec2(...)',
    vec3: 'vec3(...)',
}

/**
 * Validate a demonstration program's calls and argument precision.
 * Returns an array of failure objects if invalid.
 */
export function checkProgram(program, effect, index) {
    const failures = []
    if (!program || typeof program !== 'string') return failures

    const { funcs, effectsByFunc } = index
    const calls = extractCalls(program)

    for (const call of calls) {
        if (PROGRAM_BUILTINS.has(call.name)) continue

        if (!funcs.has(call.name)) {
            failures.push({
                call: call.name,
                param: null,
                value: null,
                why: `unknown effect "${call.name}()" called in program`
            })
            continue
        }

        const effectDefs = effectsByFunc?.get(call.name) || []
        const paramDefs = new Map()
        for (const def of effectDefs) {
            for (const p of def.params || []) {
                paramDefs.set(p.name, p)
            }
        }
        // The engine still resolves a param alias to its declared global
        // (with a deprecation warning), so an alias is checked as the
        // parameter it stands for. Registered in a second pass: an alias may
        // name a param later in the definition order than another alias.
        for (const def of effectDefs) {
            for (const [alias, target] of Object.entries(def.aliases || {})) {
                if (paramDefs.has(target)) paramDefs.set(alias, paramDefs.get(target))
            }
        }
        // Signature order for positional arguments: the engine's globals, in
        // definition order, which is the order the extracted params carry.
        const signature = [...new Set(effectDefs.flatMap(def => (def.params || []).map(p => p.name)))]

        const args = parseCallArgs(call.argsStr)
        let positionalIndex = 0
        for (const arg of args) {
            let paramName = arg.name
            if (arg.name === null) {
                // Positional argument, matched to the signature order.
                paramName = signature[positionalIndex]
                positionalIndex++
                if (paramName === undefined) {
                    failures.push({
                        call: call.name,
                        param: null,
                        value: arg.value,
                        why: `positional argument "${arg.value}" exceeds the ${signature.length} parameter(s) of ${call.name}()`
                    })
                    continue
                }
            }

            if (!paramDefs.has(paramName)) {
                // media()'s url is not an engine parameter — the engine
                // rejects it at compile — but the app owns it and strips it
                // before compiling (public/js/noisemaker/dslSanitize.js), so
                // a program carrying it still runs.
                if (call.name === 'media' && paramName === 'url' && isQuotedString(arg.value)) continue
                failures.push({
                    call: call.name,
                    param: paramName,
                    value: arg.value,
                    why: `"${paramName}" is not a parameter of ${call.name}()`
                })
                continue
            }

            const pDef = paramDefs.get(paramName)
            if (pDef.choices && pDef.choices.length > 0) {
                // A string-typed choice may also be written as a quoted
                // literal of the choice name.
                const quotedChoice = pDef.type === 'string' && isQuotedString(arg.value) &&
                    pDef.choices.includes(arg.value.slice(1, -1))
                if (!isDynamic(arg.value) && !quotedChoice && !pDef.choices.includes(arg.value)) {
                    failures.push({
                        call: call.name,
                        param: paramName,
                        value: arg.value,
                        why: `"${arg.value}" is not a valid choice for ${call.name}(${paramName}: ...); choices: [${pDef.choices.join(', ')}]`
                    })
                }
                continue
            }

            if (!valueMatchesType(arg.value, pDef)) {
                failures.push({
                    call: call.name,
                    param: paramName,
                    value: arg.value,
                    why: `"${arg.value}" is not a valid value for ${call.name}(${paramName}: ...); ${paramName} expects ${TYPE_EXPECTATION[pDef.type] || `a value of type ${pDef.type}`}`
                })
            }
        }
    }

    return failures
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
    let programsChecked = 0

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
                    const owners = [...data.effects, ...(data.excludedEffects || [])]
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

            if (effect.program) {
                programsChecked++
                for (const err of checkProgram(effect.program, effect, index)) {
                    failures.push({
                        id,
                        token: err.param ? `${err.param}: ${err.value}` : `${err.call}()`,
                        why: err.why,
                    })
                }
            }
        }
    }

    if (VERBOSE) {
        console.log(`checked ${resolved} code spans across ${pages} pages and ${programsChecked} demonstration programs`)
    }

    if (failures.length) {
        console.error(`\nbook: ${failures.length} identifier(s) in the book do not resolve\n`)
        for (const f of failures) {
            console.error(`  ${f.id}`)
            console.error(`      \`${f.token}\` — ${f.why}\n`)
        }
        console.error('The prose or demonstration programs have drifted from the engine.')
        console.error('book/data/effects.json is the authority; regenerate it with')
        console.error('scripts/extract-book-data.mjs if the engine itself has changed.\n')
        process.exit(1)
    }

    console.log(`book: ${resolved} code spans across ${pages} pages all resolve`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
