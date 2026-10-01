/**
 * `?embed=1` activates embed mode: hide all UI chrome (menu, editor,
 * docs, panels, indicators) and run the canvas full-bleed. Same effect
 * as performance mode but applied automatically and not toggleable.
 */
import { getCursorIdleHider } from './cursorIdle.js'

export function isEmbedMode() {
    try { return new URLSearchParams(window.location.search).get('embed') === '1' }
    catch { return false }
}

export function applyEmbedMode() {
    if (!isEmbedMode()) return false
    document.body.classList.add('embed-mode', 'performance-mode')
    getCursorIdleHider().start()
    return true
}
