import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'


const defaultDaemon = path.resolve(__dirname, '../../sync/build/sync_audio_test_server')
const daemonPath = process.env.SYNC_AUDIO_TEST_SERVER || defaultDaemon
let daemon, endpoint

test.beforeAll(async () => {
    test.skip(!daemonPath || !fs.existsSync(daemonPath), 'Set SYNC_AUDIO_TEST_SERVER to the native Sync audio fixture')
    daemon = spawn(daemonPath, ['--test-origin', 'http://localhost:3017', '--test-receiver'], { stdio: ['ignore', 'pipe', 'pipe'] })
    endpoint = await new Promise((resolve, reject) => {
        let output = ''
        const timer = setTimeout(() => reject(new Error('Audio daemon startup timed out')), 5000)
        daemon.once('error', reject)
        daemon.stdout.on('data', chunk => {
            output += chunk
            if (!output.includes('\n')) return
            clearTimeout(timer)
            resolve(`http://127.0.0.1:${JSON.parse(output.split('\n')[0]).port}`)
        })
    })
})
test.afterAll(async () => {
    if (!daemon || daemon.exitCode !== null) return
    const exited = new Promise(resolve => daemon.once('exit', resolve))
    daemon.kill('SIGTERM')
    await exited
})

async function setup(page, fullApp = false, backend = 'webgl2') {
    await page.route('**/js/sync/audio.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: `import { SyncBridgeClient as Base } from '/js/sync/sdk/0.3.0/browser/index.js';
            export class SyncBridgeClient extends Base {
                constructor(options) { super({ timeoutMs: 15000, ...options, endpoint: ${JSON.stringify(endpoint)}, permissions: { query: async () => ({ state: 'granted' }) } }); }
                async pair() { return { token: 'audio-test-token' }; }
            }`
    }))
    // The same engine AudioState used by the products, served locally for isolation.
    await page.route('**/__audio-state.js', route => route.fulfill({
        path: path.resolve('../noisemaker/shaders/src/runtime/external-input.js'), contentType: 'text/javascript'
    }))
    await page.goto(fullApp ? '/?dsl=' + encodeURIComponent('search synth\nperlin().write(o0)\nrender(o0)') + '&backend=' + backend : '/sync-audio-test-empty.html')
    await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new Error('Sync must not fall back to the microphone') }
    })
    if (fullApp) {
        await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
        return
    }
    await page.evaluate(async () => {
        const { AudioState } = await import('/__audio-state.js')
        const { SharedAudio } = await import('/js/audio.js')
        window.audioState = new AudioState()
        window.audio = new SharedAudio()
        window.audio.addDeck({ ensureAudioState: () => window.audioState })
        window.syncAudio = await import('/js/sync/audioInput.js')
        await window.syncAudio.connectSyncAudio()
    })
}

for (const channels of [1, 2, 8, 32]) {
    test(`native ${channels}-channel audio reaches every shader channel and releases capture`, async ({ page }) => {
        await setup(page)
        const id = `sync-audio:audio_${channels}`
        expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
        await expect.poll(() => page.evaluate(({ id, channels }) => Array.from({ length: channels }, (_, i) =>
            Math.round((window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw || 0) * 32)), { id, channels }))
            .toEqual(Array.from({ length: channels }, (_, i) => i + 1))
        await expect.poll(() => page.evaluate(() => window.audioState.raw)).toBeCloseTo((channels + 1) / 64)
        await page.evaluate(() => window.audio.disable())
        expect(await page.evaluate(() => window.audioState.rawReady)).toBe(false)
        expect(await page.evaluate(id => window.audioState.getDeviceChannelState({ id, channel: 1 }), id)).toBe(null)
        expect(await page.evaluate(() => window.audioState.getDeviceChannelState({ channel: 1 }))).toBe(null)
        await expect.poll(() => page.evaluate(async () => (await window.syncAudio.refreshSyncAudioDevices())
            .find(source => source.id === 'sync-audio:audio_active')?.name)).toBe('0 · Sync')
    })
}

test('native 32-channel pulse source guarantees zero crosstalk across all unmodulated channels', async ({ page }) => {
    await setup(page)
    const id = 'sync-audio:audio_32_pulse'
    expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
    await expect.poll(async () => {
        const vals = await page.evaluate(id => Array.from({ length: 32 }, (_, i) =>
            window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw ?? null), id)
        if (vals.some(v => v === null)) return false
        const active = vals.filter(v => v > 0.5).length
        const inactiveClean = vals.filter(v => v <= 0.5).every(v => v === 0)
        return active === 1 && inactiveClean
    }, { timeout: 10_000 }).toBe(true)
    await page.evaluate(() => window.audio.disable())
})

test('native 32-channel discrete mapping preserves channel ordering without inversion', async ({ page }) => {
    await setup(page)
    const id = 'sync-audio:audio_32'
    expect(await page.evaluate(id => window.audio.enable(id), id)).toBe(true)
    await expect.poll(async () => {
        const vals = await page.evaluate(id => Array.from({ length: 32 }, (_, i) =>
            window.audioState.getDeviceChannelState({ id, channel: i + 1 })?.raw ?? null), id)
        if (vals.some(v => v === null)) return false
        if (Math.abs(vals[0] - (1 / 32)) > 0.01) return false
        if (Math.abs(vals[31] - (32 / 32)) > 0.01) return false
        for (let i = 0; i < 31; i++) {
            if (vals[i + 1] <= vals[i]) return false
        }
        return true
    }, { timeout: 10_000 }).toBe(true)
    await page.evaluate(() => window.audio.disable())
})

test('native read failure clears active state and permits a new source', async ({ page }) => {
    await setup(page)
    await page.evaluate(() => window.audio.enable('sync-audio:audio_fail_after_2'))
    await expect.poll(() => page.evaluate(() => window.audio.enabled)).toBe(false)
    expect(await page.evaluate(() => window.audio.enable('sync-audio:audio_2'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.audioState.getDeviceChannelState({ id: 'sync-audio:audio_2', channel: 2 })?.raw)).toBeCloseTo(2 / 32)
    await page.evaluate(() => window.audio.disable())
})

for (const backend of ['webgl2', 'webgpu']) test(`native receiver accepts ${backend} renderer bytes while audio and video share the grant`, async ({ page }) => {
    test.slow()
    await page.route('**/js/sync/bundle.js', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export * from '/js/sync/sdk/0.3.3/browser/index.js';
            import { SyncBridgeClient as Base } from '/js/sync/sdk/0.3.3/browser/index.js';
            window.nativeFrameChecksums = new Set();
            class ObservedSocket extends WebSocket {
                send(data) {
                    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
                        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                        let hash = 0x811c9dc5;
                        const payloadLength = bytes.length - 64;
                        const end = 64 + (payloadLength > 1048576 ? 65536 : payloadLength);
                        for (let i = 64; i < end; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
                        window.nativeFrameChecksums.add(hash);
                    }
                    return super.send(data);
                }
            }
            export class SyncBridgeClient extends Base {
                constructor(options) { super({ ...options, endpoint: ${JSON.stringify(endpoint)}, WebSocket: ObservedSocket, permissions: { query: async () => ({ state: 'granted' }) } }); }
                async pair() { throw new Error('Video should reuse the audio grant'); }
            }`
    }))
    await setup(page, true, backend)
    expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe(backend)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    await page.click('[data-id=sync-audio-connect]')
    await expect(page.locator('[data-id=sync-audio-status]')).toHaveText('Select a Sync input, then enable audio.')
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_2')
    await page.click('[data-id=audio-toggle]')
    await expect(page.locator('[data-id=audio-toggle]')).toHaveText('disable')
    await page.evaluate(async () => {
        const sync = await import('/js/sync/audioInput.js')
        await sync.connectSyncAudio()
        const { syncOutputController: output } = window.__poly
        await output.connect()
        await output.start('Polymorphic native receiver')
    })
    const receiverStatus = () => page.evaluate(async () => {
        const output = window.__poly.syncOutputController
        const client = output._client, sender = output._sender
        if (!sender) return { state: output.state, accepted: false }
        const stats = await client._scheduleControl(client._controlSession, () => client._exchange(
            { type: 'getStats', senderId: sender.id }, message => message, client._controlSession))
        window.nativeReceiverStats = stats
        return { state: output.state, stats, checksums: [...window.nativeFrameChecksums],
            accepted: Number(stats.accepted) >= 2 && window.nativeFrameChecksums.has(Number(stats.checksum)) }
    })
    try {
        await expect.poll(async () => (await receiverStatus()).accepted, { timeout: 15_000 }).toBe(true)
    } catch (error) {
        error.message += '\nReceiver diagnostics: ' + JSON.stringify(await receiverStatus())
        throw error
    }
    const stats = await page.evaluate(() => window.nativeReceiverStats)
    expect(Number(stats.rejected)).toBe(0)
    expect(Number(stats.failed)).toBe(0)
    await page.evaluate(() => window.__poly.syncOutputController.stop())
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(false)
    expect(await page.evaluate(() => window.__poly.syncOutputController.state.status)).toBe('idle')
})

test('a failed native input keeps its selected identity and the enable button permits retry', async ({ page }) => {
    await setup(page, true)
    await page.evaluate(() => window.__poly.liveInputsPanel.open())
    await page.click('[data-id=sync-audio-connect]')
    await expect(page.locator('[data-id=sync-audio-status]')).toHaveText('Select a Sync input, then enable audio.')
    await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_fail_after_2')
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.click('[data-id=audio-toggle]')
        await expect(page.locator('[data-id=audio-status]')).toContainText('Sync audio:')
        await expect(page.locator('[data-id=audio-toggle]')).toHaveText('enable')
        await expect(page.locator('[data-id=audio-device]')).toHaveValue('sync-audio:audio_fail_after_2')
    }
})
