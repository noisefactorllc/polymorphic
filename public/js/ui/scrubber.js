/**
 * Inline Number Scrubber
 *
 * Alt+drag any numeric literal in the editor to scrub its value live.
 *  - Horizontal drag changes the value.
 *  - Step size adapts to the literal's precision (integer → 1 per px, 0.1 → 0.01 per px, etc).
 *  - Shift slows it down 10×, Cmd/Ctrl speeds it up 10×.
 *  - On release, the editor's normal hot reload kicks in.
 *
 * The scrubber works on top of any editor whose `getTextarea()` returns a
 * standard <textarea>. While a scrub is active we suppress the editor's
 * debounced hot reload and recompile directly via the provided callback.
 */

import { numberLiteralAt, replaceRange } from './editorActions.js'

const STYLES_ID = 'inline-scrubber-styles'
if (!document.getElementById(STYLES_ID)) {
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = `
        .scrubber-hover-target {
            cursor: ew-resize !important;
        }
        .scrubber-active-cursor,
        .scrubber-active-cursor * {
            cursor: ew-resize !important;
            user-select: none !important;
        }
        .scrubber-tooltip {
            position: fixed;
            background: rgba(15, 17, 22, 0.96);
            border: 1px solid rgba(165, 184, 255, 0.5);
            color: #fff;
            padding: 0.3rem 0.55rem;
            border-radius: 6px;
            font-family: 'Noto Sans Mono', 'Noto Sans Mono Block', monospace;
            font-size: 0.75rem;
            pointer-events: none;
            z-index: 5500;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            transition: opacity 0.1s;
        }
        .scrubber-tooltip-hint {
            font-size: 0.625rem;
            color: #aaa;
            margin-top: 0.15rem;
        }
    `
    document.head.appendChild(style)
}

/**
 * Attach the scrubber to a code-editor element.
 * @param {HTMLElement} editor - <code-editor> custom element
 * @param {object} options
 * @param {() => void} [options.onScrubStart]
 * @param {() => void} [options.onScrubEnd]
 * @param {() => Promise<void> | void} [options.recompile] - called after each value mutation
 */
export function attachScrubber(editor, options = {}) {
    const ta = editor?.getTextarea?.()
    if (!ta) return () => {}

    const onScrubStart = options.onScrubStart || (() => {})
    const onScrubEnd = options.onScrubEnd || (() => {})
    const recompile = options.recompile || (() => {})

    const TOUCH_LONG_PRESS_MS = 300
    const TOUCH_DRAG_THRESHOLD_PX = 10

    let hovering = false
    let scrubbing = false
    let startX = 0
    let startValue = 0
    let originalRaw = ''
    let range = null
    let stepSize = 1
    let tooltip = null
    let throttleId = null
    let lastChangeTime = 0
    let savedSelectionStart = 0
    let savedSelectionEnd = 0
    // Touch/pen pending state — wait for long-press or drag before engaging,
    // so simple taps fall through to native textarea focus/caret placement.
    let pendingTouch = null
    let pendingTimer = null

    function findLiteralAtPointer(clientX, clientY) {
        // Use the textarea's built-in caret-from-point (if available) or fall
        // back to the document caret.
        let pos = null
        if (typeof document.caretPositionFromPoint === 'function') {
            const cp = document.caretPositionFromPoint(clientX, clientY)
            if (cp && cp.offsetNode === ta) pos = cp.offset
        }
        if (pos == null && typeof document.caretRangeFromPoint === 'function') {
            const cr = document.caretRangeFromPoint(clientX, clientY)
            if (cr) pos = cr.startOffset
        }
        if (pos == null) return null
        return numberLiteralAt(ta.value, pos)
    }

    function inferStep(raw) {
        // Decimal precision determines base step. e.g. "1.234" → 0.001
        const dot = raw.indexOf('.')
        if (dot < 0) return 1
        const decimals = raw.length - dot - 1
        return Math.pow(10, -decimals)
    }

    function formatValue(v, raw) {
        const dot = raw.indexOf('.')
        const decimals = dot < 0 ? 0 : raw.length - dot - 1
        // Integer-flavored originals scrub as integers; decimals keep their precision.
        if (decimals === 0) return Math.round(v).toString()
        return v.toFixed(decimals)
    }

    function onPointerMove(e) {
        // Touch/pen pending: promote to engaged once drag exceeds threshold.
        if (pendingTouch && e.pointerId === pendingTouch.id) {
            const dx = e.clientX - pendingTouch.x
            const dy = e.clientY - pendingTouch.y
            if (Math.hypot(dx, dy) > TOUCH_DRAG_THRESHOLD_PX) {
                if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
                const lit = pendingTouch.lit
                pendingTouch = null
                engageScrub(e, lit)
            }
            return
        }
        if (scrubbing) {
            // Active scrub
            const dx = e.clientX - startX
            const accel = e.shiftKey ? 0.1 : (e.metaKey || e.ctrlKey ? 10 : 1)
            const newValue = startValue + dx * stepSize * accel
            const newRaw = formatValue(newValue, originalRaw)
            applyValue(newRaw)
            updateTooltip(e.clientX, e.clientY, newRaw)
            return
        }
        // Idle hover detection — show pointer change
        const lit = findLiteralAtPointer(e.clientX, e.clientY)
        const altPressed = e.altKey
        const shouldHover = !!lit && altPressed
        if (shouldHover !== hovering) {
            hovering = shouldHover
            ta.classList.toggle('scrubber-hover-target', hovering)
        }
    }

    function applyValue(newRaw) {
        if (!range) return
        // Read latest value for offsets — if user edited mid-scrub, we use saved range
        replaceRange(editor, range.start, range.end, newRaw)
        range = { start: range.start, end: range.start + newRaw.length }
        // Restore the selection to the new literal so subsequent scrubs feel sticky
        ta.selectionStart = range.start
        ta.selectionEnd = range.end

        // Throttle recompile to ~50fps
        const now = performance.now()
        if (now - lastChangeTime > 20) {
            lastChangeTime = now
            // Fire and forget; failures will surface via the editor's normal error path
            try { Promise.resolve(recompile()).catch(() => {}) } catch { /* ignore */ }
        } else if (!throttleId) {
            throttleId = setTimeout(() => {
                throttleId = null
                try { Promise.resolve(recompile()).catch(() => {}) } catch { /* ignore */ }
            }, 25)
        }
    }

    function updateTooltip(x, y, value) {
        if (!tooltip) {
            tooltip = document.createElement('div')
            tooltip.className = 'scrubber-tooltip'
            tooltip.innerHTML = `<div class="scrubber-tooltip-value"></div><div class="scrubber-tooltip-hint">shift = fine · ⌘ = coarse</div>`
            document.body.appendChild(tooltip)
        }
        tooltip.querySelector('.scrubber-tooltip-value').textContent = value
        tooltip.style.left = (x + 12) + 'px'
        tooltip.style.top = (y - 36) + 'px'
    }

    function engageScrub(e, lit) {
        // Capture pointer
        e.preventDefault()
        e.stopPropagation()
        scrubbing = true
        startX = e.clientX
        startValue = lit.value
        originalRaw = lit.raw
        range = { start: lit.start, end: lit.end }
        stepSize = inferStep(lit.raw)
        savedSelectionStart = ta.selectionStart
        savedSelectionEnd = ta.selectionEnd
        document.body.classList.add('scrubber-active-cursor')
        updateTooltip(e.clientX, e.clientY, lit.raw)
        onScrubStart()
        try { ta.setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
    }

    function onPointerDown(e) {
        // Mouse: engage immediately on alt+left+literal.
        // Touch/pen: enter pending state — engage only after a 300ms long-press
        // or 10px drag, so simple taps fall through to native textarea focus.
        const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen'
        if (!isTouch) {
            if (!e.altKey || e.button !== 0) return
            const lit = findLiteralAtPointer(e.clientX, e.clientY)
            if (!lit) return
            engageScrub(e, lit)
            return
        }
        if (e.button !== 0) return
        const lit = findLiteralAtPointer(e.clientX, e.clientY)
        if (!lit) return
        // Pending: do NOT preventDefault, do NOT setPointerCapture.
        pendingTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, lit }
        if (pendingTimer) clearTimeout(pendingTimer)
        pendingTimer = setTimeout(() => {
            pendingTimer = null
            if (pendingTouch && pendingTouch.id === e.pointerId) {
                const heldLit = pendingTouch.lit
                pendingTouch = null
                engageScrub(e, heldLit)
            }
        }, TOUCH_LONG_PRESS_MS)
    }

    function onPointerUp(e) {
        // Touch/pen released without engaging: cancel pending and let the
        // native tap proceed (focus, caret placement).
        if (pendingTouch && e && e.pointerId === pendingTouch.id) {
            if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
            pendingTouch = null
            return
        }
        if (!scrubbing) return
        scrubbing = false
        document.body.classList.remove('scrubber-active-cursor')
        if (tooltip) {
            tooltip.remove()
            tooltip = null
        }
        if (throttleId) {
            clearTimeout(throttleId)
            throttleId = null
            try { Promise.resolve(recompile()).catch(() => {}) } catch { /* ignore */ }
        }
        onScrubEnd()
    }

    function onKeyDown(e) {
        // ESC aborts, restoring the original value
        if (scrubbing && e.key === 'Escape') {
            replaceRange(editor, range.start, range.end, originalRaw)
            range = null
            onPointerUp()
            try { Promise.resolve(recompile()).catch(() => {}) } catch { /* ignore */ }
        }
    }

    ta.addEventListener('pointermove', onPointerMove)
    ta.addEventListener('pointerdown', onPointerDown)
    ta.addEventListener('pointerup', onPointerUp)
    ta.addEventListener('pointercancel', onPointerUp)
    ta.addEventListener('pointerleave', () => {
        if (!scrubbing) {
            hovering = false
            ta.classList.remove('scrubber-hover-target')
        }
    })
    document.addEventListener('keydown', onKeyDown)

    return function detach() {
        ta.removeEventListener('pointermove', onPointerMove)
        ta.removeEventListener('pointerdown', onPointerDown)
        ta.removeEventListener('pointerup', onPointerUp)
        ta.removeEventListener('pointercancel', onPointerUp)
        document.removeEventListener('keydown', onKeyDown)
        if (tooltip) tooltip.remove()
    }
}
