import assert from 'node:assert/strict'
import test from 'node:test'

import {
    createCursorIdleHider,
    createCursorDot,
    CURSOR_IDLE_MS,
    CURSOR_FADE_MS,
} from '../../public/js/ui/cursorIdle.js'

function createMockBody() {
    const set = new Set()
    const children = []
    const body = {
        classList: {
            add(c) { set.add(c) },
            remove(c) { set.delete(c) },
            contains(c) { return set.has(c) },
        },
        appendChild(node) { children.push(node); node.parentNode = body },
        removeChild(node) {
            const i = children.indexOf(node)
            if (i !== -1) children.splice(i, 1)
            node.parentNode = null
        },
        children,
    }
    return body
}

function createMockElement() {
    const set = new Set()
    return {
        className: '',
        style: {},
        attrs: {},
        parentNode: null,
        classList: {
            add(c) { set.add(c) },
            remove(c) { set.delete(c) },
            contains(c) { return set.has(c) },
        },
        setAttribute(k, v) { this.attrs[k] = v },
    }
}

/**
 * Minimal window stand-in: records listeners and timer callbacks so tests can
 * dispatch activity events and fire the idle timer manually (no real timers).
 */
function createMockWindow() {
    const listeners = new Map()
    let timerFn = null
    let timerMs = null
    return {
        listeners,
        timerFn: () => timerFn,
        timerMs: () => timerMs,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            const fns = listeners.get(type) || []
            const i = fns.indexOf(fn)
            if (i !== -1) fns.splice(i, 1)
        },
        clearTimeout() { timerFn = null },
        setTimeout(fn, ms) { timerFn = fn; timerMs = ms },
        dispatch(type, event = {}) {
            for (const fn of (listeners.get(type) || [])) fn(event)
        },
    }
}

function createMockDoc() {
    const doc = {
        body: createMockBody(),
        created: [],
        createElement() {
            const el = createMockElement()
            doc.created.push(el)
            return el
        },
    }
    return doc
}

test('cursor dot fades after the idle timeout and restores instantly on activity', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)

    hider.start()
    assert.equal(win.timerMs(), CURSOR_IDLE_MS)
    assert.equal(doc.body.classList.contains('cursor-idle'), false)

    // Pointer movement creates and positions the rendered cursor dot.
    win.dispatch('pointermove', { clientX: 120, clientY: 88 })
    assert.equal(doc.body.children.length, 1)
    assert.equal(doc.created[0].className, 'cursor-fade-dot')
    assert.equal(doc.created[0].style.left, '120px')
    assert.equal(doc.created[0].style.top, '88px')
    assert.equal(doc.created[0].attrs['aria-hidden'], 'true')

    // Idle fades the dot out (class drives the CSS opacity transition).
    hider.fireIdle()
    assert.equal(doc.body.classList.contains('cursor-idle'), true)
    assert.equal(doc.created[0].classList.contains('cursor-idle'), true)

    // Activity restores instantly: idle classes drop with no pending fade delay.
    win.dispatch('pointermove', { clientX: 130, clientY: 90 })
    assert.equal(doc.body.classList.contains('cursor-idle'), false)
    assert.equal(doc.created[0].classList.contains('cursor-idle'), false)
    assert.equal(doc.created[0].style.left, '130px')
    assert.notEqual(win.timerFn(), null)
    win.timerFn()()
    assert.equal(doc.body.classList.contains('cursor-idle'), true)
})

test('dot is only created lazily on pointer movement with coordinates', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)

    hider.start()
    // Keyboard activity carries no coordinates — no dot is created.
    win.dispatch('keydown', {})
    assert.equal(doc.created.length, 0)

    win.dispatch('pointermove', { clientX: 5, clientY: 6 })
    assert.equal(doc.created.length, 1)
    // Subsequent movement reuses the same element.
    win.dispatch('pointermove', { clientX: 7, clientY: 8 })
    assert.equal(doc.created.length, 1)
    assert.equal(doc.created[0].style.left, '7px')
})

test('every activity event type restores the cursor and re-arms the timer', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)
    hider.start()

    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
        hider.fireIdle()
        assert.equal(doc.body.classList.contains('cursor-idle'), true, type)
        win.dispatch(type, { clientX: 1, clientY: 2 })
        assert.equal(doc.body.classList.contains('cursor-idle'), false, type)
    }
})

test('stop removes the class, listeners, pending timer, and the dot element', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)

    hider.start()
    win.dispatch('pointermove', { clientX: 10, clientY: 20 })
    hider.stop()
    assert.equal(doc.body.classList.contains('cursor-idle'), false)
    assert.equal(hider.active, false)
    assert.equal(win.timerFn(), null)
    assert.equal(win.listeners.get('pointermove').length, 0)
    assert.equal(hider.dot, null)
    assert.equal(doc.body.children.length, 0)

    // No resurrection from late activity or a stale idle callback.
    win.dispatch('pointermove', { clientX: 11, clientY: 21 })
    hider.fireIdle()
    assert.equal(doc.body.classList.contains('cursor-idle'), false)
})

test('start is idempotent and does not stack listeners', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)

    hider.start()
    hider.start()
    assert.equal(win.listeners.get('pointermove').length, 1)
    assert.equal(hider.active, true)
})

test('start while already idle reschedules instead of leaving the cursor faded', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, CURSOR_IDLE_MS, doc)

    hider.start()
    hider.fireIdle()
    hider.stop()
    hider.start()
    assert.equal(doc.body.classList.contains('cursor-idle'), false)
})

test('idle duration is configurable and the fade duration is exported', () => {
    const doc = createMockDoc()
    const win = createMockWindow()
    const hider = createCursorIdleHider(doc.body, win, 500)
    hider.start()
    assert.equal(win.timerMs(), 500)
    assert.equal(CURSOR_FADE_MS, 500)
})

test('createCursorDot without a doc throws', () => {
    assert.throws(() => createCursorDot(null))
})
