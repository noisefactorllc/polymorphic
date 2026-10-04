import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

// Two small deterministic sketches that both compile. Boot with one, save the
// other into a scene slot, then reload: a successful bare-digit recall must
// swap the editor back to the saved program — distinguishable from whatever
// the URL booted — and must never leave the pressed digit inside the program
// text.
const SKETCH_A = [
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

const SKETCH_B = SKETCH_A
  .replace('scale: 75', 'scale: 60')
  .replace('rotation: 120', 'rotation: 240')

const SLOT = 5

async function bootSettled(page, dsl) {
  await page.goto(`/?dsl=${encodeURIComponent(dsl)}`)
  await page.waitForFunction(
    () =>
      document.getElementById('canvas')?.classList.contains('visible') &&
      window.__poly?.renderer?.isRunning === true,
    null,
    { timeout: 30000 }
  )
}

async function editorValue(page) {
  // The textarea is the source of truth: the host element's value getter can
  // lag behind direct user typing, and recall/typing must be judged on the
  // real program text either way.
  return page.evaluate(() => {
    const editor = document.getElementById('dsl-editor')
    return editor?.getTextarea?.()?.value ?? editor?.value ?? null
  })
}

async function focusState(page) {
  return page.evaluate(() => {
    const el = document.activeElement
    return {
      tag: el?.tagName ?? null,
      inEditor: typeof el?.closest === 'function' && !!el.closest('code-editor'),
    }
  })
}

test('a bare digit right after boot recalls its scene instead of typing into the program', async ({ page }) => {
  // Boot, wait for the app to settle, and save the booted program to slot 5.
  await bootSettled(page, SKETCH_A)
  const saved = await editorValue(page)
  await page.keyboard.press('Control+Shift+Digit5')
  const toast = page.locator('.polymorphic-toast')
  await expect(toast).toContainText(`Saved scene ${SLOT}`, { timeout: 5000 })

  // Reload with a different program so a later recall is observable: the
  // booted value (B) and the saved scene (A) differ.
  await bootSettled(page, SKETCH_B)
  const booted = await editorValue(page)
  expect(booted).not.toBe(saved)

  // The premise of the defect: boot still auto-focuses the editor.
  const focus = await focusState(page)
  expect(focus.tag, 'boot auto-focuses the editor textarea').toBe('TEXTAREA')
  expect(focus.inEditor, 'the focused element sits in the code editor').toBe(true)

  // Bare digit right after boot: the scene must load, and the digit must
  // never land in the program text.
  await page.keyboard.press(String(SLOT))
  await expect(toast).toContainText(`Loaded scene ${SLOT}`, { timeout: 5000 })
  expect(await editorValue(page)).toBe(saved)

  // The seed survives consecutive recalls until a real interaction ends it:
  // an empty slot reports itself instead of typing either.
  await page.keyboard.press('9')
  await expect(toast).toContainText('Scene 9 is empty', { timeout: 5000 })
  expect(await editorValue(page)).toBe(saved)
})

test('once the user genuinely interacts, digits headed for the editor type again', async ({ page }) => {
  await bootSettled(page, SKETCH_A)
  const saved = await editorValue(page)
  await page.keyboard.press('Control+Shift+Digit5')
  await expect(page.locator('.polymorphic-toast')).toContainText(`Saved scene ${SLOT}`, { timeout: 5000 })

  await bootSettled(page, SKETCH_B)
  const booted = await editorValue(page)
  expect(booted).not.toBe(saved)

  // A click is real interaction: it ends the boot focus seed, so a digit is
  // typing again and must be inserted, not intercepted as scene recall.
  await page.locator('#dsl-editor textarea').click()
  await page.keyboard.press('End')
  await page.keyboard.press(String(SLOT))

  expect(await editorValue(page)).toBe(`${booted}${SLOT}`)
  await expect(page.locator('.polymorphic-toast')).toHaveCount(0)
})