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

const STYLES_ID = 'command-palette-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .cmd-palette-overlay {
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            z-index: 5000;
            display: none;
            opacity: 0;
            transition: opacity 0.12s ease;
        }
        .cmd-palette-overlay.visible {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 14vh;
            opacity: 1;
        }
        .cmd-palette {
            background: rgba(15, 17, 22, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            width: min(680px, calc(100vw - 2rem));
            box-shadow: 0 20px 60px -10px rgba(0,0,0,0.6);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            font-family: 'Nunito', 'Nunito Block', sans-serif;
            color: #e3e3e3;
        }
        .cmd-palette-input-wrap {
            display: flex;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 0 1rem;
        }
        .cmd-palette-input-wrap .icon-material {
            color: #888;
            font-size: 18px;
            margin-right: 0.5rem;
        }
        .cmd-palette-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: #fff;
            font-family: inherit;
            font-size: 1rem;
            padding: 0.95rem 0.25rem;
        }
        .cmd-palette-input::placeholder { color: #555; }
        .cmd-palette-list {
            list-style: none;
            margin: 0;
            padding: 0.4rem 0;
            max-height: 50vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .cmd-palette-list::-webkit-scrollbar { width: 6px; }
        .cmd-palette-list::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: 3px;
        }
        .cmd-palette-section {
            padding: 0.4rem 1rem 0.2rem;
            font-size: 0.6875rem;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-weight: 600;
        }
        .cmd-palette-item {
            display: flex;
            align-items: center;
            gap: 0.7rem;
            padding: 0.55rem 1rem;
            cursor: pointer;
            border-left: 2px solid transparent;
            transition: background 0.08s;
        }
        .cmd-palette-item:hover,
        .cmd-palette-item.active {
            background: rgba(102, 126, 234, 0.12);
            border-left-color: #a5b8ff;
        }
        .cmd-palette-item-icon {
            width: 1.5rem;
            height: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #a5b8ff;
        }
        .cmd-palette-item-icon .icon-material { font-size: 18px; }
        .cmd-palette-item-main { flex: 1; min-width: 0; }
        .cmd-palette-item-title {
            font-size: 0.875rem;
            font-weight: 500;
            color: #f0f0f0;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
        }
        .cmd-palette-item-subtitle {
            font-size: 0.75rem;
            color: #888;
            margin-top: 0.05rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .cmd-palette-item-tag {
            font-size: 0.6875rem;
            color: #a5b8ff;
            background: rgba(165, 184, 255, 0.08);
            padding: 0.1rem 0.4rem;
            border-radius: 3px;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            text-transform: lowercase;
            white-space: nowrap;
        }
        .cmd-palette-empty {
            padding: 2rem 1rem;
            text-align: center;
            color: #666;
            font-size: 0.875rem;
        }
        .cmd-palette-footer {
            display: flex;
            justify-content: space-between;
            padding: 0.55rem 1rem;
            border-top: 1px solid rgba(255,255,255,0.06);
            font-size: 0.6875rem;
            color: #666;
        }
        .cmd-palette-footer kbd {
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.625rem;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.08);
            padding: 0.05rem 0.35rem;
            border-radius: 3px;
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
        this._input.value = ''
        this._refresh()
        // Focus next tick so overlay transition picks up
        requestAnimationFrame(() => this._input?.focus())

        document.addEventListener('keydown', this._boundKeydown, true)
    }

    close() {
        if (!this._open) return
        this._open = false
        if (this._overlay) this._overlay.classList.remove('visible')
        document.removeEventListener('keydown', this._boundKeydown, true)
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
            <div class="cmd-palette" role="dialog" aria-label="Command palette">
                <div class="cmd-palette-input-wrap">
                    <span class="icon-material">search</span>
                    <input class="cmd-palette-input" placeholder="Search effects, actions…" autocomplete="off" spellcheck="false">
                </div>
                <ul class="cmd-palette-list"></ul>
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
                sec.textContent = it.section
                fragment.appendChild(sec)
                continue
            }
            if (it.empty) {
                const empty = document.createElement('li')
                empty.className = 'cmd-palette-empty'
                empty.textContent = this._manifestLoaded ? 'No matches.' : 'Loading effects…'
                fragment.appendChild(empty)
                continue
            }
            liIndex += 1
            const li = document.createElement('li')
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
        this._activeIdx = idx
        const items = this._list.querySelectorAll('.cmd-palette-item')
        items.forEach((el, i) => el.classList.toggle('active', i === idx))
        this._scrollActiveIntoView()
    }

    _scrollActiveIntoView() {
        const items = this._list.querySelectorAll('.cmd-palette-item')
        const el = items[this._activeIdx]
        if (!el) return
        const cont = this._list
        const top = el.offsetTop
        const bottom = top + el.offsetHeight
        if (top < cont.scrollTop) cont.scrollTop = top
        else if (bottom > cont.scrollTop + cont.clientHeight) cont.scrollTop = bottom - cont.clientHeight
    }

    _handleKeydown(e) {
        if (!this._open) return
        if (e.key === 'Escape') {
            e.preventDefault()
            this.close()
            return
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            const max = this._linearItems().length - 1
            this._setActive(Math.min(max, this._activeIdx + 1))
            return
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault()
            this._setActive(Math.max(0, this._activeIdx - 1))
            return
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            const item = this._linearItems()[this._activeIdx]
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
