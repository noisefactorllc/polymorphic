import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

// Sharing sends images as files, end to end, against a real sharing server.
// The server comes from a sharing checkout (SHARING_CHECKOUT, or ../sharing
// beside this repository) and runs on a free local port with temporary data
// and image directories. Every https://sharing.noisedeck.app request from the
// page goes to it. The suite is skipped when no sharing checkout is present.

const checkout = path.resolve(process.env.SHARING_CHECKOUT || '../sharing')
const serverEntry = path.join(checkout, 'server', 'index.js')
test.skip(!existsSync(serverEntry), `no sharing checkout at ${checkout}`)

function crc32(bytes) {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** A 16x16 RGB PNG of one color. */
function png(rgb, size = 16) {
  const row = Buffer.alloc(size * 3 + 1)
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

const RED = png([255, 0, 0])
const GREEN = png([0, 255, 0])
const RED_PIXEL = [255, 0, 0, 255]
const GREEN_PIXEL = [0, 255, 0, 255]
const YELLOW_PIXEL = [255, 255, 0, 255]
const PLAIN = 'search synth\nsolid(color: #ffff00).write(o0)\nrender(o0)'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const TEXT_IMAGE = /base64|data:image|dataUrl/

let server, local, dataDir, imagesDir, serverLog = ''

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

test.beforeAll(async () => {
  const port = await freePort()
  local = `http://127.0.0.1:${port}`
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polymorphic-share-data-'))
  imagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'polymorphic-share-images-'))
  server = spawn(process.execPath, [serverEntry], {
    cwd: checkout,
    env: { ...process.env, PORT: String(port), BASE_URL: 'https://sharing.noisedeck.app', SHARING_DATA_DIR: dataDir, SHARING_IMAGES_DIR: imagesDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', data => { serverLog += data })
  server.stderr.on('data', data => { serverLog += data })
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await fetch(`${local}/api/health`).then(response => response.ok).catch(() => false)) return
    if (server.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`The local sharing server did not start:\n${serverLog}`)
})

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
  }
  for (const dir of [dataDir, imagesDir]) if (dir) await fs.rm(dir, { recursive: true, force: true })
})

/** Send every sharing.noisedeck.app request to the local server, and record what was sent. */
async function routeSharing(page, sent = []) {
  await page.route('https://sharing.noisedeck.app/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    sent.push({ method: request.method(), path: url.pathname, type: request.headers()['content-type'] || '', body: request.postDataBuffer() })
    const response = await route.fetch({ url: `${local}${url.pathname}${url.search}` })
    const origin = new URL(page.url()).origin
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } })
  })
  return sent
}

async function boot(page, query) {
  await page.goto(`/?${query}`)
  await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true && Boolean(window.__poly.programState), null, { timeout: 30000 })
}

/** The whole output canvas averaged into one pixel. */
async function outputPixel(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(document.getElementById('canvas'), 0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  })
}

async function dropImage(page, bytes, name) {
  await page.evaluate(({ bytes, name }) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  }, { bytes: Array.from(bytes), name })
}

const editorText = page => page.evaluate(() => document.getElementById('dsl-editor').value)
const storedFile = (dir, name) => fs.readFile(path.join(dir, name.slice(0, 2), name))

/** Open a share in a fresh browser context, as someone else would. */
async function openFresh(browser, open) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const sent = await routeSharing(page)
  try {
    await open(page)
    return { page, context, errors, sent }
  } catch (error) {
    await context.close()
    throw error
  }
}

test('a dropped image is shared as files and reopens in a fresh browser as the same image', async ({ page, browser }) => {
  test.setTimeout(180000)
  const sent = await routeSharing(page)
  await boot(page, `dsl=${encodeURIComponent(PLAIN)}`)
  await expect.poll(() => outputPixel(page)).toEqual(YELLOW_PIXEL)
  await dropImage(page, RED, 'red.png')
  await expect.poll(() => editorText(page)).toContain(`image:${digest(RED)}`)
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)

  // Share through the share dialog.
  const shared = page.waitForResponse(response => response.url() === 'https://sharing.noisedeck.app/api/embed/shorten')
  await page.evaluate(() => document.getElementById('shareProgram').click())
  await page.fill('#share-title', 'Red image')
  await page.click('#share-submit-btn')
  const result = await (await shared).json()
  await expect(page.locator('#share-url')).toHaveValue(`https://sharing.noisedeck.app/s/${result.code}`)
  expect(result.imageCount).toBe(1)

  // The image and the screenshot went up as raw files; nothing went as text.
  const posts = sent.filter(request => request.method === 'POST')
  expect(posts.map(request => `${request.path} ${request.type}`)).toEqual([
    '/api/images image/png',
    '/api/images image/jpeg',
    '/api/embed/shorten application/json',
  ])
  expect(posts[0].body?.equals(RED)).toBe(true)
  expect([...(posts[1].body ?? []).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  for (const request of posts) expect(request.body.toString('latin1')).not.toMatch(TEXT_IMAGE)
  const payload = JSON.parse(posts[2].body.toString('utf8'))
  expect(Object.keys(payload).sort()).toEqual(['description', 'dsl', 'effects', 'screenshot', 'title'])
  // The program as the editor holds it, naming the image by the id the upload returned.
  expect(payload.dsl).toBe(await editorText(page))
  expect(payload.dsl).toContain(`media(url: "image:${digest(RED)}")`)
  expect(payload.screenshot).toMatch(/^[a-f0-9]{64}$/)

  // The server stored the image file and a JPEG screenshot, and no image as text.
  expect((await storedFile(imagesDir, digest(RED))).equals(RED)).toBe(true)
  const screenshot = await storedFile(imagesDir, payload.screenshot)
  expect(screenshot.equals(posts[1].body)).toBe(true)
  const copied = await fs.readFile(path.join(dataDir, result.code.slice(0, 2), `${result.code}.jpg`))
  expect(copied.equals(screenshot)).toBe(true)
  const entry = await fs.readFile(path.join(dataDir, result.code.slice(0, 2), `${result.code}.json`), 'utf8')
  expect(entry).not.toMatch(TEXT_IMAGE)
  expect(JSON.parse(entry).images.map(image => image.id)).toEqual([digest(RED)])

  // Opened with ?code= in a fresh browser, the program shows the red image, not the default.
  const opened = await openFresh(browser, page => boot(page, `code=${result.code}`))
  try {
    await expect.poll(() => outputPixel(opened.page), { timeout: 30000 }).toEqual(RED_PIXEL)
    expect(await editorText(opened.page)).toContain(`image:${digest(RED)}`)
    const reads = opened.sent.filter(request => request.method === 'GET' && /^\/api\/(composition|images)\//.test(request.path)).map(request => request.path)
    expect(reads).toEqual([`/api/composition/${result.code}`, `/api/images/${digest(RED)}`])
    expect(opened.errors).toEqual([])
  } finally {
    await opened.context.close()
  }
})

test('a share made by noisedeck, with images uploaded as files, opens with its images', async ({ browser }) => {
  test.setTimeout(180000)
  // Noisedeck uploads each image file and the screenshot, then sends the ids.
  const upload = async (bytes, type) => {
    const response = await fetch(`${local}/api/images`, { method: 'POST', headers: { 'Content-Type': type }, body: bytes })
    expect(response.ok).toBe(true)
    return response.json()
  }
  const image = await upload(GREEN, 'image/png')
  expect(image.id).toBe(digest(GREEN))
  // Its screenshot is a canvas JPEG, as noisedeck's is.
  const encoder = await browser.newContext()
  const jpeg = Buffer.from(await (await encoder.newPage()).evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 63
    const context = canvas.getContext('2d')
    context.fillStyle = '#00ff00'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }))
  await encoder.close()
  const screenshot = await upload(jpeg, 'image/jpeg')
  const dsl = `search synth\n\nmedia(url: "image:${image.id}")\n  .write(o0)\n\nrender(o0)`
  const response = await fetch(`${local}/api/embed/shorten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsl, title: 'Noisedeck image', description: 'Created with Noisedeck', screenshot: screenshot.id }),
  })
  const result = await response.json()
  expect(response.ok, JSON.stringify(result)).toBe(true)
  expect(result.imageCount).toBe(1)
  const copied = await fs.readFile(path.join(dataDir, result.code.slice(0, 2), `${result.code}.jpg`))
  expect(copied.equals(jpeg)).toBe(true)

  // Opened by its code.
  const byCode = await openFresh(browser, page => boot(page, `code=${result.code}`))
  try {
    await expect.poll(() => outputPixel(byCode.page), { timeout: 30000 }).toEqual(GREEN_PIXEL)
    expect(byCode.errors).toEqual([])
  } finally {
    await byCode.context.close()
  }

  // Imported from its share URL.
  const imported = await openFresh(browser, page => boot(page, `dsl=${encodeURIComponent(PLAIN)}`))
  try {
    await expect.poll(() => outputPixel(imported.page)).toEqual(YELLOW_PIXEL)
    await imported.page.evaluate(() => document.getElementById('importFromUrlMenuItem').click())
    await imported.page.fill('.import-url-input', `https://sharing.noisedeck.app/s/${result.code}`)
    await imported.page.click('.import-url-btn-primary')
    await expect.poll(() => editorText(imported.page)).toContain(`image:${image.id}`)
    await expect.poll(() => outputPixel(imported.page), { timeout: 30000 }).toEqual(GREEN_PIXEL)
    expect(imported.errors).toEqual([])
  } finally {
    await imported.context.close()
  }

  // Picked from the NoiseBLASTER! gallery.
  const picked = await openFresh(browser, async page => {
    await page.route('https://blaster.noisedeck.app/api/feed*', route => route.fulfill({
      json: { compositions: [{ code: result.code, title: 'Noisedeck image', app: 'noisedeck', createdAt: Date.now() }] },
      headers: { 'access-control-allow-origin': '*' },
    }))
    await boot(page, `dsl=${encodeURIComponent(PLAIN)}`)
  })
  try {
    await expect.poll(() => outputPixel(picked.page)).toEqual(YELLOW_PIXEL)
    await picked.page.evaluate(() => window.__poly.gallery.open())
    await picked.page.click('.gallery-tab[data-tab="blaster"]')
    await picked.page.locator('.gallery-card', { hasText: 'Noisedeck image' }).click()
    await expect.poll(() => editorText(picked.page)).toContain(`image:${image.id}`)
    await expect.poll(() => outputPixel(picked.page), { timeout: 30000 }).toEqual(GREEN_PIXEL)
    expect(picked.errors).toEqual([])
  } finally {
    await picked.context.close()
  }
})

test('"edit in Noisedeck" shares the image as files, and the share opens with its image', async ({ page, browser }) => {
  test.setTimeout(180000)
  const sent = await routeSharing(page)
  await page.context().route('https://noisedeck.app/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>noisedeck</title>' }))
  await boot(page, `dsl=${encodeURIComponent(PLAIN)}`)
  await dropImage(page, GREEN, 'green.png')
  await expect.poll(() => outputPixel(page)).toEqual(GREEN_PIXEL)

  const popup = page.waitForEvent('popup')
  await page.evaluate(() => document.getElementById('editInNoisedeckMenuItem').click())
  const opened = await popup
  const code = new URL(opened.url()).searchParams.get('code')
  await opened.close()
  expect(code).toMatch(/^[A-Za-z0-9_-]+$/)

  const posts = sent.filter(request => request.method === 'POST')
  expect(posts.map(request => `${request.path} ${request.type}`)).toEqual([
    '/api/images image/png',
    '/api/images image/jpeg',
    '/api/embed/shorten application/json',
  ])
  expect(posts[0].body.equals(GREEN)).toBe(true)
  for (const request of posts) expect(request.body.toString('latin1')).not.toMatch(TEXT_IMAGE)
  const payload = JSON.parse(posts[2].body.toString('utf8'))
  expect(payload).not.toHaveProperty('images')
  expect(payload.dsl).toContain(`media(url: "image:${digest(GREEN)}")`)
  expect((await storedFile(imagesDir, digest(GREEN))).equals(GREEN)).toBe(true)
  expect((await fs.readFile(path.join(dataDir, code.slice(0, 2), `${code}.jpg`))).equals(posts[1].body)).toBe(true)

  const reopened = await openFresh(browser, page => boot(page, `code=${code}`))
  try {
    await expect.poll(() => outputPixel(reopened.page), { timeout: 30000 }).toEqual(GREEN_PIXEL)
    expect(reopened.errors).toEqual([])
  } finally {
    await reopened.context.close()
  }
})
