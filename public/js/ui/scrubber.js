/**
 * Inline Number Scrubber
 *
 * Alt+drag any numeric literal in the editor to scrub its value live.
 *  - Horizontal drag changes the value.
 *  - Step size adapts to the literal's precision (integer → 1 per px, 0.1 → 0.01 per px, etc).
 *  - Shift fine scrubs 0.1×, Shift+Cmd/Ctrl ultra-fine scrubs 0.01×, Cmd/Ctrl coarse scrubs 10×.
 *  - Smooth delta drag dynamics prevent jumping when modifiers change mid-drag.
 *  - Boundary clamping preserves valid shader parameter ranges with zero turnaround lag.
 *  - On release, the editor's normal hot reload kicks in.
 *
 * The scrubber works on top of any editor whose `getTextarea()` returns a
 * standard <textarea>. While a scrub is active we suppress the editor's
 * debounced hot reload and recompile directly via the provided callback.
 */

import { numberLiteralAt, replaceRange } from './editorActions.js'

const STYLES_ID = 'inline-scrubber-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLES_ID)) {
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
            -webkit-user-select: none !important;
        }
        code-editor.scrubber-active,
        code-editor.scrubber-active *,
        code-editor.scrubber-active .code-editor-textarea,
        code-editor.scrubber-active .code-editor-display {
            user-select: none !important;
            -webkit-user-select: none !important;
        }
        .scrubber-tooltip {
            position: fixed;
            background: var(--hf-bg-surface);
            backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            -webkit-backdrop-filter: var(--hf-glass-blur-sm, blur(8px));
            border: 1px solid var(--hf-border);
            color: var(--hf-text-bright);
            padding: var(--hf-space-1, 0.3rem) var(--hf-space-2, 0.55rem);
            border-radius: var(--hf-radius-md, 6px);
            font-family: var(--hf-font-family-mono, 'Noto Sans Mono', 'Noto Sans Mono Block', monospace);
            font-size: var(--hf-size-sm, 0.75rem);
            pointer-events: none;
            box-sizing: border-box;
            overflow-wrap: anywhere;
            overflow: hidden;
            z-index: 5500;
            box-shadow: var(--hf-shadow-lg);
            transition: opacity 0.1s;
        }
        .scrubber-tooltip-value {
            font-weight: 600;
            color: var(--hf-text-bright);
            letter-spacing: -0.01em;
        }
        .scrubber-tooltip-hint {
            font-size: var(--hf-size-xs, 0.625rem);
            color: var(--hf-text-dim);
            margin-top: var(--hf-space-1, 0.15rem);
        }
    `
    document.head.appendChild(style)
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
const MOD_LABEL = isMac ? '⌘' : 'Ctrl'

export const KNOWN_BOUNDS = {
    'perlin.octaves': { min: 1, max: 8, isInt: true },
    'noise.octaves': { min: 1, max: 8, isInt: true },
    'curl.octaves': { min: 1, max: 8, isInt: true },
    'adjust.rotation': { min: -180, max: 180, isInt: false },
    'adjust.hueRange': { min: 0, max: 200, isInt: false },
    'adjust.saturation': { min: 0, max: 4, isInt: false },
    'adjust.brightness': { min: 0, max: 10, isInt: false },
    'adjust.contrast': { min: 0, max: 1, isInt: false },
    'bloom.radius': { min: 1, max: 128, isInt: false },
    'bloom.taps': { min: 8, max: 64, isInt: true },
    'bloom.threshold': { min: 0, max: 2, isInt: false },
    'bloom.softKnee': { min: 0, max: 0.5, isInt: false },
    'bloom.intensity': { min: 0, max: 3, isInt: false },
    'posterize.levels': { min: 1, max: 256, isInt: true },
    'blur.radiusX': { min: 0, max: 50, isInt: false },
    'blur.radiusY': { min: 0, max: 50, isInt: false },
    'bulge.rotation': { min: -180, max: 180, isInt: false },
    'bulge.strength': { min: 0, max: 100, isInt: false },
    'celShading.mix': { min: 0, max: 1, isInt: false },
}

export const GENERIC_PARAM_BOUNDS = {
    octaves: { min: 1, max: 8, isInt: true },
    levels: { min: 1, max: 256, isInt: true },
    taps: { min: 2, max: 128, isInt: true },
    steps: { min: 1, max: 1024, isInt: true },
    iterations: { min: 1, max: 100, isInt: true },
    passes: { min: 1, max: 32, isInt: true },
    opacity: { min: 0, max: 1, isInt: false },
    alpha: { min: 0, max: 1, isInt: false },
    roughness: { min: 0, max: 1, isInt: false },
    metallic: { min: 0, max: 1, isInt: false },
    probability: { min: 0, max: 1, isInt: false },
    contrast: { min: 0, max: 1, isInt: false },
    saturation: { min: 0, max: 10, isInt: false },
    brightness: { min: 0, max: 10, isInt: false },
    seed: { min: 0, max: null, isInt: true },
    radius: { min: 0, max: 500, isInt: false },
    radiusX: { min: 0, max: 500, isInt: false },
    radiusY: { min: 0, max: 500, isInt: false },
}

/**
 * Infer base scrub step from a numeric literal's text representation.
 * @param {string} raw
 * @returns {number}
 */
export function inferStep(raw) {
    if (!raw) return 1
    const dot = raw.indexOf('.')
    if (dot < 0) return 1
    const decimals = raw.length - dot - 1
    if (decimals === 0) return 1
    // 10 ** n is exact for small integer n and IEEE division is correctly
    // rounded, so this stays byte-stable across engines; Math.pow(10, -n)
    // is an implementation approximation and drifted 1 ulp low on Node 22
    // (0.00009999999999999999), breaking strictEqual against the literal.
    return 1 / 10 ** decimals
}

/**
 * Resolve acceleration multiplier based on active modifier keys.
 * @param {object} [e]
 * @returns {number}
 */
export function resolveScrubAccel(e = {}) {
    const isShift = Boolean(e?.shiftKey)
    const isMod = Boolean(e?.metaKey || e?.ctrlKey)
    if (isShift && isMod) return 0.01 // Ultra-fine (100x slower)
    if (isShift) return 0.1           // Fine (10x slower)
    if (isMod) return 10              // Coarse (10x faster)
    return 1                          // Normal
}

/**
 * Format a scrubbed numeric value, expanding decimal precision for fine scrub
 * and preserving integer formatting for integer literals.
 * @param {number} v
 * @param {string} raw
 * @param {number} [accel=1]
 * @returns {string}
 */
export function formatScrubValue(v, raw, accel = 1) {
    if (!Number.isFinite(v)) return raw
    const dot = raw.indexOf('.')
    const rawDecimals = dot < 0 ? 0 : raw.length - dot - 1
    const hasTrailingDot = dot >= 0 && rawDecimals === 0

    if (rawDecimals === 0 && !hasTrailingDot) {
        return Math.round(v).toString()
    }

    let targetDecimals = rawDecimals
    if (accel <= 0.01) {
        targetDecimals = Math.max(rawDecimals, rawDecimals + 2)
    } else if (accel <= 0.1) {
        targetDecimals = Math.max(rawDecimals, rawDecimals + 1)
    }

    if (hasTrailingDot && targetDecimals === 0) {
        return Math.round(v).toString() + '.'
    }

    return v.toFixed(targetDecimals)
}

/**
 * Find enclosing function name and parameter name at cursor position in DSL text.
 * @param {string} text
 * @param {number} pos
 * @returns {{ func: string | null, param: string | null }}
 */
export function findParamContext(text, pos) {
    if (!text || pos == null || pos < 0 || pos > text.length) {
        return { func: null, param: null }
    }
    const before = text.slice(0, pos)
    const paramMatch = before.match(/([a-zA-Z0-9_]+)\s*:\s*$/)
    const param = paramMatch ? paramMatch[1] : null

    let depth = 0
    let func = null
    for (let i = before.length - 1; i >= 0; i--) {
        const ch = before[i]
        if (ch === ')') {
            depth++
        } else if (ch === '(') {
            if (depth > 0) {
                depth--
            } else {
                const preCall = before.slice(0, i)
                const funcMatch = preCall.match(/([a-zA-Z0-9_]+)\s*$/)
                if (funcMatch) func = funcMatch[1]
                break
            }
        }
    }
    return { func, param }
}

/**
 * Resolve parameter boundaries for a given effect function and parameter name.
 * @param {string} func
 * @param {string} param
 * @param {(func: string, param: string) => { min?: number, max?: number, isInt?: boolean } | null} [customProvider]
 * @returns {{ min?: number, max?: number, isInt?: boolean } | null}
 */
export function resolveParamBounds(func, param, customProvider) {
    if (typeof customProvider === 'function') {
        const custom = customProvider(func, param)
        if (custom) return custom
    }
    if (func && param) {
        const exact = KNOWN_BOUNDS[`${func}.${param}`]
        if (exact) return exact
    }
    if (param && GENERIC_PARAM_BOUNDS[param]) {
        return GENERIC_PARAM_BOUNDS[param]
    }
    return null
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
    const getParamBounds = options.getParamBounds

    const TOUCH_LONG_PRESS_MS = 300
    const TOUCH_DRAG_THRESHOLD_PX = 10

    let hovering = false
    let scrubbing = false
    let startX = 0
    let startValue = 0
    let currentVal = 0
    let originalRaw = ''
    let range = null
    let stepSize = 1
    let activeBounds = null
    let tooltip = null
    let throttleId = null
    let lastChangeTime = 0
    let lastPointerX = null
    let lastPointerY = null
    // Touch/pen pending state — wait for long-press or drag before engaging,
    // so simple taps fall through to native textarea focus/caret placement.
    let pendingTouch = null
    let pendingTimer = null

    function preventSelect(evt) {
        evt.preventDefault()
    }

    function applyUserSelectGuard() {
        if (typeof document !== 'undefined') {
            document.body?.classList?.add('scrubber-active-cursor')
            document.addEventListener('selectstart', preventSelect)
        }
        if (editor) {
            editor.classList?.add('scrubber-active')
            if (editor.style) {
                editor.style.userSelect = 'none'
                editor.style.webkitUserSelect = 'none'
            }
        }
        if (ta?.style) {
            ta.style.userSelect = 'none'
            ta.style.webkitUserSelect = 'none'
        }
        if (typeof window !== 'undefined' && window.getSelection) {
            try { window.getSelection()?.removeAllRanges?.() } catch { /* ignore */ }
        }
    }

    function removeUserSelectGuard() {
        if (typeof document !== 'undefined') {
            document.body?.classList?.remove('scrubber-active-cursor')
            document.removeEventListener('selectstart', preventSelect)
        }
        if (editor) {
            editor.classList?.remove('scrubber-active')
            if (editor.style) {
                editor.style.userSelect = ''
                editor.style.webkitUserSelect = ''
            }
        }
        if (ta?.style) {
            ta.style.userSelect = ''
            ta.style.webkitUserSelect = ''
        }
    }

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

    function updateHover(clientX, clientY, altPressed) {
        if (clientX == null || clientY == null) return
        const lit = findLiteralAtPointer(clientX, clientY)
        const shouldHover = !!lit && Boolean(altPressed)
        if (shouldHover !== hovering) {
            hovering = shouldHover
            ta.classList.toggle('scrubber-hover-target', hovering)
        }
    }

    function getDisplayValue(accel) {
        let boundIndicator = ''
        if (activeBounds) {
            if (activeBounds.min != null && currentVal <= activeBounds.min) boundIndicator = ' (min)'
            else if (activeBounds.max != null && currentVal >= activeBounds.max) boundIndicator = ' (max)'
        }
        return formatScrubValue(currentVal, originalRaw, accel) + boundIndicator
    }

    function updateTooltip(x, y, value, accel = 1) {
        if (!tooltip) {
            tooltip = document.createElement('div')
            tooltip.className = 'scrubber-tooltip'
            tooltip.innerHTML = `<div class="scrubber-tooltip-value"></div><div class="scrubber-tooltip-hint"></div>`
            document.body.appendChild(tooltip)
        }
        const valEl = tooltip.querySelector('.scrubber-tooltip-value')
        if (valEl) valEl.textContent = value

        const hintEl = tooltip.querySelector('.scrubber-tooltip-hint')
        if (hintEl) {
            if (accel === 0.01) {
                hintEl.textContent = `⇧${MOD_LABEL} ultra-fine (0.01×)`
            } else if (accel === 0.1) {
                hintEl.textContent = '⇧ fine (0.1×)'
            } else if (accel === 10) {
                hintEl.textContent = `${MOD_LABEL} coarse (10×)`
            } else {
                hintEl.textContent = `shift = fine · ${MOD_LABEL} = coarse · shift+${MOD_LABEL} = ultra-fine`
            }
        }
        positionTooltip(x, y)
    }

    function positionTooltip(x, y) {
        if (!tooltip) return
        const margin = 8
        const gap = 12
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth
        const viewportHeight = window.innerHeight
        tooltip.style.maxWidth = `${Math.max(0, viewportWidth - 2 * margin)}px`
        tooltip.style.maxHeight = `${Math.max(0, viewportHeight - 2 * margin)}px`
        const width = tooltip.offsetWidth
        const height = tooltip.offsetHeight
        const right = x + gap
        const left = right + width <= viewportWidth - margin ? right : x - gap - width
        const above = y - gap - height
        const top = above >= margin ? above : y + gap
        tooltip.style.left = `${Math.min(Math.max(left, margin), viewportWidth - margin - width)}px`
        tooltip.style.top = `${Math.min(Math.max(top, margin), viewportHeight - margin - height)}px`
    }

    function engageScrub(e, lit) {
        // Capture pointer
        e.preventDefault()
        e.stopPropagation()
        scrubbing = true
        startX = e.clientX
        lastPointerX = e.clientX
        lastPointerY = e.clientY
        startValue = lit.value
        currentVal = lit.value
        originalRaw = lit.raw
        range = { start: lit.start, end: lit.end }
        stepSize = inferStep(lit.raw)

        const ctx = findParamContext(ta.value, lit.start)
        activeBounds = resolveParamBounds(ctx.func, ctx.param, getParamBounds)

        applyUserSelectGuard()
        const accel = resolveScrubAccel(e)
        updateTooltip(e.clientX, e.clientY, getDisplayValue(accel), accel)
        onScrubStart()
        try { ta.setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
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
            const dx = (lastPointerX != null) ? (e.clientX - lastPointerX) : 0
            lastPointerX = e.clientX
            lastPointerY = e.clientY
            const accel = resolveScrubAccel(e)

            if (dx !== 0) {
                currentVal += dx * stepSize * accel
                if (activeBounds) {
                    if (activeBounds.min != null && currentVal < activeBounds.min) currentVal = activeBounds.min
                    if (activeBounds.max != null && currentVal > activeBounds.max) currentVal = activeBounds.max
                }
                if (!Number.isFinite(currentVal)) {
                    currentVal = startValue
                }
                const newRaw = formatScrubValue(currentVal, originalRaw, accel)
                applyValue(newRaw)
            }
            updateTooltip(e.clientX, e.clientY, getDisplayValue(accel), accel)
            return
        }
        lastPointerX = e.clientX
        lastPointerY = e.clientY
        // Idle hover detection — show pointer change
        updateHover(e.clientX, e.clientY, e.altKey)
    }

    function applyValue(newRaw) {
        if (!range) return
        // Read latest value for offsets — if user edited mid-scrub, we use saved range
        replaceRange(editor, range.start, range.end, newRaw)
        range = { start: range.start, end: range.start + newRaw.length }
        // Restore the selection to the new literal so subsequent scrubs feel sticky
        ta.selectionStart = range.start
        ta.selectionEnd = range.end
        if (typeof window !== 'undefined' && window.getSelection) {
            try { window.getSelection()?.removeAllRanges?.() } catch { /* ignore */ }
        }

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
        activeBounds = null
        removeUserSelectGuard()
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
        if (lastPointerX != null && lastPointerY != null) {
            updateHover(lastPointerX, lastPointerY, Boolean(e?.altKey))
        }
    }

    function onKeyDown(e) {
        // ESC aborts, restoring the original value
        if (scrubbing && e.key === 'Escape') {
            e.preventDefault?.()
            e.stopPropagation?.()
            replaceRange(editor, range.start, range.end, originalRaw)
            range = null
            onPointerUp()
            try { Promise.resolve(recompile()).catch(() => {}) } catch { /* ignore */ }
            return
        }
        if (scrubbing && (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control')) {
            if (lastPointerX != null && lastPointerY != null) {
                const accel = resolveScrubAccel(e)
                updateTooltip(lastPointerX, lastPointerY, getDisplayValue(accel), accel)
            }
            return
        }
        if (e.key === 'Alt' && !scrubbing && lastPointerX != null) {
            updateHover(lastPointerX, lastPointerY, true)
        }
    }

    function onKeyUp(e) {
        if (scrubbing && (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control')) {
            if (lastPointerX != null && lastPointerY != null) {
                const accel = resolveScrubAccel(e)
                updateTooltip(lastPointerX, lastPointerY, getDisplayValue(accel), accel)
            }
            return
        }
        if (e.key === 'Alt' && !scrubbing && lastPointerX != null) {
            updateHover(lastPointerX, lastPointerY, false)
        }
    }

    function onPointerLeave() {
        if (!scrubbing) {
            hovering = false
            lastPointerX = null
            lastPointerY = null
            ta.classList.remove('scrubber-hover-target')
        }
    }

    function onResize() {
        if (tooltip && lastPointerX != null && lastPointerY != null) {
            positionTooltip(lastPointerX, lastPointerY)
        }
    }

    window.addEventListener?.('resize', onResize)
    ta.addEventListener('pointermove', onPointerMove)
    ta.addEventListener('pointerdown', onPointerDown)
    ta.addEventListener('pointerup', onPointerUp)
    ta.addEventListener('pointercancel', onPointerUp)
    ta.addEventListener('pointerleave', onPointerLeave)
    if (typeof document !== 'undefined') {
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('keyup', onKeyUp)
    }

    return function detach() {
        window.removeEventListener?.('resize', onResize)
        removeUserSelectGuard()
        ta.removeEventListener('pointermove', onPointerMove)
        ta.removeEventListener('pointerdown', onPointerDown)
        ta.removeEventListener('pointerup', onPointerUp)
        ta.removeEventListener('pointercancel', onPointerUp)
        ta.removeEventListener('pointerleave', onPointerLeave)
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
        }
        if (tooltip) tooltip.remove()
    }
}
