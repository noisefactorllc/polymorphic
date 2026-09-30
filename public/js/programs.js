/**
 * Programs - User-saved DSL programs storage for Polymorphic
 * Stores DSL programs in localStorage
 * @module programs
 */

import { safeSetItem, safeGetItem, getLocalStorage } from './storageGuard.js'

const STORAGE_KEY = 'polymorphic-programs'

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
     * Saves a program
     * @param {string} name - Program name
     * @param {string} dsl - DSL source code
     * @returns {{ success: boolean, quotaExceeded?: boolean, error?: unknown, recovered?: boolean }}
     */
    saveProgram(name, dsl, images = []) {
        const previous = this.programs[name]
        this.programs[name] = {
            name,
            dsl,
            images,
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
}

// Export singleton instance
export const programs = new Programs()
