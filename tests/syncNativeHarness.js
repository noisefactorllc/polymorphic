// Shared harness for the native Sync receiver specs. Each spec file installs
// its own daemon instance so one spec's checks never inherit another spec's
// daemon state.
import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

const defaultDaemon = path.resolve(__dirname, '../../sync/build/sync_audio_test_server')
const daemonPath = process.env.SYNC_AUDIO_TEST_SERVER || defaultDaemon
// All default to the standard local serve-book endpoint; overrides exist for
// sandboxes that can only bind a restricted loopback port range.
const daemonOrigin = process.env.SYNC_TEST_ORIGIN || 'http://localhost:3017'
const daemonPort = process.env.SYNC_TEST_PORT
const audioStatePath = process.env.AUDIO_STATE_PATH
    ? path.resolve(process.env.AUDIO_STATE_PATH)
    : path.resolve('../noisemaker/shaders/src/runtime/external-input.js')

export function installNativeAudioDaemon() {
    let daemon = null
    let endpoint = null
    test.beforeAll(async () => {
        test.skip(!daemonPath || !fs.existsSync(daemonPath), 'Set SYNC_AUDIO_TEST_SERVER to the native Sync audio fixture')
        daemon = spawn(daemonPath, [
            ...(daemonPort ? ['--port', daemonPort] : []),
            '--test-origin', daemonOrigin, '--test-receiver',
        ], { stdio: ['ignore', 'pipe', 'pipe'] })
        endpoint = await new Promise((resolve, reject) => {
            // The daemon logs non-JSON operational lines (e.g. a bind
            // fallback notice) before its endpoint line, so scan each line
            // for the endpoint JSON instead of parsing the first one.
            let buffer = ''
            const timer = setTimeout(() => reject(new Error('Audio daemon startup timed out')), 10000)
            daemon.once('error', reject)
            daemon.stdout.on('data', chunk => {
                buffer += chunk
                let index
                while ((index = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, index)
                    buffer = buffer.slice(index + 1)
                    try {
                        const parsed = JSON.parse(line)
                        if (parsed && Number.isFinite(parsed.port)) {
                            clearTimeout(timer)
                            resolve(`http://127.0.0.1:${parsed.port}`)
                            return
                        }
                    } catch {
                        // Not the endpoint line yet.
                    }
                }
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
            path: audioStatePath, contentType: 'text/javascript'
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

// Raw transport cut for the real sender-close regression. A TCP forwarder in
// front of the native daemon: every connection forwards untouched, and a spec
// can tear down exactly the sender's data connections the way a network drop
// would — an abrupt teardown with no WebSocket close frame, so the daemon
// reaps the sender from the data socket it owns and the browser surfaces an
// abnormal (1006) closure. Control and audio traffic never touches the cut.
export function installSenderTransportCut(getEndpoint) {
    let forwarder = null, control = null, cutPort = null
    const dataConnections = new Set()
    const destroyDataConnections = () => {
        for (const pair of [...dataConnections]) {
            dataConnections.delete(pair)
            try { pair.client.destroy() } catch { /* Already gone. */ }
            try { pair.upstream.destroy() } catch { /* Already gone. */ }
        }
    }
    test.beforeAll(async () => {
        const upstreamPort = Number(new URL(getEndpoint()).port)
        forwarder = net.createServer(socket => {
            let upstream = null
            let head = Buffer.alloc(0)
            const pair = { client: socket, upstream: null }
            const drop = () => {
                if (pair.upstream) dataConnections.delete(pair)
                upstream?.destroy()
                socket.destroy()
            }
            socket.on('close', drop)
            socket.on('error', drop)
            socket.on('data', chunk => {
                if (upstream) return // pipe() carries the stream once established.
                head = Buffer.concat([head, chunk])
                const end = head.indexOf('\r\n\r\n')
                if (end < 0) return
                // The daemon's valid_host check requires its own port in Host;
                // the forwarder listens on a different one, so rewrite it.
                const rewritten = Buffer.from(
                    head.toString('latin1').replace(/Host: [^\r\n]+/i, `Host: 127.0.0.1:${upstreamPort}`),
                    'latin1')
                upstream = net.connect(upstreamPort, '127.0.0.1')
                pair.upstream = upstream
                upstream.on('close', drop)
                upstream.on('error', drop)
                if (/^GET \/senders\//.test(head.toString('latin1'))) dataConnections.add(pair)
                upstream.write(rewritten)
                socket.pipe(upstream)
                upstream.pipe(socket)
            })
        })
        control = http.createServer((_request, response) => {
            response.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': 2 })
            response.end('ok')
            destroyDataConnections()
        })
        await Promise.all([
            new Promise((resolve, reject) => {
                forwarder.once('error', reject)
                forwarder.listen(0, '127.0.0.1', resolve)
            }),
            new Promise((resolve, reject) => {
                control.once('error', reject)
                control.listen(0, '127.0.0.1', resolve)
            }),
        ])
        cutPort = control.address().port
    })
    test.afterAll(async () => {
        destroyDataConnections()
        if (forwarder) await new Promise(resolve => forwarder.close(resolve))
        if (control) await new Promise(resolve => control.close(resolve))
    })
    return {
        endpoint: () => `http://127.0.0.1:${forwarder.address().port}`,
        controlUrl: () => `http://127.0.0.1:${cutPort}/cut`,
        cutSenderTransports: destroyDataConnections,
    }
}

// Everything a receiver leg needs before output starts: the observed-socket
// bundle override, the full-app boot, and the audio connect/enable lifecycle
// with its bounded deadline-close retries. The audio grant it publishes is
// the one the video output reuses — the routed client refuses to pair again
// for video, so any video path that re-pairs fails the run.
export function createNativeAudioGrant(setup, getEndpoint) {
    return async function connectNativeAudioGrant(page, backend, viewport = null, endpointGetter = null) {
        const receiverEndpoint = endpointGetter || getEndpoint
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
                constructor(options) { super({ ...options, endpoint: ${JSON.stringify(receiverEndpoint())}, WebSocket: ObservedSocket, permissions: { query: async () => ({ state: 'granted' }) } }); }
                async pair() { throw new Error('Video should reuse the audio grant'); }
            }`
        }))
        await setup(page, true, backend)
        expect(await page.evaluate(() => window.__poly.renderer.backend)).toBe(backend)
        await page.evaluate(() => window.__poly.liveInputsPanel.open())
        // The daemon enforces a 1 s control-hello deadline on every new control
        // connection. On a CPU-saturated headless page (SwiftShader WebGL2 boot
        // at odd viewports) the SDK's hello can land after that deadline, the
        // daemon closes the socket (1008), and the panel surfaces
        // "control connection closed" for an explicit retry — the same retry
        // the enable button offers after a failed native input. Retry that one
        // lifecycle close a bounded number of times; every other status must
        // still reach the expected text within its own wait.
        for (let attempt = 0; ; attempt++) {
            await page.click('[data-id=sync-audio-connect]')
            try {
                await expect(page.locator('[data-id=sync-audio-status]')).toHaveText('Select a Sync input, then enable audio.')
                break
            } catch (error) {
                const status = await page.locator('[data-id=sync-audio-status]').textContent()
                if (attempt === 2 || status !== 'control connection closed') throw error
            }
        }
        await page.selectOption('[data-id=audio-device]', 'sync-audio:audio_2')
        // The enable attempt opens its own control connection, so the same
        // hello deadline can abort it; the panel then reports the failure and
        // leaves the button on "enable" for an explicit retry. Retry that one
        // lifecycle close a bounded number of times; any other failure is
        // surfaced as-is.
        for (let attempt = 0; ; attempt++) {
            await page.click('[data-id=audio-toggle]')
            try {
                await expect(page.locator('[data-id=audio-toggle]')).toHaveText('disable')
                break
            } catch (error) {
                const status = await page.locator('[data-id=audio-status]').textContent()
                if (attempt === 2 || !status.includes('control connection closed')) throw error
            }
        }
    }
}

export function createNativeReceiverConnect(setup, getEndpoint) {
    const connectNativeAudioGrant = createNativeAudioGrant(setup, getEndpoint)
    return async function connectNativeReceiver(page, backend, viewport = null, endpointGetter = null) {
        await connectNativeAudioGrant(page, backend, viewport, endpointGetter)
        await page.evaluate(async () => {
            const sync = await import('/js/sync/audioInput.js')
            await sync.connectSyncAudio()
            const { syncOutputController: output } = window.__poly
            await output.connect()
            await output.start('Polymorphic native receiver')
        })
    }
}

// Drives the Sync output lifecycle through the product's real dialog
// controls — menu open, then the dialog's own check → connect → start
// clicks — instead of direct controller calls, so the browser-level path is
// what runs. Returns the action/state locators for the spec's stop and
// reconnect clicks.
export function createNativeOutputDialogDrive(setup, getEndpoint) {
    const connectNativeAudioGrant = createNativeAudioGrant(setup, getEndpoint)
    return async function driveNativeOutputDialog(page, backend = 'webgl2') {
        await connectNativeAudioGrant(page, backend)
        await page.evaluate(() => document.getElementById('syncOutputMenuItem').click())
        const dialog = page.locator('#syncOutputDialog')
        await expect(dialog).toBeVisible()
        const action = page.locator('#syncOutputAction')
        const state = page.locator('#syncOutputStateText')
        // Opening from idle runs the availability check itself; wait for the
        // action it lands on.
        await expect(action).toHaveText('Connect Sync', { timeout: 15_000 })
        await action.click()
        await expect(state).toHaveText('Connected', { timeout: 15_000 })
        await expect(action).toHaveText('Start sending')
        await action.click()
        await expect(state).toHaveText('Sending', { timeout: 15_000 })
        await expect(page.locator('#syncOutputLiveBadge')).toBeVisible()
        return { action, state, dialog }
    }
}

// Poll the native receiver until it has accepted real rendered bytes from
// the live sender: the acceptance checksum must match one frame the browser
// actually sent, with zero rejects and zero failures. Returns the accepted
// stats. The page's output/audio stay live afterwards.
export async function pollReceiverAccepted(page) {
    const receiverStatus = () => page.evaluate(async () => {
        const output = window.__poly.syncOutputController
        const client = output._client, sender = output._sender
        if (!sender) return { state: output.state, accepted: false }
        // The daemon's 2 s incomplete-frame deadline can end the sender while
        // the poll is mid-exchange: the controller releases its client and
        // recovers through its 250 ms / 1 s / 4 s backoff, so the exchange
        // races that teardown and surfaces a lifecycle error (measured as
        // SyncLifecycleError "Sender does not exist" both when the local
        // client closed first and when the daemon answers for a gone sender).
        // Treat exactly those lifecycle classes as "not accepted yet" so the
        // poll retries inside its window; any other error still surfaces.
        let stats
        try {
            stats = await client._scheduleControl(client._controlSession, () => client._exchange(
                { type: 'getStats', senderId: sender.id }, message => message, client._controlSession))
        } catch (error) {
            const lifecycleNames = ['SyncLifecycleError', 'SyncUnavailableError', 'SyncTimeoutError', 'SyncSenderLostError']
            if (!lifecycleNames.includes(error?.name)) throw error
            return { state: output.state, accepted: false }
        }
        window.nativeReceiverStats = stats
        return { state: output.state, stats, checksums: [...window.nativeFrameChecksums],
            accepted: Number(stats.accepted) >= 2 && window.nativeFrameChecksums.has(Number(stats.checksum)) }
    })
    try {
        // The window must span one full product recovery cycle: the daemon's
        // 2 s incomplete-frame deadline can close the sender data stream on
        // a saturated page, the controller then recovers with its 250 ms /
        // 1 s / 4 s backoff, and the replacement sender needs two fresh
        // frames before the receiver accepts bytes. 15 s measured as too
        // tight for exactly that legitimate cycle on SwiftShader WebGL2;
        // the acceptance itself (receiver checksum match, zero rejects,
        // zero failures) is unchanged.
        await expect.poll(async () => (await receiverStatus()).accepted, { timeout: 45_000 }).toBe(true)
    } catch (error) {
        let diagnostics
        try { diagnostics = JSON.stringify(await receiverStatus()) } catch (diagnosticError) {
            diagnostics = 'unavailable: ' + (diagnosticError?.message || diagnosticError)
        }
        error.message += '\nReceiver diagnostics: ' + diagnostics
        throw error
    }
    const stats = await page.evaluate(() => window.nativeReceiverStats)
    expect(Number(stats.rejected)).toBe(0)
    expect(Number(stats.failed)).toBe(0)
    return stats
}

// Full receiver acceptance plus the lifecycle tail: stop the output (through
// the UI when `stop` is given), then a synthetic pagehide must disable the
// enabled audio input and leave the output controller idle.
export async function acceptNativeReceiverBytes(page, { stop } = {}) {
    await pollReceiverAccepted(page)
    if (stop) await stop(page)
    else await page.evaluate(() => window.__poly.syncOutputController.stop())
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    expect(await page.evaluate(() => window.__poly.liveInputsPanel._audioMgr.enabled)).toBe(false)
    expect(await page.evaluate(() => window.__poly.syncOutputController.state.status)).toBe('idle')
}

export function createNativeReceiverTest(setup, getEndpoint) {
    const connectNativeReceiver = createNativeReceiverConnect(setup, getEndpoint)
    return async function runNativeReceiverTest(page, backend, viewport = null) {
        await connectNativeReceiver(page, backend, viewport)
        await acceptNativeReceiverBytes(page)
    }
}