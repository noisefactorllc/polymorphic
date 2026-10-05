/**
 * Programs - User-saved DSL programs storage for Polymorphic
 * Stores DSL programs in localStorage; the images they name are stored in
 * IndexedDB by programImages.js
 * @module programs
 */

import { safeSetItem, safeGetItem, getLocalStorage } from './storageGuard.js'
import { hasImageText } from './programImages.js'

const STORAGE_KEY = 'polymorphic-programs'

/**
 * Whether a stored program carries images as base64 text, as saves made
 * before images had their own storage did: inside the DSL, or in an
 * `images` list of `{id, dataUrl}` beside it.
 */
function carriesImageText(program) {
    return typeof program?.dsl === 'string' &&
        (Array.isArray(program.images) && program.images.length > 0 || hasImageText(program.dsl))
}

/**
 * Programs manager class for saving, loading, and deleting user DSL programs
 */
export class Programs {
    constructor(storage) {
        this._storage = storage !== undefined ? storage : getLocalStorage()
        this.programs = {}
        this.load()
    }

    /**
     * Returns the current programs
     * @returns {object}
     */
    get current() {
        return this.programs
    }

    /**
     * Loads programs from localStorage
     */
    load() {
        if (!this._storage) return
        try {
            const raw = safeGetItem(this._storage, STORAGE_KEY)
            if (raw) {
                this.programs = JSON.parse(raw) || {}
            }
        } catch (err) {
            console.error('Error loading programs:', err)
            this.programs = {}
        }
    }

    /**
     * Saves programs to localStorage
     * @returns {{ success: boolean, quotaExceeded?: boolean, error?: unknown, reason?: string, recovered?: boolean }}
     */
    save() {
        if (!this._storage) {
            return { success: false, reason: 'unsupported' }
        }
        return safeSetItem(this._storage, STORAGE_KEY, JSON.stringify(this.programs))
    }

    /**
     * Gets all program names sorted alphabetically
     * @returns {string[]}
     */
    getNames() {
        return Object.keys(this.programs)
            .filter(name => name && name.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }

    /**
     * Gets a program by name
     * @param {string} name - Program name
     * @returns {object|null}
     */
    get(name) {
        return this.programs[name] || null
    }

    /**
     * Checks if a program exists
     * @param {string} name - Program name
     * @returns {boolean}
     */
    has(name) {
        return Object.prototype.hasOwnProperty.call(this.programs, name)
    }

    /**
     * Saves a program. The images its DSL references are stored separately,
     * by programImages.js, before this is called.
     * @param {string} name - Program name
     * @param {string} dsl - DSL source code
     * @returns {{ success: boolean, quotaExceeded?: boolean, error?: unknown, recovered?: boolean }}
     */
    saveProgram(name, dsl) {
        const previous = this.programs[name]
        this.programs[name] = {
            name,
            dsl,
            savedAt: Date.now()
        }
        const res = this.save()
        if (res && res.success === false) {
            if (previous !== undefined) {
                this.programs[name] = previous
            } else {
                delete this.programs[name]
            }
            return res
        }
        return res || { success: true }
    }

    /**
     * Deletes a program
     * @param {string} name - Program name
     * @returns {boolean} - True if deleted, false if not found or save failed
     */
    deleteProgram(name) {
        if (this.has(name)) {
            const previous = this.programs[name]
            delete this.programs[name]
            const res = this.save()
            if (res && res.success === false) {
                this.programs[name] = previous
                return false
            }
            return true
        }
        return false
    }

    /**
     * Move images that older saves kept inside programs as base64 text out
     * to image storage, then remove the text from the stored programs.
     *
     * A program loses its text only after `store` has committed its images,
     * so a failure leaves it exactly as it was. Storage is re-read after the
     * images are stored, because a save made meanwhile must not be
     * overwritten by the copy this started with.
     *
     * @param {(dsl: string, images: Array<{id: string, dataUrl: string}>) => Promise<string>} store -
     *   stores the images and resolves with the DSL naming them by reference
     * @returns {Promise<number>} how many programs were moved
     */
    async moveEmbeddedImages(store) {
        const moved = []
        for (const [name, program] of Object.entries(this.programs)) {
            if (!carriesImageText(program)) continue
            try {
                moved.push({ name, before: JSON.stringify(program), dsl: await store(program.dsl, program.images || []) })
            } catch (err) {
                console.error(`Error moving images of program "${name}":`, err)
            }
        }
        if (!moved.length) return 0
        this.load()
        let count = 0
        for (const { name, before, dsl } of moved) {
            // Only the program whose images were stored: one saved meanwhile
            // keeps its text until the next load moves it.
            const program = this.programs[name]
            if (JSON.stringify(program) !== before) continue
            const updated = { ...program, dsl }
            delete updated.images
            this.programs[name] = updated
            count++
        }
        if (!count) return 0
        const res = this.save()
        if (res && res.success === false) {
            this.load()
            return 0
        }
        return count
    }
}

// Export singleton instance
export const programs = new Programs()
