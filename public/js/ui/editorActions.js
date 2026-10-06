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
 *
 * Recognises plain integers (`42`), decimals (`3.14`), trailing-dot
 * literals (`2.`), leading-dot literals (`.5`), leading minus, and scientific
 * notation (`1.5e-3`, `2E10`).
 *
 * @param {string} text
 * @param {number} cursor
 * @returns {{start: number, end: number, value: number, raw: string} | null}
 */
export function numberLiteralAt(text, cursor) {
    const len = text.length
    if (cursor < 0 || cursor > len) return null
    // Expand outward while we're on digits, dot, or scientific-notation chars (e/E/+/-)
    let s = cursor
    let e = cursor
    const isNumCharCore = (ch) => /[0-9.]/.test(ch)
    // Walk back through digits/dots
    while (s > 0 && isNumCharCore(text[s - 1])) s--
    // Allow a leading minus if it's the start of a number (preceded by an operator/whitespace/punct)
    if (s > 0 && text[s - 1] === '-') {
        const prev = s >= 2 ? text[s - 2] : ' '
        if (!/[A-Za-z0-9_]/.test(prev)) s--
    }
    // Walk forward through digits/dots
    while (e < len && isNumCharCore(text[e])) e++
    // Optional scientific notation suffix: e or E, then optional sign, then digits
    if (e < len && (text[e] === 'e' || text[e] === 'E')) {
        let probe = e + 1
        if (probe < len && (text[probe] === '+' || text[probe] === '-')) probe++
        let digits = probe
        while (digits < len && /[0-9]/.test(text[digits])) digits++
        if (digits > probe) e = digits
    }
    if (s === e) return null
    const raw = text.slice(s, e)
    // Validate — accept int, leading-dot, trailing-dot, full decimals, all with optional minus and exponent
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return null
    const value = parseFloat(raw)
    if (!Number.isFinite(value)) return null
    return { start: s, end: e, value, raw }
}

/**
 * Undo transparency for programmatic editor writes.
 *
 * Programmatic writes made through the editing commands preserve the
 * textarea's native undo stack but occupy it: after a scrub or a panel edit,
 * Ctrl+Z would first undo those writes before reaching the user's typing.
 * The product positions the native stack as the fine-grained undo layer for
 * user edits, so the writes recorded here are treated as transparent: a
 * Ctrl+Z pressed while a recorded block is pending undoes through the block,
 * undoes the user's last edit below it, and re-applies the block's net
 * change — the user's typing is undone immediately and the programmatic
 * state survives, exactly as if the writes had never been undo steps.
 */

const undoBlocks = new WeakMap()
// The user's typing bursts, oldest first: each `{before, lastActivity}` —
// `before` is the editor text before the burst's first keystroke. Chromium
// records typing here as one entry per character, so native undo removes a
// single character per press; the burst targets let one press undo a whole
// edit, and repeated presses walk back burst by burst.
const userBursts = new WeakMap()
// Bookkeeping for presses already taken against a pending block.
const pressState = new WeakMap()
let trackedWriteDepth = 0
const undoTransparencyInstalled = new WeakSet()

/**
 * Record a programmatic write for undo transparency. Writes extend the
 * pending block while they chain onto it (each write's `before` is the
 * block's current end); any other write starts a fresh block.
 * @param {HTMLTextAreaElement} ta
 * @param {string} before - editor text before the write
 * @param {string} after - editor text after the write
 */
export function noteProgrammaticWrite(ta, before, after) {
    if (!ta || before === after) return
    const block = undoBlocks.get(ta)
    if (block && block.afterText === before) {
        block.afterText = after
    } else {
        undoBlocks.set(ta, { startText: before, afterText: after })
    }
}

/**
 * Forget the pending programmatic block and any press bookkeeping for a
 * textarea. The user's typing bursts survive: they keep forming while the
 * user types, and a stale target simply fails verification later.
 * @param {HTMLTextAreaElement} ta
 */
export function clearProgrammaticWrites(ta) {
    if (!ta) return
    undoBlocks.delete(ta)
    pressState.delete(ta)
}

/**
 * True while a write that must not count as a user edit is in flight. The
 * editor's input handling checks this to tell programmatic writes — whose
 * input events are indistinguishable from typing — from real user edits.
 * @returns {boolean}
 */
export function programmaticWriteInFlight() {
    return trackedWriteDepth > 0
}

function beginTrackedWrite() {
    trackedWriteDepth++
}

function endTrackedWrite() {
    trackedWriteDepth = Math.max(0, trackedWriteDepth - 1)
}

/**
 * Run `fn` as a tracked programmatic write: input events it fires do not
 * count as user edits, so a pending programmatic block survives and chains
 * across the write.
 * @param {() => void} fn
 */
export function runAsTrackedWrite(fn) {
    beginTrackedWrite()
    try {
        fn()
    } finally {
        endTrackedWrite()
    }
}

/**
 * Apply a single-range replacement without recording it as a pending
 * programmatic write (used to re-apply a block's net change during undo).
 * @param {HTMLElement} editor
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
export function applyEditorRange(editor, start, end, replacement) {
    const ta = editor?.getTextarea?.()
    if (!ta) return
    const value = ta.value
    const nextValue = value.slice(0, start) + replacement + value.slice(end)
    if (nextValue === value) return
    beginTrackedWrite()
    try {
        if (!writeThroughUndoStack(ta, start, end, replacement, nextValue)) {
            ta.value = nextValue
            ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
    } finally {
        endTrackedWrite()
    }
    const cursor = start + replacement.length
    ta.selectionStart = ta.selectionEnd = cursor
}

/**
 * Single-contiguous-region diff of two strings via common prefix/suffix.
 * @param {string} a
 * @param {string} b
 * @returns {{start: number, end: number, original: string, replacement: string} | null}
 */
function singleRegionDiff(a, b) {
    if (a === b) return null
    let start = 0
    const maxStart = Math.min(a.length, b.length)
    while (start < maxStart && a[start] === b[start]) start++
    let endA = a.length
    let endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--
        endB--
    }
    return { start, end: endA, original: a.slice(start, endA), replacement: b.slice(start, endB) }
}

/**
 * Make Ctrl/Cmd+Z treat the editor's pending programmatic writes as
 * transparent: the first press undoes the user's last typed edit and keeps
 * the programmatic state, instead of first stepping back through the
 * writes. Presses with nothing pending pass through to the browser's native
 * undo untouched.
 * @param {HTMLElement} editor - <code-editor> custom element
 */
export function installUndoTransparency(editor) {
    const ta = editor?.getTextarea?.()
    if (!ta || undoTransparencyInstalled.has(editor)) return
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return
    undoTransparencyInstalled.add(editor)

    ta.addEventListener('input', () => {
        if (programmaticWriteInFlight()) return
        // A user edit (or any untracked write) invalidates the block.
        clearProgrammaticWrites(ta)
    })

    ta.addEventListener('beforeinput', (e) => {
        const type = e.inputType || ''
        if (type === 'historyUndo' || type === 'historyRedo') return
        if (programmaticWriteInFlight()) return
        // Track the user's typing bursts so one press can undo a whole
        // edit: `beforeinput` sees the text before the edit lands. Bursts
        // more than three seconds apart undo separately.
        const now = performance.now()
        const bursts = userBursts.get(ta)
        const last = bursts && bursts.length ? bursts[bursts.length - 1] : null
        if (!last || now - last.lastActivity > 3000) {
            if (!bursts) userBursts.set(ta, [])
            const list = userBursts.get(ta)
            list.push({ before: ta.value, lastActivity: now })
            if (list.length > 50) list.shift()
        } else {
            last.lastActivity = now
        }
    })

    ta.addEventListener('keydown', (e) => {
        if (e.isComposing || e.altKey) return
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return
        if (e.key !== 'z' && e.key !== 'Z') return

        const block = undoBlocks.get(ta)
        const bursts = userBursts.get(ta) || []
        const press = pressState.get(ta) || { consumed: 0, netApplied: false, postPressText: null, postPopText: null }
        // Pass through to native undo unless the pending block tops the
        // stack, either freshly written or as a net a previous press of this
        // series re-applied on top of the typing it already undid.
        const atFresh = !!block && ta.value === block.afterText
        const atPost = !!block && press.netApplied && press.postPressText !== null && ta.value === press.postPressText
        if (!atFresh && !atPost) {
            clearProgrammaticWrites(ta)
            return
        }
        e.preventDefault()

        const restoreTo = (target) => {
            let restore = 2000
            while (ta.value !== target && restore-- > 0) {
                const before = ta.value
                if (!document.execCommand('redo') || ta.value === before) break
            }
        }
        const undoUntil = (target) => {
            let guard = 2000
            while (ta.value !== target && guard-- > 0) {
                const before = ta.value
                if (!document.execCommand('undo') || ta.value === before) break
            }
            return ta.value === target
        }

        beginTrackedWrite()
        try {
            if (document.activeElement !== ta) {
                try { ta.focus({ preventScroll: true }) } catch { ta.focus() }
            }
            const prePress = ta.value
            // Step back to the post-pop state: a fresh block must undo its
            // own entries; a repeat press first pops the net the previous
            // press re-applied on top of the typing it already undid.
            if (atPost) {
                document.execCommand('undo')
                if (ta.value !== press.postPopText) {
                    restoreTo(prePress)
                    clearProgrammaticWrites(ta)
                    return
                }
            } else if (!undoUntil(block.startText)) {
                // The block could not be reconstructed (unsupported stack,
                // pruned history, oversized block). Restore the pre-press
                // text so this press is a clean no-op instead of a swallowed
                // partial undo.
                restoreTo(prePress)
                clearProgrammaticWrites(ta)
                return
            }
            // Undo the next-older typing burst below the block, down to
            // where the burst began. Chromium records typing as one entry
            // per character, so the burst target is what makes a single
            // press remove the whole edit while the programmatic state
            // stays in place.
            const idx = bursts.length - 1 - press.consumed
            if (idx < 0) {
                // Everything the user typed is already undone; leave the
                // block's entries popped and hand back to native undo.
                clearProgrammaticWrites(ta)
                return
            }
            const target = bursts[idx].before
            if (target !== ta.value && !undoUntil(target)) {
                restoreTo(prePress)
                clearProgrammaticWrites(ta)
                return
            }
            const postPop = ta.value
            // Re-apply the block's net change on top of the undone typing,
            // remapping the region around everything that was popped.
            let applied = false
            const net = singleRegionDiff(block.startText, block.afterText)
            const pop = singleRegionDiff(block.startText, postPop)
            if (net && pop) {
                let at = null
                if (net.end <= pop.start) {
                    at = { start: net.start, end: net.end }
                } else if (net.start >= pop.end) {
                    const shift = pop.replacement.length - pop.original.length
                    at = { start: net.start + shift, end: net.end + shift }
                }
                if (at && postPop.slice(at.start, at.end) === net.original) {
                    applyEditorRange(editor, at.start, at.end, net.replacement)
                    applied = ta.value !== postPop
                }
            }
            if (!applied) {
                // The net cannot be re-applied on this text — the
                // programmatic state is gone; hand back to native undo.
                clearProgrammaticWrites(ta)
                return
            }
            // Keep the block tracked: the next press steps to the
            // next-older burst while this net stays in place.
            pressState.set(ta, {
                consumed: press.consumed + 1,
                netApplied: true,
                postPopText: postPop,
                postPressText: ta.value,
            })
        } catch {
            // Whatever state the sequence reached stands; never swallow the
            // press into a broken editor.
        } finally {
            endTrackedWrite()
        }
    })
}

/**
 * Apply a programmatic text change to a textarea through the browser's
 * editing commands (`document.execCommand`). Unlike a `value` assignment or
 * `setRangeText()` — both of which wipe the textarea's native undo stack —
 * an editing command keeps the stack intact: the user's earlier typing stays
 * undoable after the write, and the written change itself becomes an undoable
 * step. The commands only reach a focused field, so focus is taken for the
 * write.
 *
 * @param {HTMLTextAreaElement} ta
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 * @param {string} nextValue - the exact value the textarea must end up with
 * @returns {boolean} true when the undo-preserving write landed
 */
function writeThroughUndoStack(ta, start, end, replacement, nextValue) {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
    if (document.activeElement !== ta) {
        try { ta.focus({ preventScroll: true }) } catch { ta.focus() }
    }
    try {
        ta.setSelectionRange(start, end)
        const applied = replacement === ''
            ? document.execCommand('delete')
            : document.execCommand('insertText', false, replacement)
        return Boolean(applied) && ta.value === nextValue
    } catch {
        return false
    }
}

/**
 * Replace a substring in the editor's value, preserving the cursor's relative
 * position to the changed region. The write goes through the browser's
 * editing commands so the editor's native undo stack survives it; a plain
 * value assignment (the fallback when the commands are unavailable) would
 * clear that stack and leave the user's typing unreachable via Ctrl/Cmd+Z.
 * @param {HTMLElement} editor
 * @param {number} start
 * @param {number} end
 * @param {string} replacement
 */
export function replaceRange(editor, start, end, replacement) {
    const ta = editor?.getTextarea?.()
    if (!ta) return
    const value = ta.value
    const nextValue = value.slice(0, start) + replacement + value.slice(end)
    if (nextValue === value) return
    beginTrackedWrite()
    try {
        if (!writeThroughUndoStack(ta, start, end, replacement, nextValue)) {
            ta.value = nextValue
            ta.dispatchEvent(new Event('input', { bubbles: true }))
        }
    } finally {
        endTrackedWrite()
    }
    noteProgrammaticWrite(ta, value, nextValue)
    // Position cursor at end of replacement
    const cursor = start + replacement.length
    ta.selectionStart = ta.selectionEnd = cursor
}
