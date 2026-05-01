export function surfacesWrittenInDsl(dsl) {
    if (!dsl) return []
    const matches = [...dsl.matchAll(/\.write\s*\(\s*o([0-7])\s*\)/g)]
    const ids = new Set(matches.map(m => parseInt(m[1], 10)))
    return [...ids].sort((a, b) => a - b)
}

export function currentRenderTarget(dsl) {
    if (!dsl) return null
    const matches = [...dsl.matchAll(/(?:^|\n)\s*render\s*\(\s*o([0-7])\s*\)/g)]
    if (!matches.length) return null
    return parseInt(matches[matches.length - 1][1], 10)
}
