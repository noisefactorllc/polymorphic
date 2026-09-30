/**
 * Polymorphic Renderer - Minimal wrapper around Noisemaker CanvasRenderer
 *
 * Provides a simplified interface for the Polymorphic app to render DSL programs.
 * Includes text texture rendering for text effects.
 */

import { CanvasRenderer, extractEffectNamesFromDsl, extractEffectsFromDsl } from './bundle.js'
import { textEffectsFromParsed } from './textParams.js'

// Shader assets served from the shaders CDN.
const SHADER_BASE_PATH = 'https://shaders.noisedeck.app/1'

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
        this.onContextLost = options.onContextLost || null
        this.onContextRestored = options.onContextRestored || null
        this.onDeviceLost = options.onDeviceLost || null

        // WebGPU device-loss state (`device.lost` is terminal for the device,
        // unlike WebGL's context pair). `_gpuDeviceLost` tells recovery to drop
        // the dead pipeline so the engine builds a fresh one on a new device.
        this._gpuDeviceLost = false
        this._watchedGpuDevice = null
        this._disposed = false

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

        this.images = []
        this.resolveImage = null
        this._imageTools = null
        this._imageDimensions = []
        this._currentDsl = ''
        this._initialized = false
        this._contextLost = false

        // Text texture canvases, one per text effect, keyed by step index
        this._textCanvases = new Map()
    }

    /**
     * @returns {boolean} Whether the WebGL context is currently lost
     */
    get contextLost() {
        return this._contextLost
    }

    /**
     * @returns {string} Current backend ('webgl2' or 'webgpu')
     */
    get backend() {
        const pipelineBackend = this._renderer?.pipeline?.backend?.getName?.()
        if (pipelineBackend) {
            return pipelineBackend.toLowerCase() === 'webgpu' ? 'webgpu' : 'webgl2'
        }
        return (this.preferWebGPU && this._renderer?.backend === 'wgsl') ? 'webgpu' : 'webgl2'
    }

    /**
     * @returns {CanvasRenderer} Underlying CanvasRenderer (for ProgramState integration)
     */
    get mediaStepIndex() { return this._liveMediaStepIndex ?? null }

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

        this._setupContextLossHandlers()

        if (this.preferWebGPU) {
            const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu)
            let supported = false
            if (hasWebGPU) {
                try {
                    const adapter = await navigator.gpu.requestAdapter()
                    supported = Boolean(adapter)
                } catch {
                    supported = false
                }
            }
            if (!supported) {
                this.preferWebGPU = false
                if (this._renderer) {
                    this._renderer._preferWebGPU = false
                }
            }
        }

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

    getImageAssets(dsl = this._currentDsl) {
        if (!this._imageTools && /\burl\b/.test(dsl)) throw new Error('Images are still loading; try again shortly')
        return this._imageTools?.getReferencedImages(dsl, this.images) || []
    }

    /** Keep decoded image dimensions when ProgramState applies control values. */
    applyImageDimensions(programState) {
        if (!this._imageDimensions.length) return
        const effects = programState.getStructure()
        const overrides = {}
        for (const { step, width, height } of this._imageDimensions) {
            const effect = effects.find(effect => effect.effectKey === 'synth.media' && (effect.temp ?? effect.stepIndex) === step)
            if (!effect) continue
            const key = `step_${effect.stepIndex}`
            const current = programState.getValue(key, 'imageSize')
            if (current?.[0] !== width || current?.[1] !== height) programState.setValue(key, 'imageSize', [width, height])
            overrides[`step_${step}`] = { imageSize: [width, height] }
        }
        this._renderer.applyStepParameterValues(overrides)
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
            // them for every engine/parser call. Media url extraction below
            // still reads from the original `dsl`, since that is the only copy
            // that still carries the url.
            if (/\burl\b/.test(dsl)) this._imageTools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
            const engineDsl = this._imageTools ? this._imageTools.stripMediaUrls(dsl) : dsl

            // Extract effect names and load them if needed
            const effectData = extractEffectNamesFromDsl(engineDsl, this._renderer.manifest || {})

            // Get effect IDs
            const effectIds = effectData.map(e => e.effectId)

            if (effectIds.length > 0) {
                await this._renderer.loadEffects(effectIds)
            }

            // Compile the DSL
            await this._renderer.compile(engineDsl)
            this._armDeviceLostWatch()
            this._imageDimensions = []
            this._currentDsl = dsl
            this._liveMediaStepIndex = this._findMediaStepIndex(engineDsl)

            // Check for text effects and render text textures (supports multiple).
            // Parameters and step indices come from the same parse of the DSL the
            // engine compiled, so they cannot drift out of step with each other.
            this._lastAllTextParams = this._extractTextEffects(engineDsl)

            if (this._lastAllTextParams.length > 0) {
                // Wait until the pipeline backend can accept the text texture
                await this._waitForPipeline()

                // Render each text effect
                for (const { params, stepIndex } of this._lastAllTextParams) {
                    this._renderTextTexture(params, stepIndex)
                }
            }

            if (this._imageTools) this._imageDimensions = await this._imageTools.bindMediaImages(this._renderer, dsl, this.images, { extractEffectsFromDsl, resolveImage: this.resolveImage })

            return { success: true }
        } catch (err) {
            console.error('Compilation error:', err)
            
            let errorMessage = 'Unknown compilation error'
            if (typeof err === 'string') {
                errorMessage = err
            } else if (err && typeof err === 'object') {
                errorMessage = err.detail || err.message || (err instanceof Error ? err.toString() : null) || err.error || JSON.stringify(err)
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
     * Collect the text effects in a DSL program along with their parameters.
     *
     * Uses the bundle's DSL parser rather than matching on the DSL source, so
     * the text arrives exactly as authored — including multi-line triple-quoted
     * strings, and quotes or parens inside the text itself.
     *
     * @param {string} dsl - DSL source code
     * @returns {Array<{params: object, stepIndex: number}>} One entry per text effect
     * @private
     */
    _extractTextEffects(dsl) {
        try {
            return textEffectsFromParsed(extractEffectsFromDsl(dsl))
        } catch (err) {
            console.warn('Failed to parse DSL for text effects:', err)
            return []
        }
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
                if (effect.name === 'media' || effect.fullName === 'synth.media' || effect.effectKey === 'media' || effect.effectKey === 'synth.media' || effect.effectKey === 'synth/media') {
                    // Use effect.temp which matches the pipeline's texture binding
                    const stepIndex = effect.temp !== undefined ? effect.temp : effect.stepIndex
                    return stepIndex
                }
            }
        } catch (err) {
            console.warn('Failed to parse DSL for media step index:', err)
        }

        return null
    }

    /**
     * Render text to texture for text effects
     * @param {Object} params - Text parameters
     * @param {number} stepIndex - Step index for texture ID
     * @private
     */
    _renderTextTexture(params, stepIndex = 0) {
        if (!this._renderer._pipeline) return

        // One canvas per text effect, so a program with several text overlays
        // cannot have one step's rasterization clobber another's.
        let canvas = this._textCanvases.get(stepIndex)
        if (!canvas) {
            canvas = document.createElement('canvas')
            canvas.style.display = 'none'
            this._textCanvases.set(stepIndex, canvas)
        }

        // Match the actual canvas dimensions (not just width)
        canvas.width = this.width
        canvas.height = this.height

        const ctx = canvas.getContext('2d')

        // Clear with background color
        const bgColor = params.bgColor
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

        const textColor = params.color
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
     * Watch the canvas for WebGL context loss and restoration.
     *
     * GPU resets (driver update, tab backgrounding under memory pressure,
     * GPU process crashes) hand back a dead context via `webglcontextlost`
     * and a fresh one via `webglcontextrestored`. Calling `preventDefault()`
     * on the lost event tells the browser we will re-create our GPU resources
     * on restore instead of leaving the canvas permanently blank.
     *
     * @private
     */
    _setupContextLossHandlers() {
        if (typeof this.canvas?.addEventListener !== 'function') return
        this._contextLostHandler = (e) => {
            // Without preventDefault the browser never fires webglcontextrestored.
            e.preventDefault?.()
            this._contextLost = true
            this.stop()
            try {
                this.onContextLost?.(e)
            } catch (err) {
                console.warn('onContextLost handler failed:', err)
            }
        }
        this._contextRestoredHandler = (e) => {
            this._contextLost = false
            try {
                this.onContextRestored?.(e, this)
            } catch (err) {
                console.warn('onContextRestored handler failed:', err)
            }
        }
        this.canvas.addEventListener('webglcontextlost', this._contextLostHandler)
        this.canvas.addEventListener('webglcontextrestored', this._contextRestoredHandler)
    }

    /**
     * Observe the active WebGPU device for loss.
     *
     * The engine's WebGPU backend requests its own `GPUDevice` when it builds
     * the pipeline (`_pipeline.backend.device`). Unlike WebGL's
     * `webglcontextlost`/`webglcontextrestored` canvas events, WebGPU device
     * loss is terminal for that device — no restore event will fire — so we
     * watch `device.lost`, stop the loop, mark the loss and ask the host to
     * drive recovery (which drops the dead pipeline and recompiles on a fresh
     * device). Re-armed after every compile: a recovered device is a new
     * object, and plain recompiles reuse the existing pipeline/device, so the
     * identity check keeps exactly one `lost` handler per device.
     *
     * @private
     */
    _armDeviceLostWatch() {
        const device = this._renderer?._pipeline?.backend?.device
        if (!device || typeof device.lost?.then !== 'function') return
        if (this._watchedGpuDevice === device) return
        this._watchedGpuDevice = device
        device.lost.then((info) => {
            // 'destroyed' is an intentional shutdown (e.g. our own dispose),
            // not a GPU reset — nothing to recover.
            if (this._disposed || info?.reason === 'destroyed') return
            this._gpuDeviceLost = true
            this._contextLost = true
            this.stop()
            try {
                this.onDeviceLost?.(info)
            } catch (err) {
                console.warn('onDeviceLost handler failed:', err)
            }
        })
    }

    /**
     * Recompile the current program into a restored context and restart the
     * render loop. All GPU resources (shaders, textures, text/media uploads)
     * are lost with the old context; `compile()` recreates every one of them,
     * so recovery is a plain recompile of the caller's DSL.
     *
     * For a lost WebGPU device the engine's `compile()` would reuse the
     * existing pipeline — which is bound to the dead device — so the dead
     * pipeline is dropped first, forcing the engine to create a fresh runtime
     * (new adapter device, reconfigured canvas context) on the next compile.
     * @param {string} dsl - DSL source to restore
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async recoverFromContextLoss(dsl) {
        if (this._gpuDeviceLost) {
            this._gpuDeviceLost = false
            this._watchedGpuDevice = null
            const deadPipeline = this._renderer?._pipeline
            this._renderer._pipeline = null
            try {
                deadPipeline?.dispose?.()
            } catch (err) {
                console.warn('Failed to dispose lost WebGPU pipeline:', err)
            }
        }
        const result = await this.compile(dsl)
        if (result.success) {
            this._contextLost = false
            if (!this.isRunning) this.start()
        }
        return result
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
        
        if (this._imageTools && this._currentDsl) this._imageTools.bindMediaImages(this._renderer, this._currentDsl, this.images, { extractEffectsFromDsl, resolveImage: this.resolveImage }).catch(error => console.error('Image resize failed:', error))
    }

    /**
     * Dispose of renderer resources
     */
    dispose() {
        this.stop()
        this._disposed = true
        this._textCanvases.clear()
        if (this._contextLostHandler) {
            this.canvas?.removeEventListener('webglcontextlost', this._contextLostHandler)
            this.canvas?.removeEventListener('webglcontextrestored', this._contextRestoredHandler)
            this._contextLostHandler = null
            this._contextRestoredHandler = null
        }
        if (this._renderer.dispose) {
            this._renderer.dispose()
        }
    }
}
