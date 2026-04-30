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
 */

const STORAGE_KEY = 'polymorphic-snapshot-history'
const MAX_ENTRIES = 50

class SnapshotHistory {
    constructor() {
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
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
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
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: this._entries, cursor: this._cursor }))
        } catch { /* quota or disabled — silent */ }
    }
}

export const snapshotHistory = new SnapshotHistory()
