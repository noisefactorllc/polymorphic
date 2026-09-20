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

test('embed.js manages error markers, formats diagnostics, and bounds jump offset', () => {
    assert.match(embedSource, /import \{ parseErrorLocation, formatErrorLabel \} from '\.\/ui\/errorBanner\.js'/)
    assert.match(embedSource, /setErrorLineMarker\(loc\)/)
    assert.match(embedSource, /clearErrorLineMarker\(\)/)
    assert.match(embedSource, /targetLineIndex = Math\.max\(0, Math\.min\(loc\.line - 1, lines\.length - 1\)\)/)
    assert.match(embedSource, /setSelectionRange\(offset, Math\.max\(offset, endOffset\)\)/)
    assert.match(embedSource, /syncScroll\?\.\(\)/)
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

