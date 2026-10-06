import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'

// Sharing sends and reads images as files: uploads are raw image bodies, and
// shared compositions list their images as { id, url } files. Only the remote
// CDN boundary is substituted; the production loader runs. The sharing image
// helpers come from a sharing checkout when one is present (PORTABLE_IMAGES_MODULE
// or ../sharing), otherwise from a minimal stand-in with the same contract.

const helperFile = resolve(process.env.PORTABLE_IMAGES_MODULE || '../sharing/public/js/portableImages.js')
const STAND_IN = `
const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
const base64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
export async function prepareImage(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('Invalid image format')
    return { id: await hex(bytes), dataUrl: 'data:image/png;base64,' + base64(bytes), mimeType: 'image/png', width: 1, height: 1 }
}
export async function prepareImageFile(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('Invalid image format')
    return { id: await hex(bytes), blob: new Blob([bytes], { type: 'image/png' }), mimeType: 'image/png', width: 1, height: 1 }
}
export function imageToBlob(image) {
    if (image.blob instanceof Blob) return image.blob
    if (!String(image.dataUrl).startsWith('data:image/png;base64,')) throw new Error('Invalid image base64 data URL')
    const raw = atob(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1))
    return new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], { type: image.dataUrl.slice(5, image.dataUrl.indexOf(';')) })
}
export function replaceMediaUrls(dsl, replacer) {
    return dsl.replace(/media\\(url: "([^"]*)"\\)/g, (call, url) => {
        const next = replacer(url)
        return next === null ? 'media()' : 'media(url: ' + JSON.stringify(next ?? url) + ')'
    })
}`
const helperUrl = existsSync(helperFile)
    ? pathToFileURL(helperFile).href
    : `data:text/javascript;base64,${Buffer.from(STAND_IN).toString('base64')}`
const tools = await import(helperUrl)

globalThis.__portableRuntime = { CanvasRenderer: class {}, unregisterEffect() {} }
const source = (await readFile(new URL('../../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const { CanvasRenderer, unregisterEffect } = globalThis.__portableRuntime')
    .replace(/const PORTABLE_IMAGES_URL = '[^']+'/, `const PORTABLE_IMAGES_URL = ${JSON.stringify(helperUrl)}`)
const loader = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

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
/** A 1x1 RGB PNG of one color. */
function png(rgb) {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(1, 4)
    header[8] = 8
    header[9] = 2
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.from([0, ...rgb]))), chunk('IEND', Buffer.alloc(0))])
}
const RED = png([255, 0, 0])
const GREEN = png([0, 255, 0])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const program = (...urls) => urls.map((url, i) => `media(url: "${url}").write(o${i})`).join('\n')
const API = 'https://sharing.noisedeck.app'

/** Replace fetch for one test, recording every request. */
function serve(t, handler) {
    const previous = globalThis.fetch
    const requests = []
    globalThis.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), init })
        return handler(String(url), init)
    }
    t.after(() => { globalThis.fetch = previous })
    return requests
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const file = (bytes, type = 'image/png') => new Response(bytes, { headers: { 'Content-Type': type } })

test('opening a share asks for image files and loads each one as an image the renderer binds', async t => {
    const requests = serve(t, url => {
        if (url === `${API}/api/composition/ABC123?images=files`) return json({
            code: 'ABC123', dsl: program(`image:${digest(RED)}`), effects: [],
            images: [{ id: digest(RED), url: `${API}/api/images/${digest(RED)}`, mimeType: 'image/png', width: 1, height: 1 }],
        })
        if (url === `${API}/api/images/${digest(RED)}`) return file(RED)
        return json({ error: 'unexpected' }, 404)
    })
    const composition = await loader.loadFromCode('ABC123')
    assert.deepEqual(requests.map(request => request.url), [`${API}/api/composition/ABC123?images=files`, `${API}/api/images/${digest(RED)}`])
    assert.equal(composition.dsl, program(`image:${digest(RED)}`))
    assert.equal(composition.images.length, 1)
    assert.equal(composition.images[0].id, digest(RED))
    // Images are files: the record holds the image's bytes as a Blob, never as text.
    assert.ok(composition.images[0].blob instanceof Blob)
    assert.ok(Buffer.from(await composition.images[0].blob.arrayBuffer()).equals(RED))
    assert.equal(composition.images[0].dataUrl, undefined)
    assert.equal(composition.images[0].mimeType, 'image/png')
})

test('an image that an older share response carried as base64 text is read into a Blob record', async t => {
    const warnings = []
    const warn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    t.after(() => { console.warn = warn })
    const requests = serve(t, url => {
        if (url.includes('/api/composition/')) return json({
            code: 'ABC123', dsl: program(`image:${digest(RED)}`, `image:${digest(GREEN)}`), effects: [],
            images: [
                { id: digest(RED), dataUrl: `data:image/png;base64,${RED.toString('base64')}` },
                // Text whose bytes are not the image its id names.
                { id: digest(GREEN), dataUrl: `data:image/png;base64,${RED.toString('base64')}` },
            ],
        })
        return json({ error: 'unexpected' }, 404)
    })
    const composition = await loader.loadFromCode('ABC123')
    assert.equal(requests.length, 1)
    assert.deepEqual(composition.images.map(image => image.id), [digest(RED)])
    assert.ok(composition.images[0].blob instanceof Blob)
    assert.ok(Buffer.from(await composition.images[0].blob.arrayBuffer()).equals(RED))
    assert.equal(composition.images[0].dataUrl, undefined)
    assert.equal(composition.dsl, `${program(`image:${digest(RED)}`)}\nmedia().write(o1)`)
    assert.equal(warnings.length, 1)
})

test('an image file that fails to load or does not match its id is left out, and the program renders without it', async t => {
    const warnings = []
    const warn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    t.after(() => { console.warn = warn })
    serve(t, url => {
        if (url.includes('/api/composition/')) return json({
            code: 'ABC123', dsl: program(`image:${digest(RED)}`, `image:${digest(GREEN)}`, `image:${'0'.repeat(64)}`), effects: [],
            images: [
                { id: digest(RED), url: `${API}/api/images/${digest(RED)}` },
                { id: digest(GREEN), url: `${API}/api/images/${digest(GREEN)}` },
                { id: '0'.repeat(64), url: `${API}/api/images/${'0'.repeat(64)}` },
            ],
        })
        if (url.endsWith(digest(RED))) return file(RED)
        if (url.endsWith(digest(GREEN))) return file(RED) // wrong bytes for this id
        return json({ error: 'Image not found' }, 404)
    })
    const composition = await loader.loadFromCode('ABC123')
    assert.deepEqual(composition.images.map(image => image.id), [digest(RED)])
    assert.equal(composition.dsl, `${program(`image:${digest(RED)}`)}\nmedia().write(o1)\nmedia().write(o2)`)
    assert.equal(warnings.length, 2)
})

test('previews fetch no image files', async t => {
    const requests = serve(t, () => json({ code: 'ABC123', dsl: program(`image:${digest(RED)}`), effects: [],
        images: [{ id: digest(RED), url: `${API}/api/images/${digest(RED)}` }] }))
    const composition = await loader.loadFromCode('ABC123', { loadImages: false })
    assert.equal(requests.length, 1)
    assert.equal(composition.dsl, program(`image:${digest(RED)}`))
})

test('uploadImage posts the raw file with its image type and returns the id the service gives', async t => {
    const requests = serve(t, () => json({ id: 'c'.repeat(64), url: 'x', mimeType: 'image/png', width: 1, height: 1 }, 201))
    const blob = new Blob([RED], { type: 'image/png' })
    assert.equal(await loader.uploadImage(blob), 'c'.repeat(64))
    assert.equal(requests[0].url, `${API}/api/images`)
    assert.equal(requests[0].init.method, 'POST')
    assert.equal(requests[0].init.headers['Content-Type'], 'image/png')
    assert.equal(requests[0].init.body, blob)
})

test('uploadImage reports the service error', async t => {
    serve(t, () => json({ error: 'Invalid image format' }, 415))
    await assert.rejects(loader.uploadImage(new Blob([Buffer.from('nope')], { type: 'image/png' })), /Invalid image format/)
})

test('uploadProgramImages uploads the stored file, or the prepared bytes, and renames images by the returned id', async t => {
    const red = await tools.prepareImageFile(new Blob([RED], { type: 'image/png' }))
    const green = await tools.prepareImageFile(new Blob([GREEN], { type: 'image/png' }))
    const storedRed = new Blob([RED], { type: 'image/png' })
    const renamed = 'e'.repeat(64)
    const requests = serve(t, async (url, init) => {
        const bytes = Buffer.from(await init.body.arrayBuffer())
        // The service names GREEN by another id than the client's.
        return json({ id: bytes.equals(GREEN) ? renamed : digest(bytes) }, 201)
    })
    const dsl = await loader.uploadProgramImages(program(`image:${red.id}`, `image:${green.id}`), [red, green], {
        tools, storedImage: async id => (id === red.id ? storedRed : null),
    })
    assert.equal(dsl, program(`image:${red.id}`, `image:${renamed}`))
    assert.equal(requests.length, 2)
    assert.equal(requests[0].init.body, storedRed)
    assert.ok(Buffer.from(await requests[1].init.body.arrayBuffer()).equals(GREEN))
    for (const request of requests) {
        assert.equal(request.init.headers['Content-Type'], 'image/png')
        assert.ok(request.init.body instanceof Blob)
    }
})

test('uploadProgramImages still uploads images that earlier pages prepared as base64 records, as files', async t => {
    const green = await tools.prepareImage(new Blob([GREEN], { type: 'image/png' }))
    const requests = serve(t, async (url, init) => json({ id: digest(Buffer.from(await init.body.arrayBuffer())) }, 201))
    const dsl = await loader.uploadProgramImages(program(`image:${green.id}`), [green], { tools, storedImage: async () => null })
    assert.equal(dsl, program(`image:${green.id}`))
    assert.ok(requests[0].init.body instanceof Blob)
    assert.ok(Buffer.from(await requests[0].init.body.arrayBuffer()).equals(GREEN))
})

test('uploadProgramImages leaves a program without images untouched and uploads nothing', async t => {
    const requests = serve(t, () => json({}))
    assert.equal(await loader.uploadProgramImages('solid().write(o0)', [], { tools }), 'solid().write(o0)')
    assert.equal(requests.length, 0)
})

test('uploadScreenshot uploads a JPEG file and is best-effort', async t => {
    const jpeg = new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    const canvas = { toBlob: (done, type, quality) => { assert.equal(type, 'image/jpeg'); assert.equal(quality, 0.85); done(jpeg) } }
    let fail = false
    const requests = serve(t, () => (fail ? json({ error: 'down' }, 500) : json({ id: 'd'.repeat(64) }, 201)))
    assert.equal(await loader.uploadScreenshot(canvas), 'd'.repeat(64))
    assert.equal(requests[0].init.body, jpeg)
    assert.equal(requests[0].init.headers['Content-Type'], 'image/jpeg')
    const warn = console.warn
    console.warn = () => {}
    t.after(() => { console.warn = warn })
    fail = true
    assert.equal(await loader.uploadScreenshot(canvas), undefined)
    assert.equal(await loader.uploadScreenshot(null), undefined)
    assert.equal(await loader.uploadScreenshot({ toBlob: done => done(null) }), undefined)
    assert.equal(await loader.uploadScreenshot({ toBlob: () => { throw new Error('tainted') } }), undefined)
})
