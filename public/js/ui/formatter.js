/**
 * Format Polymorphic DSL. Rules:
 *   - search line: tokens normalised "search a, b, c"
 *   - chains: each .step() on its own line, indented 2 spaces
 *   - args: single space after ':', single space after ','
 *   - blank lines preserved as block separators
 */
export function formatDsl(input) {
    if (!input || typeof input !== 'string') return input || ''
    const lines = input.split('\n')
    const out = []
    let pendingBlank = false

    const formatChain = (text) => {
        // Split on . that aren't inside parens
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

    const formatArgs = (text) => {
        return text
            .replace(/\s*:\s*/g, ': ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
    }

    for (const raw of lines) {
        const line = raw.trim()
        if (!line) {
            if (out.length && !pendingBlank) {
                pendingBlank = true
            }
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
