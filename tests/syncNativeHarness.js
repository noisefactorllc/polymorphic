// Shared harness for the native Sync receiver specs. Each spec file installs
// its own daemon instance so one spec's checks never inherit another spec's
// daemon state.
import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const defaultDaemon = path.resolve(__dirname, '../../sync/build/sync_audio_test_server')
const daemonPath = process.env.SYNC_AUDIO_TEST_SERVER || defaultDaemon

export function installNativeAudioDaemon() {
    let daemon = null
    let endpoint = null
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
    return () => endpoint
}

export function createSetup(getEndpoint) {
    return async function setup(page, fullApp = false, backend = 'webgl2') {
        await page.route('**/js/sync/audio.js', route => route.fulfill({
            contentType: 'text/javascript',
            body: `import { SyncBridgeClient as Base } from '/js/sync/sdk/0.3.0/browser/index.js';
            export class SyncBridgeClient extends Base {
                constructor(options) { super({ timeoutMs: 15000, ...options, endpoint: ${JSON.stringify(getEndpoint())}, permissions: { query: async () => ({ state: 'granted' }) } }); }
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
}

export function createNativeReceiverTest(setup, getEndpoint) {
    return async function runNativeReceiverTest(page, backend, viewport = null) {
        if (viewport) {
            // The app floors CSS×DPR for the canvas buffer, so an odd CSS
            // viewport yields an odd frame geometry. The compressed H.264 path
            // cannot serve that size; the output must start through the RGBA
            // export-queue fallback and still deliver real receiver bytes.
            await page.setViewportSize(viewport)
        }
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
                constructor(options) { super({ ...options, endpoint: ${JSON.stringify(getEndpoint())}, WebSocket: ObservedSocket, permissions: { query: async () => ({ state: 'granted' }) } }); }
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
    }
}