import { stripMediaUrlArg } from '../noisemaker/dslSanitize.js'

export function surfacesWrittenInDsl(dsl) {
    if (!dsl) return []
    const matches = [...dsl.matchAll(/\.write\s*\(\s*o([0-7])\s*\)/g)]
    const ids = new Set(matches.map(m => parseInt(m[1], 10)))
    return [...ids].sort((a, b) => a - b)
}

export function currentRenderTarget(dsl) {
    if (!dsl) return null
    const matches = [...dsl.matchAll(/(?:^|\n)\s*render\s*\(\s*o([0-7])\s*\)/g)]
    if (!matches.length) return null
    return parseInt(matches[matches.length - 1][1], 10)
}

/**
 * Determine the effective render target surface index (0-7).
 * Reads the explicit target from render(oN) if specified.
 * If absent, falls back to surface 0 if written in the DSL, or the first written surface.
 * Returns null if no surfaces are written and no render call exists.
 *
 * @param {string} dsl - Source DSL
 * @returns {number|null} Surface index (0-7) or null
 */
export function effectiveRenderTarget(dsl) {
    const explicit = currentRenderTarget(dsl)
    if (explicit !== null) return explicit
    const written = surfacesWrittenInDsl(dsl)
    if (written.length === 0) return null
    return written.includes(0) ? 0 : written[0]
}

/**
 * Switch the active render output surface in a DSL program to target index `idx` (0-7).
 * If the DSL contains render(oN) or render(...), replaces it.
 * If the DSL has no render() directive, cleanly appends render(oN).
 * Preserves the rest of the DSL, comments, and structure.
 * Returns original dsl unchanged if idx is invalid (<0, >7, non-integer).
 *
 * @param {string} dsl - Source DSL
 * @param {number} idx - Surface index (0-7)
 * @returns {string} Updated DSL
 */
export function switchOutputSurface(dsl, idx) {
    if (typeof idx !== 'number' || idx < 0 || idx > 7 || !Number.isInteger(idx)) {
        return dsl || ''
    }
    if (!dsl || !dsl.trim()) {
        return `render(o${idx})\n`
    }

    // Check if there is an existing render(o[0-7]) directive
    const renderTargetPattern = /(?:^|\n)([ \t]*)render\s*\(\s*o[0-7]\s*\)/
    if (renderTargetPattern.test(dsl)) {
        return dsl.replace(/(?:^|\n)([ \t]*)render\s*\(\s*o[0-7]\s*\)/g, (match, indent) => {
            const prefix = match.startsWith('\n') ? '\n' : ''
            return `${prefix}${indent}render(o${idx})`
        })
    }

    // Check for general render(...) directive (supports nested parens like render(read(o0)))
    const generalRenderPattern = /(?:^|\n)([ \t]*)render\s*\((?:[^()]|\([^()]*\))*\)/
    if (generalRenderPattern.test(dsl)) {
        return dsl.replace(/(?:^|\n)([ \t]*)render\s*\((?:[^()]|\([^()]*\))*\)/g, (match, indent) => {
            const prefix = match.startsWith('\n') ? '\n' : ''
            return `${prefix}${indent}render(o${idx})`
        })
    }

    // No render() directive present - append cleanly to end
    const trimmed = dsl.trimEnd()
    return `${trimmed}\n\nrender(o${idx})\n`
}

const SHADER_BASE_PATH = 'https://shaders.noisedeck.app/1'
const SHADER_BUNDLE_PATH = `${SHADER_BASE_PATH}/effects`

let _bundlePromise = null
function loadBundle() {
    if (!_bundlePromise) _bundlePromise = import('../noisemaker/bundle.js')
    return _bundlePromise
}

const STYLES_ID = 'output-picker-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
    const s = document.createElement('style')
    s.id = STYLES_ID
    s.textContent = `
        .output-picker {
            position: fixed;
            top: var(--hf-spacing-md, 1rem);
            right: var(--hf-spacing-md, 1rem);
            display: none;
            flex-direction: column;
            gap: var(--hf-spacing-xs, 0.4rem);
            z-index: var(--hf-z-panel, 210);
        }
        .output-picker.visible { display: flex; }
        body.live-inputs-open .output-picker { right: calc(280px + var(--hf-spacing-xl, 2rem)); }
        .output-pip {
            position: relative;
            width: 96px;
            height: 54px;
            border: 1px solid var(--hf-border-subtle);
            border-radius: var(--hf-radius-md, 6px);
            overflow: hidden;
            cursor: pointer;
            background: var(--hf-bg-surface);
            transition: border-color var(--hf-transition-fast, 0.15s ease), transform var(--hf-transition-fast, 0.15s ease), box-shadow var(--hf-transition-fast, 0.15s ease);
            user-select: none;
        }
        .output-pip:hover {
            border-color: var(--hf-accent-3);
            transform: translateY(-1px);
        }
        .output-pip:focus-visible {
            outline: none;
            border-color: var(--hf-accent-3);
            box-shadow: 0 0 0 2px var(--hf-accent-3);
        }
        .output-pip.active {
            border-color: var(--hf-accent-3);
            box-shadow: 0 0 0 1px var(--hf-accent-3);
        }
        .output-pip canvas, .output-pip img {
            width: 100%; height: 100%; display: block; object-fit: cover;
        }
        .output-pip-label {
            position: absolute; left: 4px; bottom: 2px;
            font-family: var(--hf-font-mono, 'Noto Sans Mono', monospace);
            font-size: var(--hf-font-size-xs, 0.625rem);
            font-weight: 600;
            line-height: 1;
            color: var(--hf-text-bright);
            background: color-mix(in srgb, var(--hf-bg-surface) 75%, transparent);
            padding: 0.05rem 0.3rem;
            border-radius: var(--hf-radius-sm, 3px);
            pointer-events: none;
        }
    `
    document.head.appendChild(s)
}

const ENABLED_KEY = 'polymorphic-output-picker'

class OutputPicker {
    constructor() {
        this._el = null
        this._dsl = ''
        this._activeSurface = null
        this._previews = new Map()  // surface index -> { canvas, renderer, pip }
        this._onSwitch = () => {}
        let stored = '0'
        try {
            if (typeof localStorage !== 'undefined') stored = localStorage.getItem(ENABLED_KEY) || '0'
        } catch {}
        this._userEnabled = stored === '1'
    }

    init(opts) {
        this._onSwitch = opts.onSwitch || (() => {})
        if (typeof document === 'undefined') return
        if (this._el) return
        this._el = document.createElement('div')
        this._el.className = 'output-picker'
        document.body.appendChild(this._el)
    }

    isEnabled() { return this._userEnabled }

    setEnabled(on) {
        this._userEnabled = !!on
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(ENABLED_KEY, this._userEnabled ? '1' : '0')
        } catch {}
        if (!this._userEnabled) {
            // Stop the hidden preview loops right away rather than waiting for
            // any in-flight pip build to finish; the queued step below then
            // disposes them and drops their pips.
            for (const [, entry] of this._previews) {
                try { entry.renderer?.stop() } catch {}
            }
        }
        this._refreshVisibility()
        // Serialize through the same single-flight queue as setDsl so a disable
        // cannot race an in-flight pip build: the queued step disposes the
        // hidden preview renderers when the picker turns off and recreates
        // previews for the current surfaces when it turns back on.
        this._pending = (this._pending || Promise.resolve())
            .then(() => this._applyEnabled())
            .catch(err => console.debug('[OutputPicker] setEnabled chain:', err))
        return this._userEnabled
    }

    async _applyEnabled() {
        if (this._userEnabled) {
            await this._setDslImpl(this._dsl)
        } else {
            await this._disposePreviews()
        }
    }

    toggle() { return this.setEnabled(!this._userEnabled) }

    _refreshVisibility() {
        if (!this._el) return
        const surfaces = surfacesWrittenInDsl(this._dsl)
        this._el.classList.toggle('visible', this._userEnabled && surfaces.length > 0)
    }

    /**
     * Update the picker to reflect a new DSL: rebuild pips for every surface
     * the program writes to, mark the active one, dispose any pip whose
     * surface is no longer written.
     *
     * Serialized via a single-flight queue so overlapping calls from multiple
     * compile hot paths can't race on _previews / DOM mutations across awaits.
     */
    async setDsl(dsl) {
        this._pending = (this._pending || Promise.resolve())
            .then(() => this._setDslImpl(dsl))
            .catch(err => console.debug('[OutputPicker] setDsl chain:', err))
        return this._pending
    }

    async _setDslImpl(dsl) {
        this._dsl = dsl
        const surfaces = surfacesWrittenInDsl(dsl)
        this._activeSurface = effectiveRenderTarget(dsl)
        // Drop pips for surfaces no longer in use — or all of them when the
        // picker is disabled, so no hidden preview renderer keeps rendering
        for (const idx of [...this._previews.keys()]) {
            if (!this._userEnabled || !surfaces.includes(idx)) {
                const p = this._previews.get(idx)
                try { await p.renderer?.dispose({ loseContext: true }) } catch {}
                p.pip?.remove()
                this._previews.delete(idx)
            }
        }
        // Add pips for new surfaces only while the picker is enabled; a
        // disabled picker must not build hidden renderers at all
        if (this._userEnabled) {
            for (const idx of surfaces) {
                if (this._previews.has(idx)) continue
                const entry = await this._createPip(idx)
                if (!this._userEnabled) {
                    // The picker was disabled while this pip built: never
                    // install or start it
                    try { await entry.renderer?.dispose({ loseContext: true }) } catch {}
                    entry.pip?.remove()
                    continue
                }
                this._previews.set(idx, entry)
            }
        }
        // Re-sort DOM order to match surface index
        for (const idx of surfaces) {
            const entry = this._previews.get(idx)
            if (this._el && entry?.pip) this._el.appendChild(entry.pip)
        }
        // Mark the active pip
        for (const [idx, entry] of this._previews) {
            const isActive = idx === this._activeSurface
            entry.pip.classList.toggle('active', isActive)
            entry.pip.setAttribute('aria-label', `Surface o${idx}` + (isActive ? ' (active)' : ''))
        }
        // Hidden by default; user toggles via View menu (persisted in localStorage)
        this._el?.classList.toggle('visible', this._userEnabled && surfaces.length > 0)
    }

    /** Dispose every live preview renderer and its pip element. */
    async _disposePreviews() {
        for (const [, entry] of this._previews) {
            try { await entry.renderer?.dispose({ loseContext: true }) } catch {}
            entry.pip?.remove()
        }
        this._previews.clear()
    }

    async _createPip(idx) {
        const { CanvasRenderer, extractEffectNamesFromDsl } = await loadBundle()
        const pip = document.createElement('div')
        pip.className = 'output-pip'
        pip.dataset.surface = String(idx)
        pip.setAttribute('role', 'button')
        pip.tabIndex = 0
        pip.title = `Switch to o${idx} (Shift+click to reset feedback)`
        pip.setAttribute('aria-label', `Surface o${idx}` + (idx === this._activeSurface ? ' (active)' : ''))
        const canvas = document.createElement('canvas')
        canvas.width = 192
        canvas.height = 108
        pip.appendChild(canvas)
        const label = document.createElement('span')
        label.className = 'output-pip-label'
        label.textContent = `o${idx}`
        pip.appendChild(label)

        const triggerSwitch = (e) => {
            const resetFeedback = Boolean(e?.shiftKey || e?.altKey)
            this._onSwitch(idx, { resetFeedback })
        }

        pip.addEventListener('click', (e) => triggerSwitch(e))
        pip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                triggerSwitch(e)
            }
        })
        // Render the surface in isolation: rewrite the DSL so render() points at this
        // surface, and strip media() urls the engine rejects (matches the main renderer).
        const surfaceDsl = stripMediaUrlArg(switchOutputSurface(this._dsl, idx))
        let renderer = null
        try {
            renderer = new CanvasRenderer({
                canvas,
                width: canvas.width,
                height: canvas.height,
                basePath: SHADER_BASE_PATH,
                preferWebGPU: false,
                useBundles: true,
                bundlePath: SHADER_BUNDLE_PATH,
                onError: () => {}
            })
            await renderer.loadManifest()
            const effects = extractEffectNamesFromDsl(surfaceDsl, renderer.manifest || {})
            const ids = effects.map(e => e.effectId)
            if (ids.length > 0) await renderer.loadEffects(ids)
            await renderer.compile(surfaceDsl)
            // A disable that landed while this pip compiled must never see its
            // loop start; the caller drops the whole entry instead.
            if (this._userEnabled) renderer.start()
        } catch (err) {
            console.debug('[OutputPicker] pip compile failed:', err?.message || err)
            if (renderer) {
                try { await renderer.dispose({ loseContext: true }) } catch {}
            }
            renderer = null
        }
        return { pip, canvas, renderer }
    }

    /**
     * Programmatically switch the active render output surface.
     * @param {number} idx - Surface index (0-7)
     * @param {object} [options={}] - Options (e.g. { resetFeedback: boolean })
     */
    switchSurface(idx, options = {}) {
        this._onSwitch(idx, options)
    }

    async dispose() {
        this._pending = null
        await this._disposePreviews()
        this._el?.remove()
        this._el = null
    }
}

export const outputPicker = new OutputPicker()
