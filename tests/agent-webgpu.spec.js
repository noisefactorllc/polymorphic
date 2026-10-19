/**
 * PolymorphicAgent on the WebGPU renderer. A WebGPU canvas reads back blank
 * through drawImage(), so getThumbnail reads the texture the engine presented.
 * These tests need a WebGPU adapter; playwright.config.js runs this file in
 * the project that enables one.
 */
import { test, expect } from '@playwright/test'
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
