import assert from 'node:assert/strict'
import test from 'node:test'

import { createCursorIdleHider, CURSOR_IDLE_MS } from '../../public/js/ui/cursorIdle.js'

function createMockBody() {
    const set = new Set()
    return {
        classList: {
            add(c) { set.add(c) },
            remove(c) { set.delete(c) },
            contains(c) { return set.has(c) },
        },
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
        dispatch(type) {
            for (const fn of (listeners.get(type) || [])) fn({})
        },
    }
}

test('cursor hides after the idle timeout and restores instantly on activity', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win)

    hider.start()
    assert.equal(win.timerMs(), CURSOR_IDLE_MS)
    assert.equal(body.classList.contains('cursor-idle'), false)

    hider.fireIdle()
    assert.equal(body.classList.contains('cursor-idle'), true)

    win.dispatch('pointermove')
    assert.equal(body.classList.contains('cursor-idle'), false)
    // Timer re-armed by the activity.
    assert.notEqual(win.timerFn(), null)
    win.timerFn()()
    assert.equal(body.classList.contains('cursor-idle'), true)
})

test('every activity event type restores the cursor and re-arms the timer', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win)
    hider.start()

    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
        hider.fireIdle()
        assert.equal(body.classList.contains('cursor-idle'), true, type)
        win.dispatch(type)
        assert.equal(body.classList.contains('cursor-idle'), false, type)
    }
})

test('stop removes the class, listeners, and pending timer', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win)

    hider.start()
    hider.stop()
    assert.equal(body.classList.contains('cursor-idle'), false)
    assert.equal(hider.active, false)
    assert.equal(win.timerFn(), null)
    assert.equal(win.listeners.get('pointermove').length, 0)

    // No resurrection from late activity or a stale idle callback.
    win.dispatch('pointermove')
    hider.fireIdle()
    assert.equal(body.classList.contains('cursor-idle'), false)
})

test('start is idempotent and does not stack listeners', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win)

    hider.start()
    hider.start()
    assert.equal(win.listeners.get('pointermove').length, 1)
    assert.equal(hider.active, true)
})

test('idle duration is configurable', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win, 500)
    hider.start()
    assert.equal(win.timerMs(), 500)
})

test('start while already idle reschedules instead of leaving the cursor hidden', () => {
    const body = createMockBody()
    const win = createMockWindow()
    const hider = createCursorIdleHider(body, win)

    hider.start()
    hider.fireIdle()
    hider.stop()
    hider.start()
    assert.equal(body.classList.contains('cursor-idle'), false)
})
