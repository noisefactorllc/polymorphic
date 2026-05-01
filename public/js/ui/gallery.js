/**
 * Program Browser
 *
 * Modal browser for example programs and community-published compositions.
 * Two tabs:
 *
 *   - Curated     — static /data/examples.json roster shipped with the app.
 *   - NoiseBLASTER — live feed pulled from blaster.noisedeck.app/api/feed,
 *                    showing the latest published compositions across the
 *                    Noisemaker ecosystem. These are ephemeral and rotate
 *                    daily; clicking a card resolves the composition via
 *                    sharing.noisedeck.app and loads it into the editor.
 *
 * On a fresh visit (no ?dsl, no ?code), we boot a random Curated example so
 * the landing page feels welcoming.
 */

import { loadFromCode } from '../sharingLoader.js'

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
            padding: 0.85rem 1.1rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .gallery-title {
            font-size: 1rem;
            font-weight: 700;
            color: #fff;
            font-family: 'Comfortaa', 'Comfortaa Block', sans-serif;
            padding-bottom: 0.85rem;
        }
        .gallery-actions { display: flex; gap: 0.4rem; padding-bottom: 0.6rem; }
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

        /* Tab strip */
        .gallery-tabs {
            display: flex;
            gap: 0.25rem;
            padding: 0 1.1rem;
            margin-top: -0.4rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .gallery-tab {
            background: transparent;
            border: none;
            color: #aaa;
            font-family: inherit;
            font-size: 0.8125rem;
            padding: 0.5rem 0.85rem;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
        }
        .gallery-tab:hover { color: #fff; }
        .gallery-tab.active {
            color: #fff;
            border-bottom-color: #a5b8ff;
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
            color: #777;
            font-size: 0.875rem;
        }
        .gallery-error {
            padding: 1rem 1.1rem;
            margin: 1rem 1.1rem;
            background: rgba(255,107,107,0.08);
            border: 1px solid rgba(255,107,107,0.25);
            border-radius: 6px;
            color: #ffb4b4;
            font-size: 0.8125rem;
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
        .gallery-card.loading {
            opacity: 0.5;
            pointer-events: none;
        }
        .gallery-card-thumb {
            aspect-ratio: 16 / 9;
            background: #0a0a0f;
            position: relative;
            overflow: hidden;
        }
        .gallery-card-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
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
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .gallery-card-tagline {
            font-size: 0.75rem;
            color: #aaa;
            line-height: 1.4;
        }
        .gallery-card-meta {
            font-size: 0.6875rem;
            color: #888;
            display: flex;
            gap: 0.4rem;
            align-items: center;
            margin-top: 0.25rem;
        }
        .gallery-card-meta-app {
            color: #a5b8ff;
            text-transform: lowercase;
            background: rgba(165, 184, 255, 0.08);
            padding: 0.05rem 0.4rem;
            border-radius: 3px;
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

const BLASTER_FEED_URL = 'https://blaster.noisedeck.app/api/feed'

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
    const res = await fetch(`${BLASTER_FEED_URL}?page=0&limit=24`, { cache: 'no-store' })
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
        this._escHandler = null
        this._activeTab = 'curated'  // 'curated' | 'blaster'
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
        this._overlay?.classList.remove('visible')
        const ov = this._overlay
        setTimeout(() => ov?.remove(), 200)
        this._overlay = null
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler)
            this._escHandler = null
        }
    }

    isOpen() { return this._open }

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
        this._escHandler = (e) => { if (e.key === 'Escape') this.close() }
        document.addEventListener('keydown', this._escHandler)
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

    _shuffle() {
        if (this._activeTab === 'curated') {
            loadExamples().then(list => {
                if (!list.length) return
                const ex = list[Math.floor(Math.random() * list.length)]
                this._onLoad(ex)
                this.close()
            })
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

    _buildBlasterCard(item) {
        const card = document.createElement('div')
        card.className = 'gallery-card'
        const thumb = item.screenshotUrl
            ? `<img src="${escapeHtml(item.screenshotUrl)}" alt="${escapeHtml(item.title || '')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'gallery-card-thumb-fallback',textContent:'(no preview)'}))">`
            : `<div class="gallery-card-thumb-fallback">(no preview)</div>`
        const author = item.username ? `by ${escapeHtml(item.username)}` : ''
        const app = item.app ? `<span class="gallery-card-meta-app">${escapeHtml(item.app)}</span>` : ''
        const date = item.createdAt ? formatRelativeTime(item.createdAt) : ''
        card.innerHTML = `
            <div class="gallery-card-thumb">${thumb}</div>
            <div class="gallery-card-body">
                <div class="gallery-card-title">${escapeHtml(item.title || '(untitled)')}</div>
                <div class="gallery-card-meta">${app}<span>${author}</span><span>·</span><span>${escapeHtml(date)}</span></div>
            </div>
        `
        card.addEventListener('click', async () => {
            await this._loadBlasterItem(item, card)
        })
        return card
    }

    async _loadBlasterItem(item, card) {
        if (!item?.code) return
        if (card) card.classList.add('loading')
        try {
            const composition = await loadFromCode(item.code)
            this._onLoad({
                title: composition.title || item.title || '(untitled)',
                dsl: composition.dsl,
                tagline: '',
                tags: [item.app].filter(Boolean)
            })
            this.close()
        } catch (err) {
            console.error('[Gallery] Failed to load blaster item:', err)
            if (card) {
                card.classList.remove('loading')
                card.querySelector('.gallery-card-meta')?.insertAdjacentHTML('beforeend', `<span style="color:#ff7b72">load failed</span>`)
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
