/**
 * PolymorphicAgent on the WebGPU renderer. A WebGPU canvas reads back blank
 * through drawImage(), so getThumbnail reads the texture the engine presented.
 * These tests need a WebGPU adapter; playwright.config.js runs this file in
 * the project that enables one.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installHandfishLocal } from './handfishLocal.js'
import { cornerPixels, expectCorners } from './agentThumbnail.js'

installHandfishLocal(test)
test.describe.configure({ timeout: 90000 })

const BASE = 'search synth, filter\nperlin(scale: 75, octaves: 2).write(o0)\nrender(o0)'

async function loadAgent(page, query = '') {
  await page.goto(`/?dsl=${encodeURIComponent(BASE)}${query}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  await page.evaluate(() => window.PolymorphicAgent.ready)
}

test('a WebGPU thumbnail reads the presented texture and has the canvas\'s colours, the right way up', async ({ page }) => {
  await loadAgent(page, '&backend=webgpu')
  // Count the readbacks from the presented texture: the path that this test is for.
  await page.evaluate(() => {
    const backend = window.__poly.renderer.inner.pipeline.backend
    const readPixels = backend.readPixels
    window.readbacks = 0
    backend.readPixels = function (...args) {
      window.readbacks++
      return readPixels.apply(this, args)
    }
  })
  const out = await cornerPixels(page)
  expect(out.backend).toBe('webgpu')
  expect(await page.evaluate(() => window.readbacks)).toBeGreaterThan(0)
  expectCorners(out.corners)
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

/** A gallery example that needs WebGL2: one of its effects has no WGSL shader. */
async function webgl2Example() {
  const examples = JSON.parse(await readFile(resolve(process.cwd(), 'public/data/examples.json'), 'utf8'))
  const example = examples.find(e => (e.effects || []).some(effect =>
    (effect.passes || []).some(pass => !effect.shaders?.[pass.program]?.wgsl?.trim())))
  expect(example).toBeTruthy()
  return example
}

test('an example that needs WebGL2 reloads a WebGPU tab into WebGL2 with the example running', async ({ page }) => {
  const example = await webgl2Example()
  await loadAgent(page, '&backend=webgpu')
  const env = await page.evaluate(id => {
    window.beforeReload = true
    return window.PolymorphicAgent.loadExample({ id })
  }, example.id)
  expect(env.ok).toBe(true)
  expect(env.result).toEqual({ id: example.id, title: example.title, applied: false, reloading: true })
  await page.waitForFunction(() => !window.beforeReload && window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  await page.evaluate(() => window.PolymorphicAgent.ready)
  const url = new URL(page.url())
  expect(url.searchParams.get('backend')).toBe('webgl2')
  expect(url.searchParams.get('curated')).toBe(example.id)
  await expect.poll(async () => page.evaluate(async () => (await window.PolymorphicAgent.getProgram()).result), { timeout: 30000 })
    .toEqual({ dsl: example.dsl, running: true })
  expect((await page.evaluate(async () => (await window.PolymorphicAgent.getState()).state)).backend).toBe('webgl2')
})

test('through a session, an example that needs WebGL2 does not reload the person\'s WebGPU tab', async ({ page }) => {
  const example = await webgl2Example()
  await loadAgent(page, '&backend=webgpu')
  const before = { url: page.url(), program: await page.evaluate(async () => (await window.PolymorphicAgent.getProgram()).result) }
  const effects = example.effects.map(effect => `user/${effect.func}`)
  const out = await page.evaluate(async id => {
    window.beforeReload = true
    // The dispatcher that the Seance relay calls for a session's request.
    const { runCommand } = await import('/js/agent/dispatcher.js')
    return (await runCommand('loadExample', { id }, { remote: true })).envelope
  }, example.id)
  expect(out.ok).toBe(false)
  expect(out.error.code).toBe('REMOTE_UNAVAILABLE')
  // The refusal comes before anything reaches the editor, the URL, the
  // renderer or the tab's custom effects.
  const after = await page.evaluate(async effects => {
    const { getLoadedPortableEffects } = await import('/js/sharingLoader.js')
    return {
      beforeReload: window.beforeReload,
      backend: (await window.PolymorphicAgent.getState()).state.backend,
      program: (await window.PolymorphicAgent.getProgram()).result,
      registered: effects.filter(id => getLoadedPortableEffects().has(id)),
    }
  }, effects)
  expect(after).toEqual({ beforeReload: true, backend: 'webgpu', program: before.program, registered: [] })
  expect(page.url()).toBe(before.url)
})
