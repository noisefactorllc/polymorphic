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

// Sandbox context whose CanvasRenderer stub returns the given engine, plus a
// loader that executes the sliced PolymorphicRenderer class body in it.
function sandboxContext(engine, canvas) {
    return vm.createContext({
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
}

function loadRendererClass(context) {
    vm.runInContext(classSource, context)
    const Renderer = context.PolymorphicRenderer
    // Match the class body's export shape (vm exposes top-level class binding
    // only if declared as a var-like; recover it via a shim if needed).
    return Renderer || vm.runInContext('PolymorphicRenderer', context)
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

    const context = sandboxContext(engine, canvas)
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, options)
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

// ---- WebGPU device loss (`device.lost`) ----

// A GPUDevice stub whose `lost` promise is resolved manually.
function stubGpuDevice() {
    let resolveLost
    const lost = new Promise(resolve => { resolveLost = resolve })
    return { lost, lose: info => resolveLost(info || { reason: 'unknown' }) }
}

// An engine stub whose compile() installs (or replaces) a pipeline with the
// given device — mirroring how the real engine binds a fresh GPUDevice when it
// builds a new pipeline.
function gpuEngine(device) {
    return {
        isRunning: false,
        stopCount: 0,
        startCount: 0,
        compileCalls: [],
        manifest: {},
        _pipeline: { backend: { device } },
        async loadManifest() { return this.manifest },
        setLoopDuration() {},
        stop() { this.stopCount++; this.isRunning = false },
        start() { this.startCount++; this.isRunning = true },
        async compile(dsl) {
            this.compileCalls.push(dsl)
            return { success: true }
        }
    }
}

test('a WebGPU device loss stops the loop, marks context lost and notifies', async () => {
    let lostInfo = null
    const device = stubGpuDevice()
    const canvas = stubCanvas()
    const engine = gpuEngine(device)
    const context = vm.createContext(sandboxContext(engine, canvas))
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, { onDeviceLost: info => { lostInfo = info } })
    renderer._renderer = engine
    await renderer.compile('osc()')
    assert.equal(renderer.contextLost, false)

    device.lose({ reason: 'internal' })
    await device.lost
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(lostInfo?.reason, 'internal')
    assert.equal(renderer.contextLost, true)
    assert.equal(engine.stopCount, 1)
    assert.equal(engine.isRunning, false)
})

test('a destroyed WebGPU device is ignored (intentional shutdown, not a reset)', async () => {
    let notified = 0
    const device = stubGpuDevice()
    const canvas = stubCanvas()
    const engine = gpuEngine(device)
    const context = vm.createContext(sandboxContext(engine, canvas))
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, { onDeviceLost: () => { notified++ } })
    renderer._renderer = engine
    await renderer.compile('osc()')

    device.lose({ reason: 'destroyed' })
    await device.lost
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(notified, 0)
    assert.equal(renderer.contextLost, false)
    assert.equal(engine.stopCount, 0)
})

test('recoverFromContextLoss drops the dead WebGPU pipeline and rebuilds on a new device', async () => {
    const device = stubGpuDevice()
    const canvas = stubCanvas()
    const disposed = []
    const deadPipeline = { backend: { device }, dispose: () => disposed.push('dead') }
    const engine = gpuEngine(device)
    engine._pipeline = deadPipeline
    const context = vm.createContext(sandboxContext(engine, canvas))
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, {})
    renderer._renderer = engine
    await renderer.compile('osc()')

    device.lose({ reason: 'internal' })
    await device.lost
    await new Promise(resolve => setImmediate(resolve))

    // Recovery installs a fresh pipeline/device, mirroring the engine's
    // _createRuntime path.
    const freshDevice = stubGpuDevice()
    let pipelineWasDropped = false
    engine.compile = async dsl => {
        engine.compileCalls.push(dsl)
        pipelineWasDropped = engine._pipeline === null
        engine._pipeline = { backend: { device: freshDevice } }
        return { success: true }
    }
    const result = await renderer.recoverFromContextLoss('osc()')
    assert.equal(result.success, true)
    assert.deepEqual(disposed, ['dead'])
    assert.equal(pipelineWasDropped, true, 'dead pipeline was dropped before recompile')
    assert.deepEqual(engine.compileCalls, ['osc()', 'osc()'])
    assert.equal(renderer.contextLost, false)
    assert.equal(engine.isRunning, true)
    // The new device is watched, not the dead one.
    assert.equal(renderer._watchedGpuDevice, freshDevice)

    // A second loss on the fresh device is also handled (re-armed).
    let lostAgain = 0
    renderer.onDeviceLost = () => { lostAgain++ }
    freshDevice.lose({ reason: 'internal' })
    await freshDevice.lost
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(lostAgain, 1)
    assert.equal(renderer.contextLost, true)
})

test('recoverFromContextLoss keeps the existing pipeline when no WebGPU device was lost', async () => {
    const canvas = stubCanvas()
    const engine = gpuEngine(null)
    engine._pipeline = { backend: { getName: () => 'WebGL2' } }
    const context = vm.createContext(sandboxContext(engine, canvas))
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, {})
    renderer._renderer = engine
    await renderer.compile('osc()')

    const result = await renderer.recoverFromContextLoss('osc()')
    assert.equal(result.success, true)
    assert.notEqual(engine._pipeline, null)
    assert.deepEqual(engine.compileCalls, ['osc()', 'osc()'])
    assert.equal(engine.isRunning, true)
})

test('re-arming the watch on the same device does not stack duplicate lost handlers', async () => {
    const device = stubGpuDevice()
    const canvas = stubCanvas()
    const engine = gpuEngine(device)
    const context = vm.createContext(sandboxContext(engine, canvas))
    const Renderer = loadRendererClass(context)
    const renderer = new Renderer(canvas, {})
    renderer._renderer = engine
    await renderer.compile('osc()')
    await renderer.compile('osc(rect())')
    await renderer.compile('osc(tri())')

    let notified = 0
    renderer.onDeviceLost = () => { notified++ }
    device.lose({ reason: 'internal' })
    await device.lost
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(notified, 1)
    assert.equal(renderer._watchedGpuDevice, device)
})
