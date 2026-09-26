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
            left: var(--hf-space-3, 0.75rem);
            right: var(--hf-space-3, 0.75rem);
            bottom: var(--hf-space-2, 0.5rem);
            display: flex;
            gap: var(--hf-space-2, 0.5rem);
            justify-content: center;
            align-items: center;
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
            font-size: var(--hf-size-xs, 0.6875rem);
            color: var(--hf-text-normal);
            z-index: 230;
            pointer-events: none;
            transition: opacity var(--hf-transition-fast, 0.2s);
        }
        .status-row.hidden { opacity: 0; pointer-events: none; }
        .status-chip {
            display: inline-flex;
            align-items: center;
            gap: var(--hf-space-1, 0.35rem);
            background: color-mix(in srgb, var(--hf-bg-base, var(--hf-color-1)) 85%, transparent);
            border: 1px solid var(--hf-border-subtle);
            backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            -webkit-backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            padding: var(--hf-space-1, 0.25rem) var(--hf-space-2, 0.55rem);
            border-radius: var(--hf-radius-pill, 999px);
            cursor: pointer;
            pointer-events: auto;
            transition: background var(--hf-transition-fast, 0.15s), border-color var(--hf-transition-fast, 0.15s), color var(--hf-transition-fast, 0.15s);
            user-select: none;
            white-space: nowrap;
        }
        .status-chip:hover {
            background: color-mix(in srgb, var(--hf-accent) 25%, transparent);
            border-color: var(--hf-border-hover);
        }
        .status-chip .icon-material { font-size: 13px; }
        .status-chip-dot {
            width: 6px;
            height: 6px;
            border-radius: var(--hf-radius-full, 50%);
            background: var(--hf-text-muted);
        }
        .status-chip.on .status-chip-dot { background: var(--hf-green); }
        .status-chip.warn .status-chip-dot { background: var(--hf-yellow); }
        .status-chip.err .status-chip-dot { background: var(--hf-red); }
        .status-chip.recording {
            border-color: color-mix(in srgb, var(--hf-red) 40%, transparent);
            color: color-mix(in srgb, var(--hf-red) 60%, var(--hf-text-bright));
        }
        .status-chip.recording .status-chip-dot {
            background: var(--hf-red);
            animation: status-rec-pulse 1.4s infinite;
        }
        @keyframes status-rec-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.45; }
        }

        /* MIDI-driven BPM chip uses an amber accent so it's distinguishable
           from manual at a glance. */
        .status-chip.midi {
            border-color: color-mix(in srgb, var(--hf-yellow) 45%, transparent);
            color: color-mix(in srgb, var(--hf-yellow) 60%, var(--hf-text-bright));
        }
        .status-chip.midi .status-chip-dot { background: var(--hf-yellow); }

        /* The shared <tempo-bar> component lives in the status row (mounted via
           statusRow.mount). It carries the same chrome as the other chips so it
           reads as part of the row, and is scaled to the row's compact size. */
        .status-row tempo-bar {
            background: color-mix(in srgb, var(--hf-bg-base, var(--hf-color-1)) 85%, transparent);
            border: 1px solid var(--hf-border-subtle);
            backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            -webkit-backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            padding: 0.1rem var(--hf-space-2, 0.5rem);
            border-radius: var(--hf-radius-pill, 999px);
            font-size: var(--hf-size-xs, 0.6875rem);
            transition: box-shadow 0.18s ease;
        }
        /* Downbeat flash — keeps the BPM indication visually live, replacing the
           old bpm-chip dot pulse. Re-triggered per downbeat from the 'beat'
           event in embed.js. */
        .status-row tempo-bar.tempo-beat {
            box-shadow:
                0 0 0 1px color-mix(in srgb, var(--hf-accent) 55%, transparent),
                0 0 10px color-mix(in srgb, var(--hf-accent) 35%, transparent);
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
