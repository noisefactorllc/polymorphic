/**
 * Programs - User-saved DSL programs storage for Polymorphic
 * Stores DSL programs in localStorage
 * @module programs
 */

const STORAGE_KEY = 'polymorphic-programs'

/**
 * Programs manager class for saving, loading, and deleting user DSL programs
 */
class Programs {
    constructor() {
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
        if (Object.prototype.hasOwnProperty.call(localStorage, STORAGE_KEY)) {
            try {
                this.programs = JSON.parse(localStorage.getItem(STORAGE_KEY))
            } catch (err) {
                console.error('Error loading programs:', err)
                this.programs = {}
            }
        }
    }

    /**
     * Saves programs to localStorage
     */
    save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.programs))
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
     */
    saveProgram(name, dsl) {
        this.programs[name] = {
            name,
            dsl,
            savedAt: Date.now()
        }
        this.save()
    }

    /**
     * Deletes a program
     * @param {string} name - Program name
     * @returns {boolean} - True if deleted, false if not found
     */
    deleteProgram(name) {
        if (this.has(name)) {
            delete this.programs[name]
            this.save()
            return true
        }
        return false
    }
}

// Export singleton instance
export const programs = new Programs()
