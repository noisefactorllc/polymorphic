/**
 * Tempo Controller (handfish <tempo-bar> integration)
 *
 * The visible tempo UI + beat clock + tap-tempo + divider + phase now live in
 * the shared handfish <tempo-bar> component (and its BeatScheduler). This thin
 * controller keeps the two responsibilities that are specific to Polymorphic
 * and that <tempo-bar> deliberately does NOT own:
 *
 *   1. Renderer sync — the renderer's loopDuration is driven from the
 *      scheduler's barSeconds() so osc(speed: 1) cycles once per bar. We
 *      re-apply on every BPM change, divider change, and at init.
 *
 *   2. MIDI clock follow — <tempo-bar>/BeatScheduler is manual-only. Polymorphic
 *      can FOLLOW an external MIDI clock: in 'midi' source we feed the detected
 *      BPM into the scheduler and mirror transport (Start/Stop/Continue) onto
 *      the renderer. The 'manual'/'midi' source preference persists exactly as
 *      before (polymorphic.bpm.source).
 *
 * The default loop duration is "one bar at the current BPM, where one bar is
 * four beats", stretched by the user-selected divider:
 *   120 BPM, /1 → 2.0s loopDuration → osc(speed: 1) cycles once per bar.
 *
 * Note: the <tempo-bar> is configured (in embed.js) with min-bpm/max-bpm = 20/400,
 * matching polymorphic's historical range; the BeatScheduler clamps to that.
 */

import { MidiClock } from './midiClock.js'

const SOURCE_STORAGE_KEY = 'polymorphic.bpm.source'

// Re-exported from the component's contract so unit tests and any callers have
// a single source of truth. One bar = four beats, scaled by an integer divider.
export const DIVIDER_OPTIONS = [1, 2, 4, 8, 16, 32]

/**
 * Pure helper for the bar-seconds calculation (mirrors BeatScheduler). One bar
 * = four beats at the given BPM, scaled by an integer divider so users can slow
 * animations to a fraction of standard tempo. Kept pure so it can be
 * unit-tested without a DOM / the component.
 */
export function computeBarSeconds(bpm, divider = 1) {
    return (60 / bpm) * 4 * divider
}

class TempoController {
    constructor() {
        this._tempoBar = null
        this._scheduler = null
        this._renderer = null
        this._source = 'manual'   // 'manual' | 'midi'
        this._midiClock = null
        this._midiStatus = 'no-device'
        this._sourceListeners = []
        this._midiStatusListeners = []
    }

    /**
     * @param {object} opts
     * @param {HTMLElement} opts.tempoBar - the <tempo-bar> element
     * @param {object} opts.renderer - PolymorphicRenderer
     */
    init(opts) {
        this._tempoBar = opts.tempoBar
        this._scheduler = opts.tempoBar?.scheduler || null
        this._renderer = opts.renderer
        this._source = this._loadSource()

        // Drive the renderer's loopDuration from the scheduler. The component's
        // own beat clock is independent of the renderer, so we wire timing here:
        // BPM and divider changes both restretch one bar.
        this._applyToRenderer()
        this._scheduler?.onChange(() => this._applyToRenderer())
        this._scheduler?.onDividerChange(() => this._applyToRenderer())

        // Re-emit source so subscribers can render the initial state.
        for (const cb of this._sourceListeners) cb(this._source)
        if (this._source === 'midi') this._enableMidi()
    }

    /** Seconds per visible animation cycle at the current BPM × divider. */
    barSeconds() {
        return this._scheduler ? this._scheduler.barSeconds() : computeBarSeconds(120, 4)
    }

    getBpm() { return this._scheduler ? this._scheduler.bpm : 120 }
    getDivider() { return this._scheduler ? this._scheduler.divider : 4 }
    getSource() { return this._source }
    getMidiStatus() { return this._midiStatus }

    onSourceChange(cb) { this._sourceListeners.push(cb) }
    onMidiStatusChange(cb) { this._midiStatusListeners.push(cb) }

    /**
     * Tap tempo. Only meaningful in manual source — in MIDI mode the BPM
     * follows the external clock, so taps are ignored (matching the old
     * BpmClock.tap() guard).
     */
    tap() {
        if (this._source !== 'manual') return
        this._tempoBar?.tap()
    }

    /**
     * Switch the clock source. 'manual' uses the component's tap/edit; 'midi'
     * subscribes to incoming MIDI clock + transport messages and feeds the
     * detected BPM into the scheduler.
     */
    setSource(source) {
        if (source !== 'manual' && source !== 'midi') return
        if (this._source === source) return
        this._source = source
        this._saveSource(source)
        if (source === 'midi') this._enableMidi()
        else this._disableMidi()
        for (const cb of this._sourceListeners) cb(this._source)
    }

    /** Toggle source between 'manual' and 'midi'. */
    toggleSource() {
        this.setSource(this._source === 'manual' ? 'midi' : 'manual')
    }

    _applyToRenderer() {
        const inner = this._renderer?.inner
        if (inner?.setLoopDuration) {
            inner.setLoopDuration(this.barSeconds())
        }
    }

    _enableMidi() {
        if (!this._midiClock) {
            this._midiClock = new MidiClock()
            this._midiClock.onBpm(bpm => {
                // Feed the detected clock BPM into the scheduler (clamped to the
                // configured 20–400). The component reflects it via onChange.
                if (this._source === 'midi' && this._scheduler) this._scheduler.bpm = bpm
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
}

export const tempoController = new TempoController()
