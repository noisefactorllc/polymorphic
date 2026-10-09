// SPDX-License-Identifier: MIT
//
// Shared guards for polymorphic's document-level single-key shortcuts
// (T tap-tempo, bare-digit scene recall, ? shortcuts dialog). A single key
// must not fire from a state where it belongs to something else:
//
//  - A focused handfish custom control. Its trigger is a light-DOM BUTTON
//    (select-dropdown type-ahead, toggle-switch, menu-bar trigger, color
//    picker), so the old TEXTAREA/INPUT/contentEditable guards passed it and
//    the global handler fired behind the control's own key handling.
//  - An open overlay. A menu-bar dropdown, the command palette and the app's
//    custom modals register on the handfish escape stack; native <dialog>
//    surfaces (color-picker, About) do not and are counted separately. Both
//    checks mirror the Escape handler's own "did something else own this key"
//    test in embed.js.

import { hasOpenEscapeables } from 'handfish'

// Handfish components whose focused trigger owns keyboard input itself.
// code-editor is intentionally absent: its textarea is already covered by the
// tag/contentEditable checks, and suppressing everything inside it would have
// no effect on those checks anyway.
const HANDFISH_KEYED_CONTROLS = 'select-dropdown, color-picker, toggle-switch, menu-bar'

/**
 * True when the focused element sits inside a handfish custom control that
 * handles keys on its own focusable trigger (the panel's select triggers, a
 * toggle's switch, a menu-bar trigger).
 */
export function isHandfishControlFocus(el = document.activeElement) {
    if (!el || el === document.body) return false
    if (typeof el.closest !== 'function') return false
    return !!el.closest(HANDFISH_KEYED_CONTROLS)
}

/**
 * True while any overlay that owns keystrokes is open: a handfish escape-stack
 * surface (menu-bar dropdown, command palette, shortcuts dialog, ...) or a
 * native <dialog> (color picker, About).
 */
export function isOverlayOpen() {
    return hasOpenEscapeables() || document.querySelectorAll('dialog[open]').length > 0
}
