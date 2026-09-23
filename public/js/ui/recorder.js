/**
 * Recorder
 *
 * Captures the canvas to a WebM video file via `canvas.captureStream()` +
 * `MediaRecorder`. Prefers VP9 for real-time capture and downloads on stop.
 *
 * Single global recorder. Toggle via menu icon, palette action ("record"),
 * or via the public start()/stop() API.
 */

const STYLES_ID = 'recorder-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        #record-toggle-btn.recording,
        #menu #record-toggle-btn.recording {
            color: var(--hf-red);
            animation: rec-pulse 1.4s ease-in-out infinite;
        }
        @keyframes rec-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.45; }
        }
        .recording-indicator {
            position: fixed;
            top: 1em;
            left: 50%;
            transform: translateX(-50%);
            background: color-mix(in srgb, var(--hf-bg-surface) var(--hf-surface-opacity, 92%), transparent);
            backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            border: 1px solid color-mix(in srgb, var(--hf-red) 40%, var(--hf-border-subtle));
            color: var(--hf-text-bright);
            font-family: var(--hf-font-family-mono, monospace);
            font-size: var(--hf-size-sm, 0.75rem);
            padding: var(--hf-space-1, 0.25rem) var(--hf-space-3, 0.75rem);
            border-radius: var(--hf-radius-pill, 999px);
            z-index: var(--hf-z-tooltip, 4500);
            display: flex;
            align-items: center;
            gap: var(--hf-space-2, 0.5rem);
            box-shadow: var(--hf-shadow-lg);
            transition: border-color var(--hf-transition, 0.15s ease), background-color var(--hf-transition, 0.15s ease);
        }
        .recording-indicator.warning {
            border-color: color-mix(in srgb, var(--hf-yellow) 60%, transparent);
        }
        .recording-indicator-dot {
            width: 8px;
            height: 8px;
            background: var(--hf-red);
            border-radius: var(--hf-radius-full, 50%);
            animation: rec-pulse 1.4s ease-in-out infinite;
        }
        .recording-indicator.warning .recording-indicator-dot {
            background: var(--hf-yellow);
        }
    `
    document.head.appendChild(style)
}

/**
 * Recording safety thresholds to prevent unbounded in-memory accumulation.
 */
export const RECORDING_LIMITS = Object.freeze({
    CHUNK_INTERVAL_MS: 1000,
    WARNING_DURATION_MS: 10 * 60 * 1000,       // 10 minutes
    MAX_DURATION_MS: 15 * 60 * 1000,           // 15 minutes
    WARNING_RECORDED_BYTES: 750 * 1024 * 1024, // 750 MiB
    MAX_RECORDED_BYTES: 1024 * 1024 * 1024     // 1 GiB
})

/**
 * Quality presets — recording-side resolution and bitrate. The app/canvas
 * runs at full quality regardless; these only constrain what the encoder
 * sees via the intermediate downscale canvas.
 */
export const QUALITY_PRESETS = Object.freeze({
    high:     { maxHeight: 1080, fps: 60, videoBitsPerSecond: 16_000_000 },
    standard: { maxHeight: 720,  fps: 60, videoBitsPerSecond:  8_000_000 },
    low:      { maxHeight: 480,  fps: 30, videoBitsPerSecond:  3_000_000 }
})

class Recorder {
    constructor() {
        this._canvas = null
        this._stream = null
        this._mediaRecorder = null
        this._chunks = []
        this._recording = false
        this._startTime = 0
        this._indicator = null
        this._indicatorRaf = null
        // Quality defaults — "standard" 720p / 60fps / 8 Mbps. High-res
        // (1080p+) recording at 60fps frequently chokes the encoder on
        // generative shaders.
        this._fps = QUALITY_PRESETS.standard.fps
        this._videoBitsPerSecond = QUALITY_PRESETS.standard.videoBitsPerSecond
        this._maxHeight = QUALITY_PRESETS.standard.maxHeight
        this._qualityName = 'standard'
        this._mimeType = null
        this._onChange = () => {}
        // Safety limits & memory guard
        this._maxDurationMs = RECORDING_LIMITS.MAX_DURATION_MS
        this._warningDurationMs = RECORDING_LIMITS.WARNING_DURATION_MS
        this._maxRecordedBytes = RECORDING_LIMITS.MAX_RECORDED_BYTES
        this._warningRecordedBytes = RECORDING_LIMITS.WARNING_RECORDED_BYTES
        this._recordedBytes = 0
        this._warningActive = false
        this._stopReason = null
        // Intermediate downscale canvas + its draw loop
        this._captureCanvas = null
        this._captureCtx = null
        this._captureRaf = null
    }

    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} [opts.canvas]
     * @param {(state: {recording:boolean, durationMs:number, stoppedReason?:string, bytes?:number}) => void} [opts.onChange]
     * @param {number} [opts.fps]
     * @param {number} [opts.videoBitsPerSecond]
     * @param {number} [opts.maxHeight] - cap recorded height; width preserves aspect
     * @param {keyof typeof QUALITY_PRESETS} [opts.quality] - preset shorthand
     * @param {number} [opts.maxDurationMs] - maximum recording duration before safety auto-stop
     * @param {number} [opts.warningDurationMs] - duration threshold before warning indicator state
     * @param {number} [opts.maxRecordedBytes] - maximum byte size before safety auto-stop
     * @param {number} [opts.warningRecordedBytes] - byte size threshold before warning indicator state
     */
    init(opts = {}) {
        if (opts.canvas) this._canvas = opts.canvas
        if (opts.onChange) this._onChange = opts.onChange
        if (opts.quality && QUALITY_PRESETS[opts.quality]) {
            this.setQualityPreset(opts.quality)
        }
        if (Number.isFinite(opts.fps)) this._fps = opts.fps
        if (Number.isFinite(opts.videoBitsPerSecond)) this._videoBitsPerSecond = opts.videoBitsPerSecond
        if (Number.isFinite(opts.maxHeight)) this._maxHeight = opts.maxHeight
        if (Number.isFinite(opts.maxDurationMs) && opts.maxDurationMs > 0) {
            this._maxDurationMs = opts.maxDurationMs
        }
        if (Number.isFinite(opts.warningDurationMs) && opts.warningDurationMs > 0) {
            this._warningDurationMs = opts.warningDurationMs
        }
        if (Number.isFinite(opts.maxRecordedBytes) && opts.maxRecordedBytes > 0) {
            this._maxRecordedBytes = opts.maxRecordedBytes
        }
        if (Number.isFinite(opts.warningRecordedBytes) && opts.warningRecordedBytes > 0) {
            this._warningRecordedBytes = opts.warningRecordedBytes
        }
        this._mimeType = pickBestMimeType()
    }

    /** Update individual recording quality settings before the next start(). */
    setQuality({ fps, videoBitsPerSecond, maxHeight } = {}) {
        if (Number.isFinite(fps) && fps > 0) this._fps = fps
        if (Number.isFinite(videoBitsPerSecond) && videoBitsPerSecond > 0) {
            this._videoBitsPerSecond = videoBitsPerSecond
        }
        if (Number.isFinite(maxHeight) && maxHeight > 0) this._maxHeight = maxHeight
        this._qualityName = 'custom'
    }

    /**
     * Apply a named quality preset.
     * @param {'high'|'standard'|'low'} name
     */
    setQualityPreset(name) {
        const preset = QUALITY_PRESETS[name]
        if (!preset) return
        this._fps = preset.fps
        this._videoBitsPerSecond = preset.videoBitsPerSecond
        this._maxHeight = preset.maxHeight
        this._qualityName = name
    }

    /** Quality preset name currently active (or 'custom' after setQuality). */
    get qualityName() { return this._qualityName }
    /** Maximum recorded height in pixels. */
    get maxHeight() { return this._maxHeight }

    isRecording() { return this._recording }

    /** Currently-active recording mime type, e.g. 'video/webm;codecs=vp9'. */
    get mimeType() { return this._mimeType }

    /** Frames-per-second hint passed to canvas.captureStream(). */
    get fps() { return this._fps }

    /** Target video bitrate in bits/sec. */
    get videoBitsPerSecond() { return this._videoBitsPerSecond }

    /** Total bytes accumulated in the current or most recent recording session. */
    get recordedBytes() { return this._recordedBytes }
    /** Maximum allowed recording duration in ms. */
    get maxDurationMs() { return this._maxDurationMs }
    /** Warning threshold duration in ms. */
    get warningDurationMs() { return this._warningDurationMs }
    /** Maximum allowed recorded bytes. */
    get maxRecordedBytes() { return this._maxRecordedBytes }
    /** Warning threshold recorded bytes. */
    get warningRecordedBytes() { return this._warningRecordedBytes }
    /** Whether safety limits warning threshold is currently active. */
    get isWarning() { return this._warningActive }
    /** Reason for stopping: 'manual', 'duration_limit', or 'memory_limit'. */
    get stopReason() { return this._stopReason }

    /**
     * Inspect duration and byte limits. Triggers warning state or auto-stops.
     * @param {number} [elapsedMs]
     * @returns {'ok'|'warning'|'stopped'}
     */
    checkLimits(elapsedMs) {
        if (!this._recording) return 'ok'

        const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : (performance.now() - this._startTime)
        const bytesExceeded = this._recordedBytes >= this._maxRecordedBytes
        const durationExceeded = elapsed >= this._maxDurationMs

        if (bytesExceeded || durationExceeded) {
            const reason = bytesExceeded ? 'memory_limit' : 'duration_limit'
            this.stop(reason)
            return 'stopped'
        }

        const bytesWarning = this._recordedBytes >= this._warningRecordedBytes
        const durationWarning = elapsed >= this._warningDurationMs

        if (bytesWarning || durationWarning) {
            if (!this._warningActive) {
                this._warningActive = true
                if (this._indicator) {
                    this._indicator.classList.add('warning')
                }
            }
            return 'warning'
        }

        return 'ok'
    }

    start() {
        if (this._recording || !this._canvas) return false
        if (typeof window === 'undefined' || !('MediaRecorder' in window)) {
            console.warn('[Recorder] MediaRecorder unavailable')
            return false
        }

        // Pick the recording stream source. If the source canvas is taller
        // than maxHeight, drive an intermediate downscale canvas instead so
        // the encoder doesn't choke on full-resolution frames.
        const srcW = this._canvas.width
        const srcH = this._canvas.height
        const needsDownscale = srcH > this._maxHeight
        const recW = needsDownscale ? Math.max(2, Math.round((srcW * this._maxHeight) / srcH)) : srcW
        const recH = needsDownscale ? this._maxHeight : srcH

        let streamSource
        if (needsDownscale) {
            this._captureCanvas = document.createElement('canvas')
            this._captureCanvas.width = recW
            this._captureCanvas.height = recH
            this._captureCtx = this._captureCanvas.getContext('2d', { alpha: false, desynchronized: true })
            this._captureCtx.imageSmoothingEnabled = true
            this._captureCtx.imageSmoothingQuality = 'high'
            streamSource = this._captureCanvas
            this._startCaptureLoop()
        } else {
            streamSource = this._canvas
        }

        if (typeof streamSource.captureStream !== 'function') {
            console.warn('[Recorder] captureStream unavailable on stream source')
            this._stopCaptureLoop() // may have started above; don't leak the rAF/canvas
            return false
        }

        this._stream = streamSource.captureStream(this._fps)
        // Build options. Some browsers throw on unknown bitrate keys, so we
        // attempt the high-quality config first and fall back if it fails.
        const buildOptions = (withBitrate) => {
            const o = {}
            if (this._mimeType) o.mimeType = this._mimeType
            if (withBitrate && this._videoBitsPerSecond) o.videoBitsPerSecond = this._videoBitsPerSecond
            return o
        }
        try {
            this._mediaRecorder = new MediaRecorder(this._stream, buildOptions(true))
        } catch (err) {
            console.warn('[Recorder] High-quality config rejected, falling back:', err)
            try {
                this._mediaRecorder = new MediaRecorder(this._stream, buildOptions(false))
            } catch (err2) {
                console.error('[Recorder] MediaRecorder construction failed:', err2)
                this._stopCaptureLoop()
                return false
            }
        }
        this._chunks = []
        this._recordedBytes = 0
        this._warningActive = false
        this._stopReason = null

        this._mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this._chunks.push(e.data)
                this._recordedBytes += e.data.size
                this.checkLimits()
            }
        }
        this._mediaRecorder.onstop = () => this._onStop()
        this._mediaRecorder.start(RECORDING_LIMITS.CHUNK_INTERVAL_MS)
        this._recording = true
        this._startTime = performance.now()
        this._showIndicator()
        this._onChange({ recording: true, durationMs: 0, bytes: 0 })
        console.log(`[Recorder] start mime=${this._mimeType} fps=${this._fps} bps=${this._videoBitsPerSecond} src=${srcW}x${srcH} rec=${recW}x${recH} preset=${this._qualityName}`)
        return true
    }

    /**
     * Begin the rAF loop that copies the source canvas into the intermediate
     * downscale canvas. Stops via _stopCaptureLoop() on stop().
     * @private
     */
    _startCaptureLoop() {
        const tick = () => {
            this._captureRaf = requestAnimationFrame(tick)
            if (!this._captureCtx || !this._canvas) return
            try {
                this._captureCtx.drawImage(
                    this._canvas,
                    0, 0, this._canvas.width, this._canvas.height,
                    0, 0, this._captureCanvas.width, this._captureCanvas.height
                )
            } catch { /* canvas not ready / context lost — skip frame */ }
        }
        tick()
    }

    /** @private */
    _stopCaptureLoop() {
        if (this._captureRaf) {
            cancelAnimationFrame(this._captureRaf)
            this._captureRaf = null
        }
        this._captureCanvas = null
        this._captureCtx = null
    }

    stop(reason = 'manual') {
        if (!this._recording) return
        this._recording = false
        this._stopReason = reason
        try { this._mediaRecorder?.stop() } catch (err) {
            console.warn('[Recorder] stop() threw:', err)
        }
        this._stream?.getTracks().forEach(t => t.stop())
        this._stream = null
        this._stopCaptureLoop()
        this._hideIndicator()
        const durationMs = performance.now() - this._startTime
        this._onChange({
            recording: false,
            durationMs,
            stoppedReason: this._stopReason,
            bytes: this._recordedBytes
        })
    }

    toggle() {
        return this._recording ? this.stop() : this.start()
    }

    _onStop() {
        const blob = new Blob(this._chunks, { type: this._mimeType || 'video/webm' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ext = (this._mimeType || '').includes('mp4') ? 'mp4' : 'webm'
        a.download = `polymorphic-${timestamp()}.${ext}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        // Free the blob URL after a tick
        setTimeout(() => URL.revokeObjectURL(url), 200)
        this._chunks = []
    }

    _showIndicator() {
        if (this._indicator || typeof document === 'undefined') return
        this._indicator = document.createElement('div')
        this._indicator.className = 'recording-indicator'
        if (this._warningActive) this._indicator.classList.add('warning')
        this._indicator.innerHTML = `<span class="recording-indicator-dot"></span><span class="recording-indicator-text">REC 00:00</span>`
        document.body.appendChild(this._indicator)
        const txt = this._indicator.querySelector('.recording-indicator-text')
        const tick = () => {
            if (!this._recording) return
            const ms = performance.now() - this._startTime
            this.checkLimits(ms)
            if (!this._recording) return
            const s = Math.floor(ms / 1000)
            const mm = String(Math.floor(s / 60)).padStart(2, '0')
            const ss = String(s % 60).padStart(2, '0')
            if (txt) {
                let label = `REC ${mm}:${ss}`
                if (this._warningActive) {
                    const limitMin = Math.round(this._maxDurationMs / 60000)
                    label += ` (limit ${limitMin}m)`
                }
                txt.textContent = label
            }
            this._indicatorRaf = requestAnimationFrame(tick)
        }
        tick()
    }

    _hideIndicator() {
        if (this._indicatorRaf) {
            cancelAnimationFrame(this._indicatorRaf)
            this._indicatorRaf = null
        }
        this._indicator?.remove()
        this._indicator = null
    }
}

function pickBestMimeType() {
    if (typeof window === 'undefined' || !('MediaRecorder' in window) || !MediaRecorder.isTypeSupported) return null
    // Prefer VP9 for real-time capture. Advertising AV1 support does not
    // guarantee that its encoder can keep up with fast generative content.
    // Keep AV1 as a fallback when VP9 is unavailable.
    // Avoid Opus audio in the type — we don't capture audio, so keeping the
    // type pure-video lets the browser pick a leaner muxer.
    const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=av01',
        'video/webm;codecs=av1',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=h264',
        'video/mp4'
    ]
    for (const t of candidates) {
        if (MediaRecorder.isTypeSupported(t)) return t
    }
    return null
}

function timestamp() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export { Recorder }
export const recorder = new Recorder()
