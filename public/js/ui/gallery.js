/**
 * Program Browser
 *
 * Modal browser for example programs and community-published compositions.
 * Three tabs:
 *
 *   - Curated            — static /data/examples.json roster shipped with the app.
 *   - Noisedeck Examples — live JSON listing from shuffleset's product-examples
 *                          gallery; .dsl files fetched on click.
 *   - NoiseBLASTER       — live feed pulled from blaster.noisedeck.app/api/feed,
 *                          showing the latest published compositions across the
 *                          Noisemaker ecosystem. These are ephemeral and rotate
 *                          daily; clicking a card resolves the composition via
 *                          sharing.noisedeck.app and loads it into the editor.
 *
 * On a fresh visit (no ?dsl, no ?code), we boot a random Curated example so
 * the landing page feels welcoming.
 */

import { loadFromCode } from '../sharingLoader.js'
import { CanvasRenderer, extractEffectNamesFromDsl } from '../noisemaker/bundle.js'
import { stripMediaUrlArg } from '../noisemaker/dslSanitize.js'
import {
    loadNoisedeckExamples,
    fetchNoisedeckExampleSource,
} from './noisedeckExamples.js'
import { registerEscapeable, unregisterEscapeable } from 'handfish'

const STYLES_ID = 'gallery-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .gallery-overlay {
            position: fixed; inset: 0;
            background: var(--hf-backdrop, color-mix(in srgb, var(--hf-color-1, black) 62%, transparent));
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 5000;
            display: none;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .gallery-overlay.visible {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 5vh 1rem 2rem;
            opacity: 1;
            overflow-y: auto;
        }
        .gallery-modal {
            background: color-mix(in srgb, var(--hf-bg-surface, var(--hf-color-2)) var(--hf-surface-opacity, 96%), transparent);
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            border-radius: var(--hf-radius-lg, 14px);
            box-shadow: var(--hf-shadow-xl);
            width: min(900px, calc(100vw - 2rem));
            max-height: calc(100vh - 5vh - 2rem);
            display: flex;
            flex-direction: column;
            color: var(--hf-text-normal, var(--hf-color-6));
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            overflow: hidden;
        }
        .gallery-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.85rem 1.1rem 0;
            border-bottom: 1px solid var(--hf-border-subtle, var(--hf-color-4));
        }
        .gallery-title {
            font-size: 1rem;
            font-weight: 700;
            color: var(--hf-text-bright, var(--hf-color-7));
            font-family: 'Comfortaa', 'Comfortaa Block', sans-serif;
            padding-bottom: 0.85rem;
        }
        .gallery-actions { display: flex; gap: 0.4rem; padding-bottom: 0.6rem; }
        .gallery-btn {
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 18%, transparent);
            border: 1px solid color-mix(in srgb, var(--hf-accent, var(--accent3)) 35%, transparent);
            color: var(--hf-text-bright, var(--hf-color-7));
            font-family: inherit;
            font-size: 0.75rem;
            padding: 0.35rem 0.7rem;
            border-radius: var(--hf-radius-md, 6px);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            transition: all var(--hf-transition, 0.15s ease), transform var(--hf-transition-fast, 0.1s ease);
        }
        .gallery-btn:hover { background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 32%, transparent); }
        .gallery-btn:focus-visible {
            outline: var(--hf-focus-ring-width, 2px) solid var(--hf-focus-ring-color, var(--hf-accent));
            outline-offset: var(--hf-focus-ring-offset, 2px);
        }
        .gallery-btn:active { transform: scale(0.97); }
        .gallery-btn .icon-material { font-size: 16px; }
        .gallery-close {
            background: transparent; border: none; color: var(--hf-text-dim, var(--hf-color-5)); cursor: pointer;
            padding: 0.2em 0.5em; font-size: 1.2rem;
            min-width: 24px; min-height: 24px;
            display: inline-flex; align-items: center; justify-content: center;
            border-radius: var(--hf-radius-sm, 4px);
            transition: color var(--hf-transition, 0.15s ease), background var(--hf-transition, 0.15s ease), transform var(--hf-transition-fast, 0.1s ease);
        }
        .gallery-close:hover {
            color: var(--hf-text-bright, var(--hf-color-7));
            background: color-mix(in srgb, var(--hf-text-bright, var(--hf-color-7)) 10%, transparent);
        }
        .gallery-close:focus-visible {
            outline: var(--hf-focus-ring-width, 2px) solid var(--hf-focus-ring-color, var(--hf-accent));
            outline-offset: var(--hf-focus-ring-offset, 2px);
        }
        .gallery-close:active {
            transform: scale(0.95);
        }

        /* Tab strip */
        .gallery-tabs {
            display: flex;
            gap: 0.25rem;
            padding: 0 1.1rem;
            margin-top: -0.4rem;
            border-bottom: 1px solid var(--hf-border-subtle, var(--hf-color-4));
        }
        .gallery-tab {
            background: transparent;
            border: none;
            color: var(--hf-text-dim, var(--hf-color-5));
            font-family: inherit;
            font-size: 0.8125rem;
            padding: 0.5rem 0.85rem;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
        }
        .gallery-tab:hover { color: var(--hf-text-bright, var(--hf-color-7)); }
        .gallery-tab.active {
            color: var(--hf-text-bright, var(--hf-color-7));
            border-bottom-color: var(--hf-accent, var(--accent3));
        }

        .gallery-body {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 0.85rem;
            padding: 1.1rem;
        }
        .gallery-empty,
        .gallery-loading {
            padding: 3rem 1rem;
            text-align: center;
            color: var(--hf-text-muted, var(--hf-color-4));
            font-size: 0.875rem;
        }
        .gallery-error {
            padding: 1rem 1.1rem;
            margin: 1rem 1.1rem;
            background: color-mix(in srgb, var(--hf-red) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--hf-red) 30%, transparent);
            border-radius: var(--hf-radius-md, 6px);
            color: var(--hf-red);
            font-size: 0.8125rem;
        }
        .gallery-card {
            background: var(--hf-bg-elevated, var(--hf-color-3));
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            border-radius: var(--hf-radius, 10px);
            cursor: pointer;
            transition: all 0.18s;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .gallery-card:hover {
            border-color: var(--hf-accent, var(--accent3));
            transform: translateY(-2px);
            box-shadow: var(--hf-shadow-lg);
        }
        .gallery-card.loading {
            opacity: 0.5;
            pointer-events: none;
        }
        .gallery-card-thumb {
            aspect-ratio: 16 / 9;
            background: var(--hf-bg-base);
            position: relative;
            overflow: hidden;
        }
        .gallery-card-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .gallery-card-preview-canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
        .gallery-card-thumb-fallback {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--hf-text-muted, var(--hf-color-4));
            font-size: 0.75rem;
            background: color-mix(in srgb, var(--hf-bg-base) 80%, transparent);
        }
        .gallery-card-body {
            padding: 0.65rem 0.85rem 0.85rem;
        }
        .gallery-card-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--hf-text-bright, var(--hf-color-7));
            margin-bottom: 0.15rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .gallery-card-tagline {
            font-size: 0.75rem;
            color: var(--hf-text-dim, var(--hf-color-5));
            line-height: 1.4;
        }
        .gallery-card-meta {
            font-size: 0.6875rem;
            color: var(--hf-text-muted, var(--hf-color-4));
            display: flex;
            gap: 0.4rem;
            align-items: center;
            margin-top: 0.25rem;
        }
        .gallery-card-meta-app {
            color: var(--hf-accent, var(--accent3));
            text-transform: lowercase;
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 10%, transparent);
            padding: 0.05rem 0.4rem;
            border-radius: var(--hf-radius-sm, 3px);
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
        }
        .gallery-card-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem;
            margin-top: 0.35rem;
        }
        .gallery-card-tag {
            font-size: 0.6rem;
            color: var(--hf-accent, var(--accent3));
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 10%, transparent);
            padding: 0.1rem 0.4rem;
            border-radius: var(--hf-radius-sm, 3px);
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
    `
    document.head.appendChild(style)
}

const BLASTER_FEED_URL = 'https://blaster.noisedeck.app/api/feed'
const SHADER_BASE_PATH = 'https://shaders.noisedeck.app/1'
const SHADER_BUNDLE_PATH = `${SHADER_BASE_PATH}/effects`

// Caps on simultaneous live preview renderers — each one consumes a WebGL
// context (browsers cap at ~16) so we visibility-gate cards to keep the
// active set small. Cards that scroll out of view release their context
// and reacquire when they come back.
const PREVIEW_MAX_LIVE = 8

// Cards animate only while the user is hovering (mouse) or long-pressing
// (touch). Long-press threshold is the standard 500ms; if the finger
// drifts past the tolerance before the timer fires, treat it as a scroll
// and cancel.
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

/**
 * Live mini-preview of a Noisemaker DSL program rendered into a small
 * canvas inside a gallery card. Mirrors shuffleset's NoisemakerRenderer
 * pattern: per-canvas CanvasRenderer instance, compile DSL, start loop.
 *
 * Activation is gated on hover (mouse) and long-press (touch); a brief
 * one-shot warm-up runs when the card first scrolls into view to capture
 * a still snapshot for the default thumbnail. The IntersectionObserver
 * also tears down any active preview when a card scrolls off so we stay
 * under the browser's WebGL context cap.
 */
class LivePreview {
    constructor(canvas, dsl, opts = {}) {
        this._canvas = canvas
        this._dsl = dsl
        this._opts = opts
        this._renderer = null
        this._ready = false
        this._disposed = false
        this._error = null
    }

    async start() {
        if (this._renderer || this._disposed) return
        this._renderer = new CanvasRenderer({
            canvas: this._canvas,
            width: this._canvas.width,
            height: this._canvas.height,
            basePath: SHADER_BASE_PATH,
            preferWebGPU: false,
            useBundles: true,
            bundlePath: SHADER_BUNDLE_PATH,
            // Card previews are noisy when a single sketch errors — log
            // quietly so the user isn't spammed if a feed entry is broken.
            onError: (err) => {
                this._error = err
                this._opts.onError?.(err)
            }
        })
        try {
            await this._renderer.loadManifest()
            // Strip media() urls the engine rejects (matches the main renderer).
            const engineDsl = stripMediaUrlArg(this._dsl)
            const effects = extractEffectNamesFromDsl(engineDsl, this._renderer.manifest || {})
            const ids = effects.map(e => e.effectId)
            if (ids.length > 0) await this._renderer.loadEffects(ids)
            await this._renderer.compile(engineDsl)
            if (this._disposed) return
            this._renderer.start()
            this._ready = true
        } catch (err) {
            this._error = err
            this._opts.onError?.(err)
        }
    }

    async dispose() {
        this._disposed = true
        if (!this._renderer) return
        try {
            this._renderer.stop()
            await this._renderer.dispose({ loseContext: true })
        } catch { /* ignore */ }
        this._renderer = null
        this._ready = false
    }

    get error() { return this._error }
}

let cachedExamples = null
let cachedBlasterFeed = null
let cachedBlasterFetchedAt = 0
const BLASTER_CACHE_MS = 60_000  // refetch on re-open if older than 1 minute

/**
 * Load examples.json (cached after first call).
 */
export async function loadExamples() {
    if (cachedExamples) return cachedExamples
    try {
        const res = await fetch('/data/examples.json', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        cachedExamples = await res.json()
    } catch (err) {
        console.warn('[Gallery] Failed to load examples.json:', err)
        cachedExamples = []
    }
    return cachedExamples
}

/** @returns {Promise<{title:string, dsl:string} | null>} */
export async function pickRandomExample() {
    const list = await loadExamples()
    if (!list.length) return null
    return list[Math.floor(Math.random() * list.length)]
}

/**
 * Fetch the NoiseBLASTER global feed. Cached for BLASTER_CACHE_MS so
 * re-opening the modal doesn't hammer the API but a fresh open after a
 * minute pulls new entries.
 */
async function loadBlasterFeed({ force = false } = {}) {
    const stale = (Date.now() - cachedBlasterFetchedAt) > BLASTER_CACHE_MS
    if (cachedBlasterFeed && !force && !stale) return cachedBlasterFeed
    const res = await fetch(`${BLASTER_FEED_URL}?page=0&limit=250`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Blaster feed HTTP ${res.status}`)
    const data = await res.json()
    cachedBlasterFeed = data?.compositions || []
    cachedBlasterFetchedAt = Date.now()
    return cachedBlasterFeed
}

class Gallery {
    constructor() {
        this._overlay = null
        this._open = false
        this._onLoad = () => {}
        this._activeTab = 'curated'  // 'curated' | 'noisedeck-examples' | 'blaster'
        // Live preview bookkeeping. Cards get a LivePreview instance only
        // while the user hovers or long-presses; a one-shot warm-up render
        // on first viewport entry captures a still snapshot. Capped at
        // PREVIEW_MAX_LIVE simultaneous renderers to stay under the
        // browser's WebGL context limit.
        this._previewsByCard = new Map()
        this._observer = null
        this._activeCards = []  // most-recently-visible first (LRU eviction)
    }

    /** @param {object} opts @param {(example:object) => void} opts.onLoad */
    init(opts) {
        this._onLoad = opts.onLoad || (() => {})
    }

    async open() {
        if (this._open) return
        this._open = true
        this._build()
        this._overlay.classList.add('visible')
        await this._renderTab(this._activeTab)
    }

    close() {
        if (!this._open) return
        this._open = false
        if (this._overlay) {
            unregisterEscapeable(this._overlay)
            this._overlay.classList.remove('visible')
        }
        const ov = this._overlay
        setTimeout(() => ov?.remove(), 200)
        this._overlay = null
        // Tear down all live previews so we release WebGL contexts and rAF
        // loops. dispose() is async but we don't need to await it.
        this._teardownPreviews()
    }

    isOpen() { return this._open }

    _teardownPreviews() {
        if (this._observer) {
            this._observer.disconnect()
            this._observer = null
        }
        for (const entry of this._previewsByCard.values()) {
            entry.preview?.dispose?.()
        }
        this._previewsByCard.clear()
        this._activeCards = []
    }

    /**
     * Register a card so a live preview spins up while the user hovers
     * (mouse) or long-presses (touch). The IntersectionObserver runs a
     * one-shot warm-up render on first viewport entry to capture a still
     * snapshot, then tears down any active preview if the card scrolls
     * off so we stay under the browser's WebGL context cap.
     *
     * The canvas is *not* persistent — every activation creates a brand-new
     * <canvas> element inside the supplied thumb container, and every
     * deactivation snapshots its pixels to a placeholder <img> and removes
     * the canvas. This is necessary because dispose({ loseContext: true })
     * leaves the canvas in a broken state (browsers paint a placeholder
     * "broken canvas" icon over it) and the same canvas can't reliably be
     * reused for a second WebGL context.
     *
     * @param {HTMLElement} card             - the card root, observed for visibility
     * @param {HTMLElement} thumbContainer   - the slot inside the card that hosts the canvas/img
     * @param {string} dsl                   - the DSL to compile
     * @param {object} [opts]
     * @param {boolean} [opts.absolute=false] - canvas/snapshot stack absolutely
     *                                          inside the container (used by
     *                                          blaster cards layered over a
     *                                          screenshot); also skips warm-up
     *                                          since the underlying screenshot
     *                                          already serves as the still
     */
    _registerPreview(card, thumbContainer, dsl, opts = {}) {
        if (!card || !thumbContainer || !dsl) return
        this._previewsByCard.set(card, {
            dsl,
            thumbContainer,
            preview: null,
            canvas: null,
            snapshotImg: null,
            absolute: !!opts.absolute,
            // Blaster cards already show a static screenshot underneath, so
            // they don't need a one-shot warm-up render to populate a still
            // thumbnail — the screenshot serves that role until hover.
            skipWarmUp: !!opts.absolute,
            warmedUp: false,
            hovered: false,
            longPressed: false,
        })
        // Animation is now driven by hover/long-press, not visibility. The
        // observer's only jobs are to (a) trigger a one-time warm-up render
        // so curated/noisedeck cards have a still thumbnail to show, and
        // (b) tear down any active live preview if the card scrolls off.
        if (!this._observer) {
            this._observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        this._warmUpPreview(entry.target)
                    } else {
                        const e = this._previewsByCard.get(entry.target)
                        if (e?.preview) this._deactivatePreview(entry.target)
                    }
                }
            }, { root: null, threshold: 0.1 })
        }
        this._observer.observe(card)
        this._bindInteractionHandlers(card)
    }

    /**
     * Wire mouse-hover and touch-long-press listeners on a card so the
     * live preview only spins up while the user is actively interacting.
     */
    _bindInteractionHandlers(card) {
        if (card._previewHandlersAttached) return
        card._previewHandlersAttached = true

        card.addEventListener('mouseenter', () => {
            const entry = this._previewsByCard.get(card)
            if (!entry) return
            entry.hovered = true
            this._activatePreview(card)
        })
        card.addEventListener('mouseleave', () => {
            const entry = this._previewsByCard.get(card)
            if (!entry) return
            entry.hovered = false
            if (!entry.longPressed) this._deactivatePreview(card)
        })

        let longPressTimer = null
        let startX = 0
        let startY = 0
        const cancelTimer = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer)
                longPressTimer = null
            }
        }
        card.addEventListener('touchstart', (e) => {
            const t = e.touches[0]
            if (!t) return
            startX = t.clientX
            startY = t.clientY
            // Each fresh touch starts clean — never inherit a stale
            // suppression flag from a previous interaction.
            card._suppressNextClick = false
            cancelTimer()
            longPressTimer = setTimeout(() => {
                longPressTimer = null
                const entry = this._previewsByCard.get(card)
                if (!entry) return
                entry.longPressed = true
                card._suppressNextClick = true
                this._activatePreview(card)
            }, LONG_PRESS_MS)
        }, { passive: true })
        card.addEventListener('touchmove', (e) => {
            const t = e.touches[0]
            if (!t) return
            if (Math.abs(t.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE_PX
                || Math.abs(t.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
                cancelTimer()
            }
        }, { passive: true })
        const onTouchEnd = () => {
            cancelTimer()
            const entry = this._previewsByCard.get(card)
            if (!entry) return
            if (entry.longPressed) {
                entry.longPressed = false
                if (!entry.hovered) this._deactivatePreview(card)
            }
        }
        card.addEventListener('touchend', onTouchEnd, { passive: true })
        card.addEventListener('touchcancel', onTouchEnd, { passive: true })

        // The synthetic click that follows a long-press release would
        // otherwise load the program. Capture-phase handler runs ahead of
        // the per-tab click handlers and stops them when the flag is set.
        card.addEventListener('click', (e) => {
            if (card._suppressNextClick) {
                card._suppressNextClick = false
                e.stopImmediatePropagation()
                e.preventDefault()
            }
        }, { capture: true })
    }

    /**
     * One-shot render → snapshot → dispose so a card that has just
     * scrolled into view ends up displaying a still thumbnail. After this
     * the card stays static until the user hovers or long-presses.
     *
     * The warm-up canvas is mounted hidden so the user never sees the
     * brief animation that runs while we wait for the first frame — they
     * just see the still snapshot appear once it's ready.
     */
    async _warmUpPreview(card) {
        const entry = this._previewsByCard.get(card)
        if (!entry || entry.warmedUp) return
        entry.warmedUp = true
        if (entry.skipWarmUp) return
        if (entry.preview || entry.hovered || entry.longPressed) return

        entry.warmingUp = true
        await this._activatePreview(card)
        // Two rAFs so the GL pipeline has actually painted a frame before
        // we capture; one rAF only gets the first compositing tick.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

        const after = this._previewsByCard.get(card)
        if (!after) {
            entry.warmingUp = false
            return
        }
        // User started interacting during the warm-up — promote it to a
        // visible animation by clearing the hidden flag on the live canvas.
        if (after.hovered || after.longPressed) {
            after.warmingUp = false
            if (after.canvas) after.canvas.style.visibility = ''
            return
        }
        if (after.preview) this._deactivatePreview(card)
        after.warmingUp = false
    }

    async _activatePreview(card) {
        const entry = this._previewsByCard.get(card)
        if (!entry || entry.preview) return
        // LRU bookkeeping — bump to front; evict tail past the cap so we
        // don't outrun the browser's WebGL context limit (~16).
        this._activeCards = this._activeCards.filter(c => c !== card)
        this._activeCards.unshift(card)
        while (this._activeCards.length > PREVIEW_MAX_LIVE) {
            const evict = this._activeCards.pop()
            this._deactivatePreview(evict)
        }
        // Build a fresh canvas. Old snapshot stays visible until the canvas
        // mounts, then the canvas covers it. We remove the snapshot only
        // after the first rendered frame so there's no flash to black.
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 180
        canvas.className = 'gallery-card-preview-canvas'
        if (entry.absolute) {
            canvas.style.position = 'absolute'
            canvas.style.inset = '0'
            canvas.style.width = '100%'
            canvas.style.height = '100%'
        }
        // During warm-up the canvas is mounted but hidden — the snapshot
        // capture works off the GL drawing buffer regardless of CSS, so
        // the user sees only the resulting still, never the brief frames
        // that run while we wait for first paint.
        if (entry.warmingUp) canvas.style.visibility = 'hidden'
        entry.thumbContainer.appendChild(canvas)
        entry.canvas = canvas
        const preview = new LivePreview(canvas, entry.dsl, {
            onError: (err) => console.debug('[Gallery] preview error:', err?.message || err)
        })
        entry.preview = preview
        await preview.start()
        if (!this._open) {
            preview.dispose()
            return
        }
        // If a deactivation ran while we were awaiting (e.g. card scrolled
        // out, hover ended), entry.preview will have been cleared and a
        // fresh snapshotImg added — leave it alone.
        const stillActive = this._previewsByCard.get(card)
        if (!stillActive || stillActive.preview !== preview) return
        // First frame is up — drop the snapshot placeholder if present.
        if (entry.snapshotImg) {
            entry.snapshotImg.remove()
            entry.snapshotImg = null
        }
    }

    _deactivatePreview(card) {
        const entry = this._previewsByCard.get(card)
        if (!entry || !entry.preview) return
        const p = entry.preview
        const oldCanvas = entry.canvas
        entry.preview = null
        entry.canvas = null
        this._activeCards = this._activeCards.filter(c => c !== card)

        // Snapshot the canvas's last frame into an <img> so the thumb stays
        // visible after the WebGL context is released. dispose() with
        // loseContext leaves the canvas surface blank/broken; an <img>
        // snapshot survives intact.
        try {
            if (p?._ready && oldCanvas?.width > 0 && oldCanvas?.height > 0) {
                const dataUrl = oldCanvas.toDataURL('image/jpeg', 0.78)
                if (dataUrl && dataUrl.length > 64) {
                    // Replace any earlier snapshot so we never stack two.
                    if (entry.snapshotImg) entry.snapshotImg.remove()
                    const img = document.createElement('img')
                    img.src = dataUrl
                    img.alt = ''
                    img.className = 'gallery-card-snapshot'
                    if (entry.absolute) {
                        img.style.position = 'absolute'
                        img.style.inset = '0'
                        img.style.width = '100%'
                        img.style.height = '100%'
                        img.style.objectFit = 'cover'
                    }
                    entry.thumbContainer.appendChild(img)
                    entry.snapshotImg = img
                }
            }
        } catch (err) {
            console.debug('[Gallery] snapshot capture failed:', err?.message || err)
        }
        // Dispose the WebGL context AND remove the canvas element entirely
        // so the broken-context placeholder never gets a chance to paint.
        p.dispose()
        oldCanvas?.remove()
    }

    _build() {
        if (this._overlay) this._overlay.remove()
        this._overlay = document.createElement('div')
        this._overlay.className = 'gallery-overlay'
        this._overlay.innerHTML = `
            <div class="gallery-modal" role="dialog" aria-label="Program browser">
                <div class="gallery-header">
                    <span class="gallery-title">Programs</span>
                    <div class="gallery-actions">
                        <button class="gallery-btn" data-id="shuffle"><span class="icon-material">shuffle</span>shuffle</button>
                        <button class="gallery-close" data-id="close" aria-label="Close">×</button>
                    </div>
                </div>
                <div class="gallery-tabs">
                    <button class="gallery-tab" data-tab="curated">Curated</button>
                    <button class="gallery-tab" data-tab="noisedeck-examples">Noisedeck Examples</button>
                    <button class="gallery-tab" data-tab="blaster">NoiseBLASTER!</button>
                </div>
                <div class="gallery-body" data-id="body"></div>
            </div>
        `
        document.body.appendChild(this._overlay)

        this._overlay.querySelector('[data-id=close]').addEventListener('click', () => this.close())
        this._overlay.querySelector('[data-id=shuffle]').addEventListener('click', () => this._shuffle())
        this._overlay.querySelectorAll('.gallery-tab').forEach(btn => {
            btn.addEventListener('click', () => this._renderTab(btn.dataset.tab))
        })
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        registerEscapeable(this._overlay, () => this.close())
    }

    async _renderTab(tab) {
        this._activeTab = tab
        this._overlay?.querySelectorAll('.gallery-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab)
        })
        const body = this._overlay?.querySelector('[data-id=body]')
        if (!body) return
        if (tab === 'curated') {
            await this._renderCurated(body)
        } else if (tab === 'noisedeck-examples') {
            await this._renderNoisedeckExamples(body)
        } else if (tab === 'blaster') {
            await this._renderBlaster(body)
        }
    }

    async _renderCurated(body) {
        body.innerHTML = `<div class="gallery-loading">Loading…</div>`
        const examples = await loadExamples()
        if (!examples.length) {
            body.innerHTML = `<div class="gallery-empty">No curated examples found.</div>`
            return
        }
        const grid = document.createElement('div')
        grid.className = 'gallery-grid'
        for (const ex of examples) {
            grid.appendChild(this._buildCuratedCard(ex))
        }
        body.innerHTML = ''
        body.appendChild(grid)
    }

    async _renderBlaster(body) {
        body.innerHTML = `<div class="gallery-loading">Fetching latest from NoiseBLASTER…</div>`
        let feed
        try {
            feed = await loadBlasterFeed()
        } catch (err) {
            console.warn('[Gallery] Blaster feed failed:', err)
            body.innerHTML = `<div class="gallery-error">Couldn't reach NoiseBLASTER. Try again in a moment.</div>`
            return
        }
        if (!feed?.length) {
            body.innerHTML = `<div class="gallery-empty">No published compositions yet.</div>`
            return
        }
        const grid = document.createElement('div')
        grid.className = 'gallery-grid'
        for (const item of feed) {
            grid.appendChild(this._buildBlasterCard(item))
        }
        body.innerHTML = ''
        body.appendChild(grid)
    }

    async _renderNoisedeckExamples(body) {
        body.innerHTML = `<div class="gallery-loading">Loading Noisedeck Examples…</div>`
        let listing
        try {
            listing = await loadNoisedeckExamples()
        } catch (err) {
            console.warn('[Gallery] Noisedeck Examples listing failed:', err)
            body.innerHTML = `<div class="gallery-error">Couldn't reach Noisedeck Examples. Try again in a moment.</div>`
            return
        }
        if (!listing?.files?.length) {
            body.innerHTML = `<div class="gallery-empty">No Noisedeck Examples found.</div>`
            return
        }
        const grid = document.createElement('div')
        grid.className = 'gallery-grid'
        for (const file of listing.files) {
            grid.appendChild(this._buildNoisedeckExampleCard(listing, file))
        }
        body.innerHTML = ''
        body.appendChild(grid)
    }

    _buildNoisedeckExampleCard(listing, file) {
        const card = document.createElement('div')
        card.className = 'gallery-card'

        // Empty thumb — a LivePreview canvas mounts here when the card
        // scrolls into view, after we lazy-fetch the .dsl. The fallback
        // is only shown if the DSL fetch fails.
        const thumb = document.createElement('div')
        thumb.className = 'gallery-card-thumb'

        const bodyEl = document.createElement('div')
        bodyEl.className = 'gallery-card-body'
        bodyEl.innerHTML = `
            <div class="gallery-card-title">${escapeHtml(file.title || file.file)}</div>
            <div class="gallery-card-meta"><span class="gallery-card-meta-app">noisedeck</span></div>
        `
        card.appendChild(thumb)
        card.appendChild(bodyEl)

        card.addEventListener('click', async () => {
            await this._loadNoisedeckExample(listing, file, card)
        })

        // Lazy-fetch the DSL once the card nears view, then register a
        // live preview canvas. Mirrors _upgradeBlasterCardToLive but with
        // no screenshot underneath, so the canvas mounts directly.
        this._upgradeNoisedeckExampleCardToLive(card, thumb, listing, file).catch(err => {
            console.debug('[Gallery] noisedeck-examples live upgrade skipped:', err?.message || err)
        })
        return card
    }

    async _upgradeNoisedeckExampleCardToLive(card, thumb, listing, file) {
        const fetchAndAttach = async () => {
            if (card.dataset.liveAttached === '1') return
            card.dataset.liveAttached = '1'
            let dsl
            try {
                dsl = await fetchNoisedeckExampleSource(listing, file.file)
            } catch (err) {
                console.debug('[Gallery] could not load noisedeck-example DSL:', err?.message || err)
                const fb = document.createElement('div')
                fb.className = 'gallery-card-thumb-fallback'
                fb.textContent = '(no preview)'
                thumb.appendChild(fb)
                return
            }
            // Cache on the file object so the click handler avoids a second fetch.
            file._cachedDsl = dsl
            this._registerPreview(card, thumb, dsl)
        }
        const triggerObs = new IntersectionObserver(async (entries, obs) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    obs.disconnect()
                    await fetchAndAttach()
                }
            }
        }, { root: null, threshold: 0.1 })
        triggerObs.observe(card)
    }

    async _loadNoisedeckExample(listing, file, card) {
        if (card) card.classList.add('loading')
        try {
            const dsl = file._cachedDsl || await fetchNoisedeckExampleSource(listing, file.file)
            this._onLoad({
                title: file.title || file.file,
                dsl,
                tagline: '',
                tags: ['noisedeck'],
            })
            this.close()
        } catch (err) {
            console.error('[Gallery] Failed to load Noisedeck Example:', err)
            if (card) {
                card.classList.remove('loading')
                card.querySelector('.gallery-card-meta')?.insertAdjacentHTML(
                    'beforeend',
                    `<span style="color: var(--hf-red)">load failed</span>`
                )
            }
        }
    }

    _shuffle() {
        if (this._activeTab === 'curated') {
            loadExamples().then(list => {
                if (!list.length) return
                const ex = list[Math.floor(Math.random() * list.length)]
                this._onLoad(ex)
                this.close()
            })
        } else if (this._activeTab === 'noisedeck-examples') {
            loadNoisedeckExamples().then(async (listing) => {
                if (!listing?.files?.length) return
                const file = listing.files[Math.floor(Math.random() * listing.files.length)]
                await this._loadNoisedeckExample(listing, file)
            }).catch(err => console.warn('[Gallery] shuffle failed:', err))
        } else if (this._activeTab === 'blaster') {
            loadBlasterFeed().then(async (feed) => {
                if (!feed?.length) return
                const item = feed[Math.floor(Math.random() * feed.length)]
                await this._loadBlasterItem(item)
            }).catch(err => console.warn('[Gallery] shuffle failed:', err))
        }
    }

    _buildCuratedCard(ex) {
        const card = document.createElement('div')
        card.className = 'gallery-card'
        const tags = (ex.tags || []).map(t => `<span class="gallery-card-tag">${escapeHtml(t)}</span>`).join('')
        // The thumb container is a slot — a one-shot warm-up render
        // captures a still snapshot when the card first enters view; live
        // animation only mounts a canvas while the user hovers (mouse) or
        // long-presses (touch).
        const thumbDiv = document.createElement('div')
        thumbDiv.className = 'gallery-card-thumb'

        const body = document.createElement('div')
        body.className = 'gallery-card-body'
        body.innerHTML = `
            <div class="gallery-card-title">${escapeHtml(ex.title || '')}</div>
            <div class="gallery-card-tagline">${escapeHtml(ex.tagline || '')}</div>
            <div class="gallery-card-tags">${tags}</div>
        `
        card.appendChild(thumbDiv)
        card.appendChild(body)

        card.addEventListener('click', () => {
            this._onLoad(ex)
            this.close()
        })
        if (ex.dsl) this._registerPreview(card, thumbDiv, ex.dsl)
        return card
    }

    _buildBlasterCard(item) {
        const card = document.createElement('div')
        card.className = 'gallery-card'

        // Thumb container — starts as the static screenshot (cheap), gets
        // upgraded to a live canvas preview once we fetch the DSL and the
        // card is on screen.
        const thumb = document.createElement('div')
        thumb.className = 'gallery-card-thumb'
        if (item.screenshotUrl) {
            const img = document.createElement('img')
            img.src = item.screenshotUrl
            img.alt = item.title || ''
            img.loading = 'lazy'
            img.referrerPolicy = 'no-referrer'
            img.onerror = () => {
                const fb = document.createElement('div')
                fb.className = 'gallery-card-thumb-fallback'
                fb.textContent = '(no preview)'
                img.replaceWith(fb)
            }
            thumb.appendChild(img)
        } else {
            const fb = document.createElement('div')
            fb.className = 'gallery-card-thumb-fallback'
            fb.textContent = '(no preview)'
            thumb.appendChild(fb)
        }

        const body = document.createElement('div')
        body.className = 'gallery-card-body'
        const author = item.username ? `by ${escapeHtml(item.username)}` : ''
        const app = item.app ? `<span class="gallery-card-meta-app">${escapeHtml(item.app)}</span>` : ''
        const date = item.createdAt ? formatRelativeTime(item.createdAt) : ''
        body.innerHTML = `
            <div class="gallery-card-title">${escapeHtml(item.title || '(untitled)')}</div>
            <div class="gallery-card-meta">${app}<span>${author}</span><span>·</span><span>${escapeHtml(date)}</span></div>
        `
        card.appendChild(thumb)
        card.appendChild(body)

        card.addEventListener('click', async () => {
            await this._loadBlasterItem(item, card)
        })

        // Lazy-fetch the DSL behind the screenshot and register a live
        // preview canvas. The screenshot stays as a placeholder until the
        // canvas is ready, then the canvas takes over by stacking on top.
        this._upgradeBlasterCardToLive(card, thumb, item).catch(err => {
            console.debug('[Gallery] blaster live upgrade skipped:', err?.message || err)
        })
        return card
    }

    async _upgradeBlasterCardToLive(card, thumb, item) {
        if (!item?.code) return
        // Defer the loadFromCode fetch until the card scrolls near view.
        const fetchAndAttach = async () => {
            if (card.dataset.liveAttached === '1') return
            card.dataset.liveAttached = '1'
            let composition
            try {
                // Previews render without media() urls, so skip the image files.
                composition = await loadFromCode(item.code, { loadImages: false })
            } catch (err) {
                console.debug('[Gallery] could not load blaster DSL:', err?.message || err)
                return
            }
            if (!composition?.dsl) return
            // Make the thumb a positioned container so absolute-stacked
            // canvas/snapshot layers render on top of the screenshot <img>.
            thumb.style.position = 'relative'
            this._registerPreview(card, thumb, composition.dsl, { absolute: true })
        }
        // Trigger the fetch lazily via a one-shot observer.
        const triggerObs = new IntersectionObserver(async (entries, obs) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    obs.disconnect()
                    await fetchAndAttach()
                }
            }
        }, { root: null, threshold: 0.1 })
        triggerObs.observe(card)
    }

    async _loadBlasterItem(item, card) {
        if (!item?.code) return
        if (card) card.classList.add('loading')
        try {
            const composition = await loadFromCode(item.code)
            this._onLoad({
                title: composition.title || item.title || '(untitled)',
                dsl: composition.dsl,
                images: composition.images,
                tagline: '',
                tags: [item.app].filter(Boolean)
            })
            this.close()
        } catch (err) {
            console.error('[Gallery] Failed to load blaster item:', err)
            if (card) {
                card.classList.remove('loading')
                card.querySelector('.gallery-card-meta')?.insertAdjacentHTML('beforeend', `<span style="color: var(--hf-red)">load failed</span>`)
            }
        }
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]))
}

/** "5 min ago", "3 days ago", etc. */
function formatRelativeTime(ms) {
    if (!Number.isFinite(ms)) return ''
    const diff = Date.now() - ms
    if (diff < 0) return 'just now'
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const days = Math.floor(hr / 24)
    if (days < 14) return `${days}d ago`
    const weeks = Math.floor(days / 7)
    if (weeks < 8) return `${weeks}w ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
}

export const gallery = new Gallery()
