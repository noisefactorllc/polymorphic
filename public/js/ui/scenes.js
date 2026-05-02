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

const KEY = 'polymorphic-scenes'

const localStorageStore = {
    get() {
        try {
            if (typeof localStorage === 'undefined') return null
            return JSON.parse(localStorage.getItem(KEY) || 'null')
        } catch { return null }
    },
    set(v) {
        try {
            if (typeof localStorage === 'undefined') return
            localStorage.setItem(KEY, JSON.stringify(v))
        } catch {}
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
        this._slots[slot] = dsl
        this._store.set(this._slots)
    }
    load(slot) {
        return this._slots[slot] || null
    }
    list() {
        return Object.keys(this._slots).map(k => ({ slot: Number(k), dsl: this._slots[k] }))
    }
    clear(slot) {
        delete this._slots[slot]
        this._store.set(this._slots)
    }
}

export const scenes = new Scenes()
