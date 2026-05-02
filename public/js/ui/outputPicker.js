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
            top: 1rem;
            right: 1rem;
            display: none;
            flex-direction: column;
            gap: 0.4rem;
            z-index: 210;
        }
        .output-picker.visible { display: flex; }
        body.live-inputs-open .output-picker { right: calc(280px + 2rem); }
        .output-pip {
            position: relative;
            width: 96px;
            height: 54px;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            overflow: hidden;
            cursor: pointer;
            background: #000;
            transition: border-color 0.15s, transform 0.15s;
        }
        .output-pip:hover { border-color: rgba(165,184,255,0.5); transform: translateY(-1px); }
        .output-pip.active { border-color: #a5b8ff; box-shadow: 0 0 0 1px rgba(165,184,255,0.6); }
        .output-pip canvas, .output-pip img {
            width: 100%; height: 100%; display: block; object-fit: cover;
        }
        .output-pip-label {
            position: absolute; left: 4px; bottom: 2px;
            font: 600 0.625rem/1 'Noto Sans Mono', monospace;
            color: #fff; background: rgba(0,0,0,0.55);
            padding: 0.05rem 0.3rem; border-radius: 3px;
        }
    `
    document.head.appendChild(s)
}

class OutputPicker {
    constructor() {
        this._el = null
        this._open = false
        this._dsl = ''
        this._activeSurface = null
        this._previews = new Map()  // surface index -> { canvas, renderer, pip }
        this._onSwitch = () => {}
    }

    init(opts) {
        this._onSwitch = opts.onSwitch || (() => {})
        if (this._el) return
        this._el = document.createElement('div')
        this._el.className = 'output-picker'
        document.body.appendChild(this._el)
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
        this._activeSurface = currentRenderTarget(dsl)
        // Drop pips for surfaces no longer in use
        for (const idx of [...this._previews.keys()]) {
            if (!surfaces.includes(idx)) {
                const p = this._previews.get(idx)
                try { await p.renderer?.dispose({ loseContext: true }) } catch {}
                p.pip?.remove()
                this._previews.delete(idx)
            }
        }
        // Add pips for new surfaces
        for (const idx of surfaces) {
            if (!this._previews.has(idx)) {
                this._previews.set(idx, await this._createPip(idx))
            }
        }
        // Re-sort DOM order to match surface index
        for (const idx of surfaces) {
            const entry = this._previews.get(idx)
            if (entry?.pip) this._el.appendChild(entry.pip)
        }
        // Mark the active pip
        for (const [idx, entry] of this._previews) {
            entry.pip.classList.toggle('active', idx === this._activeSurface)
        }
        // Toggle visibility — hide entirely if 0 or 1 surface (single-output sketches don't need a picker)
        this._el.classList.toggle('visible', surfaces.length > 1)
    }

    async _createPip(idx) {
        const { CanvasRenderer, extractEffectNamesFromDsl } = await loadBundle()
        const pip = document.createElement('div')
        pip.className = 'output-pip'
        pip.dataset.surface = String(idx)
        const canvas = document.createElement('canvas')
        canvas.width = 192
        canvas.height = 108
        pip.appendChild(canvas)
        const label = document.createElement('span')
        label.className = 'output-pip-label'
        label.textContent = `o${idx}`
        pip.appendChild(label)
        pip.addEventListener('click', () => this._onSwitch(idx))
        // Render the surface in isolation: rewrite the DSL so render() points at this surface
        const surfaceDsl = this._dsl.replace(/render\s*\(\s*o[0-7]\s*\)/g, `render(o${idx})`)
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
            renderer.start()
        } catch (err) {
            console.debug('[OutputPicker] pip compile failed:', err?.message || err)
            if (renderer) {
                try { await renderer.dispose({ loseContext: true }) } catch {}
            }
            renderer = null
        }
        return { pip, canvas, renderer }
    }

    async dispose() {
        for (const [, entry] of this._previews) {
            try { await entry.renderer?.dispose({ loseContext: true }) } catch {}
            entry.pip?.remove()
        }
        this._previews.clear()
        this._el?.remove()
        this._el = null
    }
}

export const outputPicker = new OutputPicker()
