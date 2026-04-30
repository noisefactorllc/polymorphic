/**
 * Inspiration Gallery
 *
 * Modal grid of curated example sketches loaded from /data/examples.json.
 * Click an example to load it. "Shuffle" button picks one at random.
 *
 * On a fresh visit (no ?dsl, no ?code), we now boot a random example so the
 * landing page feels welcoming — Hydra's pattern but with a richer roster.
 */

const STYLES_ID = 'gallery-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .gallery-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.6);
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
            background: rgba(10, 12, 17, 0.96);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            box-shadow: 0 20px 60px -10px rgba(0,0,0,0.6);
            width: min(900px, calc(100vw - 2rem));
            max-height: calc(100vh - 7vh);
            display: flex;
            flex-direction: column;
            color: #e3e3e3;
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            overflow: hidden;
        }
        .gallery-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.85rem 1.1rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .gallery-title {
            font-size: 1rem;
            font-weight: 700;
            color: #fff;
            font-family: 'Comfortaa', 'Comfortaa Block', sans-serif;
        }
        .gallery-actions { display: flex; gap: 0.4rem; }
        .gallery-btn {
            background: rgba(165,184,255,0.18);
            border: 1px solid rgba(165,184,255,0.35);
            color: #d9deeb;
            font-family: inherit;
            font-size: 0.75rem;
            padding: 0.35rem 0.7rem;
            border-radius: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            transition: all 0.15s;
        }
        .gallery-btn:hover { background: rgba(165,184,255,0.32); }
        .gallery-btn .icon-material { font-size: 16px; }
        .gallery-close {
            background: transparent; border: none; color: #888; cursor: pointer;
            padding: 0.2em 0.5em; font-size: 1.2rem;
        }
        .gallery-close:hover { color: #fff; }
        .gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 0.85rem;
            padding: 1.1rem;
            overflow-y: auto;
        }
        .gallery-card {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.18s;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .gallery-card:hover {
            border-color: rgba(165, 184, 255, 0.6);
            transform: translateY(-2px);
            box-shadow: 0 10px 24px -6px rgba(0,0,0,0.4);
        }
        .gallery-card-thumb {
            aspect-ratio: 16 / 9;
            background: #0a0a0f;
            position: relative;
            overflow: hidden;
        }
        .gallery-card-thumb canvas {
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
            color: #555;
            font-size: 0.75rem;
            background: linear-gradient(135deg, #1c1f2c, #0f1117);
        }
        .gallery-card-body {
            padding: 0.65rem 0.85rem 0.85rem;
        }
        .gallery-card-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: #fff;
            margin-bottom: 0.15rem;
        }
        .gallery-card-tagline {
            font-size: 0.75rem;
            color: #aaa;
            line-height: 1.4;
        }
        .gallery-card-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem;
            margin-top: 0.35rem;
        }
        .gallery-card-tag {
            font-size: 0.6rem;
            color: #a5b8ff;
            background: rgba(165, 184, 255, 0.08);
            padding: 0.1rem 0.4rem;
            border-radius: 3px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
    `
    document.head.appendChild(style)
}

let cachedExamples = null

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

/**
 * @returns {Promise<{title: string, dsl: string} | null>}
 */
export async function pickRandomExample() {
    const list = await loadExamples()
    if (!list.length) return null
    return list[Math.floor(Math.random() * list.length)]
}

class Gallery {
    constructor() {
        this._overlay = null
        this._open = false
        this._onLoad = () => {}
        this._onShuffle = () => {}
        this._escHandler = null
    }

    /**
     * @param {object} opts
     * @param {(example: object) => void} opts.onLoad
     */
    init(opts) {
        this._onLoad = opts.onLoad || (() => {})
    }

    async open() {
        if (this._open) return
        this._open = true
        const examples = await loadExamples()
        this._build(examples)
        this._overlay.classList.add('visible')
    }

    close() {
        if (!this._open) return
        this._open = false
        this._overlay?.classList.remove('visible')
        // Remove after transition
        const ov = this._overlay
        setTimeout(() => ov?.remove(), 200)
        this._overlay = null
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler)
            this._escHandler = null
        }
    }

    isOpen() { return this._open }

    _build(examples) {
        if (this._overlay) this._overlay.remove()
        this._overlay = document.createElement('div')
        this._overlay.className = 'gallery-overlay'
        this._overlay.innerHTML = `
            <div class="gallery-modal" role="dialog" aria-label="Inspiration gallery">
                <div class="gallery-header">
                    <span class="gallery-title">Inspiration</span>
                    <div class="gallery-actions">
                        <button class="gallery-btn" data-id="shuffle"><span class="icon-material">shuffle</span>shuffle</button>
                        <button class="gallery-close" data-id="close" aria-label="Close">×</button>
                    </div>
                </div>
                <div class="gallery-grid"></div>
            </div>
        `
        document.body.appendChild(this._overlay)
        const grid = this._overlay.querySelector('.gallery-grid')
        for (const ex of examples) {
            grid.appendChild(this._buildCard(ex))
        }
        this._overlay.querySelector('[data-id=close]').addEventListener('click', () => this.close())
        this._overlay.querySelector('[data-id=shuffle]').addEventListener('click', () => {
            const ex = examples[Math.floor(Math.random() * examples.length)]
            if (ex) {
                this._onLoad(ex)
                this.close()
            }
        })
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.close()
        }
        document.addEventListener('keydown', this._escHandler)
    }

    _buildCard(ex) {
        const card = document.createElement('div')
        card.className = 'gallery-card'
        const tags = (ex.tags || []).map(t => `<span class="gallery-card-tag">${escapeHtml(t)}</span>`).join('')
        card.innerHTML = `
            <div class="gallery-card-thumb"><div class="gallery-card-thumb-fallback">${escapeHtml(ex.title || '')}</div></div>
            <div class="gallery-card-body">
                <div class="gallery-card-title">${escapeHtml(ex.title || '')}</div>
                <div class="gallery-card-tagline">${escapeHtml(ex.tagline || '')}</div>
                <div class="gallery-card-tags">${tags}</div>
            </div>
        `
        card.addEventListener('click', () => {
            this._onLoad(ex)
            this.close()
        })
        return card
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]))
}

export const gallery = new Gallery()
