import { test, expect } from '@playwright/test'
import { routeHandfishLocal } from './handfishLocal.js'
import { SEANCE_SDK_URL, hasLocalSeanceHarness, routeSeanceSdkLocal, startSeanceServer } from './seanceLocal.js'

const BASE_SKETCH = [
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

const PEER_SKETCH = [
  'search synth, filter',
  '',
  'perlin(scale: 18, octaves: 3)',
  '  .adjust(mode: hsv, rotation: 220, hueRange: 35)',
  '  .write(o0)',
  '',
  'render(o0)',
].join('\n')

const SERVER_SKETCH = [
  'search synth, filter',
  '',
  'perlin(scale: 35, octaves: 1)',
  '  .adjust(mode: hsv, rotation: 80, hueRange: 60)',
  '  .write(o0)',
  '',
  'render(o0)',
].join('\n')

let seance

test.describe.configure({ mode: 'serial' })
test.skip(!hasLocalSeanceHarness(), 'requires local Seance SDK/server harness; set SEANCE_SDK_DIR and SEANCE_PYTHON')

test.beforeAll(async () => {
  seance = await startSeanceServer()
})

test.afterAll(async () => {
  await seance?.stop()
})

test('take online prints and copies the share URL, and go offline preserves local text', async ({ page }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: BASE_SKETCH }))
  await waitForApp(page)

  await takeOnline(page)

  const status = page.locator('#online-session-status')
  const shareUrl = await status.locator('.hf-session-status-url').textContent()
  expect(shareUrl).toContain('seance=')
  expect(shareUrl).toContain(encodeURIComponent(SEANCE_SDK_URL))

  await status.locator('[data-action="copy-url"]').click()
  await expect.poll(() => page.evaluate(() => window.__clipboardText)).toBe(shareUrl)

  await setEditorText(page, PEER_SKETCH)
  await page.locator('#programMenuTitle').click()
  await page.locator('#goOfflineMenuItem').click()

  await expect(status).toBeHidden()
  await expect.poll(() => editorText(page)).toBe(PEER_SKETCH)
})

test('joins by session id, syncs editor typing, and displays the remote cursor', async ({ page, context }) => {
  const pageA = page
  const pageB = await context.newPage()
  await preparePage(pageA)
  await preparePage(pageB)

  await pageA.goto(appPath({ dsl: BASE_SKETCH }))
  await waitForApp(pageA)
  const sessionId = await takeOnline(pageA)

  await pageB.goto(appPath({ dsl: 'search synth\n\nsolid().write(o0)\n\nrender(o0)' }))
  await waitForApp(pageB)
  await joinById(pageB, sessionId)
  await expect.poll(() => editorText(pageB), { timeout: 15000 }).toBe(BASE_SKETCH)

  await setEditorText(pageA, PEER_SKETCH)
  await expect.poll(() => editorText(pageB), { timeout: 15000 }).toBe(PEER_SKETCH)

  await sendCursor(pageA, 0, 6)
  await expect.poll(
    () => pageB.evaluate(() => document.querySelectorAll('#dsl-editor .code-editor-remote-selection, #dsl-editor .code-editor-remote-cursor').length),
    { timeout: 15000 },
  ).toBeGreaterThan(0)
})

test('a printed share URL boots a second tab into the online session', async ({ page, context }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: SERVER_SKETCH }))
  await waitForApp(page)
  await takeOnline(page)

  const shareUrl = await page.locator('#online-session-status .hf-session-status-url').textContent()
  const joiner = await context.newPage()
  await preparePage(joiner)
  await joiner.goto(shareUrl)
  await waitForApp(joiner)

  await expect.poll(() => editorText(joiner), { timeout: 15000 }).toBe(SERVER_SKETCH)
  await expect(joiner.locator('#online-session-status')).toBeVisible()
})

test('?code= load resolves before ?seance= join, so the session snapshot wins', async ({ page, context }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: SERVER_SKETCH }))
  await waitForApp(page)
  const sessionId = await takeOnline(page)

  const joiner = await context.newPage()
  await preparePage(joiner)
  await joiner.route('https://sharing.noisedeck.app/api/composition/LOCAL1', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ title: 'Local code load', dsl: PEER_SKETCH, effects: [] }),
    })
  })
  await joiner.goto(appPath({ code: 'LOCAL1', seance: sessionId }))
  await waitForApp(joiner)

  await expect.poll(() => editorText(joiner), { timeout: 15000 }).toBe(SERVER_SKETCH)
})

test('invalid remote DSL updates the editor while keeping the last good render visible', async ({ page, context }) => {
  const pageA = page
  const pageB = await context.newPage()
  await preparePage(pageA)
  await preparePage(pageB)

  await pageA.goto(appPath({ dsl: BASE_SKETCH }))
  await waitForApp(pageA)
  const sessionId = await takeOnline(pageA)

  await pageB.goto(appPath({ dsl: PEER_SKETCH }))
  await waitForApp(pageB)
  await joinById(pageB, sessionId)
  await expect.poll(() => editorText(pageB), { timeout: 15000 }).toBe(BASE_SKETCH)

  const invalidDsl = 'this is not valid dsl @#%'
  await setEditorText(pageA, invalidDsl)

  await expect.poll(() => editorText(pageB), { timeout: 15000 }).toBe(invalidDsl)
  await expect(pageB.locator('#compiler-error')).toBeVisible({ timeout: 15000 })
  await expect(pageB.locator('#canvas')).toHaveClass(/visible/)
})

async function preparePage(page) {
  await routeHandfishLocal(page)
  await routeSeanceSdkLocal(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text) { window.__clipboardText = text },
        async readText() { return window.__clipboardText || '' },
      },
    })
  })
}

function appPath(params = {}) {
  const url = new URL('/', 'http://localhost:3017')
  url.searchParams.set('seanceUrl', seance.url)
  url.searchParams.set('seanceSdk', SEANCE_SDK_URL)
  if (params.dsl) url.searchParams.set('dsl', params.dsl)
  if (params.code) url.searchParams.set('code', params.code)
  if (params.seance) url.searchParams.set('seance', params.seance)
  return `${url.pathname}${url.search}`
}

async function waitForApp(page) {
  try {
    await page.waitForFunction(() => (
      Boolean(window.__poly?.renderer)
      && Boolean(document.getElementById('tempo-bar')?.scheduler)
      && Boolean(document.getElementById('dsl-editor')?.value)
    ), null, { timeout: 30000 })
  } catch (error) {
    const diag = await page.evaluate(() => ({
      href: window.location.href,
      hasPoly: Boolean(window.__poly),
      hasRenderer: Boolean(window.__poly?.renderer),
      error: document.getElementById('error')?.textContent || '',
      compilerError: document.getElementById('compiler-error')?.textContent || '',
      loadingVisible: document.getElementById('loading')?.classList.contains('visible'),
    })).catch(() => ({}))
    throw new Error(`${error.message}\n${JSON.stringify(diag, null, 2)}`)
  }
}

async function takeOnline(page) {
  await page.locator('#programMenuTitle').click()
  await page.locator('#takeOnlineMenuItem').click()
  const status = page.locator('#online-session-status')
  await expect(status).toBeVisible({ timeout: 15000 })
  await expect(status).toContainText('Online')
  const sessionId = await status.evaluate((el) => el.sessionId)
  expect(sessionId).toMatch(/^[A-Za-z0-9]{6}$/)
  return sessionId
}

async function joinById(page, sessionId) {
  await page.locator('#programMenuTitle').click()
  await page.locator('#joinSessionMenuItem').click()
  const dialog = page.locator('#join-session-dialog dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('input[name="sessionId"]').fill(sessionId)
  await dialog.locator('button[type="submit"]').click()
  await expect(page.locator('#online-session-status')).toBeVisible({ timeout: 15000 })
}

async function editorText(page) {
  return page.evaluate(() => document.getElementById('dsl-editor')?.value || '')
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

async function sendCursor(page, start, end) {
  await page.evaluate(({ start, end }) => {
    const editor = document.getElementById('dsl-editor')
    editor?.setSelectionRange?.(start, end, 'forward')
    editor?.dispatchEvent(new CustomEvent('selectionchange', {
      bubbles: true,
      composed: true,
      detail: { start, end, direction: 'forward' },
    }))
  }, { start, end })
}
