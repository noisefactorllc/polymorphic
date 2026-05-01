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
        // 60 fps captures at the canvas's natural rate; the actual emitted
        // rate is gated by canvas updates regardless of this hint.
        this._fps = 60
        // Bitrate target that keeps fast-moving generative shaders looking
        // sharp even at 1080p. WebM/VP9 will use this as a ceiling.
        this._videoBitsPerSecond = 16_000_000  // 16 Mbps
        this._mimeType = null
        this._onChange = () => {}
    }

    /**
     * @param {object} opts
     * @param {HTMLCanvasElement} opts.canvas
     * @param {(state: {recording:boolean, durationMs:number}) => void} [opts.onChange]
     * @param {number} [opts.fps] - default 60
     * @param {number} [opts.videoBitsPerSecond] - default 16_000_000
     */
    init(opts) {
        this._canvas = opts.canvas
        this._onChange = opts.onChange || (() => {})
        if (opts.fps) this._fps = opts.fps
        if (opts.videoBitsPerSecond) this._videoBitsPerSecond = opts.videoBitsPerSecond
        this._mimeType = pickBestMimeType()
    }

    /** Update recording quality settings before the next start(). */
    setQuality({ fps, videoBitsPerSecond } = {}) {
        if (Number.isFinite(fps) && fps > 0) this._fps = fps
        if (Number.isFinite(videoBitsPerSecond) && videoBitsPerSecond > 0) {
            this._videoBitsPerSecond = videoBitsPerSecond
        }
    }

    isRecording() { return this._recording }

    /** Currently-active recording mime type, e.g. 'video/webm;codecs=vp9'. */
    get mimeType() { return this._mimeType }

    /** Frames-per-second hint passed to canvas.captureStream(). */
    get fps() { return this._fps }

    /** Target video bitrate in bits/sec. */
    get videoBitsPerSecond() { return this._videoBitsPerSecond }

    start() {
        if (this._recording || !this._canvas) return false
        if (!('MediaRecorder' in window) || typeof this._canvas.captureStream !== 'function') {
            console.warn('[Recorder] MediaRecorder or canvas.captureStream unavailable')
            return false
        }
        this._stream = this._canvas.captureStream(this._fps)
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
                return false
            }
        }
        this._chunks = []
        this._mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data)
        }
        this._mediaRecorder.onstop = () => this._onStop()
        // Emit one big blob at the end — simpler memory pattern, lets the
        // browser pick optimal chunking, and produces smaller files than
        // 1-second chunked output for the same quality.
        this._mediaRecorder.start()
        this._recording = true
        this._startTime = performance.now()
        this._showIndicator()
        this._onChange({ recording: true, durationMs: 0 })
        console.log(`[Recorder] start mime=${this._mimeType} fps=${this._fps} bps=${this._videoBitsPerSecond}`)
        return true
    }

    stop() {
        if (!this._recording) return
        this._recording = false
        try { this._mediaRecorder?.stop() } catch (err) {
            console.warn('[Recorder] stop() threw:', err)
        }
        this._stream?.getTracks().forEach(t => t.stop())
        this._stream = null
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
