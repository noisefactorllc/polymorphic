/**
 * The Seance route of the agent contract: an agent joins the session that a
 * Polymorphic tab took online and sends nf-agent/1 requests to that tab
 * (public/js/agent/relay.js). Images travel as bytes, never as text.
 */
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { routeHandfishLocal } from './handfishLocal.js'
import { routePortableImagesLocal } from './portableImagesLocal.js'
import { SEANCE_SDK_URL, routeSeanceSdkLocal, startSeanceServer } from './seanceLocal.js'
import { joinAsAgent } from './agentRelayClient.js'

const ORIGIN = 'http://localhost:3017'
// Stands in for the agent tool when the prompt's join line runs in a shell.
const JOIN_TOOL = resolve(process.cwd(), 'tests/agentJoin.mjs')
const BASE = [
  'search synth, filter',
  '',
  'perlin(scale: 75, octaves: 2)',
  '  .adjust(mode: hsv, rotation: 120, hueRange: 40)',
  '  .write(o0)',
  '',
  'render(o0)',
].join('\n')
const VALID = 'search synth\nsolid(color: [0, 0, 1]).write(o0)\nrender(o0)'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** A 2x2 PNG of one color. */
function png(red, green, blue) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4)
    const checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2, 0)
  header.writeUInt32BE(2, 4)
  header[8] = 8
  header[9] = 6
  const row = [0, red, green, blue, 255, red, green, blue, 255]
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([...row, ...row]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let seance

test.describe.configure({ mode: 'serial', timeout: 120000 })

test.beforeAll(async () => {
  seance = await startSeanceServer({ origin: ORIGIN })
})

test.afterAll(async () => {
  await seance?.stop()
})

function appPath(params = {}) {
  const url = new URL('/', ORIGIN)
  url.searchParams.set('seanceUrl', seance.url)
  url.searchParams.set('seanceSdk', SEANCE_SDK_URL)
  url.searchParams.set('dsl', BASE)
  if (params.seance) url.searchParams.set('seance', params.seance)
  return `${url.pathname}${url.search}`
}

async function openApp(page, params) {
  await routeHandfishLocal(page)
  await routeSeanceSdkLocal(page)
  await routePortableImagesLocal(page)
  await page.goto(appPath(params), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.PolymorphicAgent?.getState, null, { timeout: 30000 })
  await page.evaluate(() => window.PolymorphicAgent.ready)
}

/** Take the program online through the program menu, as the person does. */
async function takeOnline(page) {
  await page.locator('#programMenuTitle').click()
  await page.locator('#goOnlineMenuItem').click()
  await expect(page.locator('#seanceDialog dialog')).toBeVisible()
  await page.locator('#seanceDialog [data-action="take-online"]').click()
  await expect(page.locator('#seanceDialog .hf-seance-status-text')).toHaveText('Online', { timeout: 15000 })
  const code = await page.locator('#seanceDialog').evaluate(el => el.sessionId)
  await page.keyboard.press('Escape')
  return code
}

const editorText = page => page.evaluate(() => document.getElementById('dsl-editor').value)

// media() draws an image at its own size, in the middle of the canvas.
const centerPixel = page => page.evaluate(() => {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.drawImage(document.getElementById('canvas'), 0, 0, 1, 1)
  return Array.from(ctx.getImageData(0, 0, 1, 1).data)
})

// A custom effect, as a sharing link carries it.
const CUSTOM_EFFECT = {
  name: 'agentFill',
  func: 'agentFill',
  description: 'Fills the picture with one level of red',
  globals: { level: { type: 'float', default: 0.5, min: 0, max: 1, uniform: 'level' } },
  passes: [{ name: 'render', program: 'main', inputs: {}, outputs: { color: 'outputTex' } }],
  shaders: { main: {
    glsl: '#version 300 es\nprecision highp float;\nuniform float level;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(level, 0.0, 0.0, 1.0); }',
    wgsl: '@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(0.5, 0.0, 0.0, 1.0); }',
  } },
}

test('the owner tab runs an agent\'s commands and shows its canvas as an uploaded image', async ({ page }) => {
  const sent = []
  page.on('websocket', socket => socket.on('framesent', frame => sent.push(String(frame.payload))))
  const uploads = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/images')) {
      uploads.push({ type: request.headers()['content-type'], body: request.postDataBuffer() })
    }
  })
  await openApp(page)
  // The person takes the program online in the page under test, so this tab is the owner's.
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const described = await agent.describe()
    // The person had no connect-agent dialog open: a toast confirms the agent.
    await expect(page.locator('.polymorphic-toast').filter({ hasText: 'Agent connected' })).toBeVisible()
    expect(described.app).toBe('polymorphic')
    expect(described.body).toMatchObject({ ok: true, result: { app: 'polymorphic', apiVersion: '1.0', tab: described.from } })
    const commands = Object.fromEntries(described.body.result.commands.map(command => [command.name, command]))
    expect(commands.setProgram.args.required).toEqual(['dsl'])
    expect(commands.setProgram.remote).toBe(true)
    expect(commands.getThumbnail).toMatchObject({ readOnly: true, remote: true })
    for (const name of ['exportImage', 'listPrograms', 'saveProgram', 'loadProgram', 'deleteProgram', 'listScenes', 'saveScene', 'loadScene',
      'stepHistory', 'resetProgram', 'setView', 'setBackend', 'importComposition']) {
      expect(commands[name].remote, name).toBe(false)
    }
    const tab = described.from

    const program = await agent.request(tab, 'getProgram')
    expect(program.body.result).toEqual({ dsl: BASE, running: true })

    // '*' reaches only describe: a broadcast getProgram gets no answer, so the
    // answer to the next request is the first one with either id.
    const broadcast = await agent.send('*', 'getProgram')
    const set = await agent.request(tab, 'setProgram', { dsl: VALID })
    expect(agent.relayed.filter(frame => frame.kind === 'response' && frame.id === broadcast)).toEqual([])
    expect(set.body).toMatchObject({ ok: true, command: 'setProgram', result: { applied: true } })
    expect(set.body.state.program).toEqual({ chars: VALID.length, running: true, error: null })
    expect(await editorText(page)).toBe(VALID)
    expect((await agent.documents()).find(doc => doc.id === 'main')?.text).toBe(VALID)

    // Text that stayed in the editor stays private: the session reads the
    // program it holds.
    await page.evaluate(() => { document.getElementById('dsl-editor').value = 'search synth\n// private draft\nnoise().write(o0)\nrender(o0)' })
    const read = await agent.request(tab, 'getProgram')
    expect(read.body.result).toEqual({ dsl: VALID, running: true })
    expect(read.body.state.program.chars).toBe(VALID.length)
    expect(JSON.stringify(read.body)).not.toContain('private draft')
    await page.evaluate(dsl => { document.getElementById('dsl-editor').value = dsl }, VALID)

    const refused = await agent.request(tab, 'setProgram', { dsl: 'search synth\nperlin(madeUp: 3).write(o0)\nrender(o0)' })
    expect(refused.body.ok).toBe(false)
    expect(refused.body.error.code).toBe('INVALID_PROGRAM')
    expect(await editorText(page)).toBe(VALID)
    expect((await agent.documents()).find(doc => doc.id === 'main').text).toBe(VALID)

    const look = await agent.request(tab, 'getThumbnail', { maxDimension: 48, format: 'png' })
    expect(look.body.ok).toBe(true)
    const result = look.body.result
    expect(result).toMatchObject({ mimeType: 'image/png', image: { mimeType: 'image/png' } })
    expect(Math.max(result.width, result.height)).toBe(48)
    expect(result.bytes).toBeUndefined()
    const bytes = await agent.downloadImage(result.image.id)
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
    expect(digest(bytes)).toBe(result.image.id)
    expect(result.image.bytes).toBe(bytes.length)
    // Images are images: the frame went up as its own bytes, and no
    // WebSocket frame from the tab carried image text.
    expect(uploads.some(upload => upload.type === 'image/png' && upload.body?.equals(bytes))).toBe(true)
    expect(sent.filter(frame => frame.includes(bytes.toString('base64')) || /data:image|[A-Za-z0-9+/]{200,}/.test(frame))).toEqual([])

    // An image travels through a session only as bytes.
    const inline = await agent.request(tab, 'setProgram', { dsl: 'search synth\nmedia(url: "data:image/png;base64,iVBORw0KGgo=").write(o0)\nrender(o0)' })
    expect(inline.body.error.code).toBe('IMAGE_AS_TEXT')
    expect(await editorText(page)).toBe(VALID)

    // Downloads and what the person stored stay out of the session.
    await page.evaluate(() => window.PolymorphicAgent.saveProgram({ name: 'Private sketch' }))
    for (const [command, args] of [['exportImage', {}], ['listPrograms', {}], ['loadProgram', { name: 'Private sketch' }],
      ['saveProgram', { name: 'From the session' }], ['deleteProgram', { name: 'Private sketch' }], ['listScenes', {}],
      ['saveScene', { slot: 1 }], ['stepHistory', { direction: 'back' }], ['importComposition', { link: 'Agent1' }],
      ['resetProgram', {}], ['setView', { panel: 'editor', visible: false }], ['setBackend', { backend: 'webgpu' }]]) {
      const answer = await agent.request(tab, command, args)
      expect(answer.body.error.code, command).toBe('REMOTE_UNAVAILABLE')
      expect(JSON.stringify(answer.body), command).not.toContain('Private sketch')
    }
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('polymorphic-programs'))))).toEqual(['Private sketch'])
    expect(await editorText(page)).toBe(VALID)

    const unknown = await agent.request(tab, 'noSuchCommand')
    expect(unknown.body.error.code).toBe('NOT_FOUND_COMMAND')
    const invalid = await agent.request(tab, 'setProgram', { dsl: VALID, force: true })
    expect(invalid.body.error.code).toBe('INVALID_ARGS_UNKNOWN')
  } finally {
    agent.close()
  }
})

test('custom effects the person loaded stay out of the session', async ({ page }) => {
  await page.route('https://sharing.noisedeck.app/api/composition/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ code: 'Agent1', title: 'Custom', dsl: VALID, images: [], effects: [CUSTOM_EFFECT] }),
  }))
  await openApp(page)
  expect((await page.evaluate(() => window.PolymorphicAgent.importComposition({ link: 'Agent1' }))).ok).toBe(true)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const tab = (await agent.describe()).from
    const local = await page.evaluate(() => window.PolymorphicAgent.searchEffects({ namespace: 'user' }))
    expect(local.result.total).toBe(1)
    const remote = await agent.request(tab, 'searchEffects', { namespace: 'user' })
    expect(remote.body.result).toEqual({ total: 0, effects: [] })
    const all = await agent.request(tab, 'searchEffects', { query: 'agentFill', limit: 500 })
    expect(all.body.result.total).toBe(0)
    const definition = await agent.request(tab, 'getEffectDefinition', { effectId: 'user/agentFill' })
    expect(definition.body.error.code).toBe('REMOTE_UNAVAILABLE')
    expect(JSON.stringify([remote.body, all.body, definition.body])).not.toContain('Fills the picture')
    const builtIn = await agent.request(tab, 'getEffectDefinition', { effectId: 'synth/solid' })
    expect(builtIn.body.result.func).toBe('solid')
  } finally {
    agent.close()
  }
})

test('a second tab in the session stays silent, an image the agent adds runs in both, and the owner announces itself again after a reload', async ({ page, browser }) => {
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestSent = []
  guest.on('websocket', socket => socket.on('framesent', frame => guestSent.push(String(frame.payload))))
  try {
    await openApp(guest, { seance: code })
    await expect.poll(() => guest.evaluate(() => window.PolymorphicAgent.getState().then(env => env.state.online))).toBe('online')
    const owner = (await agent.describe()).from

    // Only the tab that took the session online offers "connect agent...".
    await guest.locator('#programMenuTitle').click()
    await expect(guest.locator('#goOnlineMenuItem')).toBeVisible()
    await expect(guest.locator('#connectAgentMenuItem')).toBeHidden()
    await guest.keyboard.press('Escape')
    await page.locator('#programMenuTitle').click()
    await expect(page.locator('#connectAgentMenuItem')).toBeVisible()
    await page.keyboard.press('Escape')

    const red = png(255, 0, 0)
    const id = await agent.uploadImage(red, 'image/png')
    expect(id).toBe(digest(red))
    const dsl = `search synth\nmedia(url: "image:${id}").write(o0)\nrender(o0)`
    const check = await agent.request(owner, 'validateProgram', { dsl })
    expect(check.body.result).toEqual({ valid: true, diagnostics: [] })
    const set = await agent.request(owner, 'setProgram', { dsl })
    expect(set.body.ok, JSON.stringify(set.body.error)).toBe(true)
    expect(await editorText(page)).toBe(dsl)
    await expect.poll(() => centerPixel(page)).toEqual([255, 0, 0, 255])
    // The guest's tab runs the same program, with the image from the session.
    await expect.poll(() => editorText(guest)).toBe(dsl)
    await expect.poll(() => centerPixel(guest)).toEqual([255, 0, 0, 255])

    // The owner's tab reloads (setBackend does this) and joins again as the owner.
    const announced = agent.announced()
    await page.reload({ waitUntil: 'domcontentloaded' })
    const announce = await announced
    expect(announce.body).toMatchObject({ app: 'polymorphic', apiVersion: '1.0', tab: announce.from })
    expect(announce.from).not.toBe(owner)
    expect((await agent.request(announce.from, 'getProgram')).body.result.dsl).toBe(dsl)

    // The guest's tab never sent a relay frame, and every relay frame the
    // agent received came from the owner.
    expect(guestSent.filter(frame => frame.includes('nf-agent/1'))).toEqual([])
    expect(new Set(agent.relayed.map(frame => frame.user_id)).size).toBe(1)
  } finally {
    agent.close()
    await guestContext.close()
  }
})

test('the tab takes at most 16 images in ten minutes', async ({ page }) => {
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const tab = (await agent.describe()).from
    for (let n = 0; n < 16; n++) {
      const look = await agent.request(tab, 'getThumbnail', { maxDimension: 16 })
      expect(look.body.ok, JSON.stringify(look.body.error)).toBe(true)
    }
    const refused = await agent.request(tab, 'getThumbnail', { maxDimension: 16 })
    expect(refused.body.error).toMatchObject({ code: 'IMAGE_LIMIT', details: { retryAfter: expect.any(Number) } })
    expect(refused.body.error.details.retryAfter).toBeGreaterThan(500)
  } finally {
    agent.close()
  }
})

test('an image the person keeps only in this browser stays out of the session', async ({ page }) => {
  const uploads = []
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/images')) uploads.push(request.postDataBuffer())
  })
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const tab = (await agent.describe()).from
    const secret = png(10, 200, 30)
    const ref = await page.evaluate(async bytes => {
      const { storeImageFile } = await import('/js/programImages.js')
      return storeImageFile(new File([new Uint8Array(bytes)], 'private.png', { type: 'image/png' }))
    }, Array.from(secret))
    expect(ref).toBe(`image:${digest(secret)}`)
    const dsl = `search synth\nmedia(url: "${ref}").write(o0)\nrender(o0)`
    const refused = await agent.request(tab, 'setProgram', { dsl })
    expect(refused.body.error).toMatchObject({ code: 'NOT_FOUND_IMAGE', details: { id: digest(secret) } })
    expect(await editorText(page)).toBe(BASE)
    expect(uploads.some(body => body?.equals(secret))).toBe(false)
    // Once the image is in the session, the program runs.
    expect(await agent.uploadImage(secret, 'image/png')).toBe(digest(secret))
    const set = await agent.request(tab, 'setProgram', { dsl })
    expect(set.body.ok, JSON.stringify(set.body.error)).toBe(true)
    await expect.poll(() => centerPixel(page)).toEqual([10, 200, 30, 255])
  } finally {
    agent.close()
  }
})

test('while the person uses live input, the session gets nothing from the tab', async ({ page }) => {
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const tab = (await agent.describe()).from
    // A camera without hardware: a canvas stream stands in for the webcam.
    await page.evaluate(() => {
      const source = document.createElement('canvas')
      source.width = source.height = 16
      source.getContext('2d').fillRect(0, 0, 16, 16)
      window.__poly.liveInputsPanel._currentStream = source.captureStream(30)
    })
    for (const [command, args] of [['getState', {}], ['getProgram', {}], ['getThumbnail', { maxDimension: 16 }], ['setProgram', { dsl: VALID }]]) {
      const answer = await agent.request(tab, command, args)
      expect(answer.body.error.code, command).toBe('REMOTE_UNAVAILABLE')
      expect(answer.body.state, command).toBeNull()
    }
    expect(await editorText(page)).toBe(BASE)
    // describe still answers, so an agent can tell why.
    expect((await agent.describe()).from).toBe(tab)
    await page.evaluate(() => window.__poly.liveInputsPanel.stopMediaSource())
    expect((await agent.request(tab, 'getState')).body.ok).toBe(true)
  } finally {
    agent.close()
  }
})

test('a tab that inherits the session after the person\'s tab closes does not answer', async ({ page, browser }) => {
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestSent = []
  const guestReceived = []
  guest.on('websocket', socket => {
    socket.on('framesent', frame => guestSent.push(String(frame.payload)))
    socket.on('framereceived', frame => guestReceived.push(String(frame.payload)))
  })
  try {
    await openApp(guest, { seance: code })
    await expect.poll(() => guest.evaluate(() => window.PolymorphicAgent.getState().then(env => env.state.online))).toBe('online')
    const creator = agent.owner()
    expect((await agent.describe()).app).toBe('polymorphic')

    // The person's tab leaves; Seance makes the guest the owner.
    await page.close()
    await expect.poll(() => agent.owner(), { timeout: 20000 }).not.toBe(creator)
    expect(agent.owner()).toBeTruthy()

    // The guest's tab receives the request and lets it pass: it did not take
    // the session online.
    const asked = await agent.send('*', 'describe')
    await expect.poll(() => guestReceived.some(frame => frame.includes(asked))).toBe(true)
    // One task turn in the guest page: any answer would have been sent by now.
    await guest.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel()
      channel.port1.onmessage = resolve
      channel.port2.postMessage(null)
    }))
    expect(guestSent.filter(frame => frame.includes('nf-agent/1'))).toEqual([])
    expect(agent.relayed.filter(frame => frame.id === asked && frame.kind === 'response')).toEqual([])
  } finally {
    agent.close()
    await guestContext.close()
  }
})

test('connect agent walks the person through going online, copying the prompt and the agent joining', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  await openApp(page)
  // "connect agent..." sits directly under "go online..." in the program menu.
  await page.locator('#programMenuTitle').click()
  await expect(page.locator('#connectAgentMenuItem')).toBeVisible()
  expect(await page.locator('#goOnlineMenuItem').evaluate(item => item.nextElementSibling?.id)).toBe('connectAgentMenuItem')
  await expect(page.locator('#connectAgentMenuItem')).toHaveText('connect agent...')
  await page.locator('#connectAgentMenuItem').click()

  const dialog = page.locator('#agentConnectDialog dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.hf-agent-lead')).toHaveText('To connect an agent, follow these steps:')
  const states = () => dialog.locator('.hf-agent-step').evaluateAll(items => items.map(item => item.dataset.state))
  expect(await states()).toEqual(['active', 'pending', 'pending'])

  await dialog.locator('[data-action="go-online"]').click()
  await expect.poll(states, { timeout: 30000 }).toEqual(['done', 'active', 'pending'])
  const code = new URL(page.url()).searchParams.get('seance')
  expect(code).toBeTruthy()
  const sessionUrl = await page.locator('#seanceDialog').evaluate(el => el.sessionUrl)
  expect(new URL(sessionUrl).searchParams.get('seance')).toBe(code)

  await dialog.locator('[data-action="copy-prompt"]').click()
  await expect.poll(states).toEqual(['done', 'done', 'active'])
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  // The join line quotes the link and keeps only the page and the code.
  expect(prompt).toBe([
    'Connect to my Polymorphic session and help me with it.',
    'Read https://polymorphic.noisedeck.app/llms-full.txt first.',
    'Then run:',
    '  curl -fsSLO https://noisedeck.app/agent/seance-agent.mjs',
    `  node seance-agent.mjs join '${ORIGIN}/?seance=${code}'`,
  ].join('\n'))

  // The agent runs the prompt's last line in a shell, as written. A stand-in
  // for the agent tool joins and sends its first request.
  const runJoinLine = text => new Promise((done, fail) => execFile('/bin/sh', ['-c',
    text.trim().split('\n').at(-1).trim().replace('node seance-agent.mjs', `"${process.execPath}" "${JOIN_TOOL}"`)], {
    env: { ...process.env, SEANCE_AGENT_SERVER: seance.url, SEANCE_AGENT_ORIGIN: ORIGIN },
  }, (error, stdout) => error ? fail(error) : done(JSON.parse(stdout))))
  const joined = await runJoinLine(prompt)
  expect(joined).toMatchObject({ code, app: 'polymorphic' })
  await expect.poll(states).toEqual(['done', 'done', 'done'])
  await expect(dialog).toBeHidden({ timeout: 10000 })
  await expect(page.locator('.polymorphic-toast').filter({ hasText: 'Agent connected' })).toBeVisible()

  // Each opening waits for the next agent: a second agent connects too.
  await page.locator('#programMenuTitle').click()
  await page.locator('#connectAgentMenuItem').click()
  await expect(dialog).toBeVisible()
  expect(await states()).toEqual(['done', 'active', 'pending'])
  await dialog.locator('[data-action="copy-prompt"]').click()
  await expect.poll(states).toEqual(['done', 'done', 'active'])
  expect((await runJoinLine(await page.evaluate(() => navigator.clipboard.readText()))).code).toBe(code)
  await expect.poll(states).toEqual(['done', 'done', 'done'])
  await expect(dialog).toBeHidden({ timeout: 10000 })

  // Going offline clears the connection.
  await page.evaluate(() => window.__poly.onlineAdapter.goOffline())
  expect(await page.locator('#agentConnectDialog').evaluate(el => el.connected)).toBe(false)
})

test('a prompt that cannot be copied says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText() { throw new Error('denied') }, async readText() { return '' } },
    })
  })
  await openApp(page)
  await page.locator('#programMenuTitle').click()
  await page.locator('#connectAgentMenuItem').click()
  const dialog = page.locator('#agentConnectDialog dialog')
  await dialog.locator('[data-action="go-online"]').click()
  await expect(dialog.locator('[data-action="copy-prompt"]')).toBeEnabled({ timeout: 30000 })
  await dialog.locator('[data-action="copy-prompt"]').click()
  await expect(page.locator('.polymorphic-toast').filter({ hasText: 'Could not copy the prompt' })).toBeVisible()
})

test('without the connect-agent dialog in handfish, the app loads and the menu item stays hidden', async ({ page }) => {
  // An older handfish: everything but <agent-connect-dialog>.
  await page.addInitScript(() => {
    const define = customElements.define.bind(customElements)
    customElements.define = (name, ...rest) => name === 'agent-connect-dialog' ? undefined : define(name, ...rest)
  })
  await openApp(page)
  await page.locator('#programMenuTitle').click()
  await expect(page.locator('#goOnlineMenuItem')).toBeVisible()
  await expect(page.locator('#connectAgentMenuItem')).toBeHidden()
  expect((await page.evaluate(() => window.PolymorphicAgent.getState())).ok).toBe(true)
})

test('a session cannot name media by an outside link', async ({ page }) => {
  await openApp(page)
  const code = await takeOnline(page)
  const agent = await joinAsAgent({ server: seance.url, code, origin: ORIGIN })
  try {
    const tab = (await agent.describe()).from
    const linked = await agent.request(tab, 'setProgram', { dsl: 'search synth\nmedia(url: "https://example.com/a.png").write(o0)\nrender(o0)' })
    expect(linked.body.error.code).toBe('OUTSIDE_LINK')
    expect(await editorText(page)).toBe(BASE)
  } finally {
    agent.close()
  }
})
