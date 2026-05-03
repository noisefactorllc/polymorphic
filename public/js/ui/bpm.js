/**
 * BPM Clock with Tap Tempo and MIDI Sync
 *
 * Drives the renderer's loop duration so oscillators sync to a global beat.
 * The default loop duration is "one bar at the current BPM, where one bar is
 * four beats". setBpm(120) → 2.0s loopDuration → osc(speed: 1) cycles once
 * per bar.
 *
 *  - Press T to tap tempo (manual source only).
 *  - Up/down arrows on the displayed BPM nudge by 1; Shift = 5.
 *  - Click the bpm/midi label to toggle clock source.
 *  - In midi mode, BPM and transport (Start/Stop/Continue) follow incoming
 *    MIDI System Real-Time messages.
 *  - The pulse indicator beats with the current source.
 */

import { MidiClock } from './midiClock.js'

const SOURCE_STORAGE_KEY = 'polymorphic.bpm.source'

const STYLES_ID = 'bpm-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .bpm-indicator {
            position: fixed;
            bottom: 0.75rem;
            left: 0.75rem;
            background: rgba(10, 12, 17, 0.85);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            color: #d9deeb;
            padding: 0.4rem 0.65rem;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            line-height: 1.4;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            z-index: 220;
            user-select: none;
            cursor: ew-resize;
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }
        .bpm-indicator.hidden { display: none; }
        .bpm-indicator.midi { cursor: default; }
        .bpm-pulse {
            width: 8px;
            height: 8px;
            background: #a5b8ff;
            border-radius: 50%;
            transition: transform 0.08s, background 0.15s;
        }
        .bpm-pulse.beat {
            transform: scale(1.6);
            background: #fff;
        }
        .bpm-indicator.midi .bpm-pulse { background: #ffb070; }
        .bpm-indicator.midi .bpm-pulse.beat { background: #fff; }
        .bpm-value {
            font-weight: 600;
            color: #fff;
            min-width: 2.5em;
            text-align: right;
        }
        .bpm-label {
            font-size: 0.625rem;
            color: #888;
            cursor: pointer;
            padding: 0 0.1rem;
            transition: color 0.12s;
        }
        .bpm-label:hover { color: #cfd5e6; }
        .bpm-indicator.midi .bpm-label { color: #ffb070; }
        .bpm-indicator.midi .bpm-label:hover { color: #ffd0a0; }
        .bpm-hint {
            font-size: 0.625rem;
            color: #666;
            margin-left: 0.4rem;
        }
        .bpm-indicator.midi .bpm-hint { color: #8a7560; }
        .bpm-close {
            background: transparent;
            border: none;
            color: #666;
            cursor: pointer;
            padding: 0 0.15rem;
            margin-left: 0.25rem;
            font-size: 0.875rem;
            line-height: 1;
            transition: color 0.12s;
        }
        .bpm-close:hover { color: #fff; }
    `
    document.head.appendChild(style)
}

const HINT_BY_SOURCE = {
    manual: 'tap T · scroll · drag',
}

const HINT_BY_MIDI_STATUS = {
    'synced': 'synced',
    'no-device': 'no device',
    'no-clock': 'no clock',
    'stopped': 'stopped',
    'denied': 'permission denied',
}

class BpmClock {
    constructor() {
        this._bpm = 120
        this._renderer = null
        this._el = null
        this._pulseEl = null
        this._valueEl = null
        this._labelEl = null
        this._hintEl = null
        this._tapTimes = []
        this._raf = null
        this._lastBeatIndex = 0
        this._listeners = []
        this._source = 'manual'   // 'manual' | 'midi'
        this._midiClock = null
        this._midiStatus = 'no-device'
    }

    /**
     * @param {object} opts
     * @param {object} opts.renderer  - PolymorphicRenderer
     * @param {number} [opts.bpm=120]
     */
    init(opts) {
        this._renderer = opts.renderer
        this._bpm = opts.bpm || 120
        this._source = this._loadSource()
        this._build()
        this._applyToRenderer()
        this._loop()
        this._installShortcuts()
        if (this._source === 'midi') {
            // User had MIDI selected from a previous session; re-engage it.
            this._enableMidi()
        }
    }

    setBpm(bpm) {
        if (!Number.isFinite(bpm)) return
        const clamped = Math.max(20, Math.min(400, bpm))
        this._bpm = Math.round(clamped * 100) / 100
        this._applyToRenderer()
        this._render()
        for (const cb of this._listeners) cb(this._bpm)
    }

    onChange(cb) { this._listeners.push(cb) }

    /**
     * Returns loopDuration (seconds) such that osc(speed: 1) cycles once per
     * bar (4 beats).
     */
    barSeconds() {
        return (60 / this._bpm) * 4
    }

    tap() {
        if (this._source !== 'manual') return
        const now = performance.now()
        // Drop taps older than 2.5s (probably a different tempo)
        this._tapTimes = this._tapTimes.filter(t => now - t < 2500)
        this._tapTimes.push(now)
        if (this._tapTimes.length >= 2) {
            // Average inter-tap interval
            let sum = 0
            for (let i = 1; i < this._tapTimes.length; i++) {
                sum += this._tapTimes[i] - this._tapTimes[i - 1]
            }
            const avgMs = sum / (this._tapTimes.length - 1)
            const bpm = 60_000 / avgMs
            this.setBpm(bpm)
        }
    }

    show() { this._el?.classList.remove('hidden') }
    hide() { this._el?.classList.add('hidden') }
    toggle() { this._el?.classList.toggle('hidden') }
    isOpen() { return this._el ? !this._el.classList.contains('hidden') : false }

    /**
     * Switch the clock source. 'manual' uses tap/drag/scroll; 'midi' subscribes
     * to incoming MIDI clock + transport messages.
     */
    setSource(source) {
        if (source !== 'manual' && source !== 'midi') return
        if (this._source === source) return
        this._source = source
        this._saveSource(source)
        if (source === 'midi') {
            this._enableMidi()
        } else {
            this._disableMidi()
        }
        this._renderSourceUI()
    }

    getSource() { return this._source }

    _applyToRenderer() {
        const inner = this._renderer?.inner
        if (inner?.setLoopDuration) {
            inner.setLoopDuration(this.barSeconds())
        }
    }

    _build() {
        this._el = document.createElement('div')
        this._el.className = 'bpm-indicator'
        this._el.innerHTML = `
            <span class="bpm-pulse" data-id="pulse"></span>
            <span class="bpm-label" data-id="label" title="Click to toggle clock source">bpm</span>
            <span class="bpm-value" data-id="value">120</span>
            <span class="bpm-hint" data-id="hint">tap T · scroll · drag</span>
            <button class="bpm-close" aria-label="Hide BPM indicator">×</button>
        `
        document.body.appendChild(this._el)
        this._pulseEl = this._el.querySelector('[data-id=pulse]')
        this._valueEl = this._el.querySelector('[data-id=value]')
        this._labelEl = this._el.querySelector('[data-id=label]')
        this._hintEl = this._el.querySelector('[data-id=hint]')

        const closeBtn = this._el.querySelector('.bpm-close')
        closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation()
            this.hide()
        })

        this._labelEl?.addEventListener('click', (e) => {
            e.stopPropagation()
            this.setSource(this._source === 'manual' ? 'midi' : 'manual')
        })

        // Wheel adjust (manual only)
        this._el.addEventListener('wheel', (e) => {
            if (this._source !== 'manual') return
            e.preventDefault()
            const delta = -Math.sign(e.deltaY) * (e.shiftKey ? 5 : 1)
            this.setBpm(this._bpm + delta)
        }, { passive: false })

        // Drag to adjust (manual only)
        let dragging = false
        let startX = 0
        let startBpm = 0
        this._el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return
            if (this._source !== 'manual') return
            // Pointer capture would redirect the click off the close button to
            // this element, so the close handler never fires.
            if (e.target.closest('.bpm-close')) return
            if (e.target.closest('.bpm-label')) return
            dragging = true
            startX = e.clientX
            startBpm = this._bpm
            try { this._el.setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
        })
        this._el.addEventListener('pointermove', (e) => {
            if (!dragging) return
            const dx = e.clientX - startX
            const factor = e.shiftKey ? 0.2 : 1
            this.setBpm(startBpm + dx * factor)
        })
        this._el.addEventListener('pointerup', () => { dragging = false })
        this._el.addEventListener('pointercancel', () => { dragging = false })

        // Click to tap (manual only; single tap registers a tap)
        let lastClickTime = 0
        this._el.addEventListener('click', (e) => {
            if (this._source !== 'manual') return
            if (e.target.closest('.bpm-label, .bpm-close')) return
            const now = performance.now()
            // Only count clicks that aren't the end of a drag
            if (now - lastClickTime < 50) return
            lastClickTime = now
            this.tap()
        })

        this._render()
        this._renderSourceUI()
    }

    _installShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger while typing in an input/textarea
            const tag = (e.target?.tagName || '').toUpperCase()
            if (tag === 'TEXTAREA' || tag === 'INPUT') return
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
            if (e.key === 't' || e.key === 'T') {
                this.tap()
            }
        })
    }

    _render() {
        if (this._valueEl) this._valueEl.textContent = String(Math.round(this._bpm))
    }

    _renderSourceUI() {
        if (!this._el) return
        this._el.classList.toggle('midi', this._source === 'midi')
        if (this._labelEl) {
            this._labelEl.textContent = this._source === 'midi' ? 'midi' : 'bpm'
        }
        this._renderHint()
    }

    _renderHint() {
        if (!this._hintEl) return
        if (this._source === 'manual') {
            this._hintEl.textContent = HINT_BY_SOURCE.manual
        } else {
            this._hintEl.textContent = HINT_BY_MIDI_STATUS[this._midiStatus] ?? this._midiStatus
        }
    }

    _enableMidi() {
        if (!this._midiClock) {
            this._midiClock = new MidiClock()
            this._midiClock.onBpm(bpm => {
                if (this._source === 'midi') this.setBpm(bpm)
            })
            this._midiClock.onTransport(kind => {
                if (this._source !== 'midi') return
                this._handleTransport(kind)
            })
            this._midiClock.onStatusChange(status => {
                this._midiStatus = status
                if (this._source === 'midi') this._renderHint()
            })
        }
        this._midiClock.enable().then(result => {
            if (result === 'denied') this._midiStatus = 'denied'
            this._renderHint()
        })
    }

    _disableMidi() {
        // Keep the MidiClock instance for fast re-enable; just release inputs.
        this._midiClock?.disable()
        this._midiStatus = 'no-device'
        // If the renderer was paused by a Stop message, resume it.
        const inner = this._renderer?.inner
        if (inner && !inner.isRunning) inner.start?.()
    }

    _handleTransport(kind) {
        const inner = this._renderer?.inner
        if (!inner) return
        if (kind === 'start') {
            // Reset the loop phase to 0; setLoopDuration() also resets _loopStartTime.
            inner.setLoopDuration?.(this.barSeconds())
            if (!inner.isRunning) inner.start?.()
        } else if (kind === 'continue') {
            if (!inner.isRunning) inner.start?.()
        } else if (kind === 'stop') {
            inner.stop?.()
        }
    }

    _loadSource() {
        try {
            const v = localStorage.getItem(SOURCE_STORAGE_KEY)
            return v === 'midi' ? 'midi' : 'manual'
        } catch { return 'manual' }
    }

    _saveSource(source) {
        try { localStorage.setItem(SOURCE_STORAGE_KEY, source) } catch { /* ignore */ }
    }

    _loop() {
        const tick = () => {
            this._raf = requestAnimationFrame(tick)
            // Skip all DOM work when the indicator is hidden — saves the cost
            // of the per-beat class toggle + setTimeout while still keeping the
            // beat counter in sync if/when the indicator is shown again.
            if (this._el?.classList.contains('hidden')) {
                this._lastBeatIndex = Math.floor((this._renderer?.lastTime ?? 0) * 4)
                return
            }
            const lastTime = this._renderer?.lastTime ?? 0 // 0..1 normalized
            const currentBeat = Math.floor(lastTime * 4)
            const isBeat = currentBeat !== this._lastBeatIndex
            if (isBeat) {
                this._lastBeatIndex = currentBeat
                this._pulseEl?.classList.add('beat')
                setTimeout(() => this._pulseEl?.classList.remove('beat'), 80)
            }
        }
        tick()
    }
}

export const bpmClock = new BpmClock()
