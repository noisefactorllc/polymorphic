/**
 * PolymorphicAgent command handlers. Each handler receives (args, app) and
 * returns { result, image?, warnings? }; the dispatcher builds the envelope.
 * `app` is the set of app references and actions that embed.js passes to
 * bootstrapAgent().
 *
 * Handlers reuse the paths the editor, the menus and the command palette
 * use, so history, saved programs, the online session and the page URL
 * behave the same way for an agent as for a person.
 *
 * @module agent/commands
 */

import { commandError } from './dispatcher.js'
import { buildSnapshot } from './snapshot.js'
import { readableCanvas, waitForReadback } from './capture.js'
import { SURFACES } from './schemas.js'
import { compile as compileDsl, extractEffectNamesFromDsl, getEffect } from '../noisemaker/bundle.js'
import { stripMediaUrlArg } from '../noisemaker/dslSanitize.js'
import { formatDsl } from '../ui/formatter.js'
import { loadExamples, prepareExample, requiresWebGL2 } from '../ui/gallery.js'
import { extractShortCode } from '../ui/import-from-url-dialog.js'
import { effectiveRenderTarget, surfacesWrittenInDsl, switchOutputSurface } from '../ui/outputPicker.js'
import { scenes } from '../ui/scenes.js'
import { tempoController } from '../ui/tempo.js'
import { recorder } from '../ui/recorder.js'
import { programs } from '../programs.js'
import { programImagesMigrated } from '../programImages.js'
import { loadFromCode } from '../sharingLoader.js'

function innerOf(app) {
    const inner = app.renderer?.inner
    if (!inner) throw commandError('INTERNAL_ERROR', 'The renderer did not start, so this command cannot run.')
    return inner
}

export async function getState(_args, app) {
    return { result: buildSnapshot(app) }
}

/**
 * The program that a command works on. Through a Seance session that is the
 * text the session holds: text that stayed in the editor stays private.
 */
function currentProgram(app, { remote } = {}) {
    if (!remote) return app.getDsl()
    const text = app.sessionText()
    if (typeof text !== 'string') {
        throw commandError('REMOTE_UNAVAILABLE', 'The program in this session is not available yet. Try again.')
    }
    return text
}

export async function getProgram(_args, app, call = {}) {
    const dsl = currentProgram(app, call)
    return { result: { dsl, running: call.remote ? app.runs(dsl) : app.isRunning() } }
}

// The engine's media() has no `url` argument: the app reads `url` (an
// `image:<sha256>` id, `live` or a link) itself and binds the image as a
// texture. Diagnosis leaves it out the same way the renderer does.
async function loadProgramEffects(dsl, app) {
    const inner = innerOf(app)
    let found
    try {
        found = extractEffectNamesFromDsl(stripMediaUrlArg(dsl), inner.manifest || {}) || []
    } catch {
        return // diagnose() reports the syntax error
    }
    const ids = [...new Set(found.map(e => e.effectId))]
        .filter(id => inner.manifest?.[id] && !inner.loadedEffects.has(id))
    if (!ids.length) return
    let failed
    try {
        failed = (await inner.loadEffects(ids)).failed || []
    } catch {
        failed = ids.map(effectId => ({ effectId }))
    }
    if (failed.length) {
        const effectIds = failed.map(f => f.effectId)
        throw commandError('EFFECT_LOAD_FAILED', `Could not load effects: ${effectIds.join(', ')}`, { effectIds })
    }
}

function diagnose(dsl) {
    try {
        const compiled = compileDsl(stripMediaUrlArg(dsl))
        return (compiled?.diagnostics || []).map(d => ({
            code: d.code,
            severity: d.severity,
            message: d.message,
            ...(d.location ? { location: d.location } : {}),
        }))
    } catch (err) {
        // The parser throws on syntax errors: "Expected ... at line N col M".
        const at = /line (\d+) col (\d+)/.exec(err?.message || '')
        return [{
            code: 'SYNTAX',
            severity: 'error',
            message: err?.message || String(err),
            ...(at ? { location: { line: Number(at[1]), column: Number(at[2]) } } : {}),
        }]
    }
}

const isError = d => d.severity === 'error'
const IMAGE_REF = /image:([a-f0-9]{64})/g

/**
 * Check a program, then run it in the editor. A program with an error
 * diagnostic changes nothing. When the renderer rejects it, the previous
 * program and images come back.
 *
 * Through a Seance session, every image the program names must already be in
 * the session. An image kept only in this browser would otherwise be resolved
 * here and then shared with everyone in the session.
 *
 * @param {string} dsl
 * @param {string} source - Why the program changed, for the online session
 * @param {object} app
 * @param {{images?: Array<object>, remote?: boolean, stage?: () => Promise<void>}} [options] - The
 *   images the program comes with, whether the command came through a session,
 *   and a step that puts the program in the editor before it runs (a gallery
 *   example takes the gallery's own path)
 * @returns {Promise<Array<object>>} The program's warnings
 */
async function applyProgram(dsl, source, app, { images, remote = false, stage } = {}) {
    await loadProgramEffects(dsl, app)
    const diagnostics = diagnose(dsl)
    if (diagnostics.some(isError)) {
        throw commandError('INVALID_PROGRAM', 'The program does not compile. Nothing changed.', { diagnostics })
    }
    if (remote) {
        for (const id of new Set([...dsl.matchAll(IMAGE_REF)].map(match => match[1]))) {
            if (!await app.sessionHasImage(id)) {
                throw commandError('NOT_FOUND_IMAGE',
                    `The session has no image ${id}. Add it with image-put, then name it as image:<sha256>. Nothing changed.`, { id })
            }
        }
    }
    const renderer = app.renderer
    const previous = currentProgram(app, { remote })
    const previousImages = renderer.images
    const previousOriginal = app.getOriginal()
    if (images) renderer.images = images
    if (stage) await stage()
    const outcome = await app.runProgram(dsl, source)
    if (outcome.success) {
        // While the animation plays, return once the new program has drawn a
        // frame, so a pause or an image right after shows it.
        if (app.isPlaying()) await waitForReadback(innerOf(app))
        return diagnostics
    }
    if (images) renderer.images = previousImages
    if (stage) app.setOriginal(previousOriginal)
    if (outcome.superseded) {
        throw commandError('CONFLICT_PROGRAM_CHANGED',
            'The program changed while this command ran, so it did not apply. Read it with getProgram and try again.')
    }
    if (previous.trim()) await app.runProgram(previous, 'agent-restore')
    throw commandError('COMPILE_FAILED',
        `The renderer rejected the program. The previous program runs again. ${outcome.error || ''}`.trim())
}

export async function validateProgram({ dsl }, app) {
    await loadProgramEffects(dsl, app)
    const diagnostics = diagnose(dsl)
    return { result: { valid: !diagnostics.some(isError), diagnostics } }
}

export async function setProgram({ dsl }, app, { remote } = {}) {
    const diagnostics = await applyProgram(dsl, 'agent', app, { remote })
    return { result: { applied: true, diagnostics } }
}

export async function formatProgram(_args, app, { remote } = {}) {
    const before = currentProgram(app, { remote })
    const after = formatDsl(before)
    if (after === before) return { result: { changed: false } }
    await applyProgram(after, 'format', app, { remote })
    return { result: { changed: true } }
}

export async function resetProgram(_args, app) {
    const diagnostics = await applyProgram(app.getOriginal(), 'reset', app)
    return { result: { applied: true, diagnostics } }
}

export async function stepHistory({ direction }, app) {
    const step = app.stepHistory(direction)
    if (!step) return { result: { applied: false } }
    const outcome = await step
    if (outcome.superseded) {
        throw commandError('CONFLICT_PROGRAM_CHANGED',
            'The program changed while this command ran. Read it with getProgram and try again.')
    }
    if (!outcome.success) {
        throw commandError('COMPILE_FAILED',
            `The renderer rejected the program from history. It is in the editor. ${outcome.error || ''}`.trim())
    }
    return { result: { applied: true } }
}

export async function listExamples() {
    const examples = (await loadExamples()).map(({ id, title, tagline, tags }) =>
        ({ id, title, tagline: tagline || '', tags: tags || [] }))
    return { result: { total: examples.length, examples } }
}

// Like switchBackend, answer before the page reloads.
const RELOAD_DELAY_MS = 300

/**
 * Run a gallery example the way the gallery does (embed.js
 * loadGalleryExample): its custom effects register, its images join the
 * renderer, the page URL names it, and the example becomes the program that
 * resetProgram restores. An example that needs WebGL2 reloads a WebGPU tab
 * into WebGL2 with the example selected.
 */
export async function loadExample({ id, title }, app, { remote } = {}) {
    const random = id === undefined && title === undefined
    const examples = await loadExamples()
    const wanted = title?.trim().toLowerCase()
    // A random pick is the gallery's "Shuffle": any example, equally likely.
    const found = random
        ? examples[Math.floor(Math.random() * examples.length)]
        : examples.find(e => (id === undefined || e.id === id) && (wanted === undefined || e.title?.toLowerCase() === wanted))
    if (!found?.dsl) {
        throw commandError('NOT_FOUND_EXAMPLE', random ? 'The gallery has no examples.'
            : `No gallery example has ${[id !== undefined && `id ${id}`, title !== undefined && `title ${title}`].filter(Boolean).join(' and ')}.`,
        { id, title })
    }
    const reason = random ? 'shuffle' : 'gallery'
    const named = { id: found.id, title: found.title }
    const reload = app.renderer?.backend === 'webgpu' && requiresWebGL2(found)
    if (reload && remote) {
        throw commandError('REMOTE_UNAVAILABLE',
            'This example needs the WebGL2 renderer, and switching renderers reloads the person\'s page. Ask the person to load it from the gallery.',
            named)
    }
    // The example's own effects register before its program is checked.
    const example = await prepareExample(found)
    if (reload) {
        setTimeout(() => app.loadGalleryExample(example, reason), RELOAD_DELAY_MS)
        return { result: { ...named, applied: false, reloading: true } }
    }
    const diagnostics = await applyProgram(example.dsl, reason, app,
        { remote, stage: () => app.loadGalleryExample(example, reason) })
    return { result: { ...named, applied: true, reloading: false, diagnostics } }
}

export async function importComposition({ link }, app) {
    const code = extractShortCode(link)
    if (!code) {
        throw commandError('IMPORT_FAILED',
            'That is not a sharing link or code. A link looks like https://sharing.noisedeck.app/s/CODE.', { link })
    }
    let composition
    try {
        composition = await loadFromCode(code)
    } catch (err) {
        throw commandError('IMPORT_FAILED', `Could not load the composition: ${err?.message || err}`, { code })
    }
    if (!composition.dsl) throw commandError('IMPORT_FAILED', 'The composition has no program.', { code })
    const diagnostics = await applyProgram(composition.dsl, 'import-url', app, { images: composition.images || [] })
    return {
        result: {
            title: composition.title || '',
            effects: (composition.effects || []).map(effect => effect.id),
            images: (composition.images || []).length,
            applied: true,
            diagnostics,
        },
    }
}

export async function listPrograms() {
    const list = programs.getNames().map(name => {
        const program = programs.get(name)
        return { name, savedAt: program?.savedAt ?? null, chars: typeof program?.dsl === 'string' ? program.dsl.length : 0 }
    })
    return { result: { total: list.length, programs: list } }
}

/** Store the images a program names, then resolve with the program to save. */
async function storedProgram(dsl, app) {
    let stored
    try {
        // Images first: a saved program must never name an image that is not stored.
        stored = await app.storeImages(dsl)
    } catch (err) {
        throw commandError('STORAGE_FAILED', `Could not store the program's images: ${err?.message || err}`)
    }
    // On a full localStorage there is room only once older entries' images
    // have moved out, which starts at page load.
    await programImagesMigrated()
    return stored
}

function storageFailure(res, what) {
    return commandError('STORAGE_FAILED', res?.quotaExceeded
        ? `Browser storage is full, so ${what} was not saved. Delete saved programs to make room.`
        : `Browser storage refused ${what}.`, { quotaExceeded: Boolean(res?.quotaExceeded) })
}

export async function saveProgram({ name, overwrite = false }, app) {
    const key = name.trim()
    if (!key) throw commandError('INVALID_ARGS_RANGE', 'name: is blank', { field: 'name' })
    if (programs.has(key) && !overwrite) {
        throw commandError('CONFLICT_PROGRAM_EXISTS',
            `A program named ${key} is saved already. Pass overwrite: true to replace it.`, { name: key })
    }
    const res = programs.saveProgram(key, await storedProgram(app.getDsl(), app))
    if (res && res.success === false) throw storageFailure(res, 'the program')
    return { result: { saved: true, name: key } }
}

function savedProgram(name) {
    const program = programs.get(name) || programs.get(name.trim())
    if (!program) throw commandError('NOT_FOUND_PROGRAM', `No saved program is named ${name}.`, { name })
    return program
}

export async function loadProgram({ name }, app) {
    const program = savedProgram(name)
    const diagnostics = await applyProgram(program.dsl, 'program-load', app, { images: program.images || [] })
    return { result: { name: program.name, applied: true, diagnostics } }
}

export async function deleteProgram({ name }) {
    const program = savedProgram(name)
    if (!programs.deleteProgram(program.name)) {
        throw commandError('STORAGE_FAILED', 'Browser storage refused the change. The program is still saved.')
    }
    return { result: { deleted: true, name: program.name } }
}

export async function listScenes() {
    const list = scenes.list()
        .filter(scene => scene.dsl)
        .map(scene => ({ slot: scene.slot, chars: scene.dsl.length }))
        .sort((a, b) => a.slot - b.slot)
    return { result: { scenes: list } }
}

export async function saveScene({ slot }, app) {
    const dsl = app.getDsl()
    if (!dsl.trim()) throw commandError('INVALID_PROGRAM', 'The editor is empty. Nothing was saved.', { diagnostics: [] })
    const res = scenes.save(slot, await storedProgram(dsl, app))
    if (res && res.success === false) throw storageFailure(res, `scene ${slot}`)
    return { result: { saved: true, slot } }
}

export async function loadScene({ slot }, app) {
    const dsl = scenes.load(slot)
    if (!dsl) throw commandError('NOT_FOUND_SCENE', `Scene ${slot} is empty.`, { slot })
    const diagnostics = await applyProgram(dsl, 'scene-load', app, { images: scenes.images(slot) })
    return { result: { slot, applied: true, diagnostics } }
}

function effectEntries(inner) {
    const manifest = inner.manifest || {}
    const describe = (effectId, description, tags) => {
        const [namespace, name] = effectId.split('/')
        return { effectId, namespace, name, description: description || '', tags: tags || [] }
    }
    const entries = Object.entries(manifest).map(([effectId, entry]) => describe(effectId, entry.description, entry.tags))
    // Custom effects, from a sharing link or a ZIP, are registered as user/<name>.
    for (const [effectId, effect] of inner.loadedEffects || []) {
        if (!manifest[effectId]) entries.push(describe(effectId, effect.instance?.description, effect.instance?.tags))
    }
    return entries
}

// Custom effects are the person's own work. Everyone in a Seance session
// receives every answer, so a session sees only the built-in effects.
const isCustomEffect = effectId => effectId.startsWith('user/')

export async function searchEffects({ query = '', namespace, limit = 50 }, app, { remote } = {}) {
    const q = query.toLowerCase()
    const matches = effectEntries(innerOf(app))
        .filter(e => !(remote && isCustomEffect(e.effectId)))
        .filter(e => (!namespace || e.namespace === namespace)
            && (!q || `${e.effectId} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q)))
    return { result: { total: matches.length, effects: matches.slice(0, limit) } }
}

function enumChoices(spec, enums) {
    if (spec.choices) return { choices: spec.choices }
    const path = spec.enum || spec.enumPath
        || (spec.type === 'member' && typeof spec.default === 'string'
            ? spec.default.split('.').slice(0, -1).join('.') : '')
    if (!path) return {}
    const node = path.split('.').reduce((value, key) => value?.[key], enums)
    if (!node || typeof node !== 'object') return {}
    return { enum: path, choices: Object.fromEntries(Object.entries(node).map(([key, value]) =>
        [key, spec.type === 'member' ? `${path}.${key}` : value?.value ?? value])) }
}

export async function getEffectDefinition({ effectId }, app, { remote } = {}) {
    if (remote && isCustomEffect(effectId)) {
        throw commandError('REMOTE_UNAVAILABLE',
            'Custom effects are not available through a session. Ask the person to share the effect with you.', { effectId })
    }
    const inner = innerOf(app)
    if (!inner.manifest?.[effectId] && !inner.loadedEffects?.has(effectId)) {
        throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    }
    if (!inner.loadedEffects.has(effectId)) {
        let failed
        try {
            failed = (await inner.loadEffects([effectId])).failed || []
        } catch {
            failed = [{ effectId }]
        }
        if (failed.length) throw commandError('EFFECT_LOAD_FAILED', `Could not load ${effectId}`, { effectId })
    }
    const [namespace, name] = effectId.split('/')
    const def = getEffect(`${namespace}.${name}`) || getEffect(effectId) || inner.loadedEffects.get(effectId)?.instance
    if (!def) throw commandError('NOT_FOUND_EFFECT', `Unknown effect: ${effectId}`, { effectId })
    const params = Object.entries(def.globals || {})
        .filter(([, spec]) => spec && !spec.internal && !spec.ui?.hidden)
        .map(([param, spec]) => ({
            name: param,
            type: spec.type,
            default: spec.default ?? null,
            ...(spec.min !== undefined ? { min: spec.min } : {}),
            ...(spec.max !== undefined ? { max: spec.max } : {}),
            ...enumChoices(spec, inner.enums),
            ...(spec.ui?.label ? { label: spec.ui.label } : {}),
        }))
    return {
        result: {
            effectId,
            func: def.func || name,
            namespace,
            description: def.description || inner.manifest?.[effectId]?.description || '',
            params,
        },
    }
}

export async function setOutput({ surface }, app, { remote } = {}) {
    const dsl = currentProgram(app, { remote })
    let index = SURFACES.indexOf(surface)
    if (index < 0) {
        // next / previous move through the surfaces the program writes,
        // like the "Cycle output surface" action.
        const written = surfacesWrittenInDsl(dsl)
        if (!written.length) return { result: { surface: null, changed: false } }
        const at = written.indexOf(effectiveRenderTarget(dsl))
        const step = surface === 'next' ? 1 : -1
        index = at >= 0 ? written[(at + step + written.length) % written.length] : written[step > 0 ? 0 : written.length - 1]
    }
    const next = switchOutputSurface(dsl, index)
    if (next === dsl) return { result: { surface: SURFACES[index], changed: false } }
    await applyProgram(next, 'output-picker', app, { remote })
    return { result: { surface: SURFACES[index], changed: true } }
}

export async function clearSurfaces(_args, app) {
    const outcome = await app.hushSurfaces()
    if (outcome?.superseded) {
        throw commandError('CONFLICT_PROGRAM_CHANGED',
            'The program changed while this command ran. Read it with getProgram and try again.')
    }
    if (!outcome?.success) {
        throw commandError('COMPILE_FAILED', `The program did not compile again. ${outcome?.error || ''}`.trim())
    }
    return { result: { cleared: true } }
}

export async function play(_args, app) {
    return { result: { playing: app.setPlaying(true) } }
}

export async function pause(_args, app) {
    return { result: { playing: app.setPlaying(false) } }
}

export async function setTempo({ bpm, divider }, app) {
    const bar = app.tempoBar
    if (!bar) throw commandError('INTERNAL_ERROR', 'The tempo bar did not start, so the tempo cannot change.')
    if (bpm !== undefined) {
        if (tempoController.getSource() === 'midi') {
            throw commandError('CONFLICT_TEMPO_SOURCE',
                'The tempo follows MIDI clock. Ask the person to switch the tempo source to manual, or set divider only.')
        }
        bar.bpm = bpm
    }
    if (divider !== undefined) bar.divider = divider
    return {
        result: {
            bpm: tempoController.getBpm(),
            divider: tempoController.getDivider(),
            source: tempoController.getSource(),
            loopSeconds: tempoController.barSeconds(),
        },
    }
}

export async function setView({ panel, visible }, app) {
    app.setView(panel, visible)
    return { result: { panel, visible: app.getView()[panel] } }
}

export async function setBackend({ backend }, app) {
    if (app.renderer?.backend === backend) return { result: { backend, reloading: false } }
    app.switchBackend(backend)
    return { result: { backend, reloading: true } }
}

// The image is the frame on screen. Nothing renders for it, so a paused
// program, feedback included, stays exactly where it was.
export async function getThumbnail({ maxDimension = 256, format = 'jpg' }, app) {
    const inner = innerOf(app)
    const live = await readableCanvas(app.canvas, inner)
    const scale = Math.min(1, maxDimension / Math.max(live.width, live.height, 1))
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(live.width * scale))
    out.height = Math.max(1, Math.round(live.height * scale))
    out.getContext('2d').drawImage(live, 0, 0, out.width, out.height)
    live.close?.()
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
    const image = await new Promise((resolve, reject) => {
        out.toBlob(blob => blob ? resolve(blob) : reject(new Error('The canvas could not be encoded')), mimeType, 0.85)
    })
    return { result: { mimeType, width: out.width, height: out.height }, image }
}

export async function exportImage({ format = 'png' }, app) {
    const { width, height } = app.saveCanvasImage(format)
    return { result: { started: true, format, width, height } }
}

export async function setRecording({ recording, quality }) {
    if (quality) recorder.setQualityPreset(quality)
    if (recording && !recorder.isRecording() && !recorder.start()) {
        throw commandError('BROWSER_REFUSED', 'The browser could not start a recording of the canvas.')
    }
    if (!recording && recorder.isRecording()) recorder.stop()
    return { result: { recording: recorder.isRecording(), quality: recorder.qualityName } }
}

export async function setFullscreen({ fullscreen }) {
    try {
        if (fullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen()
        if (!fullscreen && document.fullscreenElement) await document.exitFullscreen()
    } catch (err) {
        throw commandError('BROWSER_REFUSED', `The browser refused fullscreen: ${err?.message || err}`)
    }
    return { result: { fullscreen: Boolean(document.fullscreenElement) } }
}

export async function useLiveInput({ source }, app) {
    app.useLiveInput(source)
    return { result: { requested: true, source } }
}
