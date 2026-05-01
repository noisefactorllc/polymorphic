import { test } from 'node:test'
import assert from 'node:assert'
import { surfacesWrittenInDsl, currentRenderTarget } from '../../public/js/ui/outputPicker.js'

test('surfacesWrittenInDsl finds each .write(oN)', () => {
    const dsl = `noise().write(o0)\ngradient().write(o3)\nrender(o0)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [0, 3])
})

test('surfacesWrittenInDsl tolerates whitespace', () => {
    const dsl = `noise()\n  .write( o7 )\nrender(o7)`
    assert.deepStrictEqual(surfacesWrittenInDsl(dsl), [7])
})

test('currentRenderTarget reads the last render(oN)', () => {
    const dsl = `noise().write(o0)\nrender(o0)\nrender(o3)`
    assert.strictEqual(currentRenderTarget(dsl), 3)
})

test('currentRenderTarget returns null when render() absent', () => {
    assert.strictEqual(currentRenderTarget('noise().write(o0)'), null)
})
