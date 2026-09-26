/**
 * Command Palette
 *
 * Cmd/Ctrl+K opens a fuzzy palette of effects and actions.
 *  - Type to filter
 *  - Up/Down to navigate
 *  - Enter to invoke (insert effect snippet at cursor or run action)
 *  - Escape closes
 *
 * Effects come from the noisemaker manifest (see manifest.js).
 * Actions are registered programmatically by the host (recording, audio toggle, etc).
 */

import { loadManifest, getEffects, fuzzySearch } from '../manifest.js'
let registerEscapeable = (el, cb) => {}, unregisterEscapeable = (el) => {}
try {
    const hf = await import('handfish')
    registerEscapeable = hf.registerEscapeable
    unregisterEscapeable = hf.unregisterEscapeable
} catch {
    // In Node test runners without import maps, fall back cleanly
}

const STYLES_ID = 'command-palette-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .cmd-palette-overlay {
            position: fixed; inset: 0;
            background: var(--hf-backdrop, color-mix(in srgb, var(--hf-color-1, black) 62%, transparent));
            backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            -webkit-backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            z-index: var(--hf-z-modal, 5000);
            display: none;
            opacity: 0;
            transition: opacity var(--hf-transition-fast, 0.12s ease);
        }
        .cmd-palette-overlay.visible {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 14vh;
            opacity: 1;
        }
        .cmd-palette {
            background: color-mix(in srgb, var(--hf-bg-surface, var(--hf-color-2)) var(--hf-surface-opacity, 96%), transparent);
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            border-radius: var(--hf-radius-lg, 12px);
            width: min(680px, calc(100vw - 2rem));
            box-shadow: var(--hf-shadow-xl, 0 20px 60px -10px color-mix(in srgb, var(--hf-color-1, black) 60%, transparent));
            overflow: hidden;
            display: flex;
            flex-direction: column;
            font-family: var(--hf-font-family, 'Nunito', 'Nunito Block', sans-serif);
            color: var(--hf-text-normal, var(--hf-color-6));
        }
        .cmd-palette-input-wrap {
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            padding: 0 var(--hf-space-4, 1rem);
        }
        .cmd-palette-input-wrap .icon-material {
            color: var(--hf-text-dim, var(--hf-color-5));
            font-size: 18px;
            margin-inline-end: var(--hf-space-2, 0.5rem);
        }
        .cmd-palette-input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--hf-text-bright, var(--hf-color-7));
            font-family: inherit;
            font-size: var(--hf-size-md, 1rem);
            padding: 0.95rem 0.25rem;
        }
        .cmd-palette-input:focus-visible {
            outline: var(--hf-focus-ring-width, 2px) solid var(--hf-focus-ring-color, var(--hf-accent, var(--accent3)));
            outline-offset: var(--hf-focus-ring-offset, 2px);
        }
        .cmd-palette-input::placeholder { color: var(--hf-text-muted, var(--hf-color-4)); }
        .cmd-palette-list {
            position: relative;
            list-style: none;
            margin: 0;
            padding: var(--hf-space-1, 0.4rem) 0;
            max-height: 50vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: color-mix(in srgb, var(--hf-text-bright, var(--hf-color-7)) 15%, transparent) transparent;
        }
        .cmd-palette-list::-webkit-scrollbar { width: 6px; }
        .cmd-palette-list::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, var(--hf-text-bright, var(--hf-color-7)) 15%, transparent);
            border-radius: var(--hf-radius-sm, 3px);
        }
        .cmd-palette-section {
            padding: var(--hf-space-1, 0.4rem) var(--hf-space-4, 1rem) var(--hf-space-1, 0.2rem);
            font-size: 0.6875rem;
            color: var(--hf-text-dim, var(--hf-color-5));
            text-transform: uppercase;
            letter-spacing: var(--hf-tracking-wide, 0.08em);
            font-weight: var(--hf-weight-semibold, 600);
        }
        .cmd-palette-item {
            display: flex;
            align-items: center;
            gap: var(--hf-space-3, 0.7rem);
            padding: var(--hf-space-2, 0.55rem) var(--hf-space-4, 1rem);
            cursor: pointer;
            border-inline-start: 2px solid transparent;
            transition: background var(--hf-transition-fast, 0.08s), border-color var(--hf-transition-fast, 0.08s);
        }
        .cmd-palette-item:hover,
        .cmd-palette-item.active {
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 12%, transparent);
            border-inline-start-color: var(--hf-accent, var(--accent3));
        }
        .cmd-palette-item-icon {
            width: 1.5rem;
            height: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--hf-accent, var(--accent3));
        }
        .cmd-palette-item-icon .icon-material { font-size: 18px; }
        .cmd-palette-item-main { flex: 1; min-width: 0; }
        .cmd-palette-item-title {
            font-size: var(--hf-size-sm, 0.875rem);
            font-weight: var(--hf-weight-medium, 500);
            color: var(--hf-text-bright, var(--hf-color-7));
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
        }
        .cmd-palette-item-subtitle {
            font-size: 0.75rem;
            color: var(--hf-text-dim, var(--hf-color-5));
            margin-block-start: 0.05rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .cmd-palette-item-tag {
            font-size: 0.6875rem;
            color: var(--hf-accent, var(--accent3));
            background: color-mix(in srgb, var(--hf-accent, var(--accent3)) 8%, transparent);
            padding: 0.1rem var(--hf-space-2, 0.4rem);
            border-radius: var(--hf-radius-sm, 3px);
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
            text-transform: lowercase;
            white-space: nowrap;
        }
        .cmd-palette-empty {
            padding: var(--hf-space-6, 2rem) var(--hf-space-4, 1rem);
            text-align: center;
            color: var(--hf-text-muted, var(--hf-color-4));
            font-size: var(--hf-size-sm, 0.875rem);
        }
        .cmd-palette-footer {
            display: flex;
            justify-content: space-between;
            padding: var(--hf-space-2, 0.55rem) var(--hf-space-4, 1rem);
            border-block-start: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            font-size: 0.6875rem;
            color: var(--hf-text-muted, var(--hf-color-4));
        }
        .cmd-palette-footer kbd {
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
            font-size: 0.625rem;
            background: color-mix(in srgb, var(--hf-text-bright, var(--hf-color-7)) 6%, transparent);
            border: 1px solid var(--hf-border-subtle, var(--hf-color-4));
            padding: 0.05rem 0.35rem;
            border-radius: var(--hf-radius-sm, 3px);
            margin: 0 0.15rem;
        }
    `
    document.head.appendChild(style)
}

class CommandPalette {
    constructor() {
        this._actions = []
        this._overlay = null
        this._input = null
        this._list = null
        this._activeIdx = 0
        this._currentItems = []
        this._open = false
        this._onInsert = null
        this._previousFocus = null
        this._manifestLoaded = false
        this._boundKeydown = this._handleKeydown.bind(this)
    }

    /**
     * Initialize. Provide an insertSnippet callback that receives the DSL string
     * to insert into the editor at the current cursor.
     * @param {object} options
     * @param {(snippet: string, opts?: {as: 'starter'|'filter'}) => void} options.onInsert
     */
    init(options) {
        this._onInsert = options.onInsert || (() => {})

        // Kick off manifest load — non-blocking
        loadManifest().then(() => {
            this._manifestLoaded = true
            if (this._open) this._refresh()
        }).catch(err => {
            console.error('[CommandPalette] Manifest load failed:', err)
        })

        // Global Cmd/Ctrl+K handler
        document.addEventListener('keydown', (e) => {
            const isMod = e.metaKey || e.ctrlKey
            if (isMod && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
                e.preventDefault()
                this.toggle()
            }
        })
    }

    /**
     * Register an action (custom command).
     * @param {Object} action
     * @param {string} action.id
     * @param {string} action.title
     * @param {string} [action.subtitle]
     * @param {string} [action.icon] - Material icon name
     * @param {string[]} [action.keywords]
     * @param {() => void | Promise<void>} action.run
     * @param {string} [action.section='Actions']
     */
    registerAction(action) {
        if (!action || !action.id || !action.run) return
        // Replace existing action with same id
        const existing = this._actions.findIndex(a => a.id === action.id)
        if (existing >= 0) {
            this._actions[existing] = action
        } else {
            this._actions.push(action)
        }
    }

    /**
     * Update an action's display data (e.g., toggle title between "Enable" and "Disable").
     * @param {string} id
     * @param {Partial<Object>} updates
     */
    updateAction(id, updates) {
        const a = this._actions.find(x => x.id === id)
        if (!a) return
        Object.assign(a, updates)
    }

    open() {
        if (this._open) return
        this._open = true
        this._previousFocus = document.activeElement

        if (!this._overlay) this._build()
        this._overlay.classList.add('visible')
        registerEscapeable(this._overlay, () => this.close())
        this._input?.setAttribute('aria-expanded', 'true')
        this._input.value = ''
        this._refresh()
        // Focus next tick so overlay transition picks up
        requestAnimationFrame(() => this._input?.focus())

        document.addEventListener('keydown', this._boundKeydown, true)
    }

    close() {
        if (!this._open) return
        this._open = false
        if (this._overlay) {
            unregisterEscapeable(this._overlay)
            this._overlay.classList.remove('visible')
        }
        document.removeEventListener('keydown', this._boundKeydown, true)
        this._input?.setAttribute('aria-expanded', 'false')
        this._input?.removeAttribute('aria-activedescendant')
        // Return focus to wherever it came from
        try { this._previousFocus?.focus?.() } catch { /* ignore */ }
    }

    toggle() {
        this._open ? this.close() : this.open()
    }

    _build() {
        this._overlay = document.createElement('div')
        this._overlay.className = 'cmd-palette-overlay'
        this._overlay.innerHTML = `
            <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
                <div class="cmd-palette-input-wrap">
                    <span class="icon-material" aria-hidden="true">search</span>
                    <input class="cmd-palette-input"
                           role="combobox"
                           aria-autocomplete="list"
                           aria-expanded="false"
                           aria-haspopup="listbox"
                           aria-controls="cmd-palette-list"
                           placeholder="Search effects, actions…"
                           autocomplete="off"
                           spellcheck="false">
                </div>
                <ul class="cmd-palette-list" id="cmd-palette-list" role="listbox" aria-label="Commands and effects"></ul>
                <div class="cmd-palette-footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> select <kbd>esc</kbd> close</span>
                    <span>polymorphic</span>
                </div>
            </div>
        `
        // Click outside to close
        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) this.close()
        })
        document.body.appendChild(this._overlay)

        this._input = this._overlay.querySelector('.cmd-palette-input')
        this._list = this._overlay.querySelector('.cmd-palette-list')

        this._input.addEventListener('input', () => this._refresh())
    }

    _refresh() {
        if (!this._list) return
        const q = this._input.value.trim()
        const items = this._buildItems(q)
        this._currentItems = items
        this._activeIdx = 0
        this._render(items)
        const linear = this._linearItems()
        if (linear.length > 0 && this._input) {
            this._input.setAttribute('aria-activedescendant', 'cmd-palette-item-0')
        } else if (this._input) {
            this._input.removeAttribute('aria-activedescendant')
        }
        if (this._list) {
            this._list.scrollTop = 0
        }
    }

    _buildItems(query) {
        const items = []

        // Actions first (they're typically what people want when q is short)
        const actionMatches = []
        for (const a of this._actions) {
            const score = this._scoreAction(a, query)
            if (score > 0) actionMatches.push({ ...a, score })
        }
        actionMatches.sort((a, b) => b.score - a.score)

        // Then effect matches
        const effectMatches = query
            ? fuzzySearch(query, { limit: 24 }).map(e => ({
                kind: 'effect',
                id: `effect:${e.id}`,
                title: e.name,
                subtitle: e.description,
                tag: e.namespace,
                starter: e.starter,
                effect: e,
                score: e.score
            }))
            : getEffects().slice(0, 24).map(e => ({
                kind: 'effect',
                id: `effect:${e.id}`,
                title: e.name,
                subtitle: e.description,
                tag: e.namespace,
                starter: e.starter,
                effect: e
            }))

        // Section: actions (if any matched, or query is empty)
        if (actionMatches.length > 0 || !query) {
            items.push({ section: 'Actions' })
            const visible = query ? actionMatches : this._actions
            for (const a of visible) items.push({
                kind: 'action',
                id: a.id,
                title: a.title,
                subtitle: a.subtitle,
                icon: a.icon || 'play_arrow',
                run: a.run
            })
        }

        if (effectMatches.length > 0) {
            items.push({ section: query ? 'Effects' : 'Effects (starters first)' })
            // When no query, sort starters first so users see useful entry points
            if (!query) effectMatches.sort((a, b) => Number(!!b.starter) - Number(!!a.starter))
            items.push(...effectMatches)
        }

        if (items.length === 0) {
            items.push({ empty: true })
        }
        return items
    }

    _scoreAction(action, q) {
        if (!q) return 1
        const qLower = q.toLowerCase()
        const haystack = [
            action.title, action.subtitle || '',
            ...(action.keywords || [])
        ].join(' ').toLowerCase()
        if (action.title.toLowerCase().startsWith(qLower)) return 90
        if (haystack.includes(qLower)) return 50
        // subsequence
        let i = 0
        for (const ch of haystack) {
            if (i < qLower.length && ch === qLower[i]) i++
        }
        return i === qLower.length ? 10 : 0
    }

    _render(items) {
        this._list.innerHTML = ''
        const fragment = document.createDocumentFragment()
        let liIndex = -1
        for (const it of items) {
            if (it.section) {
                const sec = document.createElement('li')
                sec.className = 'cmd-palette-section'
                sec.setAttribute('role', 'presentation')
                sec.textContent = it.section
                fragment.appendChild(sec)
                continue
            }
            if (it.empty) {
                const empty = document.createElement('li')
                empty.className = 'cmd-palette-empty'
                empty.setAttribute('role', 'presentation')
                empty.textContent = this._manifestLoaded ? 'No matches.' : 'Loading effects…'
                fragment.appendChild(empty)
                continue
            }
            liIndex += 1
            const li = document.createElement('li')
            li.id = `cmd-palette-item-${liIndex}`
            li.setAttribute('role', 'option')
            li.setAttribute('aria-selected', liIndex === this._activeIdx ? 'true' : 'false')
            li.className = 'cmd-palette-item' + (liIndex === this._activeIdx ? ' active' : '')
            li.dataset.idx = String(liIndex)

            const iconEl = document.createElement('div')
            iconEl.className = 'cmd-palette-item-icon'
            const iconSpan = document.createElement('span')
            iconSpan.className = 'icon-material'
            iconSpan.textContent = it.kind === 'effect'
                ? (it.starter ? 'auto_awesome' : 'tune')
                : (it.icon || 'play_arrow')
            iconEl.appendChild(iconSpan)
            li.appendChild(iconEl)

            const main = document.createElement('div')
            main.className = 'cmd-palette-item-main'
            const title = document.createElement('div')
            title.className = 'cmd-palette-item-title'
            title.textContent = it.title
            main.appendChild(title)
            if (it.subtitle) {
                const sub = document.createElement('div')
                sub.className = 'cmd-palette-item-subtitle'
                sub.textContent = it.subtitle
                main.appendChild(sub)
            }
            li.appendChild(main)

            if (it.tag) {
                const tag = document.createElement('span')
                tag.className = 'cmd-palette-item-tag'
                tag.textContent = it.tag
                li.appendChild(tag)
            }

            li.addEventListener('mouseenter', () => {
                this._setActive(Number(li.dataset.idx))
            })
            li.addEventListener('click', () => {
                this._invoke(this._linearItems()[Number(li.dataset.idx)])
            })

            fragment.appendChild(li)
        }
        this._list.appendChild(fragment)
        this._scrollActiveIntoView()
    }

    _linearItems() {
        // Items minus section/empty rows
        return this._currentItems.filter(x => !x.section && !x.empty)
    }

    _setActive(idx) {
        const linear = this._linearItems()
        const count = linear.length
        if (count === 0) {
            this._activeIdx = 0
            return
        }
        this._activeIdx = Math.max(0, Math.min(count - 1, idx))
        const items = this._list.querySelectorAll('.cmd-palette-item')
        items.forEach((el, i) => {
            const isActive = i === this._activeIdx
            el.classList.toggle('active', isActive)
            el.setAttribute('aria-selected', isActive ? 'true' : 'false')
        })
        if (this._input) {
            this._input.setAttribute('aria-activedescendant', `cmd-palette-item-${this._activeIdx}`)
        }
        this._scrollActiveIntoView()
    }

    _scrollActiveIntoView() {
        if (!this._list) return
        const items = this._list.querySelectorAll('.cmd-palette-item')
        const el = items[this._activeIdx]
        if (!el) return
        if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            return
        }
        const cont = this._list
        const top = el.offsetTop
        const bottom = top + el.offsetHeight
        if (top < cont.scrollTop) {
            cont.scrollTop = top
        } else if (bottom > cont.scrollTop + cont.clientHeight) {
            cont.scrollTop = bottom - cont.clientHeight
        }
    }

    _handleKeydown(e) {
        if (!this._open) return
        if (e.key === 'Tab') {
            e.preventDefault()
            return
        }
        if (e.key === 'Escape') {
            e.preventDefault?.()
            e.stopPropagation?.()
            this.close()
            return
        }
        const linear = this._linearItems()
        const count = linear.length
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (count === 0) return
            if (this._activeIdx >= count - 1) {
                this._setActive(0)
                if (this._list) this._list.scrollTop = 0
            } else {
                this._setActive(this._activeIdx + 1)
            }
            return
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (count === 0) return
            if (this._activeIdx <= 0) {
                this._setActive(count - 1)
                if (this._list) this._list.scrollTop = this._list.scrollHeight
            } else {
                this._setActive(this._activeIdx - 1)
            }
            return
        }
        if (e.key === 'PageDown') {
            e.preventDefault()
            if (count === 0) return
            const pageSize = 6
            const next = Math.min(count - 1, this._activeIdx + pageSize)
            this._setActive(next)
            return
        }
        if (e.key === 'PageUp') {
            e.preventDefault()
            if (count === 0) return
            const pageSize = 6
            const prev = Math.max(0, this._activeIdx - pageSize)
            this._setActive(prev)
            return
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            if (count === 0) return
            const item = linear[this._activeIdx]
            if (item) this._invoke(item)
            return
        }
    }

    async _invoke(item) {
        if (!item) return
        if (item.kind === 'action') {
            this.close()
            try { await item.run() } catch (err) { console.error('[CommandPalette] Action failed:', err) }
            return
        }
        if (item.kind === 'effect') {
            const snippet = buildEffectSnippet(item.effect)
            this.close()
            this._onInsert(snippet, { as: item.starter ? 'starter' : 'filter' })
            return
        }
    }
}

/**
 * Compose a DSL snippet for an effect. Starters become full lines ending in `.write(o0)`;
 * non-starters become a `.effect()` chain method that the host can splice into an existing
 * chain.
 * @param {EffectInfo} effect
 * @returns {string}
 */
function buildEffectSnippet(effect) {
    if (effect.starter) {
        return `search ${effect.namespace}\n\n${effect.name}().write(o0)`
    }
    // Non-starter: a chain step. The host knows how to insert this on the right line.
    return `.${effect.name}()`
}

export const commandPalette = new CommandPalette()
export { CommandPalette }
export default commandPalette
