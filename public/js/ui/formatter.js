/**
 * Format Polymorphic DSL. Rules:
 *   - search line: tokens normalised "search a, b, c"
 *   - chains: each .step() on its own line, indented 2 spaces
 *   - args: single space after ':', single space after ','
 *   - blank lines preserved as block separators
 *
 * String literals are never reformatted: characters inside "..." / '...' / """...""" / '''...'''
 * (URLs like "https://x", text like "a, b", multi-line text) pass through verbatim so
 * formatting can never corrupt a working sketch's media url or text content.
 *
 * Comments (// ...) are preserved intact, without breaking chain continuity,
 * corrupting URLs or code, or collapsing arguments.
 */

/**
 * Scan `text` into non-overlapping tokens:
 * - triple_string: """...""" or '''...'''
 * - string: "..." or '...'
 * - comment: //...
 * - code: everything else
 *
 * Literals and comments are extracted safely so that quotes inside comments,
 * URLs with slashes/colons, and parens inside strings are never misidentified.
 *
 * @param {string} text
 * @returns {Array<{type: 'code'|'string'|'triple_string'|'comment', text: string}>}
 */
function scanTokens(text) {
    const tokens = []
    let i = 0
    let codeStart = 0

    function flushCode(end) {
        if (end > codeStart) {
            tokens.push({ type: 'code', text: text.slice(codeStart, end) })
        }
    }

    while (i < text.length) {
        if (text.startsWith('"""', i)) {
            flushCode(i)
            let j = i + 3
            while (j < text.length && !text.startsWith('"""', j)) {
                if (text[j] === '\\' && j + 1 < text.length) {
                    j += 2
                    continue
                }
                j++
            }
            if (j < text.length) j += 3
            tokens.push({ type: 'triple_string', text: text.slice(i, j) })
            i = j
            codeStart = i
        } else if (text.startsWith("'''", i)) {
            flushCode(i)
            let j = i + 3
            while (j < text.length && !text.startsWith("'''", j)) {
                if (text[j] === '\\' && j + 1 < text.length) {
                    j += 2
                    continue
                }
                j++
            }
            if (j < text.length) j += 3
            tokens.push({ type: 'triple_string', text: text.slice(i, j) })
            i = j
            codeStart = i
        } else if (text[i] === '"' || text[i] === "'") {
            flushCode(i)
            const quote = text[i]
            let j = i + 1
            while (j < text.length && text[j] !== '\n') {
                if (text[j] === '\\' && j + 1 < text.length) {
                    j += 2
                    continue
                }
                if (text[j] === quote) {
                    j++
                    break
                }
                j++
            }
            tokens.push({ type: 'string', text: text.slice(i, j) })
            i = j
            codeStart = i
        } else if (text.startsWith('//', i)) {
            flushCode(i)
            let j = i + 2
            while (j < text.length && text[j] !== '\n') j++
            tokens.push({ type: 'comment', text: text.slice(i, j) })
            i = j
            codeStart = i
        } else {
            i++
        }
    }
    flushCode(text.length)
    return tokens
}

/**
 * Return a same-length copy of `text` where every non-code character (strings,
 * comments) is replaced by a space (preserving newlines in multi-line strings).
 * Structural scans (paren depth, splitting a chain on '.') run over the mask
 * so syntax characters inside literals or comments are never mistaken for code.
 *
 * @param {string} text
 * @returns {string}
 */
function maskCode(text) {
    const tokens = scanTokens(text)
    return tokens.map(t => {
        if (t.type === 'code') return t.text
        return t.text.replace(/[^\n]/g, ' ')
    }).join('')
}

/**
 * Normalise whitespace around ':' ',' '(' ')', but only in the code spans
 * between string literals and comments — literals and comments pass through untouched.
 *
 * @param {string} text
 * @returns {string}
 */
function formatArgs(text) {
    const tokens = scanTokens(text)
    return tokens.map(t => {
        if (t.type === 'code') {
            return t.text
                .replace(/\s*:\s*/g, ': ')
                .replace(/\s*,\s*/g, ', ')
                .replace(/\(\s+/g, '(')
                .replace(/\s+\)/g, ')')
        }
        return t.text
    }).join('')
}

/**
 * Check whether a string contains any comment token.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasLineComment(text) {
    const tokens = scanTokens(text)
    return tokens.some(t => t.type === 'comment')
}

/**
 * Format a chained statement, splitting method steps onto separate lines indented by 2 spaces.
 *
 * @param {string} text
 * @returns {string}
 */
function formatChain(text) {
    const mask = maskCode(text)
    const parts = []
    let depth = 0, start = 0
    for (let i = 0; i < text.length; i++) {
        const c = mask[i]
        if (c === '(' || c === '{') depth++
        else if (c === ')' || c === '}') depth = Math.max(0, depth - 1)
        else if (c === '.' && depth === 0 && i > 0) {
            parts.push(text.slice(start, i))
            start = i
        }
    }
    parts.push(text.slice(start))
    return parts.map((p, i) => {
        const trimmed = p.trim()
        if (!trimmed) return ''
        const formatted = formatArgs(trimmed)
        return i === 0 ? formatted : '  ' + formatted
    }).filter(Boolean).join('\n')
}

export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''

    // Step 0: Protect multi-line triple-quoted strings with placeholder tokens
    // so their internal newlines and indentation survive Pass 1 intact.
    const tripleStrings = []
    const tokens = scanTokens(input)
    let preprocessed = ''
    for (const token of tokens) {
        if (token.type === 'triple_string' && token.text.includes('\n')) {
            const key = `__POLY_TRIPLE_${tripleStrings.length}__`
            tripleStrings.push(token.text)
            preprocessed += key
        } else {
            preprocessed += token.text
        }
    }

    // Pass 1: collapse multi-line statements (unbalanced parens) into logical lines.
    // Also fold chain-continuation lines (starting with '.') onto the previous statement,
    // provided the previous statement does not contain a comment.
    // Multi-line blocks containing comments are kept on separate lines to avoid commenting out code.
    const physical = preprocessed.split('\n')
    const logical = []
    let bufLines = []
    let depth = 0

    for (const raw of physical) {
        const trimmed = raw.trim()
        const mask = maskCode(raw)
        let lineDepthDelta = 0
        for (const c of mask) {
            if (c === '(' || c === '{') lineDepthDelta++
            else if (c === ')' || c === '}') lineDepthDelta--
        }

        const prevLogical = logical.length ? logical[logical.length - 1] : ''
        const prevHasComment = hasLineComment(prevLogical)
        const isChainCont = depth === 0 && bufLines.length === 0 && trimmed.startsWith('.')
            && logical.length && prevLogical !== '' && !prevHasComment

        depth = Math.max(0, depth + lineDepthDelta)

        if (isChainCont) {
            logical[logical.length - 1] += ' ' + trimmed
            if (depth !== 0) {
                bufLines = [logical.pop()]
            }
            continue
        }

        if (depth > 0 || bufLines.length > 0) {
            bufLines.push(trimmed)
            if (depth === 0) {
                const anyComment = bufLines.some(hasLineComment)
                if (anyComment) {
                    logical.push(...bufLines)
                } else {
                    logical.push(bufLines.join(' '))
                }
                bufLines = []
            }
        } else {
            logical.push(trimmed)
        }
    }
    if (bufLines.length > 0) {
        logical.push(...bufLines)
    }

    // Pass 2: per-logical-line formatting
    const out = []
    let pendingBlank = false
    let inChain = false

    for (const raw of logical) {
        const line = raw.trim()
        if (!line) {
            if (out.length && !pendingBlank) pendingBlank = true
            inChain = false
            continue
        }
        if (pendingBlank) { out.push(''); pendingBlank = false }

        if (line.startsWith('//')) {
            out.push(inChain ? '  ' + line : line)
        } else if (line.startsWith('search')) {
            inChain = false
            const tokens = scanTokens(line)
            let searchBody = ''
            let commentPart = ''
            for (const t of tokens) {
                if (t.type === 'comment') {
                    commentPart = ' ' + t.text
                    break
                }
                searchBody += t.text
            }
            const items = searchBody.slice(6).split(',').map(s => s.trim()).filter(Boolean)
            out.push('search ' + items.join(', ') + commentPart)
        } else if (line.startsWith('render(') || line.startsWith('let ')) {
            inChain = false
            out.push(formatArgs(line))
        } else {
            const formatted = formatChain(line)
            const lines = formatted.split('\n')
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i]
                if (line.startsWith('.') && i === 0 && !l.startsWith('  ')) {
                    out.push('  ' + l)
                } else {
                    out.push(l)
                }
            }
            inChain = true
        }
    }

    let result = out.join('\n')
    // Restore triple-quoted multi-line strings verbatim, using function replacer to prevent
    // special replacement patterns ($$, $&, $`, $') in strings from corrupting output.
    for (let i = 0; i < tripleStrings.length; i++) {
        result = result.replace(`__POLY_TRIPLE_${i}__`, () => tripleStrings[i])
    }
    return result
}
