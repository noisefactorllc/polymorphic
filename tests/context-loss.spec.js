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

test('a lost WebGL context pauses the loop and warns, then restores the program on context restore', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(SKETCH)}`)
  await waitForApp(page)

  const supported = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2')
    return Boolean(gl?.getExtension('WEBGL_lose_context'))
  })
  test.skip(!supported, 'WEBGL_lose_context is required to simulate a GPU reset')

  // waitForApp only proves the backend exists; on a fast GPU the render loop
  // may not have started yet. Wait for the loop itself so losing the context
  // mid-boot cannot masquerade as a lost-context regression.
  await page.waitForFunction(() => window.__poly.renderer.isRunning, null, { timeout: 30000 })

  const wasRunning = await page.evaluate(() => window.__poly.renderer.isRunning)
  expect(wasRunning).toBe(true)

  // Lose the context the way a GPU reset would. The held extension object
  // stays valid for restoring the same context later.
  await page.evaluate(() => {
    const ext = document.querySelector('canvas').getContext('webgl2')
      .getExtension('WEBGL_lose_context')
    window.__loseContext = ext
    ext.loseContext()
  })

  const lostToast = page.locator('.polymorphic-toast')
  await expect(lostToast).toBeVisible()
  await expect(lostToast).toHaveText('Graphics context lost — recovering your program…')
  await expect(lostToast).toHaveAttribute('role', 'status')

  // The loop stops while the context is dead — no doomed renders.
  await page.waitForFunction(() => !window.__poly.renderer.isRunning)

  // The browser hands back a fresh context; recovery recompiles and restarts.
  await page.evaluate(() => {
    window.__loseContext.restoreContext()
  })

  const restoredToast = page.locator('.polymorphic-toast')
  await expect(restoredToast).toBeVisible()
  await expect(restoredToast).toHaveText('Graphics restored — your program is live again')
  await page.waitForFunction(() => window.__poly.renderer.isRunning)

  // The editor still holds the program — user state survived the reset.
  const editorValue = await page.evaluate(() => document.querySelector('code-editor')?.value)
  expect(editorValue).toContain('perlin(')
})

test('a disposed renderer stays disposed through a late context loss and restore', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(SKETCH)}`)
  await waitForApp(page)

  const supported = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2')
    return Boolean(gl?.getExtension('WEBGL_lose_context'))
  })
  test.skip(!supported, 'WEBGL_lose_context is required to simulate a GPU reset')

  await page.waitForFunction(() => window.__poly.renderer.isRunning, null, { timeout: 30000 })

  // The pagehide teardown path: dispose the renderer while the page lives on.
  await page.evaluate(() => window.__poly.renderer.dispose())
  await page.waitForFunction(() => !window.__poly.renderer.inner._pipeline)

  // A GPU reset after disposal must not revive the renderer. The engine keeps
  // the canvas's loss/restore listeners after dispose(), so a late loss used
  // to schedule recovery and the restore event used to rebuild a pipeline on
  // the disposed renderer. Neither the recovery timer nor the restore event
  // may rebuild a pipeline or restart the loop now.
  await page.evaluate(() => {
    const ext = document.querySelector('canvas').getContext('webgl2')
      .getExtension('WEBGL_lose_context')
    window.__loseContext = ext
    ext.loseContext()
  })

  // Let the engine's no-restore recovery window elapse with no renderer to
  // recover, then hand a fresh context back the way a GPU reset would.
  await page.waitForTimeout(3500)
  await page.evaluate(() => window.__loseContext.restoreContext())
  await page.waitForTimeout(1500)

  expect(await page.evaluate(() => window.__poly.renderer.isRunning)).toBe(false)
  expect(await page.evaluate(() => window.__poly.renderer.inner._pipeline)).toBe(null)
})
