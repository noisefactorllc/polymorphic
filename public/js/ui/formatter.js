/**
 * Format Polymorphic DSL. Rules:
 *   - search line: tokens normalised "search a, b, c"
 *   - chains: each .step() on its own line, indented 2 spaces
 *   - args: single space after ':', single space after ','
 *   - blank lines preserved as block separators
 */
export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''

    const formatChain = (text) => {
        const parts = []
        let depth = 0, start = 0
        for (let i = 0; i < text.length; i++) {
            const c = text[i]
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

    const formatArgs = (text) => text
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')

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
        for (const c of raw) {
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
