export function parseErrorLocation(msg) {
    if (!msg) return null
    let m = msg.match(/(?:at\s+)?line\s+(\d+)\s*(?:[,;]?\s*col(?:umn)?\s+(\d+))?/i)
    if (!m) m = msg.match(/\((?:line\s+)?(\d+)[,:]\s*(?:col(?:umn)?\s*)?(\d+)?\)/i)
    if (!m) return null
    const line = parseInt(m[1], 10)
    const col = m[2] ? parseInt(m[2], 10) : 1
    if (!Number.isFinite(line)) return null
    return { line, col }
}
