/**
 * Status Row
 *
 * Slim bottom-edge bar showing live state at a glance:
 *   [● mic]  [♪ midi]  [⏺ recording]  [♩ 120 bpm]  [⚡ 60 fps]  [program: Aurora]
 *
 * Each chip exposes a click handler for quick toggles. The row is opt-in via
 * Cmd/Ctrl+; (semicolon) and the command palette ("toggle status row").
 */

const STYLES_ID = 'status-row-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .status-row {
            position: fixed;
            left: 0.75rem;
            right: 0.75rem;
            bottom: 0.5rem;
            display: flex;
            gap: 0.5rem;
            justify-content: center;
            align-items: center;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            color: #d9deeb;
            z-index: 230;
            pointer-events: none;
            transition: opacity 0.2s;
        }
        .status-row.hidden { opacity: 0; pointer-events: none; }
        .status-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            background: rgba(10, 12, 17, 0.72);
            border: 1px solid rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            padding: 0.25rem 0.55rem;
            border-radius: 999px;
            cursor: pointer;
            pointer-events: auto;
            transition: background 0.15s, border-color 0.15s, color 0.15s;
            user-select: none;
            white-space: nowrap;
        }
        .status-chip:hover {
            background: rgba(102, 126, 234, 0.25);
            border-color: rgba(165, 184, 255, 0.4);
        }
        .status-chip .icon-material { font-size: 13px; }
        .status-chip-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #555;
        }
        .status-chip.on .status-chip-dot { background: #4ade80; }
        .status-chip.warn .status-chip-dot { background: #facc15; }
        .status-chip.err .status-chip-dot { background: #ff6b6b; }
        .status-chip.recording {
            border-color: rgba(255, 107, 107, 0.4);
            color: #ffb4b4;
        }
        .status-chip.recording .status-chip-dot {
            background: #ff4d4d;
            animation: status-rec-pulse 1.4s infinite;
        }
        @keyframes status-rec-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.45; }
        }

        /* MIDI-driven BPM chip uses an amber accent so it's distinguishable
           from manual at a glance. */
        .status-chip.midi {
            border-color: rgba(255, 176, 112, 0.45);
            color: #ffd0a0;
        }
        .status-chip.midi .status-chip-dot { background: #ffb070; }

        /* Beat pulse for the bpm chip's dot. */
        .status-chip-dot.beat {
            transform: scale(1.6);
            background: #fff;
            transition: transform 0.08s, background 0.15s;
        }

        /* The BPM chip is the only one with structured sub-controls: an
           editable value, a unit label, and a Tap (T) button. Hover on the
           value hints at double-click-to-edit; the Tap button is grayed
           out unless the T key would actually fire (no editor focus and
           manual source). */
        .status-chip-bpm-value {
            cursor: text;
            padding: 0 0.2em;
            border-radius: 3px;
            transition: background 0.12s;
        }
        .status-chip-bpm-value:hover {
            background: rgba(255, 255, 255, 0.08);
        }
        .status-chip-bpm-edit {
            width: 3.6em;
            background: rgba(255, 255, 255, 0.10);
            border: 1px solid rgba(165, 184, 255, 0.55);
            color: inherit;
            font: inherit;
            padding: 0 0.25em;
            border-radius: 3px;
            text-align: center;
            outline: none;
            -moz-appearance: textfield;
        }
        .status-chip-bpm-edit::-webkit-inner-spin-button,
        .status-chip-bpm-edit::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .status-chip-bpm-tap {
            margin-left: 0.45em;
            padding: 0.05rem 0.45rem;
            background: rgba(165, 184, 255, 0.10);
            border: 1px solid rgba(165, 184, 255, 0.20);
            color: #888;
            font: inherit;
            font-size: 0.625rem;
            line-height: 1.4;
            border-radius: 4px;
            cursor: not-allowed;
            opacity: 0.45;
            transition: opacity 0.15s, background 0.10s, border-color 0.10s, color 0.10s;
            user-select: none;
        }
        .status-chip-bpm-tap.active {
            opacity: 1;
            color: #d9deeb;
            border-color: rgba(165, 184, 255, 0.55);
            cursor: pointer;
        }
        .status-chip-bpm-tap.active:hover {
            background: rgba(165, 184, 255, 0.22);
        }
        .status-chip-bpm-tap-key {
            opacity: 0.65;
            margin-left: 0.25em;
        }
        .status-chip-bpm-tap.flash {
            background: rgba(74, 222, 128, 0.55);
            border-color: rgba(74, 222, 128, 0.7);
            color: #fff;
        }
        /* In MIDI mode the BPM follows external clock — hide manual taps. */
        .status-chip.midi .status-chip-bpm-tap { display: none; }
        .status-chip.midi .status-chip-bpm-value { cursor: default; }
        .status-chip.midi .status-chip-bpm-value:hover { background: transparent; }
    `
    document.head.appendChild(style)
}

class StatusRow {
    constructor() {
        this._el = null
        this._chips = {}
        this._open = false
        this._hooks = {}
        this._raf = null
        this._renderer = null
    }

    init(opts = {}) {
        this._renderer = opts.renderer
        this._hooks = opts.hooks || {}
        this._build()
        // Visible by default — the bpm chip lives here now and was previously
        // shown by default as a standalone indicator.
        const initiallyOpen = opts.initiallyOpen !== false
        if (initiallyOpen) {
            this._open = true
            this._el?.classList.remove('hidden')
            document.body.classList.add('status-row-open')
            this._loop()
        } else {
            this._el.classList.add('hidden')
            this._open = false
        }
    }

    show() {
        if (this._open) return
        this._open = true
        this._el?.classList.remove('hidden')
        document.body.classList.add('status-row-open')
        this._loop()
    }

    hide() {
        if (!this._open) return
        this._open = false
        this._el?.classList.add('hidden')
        document.body.classList.remove('status-row-open')
        if (this._raf) cancelAnimationFrame(this._raf)
        this._raf = null
    }

    toggle() { this._open ? this.hide() : this.show() }
    isOpen() { return this._open }

    /**
     * Briefly highlight a chip's dot. Used by the bpm chip to pulse on each
     * beat so the BPM indication stays visually live.
     */
    pulse(chipId) {
        const chip = this._chips[chipId]
        if (!chip) return
        const dot = chip.querySelector('.status-chip-dot')
        if (!dot) return
        dot.classList.add('beat')
        // Use timeout, not animation events, to keep the pulse cheap.
        clearTimeout(dot._pulseTimer)
        dot._pulseTimer = setTimeout(() => dot.classList.remove('beat'), 80)
    }

    /**
     * Toggle a chip-level modifier class (e.g. 'midi' for the bpm chip
     * when sourced from MIDI). Multiple modifiers are space-separated.
     */
    setModifier(chipId, modifier, on) {
        const chip = this._chips[chipId]
        if (!chip) return
        chip.classList.toggle(modifier, !!on)
    }

    /** Update a chip's state. */
    set(chipId, { on = false, warn = false, err = false, label = null, icon = null } = {}) {
        const chip = this._chips[chipId]
        if (!chip) return
        chip.classList.toggle('on', !!on)
        chip.classList.toggle('warn', !!warn)
        chip.classList.toggle('err', !!err)
        if (label != null) {
            const lbl = chip.querySelector('.status-chip-label')
            if (lbl) lbl.textContent = label
        }
        if (icon != null) {
            const ic = chip.querySelector('.icon-material')
            if (ic) ic.textContent = icon
        }
    }

    /** Add a custom recording state class. */
    setRecording(rec) {
        const chip = this._chips.recording
        if (!chip) return
        chip.classList.toggle('recording', !!rec)
        const lbl = chip.querySelector('.status-chip-label')
        if (lbl) lbl.textContent = rec ? 'rec' : 'rec'
    }

    _build() {
        this._el = document.createElement('div')
        this._el.className = 'status-row'

        const chipDefs = [
            { id: 'mic',       icon: 'mic',                  label: 'mic' },
            { id: 'midi',      icon: 'piano',                label: 'midi' },
            { id: 'source',    icon: 'videocam',             label: 'source' },
            { id: 'recording', icon: 'fiber_manual_record',  label: 'rec' },
            { id: 'bpm',       icon: 'metronome',            label: '120 bpm' },
            { id: 'fps',       icon: 'speed',                label: '— fps' }
        ]
        for (const def of chipDefs) {
            const chip = document.createElement('span')
            chip.className = 'status-chip'
            chip.dataset.id = def.id
            if (def.id === 'bpm') {
                this._buildBpmChip(chip, def)
            } else {
                chip.innerHTML = `
                    <span class="status-chip-dot"></span>
                    <span class="icon-material">${def.icon}</span>
                    <span class="status-chip-label">${def.label}</span>
                `
                chip.addEventListener('click', () => {
                    const fn = this._hooks[def.id]
                    if (typeof fn === 'function') fn()
                })
            }
            this._el.appendChild(chip)
            this._chips[def.id] = chip
        }
        document.body.appendChild(this._el)
    }

    _buildBpmChip(chip, def) {
        chip.title = 'click to toggle MIDI sync · double-click value to edit · T to tap'
        chip.innerHTML = `
            <span class="status-chip-dot"></span>
            <span class="icon-material">${def.icon}</span>
            <span class="status-chip-bpm-value" title="double-click to edit">120</span>
            <span class="status-chip-bpm-unit">bpm</span>
            <button class="status-chip-bpm-tap" type="button" tabindex="-1"
                    title="press T to tap tempo">Tap<span class="status-chip-bpm-tap-key">(T)</span></button>
        `
        // Anywhere on the chip outside the sub-controls toggles MIDI sync,
        // preserving the existing single-click gesture.
        chip.addEventListener('click', () => {
            const fn = this._hooks[def.id]
            if (typeof fn === 'function') fn()
        })

        const valueEl = chip.querySelector('.status-chip-bpm-value')
        // Eat single-click on the value so it doesn't toggle MIDI; double-click
        // promotes the span to an editable number input.
        valueEl.addEventListener('click', (e) => e.stopPropagation())
        valueEl.addEventListener('dblclick', (e) => {
            e.stopPropagation()
            this._beginBpmEdit()
        })

        const tapBtn = chip.querySelector('.status-chip-bpm-tap')
        tapBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            // Inactive button (editor focused or MIDI mode) is a no-op — its
            // grayed-out look already telegraphs that, but be defensive.
            if (!tapBtn.classList.contains('active')) return
            if (typeof this._bpmTapHandler === 'function') this._bpmTapHandler()
        })
    }

    /**
     * Render the BPM chip from structured state. Replaces the generic
     * `set('bpm', { label })` call, which was lossy now that the chip has
     * a separately-editable value.
     */
    setBpmDisplay({ value, source, midiStatus }) {
        const chip = this._chips.bpm
        if (!chip) return
        const iconEl = chip.querySelector('.icon-material')
        const valueEl = chip.querySelector('.status-chip-bpm-value')
        const unitEl = chip.querySelector('.status-chip-bpm-unit')
        chip.classList.toggle('midi', source === 'midi')
        chip.classList.add('on')
        if (iconEl) iconEl.textContent = source === 'midi' ? 'piano' : 'metronome'
        const showStatus = source === 'midi'
            && midiStatus
            && midiStatus !== 'synced'
            && midiStatus !== 'no-clock'
            && midiStatus !== 'stopped'
        if (showStatus) {
            if (valueEl) valueEl.style.display = 'none'
            if (unitEl) unitEl.textContent = `midi: ${midiStatus}`
        } else {
            // Don't clobber the input element while the user is editing.
            if (valueEl) {
                valueEl.style.display = ''
                valueEl.textContent = String(value)
            }
            if (unitEl) unitEl.textContent = source === 'midi' ? 'midi' : 'bpm'
        }
    }

    /**
     * Mark the on-screen Tap (T) button as visually active or grayed-out.
     * Active means the T-key shortcut would actually fire (no editor focus,
     * manual source) — the button mirrors that state so users can see at a
     * glance whether tapping will register.
     */
    setBpmTapActive(active) {
        const chip = this._chips.bpm
        if (!chip) return
        const btn = chip.querySelector('.status-chip-bpm-tap')
        if (btn) btn.classList.toggle('active', !!active)
    }

    /** Brief color flash on the Tap button so the user gets feedback per tap. */
    flashBpmTap() {
        const chip = this._chips.bpm
        if (!chip) return
        const btn = chip.querySelector('.status-chip-bpm-tap')
        if (!btn) return
        btn.classList.add('flash')
        clearTimeout(btn._flashTimer)
        btn._flashTimer = setTimeout(() => btn.classList.remove('flash'), 180)
    }

    /** Register a callback fired when the user commits a new BPM via edit. */
    onBpmEdit(cb) { this._bpmEditCb = cb }
    /** Register a callback fired when the user clicks the Tap (T) button. */
    onBpmTap(cb) { this._bpmTapHandler = cb }

    _beginBpmEdit() {
        const chip = this._chips.bpm
        if (!chip || chip.classList.contains('midi')) return
        const valueEl = chip.querySelector('.status-chip-bpm-value')
        if (!valueEl) return
        const input = document.createElement('input')
        input.type = 'number'
        input.min = '20'
        input.max = '400'
        input.step = '1'
        input.value = valueEl.textContent
        input.className = 'status-chip-bpm-edit'
        input.addEventListener('click', (e) => e.stopPropagation())
        valueEl.replaceWith(input)
        input.focus()
        input.select()
        let done = false
        const finish = (commit) => {
            if (done) return
            done = true
            const raw = input.value
            // Restore the span first so any onChange-driven re-render
            // triggered by setBpm can update its textContent.
            input.replaceWith(valueEl)
            if (commit) {
                const n = parseFloat(raw)
                if (Number.isFinite(n) && typeof this._bpmEditCb === 'function') {
                    this._bpmEditCb(n)
                }
            }
        }
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true) }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
        })
        input.addEventListener('blur', () => finish(true))
    }

    _loop() {
        const tick = () => {
            this._raf = requestAnimationFrame(tick)
            const fps = Math.round(this._renderer?.currentFPS || 0)
            const fpsLbl = fps ? `${fps} fps` : '— fps'
            const fpsCls = fps && fps < 30 ? 'err' : (fps && fps < 50 ? 'warn' : 'on')
            this.set('fps', { on: fpsCls === 'on', warn: fpsCls === 'warn', err: fpsCls === 'err', label: fpsLbl })
        }
        tick()
    }
}

export const statusRow = new StatusRow()
