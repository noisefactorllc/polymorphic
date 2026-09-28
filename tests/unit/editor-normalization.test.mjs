import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const codeEditorSource = readFileSync(new URL('../../public/js/ui/codeEditor.js', import.meta.url), 'utf8')
const embedSource = readFileSync(new URL('../../public/js/embed.js', import.meta.url), 'utf8')
const tempoSpecSource = readFileSync(new URL('../tempo.spec.js', import.meta.url), 'utf8')

test('codeEditor.js is CSS-only and does not patch Handfish editor behavior', () => {
    assert.doesNotMatch(codeEditorSource, /export function enhanceCodeEditor/)
    assert.doesNotMatch(codeEditorSource, /_polymorphicEnhanced/)
    assert.doesNotMatch(codeEditorSource, /\.flashLines\s*=/)
    assert.doesNotMatch(codeEditorSource, /addEventListener\('keydown'/)
    assert.doesNotMatch(codeEditorSource, /new CustomEvent\('forceevalblock'/)
})

test('embed.js imports editor styling as a side effect and uses Handfish flashLines directly', () => {
    assert.match(embedSource, /import '\.\/ui\/codeEditor\.js'/)
    assert.doesNotMatch(embedSource, /enhanceCodeEditor/)
    assert.match(embedSource, /dslEditor\.flashLines\?\./)
})

test('Playwright specs install the shared local Handfish route helper', () => {
    assert.match(tempoSpecSource, /import \{ installHandfishLocal \} from '\.\/handfishLocal\.js'/)
    assert.match(tempoSpecSource, /installHandfishLocal\(test\)/)
    assert.doesNotMatch(tempoSpecSource, /readFileSync/)
    assert.doesNotMatch(tempoSpecSource, /page\.route\('https:\/\/handfish\.noisefactor\.io\/0\/\*\*'/)
})

test('codeEditor.js defines .error-line using Handfish tokens with zero !important', () => {
    assert.match(codeEditorSource, /\.code-editor-gutter \.line-number\.error-line/)
    assert.match(codeEditorSource, /\.code-editor-display \.code-line\.error-line/)
    assert.match(codeEditorSource, /var\(--hf-red/)
    const gutterErrorRule = codeEditorSource.match(/\.line-number\.error-line\s*\{[^}]*\}/)?.[0] || ''
    const lineErrorRule = codeEditorSource.match(/\.code-line\.error-line\s*\{[^}]*\}/)?.[0] || ''
    assert.ok(gutterErrorRule, 'gutter error-line rule must exist')
    assert.ok(lineErrorRule, 'display code-line error-line rule must exist')
    assert.doesNotMatch(gutterErrorRule, /!important/)
    assert.doesNotMatch(lineErrorRule, /!important/)
})

test('codeEditor.js contains zero !important declarations and zero raw color literals', () => {
    assert.doesNotMatch(
        codeEditorSource,
        /!important/,
        'codeEditor.js must not contain any !important declarations'
    )
    assert.doesNotMatch(
        codeEditorSource,
        /#[0-9a-fA-F]{3,8}\b/,
        'codeEditor.js must not contain raw hex color literals; use Handfish tokens'
    )
    assert.doesNotMatch(
        codeEditorSource,
        /\b(?:rgba?|hsla?)\s*\(/i,
        'codeEditor.js must not contain raw rgb/rgba or hsl/hsla literals; use Handfish tokens'
    )
})

test('codeEditor.js enforces tabular-nums and layout stability on gutter line numbers', () => {
    assert.match(
        codeEditorSource,
        /\.code-editor-gutter\s*\{[^}]*?font-variant-numeric:\s*tabular-nums/,
        'code-editor-gutter must specify font-variant-numeric: tabular-nums'
    )
    assert.match(
        codeEditorSource,
        /\.code-editor-gutter \.line-number\s*\{[^}]*?font-variant-numeric:\s*tabular-nums/,
        'gutter line-number must specify font-variant-numeric: tabular-nums'
    )
    assert.match(
        codeEditorSource,
        /\.line-number\.error-line\s*\{[^}]*?font-variant-numeric:\s*tabular-nums/,
        'error-line must preserve tabular-nums to prevent horizontal shifts'
    )
})

test('embed.js manages error markers with MutationObserver resilience and typing fast-path', () => {
    assert.match(embedSource, /import \{ parseErrorLocation, formatErrorLabel \} from '\.\/ui\/errorBanner\.js'/)
    assert.match(embedSource, /setErrorLineMarker\(loc\)/)
    assert.match(embedSource, /clearErrorLineMarker\(\)/)
    assert.match(embedSource, /targetLineIndex = Math\.max\(0, Math\.min\(loc\.line - 1, lines\.length - 1\)\)/)
    assert.match(embedSource, /setSelectionRange\(offset, Math\.max\(offset, endOffset\)\)/)
    assert.match(embedSource, /syncScroll\?\.\(\)/)
    assert.match(embedSource, /markerObserver\s*=\s*new MutationObserver/, 'embed.js should use MutationObserver to persist error markers across re-renders')
    assert.match(embedSource, /if \(!hasActiveErrorMarker \|\| !dslEditor\) return/, 'clearErrorLineMarker should provide an O(1) early exit when no markers are active')
})

test('embed.js waits out in-flight compiles without dropping forcerecompile or forceevalblock', () => {
    const forceRecompileMatch = embedSource.match(/addEventListener\('forcerecompile'[\s\S]*?\}\)/)?.[0] || ''
    assert.ok(forceRecompileMatch, 'forcerecompile handler must exist')
    assert.doesNotMatch(forceRecompileMatch, /if \(_compileInFlight\) return/, 'forcerecompile must not drop user action')
    assert.match(forceRecompileMatch, /while \(_compileInFlight\)/, 'forcerecompile must wait for in-flight compile')

    const forceEvalBlockMatch = embedSource.match(/addEventListener\('forceevalblock'[\s\S]*?\}\)/)?.[0] || ''
    assert.ok(forceEvalBlockMatch, 'forceevalblock handler must exist')
    assert.doesNotMatch(forceEvalBlockMatch, /if \(_compileInFlight\) return/, 'forceevalblock must not drop user action')
    assert.match(forceEvalBlockMatch, /while \(_compileInFlight\)/, 'forceevalblock must wait for in-flight compile')
})

test('index.html #compiler-error uses Handfish tokens without hardcoded hex or rgba', () => {
    const indexSource = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8')
    const match = indexSource.match(/#compiler-error\s*\{[\s\S]*?#compiler-error span:hover\s*\{[^}]*\}/)
    assert.ok(match, '#compiler-error styles block must exist')
    const errorCss = match[0]
    assert.match(errorCss, /var\(--hf-red/)
    assert.doesNotMatch(errorCss, /#ff6b6b/)
    assert.doesNotMatch(errorCss, /rgba\(0,\s*0,\s*0,\s*0\.85\)/)
    assert.match(indexSource, /id="compiler-error"\s+role="alert"\s+tabindex="0"\s+aria-live="assertive"/)
})

// ---------------------------------------------------------------------------
// Behavioral tests for the error-marker controller in embed.js. The marker
// functions are source-sliced into a vm sandbox with a stub editor DOM
// (same strategy as tests/unit/contextLoss.test.mjs) so their alignment,
// EOF clamping, and stale-marker behavior can be asserted directly.
// ---------------------------------------------------------------------------
import vm from 'node:vm'

const markerSliceStart = embedSource.indexOf('let activeErrorLoc')
const markerSliceEnd = embedSource.indexOf('function showCompilerError')
const markerSlice = embedSource.slice(markerSliceStart, markerSliceEnd)

function makeEl(lineNumber) {
    const classes = new Set()
    return {
        lineNumber,
        classList: {
            add: (...cs) => { for (const c of cs) classes.add(c) },
            remove: (...cs) => { for (const c of cs) classes.delete(c) },
            has: (c) => classes.has(c),
        },
    }
}

function makeEditor(lineCount) {
    const display = Array.from({ length: lineCount }, (_, i) => makeEl(i + 1))
    const gutter = Array.from({ length: lineCount }, (_, i) => makeEl(i + 1))
    const gutterEl = { children: gutter }
    const all = [...display, ...gutter]
    return {
        display,
        gutter,
        all,
        querySelector(sel) {
            const m = /data-line-number="(\d+)"/.exec(sel)
            if (m && sel.includes('code-editor-display')) return display[Number(m[1]) - 1] || null
            if (sel.includes('code-editor-gutter')) return gutterEl
            return null
        },
        querySelectorAll(sel) {
            const wantsError = sel.includes('.error-line')
            const match = (e) => !wantsError || e.classList.has('error-line')
            if (sel === '.error-line') return all.filter(match)
            if (sel.includes('code-editor-display')) return display.filter(match)
            if (sel.includes('code-editor-gutter')) return gutter.filter(match)
            if (sel.includes('.line-number')) return gutter
            return []
        },
    }
}

function markerSandbox(editor) {
    const sandbox = {
        dslEditor: editor,
        setTimeout,
        clearTimeout,
    }
    vm.createContext(sandbox)
    // Top-level `let` bindings are not exposed on the sandbox global, so the
    // completion value re-exports the controller plus the fast-path flag.
    sandbox.controller = vm.runInContext(
        `${markerSlice};\n({ setErrorLineMarker, clearErrorLineMarker, hasActiveErrorMarker })`,
        sandbox
    )
    return sandbox
}

function markedLines(editor, list) {
    return list.filter((e) => e.classList.has('error-line')).map((e) => e.lineNumber)
}

test('error marker controller clamps EOF diagnostics onto the last document line', () => {
    assert.ok(markerSliceStart > 0 && markerSliceEnd > markerSliceStart, 'embed.js must expose the marker controller slice')
    const editor = makeEditor(4)
    const sandbox = markerSandbox(editor)
    sandbox.controller.setErrorLineMarker({ line: 99, col: 1 })
    assert.deepEqual(markedLines(editor, editor.display), [4], 'display marker must clamp to the last line')
    assert.deepEqual(markedLines(editor, editor.gutter), [4], 'gutter marker must clamp to the last line')
})

test('error marker controller clears stale markers so highlights never straddle two lines', () => {
    const editor = makeEditor(6)
    const sandbox = markerSandbox(editor)
    sandbox.controller.setErrorLineMarker({ line: 2, col: 1 })
    assert.deepEqual(markedLines(editor, editor.display), [2])
    // Simulate a formatter run / Handfish re-render: the diagnostic is
    // re-applied for a different line while the old element still carries
    // the marker class.
    sandbox.controller.setErrorLineMarker({ line: 5, col: 1 })
    assert.deepEqual(markedLines(editor, editor.display), [5])
    assert.deepEqual(markedLines(editor, editor.gutter), [5])
})

test('clearErrorLineMarker removes all markers and cancels the pending re-apply', async () => {
    const editor = makeEditor(3)
    const sandbox = markerSandbox(editor)
    sandbox.controller.setErrorLineMarker({ line: 2, col: 1 })
    assert.equal(editor.display[1].classList.has('error-line'), true)
    sandbox.controller.clearErrorLineMarker()
    assert.equal(editor.display[1].classList.has('error-line'), false)
    assert.equal(editor.gutter[1].classList.has('error-line'), false)
    assert.equal(sandbox.controller.hasActiveErrorMarker, false)
    // The 200ms deferred re-apply must not resurrect the marker after a clear.
    await new Promise((resolve) => setTimeout(resolve, 280))
    assert.equal(editor.display[1].classList.has('error-line'), false)
    assert.equal(editor.gutter[1].classList.has('error-line'), false)
})

test('error marker controller is a no-op on an empty document', () => {
    const editor = makeEditor(0)
    const sandbox = markerSandbox(editor)
    sandbox.controller.setErrorLineMarker({ line: 1, col: 1 })
    assert.deepEqual(markedLines(editor, editor.display), [])
    assert.deepEqual(markedLines(editor, editor.gutter), [])
    assert.equal(sandbox.controller.hasActiveErrorMarker, false)
})


