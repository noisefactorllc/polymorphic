import assert from 'node:assert/strict'
import test from 'node:test'

import { attachScrubber } from '../../public/js/ui/scrubber.js'

function createMockEditor(initialText = 'noise(scale: 80).write(o0)') {
    const listeners = new Map()
    const docListeners = new Map()

    function createClassList() {
        const set = new Set()
        return {
            add(c) { set.add(c) },
            remove(c) { set.delete(c) },
            toggle(c, force) {
                if (force) set.add(c)
                else set.delete(c)
            },
            contains(c) { return set.has(c) },
        }
    }

    const textarea = {
        value: initialText,
        selectionStart: 0,
        selectionEnd: 0,
        style: { userSelect: '', webkitUserSelect: '' },
        classList: createClassList(),
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type) || []
            const idx = list.indexOf(fn)
            if (idx >= 0) list.splice(idx, 1)
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) || []
            for (const fn of list) fn(event)
        },
        setPointerCapture() {},
        releasePointerCapture() {},
    }

    const editor = {
        style: { userSelect: '', webkitUserSelect: '' },
        classList: createClassList(),
        getTextarea: () => textarea,
    }

    return { editor, textarea, listeners, docListeners }
}

test('attachScrubber returns a no-op detach function when textarea is missing', () => {
    const detach = attachScrubber(null)
    assert.equal(typeof detach, 'function')
    detach()
})

test('scrubbing applies user-select: none and scrubber-active to editor and textarea', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const bodyClassList = new Set()
    const docListeners = new Map()

    globalThis.document = {
        body: {
            classList: {
                add(c) { bodyClassList.add(c) },
                remove(c) { bodyClassList.delete(c) },
                contains(c) { return bodyClassList.has(c) },
            },
            appendChild() {},
        },
        getElementById() { return null },
        createElement() {
            return {
                style: {},
                classList: { add() {}, remove() {} },
                querySelector() { return { textContent: '' } },
                remove() {},
            }
        },
        caretPositionFromPoint() {
            return { offsetNode: mock.textarea, offset: 14 }
        },
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, [])
            docListeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const list = docListeners.get(type) || []
            const idx = list.indexOf(fn)
            if (idx >= 0) list.splice(idx, 1)
        },
    }

    globalThis.window = {
        getSelection() {
            return { removeAllRanges() {} }
        },
    }

    let started = false
    let ended = false

    const detach = attachScrubber(mock.editor, {
        onScrubStart: () => { started = true },
        onScrubEnd: () => { ended = true },
    })

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        assert.ok(pointerDownFn, 'pointerdown listener should be registered')

        // Trigger Alt+pointerdown on number literal
        let defaultPrevented = false
        const event = {
            pointerType: 'mouse',
            button: 0,
            altKey: true,
            clientX: 100,
            clientY: 100,
            pointerId: 1,
            preventDefault: () => { defaultPrevented = true },
            stopPropagation: () => {},
        }
        pointerDownFn(event)

        assert.ok(defaultPrevented, 'pointerdown default should be prevented')
        assert.ok(started, 'onScrubStart should have been invoked')

        // Selection guard assertions:
        assert.ok(mock.editor.classList.contains('scrubber-active'), 'editor should have scrubber-active class')
        assert.equal(mock.editor.style.userSelect, 'none', 'editor style userSelect should be none')
        assert.equal(mock.textarea.style.userSelect, 'none', 'textarea style userSelect should be none')
        assert.ok(bodyClassList.has('scrubber-active-cursor'), 'body should have scrubber-active-cursor')

        // Verify selectstart is prevented during active scrub
        const selectStartFn = docListeners.get('selectstart')?.[0]
        assert.ok(selectStartFn, 'selectstart listener should be active')
        let selectPrevented = false
        selectStartFn({ preventDefault: () => { selectPrevented = true } })
        assert.ok(selectPrevented, 'selectstart event should be prevented during scrub')

        // Trigger pointerup
        const pointerUpFn = mock.listeners.get('pointerup')?.[0]
        assert.ok(pointerUpFn, 'pointerup listener should be registered')
        pointerUpFn({ pointerId: 1 })

        assert.ok(ended, 'onScrubEnd should have been invoked')
        assert.ok(!mock.editor.classList.contains('scrubber-active'), 'editor should no longer have scrubber-active class')
        assert.equal(mock.editor.style.userSelect, '', 'editor userSelect should be reset')
        assert.equal(mock.textarea.style.userSelect, '', 'textarea userSelect should be reset')
        assert.ok(!bodyClassList.has('scrubber-active-cursor'), 'body should no longer have scrubber-active-cursor')
        assert.equal(docListeners.get('selectstart')?.length || 0, 0, 'selectstart listener should be removed on pointerup')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('scrubbing can be cancelled with Escape, restoring original text and removing guard', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const bodyClassList = new Set()
    const docListeners = new Map()

    globalThis.document = {
        body: {
            classList: {
                add(c) { bodyClassList.add(c) },
                remove(c) { bodyClassList.delete(c) },
                contains(c) { return bodyClassList.has(c) },
            },
            appendChild() {},
        },
        getElementById() { return null },
        createElement() {
            return {
                style: {},
                classList: { add() {}, remove() {} },
                querySelector() { return { textContent: '' } },
                remove() {},
            }
        },
        caretPositionFromPoint() {
            return { offsetNode: mock.textarea, offset: 14 }
        },
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, [])
            docListeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const list = docListeners.get(type) || []
            const idx = list.indexOf(fn)
            if (idx >= 0) list.splice(idx, 1)
        },
    }

    globalThis.window = {
        getSelection() {
            return { removeAllRanges() {} }
        },
    }

    let recompiled = false

    const detach = attachScrubber(mock.editor, {
        recompile: () => { recompiled = true },
    })

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        pointerDownFn({
            pointerType: 'mouse',
            button: 0,
            altKey: true,
            clientX: 100,
            clientY: 100,
            pointerId: 1,
            preventDefault: () => {},
            stopPropagation: () => {},
        })

        assert.ok(mock.editor.classList.contains('scrubber-active'))

        // Move pointer to scrub value
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        pointerMoveFn({ clientX: 150, clientY: 100, shiftKey: false, altKey: true })

        assert.notEqual(mock.textarea.value, 'noise(scale: 80).write(o0)', 'textarea value should change on scrub')

        // Hit Escape key
        const keyDownFn = docListeners.get('keydown')?.[0]
        assert.ok(keyDownFn, 'keydown listener should be attached')
        keyDownFn({ key: 'Escape' })

        // Value must be restored
        assert.equal(mock.textarea.value, 'noise(scale: 80).write(o0)', 'original value must be restored on Escape')
        assert.ok(!mock.editor.classList.contains('scrubber-active'), 'scrubber-active should be removed')
        assert.equal(mock.editor.style.userSelect, '', 'userSelect should be reset')
        assert.equal(mock.textarea.style.userSelect, '', 'userSelect should be reset')
        assert.ok(recompiled, 'recompile should trigger after abort')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('Alt keydown and keyup update hover target state', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const docListeners = new Map()

    globalThis.document = {
        body: {
            classList: { add() {}, remove() {}, contains() { return false } },
            appendChild() {},
        },
        getElementById() { return null },
        createElement() {
            return { style: {}, querySelector() { return { textContent: '' } }, remove() {} }
        },
        caretPositionFromPoint() {
            return { offsetNode: mock.textarea, offset: 14 }
        },
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, [])
            docListeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const list = docListeners.get(type) || []
            const idx = list.indexOf(fn)
            if (idx >= 0) list.splice(idx, 1)
        },
    }

    globalThis.window = {}

    const detach = attachScrubber(mock.editor)

    try {
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const keyDownFn = docListeners.get('keydown')?.[0]
        const keyUpFn = docListeners.get('keyup')?.[0]

        // Move pointer over number without Alt
        pointerMoveFn({ clientX: 100, clientY: 100, altKey: false })
        assert.ok(!mock.textarea.classList.contains('scrubber-hover-target'), 'should not hover without Alt')

        // Press Alt key down
        keyDownFn({ key: 'Alt' })
        assert.ok(mock.textarea.classList.contains('scrubber-hover-target'), 'should hover when Alt key pressed')

        // Release Alt key up
        keyUpFn({ key: 'Alt' })
        assert.ok(!mock.textarea.classList.contains('scrubber-hover-target'), 'should clear hover when Alt key released')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('pointerleave clears hover and resets pointer coordinates', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const docListeners = new Map()

    globalThis.document = {
        body: {
            classList: { add() {}, remove() {}, contains() { return false } },
            appendChild() {},
        },
        getElementById() { return null },
        createElement() {
            return { style: {}, querySelector() { return { textContent: '' } }, remove() {} }
        },
        caretPositionFromPoint() {
            return { offsetNode: mock.textarea, offset: 14 }
        },
        addEventListener(type, fn) {
            if (!docListeners.has(type)) docListeners.set(type, [])
            docListeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const list = docListeners.get(type) || []
            const idx = list.indexOf(fn)
            if (idx >= 0) list.splice(idx, 1)
        },
    }

    globalThis.window = {}

    const detach = attachScrubber(mock.editor)

    try {
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const pointerLeaveFn = mock.listeners.get('pointerleave')?.[0]
        const keyDownFn = docListeners.get('keydown')?.[0]

        assert.ok(pointerLeaveFn, 'pointerleave listener should be registered')

        // Move pointer over number with Alt -> hovering
        pointerMoveFn({ clientX: 100, clientY: 100, altKey: true })
        assert.ok(mock.textarea.classList.contains('scrubber-hover-target'), 'should hover with Alt over number')

        // Pointer leaves textarea
        pointerLeaveFn()
        assert.ok(!mock.textarea.classList.contains('scrubber-hover-target'), 'hover should be removed on pointerleave')

        // Pressing Alt after leaving must NOT resurrect hover on stale coordinates
        keyDownFn({ key: 'Alt' })
        assert.ok(!mock.textarea.classList.contains('scrubber-hover-target'), 'stale coordinates must not resurrect hover')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

