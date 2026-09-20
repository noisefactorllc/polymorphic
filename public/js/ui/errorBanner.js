/**
 * Diagnostic error location parsing and formatting.
 *
 * Extracts line and column numbers from compiler and parser diagnostics across
 * Noisemaker DSL, GLSL, WGSL, and browser SyntaxError formats.
 */

export function parseErrorLocation(msg) {
    if (!msg || typeof msg !== 'string') return null

    // 1. Explicit line with optional column (e.g. "at line 7 col 11", "line 12:5", "line 7:11 — ...", "--> line 8, column 28", "Line 15: error")
    let m = msg.match(/(?:\b(?:at|-->)\s+)?\bline\s+(\d+)(?:\s*[:]\s*(\d+)|\s*[,;]?\s*col(?:umn)?\s*(\d+))?/i)
    if (m) {
        const line = parseInt(m[1], 10)
        const col = m[2] ? parseInt(m[2], 10) : (m[3] ? parseInt(m[3], 10) : 1)
        if (Number.isFinite(line) && line >= 1) {
            return { line, col: Number.isFinite(col) && col >= 1 ? col : 1 }
        }
    }

    // 2. Parentheses or brackets: "(line 3, column 5)", "(3:5)", "[line 3:5]", "[3:5]", "[line 3]"
    m = msg.match(/[(\[](?:line\s+)?(\d+)\s*[,:]\s*(?:col(?:umn)?\s*)?(\d+)?[\])]/i)
    if (m) {
        const line = parseInt(m[1], 10)
        const col = m[2] ? parseInt(m[2], 10) : 1
        if (Number.isFinite(line) && line >= 1) {
            return { line, col: Number.isFinite(col) && col >= 1 ? col : 1 }
        }
    }

    // 3. WGSL compiler log: "15:12: error:" or "15:12 error:"
    m = msg.match(/(?:^|[\r\n\s])(\d+):(\d+)(?:\s*:\s*|\s+)(?:error|warning|parse)/i)
    if (m) {
        const line = parseInt(m[1], 10)
        const col = parseInt(m[2], 10)
        if (Number.isFinite(line) && line >= 1) {
            return { line, col: Number.isFinite(col) && col >= 1 ? col : 1 }
        }
    }

    // 4. GLSL shader compiler log: "ERROR: 0:42: ..." or "0:42(10): ..." or "ERROR: 0:42(10):"
    m = msg.match(/(?:^|[\r\n]|ERROR:\s+)\b\d+:(\d+)(?:\((\d+)\))?/i)
    if (m) {
        const line = parseInt(m[1], 10)
        const col = m[2] ? parseInt(m[2], 10) : 1
        if (Number.isFinite(line) && line >= 1) {
            return { line, col: Number.isFinite(col) && col >= 1 ? col : 1 }
        }
    }

    return null
}

/**
 * Formats a clean human-readable error label for the error banner.
 *
 * Strips redundant prefixes ('SyntaxError:', 'Error:'), leading compiler line markers
 * (WGSL, GLSL, DSL), and trailing 'at line X col Y' suffixes, standardizing to:
 * 'line L:C — <message>'. Idempotent on already formatted banner labels.
 */
export function formatErrorLabel(errorText, loc) {
    if (!errorText || typeof errorText !== 'string') return ''
    let clean = errorText.trim()

    // Strip leading generic error type prefixes
    clean = clean.replace(/^(?:SyntaxError|Error|CompileError):\s*/i, '')

    // Strip already-formatted banner prefixes (e.g. "line 7:11 — ")
    clean = clean.replace(/^line\s+\d+:\d+\s*[—\-:]\s*/i, '')

    // Strip leading Noisemaker / standard line indicator prefixes (e.g. "line 12:5: ", "--> line 8, column 28: ", "Line 15: ")
    clean = clean.replace(/^(?:-->\s*)?line\s+\d+(?:\s*[:]\s*\d+|\s*[,;]?\s*col(?:umn)?\s*\d+)?(?:\s*:\s*|\s*—\s*|\s+)/i, '')

    // Strip WGSL diagnostic prefix (e.g. "15:12: error: " or "15:12 error: ")
    clean = clean.replace(/^\d+:\d+(?:\s*:\s*|\s+)(?:error:\s*)?/i, '')

    // Strip GLSL diagnostic prefix (e.g. "ERROR: 0:42: " or "ERROR: 0:42(10): " or "0:42: ")
    clean = clean.replace(/^(?:ERROR:\s+)?\d+:\d+(?:\(\d+\))?:\s*/i, '')

    // Strip trailing line/col suffixes (e.g. "at line 7 col 11", "--> line 8, col 28")
    clean = clean.replace(/\s+(?:at|-->)\s+line\s+\d+.*$/i, '')
    clean = clean.replace(/\s*[(\[](?:line\s+)?\d+[,:]\s*(?:col(?:umn)?\s*)?\d*?[\])]/i, '')
    clean = clean.trim()

    if (!loc) return clean || errorText
    return `line ${loc.line}:${loc.col} — ${clean || errorText}`
}

