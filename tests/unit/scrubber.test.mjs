import assert from 'node:assert/strict'
import test from 'node:test'

import {
    attachScrubber,
    inferStep,
    resolveScrubAccel,
    formatScrubValue,
    findParamContext,
    resolveParamBounds,
} from '../../public/js/ui/scrubber.js'
import { getSelectionOrBlock } from '../../public/js/ui/editorActions.js'

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
        documentElement: { clientWidth: 900 },
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
                offsetWidth: 180,
                offsetHeight: 44,
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
        innerHeight: 550,
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
        documentElement: { clientWidth: 900 },
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
                offsetWidth: 180,
                offsetHeight: 44,
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
        innerHeight: 550,
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

test('inferStep correctly determines base step from numeric literal string', () => {
    assert.equal(inferStep('80'), 1)
    assert.equal(inferStep('0'), 1)
    assert.equal(inferStep('-12'), 1)
    assert.equal(inferStep('1.5'), 0.1)
    assert.equal(inferStep('0.05'), 0.01)
    assert.equal(inferStep('3.1415'), 0.0001)
    assert.equal(inferStep('.5'), 0.1)
    assert.equal(inferStep('2.'), 1)
})

test('resolveScrubAccel computes modifier acceleration factors', () => {
    assert.equal(resolveScrubAccel({}), 1, 'default rate is 1x')
    assert.equal(resolveScrubAccel({ shiftKey: true }), 0.1, 'shift provides fine 0.1x')
    assert.equal(resolveScrubAccel({ metaKey: true }), 10, 'meta provides coarse 10x')
    assert.equal(resolveScrubAccel({ ctrlKey: true }), 10, 'ctrl provides coarse 10x')
    assert.equal(resolveScrubAccel({ shiftKey: true, metaKey: true }), 0.01, 'shift+meta provides ultra-fine 0.01x')
    assert.equal(resolveScrubAccel({ shiftKey: true, ctrlKey: true }), 0.01, 'shift+ctrl provides ultra-fine 0.01x')
})

test('formatScrubValue preserves integers and expands decimal precision for fine scrubbing', () => {
    // Integer literals stay integers
    assert.equal(formatScrubValue(85, '80', 1), '85')
    assert.equal(formatScrubValue(80.4, '80', 0.1), '80')
    assert.equal(formatScrubValue(80.6, '80', 0.1), '81')
    assert.equal(formatScrubValue(0, '0', 1), '0')

    // Decimals expand precision when fine-scrubbed
    assert.equal(formatScrubValue(1.5, '1.5', 1), '1.5')
    assert.equal(formatScrubValue(1.52, '1.5', 0.1), '1.52', 'fine scrub allows 2 decimals on 1-decimal original')
    assert.equal(formatScrubValue(1.503, '1.5', 0.01), '1.503', 'ultra-fine scrub allows 3 decimals')
    assert.equal(formatScrubValue(0.052, '0.05', 0.1), '0.052')

    // Trailing dot preserves dot
    assert.equal(formatScrubValue(3, '2.', 1), '3.')
    assert.equal(formatScrubValue(2.4, '2.', 0.1), '2.4')
})

test('findParamContext accurately extracts enclosing function and parameter name', () => {
    const dsl1 = 'perlin(scale: 75, octaves: 2)'
    const idxScale = dsl1.indexOf('75')
    assert.deepEqual(findParamContext(dsl1, idxScale), { func: 'perlin', param: 'scale' })

    const idxOctaves = dsl1.indexOf('2')
    assert.deepEqual(findParamContext(dsl1, idxOctaves), { func: 'perlin', param: 'octaves' })

    const dsl2 = 'noise(scaleX: osc(type: sine, min: 25, max: 100))'
    const idxMin = dsl2.indexOf('25')
    assert.deepEqual(findParamContext(dsl2, idxMin), { func: 'osc', param: 'min' })

    const dsl3 = 'blur(10)'
    const idxBlur = dsl3.indexOf('10')
    assert.deepEqual(findParamContext(dsl3, idxBlur), { func: 'blur', param: null })
})

test('resolveParamBounds resolves built-in boundaries and respects custom providers', () => {
    // Built-in bounds
    assert.deepEqual(resolveParamBounds('perlin', 'octaves'), { min: 1, max: 8, isInt: true })
    assert.deepEqual(resolveParamBounds('adjust', 'rotation'), { min: -180, max: 180, isInt: false })
    assert.deepEqual(resolveParamBounds('adjust', 'contrast'), { min: 0, max: 1, isInt: false })
    assert.deepEqual(resolveParamBounds('posterize', 'levels'), { min: 1, max: 256, isInt: true })

    // Generic parameter heuristic
    assert.deepEqual(resolveParamBounds('unknownFunc', 'opacity'), { min: 0, max: 1, isInt: false })
    assert.deepEqual(resolveParamBounds('unknownFunc', 'seed'), { min: 0, max: null, isInt: true })

    // Unknown returns null
    assert.equal(resolveParamBounds('unknownFunc', 'customParamXYZ'), null)

    // Custom provider option
    const customProvider = (f, p) => (f === 'custom' && p === 'zoom' ? { min: 0.1, max: 10, isInt: false } : null)
    assert.deepEqual(resolveParamBounds('custom', 'zoom', customProvider), { min: 0.1, max: 10, isInt: false })
})

test('releasing a scrub collapses the selection so block evaluation sees the surrounding block', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const docListeners = new Map()

    globalThis.document = {
        documentElement: { clientWidth: 900 },
        body: {
            classList: { add() {}, remove() {}, contains() { return false } },
            appendChild() {},
        },
        getElementById() { return null },
        createElement() {
            return {
                style: {},
                offsetWidth: 180,
                offsetHeight: 44,
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
        innerHeight: 550,
        getSelection() { return { removeAllRanges() {} } },
    }

    let ended = false
    const detach = attachScrubber(mock.editor, {
        onScrubEnd: () => { ended = true },
    })

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const pointerUpFn = mock.listeners.get('pointerup')?.[0]

        // Start scrub on the literal 80 (offsets 13-15)
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

        // Drag 20px right: 80 -> 100, scrubber seeds a selection over the literal
        pointerMoveFn({ clientX: 120, clientY: 100, altKey: true })
        assert.equal(mock.textarea.value, 'noise(scale: 100).write(o0)')
        assert.equal(mock.textarea.selectionStart, 13)
        assert.equal(mock.textarea.selectionEnd, 16)

        // Release: the seeded selection must collapse, not span the literal
        pointerUpFn({ pointerId: 1 })
        assert.ok(ended, 'onScrubEnd should have been invoked')
        assert.equal(mock.textarea.selectionStart, mock.textarea.selectionEnd,
            'no active selection may remain after the scrub is released')

        // Selection-based block evaluation must now resolve the block
        const sel = getSelectionOrBlock(mock.editor)
        assert.ok(sel, 'block selection should resolve')
        assert.equal(sel.text, 'noise(scale: 100).write(o0)')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('smooth dragging eliminates jump when Shift modifier is pressed mid-drag', () => {
    const mock = createMockEditor('noise(scale: 80).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const bodyClassList = new Set()
    const docListeners = new Map()

    globalThis.document = {
        documentElement: { clientWidth: 900 },
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
                offsetWidth: 180,
                offsetHeight: 44,
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
        innerHeight: 550,
        getSelection() { return { removeAllRanges() {} } },
    }

    const detach = attachScrubber(mock.editor)

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const pointerUpFn = mock.listeners.get('pointerup')?.[0]

        // Start scrub on 80
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

        // Drag 20px right with no modifier -> value increases from 80 to 100
        pointerMoveFn({ clientX: 120, clientY: 100, altKey: true, shiftKey: false })
        assert.equal(mock.textarea.value, 'noise(scale: 100).write(o0)', 'initial 20px drag moves value to 100')

        // Now press Shift mid-drag and move 10px further right (from 120 to 130)
        // With 0.1x acceleration, 10px adds 1 unit (100 -> 101).
        // It must NOT snap back to 53 (which old implementation did: 80 + 30 * 0.1 = 83)!
        pointerMoveFn({ clientX: 130, clientY: 100, altKey: true, shiftKey: true })
        assert.equal(mock.textarea.value, 'noise(scale: 101).write(o0)', 'subsequent fine drag advances smoothly from 100 to 101')

        // Move 10px with Meta (coarse scrub: 10x rate from 101 -> 101 + 10 * 10 = 201)
        pointerMoveFn({ clientX: 140, clientY: 100, altKey: true, metaKey: true })
        assert.equal(mock.textarea.value, 'noise(scale: 201).write(o0)', 'coarse drag advances from 201 without jumping')

        pointerUpFn({ pointerId: 1 })
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('boundary clamping prevents out-of-range values and reverses immediately without dead-zone', () => {
    const mock = createMockEditor('perlin(scale: 75, octaves: 2).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const bodyClassList = new Set()
    const docListeners = new Map()

    globalThis.document = {
        documentElement: { clientWidth: 900 },
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
                offsetWidth: 180,
                offsetHeight: 44,
                classList: { add() {}, remove() {} },
                querySelector() { return { textContent: '' } },
                remove() {},
            }
        },
        caretPositionFromPoint() {
            // Index of octaves: 2
            return { offsetNode: mock.textarea, offset: 27 }
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
        innerHeight: 550,
        getSelection() { return { removeAllRanges() {} } },
    }

    const detach = attachScrubber(mock.editor)

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const pointerUpFn = mock.listeners.get('pointerup')?.[0]

        // Start scrub on octaves: 2 (min: 1, max: 8)
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

        // Drag 50px left (dx = -50) -> clamps at min 1
        pointerMoveFn({ clientX: 50, clientY: 100, altKey: true })
        assert.equal(mock.textarea.value, 'perlin(scale: 75, octaves: 1).write(o0)', 'clamps at lower bound 1')

        // Drag 100px right (dx = +100 from 50 -> 150) -> clamps at max 8
        pointerMoveFn({ clientX: 150, clientY: 100, altKey: true })
        assert.equal(mock.textarea.value, 'perlin(scale: 75, octaves: 8).write(o0)', 'clamps at upper bound 8')

        // Immediately drag 1px left (from 150 to 149) -> responds immediately to 7 (no dead-zone delay!)
        pointerMoveFn({ clientX: 149, clientY: 100, altKey: true })
        assert.equal(mock.textarea.value, 'perlin(scale: 75, octaves: 7).write(o0)', 'reverses immediately without dead-zone lag')

        pointerUpFn({ pointerId: 1 })
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})

test('tooltip reflects fine, ultra-fine, and coarse modifier states and boundary indicators', () => {
    const mock = createMockEditor('perlin(scale: 75, octaves: 2).write(o0)')
    const prevDoc = globalThis.document
    const prevWindow = globalThis.window

    const bodyClassList = new Set()
    const docListeners = new Map()

    let createdTooltip = null
    const tooltipMock = {
        style: {},
        offsetWidth: 180,
        offsetHeight: 44,
        className: '',
        innerHTML: '',
        querySelector(sel) {
            if (sel === '.scrubber-tooltip-value') return this._valEl || (this._valEl = { textContent: '' })
            if (sel === '.scrubber-tooltip-hint') return this._hintEl || (this._hintEl = { textContent: '', innerHTML: '' })
            return null
        },
        remove() { createdTooltip = null },
    }

    globalThis.document = {
        documentElement: { clientWidth: 900 },
        body: {
            classList: {
                add(c) { bodyClassList.add(c) },
                remove(c) { bodyClassList.delete(c) },
                contains(c) { return bodyClassList.has(c) },
            },
            appendChild(el) { createdTooltip = el },
        },
        getElementById() { return null },
        createElement(tag) {
            if (tag === 'div') return tooltipMock
            return { style: {}, querySelector() { return { textContent: '' } }, remove() {} }
        },
        caretPositionFromPoint() {
            return { offsetNode: mock.textarea, offset: 27 }
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
        innerHeight: 550,
        getSelection() { return { removeAllRanges() {} } },
    }

    const detach = attachScrubber(mock.editor)

    try {
        const pointerDownFn = mock.listeners.get('pointerdown')?.[0]
        const pointerMoveFn = mock.listeners.get('pointermove')?.[0]
        const pointerUpFn = mock.listeners.get('pointerup')?.[0]
        const keyDownFn = docListeners.get('keydown')?.[0]
        const keyUpFn = docListeners.get('keyup')?.[0]

        // Start scrub on 2
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

        assert.ok(createdTooltip, 'tooltip element should be created')

        // Normal drag
        pointerMoveFn({ clientX: 102, clientY: 100, altKey: true })
        assert.ok(tooltipMock._hintEl.textContent.includes('fine') || tooltipMock._hintEl.innerHTML.includes('fine'))

        // Shift drag (fine)
        pointerMoveFn({ clientX: 103, clientY: 100, altKey: true, shiftKey: true })
        assert.ok(tooltipMock._hintEl.textContent.includes('0.1×') || tooltipMock._hintEl.innerHTML.includes('0.1×'))

        // Shift + Meta drag (ultra-fine)
        pointerMoveFn({ clientX: 104, clientY: 100, altKey: true, shiftKey: true, metaKey: true })
        assert.ok(tooltipMock._hintEl.textContent.includes('0.01×') || tooltipMock._hintEl.innerHTML.includes('0.01×'))

        // Hit minimum boundary (drag left)
        pointerMoveFn({ clientX: 50, clientY: 100, altKey: true })
        assert.equal(tooltipMock._valEl.textContent, '1 (min)', 'tooltip displays (min) indicator when clamped')

        pointerUpFn({ pointerId: 1 })
        assert.equal(createdTooltip, null, 'tooltip removed on pointerup')
    } finally {
        detach()
        globalThis.document = prevDoc
        globalThis.window = prevWindow
    }
})


