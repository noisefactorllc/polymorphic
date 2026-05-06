/**
 * Noisedeck Examples — data layer for the gallery's third tab.
 *
 * Pulls program metadata from shuffleset's listing.json endpoint and
 * fetches individual .dsl files on demand. No DOM dependencies, so this
 * module is unit-testable under node:test.
 */

export const NOISEDECK_EXAMPLES_LISTING_URL =
    'https://shuffleset.stream/noisedeck/video/product-examples/example-programs/listing.json'

export const NOISEDECK_EXAMPLES_BASE = 'https://shuffleset.stream'

export const NOISEDECK_EXAMPLES_CACHE_MS = 60_000

let cachedListing = null
let cachedFetchedAt = 0

/**
 * Fetch the gallery listing. Cached for NOISEDECK_EXAMPLES_CACHE_MS so
 * re-opening the modal is cheap; pass {force: true} to bypass.
 */
export async function loadNoisedeckExamples({ force = false } = {}) {
    const stale = (Date.now() - cachedFetchedAt) > NOISEDECK_EXAMPLES_CACHE_MS
    if (cachedListing && !force && !stale) return cachedListing
    const res = await fetch(NOISEDECK_EXAMPLES_LISTING_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Noisedeck Examples listing HTTP ${res.status}`)
    const data = await res.json()
    cachedListing = data
    cachedFetchedAt = Date.now()
    return cachedListing
}

/**
 * Fetch a single DSL file's source. Returns plain text.
 */
export async function fetchNoisedeckExampleSource(listing, fileName) {
    const url = NOISEDECK_EXAMPLES_BASE + listing.filesUrl + encodeURIComponent(fileName)
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Noisedeck Examples DSL HTTP ${res.status}`)
    return res.text()
}
