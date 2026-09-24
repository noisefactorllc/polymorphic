/**
 * Scenes — algorave-friendly clip launcher.
 *
 * Persists up to 9 named DSL programs to localStorage. The default store
 * guards against `localStorage is not defined` (e.g. Node test runs) so the
 * module can be imported in unit tests without a DOM.
 *
 * Bindings live in embed.js:
 *   • `1`..`9`                — recall slot
 *   • `Cmd/Ctrl+Shift+1..9`  — save current DSL to slot
 */

import { safeSetItem, safeGetItem, getLocalStorage } from '../storageGuard.js'

const KEY = 'polymorphic-scenes'

const localStorageStore = {
    get() {
        const storage = getLocalStorage()
        if (!storage) return null
        const raw = safeGetItem(storage, KEY)
        if (!raw) return null
        try {
            return JSON.parse(raw)
        } catch { return null }
    },
    set(v) {
        const storage = getLocalStorage()
        if (!storage) return { success: false, reason: 'unsupported' }
        return safeSetItem(storage, KEY, JSON.stringify(v))
    }
}

export class Scenes {
    constructor(store) {
        this._store = store || localStorageStore
        this._slots = this._store.get() || {}
    }
    save(slot, dsl) {
        if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
            throw new Error('Scene slot must be 1..9')
        }
        const previous = this._slots[slot]
        this._slots[slot] = dsl
        const res = this._store.set(this._slots)
        if (res && res.success === false) {
            if (previous !== undefined) this._slots[slot] = previous
            else delete this._slots[slot]
            return res
        }
        return { success: true }
    }
    load(slot) {
        return this._slots[slot] || null
    }
    list() {
        return Object.keys(this._slots).map(k => ({ slot: Number(k), dsl: this._slots[k] }))
    }
    clear(slot) {
        const previous = this._slots[slot]
        delete this._slots[slot]
        const res = this._store.set(this._slots)
        if (res && res.success === false) {
            if (previous !== undefined) this._slots[slot] = previous
            return false
        }
        return true
    }
}

export const scenes = new Scenes()
