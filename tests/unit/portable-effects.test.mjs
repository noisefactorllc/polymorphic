import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Substitute only the remote CDN boundary; execute the production loader.
const runtimeRegistrations = []
const starters = new Set()
const enums = []
let runtimeEnums
class Effect {
    constructor(config) { Object.assign(this, config) }
    asyncInit() {}
}
class CanvasRenderer {
    registerEffectWithRuntime(effect) {
        runtimeRegistrations.push(effect)
        return runtimeEnums
    }
}
globalThis.__portableRuntime = { CanvasRenderer, Effect, registerStarterOps: names => names.forEach(name => starters.add(name)), mergeIntoEnums: value => enums.push(value) }
const source = (await readFile(new URL('../../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const { CanvasRenderer, Effect, registerStarterOps, mergeIntoEnums } = globalThis.__portableRuntime')
const loader = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('composition imports retain the original image payloads for rendering and reshare', async t => {
    const previous = globalThis.fetch
    const images = [{ id: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AAAA' }]
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'abcdef', dsl: 'media().write(o0)', images }) })
    t.after(() => { globalThis.fetch = previous })
    assert.deepEqual((await loader.loadFromCode('abcdef')).images, images)
})
const data = {
    name: 'Volume', func: 'volume', namespace: 'synth3d', starter: true,
    textures: { volume: { type: '3d', width: 16, height: 16, depth: 16 } },
    outputTex3d: 'volume', outputGeo: 'geometry',
    uniformLayout: [{ name: 'size', type: 'vec3' }], uniformLayouts: { main: [] },
    defaultProgram: 'search user\nvolume().write3d(o0)',
    passes: [{ inputs: {}, outputs: { color: 'volume' }, program: 'main' }],
    shaders: { main: { glsl: 'glsl source', wgsl: 'wgsl source' } }
}

test('registers volume metadata on an Effect instance in user namespace', () => {
    const result = loader.registerPortableEffect(data)
    assert.ok(result.instance instanceof Effect)
    assert.equal(result.instance.asyncInit, Effect.prototype.asyncInit)
    assert.equal(result.namespace, 'user')
    for (const key of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'passes', 'shaders']) {
        assert.deepEqual(result.instance[key], data[key], key)
    }
    assert.equal(runtimeRegistrations.at(-1), result)
    assert.equal(loader.getLoadedPortableEffects().get('user/volume').outputTex3d, 'volume')
})

test('3D input consumers infer filters when starter metadata is omitted', () => {
    const effect = loader.registerPortableEffect({ ...data, namespace: 'user', func: 'volumeFilter', starter: undefined, passes: [{ inputs: { density: 'inputTex3d' } }] })
    assert.equal(starters.has('user.volumeFilter'), false)
    assert.equal(effect.instance.outputTex3d, 'volume')
})

test('explicit false starter is retained for effects with no declared pass inputs', () => {
    loader.registerPortableEffect({ ...data, namespace: 'user', func: 'explicitFilter', starter: false })
    assert.equal(starters.has('user.explicitFilter'), false)
})

for (const [label, starter, expected] of [
    ['inferred', undefined, false],
    ['explicit_filter', false, false],
    ['explicit_starter', true, true]
]) {
    test(`geometry-only input respects ${label} starter classification`, () => {
        const func = `geometry_${label}`
        loader.registerPortableEffect({ ...data, func, starter,
            passes: [{ inputs: { geometry: 'inputGeo' }, outputs: { color: 'outputTex' } }]
        })
        assert.equal(starters.has(`user.${func}`), expected)
    })
}

test('re-sharing emits all declarative fields without executable lifecycle hooks or shaders', () => {
    const definition = loader.portableDefinition({ ...data, asyncInit() {}, onInit() {} })
    for (const key of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'starter', 'passes']) {
        assert.deepEqual(definition[key], data[key], key)
    }
    assert.equal(definition.namespace, 'user')
    assert.equal('asyncInit' in definition, false)
    assert.equal('onInit' in definition, false)
    assert.equal('shaders' in definition, false)
})

test('share modal packages the 3D definition and each shader language for re-sharing', async () => {
    const files = new Map()
    const originalWindow = globalThis.window
    const originalReader = globalThis.FileReader
    globalThis.window = { JSZip: class {
        file(path, contents) { files.set(path, contents) }
        async generateAsync() { return {} }
    } }
    globalThis.FileReader = class {
        readAsDataURL() { this.result = 'data:application/zip;base64,archive'; this.onload() }
    }
    globalThis.__portableDefinition = loader.portableDefinition
    let modalSource = await readFile(new URL('../../public/js/shareModal.js', import.meta.url), 'utf8')
    modalSource = modalSource.replace(/import \{[^\n]+\} from '\.\/sharingLoader.js'/, 'const portableDefinition = globalThis.__portableDefinition; const getLoadedPortableEffects = () => new Map()')
    modalSource += '\nexport { buildEffectZip }\n'
    try {
        const { buildEffectZip } = await import(`data:text/javascript;base64,${Buffer.from(modalSource).toString('base64')}`)
        assert.equal(await buildEffectZip(data), 'archive')
        const definition = JSON.parse(files.get('definition.json'))
        assert.deepEqual(definition, loader.portableDefinition(data))
        assert.equal(files.get('glsl/main.glsl'), data.shaders.main.glsl)
        assert.equal(files.get('wgsl/main.wgsl'), data.shaders.main.wgsl)
    } finally {
        globalThis.window = originalWindow
        globalThis.FileReader = originalReader
        delete globalThis.__portableDefinition
    }
})

test('uses engine registration for aliases and parameter declarations', () => {
    const before = runtimeRegistrations.length
    loader.registerPortableEffect({ ...data, func: 'cell3d',
        paramAliases: { cellVariation: 'variation' },
        globals: { variation: { type: 'float', default: 100, min: 0, max: 100 } }
    })
    assert.equal(runtimeRegistrations.length, before + 1)
    const registered = runtimeRegistrations.at(-1)
    assert.equal(registered.namespace, 'user')
    assert.equal(registered.instance.paramAliases.cellVariation, 'variation')
    assert.deepEqual(registered.instance.globals.variation, { type: 'float', default: 100, min: 0, max: 100 })
})

test('merges the engine registration result for generated choices', () => {
    const before = enums.length
    runtimeEnums = { user: { volume: { volumeSize: {
        'Size 16': { type: 'Number', value: 16 }, Size16: { type: 'Number', value: 16 }
    } } } }
    try {
        loader.registerPortableEffect({ ...data, globals: { volumeSize: { type: 'int', choices: { 'Size 16': 16 } } } })
        assert.equal(enums.length, before + 1)
        assert.deepEqual(enums.at(-1), { user: { volume: { volumeSize: {
            'Size 16': { type: 'Number', value: 16 }, Size16: { type: 'Number', value: 16 }
        } } } })
    } finally { runtimeEnums = undefined }
})

test('does not merge enums when the engine has no generated choices', () => {
    const before = enums.length
    runtimeEnums = {}
    try {
        loader.registerPortableEffect({ ...data, globals: {
            mode: { type: 'int', enum: 'shared.modes', choices: { first: 0 }, default: 0 }
        } })
        assert.equal(enums.length, before)
    } finally { runtimeEnums = undefined }
})
