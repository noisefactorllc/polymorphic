import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { isWebGPUFallback } from '../../public/js/backendFallback.js'

// PolymorphicRenderer.backend must name the backend that renders, not the one
// that was requested. The served engine pinned this contract on
// CanvasRenderer (a WebGPU request runs a WebGL2 pipeline when the browser has
// no WebGPU adapter, and backend used to echo the request anyway), and the
// wrapper getter is what the perf overlay, the fallback toast and the curated
// reload path all read. The renderer module imports the browser-only
// noisemaker bundle, so these tests run the class body in a vm sandbox with a
// stub engine — the same source-slicing strategy as contextLoss.test.mjs.
const source = readFileSync(new URL('../../public/js/noisemaker/renderer.js', import.meta.url), 'utf8')
const classSource = source
    .slice(source.indexOf('export class PolymorphicRenderer'))
    .replace('export class PolymorphicRenderer', 'class PolymorphicRenderer')

function loadRendererClass(engine) {
    const context = vm.createContext({
        console,
        SHADER_BASE_PATH: 'https://shaders.noisedeck.app/1',
        CanvasRenderer: function () { return engine },
        stripMediaUrlArg: dsl => dsl,
        extractEffectNamesFromDsl: () => [],
        extractEffectsFromDsl: () => [],
        textEffectsFromParsed: () => []
    })
    vm.runInContext(classSource, context)
    return context.PolymorphicRenderer || vm.runInContext('PolymorphicRenderer', context)
}

// engineBackend mirrors the served engine's getter: with an active pipeline it
// names the pipeline's backend ('wgsl' WebGPU / 'glsl' WebGL2); with no
// pipeline it echoes the request.
function stubEngine({ pipelineName = null, engineBackend = null } = {}) {
    const engine = {
        async loadManifest() {},
        setLoopDuration() {},
        _pipeline: pipelineName ? { backend: { getName: () => pipelineName } } : null,
        get pipeline() { return this._pipeline }
    }
    if (engineBackend !== null) engine.backend = engineBackend
    return engine
}

function make(options, engine) {
    const Renderer = loadRendererClass(engine)
    const canvas = { width: 64, height: 64, addEventListener() {}, removeEventListener() {} }
    return new Renderer(canvas, options)
}

test('backend names the WebGL2 pipeline that renders a WebGPU request', () => {
    const engine = stubEngine({ pipelineName: 'WebGL2', engineBackend: 'wgsl' })
    const renderer = make({ preferWebGPU: true }, engine)
    assert.equal(renderer.backend, 'webgl2')
})

test('backend names the WebGPU pipeline that renders', () => {
    const engine = stubEngine({ pipelineName: 'WebGPU', engineBackend: 'wgsl' })
    const renderer = make({ preferWebGPU: true }, engine)
    assert.equal(renderer.backend, 'webgpu')
})

test('before the first compile, backend follows the engine request', () => {
    const webgpuRequested = stubEngine({ pipelineName: null, engineBackend: 'wgsl' })
    assert.equal(make({ preferWebGPU: true }, webgpuRequested).backend, 'webgpu')

    const webglRequested = stubEngine({ pipelineName: null, engineBackend: 'glsl' })
    assert.equal(make({ preferWebGPU: false }, webglRequested).backend, 'webgl2')
})

test('a WebGPU request that fell back to a rendered WebGL2 pipeline reads as a fallback', () => {
    const engine = stubEngine({ pipelineName: 'WebGL2', engineBackend: 'wgsl' })
    const renderer = make({ preferWebGPU: true }, engine)
    assert.equal(isWebGPUFallback({ preferWebGPU: renderer.preferWebGPU, actualBackend: renderer.backend }), true)
})