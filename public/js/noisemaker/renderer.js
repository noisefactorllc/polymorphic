/**
 * Polymorphic Renderer - Minimal wrapper around Noisemaker CanvasRenderer
 *
 * Provides a simplified interface for the Polymorphic app to render DSL programs.
 * Includes text texture rendering for text effects.
 */

import { CanvasRenderer, extractEffectNamesFromDsl, extractEffectsFromDsl } from './bundle.js'

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
 * Extract text effect parameters from DSL
 * @param {string} dsl - DSL source code
 * @returns {Object|null} Text parameters or null if no text effect
 */
function extractTextParams(dsl) {
    // Match .text(...) calls
    const textCallRegex = /\.text\s*\(([^)]*)\)/i
    const match = dsl.match(textCallRegex)
    if (!match) return null

    const params = { ...TEXT_DEFAULTS }
    const paramsStr = match[1]

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

    const color = extractParam('color', /color\s*:\s*#([a-f0-9]{6})/i)
    if (color) params.color = `#${color}`

    const bgColor = extractParam('bgColor', /bgColor\s*:\s*#([a-f0-9]{6})/i)
    if (bgColor) params.bgColor = `#${bgColor}`

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
            basePath: '/js/noisemaker/vendor',
            preferWebGPU: this.preferWebGPU,
            useBundles: true,
            bundlePath: '/js/noisemaker/vendor/effects',
            onError: options.onError
        })

        this._initialized = false
        this._currentDsl = ''
        
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
     * @returns {boolean} Whether the render loop is running
     */
    get isRunning() {
        return this._renderer.isRunning
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
            // Extract effect names and load them if needed
            const effectData = extractEffectNamesFromDsl(dsl, this._renderer.manifest || {})
            
            // Get effect IDs
            const effectIds = effectData.map(e => e.effectId)
            
            if (effectIds.length > 0) {
                await this._renderer.loadEffects(effectIds)
            }

            // Compile the DSL
            await this._renderer.compile(dsl)
            this._currentDsl = dsl

            // Check for text effects and render text texture
            const textParams = extractTextParams(dsl)
            if (textParams) {
                // Find the step index for the text effect
                const textStepIndex = this._findTextStepIndex(dsl)
                // Wait a short moment for pipeline to be ready
                await new Promise(resolve => setTimeout(resolve, 100))
                this._renderTextTexture(textParams, textStepIndex)
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
     * Find the step index for a text effect in the DSL
     * @param {string} dsl - DSL source code
     * @returns {number} Step index (0-based)
     * @private
     */
    _findTextStepIndex(dsl) {
        try {
            // Use the bundle's DSL parser to get effect info
            const effects = extractEffectsFromDsl(dsl)
            
            // Find the text effect
            for (const effect of effects) {
                if (effect.name === 'text' || effect.fullName === 'synth.text' || effect.effectKey === 'text') {
                    console.log('Found text effect at step', effect.stepIndex)
                    return effect.stepIndex
                }
            }
        } catch (err) {
            console.warn('Failed to parse DSL for text step index:', err)
        }
        
        return 0 // Default to step 0
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
        const resolution = this.width
        canvas.width = resolution
        canvas.height = resolution

        const ctx = canvas.getContext('2d')

        // Clear with background color
        const bgColor = hexToRgb(params.bgColor)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (params.bgOpacity > 0) {
            ctx.fillStyle = `rgba(${Math.round(bgColor[0] * 255)}, ${Math.round(bgColor[1] * 255)}, ${Math.round(bgColor[2] * 255)}, ${params.bgOpacity})`
            ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        // Calculate font size
        const fontSize = Math.round(params.size * canvas.height)

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
        console.log('Text texture rendered:', params.text, params.font, 'to', textureId)
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
