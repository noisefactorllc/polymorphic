import { test, expect } from '@playwright/test'
import { routeHandfishLocal } from './handfishLocal.js'
import { routePortableImagesLocal } from './portableImagesLocal.js'
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
const ONLINE_FEATURE = 'onlineCollaboration'

test.describe.configure({ mode: 'serial' })
test.skip(!hasLocalSeanceHarness(), 'requires local Seance SDK/server harness; set SEANCE_SDK_DIR and SEANCE_PYTHON')

test.beforeAll(async () => {
  seance = await startSeanceServer()
})

test.afterAll(async () => {
  await seance?.stop()
})

test('online collaboration is available by default without any feature flag', async ({ page, context }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: BASE_SKETCH, online: false }))
  await waitForApp(page)

  // The entry point is present without ?features=, and the dialog stays
  // closed until the user opens it.
  await page.locator('#programMenuTitle').click()
  await expect(page.locator('#goOnlineMenuItem')).toBeVisible()
  await expect(page.locator('#onlineCollabMenuSeparator')).toBeVisible()
  await expect(page.locator('#seanceDialog dialog')).toBeHidden()
  await page.locator('#programMenuTitle').click()

  // And it fully works with no flag: take online, then a second flag-less
  // ?seance= tab joins and converges.
  const sessionId = await takeOnline(page)
  const joiner = await context.newPage()
  await preparePage(joiner)
  await joiner.goto(appPath({ online: false, seance: sessionId }))
  await waitForApp(joiner)
  await expect.poll(() => editorText(joiner), { timeout: 15000 }).toBe(BASE_SKETCH)
})

test('take online prints and copies the share URL, and go offline preserves local text', async ({ page }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: BASE_SKETCH }))
  await waitForApp(page)

  await takeOnline(page)

  const dialog = page.locator('#seanceDialog')
  const shareUrl = await dialog.locator('.hf-seance-url').inputValue()
  expect(shareUrl).toContain('seance=')
  expect(shareUrl).toContain(`features=${ONLINE_FEATURE}`)
  expect(shareUrl).toContain(encodeURIComponent(SEANCE_SDK_URL))

  await dialog.locator('[data-action="copy-url"]').click()
  await expect.poll(() => page.evaluate(() => window.__clipboardText)).toBe(shareUrl)

  // Close the modal to reach the editor, make a local edit, then reopen and go
  // offline — the local text must survive the disconnect.
  await closeDialog(page)
  await setEditorText(page, PEER_SKETCH)
  await openDialog(page)
  await dialog.locator('[data-action="go-offline"]').click()
  await expect(dialog.locator('.hf-seance-status-text')).toHaveText('Offline')

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

  const shareUrl = await page.locator('#seanceDialog .hf-seance-url').inputValue()
  const joiner = await context.newPage()
  await preparePage(joiner)
  await joiner.goto(shareUrl)
  await waitForApp(joiner)

  await expect.poll(() => editorText(joiner), { timeout: 15000 }).toBe(SERVER_SKETCH)
  await openDialog(joiner)
  await expect(joiner.locator('#seanceDialog .hf-seance-status-text')).toHaveText('Online')
})

test('?code= load resolves before ?seance= join, so the session snapshot wins', async ({ page, context }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: SERVER_SKETCH }))
  await waitForApp(page)
  const sessionId = await takeOnline(page)

  const joiner = await context.newPage()
  await preparePage(joiner)
  await joiner.route('https://sharing.noisedeck.app/api/composition/LOCAL1?images=files', async (route) => {
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

test('remote text received during a delayed compile reaches the renderer and controls', async ({ page, context }) => {
  await preparePage(page)
  await page.goto(appPath({ dsl: BASE_SKETCH }))
  await waitForApp(page)
  const sessionId = await takeOnline(page)
  const guest = await context.newPage()
  await preparePage(guest)
  await guest.goto(appPath({ seance: sessionId }))
  await waitForApp(guest)
  await expect.poll(() => guest.evaluate(() => window.__poly.renderer.canvasRenderer.currentDsl), { timeout: 30000 }).toBe(BASE_SKETCH)
  await guest.evaluate(() => {
    const renderer = window.__poly.renderer
    const compile = renderer.compile.bind(renderer)
    window.__compileCalls = []
    renderer.compile = async text => {
      window.__compileCalls.push(text)
      if (window.__compileCalls.length === 1) {
        await new Promise(resolve => { window.__releaseCompile = resolve })
      }
      return compile(text)
    }
  })
  await setEditorText(page, PEER_SKETCH)
  await guest.waitForFunction(() => !!window.__releaseCompile)
  await setEditorText(page, SERVER_SKETCH)
  await expect.poll(() => editorText(guest), { timeout: 15000 }).toBe(SERVER_SKETCH)
  await guest.evaluate(() => window.__releaseCompile())
  await expect.poll(() => guest.evaluate(() => window.__poly.renderer.canvasRenderer.currentDsl), { timeout: 30000 }).toBe(SERVER_SKETCH)
  await expect.poll(() => guest.evaluate(() => window.__compileCalls.length)).toBe(2)
  expect(await editorText(guest)).toBe(SERVER_SKETCH)
  expect(await guest.evaluate(() => window.__poly.programState.toDsl())).toContain('80')
})

test('image seed and later replacement reach another client with original bytes and rendered pixels', async ({ page, browser }) => {
  test.setTimeout(120000)
  await preparePage(page)
  await page.goto(appPath({ dsl: 'search synth\nmedia().write(o0)\nrender(o0)' }))
  await waitForApp(page)
  const sources = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 3; canvas.height = 2
    const context = canvas.getContext('2d')
    return ['#ff0000', '#00ff00', '#0000ff'].map(color => {
      context.fillStyle = color; context.fillRect(0, 0, 3, 2)
      return canvas.toDataURL('image/png')
    })
  })
  const dsl = `search synth\nmedia(url: "${sources[0]}").write(o0)\nmedia(url: "${sources[1]}").write(o1)\nrender(o0)`
  await setEditorText(page, dsl)
  await expect.poll(() => imagePixel(page)).toEqual([255, 0, 0, 255])
  const sessionId = await takeOnline(page)
  await closeDialog(page)
  // Another client is another browser: it shares no image storage with the
  // host, so every image it shows arrives through the session.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await preparePage(guest)
  await guest.goto(appPath({ dsl: 'search synth\nmedia().write(o0)\nrender(o0)' }))
  await waitForApp(guest)
  await guest.evaluate(async () => {
    const panel = window.__poly.liveInputsPanel
    const source = document.createElement('canvas')
    source.width = source.height = 16
    source.getContext('2d').fillRect(0, 0, 16, 16)
    panel._currentStream = source.captureStream(30)
    panel._videoEl.srcObject = panel._currentStream
    await panel._videoEl.play()
    panel._startTextureLoop(panel._videoEl)
  })
  await joinById(guest, sessionId)
  await closeDialog(guest)
  await expect.poll(() => guest.evaluate(() => window.__poly.liveInputsPanel.hasLiveMedia)).toBe(false)
  await expect.poll(() => imagePixel(guest), { timeout: 30000 }).toEqual([255, 0, 0, 255])
  await expect.poll(() => guest.evaluate(() => window.__poly.renderer.images.map(image => image.dataUrl).sort())).toEqual(sources.slice(0, 2).sort())
  expect(await editorText(guest)).not.toContain('data:')
  await setEditorText(page, (await editorText(page)).replace('render(o0)', 'render(o1)'))
  await expect.poll(() => imagePixel(guest), { timeout: 30000 }).toEqual([0, 255, 0, 255])
  await guest.keyboard.press('Control+Shift+Digit1')
  await expect(guest.locator('.polymorphic-toast')).toContainText('Saved scene 1')
  await guest.evaluate(async () => (await import('/js/programModal.js')).openProgramModal('save'))
  await guest.fill('#programNameInput', 'Image save boundary')
  await guest.click('#programSaveBtn')
  await expect(guest.locator('.polymorphic-toast')).toContainText('Saved program')
  const saved = await guest.evaluate(() => ({ scene:localStorage.getItem('polymorphic-scenes'), program:localStorage.getItem('polymorphic-programs') }))
  let releaseImage, imageRequested = false
  const download = new Promise(resolve => { releaseImage = resolve })
  await guest.route('**/v1/sessions/*/images/*', async route => {
    imageRequested = true
    await download
    await route.continue()
  })
  const next = (await editorText(page)).replace(/media\(url: "image:[a-f0-9]+"\)/, `media(url: "${sources[2]}")`).replace('render(o1)', 'render(o0)')
  await setEditorText(page, next)
  try {
    await expect.poll(() => imageRequested, { timeout:30000 }).toBe(true)
    await guest.keyboard.press('Control+Shift+Digit1')
    await expect(guest.locator('.polymorphic-toast')).toContainText('Could not save scene')
    await guest.evaluate(async () => (await import('/js/programModal.js')).openProgramModal('save'))
    await guest.fill('#programNameInput', 'Image save boundary')
    await guest.check('#programOverwriteCheckbox')
    await guest.click('#programSaveBtn')
    await expect(guest.locator('.polymorphic-toast')).toContainText('Could not save program')
    expect(await guest.evaluate(() => ({ scene:localStorage.getItem('polymorphic-scenes'), program:localStorage.getItem('polymorphic-programs') }))).toEqual(saved)
    await guest.keyboard.press('Escape')
  } finally {
    releaseImage()
  }
  await expect.poll(() => imagePixel(guest), { timeout: 30000 }).toEqual([0, 0, 255, 255])
  expect(await guest.evaluate(() => window.__poly.renderer.images.map(image => image.dataUrl))).toContain(sources[2])
  const reshared = await guest.evaluate(async () => {
    const helper = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
    return helper.prepareImagesForShare(document.getElementById('dsl-editor').value, window.__poly.renderer.images)
  })
  expect(reshared.images.map(image => image.dataUrl).sort()).toEqual(sources.slice(1).sort())
  await guestContext.close()
})

async function imagePixel(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d'); context.drawImage(document.getElementById('canvas'), 0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  })
}

async function preparePage(page) {
  await routeHandfishLocal(page)
  await routeSeanceSdkLocal(page)
  await routePortableImagesLocal(page)
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
  if (params.online !== false) url.searchParams.set('features', ONLINE_FEATURE)
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

async function openDialog(page) {
  await page.locator('#programMenuTitle').click()
  await page.locator('#goOnlineMenuItem').click()
  await expect(page.locator('#seanceDialog dialog')).toBeVisible()
}

async function closeDialog(page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('#seanceDialog dialog')).toBeHidden()
}

async function takeOnline(page) {
  await openDialog(page)
  await page.locator('#seanceDialog [data-action="take-online"]').click()
  const status = page.locator('#seanceDialog .hf-seance-status-text')
  await expect(status).toHaveText('Online', { timeout: 15000 })
  const sessionId = await page.locator('#seanceDialog').evaluate((el) => el.sessionId)
  expect(sessionId).toMatch(/^[A-Za-z0-9]{6}$/)
  return sessionId
}

async function joinById(page, sessionId) {
  await openDialog(page)
  const dialog = page.locator('#seanceDialog')
  await dialog.locator('.hf-seance-join-input').fill(sessionId)
  await dialog.locator('[data-action="join"]').click()
  await expect(dialog.locator('.hf-seance-status-text')).toHaveText('Online', { timeout: 15000 })
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
