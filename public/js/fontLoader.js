/**
 * Font Loader for Polymorphic
 *
 * Dynamically loads fonts from fonts.noisefactor.io for text effects in compositions.
 * Uses FontFace API for fast loading without full bundle download.
 *
 * @module fontLoader
 */

const FONTS_BASE_URL = (typeof window !== 'undefined' && window.electronAPI?.isElectron)
    ? '../../../vendor/fonts.noisefactor.io'
    : 'https://fonts.noisefactor.io'

/**
 * Font Loader singleton
 */
class FontLoader {
    constructor() {
        /** @type {Object|null} - Cached font catalog */
        this._catalog = null

        /** @type {Set<string>} - Set of loaded font family names */
        this._loadedFonts = new Set()

        /** @type {Map<string, Promise>} - In-progress font loads */
        this._loadingPromises = new Map()
    }

    /**
     * Load the font catalog from fonts.noisefactor.io
     * @returns {Promise<Object>} The font catalog
     */
    async loadCatalog() {
        if (this._catalog) return this._catalog

        try {
            const response = await fetch(`${FONTS_BASE_URL}/bundle/fonts.json`)
            if (!response.ok) {
                throw new Error(`Failed to load font catalog: ${response.status}`)
            }
            this._catalog = await response.json()
            return this._catalog
        } catch (err) {
            console.error('Failed to load font catalog:', err)
            return null
        }
    }

    /**
     * Find a font in the catalog by name
     * @param {string} fontName - The font name (e.g., "Inter", "Noto Sans")
     * @returns {Object|null} The font entry from catalog
     */
    findFont(fontName) {
        if (!this._catalog?.fonts) return null

        // Exact match first
        let font = this._catalog.fonts.find(f => f.name === fontName)
        if (font) return font

        // Case-insensitive match
        const lowerName = fontName.toLowerCase()
        font = this._catalog.fonts.find(f => f.name.toLowerCase() === lowerName)
        if (font) return font

        // Normalized match (remove spaces, dashes)
        const normalize = s => s.toLowerCase().replace(/[\s-]/g, '')
        const normalizedName = normalize(fontName)
        return this._catalog.fonts.find(f => normalize(f.name) === normalizedName)
    }

    /**
     * Get the best file for a font (prefers variable woff2, non-italic)
     * @param {Object} font - Font entry from catalog
     * @returns {Object|null} The font file entry
     */
    getBestFile(font) {
        if (!font?.files?.length) return null

        const files = font.files

        // Prefer variable fonts (contain [wght] or [wdth,wght] in name)
        const variableFiles = files.filter(f =>
            /\.woff2$/i.test(f.filename) &&
            /\[.*wght.*\]/i.test(f.filename) &&
            !/italic/i.test(f.filename)
        )
        if (variableFiles.length > 0) return variableFiles[0]

        // Then regular woff2 non-italic
        const woff2Files = files.filter(f =>
            /\.woff2$/i.test(f.filename) &&
            !/italic/i.test(f.filename)
        )

        // Prefer "Regular" or non-weight-specified files
        const regularFile = woff2Files.find(f =>
            /regular/i.test(f.filename) ||
            !/\b(thin|light|medium|bold|black|extra|semi)\b/i.test(f.filename)
        )
        if (regularFile) return regularFile

        if (woff2Files.length > 0) return woff2Files[0]

        // Fallback to any woff2
        return files.find(f => /\.woff2$/i.test(f.filename)) || files[0]
    }

    /**
     * Load a font by name
     * @param {string} fontName - The font name (e.g., "Inter", "Noto Sans")
     * @returns {Promise<boolean>} True if font was loaded or already available
     */
    async loadFont(fontName) {
        // Skip generic/system fonts
        const genericFonts = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']
        if (genericFonts.includes(fontName.toLowerCase())) {
            return true
        }

        // Already loaded?
        if (this._loadedFonts.has(fontName)) {
            return true
        }

        // Already loading?
        if (this._loadingPromises.has(fontName)) {
            return this._loadingPromises.get(fontName)
        }

        // Start loading
        const loadPromise = this._loadFontInternal(fontName)
        this._loadingPromises.set(fontName, loadPromise)

        try {
            const result = await loadPromise
            return result
        } finally {
            this._loadingPromises.delete(fontName)
        }
    }

    /**
     * Internal font loading implementation
     * @private
     */
    async _loadFontInternal(fontName) {
        // Ensure catalog is loaded
        await this.loadCatalog()

        // Find font in catalog
        const font = this.findFont(fontName)
        if (!font) {
            console.warn(`Font not found in catalog: ${fontName}`)
            return false
        }

        // Get best file
        const file = this.getBestFile(font)
        if (!file) {
            console.warn(`No suitable font file for: ${fontName}`)
            return false
        }

        // Build URL - fonts are at /fonts/{font-folder}/{filename}
        // The dir_name has a numeric prefix (e.g., "96-sacramento") that we need to strip
        const fontFolder = font.dir_name.replace(/^\d+-/, '')
        const url = `${FONTS_BASE_URL}/fonts/${fontFolder}/${file.filename}`

        try {
            // Use FontFace API for dynamic loading
            const fontFace = new FontFace(font.name, `url(${url})`, {
                display: 'swap'
            })

            await fontFace.load()
            document.fonts.add(fontFace)

            // Ensure font is ready for canvas rendering
            // document.fonts.load() returns when font is fully ready for use
            await document.fonts.load(`16px "${font.name}"`)

            // Verify font is available
            const isReady = document.fonts.check(`16px "${font.name}"`)
            console.log(`Font ${font.name} ready for canvas: ${isReady}`)

            this._loadedFonts.add(fontName)
            // Also mark the canonical name as loaded
            if (font.name !== fontName) {
                this._loadedFonts.add(font.name)
            }

            console.log(`Loaded font: ${font.name}`)
            return true
        } catch (err) {
            console.error(`Failed to load font ${fontName}:`, err)
            return false
        }
    }

    /**
     * Extract font names from DSL text effects
     * @param {string} dsl - DSL source code
     * @returns {string[]} Array of font names found
     */
    extractFontsFromDsl(dsl) {
        const fonts = new Set()

        // Match text() calls with font parameter
        // e.g., text(text: "Hello", font: "Noto Sans")
        // or   .text(font: 'Inter', text: "World")
        const textCallRegex = /\.?text\s*\([^)]*\)/gi
        const matches = dsl.match(textCallRegex) || []

        for (const match of matches) {
            // Extract font parameter value
            // Matches: font: "Noto Sans" or font: 'Inter'
            const fontParamRegex = /font\s*:\s*["']([^"']+)["']/i
            const fontMatch = match.match(fontParamRegex)
            if (fontMatch) {
                fonts.add(fontMatch[1])
            }
        }

        return Array.from(fonts)
    }

    /**
     * Preload all fonts used in a DSL program
     * @param {string} dsl - DSL source code
     * @returns {Promise<void>}
     */
    async preloadFontsForDsl(dsl) {
        const fontNames = this.extractFontsFromDsl(dsl)

        if (fontNames.length === 0) return

        console.log(`Preloading fonts for DSL: ${fontNames.join(', ')}`)

        // Load all fonts in parallel
        await Promise.all(fontNames.map(name => this.loadFont(name)))

        // Wait for all fonts to be ready for rendering
        await document.fonts.ready
    }
}

// Singleton instance
let _instance = null

/**
 * Get the FontLoader singleton
 * @returns {FontLoader}
 */
export function getFontLoader() {
    if (!_instance) {
        _instance = new FontLoader()
    }
    return _instance
}

/**
 * Preload fonts for a DSL program
 * Convenience function that uses the singleton
 * @param {string} dsl - DSL source code
 * @returns {Promise<void>}
 */
export async function preloadFontsForDsl(dsl) {
    return getFontLoader().preloadFontsForDsl(dsl)
}
