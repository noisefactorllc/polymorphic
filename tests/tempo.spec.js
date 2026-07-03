import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// A deterministic sketch so boot doesn't depend on the random-gallery network
// fetch — keeps the test focused on the tempo-bar wiring. This mirrors the
// app's bundled DEFAULT_DSL, which is guaranteed to compile.
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
const PAGE_URL = `/?dsl=${encodeURIComponent(SKETCH)}`

/** Wait until the app's debug surface and the mounted <tempo-bar> are ready.
 *  Generous timeout: boot compiles a real WebGL shader and fetches handfish, so
 *  cold/loaded machines need headroom. */
async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__poly && document.getElementById('tempo-bar')?.scheduler), null, { timeout: 30000 })
}

test('polymorphic boots with <tempo-bar> and no page/console errors', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  await page.goto(PAGE_URL)
  await waitForApp(page)

  // The shared component and all its sub-controls are present.
  const bar = page.locator('#tempo-bar')
  await expect(bar).toHaveCount(1)
  await expect(bar.locator('.tempo-bar__tap')).toHaveCount(1)
  await expect(bar.locator('.tempo-bar__bpm')).toHaveCount(1)
  await expect(bar.locator('.tempo-bar__divider')).toHaveCount(1)
  await expect(bar.locator('.tempo-bar__beat')).toHaveCount(4)
  await expect(bar.locator('.tempo-bar__reset')).toHaveCount(1)
  await expect(bar.locator('.tempo-bar__phase-slider')).toHaveCount(1)

  // storage-key wired to Polymorphic's existing divider key.
  await expect(bar).toHaveAttribute('storage-key', 'polymorphic.bpm.divider')

  await page.waitForTimeout(400) // let fonts / MIDI init / first frames settle
  expect(errors, errors.join('\n')).toEqual([])

  await page.screenshot({ path: 'test-results/polymorphic-tempo.png' })
})

test('tempo-bar scheduler drives the renderer loopDuration (barSeconds)', async ({ page }) => {
  await page.goto(PAGE_URL)
  await waitForApp(page)

  // Spy on the inner renderer's setLoopDuration so we can prove the controller
  // re-applies barSeconds() when the BPM changes. Then drive a BPM change.
  const result = await page.evaluate(() => {
    const inner = window.__poly.renderer.inner
    const calls = []
    const orig = inner.setLoopDuration.bind(inner)
    inner.setLoopDuration = (v) => { calls.push(v); return orig(v) }

    const bar = document.getElementById('tempo-bar')
    bar.scheduler.bpm = 60            // /4 → one bar = (60/60)*4*4 = 16s
    const expected = bar.scheduler.barSeconds()
    return { expected, last: calls[calls.length - 1], count: calls.length }
  })

  expect(result.count).toBeGreaterThan(0)
  expect(result.expected).toBeCloseTo(16, 5)
  expect(result.last).toBeCloseTo(result.expected, 5)
})

test('tempo-bar emits beat events (live beat clock)', async ({ page }) => {
  await page.goto(PAGE_URL)
  await waitForApp(page)

  const sawBeat = await page.evaluate(() => new Promise((resolve) => {
    const bar = document.getElementById('tempo-bar')
    // Push BPM high so a beat lands quickly within the timeout window.
    bar.scheduler.bpm = 240
    bar.scheduler.resetPhase()
    const t = setTimeout(() => resolve(false), 4000)
    bar.addEventListener('beat', () => { clearTimeout(t); resolve(true) }, { once: true })
  }))
  expect(sawBeat).toBe(true)
})

test('divider persists via the storage-key (localStorage)', async ({ page }) => {
  // Seed the persisted divider before the app reads it on boot.
  await page.addInitScript(() => {
    try { localStorage.setItem('polymorphic.bpm.divider', '8') } catch { /* ignore */ }
  })
  await page.goto(PAGE_URL)
  await waitForApp(page)

  const divider = await page.evaluate(() => document.getElementById('tempo-bar').scheduler.divider)
  expect(divider).toBe(8)
})

test('T key routes to tap tempo (manual source) and is gated by editor focus', async ({ page }) => {
  await page.goto(PAGE_URL)
  await waitForApp(page)

  // Count taps the component actually registers (precise BPM math is the
  // component's own concern). This verifies the embed.js T-key handler →
  // tempoController.tap() → scheduler.tap() path, and its editor-focus gate.
  await page.evaluate(() => {
    document.activeElement?.blur?.()
    const sch = document.getElementById('tempo-bar').scheduler
    window.__tapCount = 0
    sch.onTap(() => { window.__tapCount++ })
  })

  // With nothing focused (manual source), the T key taps. Space the presses so
  // each keydown fully dispatches under load.
  await page.keyboard.press('KeyT')
  await page.waitForTimeout(60)
  await page.keyboard.press('KeyT')
  await page.waitForTimeout(60)
  const afterUnfocused = await page.evaluate(() => window.__tapCount)
  expect(afterUnfocused).toBeGreaterThanOrEqual(2)

  // With the DSL editor focused, the T key must NOT tap (it types instead) —
  // the count must not advance.
  await page.evaluate(() => document.getElementById('dsl-editor')?.getTextarea?.()?.focus())
  await page.keyboard.press('KeyT')
  await page.waitForTimeout(60)
  expect(await page.evaluate(() => window.__tapCount)).toBe(afterUnfocused)
})

test('scheduler computes BPM from tap intervals (deterministic timestamps)', async ({ page }) => {
  await page.goto(PAGE_URL)
  await waitForApp(page)

  // Drive the component's scheduler.tap(now) with explicit timestamps so the
  // inter-tap interval is exact (500ms → 120 BPM), independent of render load.
  const bpm = await page.evaluate(() => {
    const sch = document.getElementById('tempo-bar').scheduler
    let t = 1000
    for (let i = 0; i < 5; i++) { sch.tap(t); t += 500 }
    return sch.bpm
  })
  expect(bpm).toBeCloseTo(120, 1)
})
