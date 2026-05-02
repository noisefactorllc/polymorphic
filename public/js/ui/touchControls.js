/**
 * Touch-only gestures that don't have a desktop equivalent.
 *  - Double-tap on the canvas → force-eval (Cmd+Enter analogue)
 *  - Two-finger tap on the canvas → toggle UI visibility (performance mode)
 *  - Long-press on the BPM indicator → tap-tempo
 */

export function attachTouchControls({ canvas, dslEditor, onTogglePerformanceMode }) {
    if (!('ontouchstart' in window) || !canvas) return

    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0

    canvas.addEventListener('touchend', (e) => {
        if (e.changedTouches.length !== 1) return
        const t = e.changedTouches[0]
        const now = Date.now()
        const dx = Math.abs(t.clientX - lastTapX)
        const dy = Math.abs(t.clientY - lastTapY)
        if (now - lastTapTime < 350 && dx < 30 && dy < 30) {
            // Double-tap detected
            dslEditor?.dispatchEvent(new CustomEvent('forcerecompile', { bubbles: true, composed: true }))
            lastTapTime = 0
        } else {
            lastTapTime = now
            lastTapX = t.clientX
            lastTapY = t.clientY
        }
    }, { passive: true })

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault()
            onTogglePerformanceMode?.()
        }
    }, { passive: false })
}
