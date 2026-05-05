/**
 * BPM Clock with Tap Tempo and MIDI Sync
 *
 * Headless clock that drives the renderer's loop duration so oscillators sync
 * to a global beat. The visual indicator now lives in the status row (the
 * `bpm` chip); this module exposes observer hooks (`onChange`, `onBeat`,
 * `onSourceChange`, `onMidiStatusChange`) so the chip can render the current
 * value, animate on each beat, and reflect the manual/midi source.
 *
 * The default loop duration is "one bar at the current BPM, where one bar is
 * four beats". setBpm(120) → 2.0s loopDuration → osc(speed: 1) cycles once
 * per bar.
 *
 *  - Press T to tap tempo (manual source only).
 *  - In midi mode, BPM and transport (Start/Stop/Continue) follow incoming
 *    MIDI System Real-Time messages.
 */

import { MidiClock } from './midiClock.js'

const SOURCE_STORAGE_KEY = 'polymorphic.bpm.source'

class BpmClock {
    constructor() {
        this._bpm = 120
        this._renderer = null
        this._raf = null
        this._lastBeatIndex = 0
        this._changeListeners = []
        this._beatListeners = []
        this._sourceListeners = []
        this._midiStatusListeners = []
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
        this._applyToRenderer()
        this._loop()
        this._installShortcuts()
        // Re-emit source so subscribers can render the initial state.
        for (const cb of this._sourceListeners) cb(this._source)
        if (this._source === 'midi') {
            this._enableMidi()
        }
    }

    setBpm(bpm) {
        if (!Number.isFinite(bpm)) return
        const clamped = Math.max(20, Math.min(400, bpm))
        this._bpm = Math.round(clamped * 100) / 100
        this._applyToRenderer()
        for (const cb of this._changeListeners) cb(this._bpm)
    }

    getBpm() { return this._bpm }

    onChange(cb) { this._changeListeners.push(cb) }
    onBeat(cb) { this._beatListeners.push(cb) }
    onSourceChange(cb) { this._sourceListeners.push(cb) }
    onMidiStatusChange(cb) { this._midiStatusListeners.push(cb) }

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
        this._tapTimes = (this._tapTimes || []).filter(t => now - t < 2500)
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

    /**
     * Switch the clock source. 'manual' uses tap tempo; 'midi' subscribes
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
        for (const cb of this._sourceListeners) cb(this._source)
    }

    /** Toggle source between 'manual' and 'midi'. */
    toggleSource() {
        this.setSource(this._source === 'manual' ? 'midi' : 'manual')
    }

    getSource() { return this._source }
    getMidiStatus() { return this._midiStatus }

    _applyToRenderer() {
        const inner = this._renderer?.inner
        if (inner?.setLoopDuration) {
            inner.setLoopDuration(this.barSeconds())
        }
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
                for (const cb of this._midiStatusListeners) cb(status)
            })
        }
        this._midiClock.enable().then(result => {
            if (result === 'denied') {
                this._midiStatus = 'denied'
                for (const cb of this._midiStatusListeners) cb('denied')
            }
        })
    }

    _disableMidi() {
        // Keep the MidiClock instance for fast re-enable; just release inputs.
        this._midiClock?.disable()
        this._midiStatus = 'no-device'
        for (const cb of this._midiStatusListeners) cb('no-device')
        // If the renderer was paused by a Stop message, resume it.
        const inner = this._renderer?.inner
        if (inner && !inner.isRunning) inner.start?.()
    }

    _handleTransport(kind) {
        const inner = this._renderer?.inner
        if (!inner) return
        if (kind === 'start') {
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
            const lastTime = this._renderer?.lastTime ?? 0 // 0..1 normalized
            const currentBeat = Math.floor(lastTime * 4)
            if (currentBeat !== this._lastBeatIndex) {
                this._lastBeatIndex = currentBeat
                for (const cb of this._beatListeners) cb()
            }
        }
        tick()
    }
}

export const bpmClock = new BpmClock()
