/**
 * Map textarea click positions to effect call sites.
 *
 * Given the DSL source and a caret offset, find the IDENT-LPAREN call name
 * at that position and pair it with the corresponding effect from
 * `extractEffectsFromDsl()` by source-order matching.
 *
 * @module ui/effectClickResolver
 */

import { lex, extractEffectsFromDsl } from '../noisemaker/bundle.js'

/**
 * Convert a 1-based (line, col) into a 0-based char offset.
 */
export function lineColToOffset(dsl, line, col) {
    let offset = 0
    let curLine = 1
    let curCol = 1
    while (offset < dsl.length) {
        if (curLine === line && curCol === col) return offset
        if (dsl[offset] === '\n') {
            curLine++
            curCol = 1
        } else {
            curCol++
        }
        offset++
    }
    return offset
}

/**
 * Walk depth-0 IDENT-LPAREN tokens and pair them with effects from
 * `extractEffectsFromDsl()` by source order. Returns an array of:
 *   { name, line, col, startOffset, endOffset, lparenIdx, rparenIdx,
 *     effect, effectIdx, tokenIdx }
 *
 * Limitation: assignment RHS like `let x = perlin(...)` will be counted
 * as a depth-0 IDENT-LPAREN. If the user has such patterns the mapping may
 * skew. For typical polymorphic DSL (chains writing to outputs) this is fine.
 */
export function getEffectCallSites(dsl) {
    const sites = []
    if (!dsl) return sites

    let tokens
    try {
        tokens = lex(dsl)
    } catch {
        return sites
    }
    // Filter out synthetic chain steps (e.g. `_write`, `_render`) that don't
    // appear in the source — they only exist in the compiled plan and would
    // otherwise stall the walk because they never match a source IDENT.
    const effects = (extractEffectsFromDsl(dsl) || [])
        .filter(e => e?.name && !e.name.startsWith('_'))
    if (effects.length === 0) return sites

    let depth = 0
    let effectIdx = 0

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t.type === 'LPAREN') { depth++; continue }
        if (t.type === 'RPAREN') { depth--; continue }
        if (depth !== 0) continue
        if (t.type !== 'IDENT') continue
        if (tokens[i + 1]?.type !== 'LPAREN') continue
        if (effectIdx >= effects.length) break
        if (t.lexeme !== effects[effectIdx].name) continue

        // Find matching RPAREN for this call
        let d = 0
        let rparenIdx = -1
        for (let j = i + 1; j < tokens.length; j++) {
            if (tokens[j].type === 'LPAREN') d++
            else if (tokens[j].type === 'RPAREN') {
                d--
                if (d === 0) { rparenIdx = j; break }
            }
        }
        if (rparenIdx === -1) continue

        const startOffset = lineColToOffset(dsl, t.line, t.col)
        const endOffset = startOffset + t.lexeme.length

        sites.push({
            tokenIdx: i,
            name: t.lexeme,
            line: t.line,
            col: t.col,
            startOffset,
            endOffset,
            lparenIdx: i + 1,
            rparenIdx,
            effect: effects[effectIdx],
            effectIdx
        })
        effectIdx++
    }

    return sites
}

/**
 * Find the call site whose name token contains `caretOffset`. Returns null if
 * the caret isn't inside any matched effect-call name.
 */
export function findCallSiteAtOffset(dsl, caretOffset) {
    const sites = getEffectCallSites(dsl)
    for (const site of sites) {
        if (caretOffset >= site.startOffset && caretOffset <= site.endOffset) {
            return site
        }
    }
    return null
}

/**
 * Re-resolve a previously-opened call site after the DSL changed. Tries to
 * find a call with the same name near the original line. Returns the new site,
 * or null if no longer present.
 */
export function reresolveCallSite(dsl, prevSite) {
    if (!prevSite) return null
    const sites = getEffectCallSites(dsl)
    if (sites.length === 0) return null

    let best = null
    let bestDist = Infinity
    for (const site of sites) {
        if (site.name !== prevSite.name) continue
        const dist = Math.abs(site.line - prevSite.line)
        if (dist < bestDist) {
            best = site
            bestDist = dist
        }
    }
    return best
}
