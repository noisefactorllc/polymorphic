import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// A deterministic sketch that is guaranteed to compile (mirrors the bundled
// DEFAULT_DSL) and a boot-time invalid variant: an unbalanced paren, as in the
// original defect report.
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

const BAD_DSL = 'perlin(scale: 1'

async function setEditorText(page, text) {
  await page.evaluate((nextText) => {
    const editor = document.getElementById('dsl-editor')
    const textarea = editor?.getTextarea?.()
    if (textarea) {
      textarea.focus()
      textarea.value = nextText
      textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      return
    }
    if (editor) {
      editor.value = nextText
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    }
  }, text)
}

async function appState(page) {
  return page.evaluate(() => ({
    editorValue: document.getElementById('dsl-editor')?.value ?? null,
    compilerErrorVisible: document.getElementById('compiler-error')?.classList.contains('visible') ?? false,
    terminalErrorVisible: (document.getElementById('error')?.style.display || 'none') !== 'none',
    canvasVisible: document.getElementById('canvas')?.classList.contains('visible') ?? false,
    rendererRunning: window.__poly?.renderer?.isRunning ?? null,
    passCount: window.__poly?.renderer?.lastPassCount ?? 0,
  }))
}

test('a boot compile failure lands in the recoverable compiler-error state, not the terminal #error dead end', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(BAD_DSL)}`)

  // The editor must end up showing the broken program (recoverable trap →
  // working surface), and the failure must surface through the recoverable
  // banner rather than the terminal #error element.
  await page.waitForFunction(
    (bad) => document.getElementById('dsl-editor')?.value === bad,
    BAD_DSL,
    { timeout: 30000 }
  )

  const state = await appState(page)
  expect(state.compilerErrorVisible, 'recoverable compiler-error banner is visible').toBe(true)
  expect(state.terminalErrorVisible, 'terminal #error dead end is not used').toBe(false)
  expect(state.canvasVisible, 'canvas is not shown with no compiled program').toBe(false)
  expect(state.rendererRunning, 'render loop is not running with no compiled program').toBe(false)

  // The banner carries the compiler diagnostic (not a wrapped raw message).
  await expect(page.locator('#compiler-error')).toContainText(/line 1:16.*Expect '\)'/s)
})

test('fixing the program in the editor recovers the app without a page reload', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(BAD_DSL)}`)
  await page.waitForFunction(
    (bad) => document.getElementById('dsl-editor')?.value === bad,
    BAD_DSL,
    { timeout: 30000 }
  )
  await expect(page.locator('#compiler-error')).toBeVisible({ timeout: 15000 })

  // Marker to prove the recovery happens in the same JS context — no reload.
  await page.evaluate(() => { window.__noReloadMarker = 'same-page' })

  const recoveryStartedAt = Date.now()
  await setEditorText(page, SKETCH)

  // Recovery must land within the hot-reload window: the 500ms edit debounce
  // plus bounded compile time for this small sketch. Lower bound proves the
  // recovery went through the debounce (a faster "recovery" would be a reload
  // or a stale path, contradicting the same-page marker).
  await page.waitForFunction(
    () => document.getElementById('canvas')?.classList.contains('visible') &&
      window.__poly?.renderer?.isRunning === true,
    null,
    { timeout: 30000 }
  )
  const recoveryMs = Date.now() - recoveryStartedAt
  expect(recoveryMs, `recovery took ${recoveryMs}ms; must pass through the 500ms debounce`).toBeGreaterThanOrEqual(500)
  expect(recoveryMs, `recovery took ${recoveryMs}ms; must land within the 500ms debounce + compile window`).toBeLessThan(6000)

  const state = await appState(page)
  expect(state.compilerErrorVisible, 'boot compiler-error banner is cleared after the fix').toBe(false)
  expect(state.terminalErrorVisible, 'no terminal #error at any point').toBe(false)

  // The recovered app actually renders frames.
  await page.waitForFunction(
    () => (window.__poly?.renderer?.lastPassCount ?? 0) > 0,
    null,
    { timeout: 30000 }
  )

  expect(await page.evaluate(() => window.__noReloadMarker)).toBe('same-page')
})

test('a network-level boot failure keeps its terminal handling', async ({ page }) => {
  // An unreachable share API is not a compiler error: the existing terminal
  // #error boot failure path must stay exactly as it was.
  await page.route('https://sharing.noisedeck.app/api/composition/**', (route) => route.abort('failed'))

  await page.goto('/?code=deadbeef')

  await page.waitForFunction(
    () => (document.getElementById('error')?.style.display || 'none') !== 'none',
    null,
    { timeout: 30000 }
  )

  const state = await appState(page)
  expect(state.terminalErrorVisible, 'network boot failure still uses the terminal #error').toBe(true)
  expect(state.compilerErrorVisible, 'no recoverable banner for a network failure').toBe(false)
  expect(state.canvasVisible).toBe(false)
})