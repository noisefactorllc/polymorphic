import assert from 'node:assert/strict'
import test from 'node:test'

import { CommandPalette } from '../../public/js/ui/commandPalette.js'

function createMockDom() {
    const listeners = new Map()

    function createClassList() {
        const set = new Set()
        return {
            add(c) { set.add(c) },
            remove(c) { set.delete(c) },
            toggle(c, force) {
                if (force === undefined) {
                    if (set.has(c)) set.delete(c); else set.add(c)
                } else if (force) {
                    set.add(c)
                } else {
                    set.delete(c)
                }
            },
            contains(c) { return set.has(c) }
        }
    }

    function createElement(tag) {
        const attrs = new Map()
        const children = []
        const classes = createClassList()
        const elListeners = new Map()
        let value = ''

        const el = {
            tagName: tag.toUpperCase(),
            style: {},
            classList: classes,
            get className() {
                return Array.from(classes).join(' ')
            },
            set className(val) {
                val.split(/\s+/).filter(Boolean).forEach(c => classes.add(c))
            },
            dataset: {},
            id: '',
            offsetTop: 0,
            offsetHeight: 30,
            scrollTop: 0,
            scrollHeight: 300,
            clientHeight: 150,
            scrollIntoViewCalls: [],
            scrollIntoView(opts) {
                this.scrollIntoViewCalls.push(opts)
            },
            get value() { return value },
            set value(v) { value = v },
            focus() {},
            blur() {},
            setAttribute(name, val) {
                attrs.set(name, String(val))
                if (name === 'id') this.id = String(val)
            },
            getAttribute(name) { return attrs.get(name) ?? null },
            removeAttribute(name) { attrs.delete(name) },
            appendChild(child) {
                if (child && child.isFragment) {
                    const transferred = [...child.children]
                    for (const fragChild of transferred) {
                        children.push(fragChild)
                        fragChild.parentElement = el
                    }
                    child.children.length = 0
                    return child
                }
                children.push(child)
                child.parentElement = el
                return child
            },
            removeChild(child) {
                const idx = children.indexOf(child)
                if (idx >= 0) children.splice(idx, 1)
                child.parentElement = null
                return child
            },
            querySelectorAll(sel) {
                const results = []
                function walk(node) {
                    if (!node || !node.children) return
                    for (const ch of node.children) {
                        if (!ch) continue
                        if (sel.startsWith('.') && ch.classList?.contains(sel.slice(1))) {
                            results.push(ch)
                        } else if (sel.startsWith('#') && ch.id === sel.slice(1)) {
                            results.push(ch)
                        } else if (ch.tagName && ch.tagName.toLowerCase() === sel.toLowerCase()) {
                            results.push(ch)
                        }
                        walk(ch)
                    }
                }
                walk({ children })
                return results
            },
            querySelector(sel) {
                return this.querySelectorAll(sel)[0] || null
            },
            addEventListener(type, fn) {
                if (!elListeners.has(type)) elListeners.set(type, [])
                elListeners.get(type).push(fn)
            },
            removeEventListener(type, fn) {
                const list = elListeners.get(type) || []
                const idx = list.indexOf(fn)
                if (idx >= 0) list.splice(idx, 1)
            },
            dispatchEvent(event) {
                const list = elListeners.get(event.type) || []
                for (const fn of list) fn(event)
            },
            get children() { return children },
            get innerHTML() { return '' },
            set innerHTML(html) {
                children.length = 0
                if (html.includes('cmd-palette-input-wrap')) {
                    const wrap = createElement('div')
                    wrap.className = 'cmd-palette-input-wrap'
                    const inp = createElement('input')
                    inp.className = 'cmd-palette-input'
                    inp.setAttribute('role', 'combobox')
                    inp.setAttribute('aria-haspopup', 'listbox')
                    inp.setAttribute('aria-expanded', 'false')
                    wrap.appendChild(inp)
                    const ul = createElement('ul')
                    ul.className = 'cmd-palette-list'
                    const foot = createElement('div')
                    foot.className = 'cmd-palette-footer'
                    children.push(wrap, ul, foot)
                }
            }
        }
        return el
    }

    const documentMock = {
        createElement,
        createDocumentFragment() {
            const fragmentChildren = []
            return {
                isFragment: true,
                appendChild(child) { fragmentChildren.push(child); return child },
                get children() { return fragmentChildren },
                forEach(cb) { fragmentChildren.forEach(cb) }
            }
        },
        getElementById(id) {
            return null
        },
        addEventListener(type, fn, capture) {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type).push({ fn, capture })
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type) || []
            const idx = list.findIndex(entry => entry.fn === fn)
            if (idx >= 0) list.splice(idx, 1)
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) || []
            for (const { fn } of list) fn(event)
        },
        body: createElement('body'),
        head: createElement('head')
    }

    return { documentMock, createElement }
}

function setupPaletteFixture() {
    const { documentMock } = createMockDom()
    const origDoc = globalThis.document
    const origRAF = globalThis.requestAnimationFrame

    globalThis.document = documentMock
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1 }

    const palette = new CommandPalette()
    palette.init({ onInsert: () => {} })

    const actions = [
        { id: 'act-0', title: 'Action Zero', run: () => {} },
        { id: 'act-1', title: 'Action One', run: () => {} },
        { id: 'act-2', title: 'Action Two', run: () => {} },
        { id: 'act-3', title: 'Action Three', run: () => {} },
        { id: 'act-4', title: 'Action Four', run: () => {} },
        { id: 'act-5', title: 'Action Five', run: () => {} },
        { id: 'act-6', title: 'Action Six', run: () => {} },
        { id: 'act-7', title: 'Action Seven', run: () => {} },
    ]
    for (const a of actions) palette.registerAction(a)

    function cleanup() {
        palette.close()
        globalThis.document = origDoc
        globalThis.requestAnimationFrame = origRAF
    }

    return { palette, actions, cleanup, documentMock }
}

test('command palette: ArrowDown wraps from last item to first item', () => {
    const { palette, actions, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        const count = palette._linearItems().length
        assert.equal(count, actions.length)
        assert.equal(palette._activeIdx, 0)

        // Move to last item
        for (let i = 0; i < count - 1; i++) {
            palette._handleKeydown({ key: 'ArrowDown', preventDefault() {} })
        }
        assert.equal(palette._activeIdx, count - 1)

        // Press ArrowDown again -> wraps to 0
        palette._handleKeydown({ key: 'ArrowDown', preventDefault() {} })
        assert.equal(palette._activeIdx, 0)
    } finally {
        cleanup()
    }
})

test('command palette: ArrowUp wraps from first item to last item', () => {
    const { palette, actions, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        const count = palette._linearItems().length
        assert.equal(palette._activeIdx, 0)

        // Press ArrowUp on index 0 -> wraps to count - 1
        palette._handleKeydown({ key: 'ArrowUp', preventDefault() {} })
        assert.equal(palette._activeIdx, count - 1)

        // Press ArrowDown -> wraps back to 0
        palette._handleKeydown({ key: 'ArrowDown', preventDefault() {} })
        assert.equal(palette._activeIdx, 0)
    } finally {
        cleanup()
    }
})

test('command palette: PageDown and PageUp advance and retreat predictably', () => {
    const { palette, actions, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        const count = palette._linearItems().length
        assert.equal(palette._activeIdx, 0)

        palette._handleKeydown({ key: 'PageDown', preventDefault() {} })
        assert.ok(palette._activeIdx > 0 && palette._activeIdx < count)

        const pagePos = palette._activeIdx
        palette._handleKeydown({ key: 'PageUp', preventDefault() {} })
        assert.equal(palette._activeIdx, 0)
    } finally {
        cleanup()
    }
})

test('command palette: empty search query gracefully ignores arrow keys and Enter', () => {
    const { palette, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        palette._input.value = 'nonexistent_pattern_xyz_12345'
        palette._refresh()

        const linear = palette._linearItems()
        assert.equal(linear.length, 0)

        // Arrow keys and Enter must not throw or change active index to invalid state
        let prevented = false
        const evt = { key: 'ArrowDown', preventDefault() { prevented = true } }
        palette._handleKeydown(evt)
        assert.equal(prevented, true)

        palette._handleKeydown({ key: 'ArrowUp', preventDefault() {} })
        palette._handleKeydown({ key: 'PageDown', preventDefault() {} })
        palette._handleKeydown({ key: 'PageUp', preventDefault() {} })
        palette._handleKeydown({ key: 'Enter', preventDefault() {} })

        assert.equal(palette._activeIdx, 0)
    } finally {
        cleanup()
    }
})

test('command palette: Enter invokes active item and closes', async () => {
    const { palette, cleanup } = setupPaletteFixture()
    try {
        let executed = false
        palette.registerAction({
            id: 'test-exec',
            title: 'Test Execution',
            run: () => { executed = true }
        })
        palette.open()
        palette._input.value = 'Test Execution'
        palette._refresh()

        assert.equal(palette._activeIdx, 0)
        assert.equal(palette._open, true)

        palette._handleKeydown({ key: 'Enter', preventDefault() {} })
        assert.equal(palette._open, false)
        assert.equal(executed, true)
    } finally {
        cleanup()
    }
})

test('command palette: Escape closes without invocation', () => {
    const { palette, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        assert.equal(palette._open, true)

        palette._handleKeydown({ key: 'Escape', preventDefault() {} })
        assert.equal(palette._open, false)
    } finally {
        cleanup()
    }
})

test('command palette: ARIA attributes maintain combobox and active-descendant contract', () => {
    const { palette, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        assert.equal(palette._input.getAttribute('role'), 'combobox')
        assert.equal(palette._input.getAttribute('aria-haspopup'), 'listbox')
        assert.equal(palette._input.getAttribute('aria-expanded'), 'true')
        assert.equal(palette._input.getAttribute('aria-activedescendant'), 'cmd-palette-item-0')

        palette._handleKeydown({ key: 'ArrowDown', preventDefault() {} })
        assert.equal(palette._input.getAttribute('aria-activedescendant'), 'cmd-palette-item-1')

        palette.close()
        assert.equal(palette._input.getAttribute('aria-expanded'), 'false')
        assert.equal(palette._input.getAttribute('aria-activedescendant'), null)
    } finally {
        cleanup()
    }
})

test('command palette: scroll position synchronization on wrap and navigation', () => {
    const { palette, actions, cleanup } = setupPaletteFixture()
    try {
        palette.open()
        const count = palette._linearItems().length
        assert.equal(count, actions.length)

        // Mock list container scrollHeight
        palette._list.scrollHeight = 500
        palette._list.clientHeight = 150

        // Wrap to last item via ArrowUp
        palette._handleKeydown({ key: 'ArrowUp', preventDefault() {} })
        assert.equal(palette._activeIdx, count - 1)
        assert.equal(palette._list.scrollTop, 500)

        // Wrap to first item via ArrowDown
        palette._handleKeydown({ key: 'ArrowDown', preventDefault() {} })
        assert.equal(palette._activeIdx, 0)
        assert.equal(palette._list.scrollTop, 0)

        // Check that active item has scrollIntoView called
        const activeEl = palette._list.querySelectorAll('.cmd-palette-item')[0]
        assert.ok(activeEl.scrollIntoViewCalls.length > 0)
        assert.deepEqual(activeEl.scrollIntoViewCalls[activeEl.scrollIntoViewCalls.length - 1], {
            block: 'nearest',
            inline: 'nearest'
        })
    } finally {
        cleanup()
    }
})

