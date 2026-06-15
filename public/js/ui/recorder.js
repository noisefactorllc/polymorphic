/**
 * Recorder
 *
 * Captures the canvas to a WebM video file via `canvas.captureStream()` +
 * `MediaRecorder`. Records at the highest supported codec and downloads on stop.
 *
 * Single global recorder. Toggle via menu icon, palette action ("record"),
 * or via the public start()/stop() API.
 */

const STYLES_ID = 'recorder-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        #record-toggle-btn.recording {
            color: #ff6b6b !important;
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
            background: rgba(15, 17, 22, 0.92);
            border: 1px solid rgba(255, 107, 107, 0.4);
            color: #fff;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.75rem;
            padding: 0.4rem 0.85rem;
            border-radius: 999px;
            z-index: 4500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            box-shadow: 0 6px 18px rgba(0,0,0,0.4);
        }
        .recording-indicator-dot {
            width: 8px;
            height: 8px;
            background: #ff4d4d;
            border-radius: 50%;
            animation: rec-pulse 1.4s ease-in-out infinite;
        }
    `
    document.head.appendChild(style)
}

/**
 * Quality presets — recording-side resolution and bitrate. The app/canvas
 * runs at full quality regardless; these only constrain what the encoder
 * sees via the intermediate downscale canvas.
 */
const QUALITY_PRESETS = {
    high:     { maxHeight: 1080, fps: 60, videoBitsPerSecond: 16_000_000 },
    standard: { maxHeight: 720,  fps: 60, videoBitsPerSecond:  8_000_000 },
    low:      { maxHeight: 480,  fps: 30, videoBitsPerSecond:  3_000_000 }
}

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
        // Intermediate downscale canvas + its draw loop
        this._captureCanvas = null
        this._captureCtx = null
        this._captureRaf = null
    }

    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} opts.canvas
     * @param {(state: {recording:boolean, durationMs:number}) => void} [opts.onChange]
     * @param {number} [opts.fps]
     * @param {number} [opts.videoBitsPerSecond]
     * @param {number} [opts.maxHeight] - cap recorded height; width preserves aspect
     * @param {keyof typeof QUALITY_PRESETS} [opts.quality] - preset shorthand
     */
    init(opts) {
        this._canvas = opts.canvas
        this._onChange = opts.onChange || (() => {})
        if (opts.quality && QUALITY_PRESETS[opts.quality]) {
            this.setQualityPreset(opts.quality)
        }
        if (Number.isFinite(opts.fps)) this._fps = opts.fps
        if (Number.isFinite(opts.videoBitsPerSecond)) this._videoBitsPerSecond = opts.videoBitsPerSecond
        if (Number.isFinite(opts.maxHeight)) this._maxHeight = opts.maxHeight
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

    start() {
        if (this._recording || !this._canvas) return false
        if (!('MediaRecorder' in window)) {
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
        this._mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data)
        }
        this._mediaRecorder.onstop = () => this._onStop()
        this._mediaRecorder.start()
        this._recording = true
        this._startTime = performance.now()
        this._showIndicator()
        this._onChange({ recording: true, durationMs: 0 })
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

    stop() {
        if (!this._recording) return
        this._recording = false
        try { this._mediaRecorder?.stop() } catch (err) {
            console.warn('[Recorder] stop() threw:', err)
        }
        this._stream?.getTracks().forEach(t => t.stop())
        this._stream = null
        this._stopCaptureLoop()
        this._hideIndicator()
        this._onChange({ recording: false, durationMs: performance.now() - this._startTime })
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
        if (this._indicator) return
        this._indicator = document.createElement('div')
        this._indicator.className = 'recording-indicator'
        this._indicator.innerHTML = `<span class="recording-indicator-dot"></span><span class="recording-indicator-text">REC 00:00</span>`
        document.body.appendChild(this._indicator)
        const txt = this._indicator.querySelector('.recording-indicator-text')
        const tick = () => {
            this._indicatorRaf = requestAnimationFrame(tick)
            const ms = performance.now() - this._startTime
            const s = Math.floor(ms / 1000)
            const mm = String(Math.floor(s / 60)).padStart(2, '0')
            const ss = String(s % 60).padStart(2, '0')
            if (txt) txt.textContent = `REC ${mm}:${ss}`
        }
        tick()
    }

    _hideIndicator() {
        if (this._indicatorRaf) cancelAnimationFrame(this._indicatorRaf)
        this._indicator?.remove()
        this._indicator = null
    }
}

function pickBestMimeType() {
    if (!('MediaRecorder' in window) || !MediaRecorder.isTypeSupported) return null
    // Codec preference, best-quality first. AV1 wins where supported (Chrome
    // ≥ 113 with hardware support), otherwise VP9 is the modern default.
    // Avoid Opus audio in the type — we don't capture audio, so keeping the
    // type pure-video lets the browser pick a leaner muxer.
    const candidates = [
        'video/webm;codecs=av01',
        'video/webm;codecs=av1',
        'video/webm;codecs=vp9',
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

export const recorder = new Recorder()
