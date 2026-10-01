/**
 * Inactivity cursor fading for performance mode.
 *
 * The OS cursor itself cannot fade (the `cursor` property is not
 * animatable), so performance mode replaces it with a small rendered dot
 * that tracks the pointer (`cursor: none` on the body). When the
 * performer goes idle the dot fades out over 500ms; any activity
 * (pointer move/down, keydown, wheel) restores it instantly, so the
 * projection surface stays distraction-free during a set. `stop()`
 * removes the dot and detaches the listeners; callers invoke start/stop
 * when performance mode is entered or exited.
 */

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel']
export const CURSOR_IDLE_MS = 3000
export const CURSOR_FADE_MS = 500
export const CURSOR_DOT_CLASS = 'cursor-fade-dot'

/**
 * The rendered cursor substitute. Kept as a separate factory so unit tests
 * can drive it with fake document/element stand-ins (no real DOM).
 */
export function createCursorDot(doc, className = CURSOR_DOT_CLASS) {
    if (!doc) throw new Error('createCursorDot requires a document-like object')
    let el = null

    const ensure = () => {
        if (el) return el
        el = doc.createElement('div')
        el.className = className
        el.setAttribute('aria-hidden', 'true')
        doc.body.appendChild(el)
        return el
    }

    return {
        get element() { return el },
        move(x, y) {
            const node = ensure()
            node.style.left = `${x}px`
            node.style.top = `${y}px`
        },
        idle(on) {
            if (!el) return
            if (on) el.classList.add('cursor-idle')
            else el.classList.remove('cursor-idle')
        },
        destroy() {
            if (!el) return
            if (el.parentNode) el.parentNode.removeChild(el)
            el = null
        },
    }
}

export function createCursorIdleHider(body, win, idleMs = CURSOR_IDLE_MS, doc = null) {
    if (!body || !win) throw new Error('createCursorIdleHider requires a body and a window-like object')
    let timer = null
    let active = false
    const dot = doc ? createCursorDot(doc) : null

    const setIdle = (on) => {
        if (on && active) body.classList.add('cursor-idle')
        else body.classList.remove('cursor-idle')
        if (dot) dot.idle(on)
    }

    const hide = () => {
        if (active) setIdle(true)
    }

    const show = () => {
        setIdle(false)
        if (!active) return
        if (timer !== null) win.clearTimeout(timer)
        timer = win.setTimeout(hide, idleMs)
    }

    const onActivity = (e) => {
        if (dot && e && typeof e.clientX === 'number') dot.move(e.clientX, e.clientY)
        show()
    }

    return {
        get active() { return active },
        get idle() { return active && body.classList.contains('cursor-idle') },
        get dot() { return dot ? dot.element : null },
        start() {
            if (active) return
            active = true
            for (const type of ACTIVITY_EVENTS) {
                win.addEventListener(type, onActivity, { passive: true })
            }
            show()
        },
        stop() {
            if (!active) return
            active = false
            for (const type of ACTIVITY_EVENTS) {
                win.removeEventListener(type, onActivity)
            }
            if (timer !== null) {
                win.clearTimeout(timer)
                timer = null
            }
            body.classList.remove('cursor-idle')
            if (dot) dot.destroy()
        },
        /** Test hook: run the pending idle callback directly without real timers. */
        fireIdle() { hide() },
    }
}

let singleton = null

/** Browser wiring: one hider over the document body with a rendered cursor dot. */
export function getCursorIdleHider() {
    if (!singleton) singleton = createCursorIdleHider(document.body, window, CURSOR_IDLE_MS, document)
    return singleton
}
