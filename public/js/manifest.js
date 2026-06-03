/**
 * Effect Manifest Cache
 *
 * Loads the effect manifest from the noisemaker CDN once and caches it.
 * Provides search/lookup helpers used by the command palette, autocomplete,
 * inspiration gallery, and any other feature that needs to know what effects
 * exist.
 */

const MANIFEST_URL = (typeof window !== 'undefined' && window.electronAPI?.isElectron)
    ? 'app://polymorphic/vendor/noisemaker/1.0.60/effects/manifest.json'
    : 'https://shaders.noisedeck.app/1/effects/manifest.json'

let manifestPromise = null
let manifest = null
let effects = null

const NAMESPACE_ORDER = [
    'synth', 'filter', 'mixer', 'render', 'points',
    'synth3d', 'filter3d', 'classicNoisedeck', 'classicNoisemaker', 'user'
]

/**
 * @typedef {Object} EffectInfo
 * @property {string} id          - 'synth/noise'
 * @property {string} namespace   - 'synth'
 * @property {string} name        - 'noise'
 * @property {string} description - human-readable summary
 * @property {string[]} tags
 * @property {boolean} starter    - is a source / starter effect (no input pipeline)
 */

/**
 * Load the manifest. Returns the cached value on subsequent calls.
 * @returns {Promise<{manifest: object, effects: EffectInfo[]}>}
 */
export function loadManifest() {
    if (manifestPromise) return manifestPromise

    manifestPromise = fetch(MANIFEST_URL)
        .then(r => {
            if (!r.ok) throw new Error(`Manifest fetch failed: ${r.status}`)
            return r.json()
        })
        .then(data => {
            manifest = data
            effects = Object.entries(data).map(([id, info]) => {
                const slash = id.indexOf('/')
                const namespace = slash >= 0 ? id.slice(0, slash) : ''
                const name = slash >= 0 ? id.slice(slash + 1) : id
                return {
                    id,
                    namespace,
                    name,
                    description: info.description || '',
                    tags: info.tags || [],
                    starter: info.starter === true
                }
            })
            return { manifest, effects }
        })
        .catch(err => {
            // Reset so we can retry later
            manifestPromise = null
            throw err
        })

    return manifestPromise
}

/**
 * Get loaded manifest. Returns null if not yet loaded.
 * @returns {object|null}
 */
export function getManifest() {
    return manifest
}

/**
 * Get loaded effect list. Returns [] if not yet loaded.
 * @returns {EffectInfo[]}
 */
export function getEffects() {
    return effects || []
}

/**
 * Lookup a single effect by name (case-insensitive). Searches across all namespaces;
 * returns the first match. Pass an explicit namespace to narrow.
 * @param {string} name
 * @param {string} [namespace]
 * @returns {EffectInfo|null}
 */
export function findEffect(name, namespace = null) {
    if (!effects) return null
    const lower = name.toLowerCase()
    for (const e of effects) {
        if (e.name.toLowerCase() !== lower) continue
        if (namespace && e.namespace !== namespace) continue
        return e
    }
    return null
}

/**
 * Group effects by namespace, in canonical order.
 * @returns {Array<{namespace: string, effects: EffectInfo[]}>}
 */
export function effectsByNamespace() {
    if (!effects) return []
    const groups = new Map()
    for (const e of effects) {
        if (!groups.has(e.namespace)) groups.set(e.namespace, [])
        groups.get(e.namespace).push(e)
    }
    const ordered = []
    for (const ns of NAMESPACE_ORDER) {
        if (groups.has(ns)) ordered.push({ namespace: ns, effects: groups.get(ns).sort(byName) })
    }
    for (const [ns, list] of groups) {
        if (!NAMESPACE_ORDER.includes(ns)) ordered.push({ namespace: ns, effects: list.sort(byName) })
    }
    return ordered
}

function byName(a, b) { return a.name.localeCompare(b.name) }

/**
 * Fuzzy-match query against the effect list. Returns top N results sorted by score.
 *
 * Scoring is intentionally simple — exact prefix > substring > token match.
 * Designed to be fast enough to call every keystroke across ~200 effects.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {string[]} [opts.namespaces] - restrict to these namespaces only
 * @returns {Array<EffectInfo & {score: number}>}
 */
export function fuzzySearch(query, opts = {}) {
    if (!effects) return []
    const limit = opts.limit ?? 20
    const allowedNs = opts.namespaces ? new Set(opts.namespaces) : null
    const q = query.trim().toLowerCase()
    if (!q) return []

    const scored = []
    for (const e of effects) {
        if (allowedNs && !allowedNs.has(e.namespace)) continue
        const score = scoreEffect(e, q)
        if (score > 0) scored.push({ ...e, score })
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return scored.slice(0, limit)
}

function scoreEffect(effect, q) {
    const name = effect.name.toLowerCase()
    const desc = effect.description.toLowerCase()
    const id = effect.id.toLowerCase()

    if (name === q) return 100
    if (name.startsWith(q)) return 80 - (name.length - q.length) * 0.5
    if (id.startsWith(q)) return 70
    if (name.includes(q)) return 50
    if (id.includes(q)) return 40
    if (desc.includes(q)) return 20

    // Subsequence match: do all chars of q appear in name in order?
    let i = 0
    for (const ch of name) {
        if (i < q.length && ch === q[i]) i++
    }
    if (i === q.length) return 15

    // Tag match
    for (const tag of effect.tags) {
        if (tag.toLowerCase().includes(q)) return 10
    }
    return 0
}
