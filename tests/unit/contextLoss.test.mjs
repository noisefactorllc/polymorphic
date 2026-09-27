import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// WebGL context loss recovery: PolymorphicRenderer watches the canvas for
// `webglcontextlost` / `webglcontextrestored`, stops its render loop on loss,
// and exposes a recompile-and-restart recovery path. The renderer module
// imports the noisemaker bundle (browser-only), so these tests load the
// PolymorphicRenderer class body into a vm sandbox with a stub engine — the
// same source-slicing strategy used for embed.js in compile-ordering.test.mjs.
const source = readFileSync(new URL('../../public/js/noisemaker/renderer.js', import.meta.url), 'utf8')
const classSource = source
    .slice(source.indexOf('export class PolymorphicRenderer'))
    .replace('export class PolymorphicRenderer', 'class PolymorphicRenderer')

function stubCanvas() {
    const listeners = new Map()
    const removed = []
    return {
        listeners,
        removed,
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type).push(fn)
        },
        removeEventListener(type, fn) {
            removed.push([type, fn])
            const fns = listeners.get(type) || []
            const i = fns.indexOf(fn)
            if (i >= 0) fns.splice(i, 1)
        },
        dispatch(type) {
            const event = { preventDefault() { event.defaultPrevented = true } }
            for (const fn of [...(listeners.get(type) || [])]) fn(event)
            return event
        }
    }
}

async function make({ options = {}, inner = {} } = {}) {
    const canvas = stubCanvas()
    const engine = Object.assign({
        isRunning: false,
        stopCount: 0,
        startCount: 0,
        compileCalls: [],
        compileResult: { success: true },
        manifest: {},
        async loadManifest() { return this.manifest },
        setLoopDuration() {},
        stop() { this.stopCount++; this.isRunning = false },
        start() { this.startCount++; this.isRunning = true },
        async compile(dsl) {
            this.compileCalls.push(dsl)
            return typeof this.compileResult === 'function' ? this.compileResult() : this.compileResult
        }
    }, inner)

    const context = vm.createContext({
        console,
        SHADER_BASE_PATH: 'https://shaders.noisedeck.app/1',
        // The engine wrapper (CanvasRenderer) is browser-only; stub it.
        CanvasRenderer: function () { return engine },
        // Bundle helpers are stubbed out: context-loss tests exercise loss /
        // recovery control flow, not compilation semantics.
        stripMediaUrlArg: dsl => dsl,
        extractEffectNamesFromDsl: () => [],
        extractEffectsFromDsl: () => [],
        parseDsl: () => null,
        findCalls: () => [],
        stringArg: () => null,
        textEffectsFromParsed: () => [],
        extractMediaParams: () => null,
        MEDIA_DEFAULTS: { url: null }
    })
    vm.runInContext(classSource, context)
    const Renderer = context.PolymorphicRenderer
    // Match the class body's export shape (vm exposes top-level class binding
    // only if declared as a var-like; recover it via a shim if needed).
    const resolved = Renderer || vm.runInContext('PolymorphicRenderer', context)
    const renderer = new resolved(canvas, options)
    renderer._renderer = engine
    return { renderer, engine, canvas }
}

test('init() registers webglcontextlost and webglcontextrestored listeners on the canvas', async () => {
    const { renderer, canvas } = await make({})
    await renderer.init()
    assert.ok(canvas.listeners.get('webglcontextlost')?.length === 1)
    assert.ok(canvas.listeners.get('webglcontextrestored')?.length === 1)
})

test('a context lost event calls preventDefault, stops the loop and notifies', async () => {
    let notified = 0
    const { renderer, engine } = await make({ options: { onContextLost: () => { notified++ } } })
    engine.isRunning = true
    await renderer.init()
    const event = canvas_dispatch(renderer.canvas, 'webglcontextlost')
    assert.equal(notified, 1)
    assert.equal(event.defaultPrevented, true)
    assert.equal(renderer.contextLost, true)
    assert.equal(engine.stopCount, 1)
    assert.equal(engine.isRunning, false)
})

test('a throwing onContextLost handler does not break loss handling', async () => {
    const { renderer, engine } = await make({ options: { onContextLost: () => { throw new Error('boom') } } })
    await renderer.init()
    const event = canvas_dispatch(renderer.canvas, 'webglcontextlost')
    assert.equal(event.defaultPrevented, true)
    assert.equal(renderer.contextLost, true)
    assert.equal(engine.stopCount, 1)
})

test('a context restored event clears the lost flag and notifies with the renderer', async () => {
    let payload = null
    const { renderer } = await make({ options: { onContextRestored: (_e, r) => { payload = r } } })
    await renderer.init()
    canvas_dispatch(renderer.canvas, 'webglcontextlost')
    canvas_dispatch(renderer.canvas, 'webglcontextrestored')
    assert.equal(renderer.contextLost, false)
    assert.equal(payload, renderer)
})

test('recoverFromContextLoss recompiles the DSL and restarts a stopped loop', async () => {
    const { renderer, engine } = await make({})
    engine.isRunning = false
    const result = await renderer.recoverFromContextLoss('osc()')
    assert.equal(result.success, true)
    assert.deepEqual(engine.compileCalls, ['osc()'])
    assert.equal(engine.startCount, 1)
    assert.equal(engine.isRunning, true)
})

test('recoverFromContextLoss does not double-start an already running loop', async () => {
    const { renderer, engine } = await make({})
    engine.isRunning = true
    await renderer.recoverFromContextLoss('osc()')
    assert.equal(engine.startCount, 0)
})

test('recoverFromContextLoss surfaces a compile failure without starting the loop', async () => {
    const { renderer, engine } = await make({
        inner: { compileResult: () => { throw new Error('bad shader') } }
    })
    const result = await renderer.recoverFromContextLoss('osc()')
    assert.equal(result.success, false)
    assert.equal(result.error, 'bad shader')
    assert.equal(engine.startCount, 0)
})

test('dispose() removes the context loss listeners', async () => {
    const { renderer, canvas } = await make({})
    await renderer.init()
    const lost = renderer._contextLostHandler
    const restored = renderer._contextRestoredHandler
    renderer.dispose()
    assert.deepEqual(canvas.removed, [
        ['webglcontextlost', lost],
        ['webglcontextrestored', restored]
    ])
    assert.equal(canvas.listeners.get('webglcontextlost').length, 0)
    assert.equal(canvas.listeners.get('webglcontextrestored').length, 0)
})

function canvas_dispatch(canvas, type) {
    return canvas.dispatch(type)
}
