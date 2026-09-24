import { test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { surfacesWrittenInDsl, currentRenderTarget, effectiveRenderTarget, switchOutputSurface, outputPicker } from '../../public/js/ui/outputPicker.js'

test('surfacesWrittenInDsl finds each .write(oN)', () => {
    const dsl = `noise().write(o0)\ngradient().write(o3)\nrender(o0)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [0, 3])
})

test('surfacesWrittenInDsl tolerates whitespace', () => {
    const dsl = `noise()\n  .write( o7 )\nrender(o7)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [7])
})

test('surfacesWrittenInDsl returns empty array for empty or missing input', () => {
    assert.deepStrictEqual(surfacesWrittenInDsl(''), [])
    assert.deepStrictEqual(surfacesWrittenInDsl(null), [])
})

test('currentRenderTarget reads the last render(oN)', () => {
    const dsl = `noise().write(o0)\nrender(o0)\nrender(o3)`
    assert.strictEqual(currentRenderTarget(dsl), 3)
})

test('currentRenderTarget returns null when render() absent', () => {
    assert.strictEqual(currentRenderTarget('noise().write(o0)'), null)
})

test('effectiveRenderTarget returns explicit render target if present', () => {
    const dsl = `noise().write(o0)\ngradient().write(o2)\nrender(o2)`
    assert.strictEqual(effectiveRenderTarget(dsl), 2)
})

test('effectiveRenderTarget defaults to o0 if written when explicit render() is absent', () => {
    const dsl = `noise().write(o0)\ngradient().write(o2)`
    assert.strictEqual(effectiveRenderTarget(dsl), 0)
})

test('effectiveRenderTarget defaults to first written surface if o0 not written', () => {
    const dsl = `noise().write(o3)\ngradient().write(o5)`
    assert.strictEqual(effectiveRenderTarget(dsl), 3)
})

test('effectiveRenderTarget returns null when no surfaces are written and no render call', () => {
    assert.strictEqual(effectiveRenderTarget('noise()'), null)
    assert.strictEqual(effectiveRenderTarget(''), null)
})

test('switchOutputSurface replaces existing render(oN)', () => {
    const dsl = `noise().write(o0)\nrender(o0)`
    assert.strictEqual(switchOutputSurface(dsl, 1), `noise().write(o0)\nrender(o1)`)
})

test('switchOutputSurface tolerates whitespace in render()', () => {
    const dsl = `noise().write(o0)\n  render( o0 )`
    assert.strictEqual(switchOutputSurface(dsl, 3), `noise().write(o0)\n  render(o3)`)
})

test('switchOutputSurface replaces empty or complex render(...) expressions', () => {
    const dslEmpty = `noise().write(o0)\nrender()`
    assert.strictEqual(switchOutputSurface(dslEmpty, 4), `noise().write(o0)\nrender(o4)`)

    const dslComplex = `noise().write(o0)\nrender(read(o0))`
    assert.strictEqual(switchOutputSurface(dslComplex, 2), `noise().write(o0)\nrender(o2)`)

    const dslMultiArg = `noise().write(o0)\nrender(o0, 0.5)`
    assert.strictEqual(switchOutputSurface(dslMultiArg, 3), `noise().write(o0)\nrender(o3)`)
})

test('switchOutputSurface appends render(oN) cleanly when render() is absent', () => {
    const dsl = `noise().write(o0)\ngradient().write(o1)`
    const expected = `noise().write(o0)\ngradient().write(o1)\n\nrender(o1)\n`
    assert.strictEqual(switchOutputSurface(dsl, 1), expected)
})

test('switchOutputSurface handles empty or missing DSL', () => {
    assert.strictEqual(switchOutputSurface('', 2), `render(o2)\n`)
    assert.strictEqual(switchOutputSurface(null, 2), `render(o2)\n`)
})

test('switchOutputSurface returns original DSL on invalid surface index', () => {
    const dsl = `noise().write(o0)\nrender(o0)`
    assert.strictEqual(switchOutputSurface(dsl, -1), dsl)
    assert.strictEqual(switchOutputSurface(dsl, 8), dsl)
    assert.strictEqual(switchOutputSurface(dsl, 2.5), dsl)
    assert.strictEqual(switchOutputSurface(dsl, 'invalid'), dsl)
})

test('outputPicker.switchSurface invokes onSwitch with index and resetFeedback option', () => {
    let captured = null
    outputPicker.init({
        onSwitch: (idx, opts) => {
            captured = { idx, opts }
        }
    })

    outputPicker.switchSurface(2)
    assert.deepStrictEqual(captured, { idx: 2, opts: {} })

    outputPicker.switchSurface(4, { resetFeedback: true })
    assert.deepStrictEqual(captured, { idx: 4, opts: { resetFeedback: true } })
})

test('outputPicker styles strictly use Handfish design tokens with zero raw hex or rgba literals', () => {
    const filePath = fileURLToPath(new URL('../../public/js/ui/outputPicker.js', import.meta.url))
    const code = fs.readFileSync(filePath, 'utf8')
    const stylesMatch = code.match(/s\.textContent\s*=\s*`([\s\S]*?)`/)?.[1]
    assert.ok(stylesMatch, 'Should find injected CSS styles string')

    // Banned raw colors: #..., rgba(...)
    assert.doesNotMatch(stylesMatch, /#[0-9a-fA-F]{3,8}\b/, 'Styles must not contain raw hex colors')
    assert.doesNotMatch(stylesMatch, /rgba?\s*\(/, 'Styles must not contain raw rgb/rgba calls')
    // Must use --hf- tokens
    assert.match(stylesMatch, /var\(--hf-/, 'Styles must use Handfish --hf-* tokens')
    // Zero !important
    assert.doesNotMatch(stylesMatch, /!important/, 'Styles must not contain !important')
})
