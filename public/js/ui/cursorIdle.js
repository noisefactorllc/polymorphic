/**
 * Inactivity cursor hiding for performance mode.
 *
 * Keeps the OS cursor visible while the performer is moving the mouse and
 * hides it after `idleMs` without any pointer/keyboard input, so the
 * projection surface stays distraction-free during a set. Any activity
 * (pointer move/down, keydown, wheel) restores the cursor instantly and
 * re-arms the idle timer. `stop()` restores the cursor and detaches the
 * listeners; callers invoke start/stop when performance mode is entered or
 * exited.
 */

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel']
export const CURSOR_IDLE_MS = 3000

export function createCursorIdleHider(body, win, idleMs = CURSOR_IDLE_MS) {
    if (!body || !win) throw new Error('createCursorIdleHider requires a body and a window-like object')
    let timer = null
    let active = false

    const hide = () => {
        if (active) body.classList.add('cursor-idle')
    }

    const show = () => {
        body.classList.remove('cursor-idle')
        if (!active) return
        if (timer !== null) win.clearTimeout(timer)
        timer = win.setTimeout(hide, idleMs)
    }

    const onActivity = () => show()

    return {
        get active() { return active },
        get idle() { return active && body.classList.contains('cursor-idle') },
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
        },
        /** Test hook: run the pending idle callback directly without real timers. */
        fireIdle() { hide() },
    }
}

let singleton = null

/** Browser wiring: one hider over the document body. */
export function getCursorIdleHider() {
    if (!singleton) singleton = createCursorIdleHider(document.body, window)
    return singleton
}
