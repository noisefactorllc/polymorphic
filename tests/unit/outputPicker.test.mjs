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

test('switchOutputSurface stays linear on an unterminated render( with a long run', () => {
    const start = Date.now()
    const hostile = 'render(' + "'".repeat(60000)
    switchOutputSurface(hostile, 1)
    assert.ok(Date.now() - start < 2000, 'render() matching must not backtrack exponentially')
})

// --- enable/disable state machine ---
//
// The pip builders are stubbed so the state machine is exercised without a
// DOM or WebGL: each fake renderer reports running until dispose() stops it.

function fakePickerShell() {
    const classes = new Set()
    return {
        classes,
        el: {
            appendChild() {},
            classList: {
                toggle(name, force) { if (force) classes.add(name); else classes.delete(name) },
                contains: name => classes.has(name),
            },
        },
    }
}

function stubPipBuilders(picker) {
    const made = []
    picker._createPip = async (idx) => {
        const renderer = {
            running: true,
            disposed: false,
            loseContext: null,
            start() { renderer.running = true },
            stop() { renderer.running = false },
            async dispose({ loseContext } = {}) {
                renderer.disposed = true
                renderer.loseContext = loseContext === true
                renderer.running = false
            },
        }
        const removed = { value: false }
        const pip = {
            removed,
            classList: { toggle() {} },
            setAttribute() {},
            remove() { removed.value = true },
        }
        made.push({ idx, renderer, removed })
        return { pip, canvas: {}, renderer }
    }
    return made
}

function freshPickerState(picker, { enabled, dsl = '' }) {
    picker._el = fakePickerShell().el
    picker._previews = new Map()
    picker._dsl = dsl
    picker._activeSurface = null
    picker._userEnabled = enabled
    picker._pending = null
}

const MULTI_SURFACE_DSL = 'noise().write(o0)\ngradient().write(o1)\n\nrender(o0)'

test('a disabled picker builds no preview renderers for a written program', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: false })
    const made = stubPipBuilders(picker)

    await picker.setDsl(MULTI_SURFACE_DSL)

    assert.strictEqual(made.length, 0, 'no pip renderer may be built while the picker is off')
    assert.strictEqual(picker._previews.size, 0)
    assert.ok(!picker._el.classList.contains('visible'))
})

test('switching the picker off stops and disposes its preview render loops', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: true })
    const made = stubPipBuilders(picker)

    await picker.setDsl(MULTI_SURFACE_DSL)
    assert.strictEqual(picker._previews.size, 2)
    for (const entry of picker._previews.values()) {
        assert.strictEqual(entry.renderer.running, true, 'pip render loop starts with the picker on')
    }

    assert.strictEqual(picker.setEnabled(false), false)
    await picker._pending

    assert.strictEqual(picker._previews.size, 0, 'every hidden preview is dropped when the picker turns off')
    for (const m of made) {
        assert.strictEqual(m.renderer.disposed, true, `o${m.idx} pip renderer must be disposed`)
        assert.strictEqual(m.renderer.loseContext, true, `o${m.idx} pip GL context must be released`)
        assert.strictEqual(m.renderer.running, false, `o${m.idx} pip render loop must be stopped`)
        assert.strictEqual(m.removed.value, true, `o${m.idx} pip element must leave the DOM`)
    }
    assert.ok(!picker._el.classList.contains('visible'))
})

test('switching the picker back on recreates previews for the current surfaces', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: true })
    const made = stubPipBuilders(picker)

    await picker.setDsl(MULTI_SURFACE_DSL)
    picker.setEnabled(false)
    await picker._pending
    assert.strictEqual(picker._previews.size, 0)

    assert.strictEqual(picker.setEnabled(true), true)
    await picker._pending

    assert.strictEqual(picker._previews.size, 2, 'previews are recreated for the surfaces still written')
    assert.deepStrictEqual([...picker._previews.keys()].sort(), [0, 1])
    for (const entry of picker._previews.values()) {
        assert.strictEqual(entry.renderer.running, true, 'recreated pip render loops are running again')
    }
})

test('while the picker is off a DSL rewrite builds no renderers and clears stale ones', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: true })
    const made = stubPipBuilders(picker)

    await picker.setDsl(MULTI_SURFACE_DSL)
    picker.setEnabled(false)
    await picker._pending

    await picker.setDsl('noise().write(o0)\ngradient().write(o3)\n\nrender(o3)')

    assert.strictEqual(picker._previews.size, 0, 'a disabled picker must not spawn previews for new surfaces')
    assert.strictEqual(made.length, 2, 'no additional pip renderer is built while off')
    assert.strictEqual(picker._activeSurface, 3, 'the active surface still tracks the program while off')
})

test('a disable that lands mid-build stops loops promptly and never starts the in-flight pip', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: true })
    const built = []
    // Mirrors the real _createPip contract: the awaited build happens first,
    // then the pre-start gate re-checks _userEnabled before starting the loop.
    picker._createPip = async (idx) => {
        await new Promise(resolve => setTimeout(resolve, 30))
        const renderer = {
            running: false,
            started: false,
            disposed: false,
            loseContext: null,
            start() { renderer.started = true; renderer.running = true },
            stop() { renderer.running = false },
            async dispose({ loseContext } = {}) {
                renderer.disposed = true
                renderer.loseContext = loseContext === true
                renderer.running = false
            },
        }
        const removed = { value: false }
        const pip = {
            removed,
            classList: { toggle() {} },
            setAttribute() {},
            remove() { removed.value = true },
        }
        built.push({ idx, renderer, removed })
        if (picker._userEnabled) renderer.start()
        return { pip, canvas: {}, renderer }
    }

    await picker.setDsl(MULTI_SURFACE_DSL)
    assert.strictEqual(picker._previews.size, 2)

    // A DSL rewrite adds a new surface and its pip build enters its awaited
    // compile; the user switches the picker off while that build is in flight.
    const rebuild = picker.setDsl('noise().write(o0)\ngradient().write(o3)\n\nrender(o3)')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.strictEqual(picker.setEnabled(false), false)

    // Prompt stop: the already-built pip loops are stopped synchronously,
    // not after the in-flight build resolves.
    for (const entry of [...picker._previews.values()]) {
        assert.strictEqual(entry.renderer.running, false, 'existing pip loop stops the moment the picker is disabled')
    }

    await picker._pending

    assert.strictEqual(picker._previews.size, 0, 'no preview survives a disable, even one built mid-flight')
    const inFlight = built.find(b => b.idx === 3)
    assert.ok(inFlight, 'the in-flight pip build ran to completion')
    assert.strictEqual(inFlight.renderer.started, false, 'the in-flight pip loop never started')
    assert.strictEqual(inFlight.renderer.disposed, true, 'the in-flight pip renderer is disposed')
    assert.strictEqual(inFlight.renderer.loseContext, true)
    assert.strictEqual(inFlight.removed.value, true, 'the in-flight pip element never appears')
    for (const b of built.filter(b => b.idx !== 3)) {
        assert.strictEqual(b.renderer.started, true, `o${b.idx} ran while the picker was on`)
        assert.strictEqual(b.renderer.disposed, true, `o${b.idx} renderer disposed by the disable`)
        assert.strictEqual(b.removed.value, true, `o${b.idx} pip element removed by the disable`)
    }
    await rebuild
})

test('an enabled picker still drops the pip of a surface that stops being written', async () => {
    const picker = outputPicker
    freshPickerState(picker, { enabled: true })
    const made = stubPipBuilders(picker)

    await picker.setDsl(MULTI_SURFACE_DSL)
    await picker.setDsl('noise().write(o0)\n\nrender(o0)')

    assert.strictEqual(picker._previews.size, 1)
    assert.ok(picker._previews.has(0))
    const dropped = made.find(m => m.idx === 1)
    assert.strictEqual(dropped.renderer.disposed, true, 'the o1 pip renderer is disposed with its surface')
    assert.strictEqual(dropped.removed.value, true)
})
