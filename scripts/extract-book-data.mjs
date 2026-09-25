#!/usr/bin/env node
/**
 * Extract the Book of Polymorphic DSL's effect data from the shipped engine.
 *
 * The book demonstrates one default program per effect. Those programs are not
 * a hand-maintained list: the engine derives them. 53 effects carry an explicit
 * `defaultProgram` string on their definition; the rest are derived from the
 * effect's shape (starter / tex param / vol+geo / points / 3D) by the same
 * routine Noisedeck uses in its effect browser. This script runs that routine
 * against the real CDN bundles, so a page can never demonstrate a program the
 * engine would not itself hand you.
 *
 * Run it after a Noisemaker release; commit the diff. Everything downstream
 * (scripts/build-book.mjs) reads the committed JSON and needs no network.
 *
 *   node scripts/extract-book-data.mjs
 *   node scripts/extract-book-data.mjs --cdn https://shaders.noisedeck.app/1
 *
 * Node's ESM loader will not import over https, so bundles are downloaded to a
 * cache dir first and imported from disk.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const OUT = join(REPO, 'book', 'data', 'effects.json')
const CURATION = join(REPO, 'book', 'curation.json')

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const CDN = argOf('--cdn', 'https://shaders.noisedeck.app/1').replace(/\/+$/, '')
const CACHE = argOf('--cache', join(tmpdir(), 'polymorphic-book-engine'))

/**
 * Chapters of the book, in reading order. `classicNoisedeck` is deliberately
 * absent: it is the compatibility layer for the pre-DSL Noisedeck, not part of
 * the language this book teaches.
 */
const CHAPTERS = [
    {
        id: 'synth',
        title: 'Synth',
        subtitle: 'Generators',
        blurb: 'Effects that make an image out of nothing but coordinates and a seed. Every program in the book starts with one of these.',
    },
    {
        id: 'filter',
        title: 'Filter',
        subtitle: 'Processors',
        blurb: 'One image in, one image out. The largest chapter, ranging from a single multiply to multi-pass optical simulation.',
    },
    {
        id: 'mixer',
        title: 'Mixer',
        subtitle: 'Two Sources',
        blurb: 'Effects that read a second surface alongside the pipeline, and decide how the two meet.',
    },
    {
        id: 'points',
        title: 'Points',
        subtitle: 'Agents and Particles',
        blurb: 'State held in a texture and stepped every frame. Flocks, slime moulds, fluid, and life.',
    },
    {
        id: 'render',
        title: 'Render',
        subtitle: 'Pipeline Machinery',
        blurb: 'The stages that move data between the pipeline’s domains: particles to pixels, volumes to images, loops back on themselves.',
    },
    {
        id: 'synth3d',
        title: 'Synth 3D',
        subtitle: 'Volumes',
        blurb: 'Generators that fill a 3D texture rather than a 2D one, then hand it to a renderer to be flattened.',
    },
    {
        id: 'filter3d',
        title: 'Filter 3D',
        subtitle: 'Volume Processors',
        blurb: 'Two effects that read a volume and write a volume, before anything is projected to the screen.',
    },
]

const CHAPTER_IDS = new Set(CHAPTERS.map(c => c.id))

async function exists(path) {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

/**
 * Download `url` into the cache and return the local path. Cached files are
 * immutable per CDN release; delete the cache dir to force a refetch.
 */
async function cached(url, relPath) {
    const dest = join(CACHE, relPath)
    if (await exists(dest)) return dest
    const res = await fetch(url)
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    return dest
}

/**
 * The core bundle is browser code. It defines a couple of custom elements at
 * module scope, so it needs these three globals to finish evaluating. Nothing
 * we call touches the DOM afterwards.
 */
function installDomShims() {
    if (!globalThis.HTMLElement) globalThis.HTMLElement = class {}
    if (!globalThis.customElements) {
        globalThis.customElements = { define() {}, get() { return undefined } }
    }
    if (!globalThis.document) {
        globalThis.document = {
            createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
            head: { appendChild() {} },
            addEventListener() {},
        }
    }
    if (!globalThis.window) globalThis.window = globalThis
}

/* ------------------------------------------------------------------ *
 * Program resolution.
 *
 * Ported from noisedeck/app/js/ui/dslSourceBuilder.js. Kept structurally
 * identical to its source so the two can be diffed by eye when the engine
 * changes; do not "tidy" the branches.
 * ------------------------------------------------------------------ */

function ensureRenderDirective(dsl) {
    if (!dsl || typeof dsl !== 'string') return 'render(o0)'
    const trimmed = dsl.trim()
    if (/\brender\s*\(/.test(trimmed)) return dsl
    const writeMatches = [...trimmed.matchAll(/\.(?:write|out)\s*\(\s*(o\d+)\s*\)/g)]
    let renderSurface = 'o0'
    if (writeMatches.length > 0) renderSurface = writeMatches[writeMatches.length - 1][1]
    return `${trimmed}\nrender(${renderSurface})`
}

function buildKwargs(globals, paramValues, fmt) {
    const kwargs = {}
    if (!globals) return kwargs
    for (const [key, spec] of Object.entries(globals)) {
        const value = paramValues[key]
        if (value === undefined || value === null) continue
        if (key === '_skip' && value === false) continue
        if (spec.default !== undefined) {
            if (fmt(value, spec) === fmt(spec.default, spec)) continue
        }
        kwargs[key] = value
    }
    return kwargs
}

function makeBuildDslSource(engine) {
    const {
        unparseCall, isStarterEffect, hasTexSurfaceParam, hasExplicitTexParam,
        getVolGeoParams, is3dGenerator, is3dProcessor, formatValue, stdEnums,
    } = engine

    const fmt = (value, spec) => formatValue(value, spec, { enums: stdEnums })
    const fmtCall = (name, kwargs) => unparseCall({ name, kwargs, args: [] })

    return function buildDslSource(effect, parameterValues) {
        if (!effect || !effect.instance) return ''

        if (effect.instance.defaultProgram) {
            return ensureRenderDirective(effect.instance.defaultProgram)
        }

        let searchNs = effect.namespace
        if (effect.namespace === 'render') {
            searchNs = 'synth, filter, render'
        } else if (effect.namespace === 'points') {
            searchNs = 'synth, points, render'
        } else if (['filter', 'mixer'].includes(effect.namespace)) {
            searchNs = `${effect.namespace}, synth`
        }
        const searchDirective = searchNs ? `search ${searchNs}\n\n` : ''
        const funcName = effect.instance.func

        const starter = isStarterEffect(effect)
        const hasTex = hasTexSurfaceParam(effect)
        const hasExplicitTex = hasExplicitTexParam(effect)
        const { volParam, geoParam } = getVolGeoParams(effect)
        const hasVolGeo = volParam && geoParam

        const bkw = (globals) => buildKwargs(globals, parameterValues, fmt)

        if (funcName === 'pointsEmit' || funcName === 'pointsRender') {
            return ensureRenderDirective('search points, synth, render\n\nnoise()\n  .pointsEmit()\n  .physical()\n  .pointsRender()\n  .write(o0)\n\nrender(o0)')
        }

        if (funcName === 'pointsBillboardRender') {
            return ensureRenderDirective(`search points, synth, render

polygon(
  radius: 0.7,
  fgAlpha: 0.1,
  bgAlpha: 0
)
  .write(o0)

noise(ridges: true)
  .pointsEmit(stateSize: x64)
  .physical()
  .pointsBillboardRender(
    tex: read(o0),
    pointSize: 40,
    sizeVariation: 50,
    rotationVar: 50
  )
  .write(o1)

render(o1)`)
        }

        if (funcName === 'meshLoader' || funcName === 'meshRender') {
            return ensureRenderDirective('search synth, render\n\nmeshLoader()\n  .meshRender()\n  .write(o0)\n\nrender(o0)')
        }

        if (effect.namespace === 'points') {
            const kwargs = bkw(effect.instance.globals)
            const effectCall = fmtCall(funcName, kwargs)
            const viewModeDef = effect.instance.globals?.viewMode
            const viewModeChoice = viewModeDef?.choices?.[viewModeDef.default] ??
                (viewModeDef?.default === 1 ? 'ortho' : viewModeDef?.default)
            const pointsRenderArgs = viewModeChoice ? `viewMode: ${viewModeChoice}` : ''
            const pointsRenderCall = pointsRenderArgs ? `pointsRender(${pointsRenderArgs})` : 'pointsRender()'
            return ensureRenderDirective(`search points, synth, render\n\nnoise()\n  .pointsEmit()\n  .${effectCall}\n  .${pointsRenderCall}\n  .write(o0)\n\nrender(o0)`)
        }

        if (funcName === 'loopBegin' || funcName === 'loopEnd') {
            return ensureRenderDirective(`${searchDirective}noise(ridges: true)\n  .loopBegin(alpha: 95, intensity: 95)\n  .warp()\n  .loopEnd()\n  .write(o0)\n\nrender(o0)`)
        }

        const noiseCall = fmtCall('noise', { seed: 1, ridges: true })

        // Kwargs for the 3D branches: same filter as buildKwargs, but vol/geo
        // params are skipped (they get Read3D refs) and volumeSize is captured
        // to size the upstream generator.
        const volGeoKwargs = () => {
            let consumerVolumeSize = 32
            const kwargs = {}
            if (effect.instance.globals) {
                for (const [key, spec] of Object.entries(effect.instance.globals)) {
                    if (key === volParam || key === geoParam) continue
                    const value = parameterValues[key]
                    if (value === undefined || value === null) continue
                    if (key === 'volumeSize') consumerVolumeSize = value
                    if (key === '_skip' && value === false) continue
                    if (spec.default !== undefined) {
                        if (fmt(value, spec) === fmt(spec.default, spec)) continue
                    }
                    kwargs[key] = value
                }
            }
            return { kwargs, consumerVolumeSize }
        }

        const read3d = (kwargs) => {
            kwargs[volParam] = { type: 'Read3D', tex3d: { type: 'VolRef', name: 'vol0' }, geo: null }
            kwargs[geoParam] = { type: 'Read3D', tex3d: { type: 'GeoRef', name: 'geo0' }, geo: null }
            return kwargs
        }

        if (is3dGenerator(effect)) {
            const { kwargs, consumerVolumeSize } = volGeoKwargs()
            if (hasVolGeo) {
                const generatorCall = fmtCall('noise3d', { volumeSize: `x${consumerVolumeSize}` })
                const effectCall = fmtCall(funcName, read3d(kwargs))
                return ensureRenderDirective(`search synth3d, filter3d, render\n\n${generatorCall}\n  .write3d(vol0, geo0)\n\n${effectCall}\n  .render3d()\n  .write(o0)\n\nrender(o0)`)
            }
            const effectCall = fmtCall(funcName, kwargs)
            return ensureRenderDirective(`search synth3d, filter3d, render\n\n${effectCall}\n  .render3d()\n  .write(o0)\n\nrender(o0)`)
        }

        if (hasVolGeo) {
            const { kwargs, consumerVolumeSize } = volGeoKwargs()
            const generatorCall = fmtCall('noise3d', { volumeSize: `x${consumerVolumeSize}` })
            const effectCall = fmtCall(funcName, read3d(kwargs))
            return ensureRenderDirective(`search synth3d, filter3d, render\n\n${generatorCall}\n  .write3d(vol0, geo0)\n\n${effectCall}\n  .render3d()\n  .write(o0)\n\nrender(o0)`)
        }

        if (hasExplicitTex) {
            const kwargs = bkw(effect.instance.globals)
            kwargs.tex = { type: 'Read', surface: 'o0' }
            const effectCall = fmtCall(funcName, kwargs)
            if (starter) {
                return ensureRenderDirective(`${searchDirective}${noiseCall}\n  .write(o0)\n\n${effectCall}\n  .write(o1)\n\nrender(o1)`)
            }
            const noiseCall2 = fmtCall('noise', { seed: 2, ridges: true })
            return ensureRenderDirective(`${searchDirective}${noiseCall}\n  .write(o0)\n\n${noiseCall2}\n  .${effectCall}\n  .write(o1)\n\nrender(o1)`)
        }

        if (starter) {
            const kwargs = bkw(effect.instance.globals)
            if (hasTex) {
                const kwargsWithTex = { tex: { type: 'Read', surface: 'o0' }, ...kwargs }
                const effectCall = fmtCall(funcName, kwargsWithTex)
                return ensureRenderDirective(`${searchDirective}${noiseCall}\n  .write(o0)\n\n${effectCall}\n  .write(o1)\n\nrender(o1)`)
            }
            const effectCall = fmtCall(funcName, kwargs)
            return ensureRenderDirective(`${searchDirective}${effectCall}\n  .write(o0)\n\nrender(o0)`)
        }

        if (hasTex) {
            const kwargs = { tex: { type: 'Read', surface: 'o0' } }
            if (effect.instance.globals) {
                for (const [key, spec] of Object.entries(effect.instance.globals)) {
                    if (key === 'tex' && spec.type === 'surface') continue
                    const value = parameterValues[key]
                    if (value === undefined || value === null) continue
                    if (key === '_skip' && value === false) continue
                    if (spec.default !== undefined) {
                        if (fmt(value, spec) === fmt(spec.default, spec)) continue
                    }
                    kwargs[key] = value
                }
            }
            const effectCall = fmtCall(funcName, kwargs)
            const noiseCall2 = fmtCall('noise', { seed: 2, ridges: true })
            return ensureRenderDirective(`${searchDirective}${noiseCall}\n  .write(o0)\n\n${noiseCall2}\n  .${effectCall}\n  .write(o1)\n\nrender(o1)`)
        }

        if (is3dProcessor(effect)) {
            const { kwargs, consumerVolumeSize } = volGeoKwargs()
            const generatorCall = fmtCall('noise3d', { volumeSize: `x${consumerVolumeSize}` })
            const effectCall = fmtCall(funcName, kwargs)
            const renderSuffix = (funcName === 'render3d' || funcName === 'renderLit3d') ? '' : '\n  .render3d()'
            return ensureRenderDirective(`search synth3d, filter3d, render\n\n${generatorCall}\n  .${effectCall}${renderSuffix}\n  .write(o0)\n\nrender(o0)`)
        }

        const kwargs = bkw(effect.instance.globals)
        const effectCall = fmtCall(funcName, kwargs)
        return ensureRenderDirective(`${searchDirective}${noiseCall}\n  .${effectCall}\n  .write(o0)\n\nrender(o0)`)
    }
}

/* ------------------------------------------------------------------ */

/**
 * Resolve a bundle's default export to an Effect instance.
 *
 * Most bundles export a constructed `new Effect({...})`. Class-based
 * definitions export the class instead, with `shaders` and `help` hung off it
 * as statics. Mirrors CanvasRenderer.loadEffectFromBundle — without this, a
 * class-based effect reads as a bare function and yields a page titled after
 * the minifier's variable name.
 */
function toInstance(module) {
    const exported = module.default
    if (!exported) throw new Error('no default export')
    if (typeof exported !== 'function') return exported
    const instance = new exported()
    if (exported.shaders && !instance.shaders) instance.shaders = exported.shaders
    if (exported.help && !instance.help) instance.help = exported.help
    return instance
}

/** Effect parameter defaults, the values Noisedeck seeds its browser with. */
function defaultParameterValues(instance) {
    const values = {}
    for (const [key, spec] of Object.entries(instance.globals || {})) {
        if (spec?.default !== undefined) values[key] = spec.default
    }
    return values
}

/** Parameters worth listing on a page: label, type, default, range. */
function publicParams(instance) {
    const out = []
    for (const [key, spec] of Object.entries(instance.globals || {})) {
        if (key.startsWith('_')) continue
        out.push({
            name: key,
            label: spec?.ui?.label || key,
            type: spec?.type || 'float',
            control: spec?.ui?.control || null,
            default: spec?.default ?? null,
            min: spec?.min ?? null,
            max: spec?.max ?? null,
            choices: spec?.choices ? Object.keys(spec.choices) : null,
        })
    }
    return out
}

/** "chromaticAberration" -> "Chromatic Aberration", for a fallback title. */
function camelToTitle(str) {
    return String(str)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/(\d+)/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase())
}

async function main() {
    installDomShims()

    process.stdout.write(`engine: ${CDN}\ncache:  ${CACHE}\n\n`)

    const corePath = await cached(`${CDN}/noisemaker-shaders-core.esm.js`, 'core.esm.js')
    const engine = await import(pathToFileURL(corePath).href)
    const buildDslSource = makeBuildDslSource(engine)

    const manifestRes = await fetch(`${CDN}/effects/manifest.json`)
    if (!manifestRes.ok) throw new Error(`manifest -> ${manifestRes.status}`)
    const manifest = await manifestRes.json()

    const ids = Object.keys(manifest)
        .filter(id => CHAPTER_IDS.has(id.split('/')[0]))
        .sort()

    const curation = JSON.parse(await readFile(CURATION, 'utf8'))
    const excluded = curation.exclude ?? {}
    const overrides = curation.programs ?? {}
    const usedOverrides = new Set()

    const effects = []
    const skipped = []

    for (const id of ids) {
        const [namespace, name] = id.split('/')
        const path = await cached(`${CDN}/effects/${id}.js`, `effects/${id}.js`)
        const mod = await import(pathToFileURL(path).href)
        const instance = toInstance(mod)
        if (!instance.func) throw new Error(`${id}: instance has no func`)

        // `hidden` marks an effect the pickers do not offer: the three
        // superseded by `adjust`, plus `text` and `remap`, which are reached
        // through other surfaces. The book follows the pickers.
        if (instance.hidden) {
            skipped.push(`${id} (hidden${instance.deprecatedBy ? `, superseded by ${instance.deprecatedBy}` : ''})`)
            continue
        }

        // Editorial exclusions from book/curation.json: effects that cannot
        // show anything on a page nobody is standing in front of.
        if (excluded[id]) {
            skipped.push(`${id} (excluded: ${excluded[id]})`)
            continue
        }

        const effect = { namespace, instance }
        const derived = buildDslSource(effect, defaultParameterValues(instance))

        // A curated program replaces the derived one where the default shows
        // the effect doing nothing: a blur on a field with no hard edges in
        // it, a motion blur on a still frame, an overlay on a flat colour.
        const override = overrides[id]
        if (override) usedOverrides.add(id)
        const program = override?.program ?? derived

        effects.push({
            id,
            chapter: namespace,
            slug: name,
            func: instance.func || name,
            title: instance.name || camelToTitle(name),
            description: instance.description || manifest[id]?.description || '',
            tags: instance.tags || manifest[id]?.tags || [],
            starter: engine.isStarterEffect(effect),
            explicit: Boolean(instance.defaultProgram),
            curated: Boolean(override),
            curatedWhy: override?.why ?? null,
            program,
            params: publicParams(instance),
        })
    }

    const chapters = CHAPTERS.map(c => ({
        ...c,
        effects: effects.filter(e => e.chapter === c.id).map(e => e.slug),
    }))

    const previous = await readFile(OUT, 'utf8').catch(() => null)
    const payload = JSON.stringify({
        engine: CDN,
        generator: 'scripts/extract-book-data.mjs',
        chapters,
        effects,
    }, null, 2) + '\n'

    await mkdir(dirname(OUT), { recursive: true })
    await writeFile(OUT, payload)

    const staleOverrides = Object.keys(overrides).filter(id => !usedOverrides.has(id))
    if (staleOverrides.length) {
        throw new Error(`book/curation.json overrides an effect that was not extracted: ${staleOverrides.join(', ')}`)
    }
    const staleExcludes = Object.keys(excluded).filter(id => !skipped.some(s => s.startsWith(`${id} (excluded`)))
    if (staleExcludes.length) {
        throw new Error(`book/curation.json excludes an effect that no longer exists: ${staleExcludes.join(', ')}`)
    }

    const curated = effects.filter(e => e.curated).length
    const explicit = effects.filter(e => e.explicit).length
    process.stdout.write(`${effects.length} effects across ${chapters.length} chapters\n`)
    process.stdout.write(`  ${explicit} carry an explicit defaultProgram; ${effects.length - explicit} derived\n`)
    process.stdout.write(`  ${curated} curated in book/curation.json\n`)
    for (const c of chapters) {
        process.stdout.write(`  ${c.id.padEnd(9)} ${String(c.effects.length).padStart(3)}\n`)
    }
    if (skipped.length) {
        process.stdout.write(`\nskipped ${skipped.length}:\n`)
        for (const s of skipped) process.stdout.write(`  ${s}\n`)
    }
    process.stdout.write(`\n${previous === payload ? 'unchanged' : 'wrote'} ${OUT.replace(REPO + '/', '')}\n`)
}

main().catch(err => {
    process.stderr.write(`${err.stack || err}\n`)
    process.exit(1)
})
