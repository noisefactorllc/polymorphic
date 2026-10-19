/**
 * PolymorphicAgent: the in-page command surface that public/llms.txt
 * documents, its WebMCP tools and its opt-in ?agent=1 command form.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)
test.describe.configure({ timeout: 90000 })

// A deterministic sketch so boot does not pick a random gallery example.
const BASE = [
  'search synth, filter',
  '',
  'perlin(scale: 75, octaves: 2)',
  '  .adjust(',
  '    mode: hsv,',
  '    rotation: 120,',
  '    hueRange: 40',
  '  )',
  '  .write(o0)',
  '',
  'render(o0)',
].join('\n')
const RED = 'search synth\nsolid(color: [1, 0, 0]).write(o0)\nrender(o0)'
const BLUE = 'search synth\nsolid(color: [0, 0, 1]).write(o0)\nrender(o0)'
const TWO_SURFACES = 'search synth\nsolid(color: [1, 0, 0]).write(o0)\nsolid(color: [0, 0, 1]).write(o1)\nrender(o0)'
// Four colored corners show whether an image is flipped.
const CORNERS = 'search synth\ngradient(type: 2).write(o0)\nrender(o0)'

async function loadAgent(page, query = '') {
  await page.goto(`/?dsl=${encodeURIComponent(BASE)}${query}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  await page.evaluate(() => window.PolymorphicAgent.ready)
}

/** The center pixel of a PNG thumbnail, decoded in the page. */
async function thumbnailPixel(page) {
  return page.evaluate(async () => {
    const env = await window.PolymorphicAgent.getThumbnail({ maxDimension: 32, format: 'png' })
    const bytes = Uint8Array.from(atob(env.result.bytes), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return Array.from(ctx.getImageData(image.width >> 1, image.height >> 1, 1, 1).data)
  })
}

/** Corner pixels of the thumbnail and of the canvas's own PNG encoding, at one size. */
async function cornerPixels(page) {
  return page.evaluate(async (dsl) => {
    const A = window.PolymorphicAgent
    await A.setProgram({ dsl })
    await A.pause()
    const env = await A.getThumbnail({ maxDimension: 64, format: 'png' })
    const { width, height } = env.result
    const corners = async (blob) => {
      const image = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, width, height)
      const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
      return [at(4, 4), at(width - 5, 4), at(4, height - 5), at(width - 5, height - 5)]
    }
    const thumb = Uint8Array.from(atob(env.result.bytes), char => char.charCodeAt(0))
    const reference = await new Promise(resolve => document.getElementById('canvas').toBlob(resolve, 'image/png'))
    return {
      backend: env.state.backend,
      thumbnail: await corners(new Blob([thumb], { type: 'image/png' })),
      canvas: await corners(reference),
    }
  }, CORNERS)
}

function expectSameCorners({ thumbnail, canvas }) {
  for (let corner = 0; corner < 4; corner++) {
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(thumbnail[corner][channel] - canvas[corner][channel])).toBeLessThan(24)
    }
  }
  // The corners differ, so a flipped image would not match.
  expect(new Set(canvas.map(pixel => pixel.slice(0, 3).join())).size).toBeGreaterThan(1)
}

test('exposes exactly the described commands', async ({ page }) => {
  await loadAgent(page)
  const { live, described, version } = await page.evaluate(async () => {
    const agent = window.PolymorphicAgent
    const live = Object.keys(agent).filter(k => typeof agent[k] === 'function')
    const { COMMAND_GROUPS } = await import('/js/agent/descriptions.js')
    return { live, described: COMMAND_GROUPS.flatMap(g => Object.keys(g.commands)), version: agent.version }
  })
  expect([...live].sort()).toEqual([...described].sort())
  expect(version).toBe('1.0')
})

test('commands wait for startup without a separate ready call', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(BASE)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  const env = await page.evaluate(() => window.PolymorphicAgent.getState())
  expect(env.ok).toBe(true)
  expect(env.state.program).toEqual({ chars: BASE.length, running: true, error: null })
  expect(env.state.backend).toBe('webgl2')
})

test('setProgram runs a program, and history steps back and forward through programs that ran', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async ({ red, blue }) => {
    const A = window.PolymorphicAgent
    const before = (await A.getProgram()).result
    const set = await A.setProgram({ dsl: red })
    await A.setProgram({ dsl: blue })
    const back = await A.stepHistory({ direction: 'back' })
    const afterBack = (await A.getProgram()).result
    const forward = await A.stepHistory({ direction: 'forward' })
    const afterForward = (await A.getProgram()).result.dsl
    const end = await A.stepHistory({ direction: 'forward' })
    return { before, set, back: back.result, afterBack, forward: forward.result, afterForward, end: end.result, history: end.state.history }
  }, { red: RED, blue: BLUE })
  expect(out.before).toEqual({ dsl: BASE, running: true })
  expect(out.set.ok).toBe(true)
  expect(out.set.result.applied).toBe(true)
  expect(out.set.state.program).toEqual({ chars: RED.length, running: true, error: null })
  expect(out.back).toEqual({ applied: true })
  expect(out.afterBack).toEqual({ dsl: RED, running: true })
  expect(out.forward).toEqual({ applied: true })
  expect(out.afterForward).toBe(BLUE)
  expect(out.end).toEqual({ applied: false })
  expect(out.history).toEqual({ canBack: true, canForward: false })
  // A program that runs is stamped in the page URL, as typing it would be.
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('dsl'))).toBe(BLUE)
  expect(await page.locator('#dsl-editor').evaluate(el => el.value)).toBe(BLUE)
})

test('a program that does not compile changes nothing', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const bad = 'search synth, filter\nperlin(scale: 75, madeUp: 3).write(o0)\nrender(o0)'
    const check = await A.validateProgram({ dsl: bad })
    const set = await A.setProgram({ dsl: bad })
    const syntax = await A.validateProgram({ dsl: 'search synth\nperlin(' })
    return { check: check.result, set, syntax: syntax.result, after: (await A.getProgram()).result }
  })
  expect(out.check.valid).toBe(false)
  expect(out.check.diagnostics.some(d => d.code === 'S001' && d.severity === 'error' && d.message.includes('madeUp'))).toBe(true)
  expect(out.set.ok).toBe(false)
  expect(out.set.error.code).toBe('INVALID_PROGRAM')
  expect(out.set.error.details.diagnostics.some(d => d.code === 'S001')).toBe(true)
  expect(out.syntax.valid).toBe(false)
  expect(out.syntax.diagnostics[0].code).toBe('SYNTAX')
  expect(out.after).toEqual({ dsl: BASE, running: true })
})

test('when the renderer rejects a program, the previous program runs again', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async (red) => {
    const A = window.PolymorphicAgent
    const renderer = window.__poly.renderer
    const compile = renderer.compile
    let calls = 0
    renderer.compile = function (dsl) {
      return calls++ === 0 ? Promise.resolve({ success: false, error: 'stub rejection' }) : compile.call(this, dsl)
    }
    try {
      const set = await A.setProgram({ dsl: red })
      return { code: set.error?.code, message: set.error?.message, state: set.state.program, after: (await A.getProgram()).result }
    } finally {
      renderer.compile = compile
    }
  }, RED)
  expect(out.code).toBe('COMPILE_FAILED')
  expect(out.message).toContain('stub rejection')
  expect(out.state).toEqual({ chars: BASE.length, running: true, error: null })
  expect(out.after).toEqual({ dsl: BASE, running: true })
})

test('effect lookup returns current parameter names and the text effect', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const search = await A.searchEffects({ query: 'blend', namespace: 'mixer' })
    const def = await A.getEffectDefinition({ effectId: 'mixer/blendMode' })
    const text = await A.getEffectDefinition({ effectId: 'filter/text' })
    const textProgram = await A.validateProgram({ dsl: 'search synth, filter\nsolid(color: [0, 0, 0]).text(text: "Hello", font: "Nunito", size: 0.1).write(o0)\nrender(o0)' })
    const missing = await A.getEffectDefinition({ effectId: 'mixer/nope' })
    const limited = await A.searchEffects({ limit: 3 })
    return {
      search: search.result.effects.map(e => e.effectId),
      def: def.result,
      textParams: text.result.params.map(p => p.name),
      textValid: textProgram.result,
      missing: missing.error.code,
      limited: { total: limited.result.total, count: limited.result.effects.length },
    }
  })
  expect(out.search).toContain('mixer/blendMode')
  expect(out.def.func).toBe('blendMode')
  expect(out.def.params.map(p => p.name)).toContain('mix')
  expect(out.def.params.map(p => p.name)).not.toContain('mixAmt')
  expect(out.textParams).toEqual(expect.arrayContaining(['text', 'font', 'size']))
  expect(out.textValid).toEqual({ valid: true, diagnostics: [] })
  expect(out.missing).toBe('NOT_FOUND_EFFECT')
  expect(out.limited.count).toBe(3)
  expect(out.limited.total).toBeGreaterThan(100)
})

test('arguments are checked, playback toggles, and thumbnails come back as small images', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const unknown = await A.setProgram({ dsl: 'x', force: true })
    const noArgs = await A.getState({ force: true })
    const range = await A.getThumbnail({ maxDimension: 4096 })
    const thumb = await A.getThumbnail({ maxDimension: 64, format: 'png' })
    const jpeg = await A.getThumbnail()
    const paused = await A.pause()
    const playing = await A.play()
    return {
      unknown: unknown.error.code,
      noArgs: noArgs.error.code,
      range: range.error.code,
      thumb: { ok: thumb.ok, mimeType: thumb.result.mimeType, w: thumb.result.width, h: thumb.result.height, png: atob(thumb.result.bytes.slice(0, 8)).slice(1, 4) },
      jpeg: { mimeType: jpeg.result.mimeType, w: jpeg.result.width, magic: Array.from(atob(jpeg.result.bytes.slice(0, 4)), c => c.charCodeAt(0)).slice(0, 2) },
      paused: { result: paused.result, state: paused.state.playback },
      playing: playing.result,
    }
  })
  expect(out.unknown).toBe('INVALID_ARGS_UNKNOWN')
  expect(out.noArgs).toBe('INVALID_ARGS_UNKNOWN')
  expect(out.range).toBe('INVALID_ARGS_RANGE')
  expect(out.thumb).toMatchObject({ ok: true, mimeType: 'image/png', w: 64, png: 'PNG' })
  expect(out.thumb.h).toBeLessThanOrEqual(64)
  expect(out.jpeg).toEqual({ mimeType: 'image/jpeg', w: 256, magic: [0xff, 0xd8] })
  expect(out.paused).toEqual({ result: { playing: false }, state: { playing: false } })
  expect(out.playing).toEqual({ playing: true })
})

test('a thumbnail taken while paused shows the program that was just set', async ({ page }) => {
  await loadAgent(page)
  await page.evaluate(() => window.PolymorphicAgent.pause())
  await page.evaluate(dsl => window.PolymorphicAgent.setProgram({ dsl }), RED)
  expect(await thumbnailPixel(page)).toEqual([255, 0, 0, 255])
  await page.evaluate(dsl => window.PolymorphicAgent.setProgram({ dsl }), BLUE)
  expect(await thumbnailPixel(page)).toEqual([0, 0, 255, 255])
})

test('a WebGL2 thumbnail matches the canvas, the right way up', async ({ page }) => {
  await loadAgent(page)
  const out = await cornerPixels(page)
  expect(out.backend).toBe('webgl2')
  expectSameCorners(out)
})

test('a WebGPU thumbnail matches the canvas, the right way up', async ({ page }) => {
  await loadAgent(page, '&backend=webgpu')
  const out = await cornerPixels(page)
  expect(out.backend).toBe('webgpu')
  expectSameCorners(out)
})

test('gallery examples load, and resetProgram restores the last one', async ({ page }) => {
  await loadAgent(page)
  const examples = JSON.parse(await readFile(resolve(process.cwd(), 'public/data/examples.json'), 'utf8'))
  const out = await page.evaluate(async ({ title, red }) => {
    const A = window.PolymorphicAgent
    const list = await A.listExamples()
    const load = await A.loadExample({ title: title.toUpperCase() })
    const program = (await A.getProgram()).result.dsl
    await A.setProgram({ dsl: red })
    const reset = await A.resetProgram()
    const restored = (await A.getProgram()).result.dsl
    const missing = await A.loadExample({ title: 'No such example' })
    const random = await A.loadExample()
    return {
      list: list.result, load: load.result, program, reset: reset.ok, restored,
      missing: missing.error.code, random: { ok: random.ok, title: random.result.title, dsl: (await A.getProgram()).result.dsl },
    }
  }, { title: examples[1].title, red: RED })
  expect(out.list.total).toBe(examples.length)
  expect(out.list.examples[1]).toEqual({ title: examples[1].title, tagline: examples[1].tagline, tags: examples[1].tags })
  expect(out.list.examples[1].dsl).toBeUndefined()
  expect(out.load).toMatchObject({ title: examples[1].title, applied: true })
  expect(out.program).toBe(examples[1].dsl)
  expect(out.reset).toBe(true)
  expect(out.restored).toBe(examples[1].dsl)
  expect(out.missing).toBe('NOT_FOUND_EXAMPLE')
  expect(out.random.ok).toBe(true)
  expect(out.random.dsl).toBe(examples.find(e => e.title === out.random.title).dsl)
})

test('saved programs save, list, load and delete', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async ({ red, blue }) => {
    const A = window.PolymorphicAgent
    await A.setProgram({ dsl: red })
    const saved = await A.saveProgram({ name: ' Red ' })
    await A.setProgram({ dsl: blue })
    const conflict = await A.saveProgram({ name: 'Red' })
    const blank = await A.saveProgram({ name: '   ' })
    const listed = await A.listPrograms()
    const loaded = await A.loadProgram({ name: 'Red' })
    const program = (await A.getProgram()).result.dsl
    await A.setProgram({ dsl: blue })
    const overwritten = await A.saveProgram({ name: 'Red', overwrite: true })
    const stored = JSON.parse(localStorage.getItem('polymorphic-programs'))
    const deleted = await A.deleteProgram({ name: 'Red' })
    const missing = await A.loadProgram({ name: 'Red' })
    const empty = await A.listPrograms()
    return {
      saved: saved.result, conflict: conflict.error.code, blank: blank.error.code, listed: listed.result,
      loaded: loaded.result, program, overwritten: overwritten.result, storedDsl: stored.Red.dsl,
      deleted: deleted.result, missing: missing.error.code, empty: empty.result,
    }
  }, { red: RED, blue: BLUE })
  expect(out.saved).toEqual({ saved: true, name: 'Red' })
  expect(out.conflict).toBe('CONFLICT_PROGRAM_EXISTS')
  expect(out.blank).toBe('INVALID_ARGS_RANGE')
  expect(out.listed).toEqual({ total: 1, programs: [{ name: 'Red', savedAt: expect.any(Number), chars: RED.length }] })
  expect(out.loaded).toMatchObject({ name: 'Red', applied: true })
  expect(out.program).toBe(RED)
  expect(out.overwritten).toEqual({ saved: true, name: 'Red' })
  expect(out.storedDsl).toBe(BLUE)
  expect(out.deleted).toEqual({ deleted: true, name: 'Red' })
  expect(out.missing).toBe('NOT_FOUND_PROGRAM')
  expect(out.empty).toEqual({ total: 0, programs: [] })
})

test('scenes save to a slot and load from it', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async ({ red, blue }) => {
    const A = window.PolymorphicAgent
    await A.setProgram({ dsl: red })
    const saved = await A.saveScene({ slot: 3 })
    await A.setProgram({ dsl: blue })
    const listed = await A.listScenes()
    const loaded = await A.loadScene({ slot: 3 })
    const program = (await A.getProgram()).result.dsl
    const empty = await A.loadScene({ slot: 9 })
    return { saved: saved.result, listed: listed.result, loaded: loaded.result, program, empty: empty.error.code }
  }, { red: RED, blue: BLUE })
  expect(out.saved).toEqual({ saved: true, slot: 3 })
  expect(out.listed).toEqual({ scenes: [{ slot: 3, chars: RED.length }] })
  expect(out.loaded).toMatchObject({ slot: 3, applied: true })
  expect(out.program).toBe(RED)
  expect(out.empty).toBe('NOT_FOUND_SCENE')
})

test('output surfaces switch, cycle and clear', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async (dsl) => {
    const A = window.PolymorphicAgent
    await A.setProgram({ dsl })
    const o1 = await A.setOutput({ surface: 'o1' })
    const program = (await A.getProgram()).result.dsl
    const same = await A.setOutput({ surface: 'o1' })
    const next = await A.setOutput({ surface: 'next' })
    const previous = await A.setOutput({ surface: 'previous' })
    const cleared = await A.clearSurfaces()
    return { o1: o1.result, output: o1.state.output, program, same: same.result, next: next.result, previous: previous.result, cleared: cleared.result }
  }, TWO_SURFACES)
  expect(out.o1).toEqual({ surface: 'o1', changed: true })
  expect(out.output).toEqual({ surface: 'o1', written: ['o0', 'o1'] })
  expect(out.program).toBe(TWO_SURFACES.replace('render(o0)', 'render(o1)'))
  expect(out.same).toEqual({ surface: 'o1', changed: false })
  expect(out.next).toEqual({ surface: 'o0', changed: true })
  expect(out.previous).toEqual({ surface: 'o1', changed: true })
  expect(out.cleared).toEqual({ cleared: true })
  expect(await thumbnailPixel(page)).toEqual([0, 0, 255, 255])
})

test('the tempo, the view and the program format change through their commands', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const tempo = await A.setTempo({ bpm: 60, divider: 1 })
    const current = await A.setTempo()
    const statusOff = await A.setView({ panel: 'statusRow', visible: false })
    const editorOff = await A.setView({ panel: 'editor', visible: false })
    const editorDisplay = document.getElementById('dsl-overlay').style.display
    const editorOn = await A.setView({ panel: 'editor', visible: true })
    const pips = await A.setView({ panel: 'surfacePips', visible: true })
    const messy = 'search synth\nsolid(color:[1,0,0]).write(o0)\nrender(o0)'
    await A.setProgram({ dsl: messy })
    const formatted = await A.formatProgram()
    const again = await A.formatProgram()
    return {
      tempo: tempo.result, tempoState: tempo.state.tempo, current: current.result,
      statusOff: statusOff.result, editorOff: editorOff.result, editorDisplay, editorOn: editorOn.result,
      view: pips.state.view, formatted: formatted.result, again: again.result,
      program: (await A.getProgram()).result.dsl,
    }
  })
  expect(out.tempo).toEqual({ bpm: 60, divider: 1, source: 'manual', loopSeconds: 4 })
  expect(out.tempoState).toEqual({ bpm: 60, divider: 1, source: 'manual' })
  expect(out.current).toEqual(out.tempo)
  expect(out.statusOff).toEqual({ panel: 'statusRow', visible: false })
  expect(out.editorOff).toEqual({ panel: 'editor', visible: false })
  expect(out.editorDisplay).toBe('none')
  expect(out.editorOn).toEqual({ panel: 'editor', visible: true })
  expect(out.view).toMatchObject({ editor: true, statusRow: false, surfacePips: true })
  expect(out.formatted).toEqual({ changed: true })
  expect(out.again).toEqual({ changed: false })
  expect(out.program).not.toBe('search synth\nsolid(color:[1,0,0]).write(o0)\nrender(o0)')
  expect(out.program.replace(/\s+/g, '')).toBe('searchsynthsolid(color:[1,0,0]).write(o0)render(o0)')
})

// A custom effect, as a sharing link carries it: a declarative definition with
// its shader sources. The program below does not run it; it only names it.
const CUSTOM_EFFECT = {
  name: 'agentFill',
  func: 'agentFill',
  description: 'Fills the picture with one level of red',
  globals: { level: { type: 'float', default: 0.5, min: 0, max: 1, uniform: 'level' } },
  passes: [{ name: 'render', program: 'main', inputs: {}, outputs: { color: 'outputTex' } }],
  shaders: { main: {
    glsl: '#version 300 es\nprecision highp float;\nuniform float level;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(level, 0.0, 0.0, 1.0); }',
    wgsl: '@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(0.5, 0.0, 0.0, 1.0); }',
  } },
}

test('a sharing link loads its composition and custom effects, and a bad link changes nothing', async ({ page }) => {
  await page.route('https://sharing.noisedeck.app/api/composition/**', route => {
    const code = new URL(route.request().url()).pathname.split('/').pop()
    if (code !== 'Agent1') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code, title: 'Agent red', dsl: RED, images: [], effects: [CUSTOM_EFFECT] }) })
  })
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const loaded = await A.importComposition({ link: 'https://sharing.noisedeck.app/s/Agent1' })
    const program = (await A.getProgram()).result.dsl
    const custom = await A.searchEffects({ namespace: 'user' })
    const definition = await A.getEffectDefinition({ effectId: 'user/agentFill' })
    const check = await A.validateProgram({ dsl: 'search user, synth\nagentFill(level: 0.2).write(o0)\nrender(o0)' })
    const gone = await A.importComposition({ link: 'Gone12' })
    const foreign = await A.importComposition({ link: 'https://example.com/s/Agent1' })
    return {
      loaded: loaded.result, program, custom: custom.result.effects, definition: definition.result, check: check.result,
      gone: gone.error, foreign: foreign.error.code, after: (await A.getProgram()).result.dsl,
    }
  })
  expect(out.loaded).toEqual({ title: 'Agent red', effects: ['user/agentFill'], images: 0, applied: true, diagnostics: [] })
  expect(out.program).toBe(RED)
  expect(out.custom).toEqual([{ effectId: 'user/agentFill', namespace: 'user', name: 'agentFill', description: 'Fills the picture with one level of red', tags: ['user'] }])
  expect(out.definition).toMatchObject({ effectId: 'user/agentFill', func: 'agentFill', namespace: 'user' })
  expect(out.definition.params).toEqual([{ name: 'level', type: 'float', default: 0.5, min: 0, max: 1 }])
  expect(out.check).toEqual({ valid: true, diagnostics: [] })
  expect(out.gone.code).toBe('IMPORT_FAILED')
  expect(out.gone.message).toContain('not found')
  expect(out.foreign).toBe('IMPORT_FAILED')
  expect(out.after).toBe(RED)
})

test('exportImage saves through the browser download', async ({ page }) => {
  await loadAgent(page)
  const [download, env] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => window.PolymorphicAgent.exportImage({ format: 'jpg' })),
  ])
  expect(env.ok).toBe(true)
  expect(env.result).toMatchObject({ started: true, format: 'jpg' })
  expect(download.suggestedFilename()).toBe('polymorphic.jpg')
})

test('a recording starts, and stopping it saves the video through the browser download', async ({ page }) => {
  await loadAgent(page)
  const started = await page.evaluate(() => window.PolymorphicAgent.setRecording({ recording: true, quality: 'low' }))
  expect(started.result).toEqual({ recording: true, quality: 'low' })
  expect(started.state.recording).toBe(true)
  const [download, stopped] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => window.PolymorphicAgent.setRecording({ recording: false })),
  ])
  expect(stopped.result).toEqual({ recording: false, quality: 'low' })
  expect(download.suggestedFilename()).toMatch(/\.(webm|mp4)$/)
})

test('fullscreen enters and leaves, and a refusal is reported', async ({ page }) => {
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const A = window.PolymorphicAgent
    const enter = await A.setFullscreen({ fullscreen: true })
    const leave = await A.setFullscreen({ fullscreen: false })
    // A browser refuses fullscreen when no click or key press came first.
    const request = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'))
    try {
      const refused = await A.setFullscreen({ fullscreen: true })
      return { enter: enter.result, leave: leave.result, refused: refused.error }
    } finally {
      Element.prototype.requestFullscreen = request
    }
  })
  expect(out.enter).toEqual({ fullscreen: true })
  expect(out.leave).toEqual({ fullscreen: false })
  expect(out.refused.code).toBe('BROWSER_REFUSED')
  expect(out.refused.message).toContain('Permissions check failed')
})

test('a live input opens the live inputs panel and becomes the media source', async ({ page }) => {
  await page.addInitScript(() => {
    // A camera without hardware: a canvas stream stands in for the webcam.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 16
      canvas.getContext('2d').fillRect(0, 0, 16, 16)
      return canvas.captureStream(10)
    }
  })
  await loadAgent(page)
  const out = await page.evaluate(async () => {
    const live = await window.PolymorphicAgent.useLiveInput({ source: 'webcam' })
    return { live: live.result, panel: live.state.view.liveInputs }
  })
  expect(out.live).toEqual({ requested: true, source: 'webcam' })
  expect(out.panel).toBe(true)
  await expect.poll(() => page.evaluate(async () => (await window.PolymorphicAgent.getState()).state.liveMedia)).toBe(true)
})

test('setBackend reloads into the selected renderer', async ({ page }) => {
  await loadAgent(page)
  const same = await page.evaluate(() => window.PolymorphicAgent.setBackend({ backend: 'webgl2' }))
  expect(same.result).toEqual({ backend: 'webgl2', reloading: false })
  const env = await page.evaluate(() => {
    window.beforeReload = true
    return window.PolymorphicAgent.setBackend({ backend: 'webgpu' })
  })
  expect(env.result).toEqual({ backend: 'webgpu', reloading: true })
  await page.waitForFunction(() => !window.beforeReload && window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  const state = await page.evaluate(async () => (await window.PolymorphicAgent.getState()).state)
  expect(state.backend).toBe('webgpu')
  expect(state.program.running).toBe(true)
})

test('the command form runs the same validation, mutation and image commands without page evaluation', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(BASE)}&agent=1`, { waitUntil: 'domcontentloaded' })
  const panel = page.getByRole('region', { name: 'Polymorphic agent' })
  await expect(panel).toBeVisible({ timeout: 30000 })
  const command = panel.getByLabel('Command', { exact: true })
  const args = panel.getByLabel('Arguments (JSON)', { exact: true })
  const run = panel.getByRole('button', { name: 'Run command', exact: true })
  const output = panel.getByLabel('Command result', { exact: true })
  await expect(run).toBeEnabled({ timeout: 30000 })
  await command.selectOption('setProgram')
  await args.fill(JSON.stringify({ dsl: RED }))
  await run.click()
  await expect(output).toContainText('"applied": true')
  await command.selectOption('validateProgram')
  await args.fill(JSON.stringify({ dsl: 'search synth\nperlin(madeUp: 1).write(o0)\nrender(o0)' }))
  await run.click()
  await expect(output).toContainText('"valid": false')
  await args.fill('{')
  await run.click()
  await expect(output).toContainText('INVALID_JSON')
  await command.selectOption('getProgram')
  await args.fill('{}')
  await run.click()
  await expect(output).toContainText('solid(color: [1, 0, 0])')
  await command.selectOption('getThumbnail')
  await args.fill('{"maxDimension":64,"format":"png"}')
  await run.click()
  await expect(panel.getByRole('img', { name: 'Command image' })).toBeVisible()
  await expect(output).toContainText('"width": 64')
  await expect(output).not.toContainText('"bytes"')
  await expect(panel.getByRole('link', { name: 'Download image' })).toHaveAttribute('href', /^blob:/)
})

test('without agent=1 the page has no command form', async ({ page }) => {
  await loadAgent(page)
  expect(await page.locator('#polymorphic-agent-console').count()).toBe(0)
})

test('WebMCP registers all commands and executes real handlers after readiness', async ({ page }) => {
  // Capture the native registration boundary in browsers without WebMCP.
  // The callbacks below are the actual app handlers, not command mocks.
  await page.addInitScript(() => {
    const tools = new Map()
    Object.defineProperty(document, 'modelContext', { value: {
      registerTool(tool) { tools.set(tool.name, tool) },
    } })
    window.registeredAgentTools = tools
  })
  await loadAgent(page)
  const out = await page.evaluate(async (dsl) => {
    const tools = window.registeredAgentTools
    const names = Array.from(tools.keys())
    const set = await tools.get('polymorphic_setProgram').execute({ dsl })
    const invalid = await tools.get('polymorphic_setProgram').execute({ dsl: 'x', force: true })
    const program = await tools.get('polymorphic_getProgram').execute({})
    const thumbnail = await tools.get('polymorphic_getThumbnail').execute({ maxDimension: 64, format: 'png' })
    const { COMMAND_GROUPS } = await import('/js/agent/descriptions.js')
    return {
      names, described: COMMAND_GROUPS.flatMap(g => Object.keys(g.commands)).map(name => `polymorphic_${name}`),
      set, invalid, program,
      thumbnail: { ...thumbnail, content: thumbnail.content.map(c => c.type === 'image' ? { ...c, data: c.data.slice(0, 12) } : c) },
      schema: tools.get('polymorphic_getThumbnail').inputSchema,
      readOnly: tools.get('polymorphic_getProgram').annotations.readOnlyHint,
      mutation: tools.get('polymorphic_setProgram').annotations.readOnlyHint,
    }
  }, RED)
  expect([...out.names].sort()).toEqual([...out.described].sort())
  expect(out.set.isError).toBe(false)
  expect(JSON.parse(out.program.content[0].text).result.dsl).toBe(RED)
  expect(out.invalid.isError).toBe(true)
  expect(JSON.parse(out.invalid.content[0].text).error.code).toBe('INVALID_ARGS_UNKNOWN')
  expect(out.thumbnail.content.find(c => c.type === 'image')).toMatchObject({ mimeType: 'image/png' })
  expect(out.thumbnail.content.find(c => c.type === 'text').text).not.toContain('"bytes"')
  expect(out.schema.properties.maxDimension).toMatchObject({ minimum: 16, maximum: 1024 })
  expect(out.readOnly).toBe(true)
  expect(out.mutation).toBe(false)
})

test('an unavailable WebMCP registration does not break commands or the form', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { value: {
      registerTool() { return Promise.reject(new Error('registration unavailable')) },
    } })
  })
  await loadAgent(page, '&agent=1')
  const env = await page.evaluate(() => window.PolymorphicAgent.getState())
  expect(env.ok).toBe(true)
  await expect(page.getByRole('region', { name: 'Polymorphic agent' }).getByRole('button', { name: 'Run command' })).toBeEnabled()
})

test('/llms.txt and /llms-full.txt are served as text', async ({ request }) => {
  const llms = await request.get('/llms.txt')
  expect(llms.status()).toBe(200)
  expect(llms.headers()['content-type']).toContain('text/plain')
  expect(await llms.text()).toContain('node seance-agent.mjs join')
  const full = await request.get('/llms-full.txt')
  expect(full.status()).toBe(200)
  expect(await full.text()).toContain('## Command reference')
})
