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
            canvas.classList.remove('canvas-flash')
            // Force reflow so re-adding the class restarts the animation
            void canvas.offsetWidth
            canvas.classList.add('canvas-flash')
            lastTapTime = 0
        } else {
            lastTapTime = now
            lastTapX = t.clientX
            lastTapY = t.clientY
        }
    }, { passive: true })

    const TWO_FINGER_MAX_MS = 250
    const TWO_FINGER_MAX_DRIFT_PX = 30
    let twoFingerStart = 0
    let twoFingerOriginX = 0
    let twoFingerOriginY = 0
    let twoFingerOriginSpread = 0
    let twoFingerMoved = false
    let twoFingerArmed = false  // we saw exactly 2 fingers and never went above 2

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            twoFingerStart = Date.now()
            twoFingerArmed = true
            twoFingerMoved = false
            twoFingerOriginX = (e.touches[0].clientX + e.touches[1].clientX) / 2
            twoFingerOriginY = (e.touches[0].clientY + e.touches[1].clientY) / 2
            const sx = e.touches[0].clientX - e.touches[1].clientX
            const sy = e.touches[0].clientY - e.touches[1].clientY
            twoFingerOriginSpread = Math.hypot(sx, sy)
        } else if (e.touches.length > 2) {
            twoFingerArmed = false
        }
    }, { passive: true })

    canvas.addEventListener('touchmove', (e) => {
        if (!twoFingerArmed || e.touches.length < 2) return
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const dx = Math.abs(cx - twoFingerOriginX)
        const dy = Math.abs(cy - twoFingerOriginY)
        const sx = e.touches[0].clientX - e.touches[1].clientX
        const sy = e.touches[0].clientY - e.touches[1].clientY
        const spread = Math.hypot(sx, sy)
        const dSpread = Math.abs(spread - twoFingerOriginSpread)
        if (dx > TWO_FINGER_MAX_DRIFT_PX || dy > TWO_FINGER_MAX_DRIFT_PX || dSpread > TWO_FINGER_MAX_DRIFT_PX) twoFingerMoved = true
    }, { passive: true })

    canvas.addEventListener('touchend', (e) => {
        if (twoFingerArmed && e.touches.length === 0) {
            const elapsed = Date.now() - twoFingerStart
            if (!twoFingerMoved && elapsed < TWO_FINGER_MAX_MS) {
                onTogglePerformanceMode?.()
            }
            twoFingerArmed = false
        }
    }, { passive: true })
}
