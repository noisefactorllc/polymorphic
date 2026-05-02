/**
 * Live Inputs Panel
 *
 * Side panel that exposes audio (microphone FFT) and MIDI inputs to the user
 * with live meters, connection toggles, and one-click DSL snippet insertion.
 *
 *  audio:  low / mid / high / vol meters from AudioInputManager
 *  midi:   incoming CC list from MidiInputManager + connect button
 *  camera: opens the system getUserMedia picker and inserts a media() snippet
 *          (the camera source is wired into the renderer's media texture)
 *
 * The panel is collapsed by default; toggled via menu icon "tune" and
 * Ctrl/Cmd+I.
 */

let _bundlePromise = null
function loadBundle() {
    if (!_bundlePromise) _bundlePromise = import('../noisemaker/bundle.js')
    return _bundlePromise
}

/**
 * Pure helper: walk a noisemaker MidiState and return the active
 * (channel, controller, value) tuples. Defensive about both the
 * private (`_channels`/`_cc`) and public (`channels`/`cc`) shapes,
 * and treats 0/undefined/null as "no signal" so we only surface
 * controllers the user has actually touched.
 */
export function recentCcsFromMidiState(midiState) {
    if (!midiState || typeof midiState !== 'object') return []
    const out = []
    const channels = midiState._channels || midiState.channels || {}
    for (const [chKey, ch] of Object.entries(channels)) {
        const cc = ch?._cc || ch?.cc
        if (!cc) continue
        for (const [ccKey, value] of Object.entries(cc)) {
            const ccNum = Number(ccKey)
            if (!Number.isInteger(ccNum)) continue
            if (value !== undefined && value !== null && value !== 0) {
                out.push({ ch: chKey, cc: ccNum, value })
            }
        }
    }
    return out
}

/**
 * Local audio input manager that mirrors what the bundled AudioInputManager
 * does (FFT analyser → renderer.audioState bands), but adds explicit
 * deviceId selection so users can choose between built-in mic, external
 * interface, BlackHole loopback, etc. The bundled manager always picks
 * the system default which silently routes the wrong source on multi-mic
 * setups.
 */
class LocalAudioInput {
    constructor(renderer) {
        this._renderer = renderer
        this._audioState = null
        this._audioContext = null
        this._analyser = null
        this._source = null
        this._stream = null
        this._fftData = null
        this._timeDomainData = null
        this._animationId = null
        this._enabled = false
        this._deviceId = ''
        this._deviceLabel = ''
        this._onStatusChange = null
    }

    static isSupported() {
        return !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof AudioContext !== 'undefined')
    }

    onStatusChange(cb) { this._onStatusChange = cb }

    get enabled() { return this._enabled }
    get currentDeviceId() { return this._deviceId }
    get currentDeviceLabel() { return this._deviceLabel }

    /**
     * Enable audio capture from the given deviceId (or default if empty).
     * If already enabled with a different deviceId, stops the existing
     * stream and re-acquires.
     */
    async enable(deviceId = '') {
        if (this._enabled && deviceId === this._deviceId) return true
        if (this._enabled) await this.disable()
        if (!LocalAudioInput.isSupported()) {
            this._notify('Audio input not supported')
            return false
        }
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        }
        if (deviceId) constraints.audio.deviceId = { exact: deviceId }
        try {
            this._stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (err) {
            console.error('[LocalAudioInput] getUserMedia failed:', err)
            this._notify(`Audio access denied: ${err.message || err.name}`)
            return false
        }
        // Capture the actually-used deviceId/label from the granted track
        const track = this._stream.getAudioTracks()[0]
        const settings = track?.getSettings?.() || {}
        this._deviceId = settings.deviceId || deviceId || ''
        this._deviceLabel = track?.label || 'default'

        this._audioContext = new AudioContext()
        this._analyser = this._audioContext.createAnalyser()
        this._analyser.fftSize = 256
        this._analyser.smoothingTimeConstant = 0.8
        this._source = this._audioContext.createMediaStreamSource(this._stream)
        this._source.connect(this._analyser)
        this._fftData = new Uint8Array(this._analyser.frequencyBinCount)
        this._timeDomainData = new Uint8Array(this._analyser.fftSize)
        this._audioState = this._renderer.setAudioState()
        this._enabled = true
        this._update()
        this._notify(`Audio enabled: ${this._deviceLabel}`)
        return true
    }

    async disable() {
        if (!this._enabled) return
        if (this._animationId) {
            cancelAnimationFrame(this._animationId)
            this._animationId = null
        }
        try { this._source?.disconnect() } catch { /* ignore */ }
        this._source = null
        if (this._stream) {
            for (const t of this._stream.getTracks()) t.stop()
            this._stream = null
        }
        if (this._audioContext) {
            try { await this._audioContext.close() } catch { /* ignore */ }
            this._audioContext = null
        }
        this._analyser = null
        this._fftData = null
        this._timeDomainData = null
        this._enabled = false
        if (this._audioState) {
            this._audioState.low = 0
            this._audioState.mid = 0
            this._audioState.high = 0
            this._audioState.vol = 0
            this._audioState.spectrum?.fill?.(0)
            this._audioState.waveform?.fill?.(0.5)
        }
        this._notify('Audio disabled')
    }

    /** Switch to a new device while running. */
    async switchDevice(deviceId) {
        if (!this._enabled) {
            this._deviceId = deviceId
            return
        }
        await this.enable(deviceId)
    }

    _update() {
        if (!this._enabled) return
        this._analyser.getByteFrequencyData(this._fftData)
        this._audioState.setSpectrum?.(this._fftData)
        this._analyser.getByteTimeDomainData(this._timeDomainData)
        this._audioState.setWaveform?.(this._timeDomainData)
        const f = this._fftData
        const low = (f[0] + f[1] + f[2] + f[3]) / 4 / 255
        const mid = (f[4] + f[6] + f[8] + f[10]) / 4 / 255
        const high = (f[16] + f[20] + f[24] + f[28]) / 4 / 255
        const vol = (low + mid + high) / 3
        this._audioState.low = low
        this._audioState.mid = mid
        this._audioState.high = high
        this._audioState.vol = vol
        this._animationId = requestAnimationFrame(() => this._update())
    }

    _notify(msg) {
        if (typeof this._onStatusChange === 'function') this._onStatusChange(msg)
    }
}

const STYLES_ID = 'live-inputs-panel-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .live-inputs-panel {
            position: fixed;
            top: 1rem;
            right: 1rem;
            bottom: 1rem;
            width: 280px;
            background: rgba(10, 12, 17, 0.92);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            color: #e3e3e3;
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            z-index: 200;
            display: none;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 12px 32px rgba(0,0,0,0.45);
        }
        .live-inputs-panel.visible { display: flex; }
        .live-inputs-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.55rem 0.85rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .live-inputs-title {
            font-size: 0.8125rem;
            font-weight: 600;
            color: #fff;
            text-transform: lowercase;
            letter-spacing: 0.04em;
        }
        .live-inputs-close {
            background: transparent;
            border: none;
            color: #888;
            cursor: pointer;
            padding: 0.15em 0.4em;
            font-size: 1rem;
            transition: color 0.15s;
        }
        .live-inputs-close:hover { color: #fff; }
        .live-inputs-body {
            padding: 0.5rem 0.85rem 0.75rem;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .live-inputs-body::-webkit-scrollbar { width: 6px; }
        .live-inputs-body::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: 3px;
        }
        .live-input-section {
            margin-bottom: 0.95rem;
        }
        .live-input-section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.4rem;
        }
        .live-input-section-title {
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: #aaa;
        }
        .live-input-status {
            font-size: 0.6875rem;
            color: #555;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
        }
        .live-input-status.connected { color: #4ade80; }
        .live-input-status.error { color: #ff6b6b; }
        .live-input-toggle {
            background: rgba(165, 184, 255, 0.18);
            border: 1px solid rgba(165, 184, 255, 0.35);
            color: #d9deeb;
            font-family: inherit;
            font-size: 0.6875rem;
            font-weight: 500;
            padding: 0.3rem 0.65rem;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .live-input-toggle:hover { background: rgba(165, 184, 255, 0.32); }
        .live-input-toggle.active {
            background: rgba(74, 222, 128, 0.22);
            border-color: rgba(74, 222, 128, 0.5);
            color: #c4f5d4;
        }
        .level-bars {
            display: grid;
            grid-template-columns: 36px 1fr 50px;
            gap: 0.4rem;
            align-items: center;
            font-size: 0.6875rem;
            line-height: 1;
            color: #aaa;
            margin-bottom: 0.18rem;
        }
        .level-bar-track {
            background: rgba(255,255,255,0.05);
            height: 6px;
            border-radius: 3px;
            overflow: hidden;
            position: relative;
        }
        .level-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #4ade80, #facc15, #ff6b6b);
            border-radius: 3px;
            transform-origin: left;
            transform: scaleX(0);
            transition: transform 0.06s linear;
        }
        .level-bar-value {
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            color: #888;
            text-align: right;
        }
        .live-input-spectrum {
            display: flex;
            align-items: flex-end;
            gap: 1px;
            height: 36px;
            margin-top: 0.4rem;
        }
        .live-input-spectrum-bar {
            flex: 1;
            background: linear-gradient(180deg, rgba(165,184,255,0.7), rgba(102,126,234,0.4));
            border-radius: 1px 1px 0 0;
            min-height: 1px;
            transition: height 0.04s linear;
        }
        .live-input-snippet {
            display: flex;
            align-items: center;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 4px;
            padding: 0.25rem 0.5rem;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            color: #ccc;
            cursor: pointer;
            margin-top: 0.4rem;
            transition: background 0.12s, border-color 0.12s;
        }
        .live-input-snippet:hover {
            background: rgba(102,126,234,0.12);
            border-color: rgba(165,184,255,0.4);
        }
        .live-input-snippet-label {
            flex: 1;
            color: #d9deeb;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .live-input-snippet-add {
            font-size: 0.625rem;
            color: #a5b8ff;
            margin-left: 0.5rem;
        }
        .live-input-help {
            font-size: 0.625rem;
            color: #666;
            line-height: 1.45;
            margin-top: 0.35rem;
        }
        .midi-cc-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem;
            margin-top: 0.35rem;
            min-height: 24px;
            padding: 0.3rem;
            background: rgba(0,0,0,0.3);
            border-radius: 4px;
        }
        .midi-cc-pill {
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.625rem;
            background: rgba(165, 184, 255, 0.14);
            color: #d9deeb;
            padding: 0.15rem 0.4rem;
            border-radius: 3px;
            white-space: nowrap;
            cursor: pointer;
            transition: background 0.1s;
        }
        .midi-cc-pill:hover {
            background: rgba(165, 184, 255, 0.28);
        }
        .midi-cc-empty {
            color: #555;
            font-size: 0.625rem;
            font-style: italic;
            padding: 0.1rem;
        }
        .source-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.35rem;
            margin-top: 0.35rem;
        }
        .source-btn {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.4rem 0.5rem;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            color: #d9deeb;
            font-family: inherit;
            font-size: 0.6875rem;
            cursor: pointer;
            transition: background 0.12s, border-color 0.12s;
        }
        .source-btn .icon-material { font-size: 14px; }
        .source-btn:hover {
            background: rgba(102,126,234,0.16);
            border-color: rgba(165,184,255,0.4);
        }
        .source-btn.active {
            background: rgba(74, 222, 128, 0.18);
            border-color: rgba(74, 222, 128, 0.45);
            color: #c4f5d4;
        }
        .source-btn[data-stop] {
            grid-column: span 2;
            justify-content: center;
            background: rgba(255,107,107,0.07);
            border-color: rgba(255,107,107,0.18);
            color: #ffb4b4;
        }
        .source-btn[data-stop]:hover {
            background: rgba(255,107,107,0.16);
            border-color: rgba(255,107,107,0.4);
        }
        .live-input-help code {
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            color: #a5b8ff;
            background: rgba(165,184,255,0.06);
            padding: 0 0.25em;
            border-radius: 3px;
        }
        .live-input-device-row {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            margin: 0.4rem 0 0.5rem;
        }
        .live-input-device-label {
            font-size: 0.6875rem;
            color: #888;
            white-space: nowrap;
        }
        .live-input-device-select {
            flex: 1;
            min-width: 0;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(165,184,255,0.25);
            color: #d9deeb;
            font-family: inherit;
            font-size: 0.6875rem;
            padding: 0.25rem 0.4rem;
            border-radius: 4px;
            cursor: pointer;
            text-overflow: ellipsis;
            white-space: nowrap;
            overflow: hidden;
        }
        .live-input-device-select:focus {
            outline: none;
            border-color: rgba(165,184,255,0.6);
        }
        .live-input-device-select:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .live-input-device-current {
            font-size: 0.625rem;
            color: #4ade80;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            margin-top: 0.25rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        @media (max-width: 768px) {
            .live-inputs-panel {
                top: 1rem;
                right: 1rem;
                bottom: 1rem;
                left: 1rem;
                width: auto;
                max-width: calc(100% - 2rem);
            }
        }
    `
    document.head.appendChild(style)
}

class LiveInputsPanel {
    constructor() {
        this._panel = null
        this._open = false
        this._renderer = null
        this._innerRenderer = null
        this._audioMgr = null
        this._midiMgr = null
        this._raf = null
        this._onInsert = null
        this._midiState = null

        this._lowFill = null
        this._midFill = null
        this._highFill = null
        this._volFill = null
        this._lowVal = null
        this._midVal = null
        this._highVal = null
        this._volVal = null
        this._spectrumEl = null
        this._spectrumBars = []
        this._audioToggle = null
        this._audioStatus = null
        this._midiToggle = null
        this._midiStatus = null
        this._midiCcList = null
        this._recentMidi = new Map() // key = `${ch}:${cc}` → {value, time}
    }

    /**
     * @param {object} options
     * @param {object} options.renderer  - PolymorphicRenderer
     * @param {(snippet: string) => void} options.onInsert - inserts DSL snippet at cursor
     */
    init(options) {
        this._renderer = options.renderer
        this._innerRenderer = this._renderer?.inner
        this._onInsert = options.onInsert || (() => {})
        this._build()
    }

    _build() {
        this._panel = document.createElement('div')
        this._panel.className = 'live-inputs-panel'
        this._panel.innerHTML = `
            <div class="live-inputs-header">
                <span class="live-inputs-title">live inputs</span>
                <button class="live-inputs-close" aria-label="Close">×</button>
            </div>
            <div class="live-inputs-body">
                <section class="live-input-section" data-id="audio">
                    <div class="live-input-section-header">
                        <span class="live-input-section-title">audio (mic)</span>
                        <button class="live-input-toggle" data-id="audio-toggle">enable</button>
                    </div>
                    <div class="live-input-device-row">
                        <span class="live-input-device-label">source</span>
                        <select class="live-input-device-select" data-id="audio-device">
                            <option value="">default</option>
                        </select>
                    </div>
                    <div class="live-input-device-current" data-id="audio-current"></div>
                    <div class="level-bars"><span>low</span><div class="level-bar-track"><div class="level-bar-fill" data-id="lowFill"></div></div><span class="level-bar-value" data-id="lowVal">0.00</span></div>
                    <div class="level-bars"><span>mid</span><div class="level-bar-track"><div class="level-bar-fill" data-id="midFill"></div></div><span class="level-bar-value" data-id="midVal">0.00</span></div>
                    <div class="level-bars"><span>high</span><div class="level-bar-track"><div class="level-bar-fill" data-id="highFill"></div></div><span class="level-bar-value" data-id="highVal">0.00</span></div>
                    <div class="level-bars"><span>vol</span><div class="level-bar-track"><div class="level-bar-fill" data-id="volFill"></div></div><span class="level-bar-value" data-id="volVal">0.00</span></div>
                    <div class="live-input-spectrum" data-id="spectrum"></div>
                    <div class="live-input-status" data-id="audio-status">disabled</div>
                    <div class="live-input-snippet" data-snippet="audio:low"><span class="live-input-snippet-label">audio(band: low, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="audio:mid"><span class="live-input-snippet-label">audio(band: mid, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="audio:high"><span class="live-input-snippet-label">audio(band: high, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="audio:vol"><span class="live-input-snippet-label">audio(band: vol, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                </section>
                <section class="live-input-section" data-id="midi">
                    <div class="live-input-section-header">
                        <span class="live-input-section-title">midi</span>
                        <button class="live-input-toggle" data-id="midi-toggle">connect</button>
                    </div>
                    <div class="midi-cc-list" data-id="midiCcList"><span class="midi-cc-empty">no devices yet</span></div>
                    <div class="live-input-status" data-id="midi-status">disabled</div>
                    <div class="live-input-snippet" data-snippet="midi:1"><span class="live-input-snippet-label">midi(channel: 1, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-help">click a recent CC pill to insert it as a parameter snippet.</div>
                </section>
                <section class="live-input-section" data-id="sources">
                    <div class="live-input-section-header">
                        <span class="live-input-section-title">sources</span>
                        <span class="live-input-status" data-id="source-status">none</span>
                    </div>
                    <div class="source-buttons">
                        <button class="source-btn" data-source="webcam"><span class="icon-material">videocam</span><span>webcam</span></button>
                        <button class="source-btn" data-source="screen"><span class="icon-material">screen_share</span><span>screen</span></button>
                        <button class="source-btn" data-source="video"><span class="icon-material">movie</span><span>video file</span></button>
                        <button class="source-btn" data-source="image"><span class="icon-material">image</span><span>image file</span></button>
                        <button class="source-btn" data-source="stop" data-stop><span class="icon-material">stop</span><span>stop source</span></button>
                    </div>
                    <div class="live-input-help">
                        Pick a source, then add <code>media().write(o0)</code> to use it.
                        Webcam and screen-capture stream live — image is loaded once.
                    </div>
                </section>
                <section class="live-input-section" data-id="osc">
                    <div class="live-input-section-header">
                        <span class="live-input-section-title">oscillator (built-in)</span>
                    </div>
                    <div class="live-input-snippet" data-snippet="osc:sine"><span class="live-input-snippet-label">osc(type: sine, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="osc:tri"><span class="live-input-snippet-label">osc(type: tri, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="osc:saw"><span class="live-input-snippet-label">osc(type: saw, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="osc:square"><span class="live-input-snippet-label">osc(type: square, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                    <div class="live-input-snippet" data-snippet="osc:noise"><span class="live-input-snippet-label">osc(type: noise, seed: 1, min: 0, max: 1)</span><span class="live-input-snippet-add">insert</span></div>
                </section>
            </div>
        `
        document.body.appendChild(this._panel)

        // Cache refs
        this._audioDeviceSelect = this._panel.querySelector('[data-id=audio-device]')
        this._audioCurrentLabel = this._panel.querySelector('[data-id=audio-current]')
        this._lowFill = this._panel.querySelector('[data-id=lowFill]')
        this._midFill = this._panel.querySelector('[data-id=midFill]')
        this._highFill = this._panel.querySelector('[data-id=highFill]')
        this._volFill = this._panel.querySelector('[data-id=volFill]')
        this._lowVal = this._panel.querySelector('[data-id=lowVal]')
        this._midVal = this._panel.querySelector('[data-id=midVal]')
        this._highVal = this._panel.querySelector('[data-id=highVal]')
        this._volVal = this._panel.querySelector('[data-id=volVal]')
        this._spectrumEl = this._panel.querySelector('[data-id=spectrum]')
        this._audioToggle = this._panel.querySelector('[data-id=audio-toggle]')
        this._audioStatus = this._panel.querySelector('[data-id=audio-status]')
        this._midiToggle = this._panel.querySelector('[data-id=midi-toggle]')
        this._midiStatus = this._panel.querySelector('[data-id=midi-status]')
        this._midiCcList = this._panel.querySelector('[data-id=midiCcList]')

        // Build spectrum bars (32 bars)
        for (let i = 0; i < 32; i++) {
            const bar = document.createElement('div')
            bar.className = 'live-input-spectrum-bar'
            bar.style.height = '1px'
            this._spectrumEl.appendChild(bar)
            this._spectrumBars.push(bar)
        }

        // Wire events
        this._panel.querySelector('.live-inputs-close').addEventListener('click', () => this.close())
        this._audioToggle.addEventListener('click', () => this._toggleAudio())
        this._midiToggle.addEventListener('click', () => this._toggleMidi())

        // When the user picks a different audio source, hot-swap if the
        // mic is already running; otherwise we'll honour the choice on
        // the next "enable" click.
        this._audioDeviceSelect?.addEventListener('change', async () => {
            if (this._audioMgr?.enabled) {
                const id = this._audioDeviceSelect.value || ''
                await this._audioMgr.switchDevice(id)
                this._updateAudioDeviceLabel(this._audioMgr.currentDeviceLabel)
            }
        })

        // Populate the dropdown up-front so the user sees a list of devices
        // before they click enable. Labels populate fully once permission
        // is granted; until then, browsers return generic "(unnamed input)"
        // strings.
        this._refreshAudioDevices()
        navigator.mediaDevices?.addEventListener?.('devicechange', () => {
            this._refreshAudioDevices()
        })
        this._panel.querySelectorAll('.live-input-snippet').forEach(el => {
            el.addEventListener('click', () => this._insertSnippet(el.dataset.snippet))
        })
        this._sourceStatus = this._panel.querySelector('[data-id=source-status]')
        this._panel.querySelectorAll('.source-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.source
                this._activateSource(kind, btn).catch(err => {
                    console.error('[LiveInputs] Source activation failed:', err)
                    this._setSourceStatus(`failed: ${err.message || err}`, 'error')
                })
            })
        })

        // Hidden video element used for webcam/video/screen capture
        this._videoEl = document.createElement('video')
        this._videoEl.style.display = 'none'
        this._videoEl.autoplay = true
        this._videoEl.muted = true
        this._videoEl.playsInline = true
        document.body.appendChild(this._videoEl)
        this._sourceFrameLoop = null
        // Bumped each time _startTextureLoop is called so old closures can detect
        // they've been superseded and stop scheduling.
        this._sourceLoopGen = 0
    }

    /**
     * Use a video file (e.g., from a drop) as the active media source.
     * Public counterpart to the internal _activateSource('video') path —
     * does not invoke the file picker since the caller already has the file.
     * @param {File} file
     */
    async useVideoFile(file) {
        if (!file) return
        await this.useObjectUrl(URL.createObjectURL(file), file.name)
    }

    /**
     * Use an arbitrary object URL (or other video URL) as the active source.
     * @param {string} url
     * @param {string} [label]
     */
    async useObjectUrl(url, label = 'video') {
        if (!url) return
        this.open()
        this._stopActiveSource()
        this._currentObjectUrl = url
        this._videoEl.srcObject = null
        this._videoEl.src = url
        this._videoEl.loop = true
        try { await this._videoEl.play() } catch { /* may need user gesture */ }
        this._startTextureLoop(this._videoEl)
        this._setSourceStatus(`video: ${label}`, 'connected')
        this._maybeInsertMediaSnippet()
        const btn = this._panel?.querySelector('.source-btn[data-source="video"]')
        if (btn) this._markActiveSourceBtn(btn)
    }

    /**
     * Activate a media source. The renderer's media texture step is updated each
     * frame from the chosen source. Inserts a `media()` snippet into the editor
     * so the user has a usable hook in their DSL.
     */
    async _activateSource(kind, btn) {
        // Stop existing source first
        this._stopActiveSource()

        if (kind === 'stop') {
            this._setSourceStatus('none')
            return
        }

        if (kind === 'webcam') {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            this._currentStream = stream
            this._videoEl.srcObject = stream
            await this._videoEl.play()
            this._startTextureLoop(this._videoEl)
            this._setSourceStatus('webcam streaming', 'connected')
            this._maybeInsertMediaSnippet()
            this._markActiveSourceBtn(btn)
            return
        }
        if (kind === 'screen') {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
            this._currentStream = stream
            this._videoEl.srcObject = stream
            await this._videoEl.play()
            this._startTextureLoop(this._videoEl)
            this._setSourceStatus('screen streaming', 'connected')
            this._maybeInsertMediaSnippet()
            this._markActiveSourceBtn(btn)
            return
        }
        if (kind === 'video') {
            const file = await pickFile('video/*')
            if (!file) return
            const url = URL.createObjectURL(file)
            this._currentObjectUrl = url
            this._videoEl.srcObject = null
            this._videoEl.src = url
            this._videoEl.loop = true
            await this._videoEl.play()
            this._startTextureLoop(this._videoEl)
            this._setSourceStatus(`video: ${file.name}`, 'connected')
            this._maybeInsertMediaSnippet()
            this._markActiveSourceBtn(btn)
            return
        }
        if (kind === 'image') {
            const file = await pickFile('image/*')
            if (!file) return
            const dataUrl = await fileToDataURL(file)
            // Insert a real media(url:...) snippet — Polymorphic already renders that
            this._setSourceStatus(`image: ${file.name}`, 'connected')
            this._onInsert(`media(url: "${dataUrl}").write(o0)`)
            this._markActiveSourceBtn(btn)
            return
        }
    }

    _stopActiveSource() {
        // Bump the generation so any in-flight texture loop closure stops scheduling.
        this._sourceLoopGen++
        if (this._sourceFrameLoop) {
            cancelAnimationFrame(this._sourceFrameLoop)
            this._sourceFrameLoop = null
        }
        if (this._currentStream) {
            for (const track of this._currentStream.getTracks()) track.stop()
            this._currentStream = null
        }
        if (this._currentObjectUrl) {
            URL.revokeObjectURL(this._currentObjectUrl)
            this._currentObjectUrl = null
        }
        if (this._videoEl) {
            try { this._videoEl.pause() } catch { /* ignore */ }
            this._videoEl.srcObject = null
            this._videoEl.removeAttribute('src')
        }
        this._panel?.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'))
    }

    _markActiveSourceBtn(btn) {
        this._panel?.querySelectorAll('.source-btn').forEach(b => b.classList.toggle('active', b === btn))
    }

    _setSourceStatus(text, cls = '') {
        if (this._sourceStatus) {
            this._sourceStatus.textContent = text
            this._sourceStatus.className = 'live-input-status' + (cls ? ' ' + cls : '')
        }
    }

    _maybeInsertMediaSnippet() {
        const editor = document.querySelector('code-editor')
        const value = editor?.value || ''
        // Only insert if no media() call exists yet
        if (!/media\s*\(/.test(value)) {
            this._onInsert('\n\nmedia(url: "live").write(o0)\n\nrender(o0)')
        }
    }

    _startTextureLoop(videoEl) {
        const innerRenderer = this._innerRenderer
        if (!innerRenderer || !videoEl) return
        // Generation token — captured by closure. If _stopActiveSource bumps the
        // counter (or another _startTextureLoop runs), this loop self-cancels on
        // its next frame.
        const generation = ++this._sourceLoopGen

        const update = () => {
            if (generation !== this._sourceLoopGen) return
            this._sourceFrameLoop = requestAnimationFrame(update)
            if (videoEl.paused || videoEl.videoWidth === 0) return
            // For now we always write to step 0 — Polymorphic sketches with a
            // single media() call always end up there. Multi-media support is a
            // followup that needs an engine-level "find media step" accessor.
            try {
                innerRenderer.updateTextureFromSource?.('imageTex_step_0', videoEl, { flipY: false })
            } catch { /* ignore */ }
        }
        update()
    }

    /**
     * Briefly highlight the snippet element that was just inserted (visual feedback).
     */
    flashSnippet(snippet) {
        if (!this._panel) return
        const items = this._panel.querySelectorAll('.live-input-snippet')
        for (const it of items) {
            const lbl = it.querySelector('.live-input-snippet-label')?.textContent || ''
            if (snippet.startsWith(lbl) || lbl.startsWith(snippet) || snippet === lbl) {
                it.style.transition = 'background 0.05s'
                it.style.background = 'rgba(74,222,128,0.22)'
                setTimeout(() => { it.style.background = '' }, 220)
                break
            }
        }
    }

    open() {
        if (this._open) return
        this._open = true
        this._panel?.classList.add('visible')
        document.body.classList.add('live-inputs-open')
        this._startMeterLoop()
    }

    close() {
        if (!this._open) return
        this._open = false
        this._panel?.classList.remove('visible')
        document.body.classList.remove('live-inputs-open')
        this._stopMeterLoop()
    }

    toggle() {
        this._open ? this.close() : this.open()
    }

    isOpen() { return this._open }

    async _toggleAudio() {
        if (!this._innerRenderer) return
        if (!this._audioMgr) {
            this._audioMgr = new LocalAudioInput(this._innerRenderer)
            this._audioMgr.onStatusChange(msg => {
                this._setAudioStatus(msg, this._audioMgr.enabled ? 'connected' : '')
            })
        }
        if (this._audioMgr.enabled) {
            await this._audioMgr.disable()
            this._audioToggle.classList.remove('active')
            this._audioToggle.textContent = 'enable'
            this._updateAudioDeviceLabel('')
            return
        }
        const wantedId = this._audioDeviceSelect?.value || ''
        const ok = await this._audioMgr.enable(wantedId)
        this._audioToggle.classList.toggle('active', !!ok)
        this._audioToggle.textContent = ok ? 'disable' : 'enable'
        if (ok) {
            // Refresh device list — labels are only available after permission
            await this._refreshAudioDevices()
            this._updateAudioDeviceLabel(this._audioMgr.currentDeviceLabel)
            // Sync the dropdown to the actual chosen device
            if (this._audioDeviceSelect && this._audioMgr.currentDeviceId) {
                this._audioDeviceSelect.value = this._audioMgr.currentDeviceId
            }
        }
    }

    /**
     * Populate the audio device dropdown from enumerateDevices().
     * Device labels only return real values after the user has granted
     * mic permission to at least one device.
     */
    async _refreshAudioDevices() {
        if (!this._audioDeviceSelect) return
        try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            const inputs = devices.filter(d => d.kind === 'audioinput')
            const previous = this._audioDeviceSelect.value
            this._audioDeviceSelect.innerHTML = ''
            // Always include a "system default" entry
            const defOpt = document.createElement('option')
            defOpt.value = ''
            defOpt.textContent = 'system default'
            this._audioDeviceSelect.appendChild(defOpt)
            for (const d of inputs) {
                const opt = document.createElement('option')
                opt.value = d.deviceId
                opt.textContent = d.label || `(unnamed input ${d.deviceId.slice(0, 6)})`
                this._audioDeviceSelect.appendChild(opt)
            }
            // Restore selection if still valid
            if (previous && [...this._audioDeviceSelect.options].some(o => o.value === previous)) {
                this._audioDeviceSelect.value = previous
            }
        } catch (err) {
            console.warn('[LiveInputs] enumerateDevices failed:', err)
        }
    }

    /** Update the green "current source" label under the dropdown. */
    _updateAudioDeviceLabel(label) {
        if (!this._audioCurrentLabel) return
        this._audioCurrentLabel.textContent = label ? `→ ${label}` : ''
    }

    async _toggleMidi() {
        if (!this._innerRenderer) return
        if (!this._midiMgr) {
            const { MidiInputManager } = await loadBundle()
            this._midiMgr = new MidiInputManager(this._innerRenderer)
            this._midiMgr.onStatusChange(msg => {
                this._setMidiStatus(msg, this._midiMgr.enabled ? 'connected' : '')
            })
        }
        const wasEnabled = this._midiMgr.enabled
        const ok = await this._midiMgr.toggle()
        const nowEnabled = !wasEnabled && ok
        this._midiToggle.classList.toggle('active', !!nowEnabled)
        this._midiToggle.textContent = nowEnabled ? 'disconnect' : 'connect'
    }

    _setAudioStatus(text, cls = '') {
        this._audioStatus.textContent = text
        this._audioStatus.className = 'live-input-status' + (cls ? ' ' + cls : '')
    }

    _setMidiStatus(text, cls = '') {
        this._midiStatus.textContent = text
        this._midiStatus.className = 'live-input-status' + (cls ? ' ' + cls : '')
    }

    _startMeterLoop() {
        if (this._raf) return
        const tick = () => {
            this._updateMeters()
            this._raf = requestAnimationFrame(tick)
        }
        tick()
    }

    _stopMeterLoop() {
        if (this._raf) {
            cancelAnimationFrame(this._raf)
            this._raf = null
        }
    }

    _updateMeters() {
        // Audio meters
        const audioState = this._innerRenderer?._audioState
        if (audioState && this._audioMgr?.enabled) {
            const { low = 0, mid = 0, high = 0, vol = 0 } = audioState
            this._setBar(this._lowFill, low)
            this._setBar(this._midFill, mid)
            this._setBar(this._highFill, high)
            this._setBar(this._volFill, vol)
            this._lowVal.textContent = low.toFixed(2)
            this._midVal.textContent = mid.toFixed(2)
            this._highVal.textContent = high.toFixed(2)
            this._volVal.textContent = vol.toFixed(2)

            const spectrum = audioState.spectrum
            if (spectrum && spectrum.length) {
                const bins = this._spectrumBars.length
                const step = Math.max(1, Math.floor(spectrum.length / bins))
                for (let i = 0; i < bins; i++) {
                    let v = 0
                    for (let j = 0; j < step; j++) {
                        const sIdx = i * step + j
                        if (sIdx < spectrum.length) v = Math.max(v, spectrum[sIdx])
                    }
                    // spectrum is 0..1 (normalized in noisemaker)
                    const h = Math.max(1, Math.round(v * 36))
                    this._spectrumBars[i].style.height = h + 'px'
                }
            }
        } else {
            this._setBar(this._lowFill, 0)
            this._setBar(this._midFill, 0)
            this._setBar(this._highFill, 0)
            this._setBar(this._volFill, 0)
        }

        // MIDI recent CCs — pull from midiState's per-channel last CC
        const midiState = this._innerRenderer?._midiState
        if (midiState && this._midiMgr?.enabled) {
            this._scanMidi(midiState)
        }
    }

    _setBar(el, value01) {
        if (!el) return
        const clamped = Math.max(0, Math.min(1, value01))
        el.style.transform = `scaleX(${clamped})`
    }

    _scanMidi(midiState) {
        try {
            for (const r of recentCcsFromMidiState(midiState)) {
                this._recentMidi.set(`${r.ch}:${r.cc}`, { ...r, time: Date.now() })
            }
            this._renderMidiList()
        } catch { /* ignore */ }
    }

    _renderMidiList() {
        const now = Date.now()
        // Drop entries older than 6 seconds
        for (const [k, v] of this._recentMidi) {
            if (now - v.time > 6000) this._recentMidi.delete(k)
        }
        this._midiCcList.innerHTML = ''
        if (this._recentMidi.size === 0) {
            const empty = document.createElement('span')
            empty.className = 'midi-cc-empty'
            empty.textContent = this._midiMgr?.enabled ? 'turn knobs to register cc' : 'no devices yet'
            this._midiCcList.appendChild(empty)
            return
        }
        const sorted = [...this._recentMidi.values()].sort((a, b) => b.time - a.time).slice(0, 16)
        for (const m of sorted) {
            const pill = document.createElement('span')
            pill.className = 'midi-cc-pill'
            pill.textContent = `ch${m.ch}.cc${m.cc}=${typeof m.value === 'number' ? m.value.toFixed(2) : m.value}`
            pill.title = 'Click to insert midi() snippet'
            pill.addEventListener('click', () => {
                const snippet = `midi(channel: ${m.ch}, controller: ${m.cc}, min: 0, max: 1)`
                this._onInsert(snippet)
            })
            this._midiCcList.appendChild(pill)
        }
    }

    _insertSnippet(key) {
        if (!key) return
        const map = {
            'audio:low': 'audio(band: low, min: 0, max: 1)',
            'audio:mid': 'audio(band: mid, min: 0, max: 1)',
            'audio:high': 'audio(band: high, min: 0, max: 1)',
            'audio:vol': 'audio(band: vol, min: 0, max: 1)',
            'midi:1': 'midi(channel: 1, min: 0, max: 1)',
            'osc:sine': 'osc(type: sine, min: 0, max: 1)',
            'osc:tri': 'osc(type: tri, min: 0, max: 1)',
            'osc:saw': 'osc(type: saw, min: 0, max: 1)',
            'osc:square': 'osc(type: square, min: 0, max: 1)',
            'osc:noise': 'osc(type: noise, seed: 1, min: 0, max: 1)'
        }
        const snippet = map[key]
        if (snippet) this._onInsert(snippet)
    }
}

/** Open a hidden file picker and resolve with the chosen File. */
function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = accept
        input.style.display = 'none'
        input.addEventListener('change', () => {
            const f = input.files?.[0] || null
            input.remove()
            resolve(f)
        })
        // If the dialog is dismissed without selection, no event fires — clean
        // up after a generous delay (the input element is detached so it's a
        // soft leak at worst, but better safe).
        document.body.appendChild(input)
        input.click()
    })
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = reject
        r.readAsDataURL(file)
    })
}

export const liveInputsPanel = new LiveInputsPanel()
