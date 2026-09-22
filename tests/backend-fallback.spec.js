import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const SKETCH = [
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

async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
}

test('shows informative toast when WebGPU is requested via URL but browser falls back to WebGL2', async ({ page }) => {
  // Deterministically ensure WebGPU is unavailable to trigger fallback
  await page.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        get: () => undefined,
        configurable: true
      })
    } catch {
      try {
        Object.defineProperty(navigator, 'gpu', {
          get: () => undefined,
          configurable: true
        })
      } catch {}
    }
  })

  const url = `/?backend=webgpu&dsl=${encodeURIComponent(SKETCH)}`
  await page.goto(url)
  await waitForApp(page)

  const backend = await page.evaluate(() => window.__poly.backend)
  const toast = page.locator('.polymorphic-toast')

  expect(backend).toBe('webgl2')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText('WebGPU is not supported by this browser; falling back to WebGL2')
  await expect(toast).toHaveAttribute('role', 'status')
})

test('does not show fallback toast when default WebGL2 backend is loaded', async ({ page }) => {
  const url = `/?dsl=${encodeURIComponent(SKETCH)}`
  await page.goto(url)
  await waitForApp(page)

  const toast = page.locator('.polymorphic-toast')
  await expect(toast).toHaveCount(0)
})

test('cleans up stored backend preference and notifies user when stored WebGPU falls back', async ({ page }) => {
  // Deterministically ensure WebGPU is unavailable to trigger fallback
  await page.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        get: () => undefined,
        configurable: true
      })
    } catch {
      try {
        Object.defineProperty(navigator, 'gpu', {
          get: () => undefined,
          configurable: true
        })
      } catch {}
    }
  })

  const url = `/?dsl=${encodeURIComponent(SKETCH)}`
  await page.goto(url)
  await waitForApp(page)

  await page.evaluate(() => {
    try { localStorage.setItem('polymorphic-backend', 'webgpu') } catch {}
  })

  await page.reload()
  await waitForApp(page)

  const backend = await page.evaluate(() => window.__poly.backend)
  const toast = page.locator('.polymorphic-toast')

  expect(backend).toBe('webgl2')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText('WebGPU is not supported by this browser; falling back to WebGL2')
  const stored = await page.evaluate(() => localStorage.getItem('polymorphic-backend'))
  expect(stored).toBeNull()
})
