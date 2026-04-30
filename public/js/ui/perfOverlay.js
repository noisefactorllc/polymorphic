/**
 * Performance Overlay
 *
 * Toggleable HUD showing FPS, frame time, jitter, render passes, backend,
 * resolution, and a small frame-time graph. Targets the bottom-right corner
 * so it doesn't fight with the editor (top-left) or panels (right side).
 */

const STYLES_ID = 'perf-overlay-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .perf-overlay {
            position: fixed;
            right: 0.75rem;
            bottom: 0.75rem;
            background: rgba(10, 12, 17, 0.85);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            color: #d9deeb;
            padding: 0.45rem 0.65rem;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.6875rem;
            line-height: 1.4;
            z-index: 220;
            display: none;
            min-width: 170px;
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }
        .perf-overlay.visible { display: block; }
        .perf-row {
            display: flex;
            justify-content: space-between;
            gap: 0.65rem;
        }
        .perf-row .label {
            color: #888;
        }
        .perf-row .value {
            color: #fff;
        }
        .perf-row .value.warn { color: #facc15; }
        .perf-row .value.bad { color: #ff6b6b; }
        .perf-graph {
            display: flex;
            align-items: flex-end;
            gap: 1px;
            height: 24px;
            margin-top: 0.3rem;
        }
        .perf-graph-bar {
            flex: 1;
            background: rgba(165,184,255,0.5);
            border-radius: 1px 1px 0 0;
            min-height: 1px;
        }
        .perf-graph-bar.over { background: #ff6b6b; }
        .perf-graph-bar.warn { background: #facc15; }
        body.live-inputs-open .perf-overlay {
            right: calc(280px + 1em + 0.75rem);
        }
    `
    document.head.appendChild(style)
}

class PerfOverlay {
    constructor() {
        this._el = null
        this._open = false
        this._renderer = null
        this._canvas = null
        this._raf = null
        this._lastSampleTime = 0
        this._frameTimes = new Float32Array(60)
        this._frameTimesIdx = 0
        this._frameTimesCount = 0
        this._lastFrameStart = 0
        this._domRefs = {}
    }

    init(opts) {
        this._renderer = opts.renderer
        this._canvas = opts.canvas
        this._build()
    }

    _build() {
        this._el = document.createElement('div')
        this._el.className = 'perf-overlay'
        this._el.innerHTML = `
            <div class="perf-row"><span class="label">fps</span><span class="value" data-id="fps">—</span></div>
            <div class="perf-row"><span class="label">frame</span><span class="value" data-id="frame">—</span></div>
            <div class="perf-row"><span class="label">jitter</span><span class="value" data-id="jitter">—</span></div>
            <div class="perf-row"><span class="label">passes</span><span class="value" data-id="passes">—</span></div>
            <div class="perf-row"><span class="label">backend</span><span class="value" data-id="backend">—</span></div>
            <div class="perf-row"><span class="label">resolution</span><span class="value" data-id="res">—</span></div>
            <div class="perf-graph" data-id="graph"></div>
        `
        document.body.appendChild(this._el)
        for (const id of ['fps','frame','jitter','passes','backend','res','graph']) {
            this._domRefs[id] = this._el.querySelector(`[data-id=${id}]`)
        }
        // Pre-build graph bars
        for (let i = 0; i < this._frameTimes.length; i++) {
            const bar = document.createElement('div')
            bar.className = 'perf-graph-bar'
            bar.style.height = '1px'
            this._domRefs.graph.appendChild(bar)
        }
    }

    open() {
        if (this._open) return
        this._open = true
        this._el?.classList.add('visible')
        // Reset the frame-time graph so it starts from a clean state instead of
        // showing whatever stale buffer was left from the previous session.
        this._frameTimes.fill(0)
        this._frameTimesIdx = 0
        this._frameTimesCount = 0
        this._lastFrameStart = 0
        this._lastSampleTime = 0
        this._loop()
    }

    close() {
        if (!this._open) return
        this._open = false
        this._el?.classList.remove('visible')
        if (this._raf) cancelAnimationFrame(this._raf)
        this._raf = null
    }

    toggle() { this._open ? this.close() : this.open() }
    isOpen() { return this._open }

    _loop() {
        const now = performance.now()
        if (this._lastFrameStart > 0) {
            const dt = now - this._lastFrameStart
            this._frameTimes[this._frameTimesIdx] = dt
            this._frameTimesIdx = (this._frameTimesIdx + 1) % this._frameTimes.length
            this._frameTimesCount = Math.min(this._frameTimesCount + 1, this._frameTimes.length)
        }
        this._lastFrameStart = now

        // Update display every ~250ms
        if (now - this._lastSampleTime > 250) {
            this._lastSampleTime = now
            this._render()
        }
        this._raf = requestAnimationFrame(() => this._loop())
    }

    _render() {
        const r = this._renderer
        const fps = Math.round(r?.currentFPS || 0)
        const stats = r?.getFrameTimeStats?.()
        const lastRender = r?.lastRenderTime || 0
        const passes = r?.lastPassCount || 0
        const backend = r?.backend || '—'
        const w = this._canvas?.width || 0
        const h = this._canvas?.height || 0

        this._setVal('fps', fps + ' Hz', fps < 30 ? 'bad' : fps < 50 ? 'warn' : '')
        this._setVal('frame', `${lastRender.toFixed(1)} ms`,
            lastRender > 33 ? 'bad' : lastRender > 16 ? 'warn' : '')
        const std = (stats?.std ?? 0).toFixed(2)
        this._setVal('jitter', `±${std} ms`, parseFloat(std) > 5 ? 'warn' : '')
        this._setVal('passes', String(passes))
        this._setVal('backend', backend)
        this._setVal('res', `${w}×${h}`)

        // Graph: render frame deltas in this._frameTimes
        const bars = this._domRefs.graph.querySelectorAll('.perf-graph-bar')
        const target = 16.7
        for (let i = 0; i < bars.length; i++) {
            // Walk in temporal order: oldest at left
            const idx = (this._frameTimesIdx + i) % this._frameTimes.length
            const v = this._frameTimes[idx]
            const ratio = Math.min(1, v / 50) // cap at 50ms
            const pixel = Math.max(1, Math.round(ratio * 24))
            const bar = bars[i]
            bar.style.height = pixel + 'px'
            bar.classList.toggle('over', v > 33)
            bar.classList.toggle('warn', v > target * 1.5 && v <= 33)
        }
    }

    _setVal(id, text, cls = '') {
        const el = this._domRefs[id]
        if (!el) return
        el.textContent = text
        el.className = 'value' + (cls ? ' ' + cls : '')
    }
}

export const perfOverlay = new PerfOverlay()
