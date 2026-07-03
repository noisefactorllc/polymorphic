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
