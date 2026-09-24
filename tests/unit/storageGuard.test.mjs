import { test } from 'node:test'
import assert from 'node:assert'
import {
    isQuotaExceededError,
    safeSetItem,
    safeGetItem,
    safeRemoveItem,
    registerTransientPruner,
    pruneTransientStorage
} from '../../public/js/storageGuard.js'

test('isQuotaExceededError identifies standard browser quota errors', () => {
    assert.strictEqual(isQuotaExceededError({ name: 'QuotaExceededError' }), true)
    assert.strictEqual(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true)
    assert.strictEqual(isQuotaExceededError({ code: 22 }), true)
    assert.strictEqual(isQuotaExceededError({ code: 1014 }), true)
    assert.strictEqual(isQuotaExceededError({ number: -2146828281 }), true)
    assert.strictEqual(isQuotaExceededError({ message: 'The quota has been exceeded.' }), true)
    assert.strictEqual(isQuotaExceededError({ message: 'Storage quota exceeded' }), true)

    assert.strictEqual(isQuotaExceededError(null), false)
    assert.strictEqual(isQuotaExceededError(undefined), false)
    assert.strictEqual(isQuotaExceededError(new Error('SyntaxError')), false)
    assert.strictEqual(isQuotaExceededError({ name: 'SecurityError' }), false)
})

test('safeSetItem writes successfully to functional storage', () => {
    const map = new Map()
    const storage = {
        setItem(k, v) { map.set(k, v) },
        getItem(k) { return map.get(k) ?? null },
        removeItem(k) { map.delete(k) }
    }

    const res = safeSetItem(storage, 'test-key', 'test-value')
    assert.strictEqual(res.success, true)
    assert.strictEqual(map.get('test-key'), 'test-value')
})

test('safeSetItem returns unsupported when storage is missing or invalid', () => {
    assert.deepStrictEqual(safeSetItem(null, 'k', 'v'), { success: false, reason: 'unsupported' })
    assert.deepStrictEqual(safeSetItem(undefined, 'k', 'v'), { success: false, reason: 'unsupported' })
    assert.deepStrictEqual(safeSetItem({}, 'k', 'v'), { success: false, reason: 'unsupported' })
})

test('safeSetItem invokes pruner on QuotaExceededError and recovers', () => {
    let quotaHit = true
    let pruned = false
    const map = new Map()

    const unreg = registerTransientPruner(() => {
        pruned = true
        quotaHit = false // Pruning freed up space!
        return true
    })

    try {
        const storage = {
            setItem(k, v) {
                if (quotaHit) {
                    const err = new Error('Quota exceeded')
                    err.name = 'QuotaExceededError'
                    throw err
                }
                map.set(k, v)
            }
        }

        const res = safeSetItem(storage, 'save-item', 'saved-data')
        assert.strictEqual(res.success, true)
        assert.strictEqual(res.recovered, true)
        assert.strictEqual(pruned, true)
        assert.strictEqual(map.get('save-item'), 'saved-data')
    } finally {
        unreg()
    }
})

test('safeSetItem reports quotaExceeded when pruning fails to free space', () => {
    const err = new Error('Quota exceeded')
    err.name = 'QuotaExceededError'

    const storage = {
        setItem() { throw err }
    }

    const res = safeSetItem(storage, 'heavy-item', 'data')
    assert.strictEqual(res.success, false)
    assert.strictEqual(res.quotaExceeded, true)
    assert.strictEqual(res.error, err)
})

test('safeSetItem reports non-quota errors cleanly', () => {
    const err = new Error('Permission denied')
    err.name = 'SecurityError'

    const storage = {
        setItem() { throw err }
    }

    const res = safeSetItem(storage, 'k', 'v')
    assert.strictEqual(res.success, false)
    assert.strictEqual(res.quotaExceeded, false)
    assert.strictEqual(res.error, err)
})

test('safeGetItem and safeRemoveItem handle exceptions gracefully', () => {
    const throwingStorage = {
        getItem() { throw new Error('Storage read denied') },
        removeItem() { throw new Error('Storage delete denied') }
    }

    assert.strictEqual(safeGetItem(throwingStorage, 'k', 'default'), 'default')
    assert.strictEqual(safeRemoveItem(throwingStorage, 'k'), false)
    assert.strictEqual(safeGetItem(null, 'k', 'fallback'), 'fallback')
    assert.strictEqual(safeRemoveItem(null, 'k'), false)
})

test('getLocalStorage safely catches SecurityError or missing storage', async () => {
    const { getLocalStorage } = await import('../../public/js/storageGuard.js')

    // In Node environment without global localStorage, returns null without throwing
    const storage = getLocalStorage()
    assert.strictEqual(storage === null || typeof storage?.setItem === 'function', true)

    // Simulate restricted window where accessing localStorage throws SecurityError
    const originalWindow = globalThis.window
    try {
        globalThis.window = {
            get localStorage() {
                const err = new Error('The operation is insecure.')
                err.name = 'SecurityError'
                throw err
            }
        }
        assert.strictEqual(getLocalStorage(), null)
    } finally {
        globalThis.window = originalWindow
    }
})

test('safeSetItem loops over multi-tier pruners until write succeeds', () => {
    let quotaFailures = 2
    let prunerCalls = 0
    const map = new Map()

    const unreg = registerTransientPruner(() => {
        prunerCalls++
        quotaFailures--
        return true
    })

    try {
        const storage = {
            setItem(k, v) {
                if (quotaFailures > 0) {
                    const err = new Error('Quota exceeded')
                    err.name = 'QuotaExceededError'
                    throw err
                }
                map.set(k, v)
            }
        }

        const res = safeSetItem(storage, 'k', 'multi-tier-success')
        assert.strictEqual(res.success, true)
        assert.strictEqual(res.recovered, true)
        assert.strictEqual(prunerCalls, 2)
        assert.strictEqual(map.get('k'), 'multi-tier-success')
    } finally {
        unreg()
    }
})

