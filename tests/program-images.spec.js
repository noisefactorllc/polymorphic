import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { routePortableImagesLocal } from './portableImagesLocal.js'

// Images are files in IndexedDB, keyed by the SHA-256 of their bytes. The
// programs, scenes and snapshot history in localStorage name them only as
// `image:<sha256>`, and those saved with images as base64 text move them to
// IndexedDB when the app loads.

test.beforeEach(async ({ page }) => routePortableImagesLocal(page))

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

/** An RGB PNG of one color, under `noiseRows` rows of random pixels that set its size. */
function png(rgb, { width = 16, height = 16, noiseRows = 0 } = {}) {
  const stride = width * 3 + 1
  const solid = Buffer.alloc(width * 3)
  for (let x = 0; x < width; x++) solid.set(rgb, x * 3)
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) (y < noiseRows ? randomBytes(width * 3) : solid).copy(raw, y * stride + 1)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const RED = png([255, 0, 0])
const GREEN = png([0, 255, 0])
const BLUE = png([0, 0, 255])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const text = bytes => `data:image/png;base64,${bytes.toString('base64')}`
const program = url => `search synth\nmedia(url: "${url}").write(o0)\nrender(o0)`
const PLAIN = 'search synth\nsolid(color: #ffff00).write(o0)\nrender(o0)'
const OTHER = 'search synth\nsolid(color: #ff00ff).write(o0)\nrender(o0)'
const KEYS = ['polymorphic-programs', 'polymorphic-scenes', 'polymorphic-snapshot-history']

/** localStorage as older versions left it, images as base64 text. */
function legacySeed({ big = [] } = {}) {
  const listed = image => [{ id: digest(image), dataUrl: text(image) }]
  const programs = {
    'Text image': { name: 'Text image', dsl: program(text(RED)), images: [], savedAt: 1 },
    'Listed image': { name: 'Listed image', dsl: program(`image:${digest(GREEN)}`), images: listed(GREEN), savedAt: 2 },
    'Plain': { name: 'Plain', dsl: PLAIN, images: [], savedAt: 3 },
  }
  const scenes = { 1: { dsl: program(`image:${digest(GREEN)}`), images: listed(GREEN) }, 2: program(text(RED)), 3: PLAIN }
  const entries = [{ dsl: program(text(RED)), time: 1 }, { dsl: PLAIN, time: 2 }]
  if (big.length) {
    programs['Big text'] = { name: 'Big text', dsl: program(text(big[0])), images: [], savedAt: 4 }
    programs['Big listed'] = { name: 'Big listed', dsl: program(`image:${digest(big[1])}`), images: listed(big[1]), savedAt: 5 }
    scenes[4] = { dsl: program(`image:${digest(big[2])}`), images: listed(big[2]) }
    entries.unshift({ dsl: program(text(big[3])), time: 0 })
  }
  return {
    'polymorphic-programs': JSON.stringify(programs),
    'polymorphic-scenes': JSON.stringify(scenes),
    'polymorphic-snapshot-history': JSON.stringify({ entries, cursor: entries.length - 1 }),
  }
}

/**
 * Write `seed` into localStorage from a same-origin page that does not run
 * the app, and report whether a further 400,000 characters, an image saved as
 * text, would still fit.
 */
async function seedStorage(page, seed) {
  await page.goto('/data/examples.json')
  return page.evaluate(seed => {
    localStorage.clear()
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
    try {
      localStorage.setItem('quota-probe', 'x'.repeat(400_000))
      localStorage.removeItem('quota-probe')
      return 'fits'
    } catch (error) {
      return error.name
    }
  }, seed)
}

async function boot(page, dsl) {
  await page.goto(`/?dsl=${encodeURIComponent(dsl)}`)
  await page.waitForFunction(() => window.__poly?.renderer?.isRunning === true && Boolean(window.__poly.programState), null, { timeout: 30000 })
}

const storedText = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), KEYS)
const storageChars = page => page.evaluate(() => Object.keys(localStorage).reduce((sum, key) => sum + key.length + localStorage.getItem(key).length, 0))
const editorText = page => page.evaluate(() => document.getElementById('dsl-editor').value)

/** The bytes of the image IndexedDB holds under `id`, or null. */
async function storedImage(page, id) {
  return page.evaluate(async id => {
    const { getProgramImage } = await import('/js/programImages.js')
    const blob = await getProgramImage(id)
    return blob && { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }
  }, id)
}

/** Size and SHA-256 of the image IndexedDB holds under `id`, or null. */
async function storedImageDigest(page, id) {
  return page.evaluate(async id => {
    const { getProgramImage, imageId } = await import('/js/programImages.js')
    const blob = await getProgramImage(id)
    return blob && { size: blob.size, id: await imageId(blob) }
  }, id)
}

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

async function saveProgram(page, name) {
  await page.evaluate(async () => (await import('/js/programModal.js')).openProgramModal('save'))
  await page.fill('#programNameInput', name)
  await page.click('#programSaveBtn')
  await expect(page.locator('.polymorphic-toast')).toHaveText(`Saved program "${name}"`)
}

async function loadProgram(page, name) {
  await page.evaluate(async () => (await import('/js/programModal.js')).openProgramModal('load'))
  await page.selectOption('#programLoadSelect', name)
  await page.click('#programLoadBtn')
}

/** Recall a scene by its bare digit, with no text field focused. */
async function recallScene(page, slot) {
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press(String(slot))
  await expect(page.locator('.polymorphic-toast')).toHaveText(`Loaded scene ${slot}`)
}

async function showColor(page, dsl, pixel) {
  await page.evaluate(dsl => {
    const editor = document.getElementById('dsl-editor')
    editor.value = dsl
    editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  }, dsl)
  await expect.poll(() => outputPixel(page)).toEqual(pixel)
}

const RED_PIXEL = [255, 0, 0, 255]
const GREEN_PIXEL = [0, 255, 0, 255]
const BLUE_PIXEL = [0, 0, 255, 255]
const YELLOW_PIXEL = [255, 255, 0, 255]
const MAGENTA_PIXEL = [255, 0, 255, 255]

test('a dropped image is a file in IndexedDB that programs, scenes and history name by reference', async ({ page }) => {
  test.setTimeout(120000)
  await boot(page, PLAIN)
  await dropImage(page, RED, 'red.png')
  const reference = `image:${digest(RED)}`
  await expect.poll(() => editorText(page)).toContain(reference)
  expect(await editorText(page)).not.toContain('data:')
  expect(await storedImage(page, digest(RED))).toEqual({ type: 'image/png', bytes: Array.from(RED) })
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  // The successful compile is recorded in snapshot history.
  await expect.poll(async () => (await storedText(page))['polymorphic-snapshot-history']).toContain(reference)

  await page.keyboard.press('Control+Shift+Digit2')
  await expect(page.locator('.polymorphic-toast')).toHaveText('Saved scene 2')
  await saveProgram(page, 'Red image')
  const saved = await storedText(page)
  for (const value of Object.values(saved)) expect(value).not.toContain('data:image')
  const savedProgram = JSON.parse(saved['polymorphic-programs'])['Red image']
  expect(Object.keys(savedProgram).sort()).toEqual(['dsl', 'name', 'savedAt'])
  expect(savedProgram.dsl).toContain(reference)
  expect(JSON.parse(saved['polymorphic-scenes'])[2]).toContain(reference)
  // A later program, so that stepping back after the reload reaches the image.
  await showColor(page, OTHER, MAGENTA_PIXEL)
  await expect.poll(async () => JSON.parse((await storedText(page))['polymorphic-snapshot-history']).entries.at(-1).dsl).toBe(OTHER)

  // Each surface reads the image back from IndexedDB in a fresh page.
  await boot(page, PLAIN)
  await expect.poll(() => outputPixel(page)).toEqual(YELLOW_PIXEL)
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect.poll(() => editorText(page)).toContain(reference)
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await showColor(page, PLAIN, YELLOW_PIXEL)
  await loadProgram(page, 'Red image')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await showColor(page, PLAIN, YELLOW_PIXEL)
  await recallScene(page, 2)
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  for (const value of Object.values(await storedText(page))) expect(value).not.toContain('data:image')
})

test('sharing uploads a stored image and the screenshot as files and sends their ids, never base64', async ({ page }) => {
  test.setTimeout(120000)
  const payloads = [], uploads = [], bodies = []
  const JPEG_ID = 'f'.repeat(64)
  page.on('request', request => {
    if (request.url().startsWith('https://sharing.noisedeck.app/api/')) bodies.push(request.postDataBuffer()?.toString('latin1') || '')
  })
  await page.route('https://sharing.noisedeck.app/api/images', async route => {
    const request = route.request()
    const bytes = request.postDataBuffer()
    const type = request.headers()['content-type']
    uploads.push({ type, bytes })
    await route.fulfill({ status: 201, json: { id: type === 'image/png' ? digest(bytes) : JPEG_ID, url: 'unused', mimeType: type, width: 1, height: 1 } })
  })
  await page.route('https://sharing.noisedeck.app/api/embed/shorten', async route => {
    payloads.push(route.request().postDataJSON())
    await route.fulfill({ json: { shortUrl: 'https://sharing.noisedeck.app/test' } })
  })
  const share = async () => {
    await page.evaluate(() => document.getElementById('shareProgram').click())
    await page.click('#share-submit-btn')
    await expect(page.locator('#share-url')).toHaveValue('https://sharing.noisedeck.app/test')
    await page.keyboard.press('Escape')
  }
  // A freshly dropped image, then the same image read back from IndexedDB.
  await boot(page, PLAIN)
  await dropImage(page, RED, 'red.png')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await share()
  await saveProgram(page, 'Shared image')
  await boot(page, PLAIN)
  await loadProgram(page, 'Shared image')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await share()
  expect(payloads).toHaveLength(2)
  for (const payload of payloads) {
    expect(payload.dsl).toContain(`image:${digest(RED)}`)
    expect(payload.dsl).not.toContain('data:')
    expect(payload).not.toHaveProperty('images')
    expect(payload.screenshot).toBe(JPEG_ID)
  }
  // Each share uploads the image file and a JPEG screenshot file.
  expect(uploads.map(upload => upload.type)).toEqual(['image/png', 'image/jpeg', 'image/png', 'image/jpeg'])
  for (const upload of uploads.filter(upload => upload.type === 'image/png')) expect(upload.bytes.equals(RED)).toBe(true)
  for (const upload of uploads.filter(upload => upload.type === 'image/jpeg')) expect([...upload.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8])
  expect(bodies.length).toBeGreaterThanOrEqual(6)
  for (const body of bodies) expect(body).not.toMatch(/base64|data:image|dataUrl/)
})

test('programs, scenes and history saved with images as text move them to IndexedDB on load', async ({ page }) => {
  test.setTimeout(120000)
  expect(await seedStorage(page, legacySeed())).toBe('fits')
  await boot(page, PLAIN)
  await expect.poll(async () => Object.values(await storedText(page)).join('\n')).not.toContain('data:image')

  const stored = await storedText(page)
  expect(JSON.parse(stored['polymorphic-programs'])).toEqual({
    'Text image': { name: 'Text image', dsl: program(`image:${digest(RED)}`), savedAt: 1 },
    'Listed image': { name: 'Listed image', dsl: program(`image:${digest(GREEN)}`), savedAt: 2 },
    'Plain': { name: 'Plain', dsl: PLAIN, images: [], savedAt: 3 },
  })
  expect(JSON.parse(stored['polymorphic-scenes'])).toEqual({
    1: program(`image:${digest(GREEN)}`),
    2: program(`image:${digest(RED)}`),
    3: PLAIN,
  })
  expect(JSON.parse(stored['polymorphic-snapshot-history'])).toEqual({
    entries: [{ dsl: program(`image:${digest(RED)}`), time: 1 }, { dsl: PLAIN, time: 2 }],
    cursor: 1,
  })
  expect(await storedImage(page, digest(RED))).toEqual({ type: 'image/png', bytes: Array.from(RED) })
  expect(await storedImage(page, digest(GREEN))).toEqual({ type: 'image/png', bytes: Array.from(GREEN) })

  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await loadProgram(page, 'Listed image')
  await expect.poll(() => outputPixel(page)).toEqual(GREEN_PIXEL)
  await loadProgram(page, 'Text image')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await recallScene(page, 1)
  await expect.poll(() => outputPixel(page)).toEqual(GREEN_PIXEL)
})

test('a full localStorage is freed on load, and an image program saves and reloads', async ({ page }) => {
  test.setTimeout(180000)
  // Four photos' worth of incompressible PNGs, about 918 KB each.
  const big = [0, 1, 2, 3].map(() => png([0, 0, 0], { width: 600, height: 600, noiseRows: 510 }))
  const seed = legacySeed({ big })
  const seededChars = Object.entries(seed).reduce((sum, [key, value]) => sum + key.length + value.length, 0)
  expect(seededChars).toBeGreaterThan(4_850_000)
  expect(seededChars).toBeLessThan(5_000_000)
  // As customers have it: another image saved as text no longer fits.
  expect(await seedStorage(page, seed)).toBe('QuotaExceededError')

  await boot(page, PLAIN)
  await expect.poll(() => storageChars(page), { timeout: 30000 }).toBeLessThan(20_000)
  test.info().annotations.push({ type: 'localStorage characters', description: `${seededChars} seeded, ${await storageChars(page)} after load` })
  const stored = Object.values(await storedText(page)).join('\n')
  expect(stored).not.toContain('data:image')
  for (const image of big) {
    expect(stored).toContain(`image:${digest(image)}`)
    expect(await storedImageDigest(page, digest(image))).toEqual({ size: image.length, id: digest(image) })
  }
  // The quota is free again.
  expect(await page.evaluate(() => {
    localStorage.setItem('quota-probe', 'x'.repeat(4_000_000))
    localStorage.removeItem('quota-probe')
    return true
  })).toBe(true)

  await dropImage(page, BLUE, 'blue.png')
  await expect.poll(() => editorText(page)).toContain(`image:${digest(BLUE)}`)
  await expect.poll(() => outputPixel(page)).toEqual(BLUE_PIXEL)
  await saveProgram(page, 'After the fix')
  expect(JSON.parse((await storedText(page))['polymorphic-programs'])['After the fix'].dsl).toContain(`image:${digest(BLUE)}`)

  await boot(page, PLAIN)
  await loadProgram(page, 'After the fix')
  await expect.poll(() => outputPixel(page)).toEqual(BLUE_PIXEL)
  await loadProgram(page, 'Text image')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  expect(await storageChars(page)).toBeLessThan(20_000)
})

/**
 * Hold every image write the app commits until window.__releaseWrites() is
 * called. window.__heldWrites counts the writes held.
 */
async function holdImageWrites(page) {
  await page.addInitScript(() => {
    window.__heldWrites = 0
    const released = new Promise(resolve => { window.__releaseWrites = resolve })
    const transaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = transaction.call(this, names, mode, options)
      if (mode === 'readwrite') {
        Object.defineProperty(tx, 'oncomplete', {
          configurable: true,
          set(handler) {
            window.__heldWrites++
            tx.addEventListener('complete', event => released.then(() => handler.call(tx, event)))
          },
        })
      }
      return tx
    }
  })
}

const historyEntries = async page => JSON.parse((await storedText(page))['polymorphic-snapshot-history']).entries.map(entry => entry.dsl)

test('saves made while a full localStorage is being freed wait for the space, and history loses nothing', async ({ page }) => {
  test.setTimeout(180000)
  await holdImageWrites(page)
  const big = [0, 1, 2, 3].map(() => png([0, 0, 0], { width: 600, height: 600, noiseRows: 510 }))
  const seed = legacySeed({ big })
  expect(await seedStorage(page, seed)).toBe('QuotaExceededError')
  // Fill what is left, so that any save needs the space the move frees.
  await page.evaluate(() => {
    let size = 0
    for (let step = 1 << 22; step >= 1; step >>= 1) {
      try {
        localStorage.setItem('filler', 'x'.repeat(size + step))
        size += step
      } catch { /* Too big; try a smaller step. */ }
    }
  })

  await boot(page, PLAIN)
  // The move is waiting on its first image write, and has freed nothing yet.
  await expect.poll(() => page.evaluate(() => window.__heldWrites)).toBeGreaterThan(0)
  // A history entry, a scene save and a program save.
  await showColor(page, OTHER, MAGENTA_PIXEL)
  await page.keyboard.press('Control+Shift+Digit5')
  await page.evaluate(async () => (await import('/js/programModal.js')).openProgramModal('save'))
  await page.fill('#programNameInput', 'Saved while moving')
  await page.click('#programSaveBtn')
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)))
  expect(await storedText(page)).toEqual(seed)

  await page.evaluate(() => window.__releaseWrites())
  await expect.poll(async () => {
    const stored = await storedText(page)
    return [JSON.parse(stored['polymorphic-programs'])['Saved while moving']?.dsl, JSON.parse(stored['polymorphic-scenes'])[5]]
  }, { timeout: 30000 }).toEqual([OTHER, OTHER])
  await expect.poll(() => historyEntries(page), { timeout: 30000 }).toEqual([
    program(`image:${digest(big[3])}`),
    program(`image:${digest(RED)}`),
    PLAIN,
    OTHER,
  ])
  expect(Object.values(await storedText(page)).join('\n')).not.toContain('data:image')
  await page.evaluate(() => localStorage.removeItem('filler'))
  expect(await storageChars(page)).toBeLessThan(20_000)
  expect(await storedImageDigest(page, digest(big[3]))).toEqual({ size: big[3].length, id: digest(big[3]) })
})

test('history records programs in the order they compiled while an image is still being stored', async ({ page }) => {
  test.setTimeout(120000)
  await holdImageWrites(page)
  await boot(page, PLAIN)
  // An older link's program, with the image as text: recording it stores the image first.
  await showColor(page, program(text(RED)), RED_PIXEL)
  await expect.poll(() => page.evaluate(() => window.__heldWrites)).toBe(1)
  await showColor(page, OTHER, MAGENTA_PIXEL)
  await page.evaluate(() => window.__releaseWrites())
  await expect.poll(async () => (await historyEntries(page)).slice(-2)).toEqual([program(`image:${digest(RED)}`), OTHER])
  // Compiling the same image text again does not store it again.
  await showColor(page, program(text(RED)), RED_PIXEL)
  await expect.poll(async () => (await historyEntries(page)).at(-1)).toBe(program(`image:${digest(RED)}`))
  expect(await page.evaluate(() => window.__heldWrites)).toBe(1)
})

test('dropping, saving and loading an image work without crypto.subtle, as over plain HTTP', async ({ page }) => {
  test.setTimeout(120000)
  await page.addInitScript(() => Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true }))
  await boot(page, PLAIN)
  expect(await page.evaluate(() => typeof window.crypto.subtle)).toBe('undefined')
  await dropImage(page, RED, 'red.png')
  const reference = `image:${digest(RED)}`
  await expect.poll(() => editorText(page)).toContain(reference)
  expect(await storedImage(page, digest(RED))).toEqual({ type: 'image/png', bytes: Array.from(RED) })
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await expect.poll(async () => (await storedText(page))['polymorphic-snapshot-history']).toContain(reference)
  await page.keyboard.press('Control+Shift+Digit2')
  await expect(page.locator('.polymorphic-toast')).toHaveText('Saved scene 2')
  await saveProgram(page, 'Red over HTTP')
  // An older link's program, with the image as text.
  await showColor(page, program(text(GREEN)), GREEN_PIXEL)
  await expect.poll(async () => (await historyEntries(page)).at(-1)).toBe(program(`image:${digest(GREEN)}`))
  expect(await storedImage(page, digest(GREEN))).toEqual({ type: 'image/png', bytes: Array.from(GREEN) })

  await boot(page, PLAIN)
  await loadProgram(page, 'Red over HTTP')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await showColor(page, PLAIN, YELLOW_PIXEL)
  await recallScene(page, 2)
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  for (const value of Object.values(await storedText(page))) expect(value).not.toContain('data:image')
})

test('entries keep their images as text when IndexedDB cannot store them', async ({ page }) => {
  test.setTimeout(120000)
  const failures = []
  page.on('console', message => { if (/Error moving images/.test(message.text())) failures.push(message.text()) })
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () { throw new DOMException('Image storage is unavailable', 'UnknownError') }
  })
  const seed = legacySeed()
  expect(await seedStorage(page, seed)).toBe('fits')
  await boot(page, PLAIN)
  // Every entry that carries image text tried and failed: two programs, two
  // scenes and one history entry.
  await expect.poll(() => failures.length).toBe(5)
  expect(await storedText(page)).toEqual(seed)

  // They still load and render from their text.
  await loadProgram(page, 'Text image')
  await expect.poll(() => outputPixel(page)).toEqual(RED_PIXEL)
  await loadProgram(page, 'Listed image')
  await expect.poll(() => outputPixel(page)).toEqual(GREEN_PIXEL)
  const after = await storedText(page)
  expect(after['polymorphic-programs']).toBe(seed['polymorphic-programs'])
  expect(after['polymorphic-scenes']).toBe(seed['polymorphic-scenes'])
  // History records the programs just compiled, but never with image text it
  // could not store, and keeps its older entries.
  const history = JSON.parse(after['polymorphic-snapshot-history']).entries
  expect(history.slice(0, 2)).toEqual(JSON.parse(seed['polymorphic-snapshot-history']).entries)
  expect(history.slice(2).map(entry => entry.dsl)).toEqual([program(`image:${digest(GREEN)}`)])
})
