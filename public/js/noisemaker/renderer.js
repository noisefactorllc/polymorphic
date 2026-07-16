/**
 * Polymorphic Renderer - Minimal wrapper around Noisemaker CanvasRenderer
 *
 * Provides a simplified interface for the Polymorphic app to render DSL programs.
 * Includes text texture rendering for text effects.
 */

import { CanvasRenderer, extractEffectNamesFromDsl, extractEffectsFromDsl } from './bundle.js'
import { stripMediaUrlArg } from './dslSanitize.js'

// Shader assets served from the shaders CDN.
const SHADER_BASE_PATH = 'https://shaders.noisedeck.app/1'

/**
 * Default text parameters for text effects
 */
const TEXT_DEFAULTS = {
    text: 'Hello World',
    font: 'Nunito',
    size: 0.1,
    posX: 0.5,
    posY: 0.5,
    color: '#ffffff',
    rotation: 0,
    bgColor: '#000000',
    bgOpacity: 0,
    justify: 'center'
}

/**
 * Default media parameters for media effects
 */
const MEDIA_DEFAULTS = {
    url: null
}

/**
 * Extract media effect parameters from DSL
 * @param {string} dsl - DSL source code
 * @returns {Object|null} Media parameters or null if no media effect
 */
function extractMediaParams(dsl) {
    // Match media(...) calls. The inner pattern tolerates one level of nested
    // parens so URLs that contain them (e.g. ".../File_(1).png" or signed query
    // strings) aren't truncated at the first ')' — mirrors extractAllTextParams.
    const mediaCallRegex = /media\s*\(((?:[^()]*|\([^()]*\))*)\)/i
    const match = dsl.match(mediaCallRegex)
    if (!match) return null

    const params = { ...MEDIA_DEFAULTS }
    const paramsStr = match[1]

    // Extract URL parameter
    const urlMatch = paramsStr.match(/url\s*:\s*["']([^"']+)["']/i)
    if (urlMatch) params.url = urlMatch[1]

    return params.url ? params : null
}

/**
 * Extract text effect parameters from DSL
 * @param {string} dsl - DSL source code
 * @returns {Object|null} Text parameters or null if no text effect
 * @deprecated Use extractAllTextParams instead
 */
function extractTextParams(dsl) {
    // Match .text(...) calls
    const textCallRegex = /\.text\s*\(([^)]*)\)/i
    const match = dsl.match(textCallRegex)
    if (!match) return null

    return parseTextParamsString(match[1])
}

/**
 * Parse a text params string into a params object
 * @param {string} paramsStr - The parameters inside .text(...)
 * @returns {Object} Parsed parameters
 */
function parseTextParamsString(paramsStr) {
    const params = { ...TEXT_DEFAULTS }

    // Extract parameters
    const extractParam = (name, regex) => {
        const m = paramsStr.match(regex)
        return m ? m[1] : null
    }

    // String params
    const text = extractParam('text', /text\s*:\s*["']([^"']+)["']/i)
    if (text) params.text = text

    const font = extractParam('font', /font\s*:\s*["']([^"']+)["']/i)
    if (font) params.font = font

    const color = extractParam('color', /color\s*:\s*#([a-f0-9]{6,8})/i)
    if (color) params.color = `#${color.substring(0, 6)}`

    const bgColor = extractParam('bgColor', /bgColor\s*:\s*#([a-f0-9]{6,8})/i)
    if (bgColor) params.bgColor = `#${bgColor.substring(0, 6)}`

    const justify = extractParam('justify', /justify\s*:\s*(\w+)/i)
    if (justify) params.justify = justify

    // Numeric params
    const size = extractParam('size', /size\s*:\s*([\d.]+)/i)
    if (size) params.size = parseFloat(size)

    const posX = extractParam('posX', /posX\s*:\s*([\d.]+)/i)
    if (posX) params.posX = parseFloat(posX)

    const posY = extractParam('posY', /posY\s*:\s*([\d.]+)/i)
    if (posY) params.posY = parseFloat(posY)

    const rotation = extractParam('rotation', /rotation\s*:\s*([\d.-]+)/i)
    if (rotation) params.rotation = parseFloat(rotation)

    const bgOpacity = extractParam('bgOpacity', /bgOpacity\s*:\s*([\d.]+)/i)
    if (bgOpacity) params.bgOpacity = parseFloat(bgOpacity)

    return params
}

/**
 * Extract ALL text effect parameters from DSL with their positions
 * @param {string} dsl - DSL source code
 * @returns {Array<{params: Object, matchIndex: number}>} Array of text params with match positions
 */
function extractAllTextParams(dsl) {
    const results = []
    // Match ALL .text(...) calls globally - handle nested parens and multiline
    const textCallRegex = /\.text\s*\(((?:[^()]*|\([^()]*\))*)\)/gi
    let match
    
    while ((match = textCallRegex.exec(dsl)) !== null) {
        const params = parseTextParamsString(match[1])
        results.push({
            params,
            matchIndex: match.index
        })
    }
    
    return results
}

/**
 * Parse hex color to RGB array (0-1 range)
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
    ] : [1, 1, 1]
}

/**
 * PolymorphicRenderer - Renderer for Polymorphic live-coding environment
 *
 * @class
 */
export class PolymorphicRenderer {
    /**
     * Create a new PolymorphicRenderer
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {object} [options={}] - Configuration options
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas
        this.width = options.width || canvas?.width || 512
        this.height = options.height || canvas?.height || 512
        this.preferWebGPU = options.preferWebGPU || false
        this.loopDuration = options.loopDuration || 10

        // Create internal CanvasRenderer
        this._renderer = new CanvasRenderer({
            canvas: this.canvas,
            width: this.width,
            height: this.height,
            basePath: SHADER_BASE_PATH,
            preferWebGPU: this.preferWebGPU,
            useBundles: true,
            bundlePath: `${SHADER_BASE_PATH}/effects`,
            onError: options.onError
        })

        this._initialized = false

        // Text texture canvas (created on demand)
        this._textCanvas = null
    }

    /**
     * @returns {string} Current backend ('webgl2' or 'webgpu')
     */
    get backend() {
        return this._renderer.backend === 'wgsl' ? 'webgpu' : 'webgl2'
    }

    /**
     * @returns {CanvasRenderer} Underlying CanvasRenderer (for ProgramState integration)
     */
    get canvasRenderer() {
        return this._renderer
    }

    /**
     * @returns {boolean} Whether the render loop is running
     */
    get isRunning() {
        return this._renderer.isRunning
    }

    /**
     * @returns {object} Underlying noisemaker CanvasRenderer (for advanced integrations
     * like AudioInputManager, MidiInputManager, perf instrumentation)
     */
    get inner() {
        return this._renderer
    }

    /** @returns {number} Live FPS reported by the inner renderer */
    get currentFPS() {
        return this._renderer.currentFPS || 0
    }

    /** @returns {object} Frame-time stats from the inner renderer */
    getFrameTimeStats() {
        return this._renderer.getFrameTimeStats?.() || { mean: 0, std: 0, min: 0, max: 0, count: 0 }
    }

    /** @returns {number} Last frame render time in ms */
    get lastRenderTime() {
        return this._renderer.lastRenderTime || 0
    }

    /** @returns {number} Number of render passes in the last frame */
    get lastPassCount() {
        return this._renderer.lastPassCount || 0
    }

    /** @returns {number} Normalized loop time (0-1) */
    get lastTime() {
        return this._renderer.lastTime || 0
    }

    /**
     * Initialize the renderer
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return

        await this._renderer.loadManifest()
        this._renderer.setLoopDuration(this.loopDuration)
        this._initialized = true
    }

    /**
     * Start the render loop
     */
    start() {
        this._renderer.start()
    }

    /**
     * Stop the render loop
     */
    stop() {
        this._renderer.stop()
    }

    /**
     * Compile a DSL program
     * @param {string} dsl - DSL source code
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async compile(dsl) {
        if (!this._initialized) {
            await this.init()
        }

        try {
            // The engine never sees media() url args (it rejects them); strip
            // them for every engine/parser call. Param extraction below still
            // reads url/text from the original `dsl`.
            const engineDsl = stripMediaUrlArg(dsl)

            // Extract effect names and load them if needed
            const effectData = extractEffectNamesFromDsl(engineDsl, this._renderer.manifest || {})

            // Get effect IDs
            const effectIds = effectData.map(e => e.effectId)

            if (effectIds.length > 0) {
                await this._renderer.loadEffects(effectIds)
            }

            // Compile the DSL
            await this._renderer.compile(engineDsl)

            // Check for text effects and render text textures (supports multiple)
            const allTextParams = extractAllTextParams(dsl)
            const textStepIndices = this._findAllTextStepIndices(engineDsl)
            
            if (allTextParams.length > 0) {
                // Store for re-rendering on resize
                this._lastAllTextParams = []
                
                // Wait until the pipeline backend can accept the text texture
                await this._waitForPipeline()

                // Render each text effect
                for (let i = 0; i < allTextParams.length; i++) {
                    const { params } = allTextParams[i]
                    const stepIndex = textStepIndices[i] !== undefined ? textStepIndices[i] : i
                    
                    this._lastAllTextParams.push({ params, stepIndex })
                    this._renderTextTexture(params, stepIndex)
                }
            } else {
                this._lastAllTextParams = []
            }

            // Check for media effects and load image
            const mediaParams = extractMediaParams(dsl)
            if (mediaParams && mediaParams.url) {
                // Store for re-rendering on resize
                this._lastMediaParams = mediaParams
                // Find the step index for the media effect
                const mediaStepIndex = this._findMediaStepIndex(engineDsl)
                this._lastMediaStepIndex = mediaStepIndex
                // Wait until the pipeline backend can accept the media texture
                await this._waitForPipeline()
                await this._loadAndRenderMediaTexture(mediaParams, mediaStepIndex)
            } else {
                this._lastMediaParams = null
                this._lastMediaStepIndex = 0
            }

            return { success: true }
        } catch (err) {
            console.error('Compilation error:', err)
            
            let errorMessage = 'Unknown compilation error'
            if (typeof err === 'string') {
                errorMessage = err
            } else if (err instanceof Error) {
                errorMessage = err.message || err.toString()
            } else if (err && typeof err === 'object') {
                errorMessage = err.message || err.error || JSON.stringify(err)
            }
            
            return { success: false, error: errorMessage }
        }
    }

    /**
     * Resolve once the pipeline backend is ready to accept texture uploads.
     *
     * The engine assigns `_pipeline` (and its backend) synchronously inside the
     * awaited `compile()`, so in practice this returns on the very first check.
     * It replaces a fixed `setTimeout(…, 100)` that added blind latency to every
     * recompile carrying a text/media effect. Polling (rather than removing the
     * wait outright) keeps a deterministic, self-healing guard: if a future
     * engine ever defers pipeline setup, we wait exactly as long as needed up to
     * the cap instead of firing too early — `updateTextureFromSource` itself
     * no-ops with a "Pipeline not ready" warning when the backend is absent.
     *
     * @param {number} [maxMs=500] - upper bound before giving up
     * @returns {Promise<boolean>} true if the backend became ready in time
     * @private
     */
    async _waitForPipeline(maxMs = 500) {
        const deadline = Date.now() + maxMs
        while (!(this._renderer._pipeline && this._renderer._pipeline.backend)) {
            if (Date.now() >= deadline) return false
            await new Promise(resolve => setTimeout(resolve, 8))
        }
        return true
    }

    /**
     * Find the step index for a text effect in the DSL
     * @param {string} dsl - DSL source code
     * @returns {number} Step index (0-based)
     * @private
     * @deprecated Use _findAllTextStepIndices instead
     */
    _findTextStepIndex(dsl) {
        const indices = this._findAllTextStepIndices(dsl)
        return indices[0] || 0
    }

    /**
     * Find ALL step indices for text effects in the DSL
     * @param {string} dsl - DSL source code
     * @returns {number[]} Array of step indices (0-based)
     * @private
     */
    _findAllTextStepIndices(dsl) {
        const indices = []
        try {
            // Use the bundle's DSL parser to get effect info
            const effects = extractEffectsFromDsl(dsl)

            // Find ALL text effects
            for (const effect of effects) {
                if (effect.name === 'text' || effect.fullName === 'filter.text' || effect.effectKey === 'text') {
                    // Use effect.temp which matches the pipeline's texture binding
                    // (pass.stepIndex = step.temp), NOT effect.stepIndex (globalStepIndex)
                    const stepIndex = effect.temp !== undefined ? effect.temp : effect.stepIndex
                    indices.push(stepIndex)
                }
            }
        } catch (err) {
            console.warn('Failed to parse DSL for text step indices:', err)
        }

        return indices
    }

    /**
     * Find the step index for a media effect in the DSL
     * @param {string} dsl - DSL source code
     * @returns {number} Step index (0-based)
     * @private
     */
    _findMediaStepIndex(dsl) {
        try {
            // Use the bundle's DSL parser to get effect info
            const effects = extractEffectsFromDsl(dsl)

            // Find the media effect
            for (const effect of effects) {
                if (effect.name === 'media' || effect.fullName === 'synth.media' || effect.effectKey === 'media') {
                    // Use effect.temp which matches the pipeline's texture binding
                    const stepIndex = effect.temp !== undefined ? effect.temp : effect.stepIndex
                    return stepIndex
                }
            }
        } catch (err) {
            console.warn('Failed to parse DSL for media step index:', err)
        }

        return 0 // Default to step 0
    }

    /**
     * Load an image from URL and render to texture for media effects
     * @param {Object} params - Media parameters (url)
     * @param {number} stepIndex - Step index for texture ID
     * @private
     */
    async _loadAndRenderMediaTexture(params, stepIndex = 0) {
        if (!this._renderer._pipeline) return

        try {
            // Load the image
            const img = new Image()
            img.crossOrigin = 'anonymous'
            
            await new Promise((resolve, reject) => {
                img.onload = resolve
                img.onerror = () => reject(new Error(`Failed to load image: ${params.url}`))
                img.src = params.url
            })

            // Store the loaded image for resize
            this._lastMediaImage = img

            // Render to texture
            this._renderMediaTexture(img, stepIndex)
        } catch (err) {
            console.error('Failed to load media image:', err)
        }
    }

    /**
     * Render media image to texture
     * @param {HTMLImageElement} img - Loaded image
     * @param {number} stepIndex - Step index for texture ID
     * @private
     */
    _renderMediaTexture(img, stepIndex = 0) {
        if (!this._renderer._pipeline || !img) return

        // Create media canvas if needed
        if (!this._mediaCanvas) {
            this._mediaCanvas = document.createElement('canvas')
            this._mediaCanvas.style.display = 'none'
        }

        const canvas = this._mediaCanvas
        // Match the actual canvas dimensions
        canvas.width = this.width
        canvas.height = this.height

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Calculate aspect-ratio-preserving fit
        const imgAspect = img.width / img.height
        const canvasAspect = canvas.width / canvas.height

        let drawWidth, drawHeight, drawX, drawY

        if (imgAspect > canvasAspect) {
            // Image is wider - fit to width, center vertically
            drawWidth = canvas.width
            drawHeight = canvas.width / imgAspect
            drawX = 0
            drawY = (canvas.height - drawHeight) / 2
        } else {
            // Image is taller - fit to height, center horizontally
            drawHeight = canvas.height
            drawWidth = canvas.height * imgAspect
            drawX = (canvas.width - drawWidth) / 2
            drawY = 0
        }

        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)

        // Upload to texture with step-indexed ID
        const textureId = `imageTex_step_${stepIndex}`
        this._renderer.updateTextureFromSource(textureId, canvas, { flipY: true })
    }

    /**
     * Render text to texture for text effects
     * @param {Object} params - Text parameters
     * @param {number} stepIndex - Step index for texture ID
     * @private
     */
    _renderTextTexture(params, stepIndex = 0) {
        if (!this._renderer._pipeline) return

        // Create text canvas if needed
        if (!this._textCanvas) {
            this._textCanvas = document.createElement('canvas')
            this._textCanvas.style.display = 'none'
        }

        const canvas = this._textCanvas
        // Match the actual canvas dimensions (not just width)
        canvas.width = this.width
        canvas.height = this.height

        const ctx = canvas.getContext('2d')

        // Clear with background color
        const bgColor = hexToRgb(params.bgColor)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (params.bgOpacity > 0) {
            ctx.fillStyle = `rgba(${Math.round(bgColor[0] * 255)}, ${Math.round(bgColor[1] * 255)}, ${Math.round(bgColor[2] * 255)}, ${params.bgOpacity})`
            ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        // Calculate font size based on the smaller dimension for consistent sizing
        const minDimension = Math.min(canvas.width, canvas.height)
        const fontSize = Math.round(params.size * minDimension)

        // Set up text rendering - quote font name for canvas
        const fontFamily = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(params.font)
            ? params.font
            : `"${params.font}"`
        ctx.font = `${fontSize}px ${fontFamily}`
        ctx.textAlign = params.justify
        ctx.textBaseline = 'middle'

        const textColor = hexToRgb(params.color)
        ctx.fillStyle = `rgba(${Math.round(textColor[0] * 255)}, ${Math.round(textColor[1] * 255)}, ${Math.round(textColor[2] * 255)}, 1)`

        // Position and rotation
        const x = params.posX * canvas.width
        const y = params.posY * canvas.height
        const rotation = params.rotation * Math.PI / 180

        // Handle multi-line text
        const lines = params.text.split('\n')
        const lineHeight = fontSize * 1.2

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rotation)

        const totalHeight = (lines.length - 1) * lineHeight
        const startY = -totalHeight / 2

        for (let i = 0; i < lines.length; i++) {
            const lineY = startY + i * lineHeight
            ctx.fillText(lines[i], 0, lineY)
        }

        ctx.restore()

        // Upload to texture with step-indexed ID
        const textureId = `textTex_step_${stepIndex}`
        this._renderer.updateTextureFromSource(textureId, canvas, { flipY: true })
    }

    /**
     * Resize the canvas
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
        this.width = width
        this.height = height
        this.canvas.width = width
        this.canvas.height = height
        this._renderer.resize(width, height)

        // Re-render ALL text textures with new dimensions
        if (this._lastAllTextParams && this._lastAllTextParams.length > 0) {
            for (const { params, stepIndex } of this._lastAllTextParams) {
                this._renderTextTexture(params, stepIndex)
            }
        }
        
        // Re-render media texture with new dimensions if we have a loaded image
        if (this._lastMediaImage) {
            this._renderMediaTexture(this._lastMediaImage, this._lastMediaStepIndex || 0)
        }
    }

    /**
     * Dispose of renderer resources
     */
    dispose() {
        this.stop()
        if (this._renderer.dispose) {
            this._renderer.dispose()
        }
    }
}
