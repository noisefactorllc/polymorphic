/**
 * MIDI Clock Receiver
 *
 * Listens for MIDI System Real-Time messages (clock + transport) and exposes
 * derived BPM and transport events for the BPM bar.
 *
 * Coexists with the engine's MidiInputManager (which handles notes/CCs) by
 * attaching via addEventListener('midimessage', …) instead of overwriting
 * input.onmidimessage.
 *
 *   const clock = new MidiClock()
 *   clock.onBpm(bpm => ...)
 *   clock.onTransport(kind => ...)   // 'start' | 'stop' | 'continue'
 *   clock.onStatusChange(status => ...)
 *   await clock.enable()             // → 'ok' | 'no-device' | 'denied'
 *   clock.disable()
 */

const TICKS_PER_BEAT = 24    // MIDI clock is 24 PPQN
const WINDOW_TICKS = 24      // sliding window of one beat
const SMOOTHING_ALPHA = 0.2  // EMA factor for BPM updates
const NO_CLOCK_TIMEOUT_MS = 2000

/**
 * Map a status byte to a transport event name, or null if it isn't one we care about.
 * @param {number} byte
 * @returns {'clock' | 'start' | 'stop' | 'continue' | null}
 */
export function parseMidiStatus(byte) {
    switch (byte) {
        case 0xF8: return 'clock'
        case 0xFA: return 'start'
        case 0xFB: return 'continue'
        case 0xFC: return 'stop'
        default: return null
    }
}

/**
 * Compute BPM from a list of MIDI clock tick timestamps (ms).
 * Returns null if there's not enough data or the average interval is non-positive.
 * @param {number[]} timestamps
 * @returns {number | null}
 */
export function bpmFromTickIntervals(timestamps) {
    if (!Array.isArray(timestamps) || timestamps.length < 2) return null
    let sum = 0
    for (let i = 1; i < timestamps.length; i++) sum += timestamps[i] - timestamps[i - 1]
    const avgInterval = sum / (timestamps.length - 1)
    if (!Number.isFinite(avgInterval) || avgInterval <= 0) return null
    return 60_000 / (avgInterval * TICKS_PER_BEAT)
}

export class MidiClock {
    constructor() {
        this._access = null
        this._inputs = []           // [{input, listener}]
        this._enabled = false
        this._tickTimes = []        // sliding window of recent clock timestamps
        this._smoothedBpm = null
        this._lastTickAt = 0
        this._noClockTimer = null

        this._onBpm = []
        this._onTransport = []
        this._onStatusChange = []
        this._status = 'no-device'
    }

    static isSupported() {
        return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
    }

    get enabled() { return this._enabled }
    get status() { return this._status }

    onBpm(cb) { this._onBpm.push(cb) }
    onTransport(cb) { this._onTransport.push(cb) }
    onStatusChange(cb) { this._onStatusChange.push(cb) }

    /**
     * Request MIDI access and start listening for clock/transport messages.
     * @returns {Promise<'ok' | 'no-device' | 'denied'>}
     */
    async enable() {
        if (this._enabled) return this._status === 'no-device' ? 'no-device' : 'ok'
        if (!MidiClock.isSupported()) {
            this._setStatus('no-device')
            return 'no-device'
        }
        try {
            this._access = await navigator.requestMIDIAccess()
        } catch {
            this._setStatus('no-device')
            return 'denied'
        }
        this._enabled = true
        this._attachInputs()
        this._access.onstatechange = () => this._attachInputs()
        if (this._inputs.length === 0) {
            this._setStatus('no-device')
            return 'no-device'
        }
        this._setStatus('no-clock')
        this._armNoClockWatchdog()
        return 'ok'
    }

    disable() {
        if (!this._enabled) return
        for (const { input, listener } of this._inputs) {
            input.removeEventListener('midimessage', listener)
        }
        this._inputs = []
        if (this._access) this._access.onstatechange = null
        this._access = null
        this._enabled = false
        this._tickTimes = []
        this._smoothedBpm = null
        if (this._noClockTimer) {
            clearTimeout(this._noClockTimer)
            this._noClockTimer = null
        }
        this._setStatus('no-device')
    }

    _attachInputs() {
        if (!this._access) return
        const seen = new Set()
        for (const input of this._access.inputs.values()) {
            seen.add(input)
            if (this._inputs.find(e => e.input === input)) continue
            const listener = (event) => this._handleMessage(event.data)
            input.addEventListener('midimessage', listener)
            if (input.connection !== 'open') {
                try { input.open() } catch { /* ignore */ }
            }
            this._inputs.push({ input, listener })
        }
        // Drop entries whose inputs disappeared
        this._inputs = this._inputs.filter(({ input, listener }) => {
            if (seen.has(input)) return true
            try { input.removeEventListener('midimessage', listener) } catch { /* ignore */ }
            return false
        })
        if (this._inputs.length === 0 && this._status !== 'stopped') {
            this._setStatus('no-device')
        } else if (this._inputs.length > 0 && this._status === 'no-device') {
            this._setStatus('no-clock')
        }
    }

    _handleMessage(data) {
        if (!data || data.length < 1) return
        const kind = parseMidiStatus(data[0])
        if (!kind) return
        if (kind === 'clock') {
            this._onClockTick()
            return
        }
        // Transport
        for (const cb of this._onTransport) {
            try { cb(kind) } catch (e) { console.error('[MidiClock] onTransport handler threw', e) }
        }
        if (kind === 'stop') {
            this._setStatus('stopped')
            this._tickTimes = []
        } else if (kind === 'start' || kind === 'continue') {
            // Reset window so post-Start BPM derives from the new transport
            this._tickTimes = []
            this._setStatus('no-clock')
            this._armNoClockWatchdog()
        }
    }

    _onClockTick() {
        const now = performance.now()
        this._lastTickAt = now
        this._tickTimes.push(now)
        if (this._tickTimes.length > WINDOW_TICKS) {
            this._tickTimes.shift()
        }
        const raw = bpmFromTickIntervals(this._tickTimes)
        if (raw == null) return
        const smoothed = this._smoothedBpm == null
            ? raw
            : this._smoothedBpm + SMOOTHING_ALPHA * (raw - this._smoothedBpm)
        this._smoothedBpm = smoothed
        if (this._status !== 'synced') this._setStatus('synced')
        this._armNoClockWatchdog()
        for (const cb of this._onBpm) {
            try { cb(smoothed) } catch (e) { console.error('[MidiClock] onBpm handler threw', e) }
        }
    }

    _armNoClockWatchdog() {
        if (this._noClockTimer) clearTimeout(this._noClockTimer)
        this._noClockTimer = setTimeout(() => {
            if (!this._enabled) return
            if (this._status === 'stopped') return  // stopped is intentional
            if (performance.now() - this._lastTickAt >= NO_CLOCK_TIMEOUT_MS) {
                if (this._inputs.length === 0) this._setStatus('no-device')
                else this._setStatus('no-clock')
            }
        }, NO_CLOCK_TIMEOUT_MS + 50)
    }

    _setStatus(status) {
        if (this._status === status) return
        this._status = status
        for (const cb of this._onStatusChange) {
            try { cb(status) } catch (e) { console.error('[MidiClock] onStatusChange handler threw', e) }
        }
    }
}
