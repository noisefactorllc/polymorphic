/**
 * Editor Actions — operations on the <code-editor> element.
 *
 * Centralised so the command palette, gallery, scrubber, and other features can
 * share consistent text manipulation without poking the textarea internals.
 */

/**
 * Insert text at the current cursor (or replace the selection).
 * If the editor has no focus, appends at the end.
 * @param {HTMLElement} editor - the <code-editor> custom element
 * @param {string} text
 */
export function insertAtCursor(editor, text) {
    if (!editor) return
    const ta = editor.getTextarea?.()
    if (!ta) return
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? start
    const before = ta.value.slice(0, start)
    const after = ta.value.slice(end)
    const newValue = before + text + after
    ta.value = newValue
    const newCursor = start + text.length
    ta.selectionStart = ta.selectionEnd = newCursor
    ta.focus()
    ta.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Replace the entire content of the editor.
 * @param {HTMLElement} editor
 * @param {string} text
 */
export function setEditorValue(editor, text) {
    if (!editor) return
    editor.value = text
    const ta = editor.getTextarea?.()
    if (ta) ta.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Find the start/end indices of the "block" surrounding the cursor — the
 * paragraph bounded by blank lines. Used by block-evaluation.
 *
 * @param {string} text
 * @param {number} cursor
 * @returns {{start: number, end: number}}
 */
export function blockRangeAt(text, cursor) {
    const lines = text.split('\n')
    // Compute line offsets
    const offsets = [0]
    for (let i = 0; i < lines.length - 1; i++) {
        offsets.push(offsets[i] + lines[i].length + 1)
    }
    // Which line is the cursor on?
    let line = 0
    for (let i = 0; i < lines.length; i++) {
        if (cursor >= offsets[i] && cursor <= offsets[i] + lines[i].length) {
            line = i
            break
        }
    }
    // Walk up while non-blank
    let startLine = line
    while (startLine > 0 && lines[startLine - 1].trim() !== '') startLine--
    // If cursor itself is on a blank line, start = line
    if (lines[line].trim() === '') startLine = line
    // Walk down while non-blank
    let endLine = line
    while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '') endLine++
    if (lines[line].trim() === '') endLine = line

    const start = offsets[startLine]
    const end = offsets[endLine] + lines[endLine].length
    return { start, end }
}

/**
 * Get the currently-selected text or, if no selection, the block surrounding
 * the caret.
 * @param {HTMLElement} editor
 * @returns {{text: string, start: number, end: number} | null}
 */
export function getSelectionOrBlock(editor) {
    const ta = editor?.getTextarea?.()
    if (!ta) return null
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    if (start !== end) {
        return { text: ta.value.slice(start, end), start, end }
    }
    const range = blockRangeAt(ta.value, start)
    return { text: ta.value.slice(range.start, range.end), start: range.start, end: range.end }
}

/**
 * Find the numeric literal under (or adjacent to) the given cursor index.
 * Used by the inline scrubber.
 * @param {string} text
 * @param {number} cursor
 * @returns {{start: number, end: number, value: number, raw: string} | null}
 */
export function numberLiteralAt(text, cursor) {
    const len = text.length
    if (cursor < 0 || cursor > len) return null
    // Expand outward while we're on digits / . / -
    let s = cursor
    let e = cursor
    const isNumChar = (ch) => /[0-9.]/.test(ch)
    // Walk back
    while (s > 0 && isNumChar(text[s - 1])) s--
    // Allow a leading minus if it's the start of a number (preceded by an operator/whitespace/punct)
    if (s > 0 && text[s - 1] === '-') {
        const prev = s >= 2 ? text[s - 2] : ' '
        if (!/[A-Za-z0-9_]/.test(prev)) s--
    }
    // Walk forward
    while (e < len && isNumChar(text[e])) e++
    if (s === e) return null
    const raw = text.slice(s, e)
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(raw)) return null
    const value = parseFloat(raw)
    if (!Number.isFinite(value)) return null
    return { start: s, end: e, value, raw }
}

/**
 * Replace a substring in the editor's value, preserving the cursor's relative
 * position to the changed region.
 * @param {HTMLElement} editor
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
export function replaceRange(editor, start, end, replacement) {
    const ta = editor?.getTextarea?.()
    if (!ta) return
    const before = ta.value.slice(0, start)
    const after = ta.value.slice(end)
    ta.value = before + replacement + after
    // Position cursor at end of replacement
    const cursor = start + replacement.length
    ta.selectionStart = ta.selectionEnd = cursor
    ta.dispatchEvent(new Event('input', { bubbles: true }))
}
