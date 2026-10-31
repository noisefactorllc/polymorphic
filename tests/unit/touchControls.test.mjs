import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { attachTouchControls } from '../../public/js/ui/touchControls.js'

const originalWindow = globalThis.window

afterEach(() => {
    globalThis.window = originalWindow
})

function stubCanvas() {
    const listeners = new Map()
    const removed = []
    return {
        listeners,
        removed,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            removed.push([type, fn])
            const fns = listeners.get(type) || []
            const i = fns.indexOf(fn)
            if (i >= 0) fns.splice(i, 1)
        },
        dispatch(type, event) {
            for (const fn of [...(listeners.get(type) || [])]) fn(event)
        },
        classList: { add() {}, remove() {} },
        offsetWidth: 0
    }
}

function tapEvent(x, y) {
    return { changedTouches: [{ clientX: x, clientY: y }], touches: [] }
}

test('attach returns a detach handle that moves the gestures to a fresh canvas', () => {
    globalThis.window = { ontouchstart: null }
    const events = []
    const dslEditor = { dispatchEvent: e => events.push(e) }
    const canvas = stubCanvas()
    const toggle = []

    const detach = attachTouchControls({
        canvas, dslEditor, onTogglePerformanceMode: () => toggle.push(1)
    })
    assert.equal(typeof detach, 'function')

    canvas.dispatch('touchend', tapEvent(10, 10))
    canvas.dispatch('touchend', tapEvent(11, 11))
    assert.equal(events.length, 1, 'double-tap triggers a recompile while attached')

    detach()
    assert.deepEqual(
        canvas.removed.map(([type]) => type),
        ['touchend', 'touchstart', 'touchmove', 'touchend'],
        'detach releases every gesture listener'
    )
    canvas.dispatch('touchend', tapEvent(12, 12))
    canvas.dispatch('touchend', tapEvent(13, 13))
    assert.equal(events.length, 1, 'a detached canvas stays inert')

    const fresh = stubCanvas()
    const redetach = attachTouchControls({
        canvas: fresh, dslEditor, onTogglePerformanceMode: () => toggle.push(1)
    })
    fresh.dispatch('touchend', tapEvent(10, 10))
    fresh.dispatch('touchend', tapEvent(11, 11))
    assert.equal(events.length, 2, 're-attached gestures work on the fresh canvas')
    redetach()
})

test('attach returns null without touch support or a canvas', () => {
    globalThis.window = {}
    assert.equal(attachTouchControls({ canvas: stubCanvas() }), null)
    globalThis.window = { ontouchstart: null }
    assert.equal(attachTouchControls({}), null)
})
