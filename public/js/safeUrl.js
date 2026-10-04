/**
 * Navigation URL guard for values that arrive through the DOM (for example the
 * JSON a page embeds for itself). Only http(s) targets pass; anything else,
 * such as a javascript: or data: URL, is rejected.
 *
 * @param {string} url - Absolute or relative URL
 * @param {string} base - Base URL used to resolve relative values
 * @returns {string|null} The URL as written when safe, otherwise null
 */
export function safeNavigationUrl(url, base) {
    if (typeof url !== 'string' || !url) return null
    let parsed
    try {
        parsed = new URL(url, base)
    } catch {
        return null
    }
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null
}
