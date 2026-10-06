import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Substitute only the remote CDN boundary; execute the production loader.
const runtimeRegistrations = []
const starters = new Set()
const enums = []
let runtimeEnums
const runtimeEffects = new Map()
class Effect {
    constructor(config) { Object.assign(this, config) }
    asyncInit() {}
}
class CanvasRenderer {
    registerEffectWithRuntime(effect) {
        runtimeRegistrations.push(effect)
        runtimeEffects.set(effect.name, effect)
        runtimeEffects.set(effect.namespace + '.' + effect.name, effect)
        return runtimeEnums
    }
    // Mirrors the shared CanvasRenderer.registerPortableEffect contract shipped
    // in noisemaker cb22a05: validation, duplicate rejection, starter inference.
    async registerPortableEffect(definition) {
        const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
        const fail = message => { throw new Error(`Portable effect: ${message}`) }
        if (!isRecord(definition)) fail('expected a definition object')
        const { namespace, passes, shaders, globals, starter } = definition
        const func = definition.func ?? definition.name
        if (typeof func !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(func)) fail('func must be a DSL identifier')
        const reserved = [...Object.getOwnPropertyNames(Object.prototype), 'prototype']
        if (reserved.includes(func)) fail(`reserved func ${func}`)
        const pending = [definition]
        const visited = new Set()
        while (pending.length) {
            const value = pending.pop()
            if (!value || typeof value !== 'object' || visited.has(value)) continue
            visited.add(value)
            for (const [key, child] of Object.entries(value)) {
                if (reserved.includes(key)) fail(`reserved metadata key ${key}`)
                if (child && typeof child === 'object') pending.push(child)
            }
        }
        if (namespace !== undefined && namespace !== 'user') fail('namespace must be user')
        if (starter !== undefined && typeof starter !== 'boolean') fail('starter must be boolean')
        if (!Array.isArray(passes) || passes.length === 0) fail('passes must be a nonempty array')
        if (!isRecord(shaders)) fail('loaded shaders are required')
        const hasSource = source => typeof source === 'string' && source.trim().length > 0
        for (const pass of passes) {
            if (!isRecord(pass) || typeof pass.program !== 'string' || !pass.program) fail('each pass must name a program')
            for (const field of ['inputs', 'outputs']) {
                if (pass[field] !== undefined && (!isRecord(pass[field]) || Object.values(pass[field]).some(value => !hasSource(value)))) {
                    fail(`pass ${field} must map names to nonempty texture references`)
                }
            }
            const source = shaders[pass.program]
            if (!isRecord(source) || ![source.glsl, source.wgsl].some(hasSource)) {
                fail(`missing shader source for ${pass.program}`)
            }
        }
        for (const language of ['glsl', 'wgsl']) {
            if (passes.some(pass => hasSource(shaders[pass.program][language]))) {
                for (const pass of passes) {
                    if (!hasSource(shaders[pass.program][language])) fail(`missing ${language} shader source for ${pass.program}`)
                }
            }
        }
        if (globals !== undefined && (!isRecord(globals) || Object.values(globals).some(spec => !isRecord(spec)))) {
            fail('globals must contain parameter objects')
        }
        for (const [key, spec] of Object.entries(globals || {})) {
            if (spec.choices !== undefined && (!isRecord(spec.choices) || Object.values(spec.choices).some(value =>
                value !== null && (spec.type === 'string' ? typeof value !== 'string' : !Number.isFinite(value))))) {
                fail(`choices for ${key} must map names to ${spec.type === 'string' ? 'strings' : 'numbers'} or null`)
            }
        }
        if (definition.paramAliases !== undefined && (!isRecord(definition.paramAliases) ||
            Object.values(definition.paramAliases).some(target => typeof target !== 'string' || !Object.hasOwn(globals || {}, target)))) {
            fail('paramAliases must map names to declared globals')
        }
        if (runtimeEffects.has(`user.${func}`) || runtimeEffects.has(`user/${func}`)) fail(`user.${func} is already registered`)
        const previousBare = runtimeEffects.get(func)
        const instance = new Effect({ ...definition, func, namespace: 'user' })
        instance.shaders = shaders
        const pipelineInputs = ['inputTex', 'inputTex3d', 'inputGeo', 'inputXyz', 'inputVel', 'inputRgba', 'src', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']
        instance.starter = starter ?? !passes.some(pass =>
            Object.values(pass.inputs || {}).some(input => pipelineInputs.includes(input)))
        const effect = { namespace: 'user', name: func, instance }
        this.registerEffectWithRuntime(effect)
        // Mirrors the shared contract exactly (canvas.js registerPortableEffect):
        // when no bare lookup existed before, the contract unregisters the bare
        // name its registration created — portable effects belong to user.*;
        // otherwise the pre-existing built-in lookup is restored.
        if (previousBare === undefined) runtimeEffects.delete(func)
        else runtimeEffects.set(func, previousBare)
        this._enums = await mergeIntoEnumsFn(runtimeEnums)
        if (instance.starter) addStarters([`user.${func}`])
        this._loadedEffects.set(`user/${func}`, effect)
        return effect
    }
}
function mergeIntoEnumsEn() { return runtimeEnums }
function addStarters(names) { names.forEach(name => starters.add(name)) }
// Mirrors the engine's mergeIntoEnums: nothing to merge leaves enums untouched.
function mergeIntoEnumsFn(source) {
    if (!source || typeof source !== 'object' || Object.keys(source).length === 0) return source || {}
    enums.push(source)
    return source
}
globalThis.__portableRuntime = {
    CanvasRenderer, Effect,
    registerStarterOps: names => names.forEach(name => starters.add(name)),
    mergeIntoEnums: value => { enums.push(value); return value },
    unregisterEffect: name => runtimeEffects.delete(name),
    getEffect: name => runtimeEffects.get(name),
    registerEffect: (name, effect) => runtimeEffects.set(name, effect)
}
// The sharing image helpers come from a sharing checkout when one is present,
// otherwise from a stand-in with the part of the contract imports use.
const helperFile = resolve(process.env.PORTABLE_IMAGES_MODULE || '../sharing/public/js/portableImages.js')
const STAND_IN = `
export async function prepareImageFile(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
    return { id, blob: new Blob([bytes], { type: blob.type }), mimeType: blob.type }
}
export function imageToBlob(image) {
    const [head, base64] = image.dataUrl.split(',')
    return new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: head.slice(5, head.indexOf(';')) })
}
export const replaceMediaUrls = dsl => dsl`
const helperUrl = existsSync(helperFile)
    ? pathToFileURL(helperFile).href
    : `data:text/javascript;base64,${Buffer.from(STAND_IN).toString('base64')}`
const source = (await readFile(new URL('../../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const { CanvasRenderer, getEffect, registerEffect, unregisterEffect } = globalThis.__portableRuntime')
    .replace(/const PORTABLE_IMAGES_URL = '[^']+'/, `const PORTABLE_IMAGES_URL = ${JSON.stringify(helperUrl)}`)
const loader = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('composition imports retain the original image bytes, as Blob records, for rendering and reshare', async t => {
    const previous = globalThis.fetch
    // A 1x1 PNG, as a response from before images were files carries it.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
    const id = createHash('sha256').update(png).digest('hex')
    const images = [{ id, dataUrl: `data:image/png;base64,${png.toString('base64')}` }]
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'abcdef', dsl: `media(url: "image:${id}").write(o0)`, images }) })
    t.after(() => { globalThis.fetch = previous })
    const loaded = await loader.loadFromCode('abcdef')
    assert.deepEqual(loaded.images.map(image => image.id), [id])
    assert.equal(loaded.images[0].dataUrl, undefined)
    assert.ok(loaded.images[0].blob instanceof Blob)
    assert.deepEqual(Buffer.from(await loaded.images[0].blob.arrayBuffer()), png)
    assert.equal(loaded.dsl, `media(url: "image:${id}").write(o0)`)
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

test('registers volume metadata on an Effect instance in user namespace', async () => {
    const result = await loader.registerPortableEffect(data)
    assert.ok(result.instance instanceof Effect)
    assert.equal(result.instance.asyncInit, Effect.prototype.asyncInit)
    assert.equal(result.namespace, 'user')
    for (const key of ['textures', 'outputTex3d', 'outputGeo', 'uniformLayout', 'uniformLayouts', 'defaultProgram', 'passes', 'shaders']) {
        assert.deepEqual(result.instance[key], data[key], key)
    }
    assert.equal(runtimeRegistrations.at(-1).instance, result.instance)
    assert.equal(result.shaders, data.shaders)
    assert.equal(result.isUserEffect, true)
    assert.equal(result.isPortable, true)
    assert.equal(loader.getLoadedPortableEffects().get('user/volume').outputTex3d, 'volume')
})

test('3D input consumers infer filters when starter metadata is omitted', async () => {
    const effect = await loader.registerPortableEffect({ ...data, namespace: 'user', func: 'volumeFilter', starter: undefined, passes: [{ program: 'main', inputs: { density: 'inputTex3d' } }] })
    assert.equal(starters.has('user.volumeFilter'), false)
    assert.equal(effect.instance.outputTex3d, 'volume')
})

test('explicit false starter is retained for effects with no declared pass inputs', async () => {
    await loader.registerPortableEffect({ ...data, namespace: 'user', func: 'explicitFilter', starter: false })
    assert.equal(starters.has('user.explicitFilter'), false)
})

for (const [label, starter, expected] of [
    ['inferred', undefined, false],
    ['explicit_filter', false, false],
    ['explicit_starter', true, true]
]) {
    test(`geometry-only input respects ${label} starter classification`, async () => {
        const func = `geometry_${label}`
        await loader.registerPortableEffect({ ...data, func, starter,
            passes: [{ program: 'main', inputs: { geometry: 'inputGeo' }, outputs: { color: 'outputTex' } }]
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

test('uses engine registration for aliases and parameter declarations', async () => {
    const before = runtimeRegistrations.length
    await loader.registerPortableEffect({ ...data, func: 'cell3d',
        paramAliases: { cellVariation: 'variation' },
        globals: { variation: { type: 'float', default: 100, min: 0, max: 100 } }
    })
    assert.equal(runtimeRegistrations.length, before + 1)
    const registered = runtimeRegistrations.at(-1)
    assert.equal(registered.namespace, 'user')
    assert.equal(registered.instance.paramAliases.cellVariation, 'variation')
    assert.deepEqual(registered.instance.globals.variation, { type: 'float', default: 100, min: 0, max: 100 })
})

test('merges the engine registration result for generated choices', async () => {
    const before = enums.length
    runtimeEnums = { user: { volume: { volumeSize: {
        'Size 16': { type: 'Number', value: 16 }, Size16: { type: 'Number', value: 16 }
    } } } }
    try {
        await loader.registerPortableEffect({ ...data, globals: { volumeSize: { type: 'int', choices: { 'Size 16': 16 } } } })
        assert.equal(enums.length, before + 1)
        assert.deepEqual(enums.at(-1), { user: { volume: { volumeSize: {
            'Size 16': { type: 'Number', value: 16 }, Size16: { type: 'Number', value: 16 }
        } } } })
    } finally { runtimeEnums = undefined }
})

test('does not merge enums when the engine has no generated choices', async () => {
    const before = enums.length
    runtimeEnums = {}
    try {
        await loader.registerPortableEffect({ ...data, globals: {
            mode: { type: 'int', enum: 'shared.modes', choices: { first: 0 }, default: 0 }
        } })
        assert.equal(enums.length, before)
    } finally { runtimeEnums = undefined }
})

for (const [label, payload] of [
    ['prototype-polluting metadata key', JSON.parse(`{
        "func": "polluted", "namespace": "user", "passes": [{"program": "main"}],
        "shaders": {"main": {"glsl": "g", "wgsl": "w"}}, "globals": {"constructor": {"type": "int"}}
    }`)],
    ['reserved func name', { ...data, func: 'constructor' }],
    ['missing shader source', { ...data, func: 'dryEffect', shaders: { main: { glsl: '  ' } } }],
    ['pass without a program', { ...data, func: 'programless', passes: [{ inputs: {} }] }],
    ['paramAlias outside declared globals', { ...data, func: 'aliased', paramAliases: { size: 'volume' }, globals: {} }]
]) {
    test(`rejects ${label} from untrusted compositions`, async () => {
        await assert.rejects(() => loader.registerPortableEffect(payload))
        assert.equal(loader.getLoadedPortableEffects().has(payload.func && `user/${payload.func}`), false)
    })
}

test('a duplicate registration from outside the loader is rejected', async () => {
    const external = new CanvasRenderer()
    external._enums = {}
    external._loadedEffects = new Map()
    await external.registerPortableEffect({ ...loader.portableDefinition(data), func: 'externalDup', shaders: data.shaders })
    await assert.rejects(() => loader.registerPortableEffect({ ...data, func: 'externalDup' }))
})

test('re-importing a loaded portable effect replaces it through the shared contract', async () => {
    const first = await loader.registerPortableEffect({ ...data, func: 'reImported', shaders: { main: { glsl: 'first', wgsl: 'first' } } })
    const second = await loader.registerPortableEffect({ ...data, func: 'reImported', shaders: { main: { glsl: 'second', wgsl: 'second' } } })
    assert.notEqual(second.instance, first.instance)
    assert.equal(second.instance.shaders.main.glsl, 'second')
    assert.equal(loader.getLoadedPortableEffects().get('user/reImported').shaders.main.glsl, 'second')
    // The contract's rule: portable effects belong to user.*; the bare name
    // resolves to nothing when no built-in held it, before or after re-import.
    assert.equal(runtimeEffects.get('reImported'), undefined)
    assert.equal(runtimeEffects.get('user.reImported').instance, second.instance)
})

test('a built-in under the same bare name survives import and re-import', async () => {
    const builtin = new Effect({ name: 'collide', asyncInit() {} })
    runtimeEffects.set('collide', builtin)
    const first = await loader.registerPortableEffect({ ...data, func: 'collide', shaders: { main: { glsl: 'first', wgsl: 'first' } } })
    assert.equal(runtimeEffects.get('collide'), builtin,
        'the initial import must not remove the built-in bare alias')
    assert.equal(runtimeEffects.get('user.collide').instance, first.instance)
    const second = await loader.registerPortableEffect({ ...data, func: 'collide', shaders: { main: { glsl: 'second', wgsl: 'second' } } })
    assert.equal(runtimeEffects.get('collide'), builtin,
        're-importing must not remove the built-in bare alias')
    assert.equal(runtimeEffects.get('user.collide').instance, second.instance)
    assert.notEqual(second.instance, first.instance)
})

test('a failed replacement preserves the prior registered effect and its retention', async () => {
    const first = await loader.registerPortableEffect({ ...data, func: 'keptEffect', shaders: { main: { glsl: 'kept', wgsl: 'kept' } } })
    const retainedBefore = loader.getLoadedPortableEffects().get('user/keptEffect')
    await assert.rejects(() => loader.registerPortableEffect({
        ...data, func: 'keptEffect', shaders: { main: { glsl: '  ' } }
    }))
    assert.equal(runtimeEffects.get('user.keptEffect').instance, first.instance,
        'the working runtime effect must survive a rejected re-import')
    assert.deepEqual(loader.getLoadedPortableEffects().get('user/keptEffect'), retainedBefore)
})

test('a retry failure after unregistration invalidates the retained entry', async () => {
    await loader.registerPortableEffect({ ...data, func: 'retryFail', shaders: { main: { glsl: 'kept', wgsl: 'kept' } } })
    const original = CanvasRenderer.prototype.registerPortableEffect
    let calls = 0
    CanvasRenderer.prototype.registerPortableEffect = function () {
        // First call: the shared contract rejects a now-duplicate name after
        // validation; retry call: an injected post-validation failure.
        if (++calls === 1) throw new Error('Portable effect: user.retryFail is already registered')
        throw new Error('Portable effect: injected post-validation retry failure')
    }
    try {
        await assert.rejects(() => loader.registerPortableEffect({
            ...data, func: 'retryFail', shaders: { main: { glsl: 'new', wgsl: 'new' } }
        }), /injected post-validation retry failure/)
        assert.equal(calls, 2, 'the loader must retry after dropping the prior registration')
        assert.equal(runtimeEffects.has('user.retryFail'), false,
            'the prior runtime registration is gone once unregistered')
        assert.equal(loader.getLoadedPortableEffects().has('user/retryFail'), false,
            'no retained entry may survive for an effect that no longer resolves')
    } finally {
        CanvasRenderer.prototype.registerPortableEffect = original
    }
})

test('loadFromCode skips an effect that fails validation and keeps the program', async t => {
    const previous = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
        code: 'abc123', dsl: 'volume().write(o0)',
        effects: [{ ...data, func: 'codeVolume' }, { ...data, func: 'broken', shaders: {} }]
    }) })
    t.after(() => { globalThis.fetch = previous })
    const composition = await loader.loadFromCode('abc123')
    assert.equal(composition.effects.length, 1)
    assert.equal(composition.dsl, 'volume().write(o0)')
})
