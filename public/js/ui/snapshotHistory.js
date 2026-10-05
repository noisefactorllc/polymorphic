/**
 * Snapshot History
 *
 * Tracks the editor's value across successful compiles. Lets the user step back
 * and forward through recent program states (Cmd/Ctrl+Alt+Left / Right).
 * Survives page reload via localStorage.
 *
 * This is *program-level* history (each entry is a whole DSL document) — it's
 * coarser than the editor's internal text-undo, and intentionally so. It's
 * meant for "I made a bunch of changes that all compiled — let me jump back".
 * Entries name images by reference; the images are stored in IndexedDB by
 * programImages.js.
 */

import { isQuotaExceededError, registerTransientPruner, getLocalStorage } from '../storageGuard.js'
import { hasImageText } from '../programImages.js'

const STORAGE_KEY = 'polymorphic-snapshot-history'
const MAX_ENTRIES = 50

export class SnapshotHistory {
    constructor(storage) {
        this._storage = storage !== undefined ? storage : getLocalStorage()
        this._entries = []
        this._cursor = -1     // index of current entry, -1 if none
        this._lastSaved = null // dedupe consecutive identical pushes
        this._suppress = false // when true, don't auto-snapshot (used during nav)
        this._listeners = []
        this._load()
    }

    /**
     * Add a snapshot. Truncates any "future" entries past the current cursor
     * so the history feels like a normal undo stack.
     * @param {string} dsl
     */
    push(dsl) {
        if (this._suppress) return
        if (!dsl || dsl === this._lastSaved) return
        // If we navigated back, clip the forward branch
        if (this._cursor < this._entries.length - 1) {
            this._entries = this._entries.slice(0, this._cursor + 1)
        }
        this._entries.push({ dsl, time: Date.now() })
        if (this._entries.length > MAX_ENTRIES) {
            this._entries.shift()
        }
        this._cursor = this._entries.length - 1
        this._lastSaved = dsl
        this._save()
        this._notify()
    }

    /**
     * Move cursor backward by one and return the DSL there.
     * @returns {string|null}
     */
    back() {
        if (this._cursor <= 0) return null
        this._cursor--
        const dsl = this._entries[this._cursor].dsl
        this._lastSaved = dsl
        this._save()
        this._notify()
        return dsl
    }

    /**
     * Move cursor forward by one and return the DSL there.
     * @returns {string|null}
     */
    forward() {
        if (this._cursor >= this._entries.length - 1) return null
        this._cursor++
        const dsl = this._entries[this._cursor].dsl
        this._lastSaved = dsl
        this._save()
        this._notify()
        return dsl
    }

    canBack() { return this._cursor > 0 }
    canForward() { return this._cursor < this._entries.length - 1 }

    /**
     * Wrap a function so any push() it triggers is suppressed.
     */
    silence(fn) {
        this._suppress = true
        try { return fn() } finally { this._suppress = false }
    }

    onChange(cb) { this._listeners.push(cb) }
    _notify() {
        for (const cb of this._listeners) {
            try { cb({ canBack: this.canBack(), canForward: this.canForward() }) } catch { /* ignore */ }
        }
    }

    _load() {
        if (!this._storage) return
        try {
            const raw = this._storage.getItem(STORAGE_KEY)
            if (raw) {
                const data = JSON.parse(raw)
                this._entries = Array.isArray(data.entries) ? data.entries.slice(-MAX_ENTRIES) : []
                this._cursor = Math.min(
                    typeof data.cursor === 'number' ? data.cursor : this._entries.length - 1,
                    this._entries.length - 1
                )
                this._lastSaved = this._cursor >= 0 ? this._entries[this._cursor]?.dsl : null
            }
        } catch (err) {
            console.warn('[SnapshotHistory] Load failed:', err)
        }
    }

    _save() {
        if (!this._storage) return
        try {
            this._storage.setItem(STORAGE_KEY, JSON.stringify({ entries: this._entries, cursor: this._cursor }))
        } catch (err) {
            if (isQuotaExceededError(err)) {
                // Quota exceeded: trim older entries and retry
                if (this.prune(Math.max(1, Math.floor(this._entries.length / 2)))) {
                    return
                }
                // If halving didn't succeed, trim to only the active cursor entry
                if (this._entries.length > 1 && this._cursor >= 0) {
                    const prevEntries = this._entries
                    const prevCursor = this._cursor
                    this._entries = [this._entries[this._cursor]]
                    this._cursor = 0
                    try {
                        this._storage.setItem(STORAGE_KEY, JSON.stringify({ entries: this._entries, cursor: this._cursor }))
                        this._notify()
                    } catch {
                        this._entries = prevEntries
                        this._cursor = prevCursor
                    }
                }
            }
        }
    }

    /**
     * Prunes old history entries to free up storage space.
     * Keeps up to targetCount entries, preserving the current cursor item.
     * @param {number} [targetCount=10]
     * @returns {boolean} True if entries were evicted.
     */
    prune(targetCount = 10) {
        if (this._entries.length <= targetCount) return false
        const prevEntries = this._entries
        const prevCursor = this._cursor
        const currentItem = this._cursor >= 0 ? this._entries[this._cursor] : null

        let newEntries
        if (this._cursor >= 0) {
            // Retain a window that guarantees currentItem is preserved
            const start = Math.max(0, Math.min(this._cursor - Math.floor(targetCount / 2), this._entries.length - targetCount))
            newEntries = this._entries.slice(start, start + targetCount)
        } else {
            newEntries = this._entries.slice(-targetCount)
        }

        this._entries = newEntries
        if (currentItem) {
            const idx = this._entries.indexOf(currentItem)
            this._cursor = idx >= 0 ? idx : this._entries.length - 1
        } else {
            this._cursor = Math.min(prevCursor, this._entries.length - 1)
        }

        if (this._storage) {
            try {
                this._storage.setItem(STORAGE_KEY, JSON.stringify({ entries: this._entries, cursor: this._cursor }))
                this._notify()
                return true
            } catch {
                // Roll back in memory if write failed
                this._entries = prevEntries
                this._cursor = prevCursor
                return false
            }
        }
        this._notify()
        return true
    }

    /**
     * Move images that older versions kept in history entries as base64 text
     * out to image storage, then rewrite those entries to name them by
     * reference.
     *
     * An entry loses its text only after `store` has committed its images, so
     * a failure leaves it as it was. Stored history is re-read before it is
     * written, so entries another tab saved meanwhile are kept.
     *
     * @param {(dsl: string, images: Array) => Promise<string>} store -
     *   stores the images and resolves with the DSL naming them by reference
     * @returns {Promise<number>} how many stored entries were rewritten
     */
    async moveEmbeddedImages(store) {
        const carriers = new Set()
        for (const entry of [...this._entries, ...(this._readStored()?.entries || [])]) {
            if (hasImageText(entry?.dsl)) carriers.add(entry.dsl)
        }
        const moved = new Map()
        for (const dsl of carriers) {
            try {
                moved.set(dsl, await store(dsl, []))
            } catch (err) {
                console.error('[SnapshotHistory] Error moving images of an entry:', err)
            }
        }
        if (!moved.size) return 0
        // The images are stored, so entries in memory can name them now; the
        // next save writes them.
        for (const entry of this._entries) {
            if (moved.has(entry?.dsl)) entry.dsl = moved.get(entry.dsl)
        }
        if (moved.has(this._lastSaved)) this._lastSaved = moved.get(this._lastSaved)
        const data = this._readStored()
        let count = 0
        for (const entry of data?.entries || []) {
            if (moved.has(entry?.dsl)) {
                entry.dsl = moved.get(entry.dsl)
                count++
            }
        }
        if (!count) return 0
        try {
            this._storage.setItem(STORAGE_KEY, JSON.stringify(data))
        } catch (err) {
            console.warn('[SnapshotHistory] Rewriting stored entries failed:', err)
            return 0
        }
        return count
    }

    /** History as stored now, or null if storage is unavailable or unreadable. */
    _readStored() {
        try {
            const data = JSON.parse(this._storage?.getItem(STORAGE_KEY) ?? 'null')
            return Array.isArray(data?.entries) ? data : null
        } catch {
            return null
        }
    }
}

export const snapshotHistory = new SnapshotHistory()

registerTransientPruner(() => {
    if (snapshotHistory._entries.length > 5) {
        return snapshotHistory.prune(5)
    }
    if (snapshotHistory._entries.length > 1) {
        return snapshotHistory.prune(1)
    }
    return false
})

