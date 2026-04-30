/**
 * BPM Clock with Tap Tempo
 *
 * Drives the renderer's loop duration so oscillators sync to a global beat.
 * The default loop duration is "one bar at the current BPM, where one bar is
 * four beats". setBpm(120) → 2.0s loopDuration → osc(speed: 1) cycles once
 * per bar.
 *
 *  - Press T to tap tempo (4+ taps to lock in).
 *  - Up/down arrows on the displayed BPM nudge by 1; Shift = 5.
 *  - The clock indicator shows current beat with a pulse.
 */

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
        .bpm-pulse {
            width: 8px;
            height: 8px;
            background: #a5b8ff;
            border-radius: 50%;
            transition: transform 0.08s;
        }
        .bpm-pulse.beat {
            transform: scale(1.6);
            background: #fff;
        }
        .bpm-value {
            font-weight: 600;
            color: #fff;
            min-width: 2.5em;
            text-align: right;
        }
        .bpm-label {
            font-size: 0.625rem;
            color: #888;
        }
        .bpm-tap-hint {
            font-size: 0.625rem;
            color: #666;
            margin-left: 0.4rem;
        }
    `
    document.head.appendChild(style)
}

class BpmClock {
    constructor() {
        this._bpm = 120
        this._renderer = null
        this._el = null
        this._pulseEl = null
        this._valueEl = null
        this._tapTimes = []
        this._raf = null
        this._lastBeatIndex = 0
        this._listeners = []
    }

    /**
     * @param {object} opts
     * @param {object} opts.renderer  - PolymorphicRenderer
     * @param {number} [opts.bpm=120]
     */
    init(opts) {
        this._renderer = opts.renderer
        this._bpm = opts.bpm || 120
        this._build()
        this._applyToRenderer()
        this._loop()
        this._installShortcuts()
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
            <span class="bpm-label">bpm</span>
            <span class="bpm-value" data-id="value">120</span>
            <span class="bpm-tap-hint">tap T · scroll · drag</span>
        `
        document.body.appendChild(this._el)
        this._pulseEl = this._el.querySelector('[data-id=pulse]')
        this._valueEl = this._el.querySelector('[data-id=value]')

        // Wheel adjust
        this._el.addEventListener('wheel', (e) => {
            e.preventDefault()
            const delta = -Math.sign(e.deltaY) * (e.shiftKey ? 5 : 1)
            this.setBpm(this._bpm + delta)
        }, { passive: false })

        // Drag to adjust
        let dragging = false
        let startX = 0
        let startBpm = 0
        this._el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return
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

        // Click to tap (single tap registers a tap)
        let lastClickTime = 0
        this._el.addEventListener('click', (e) => {
            const now = performance.now()
            // Only count clicks that aren't the end of a drag
            if (now - lastClickTime < 50) return
            lastClickTime = now
            this.tap()
        })

        this._render()
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

    _loop() {
        const tick = () => {
            this._raf = requestAnimationFrame(tick)
            const lastTime = this._renderer?.lastTime ?? 0 // 0..1 normalized
            const beatPhase = (lastTime * 4) % 1 // 4 beats per bar
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
