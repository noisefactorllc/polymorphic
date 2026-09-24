/**
 * Storage Guard — browser storage resilience and quota exhaustion management.
 *
 * Provides safe storage access with QuotaExceededError detection, cross-browser
 * error normalization, and eviction hooks to allow non-critical transient caches
 * (such as undo/snapshot history) to yield space to user-critical saves (scenes, programs).
 *
 * @module storageGuard
 */

/**
 * Registry of transient pruners (e.g. snapshot history) that can be invoked
 * to shed non-critical cached data when storage is exhausted.
 * @type {Set<() => boolean>}
 */
const transientPruners = new Set()

/**
 * Detects whether an error thrown by browser storage is a QuotaExceededError.
 * Covers Chromium, Firefox, WebKit/Safari, and legacy DOM exceptions.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isQuotaExceededError(err) {
    if (!err || typeof err !== 'object') return false
    const name = err.name || ''
    const code = err.code
    return (
        name === 'QuotaExceededError' ||
        name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        code === 22 || // DOMException.QUOTA_EXCEEDED_ERR
        code === 1014 || // NS_ERROR_DOM_QUOTA_REACHED
        err.number === -2146828281 ||
        /quota/i.test(err.message || '')
    )
}

/**
 * Register a callback to prune transient/cached data (e.g. undo history)
 * when a storage quota error is hit.
 * @param {() => boolean} pruner - Callback that prunes transient data and returns true if space was freed.
 * @returns {() => void} Unsubscribe function.
 */
export function registerTransientPruner(pruner) {
    if (typeof pruner === 'function') {
        transientPruners.add(pruner)
    }
    return () => {
        transientPruners.delete(pruner)
    }
}

/**
 * Invokes registered pruners to free up space in localStorage.
 * @returns {boolean} True if any pruner freed space.
 */
export function pruneTransientStorage() {
    let freed = false
    for (const pruner of transientPruners) {
        try {
            if (pruner()) {
                freed = true
            }
        } catch (err) {
            console.warn('[StorageGuard] Pruner failed:', err)
        }
    }
    return freed
}

/**
 * Safely accesses the browser's localStorage without throwing SecurityError
 * in sandboxed iframes or privacy-restricted browsing modes.
 * @returns {Storage|null}
 */
export function getLocalStorage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage
        }
    } catch {
        return null
    }
    return null
}

/**
 * Safely writes a key-value pair to storage with quota detection and recovery.
 * @param {Storage|undefined|null} storage - Storage object (e.g., localStorage)
 * @param {string} key
 * @param {string} value
 * @param {object} [options]
 * @param {boolean} [options.pruneOnQuota=true] - Attempt to reclaim quota from transient caches on quota error.
 * @returns {{ success: boolean, quotaExceeded?: boolean, error?: unknown, reason?: string, recovered?: boolean }}
 */
export function safeSetItem(storage, key, value, { pruneOnQuota = true } = {}) {
    if (!storage || typeof storage.setItem !== 'function') {
        return { success: false, reason: 'unsupported' }
    }
    try {
        storage.setItem(key, value)
        return { success: true }
    } catch (err) {
        if (isQuotaExceededError(err)) {
            let attempts = 0
            while (pruneOnQuota && attempts < 3 && pruneTransientStorage()) {
                attempts++
                try {
                    storage.setItem(key, value)
                    return { success: true, recovered: true }
                } catch (retryErr) {
                    if (!isQuotaExceededError(retryErr)) {
                        return {
                            success: false,
                            quotaExceeded: false,
                            error: retryErr
                        }
                    }
                }
            }
            return {
                success: false,
                quotaExceeded: true,
                error: err
            }
        }
        return {
            success: false,
            quotaExceeded: false,
            error: err
        }
    }
}

/**
 * Safely reads a key from storage with error boundary.
 * @param {Storage|undefined|null} storage
 * @param {string} key
 * @param {string|null} [fallback=null]
 * @returns {string|null}
 */
export function safeGetItem(storage, key, fallback = null) {
    if (!storage || typeof storage.getItem !== 'function') return fallback
    try {
        const val = storage.getItem(key)
        return val !== null ? val : fallback
    } catch {
        return fallback
    }
}

/**
 * Safely removes a key from storage with error boundary.
 * @param {Storage|undefined|null} storage
 * @param {string} key
 * @returns {boolean}
 */
export function safeRemoveItem(storage, key) {
    if (!storage || typeof storage.removeItem !== 'function') return false
    try {
        storage.removeItem(key)
        return true
    } catch {
        return false
    }
}
