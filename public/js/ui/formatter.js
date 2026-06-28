/**
 * Format Polymorphic DSL. Rules:
 *   - search line: tokens normalised "search a, b, c"
 *   - chains: each .step() on its own line, indented 2 spaces
 *   - args: single space after ':', single space after ','
 *   - blank lines preserved as block separators
 *
 * String literals are never reformatted: characters inside "..." / '...'
 * (URLs like "https://x", text like "a, b") pass through verbatim so
 * formatting can never corrupt a working sketch's media url or text content.
 */

/**
 * Return a same-length copy of `text` with every character inside a string
 * literal (and the surrounding quotes) replaced by a space. Structural scans
 * (paren depth, splitting a chain on '.') run over the mask so a ':' '.' '('
 * ')' or ',' inside a quoted value is never mistaken for syntax, while the
 * original text is used for slicing so the literal survives intact. A literal
 * is paired on the SAME quote char, so `"O'Brien, hi"` stays one piece — this
 * is deliberately more robust than the engine's either-quote `[^"']` extraction
 * (which would split that literal at the apostrophe); do not "align" the two.
 * An unterminated quote masks to end-of-string. No escape handling.
 * @param {string} text
 * @returns {string}
 */
function maskStrings(text) {
    let out = ''
    let i = 0
    while (i < text.length) {
        const c = text[i]
        if (c === '"' || c === "'") {
            out += ' '            // opening quote
            i++
            while (i < text.length && text[i] !== c) { out += ' '; i++ }
            if (i < text.length) { out += ' '; i++ }   // closing quote
        } else {
            out += c
            i++
        }
    }
    return out
}

export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''

    const formatChain = (text) => {
        const mask = maskStrings(text)
        const parts = []
        let depth = 0, start = 0
        for (let i = 0; i < text.length; i++) {
            const c = mask[i]
            if (c === '(') depth++
            else if (c === ')') depth--
            else if (c === '.' && depth === 0 && i > 0) {
                parts.push(text.slice(start, i))
                start = i
            }
        }
        parts.push(text.slice(start))
        return parts.map((p, i) => i === 0
            ? formatArgs(p.trim())
            : '  ' + formatArgs(p.trim())).join('\n')
    }

    // Normalise whitespace around ':' ',' '(' ')', but only in the code spans
    // between string literals — literals are copied through untouched.
    const formatArgs = (text) => {
        let out = ''
        let i = 0
        while (i < text.length) {
            const c = text[i]
            if (c === '"' || c === "'") {
                let j = i + 1
                while (j < text.length && text[j] !== c) j++
                if (j < text.length) j++   // include closing quote
                out += text.slice(i, j)
                i = j
            } else {
                let j = i
                while (j < text.length && text[j] !== '"' && text[j] !== "'") j++
                out += text.slice(i, j)
                    .replace(/\s*:\s*/g, ': ')
                    .replace(/\s*,\s*/g, ', ')
                    .replace(/\(\s+/g, '(')
                    .replace(/\s+\)/g, ')')
                i = j
            }
        }
        return out
    }

    // Pass 1: collapse multi-line statements (unbalanced parens) into logical lines.
    // Also fold chain-continuation lines (starting with '.') onto the previous statement.
    // Blank physical lines become real blank logical lines (block separators).
    const physical = input.split('\n')
    const logical = []
    let buf = ''
    let depth = 0
    for (const raw of physical) {
        const trimmed = raw.trim()
        // Fold chain-continuation onto previous logical line when not in an open block.
        // Detection happens BEFORE depth update so this line's own '(' doesn't disqualify it.
        const isChainCont = depth === 0 && !buf && trimmed.startsWith('.')
            && logical.length && logical[logical.length - 1] !== ''
        for (const c of maskStrings(raw)) {
            if (c === '(') depth++
            else if (c === ')') depth = Math.max(0, depth - 1)
        }
        if (isChainCont) {
            logical[logical.length - 1] += ' ' + trimmed
            if (depth !== 0) {
                // Continuation opened an unbalanced block; pull it back into buf so the
                // following physical lines collect into the same logical statement.
                buf = logical.pop()
            }
            continue
        }
        if (buf) {
            buf += ' ' + trimmed
        } else {
            buf = trimmed
        }
        if (depth === 0) {
            logical.push(buf)
            buf = ''
        }
    }
    if (buf) logical.push(buf)

    // Pass 2: per-logical-line formatting (existing semantics)
    const out = []
    let pendingBlank = false
    for (const raw of logical) {
        const line = raw.trim()
        if (!line) {
            if (out.length && !pendingBlank) pendingBlank = true
            continue
        }
        if (pendingBlank) { out.push(''); pendingBlank = false }
        if (line.startsWith('search')) {
            const items = line.slice(6).split(',').map(s => s.trim()).filter(Boolean)
            out.push('search ' + items.join(', '))
        } else if (line.startsWith('render(') || line.startsWith('let ') || line.startsWith('//')) {
            out.push(formatArgs(line))
        } else {
            out.push(...formatChain(line).split('\n'))
        }
    }
    return out.join('\n')
}
