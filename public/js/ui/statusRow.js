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

        /* The shared <tempo-bar> component lives in the status row (mounted via
           statusRow.mount). It carries the same chrome as the other chips so it
           reads as part of the row, and is scaled to the row's compact size. */
        .status-row tempo-bar {
            background: rgba(10, 12, 17, 0.72);
            border: 1px solid rgba(255, 255, 255, 0.06);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            padding: 0.1rem 0.5rem;
            border-radius: 999px;
            font-size: 0.6875rem;
            transition: box-shadow 0.18s ease;
        }
        /* Downbeat flash — keeps the BPM indication visually live, replacing the
           old bpm-chip dot pulse. Re-triggered per downbeat from the 'beat'
           event in embed.js. */
        .status-row tempo-bar.tempo-beat {
            box-shadow: 0 0 0 1px rgba(165, 184, 255, 0.55), 0 0 10px rgba(165, 184, 255, 0.35);
        }
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
            { id: 'fps',       icon: 'speed',                label: '— fps' }
        ]
        for (const def of chipDefs) {
            const chip = document.createElement('span')
            chip.className = 'status-chip'
            chip.dataset.id = def.id
            chip.innerHTML = `
                <span class="status-chip-dot"></span>
                <span class="icon-material">${def.icon}</span>
                <span class="status-chip-label">${def.label}</span>
            `
            chip.addEventListener('click', () => {
                const fn = this._hooks[def.id]
                if (typeof fn === 'function') fn()
            })
            this._el.appendChild(chip)
            this._chips[def.id] = chip
        }
        document.body.appendChild(this._el)
    }

    /**
     * Host an arbitrary element inside the status row (used for the shared
     * <tempo-bar> component, which replaces the old bpm chip). Mounted elements
     * sit alongside the chips and inherit the row's show/hide behaviour. They
     * need their own pointer events since the row itself is pointer-transparent.
     */
    mount(el) {
        if (!this._el || !el) return
        el.style.pointerEvents = 'auto'
        this._el.appendChild(el)
        return el
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
