/**
 * Scenes — algorave-friendly clip launcher.
 *
 * Persists up to 9 named DSL programs to localStorage. The images a scene's
 * DSL names are stored in IndexedDB by programImages.js. The default store
 * guards against `localStorage is not defined` (e.g. Node test runs) so the
 * module can be imported in unit tests without a DOM.
 *
 * Bindings live in embed.js:
 *   • `1`..`9`                — recall slot
 *   • `Cmd/Ctrl+Shift+1..9`  — save current DSL to slot
 */

import { safeSetItem, safeGetItem, getLocalStorage } from '../storageGuard.js'
import { hasImageText } from '../programImages.js'

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
        const saved = this._slots[slot]
        return (typeof saved === 'string' ? saved : saved?.dsl) || null
    }
    /**
     * The `{id, dataUrl}` images that scenes saved before images had their
     * own storage keep beside their DSL, until moveEmbeddedImages moves them.
     */
    images(slot) {
        return this._slots[slot]?.images || []
    }
    list() {
        return Object.keys(this._slots).map(k => ({ slot: Number(k), dsl: this.load(k) }))
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

    /**
     * Move images that older saves kept in scenes as base64 text, inside the
     * DSL or in an `images` list beside it, out to image storage, then store
     * each such scene as its DSL alone.
     *
     * A scene loses its text only after `store` has committed its images, so
     * a failure leaves it as it was. The store is re-read before it is
     * written, so a scene saved meanwhile is kept.
     *
     * @param {(dsl: string, images: Array<{id: string, dataUrl: string}>) => Promise<string>} store -
     *   stores the images and resolves with the DSL naming them by reference
     * @returns {Promise<number>} how many scenes were moved
     */
    async moveEmbeddedImages(store) {
        const moved = []
        for (const [slot, saved] of Object.entries(this._slots)) {
            const dsl = typeof saved === 'string' ? saved : saved?.dsl
            const images = typeof saved === 'string' ? [] : saved?.images || []
            if (typeof dsl !== 'string' || !images.length && !hasImageText(dsl)) continue
            try {
                moved.push({ slot, before: JSON.stringify(saved), dsl: await store(dsl, images) })
            } catch (err) {
                console.error(`Error moving images of scene ${slot}:`, err)
            }
        }
        if (!moved.length) return 0
        const current = this._store.get() || {}
        let count = 0
        for (const { slot, before, dsl } of moved) {
            if (JSON.stringify(current[slot]) !== before) continue
            current[slot] = dsl
            count++
        }
        if (!count) return 0
        const res = this._store.set(current)
        if (res && res.success === false) return 0
        this._slots = current
        return count
    }
}

export const scenes = new Scenes()
