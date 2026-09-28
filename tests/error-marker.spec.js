import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// A deterministic sketch so boot doesn't depend on the random-gallery network
// fetch — mirrors the app's bundled DEFAULT_DSL, which is guaranteed to compile.
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

// Appends a guaranteed parse error on the final line: the '@' character is
// unexpected at line 12, column 23 of the combined program.
const BAD_DSL = `${SKETCH}\nthis is not valid dsl @#%`
const ERROR_LINE = 12
const ERROR_COL = 23

async function waitForApp(page) {
  await page.waitForFunction(
    () => Boolean(window.__poly?.renderer && document.getElementById('dsl-editor')?.value),
    null,
    { timeout: 30000 }
  )
}

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

test('compiler error marks exactly one display line and its gutter number', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(SKETCH)}`)
  await waitForApp(page)

  await setEditorText(page, BAD_DSL)
  const banner = page.locator('#compiler-error')
  await expect(banner).toBeVisible({ timeout: 15000 })
  await expect(banner).toContainText(`line ${ERROR_LINE}:${ERROR_COL}`)

  const marked = await page.evaluate(({ expectedLine }) => {
    const editor = document.getElementById('dsl-editor')
    const display = [...editor.querySelectorAll('.code-editor-display .error-line')]
    const numbers = [...editor.querySelectorAll('.code-editor-gutter .line-number')]
    const gutter = [...editor.querySelectorAll('.code-editor-gutter .error-line')]
    return {
      displayNumbers: display.map((e) => e.getAttribute('data-line-number')),
      gutterIndexes: gutter.map((e) => numbers.indexOf(e)),
      gutterCount: gutter.length,
      expectedLine,
    }
  }, { expectedLine: ERROR_LINE })

  // Exactly one aligned marker pair: a strayed second highlight (stale marker
  // from a previous diagnostic or re-render) would break single-error clarity.
  expect(marked.displayNumbers).toEqual([String(marked.expectedLine)])
  expect(marked.gutterCount).toBe(1)
  expect(marked.gutterIndexes[0]).toBe(marked.expectedLine - 1)
})

test('clicking the compiler error banner jumps to the offending token', async ({ page }) => {
  await page.goto(`/?dsl=${encodeURIComponent(SKETCH)}`)
  await waitForApp(page)

  await setEditorText(page, BAD_DSL)
  const banner = page.locator('#compiler-error')
  await expect(banner).toBeVisible({ timeout: 15000 })
  await expect(banner).toContainText(`line ${ERROR_LINE}:${ERROR_COL}`)

  await banner.click()

  const selection = await page.evaluate(({ dsl, expectedLine, expectedCol }) => {
    const editor = document.getElementById('dsl-editor')
    const ta = editor.getTextarea()
    const lines = dsl.split('\n')
    let expectedOffset = 0
    for (let i = 0; i < expectedLine - 1; i++) expectedOffset += lines[i].length + 1
    const targetLineText = lines[expectedLine - 1] || ''
    const colOffset = Math.max(0, Math.min(expectedCol - 1, targetLineText.length))
    expectedOffset += colOffset
    return {
      start: ta.selectionStart,
      end: ta.selectionEnd,
      expectedOffset,
      selected: dsl.slice(ta.selectionStart, ta.selectionEnd),
      marked: [...editor.querySelectorAll('.code-editor-display .error-line')]
        .map((e) => e.getAttribute('data-line-number')),
    }
  }, { dsl: BAD_DSL, expectedLine: ERROR_LINE, expectedCol: ERROR_COL })

  // The caret lands on the offending '@' token and exactly that character is
  // selected (non-word token → single-character span).
  expect(selection.start).toBe(selection.expectedOffset)
  expect(selection.selected).toBe('@')
  expect(selection.marked).toEqual([String(ERROR_LINE)])
})
