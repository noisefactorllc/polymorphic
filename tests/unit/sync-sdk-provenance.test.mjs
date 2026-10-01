import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => readFile(resolve(root, relative), 'utf8')

// The audio integration is pinned to the 0.3.0 snapshot that shipped with
// native multichannel audio input. The 0.3.3 browser delta (packed H.264
// sender, NV12/H264AnnexB packing, WebGL2 in-place row flip, and the
// audio_unavailable -> SyncUnavailableError classification) is output-focused
// and unused by the audio path, so the pin is an intentional product
// difference — not drift. This contract locks the wiring so a future edit
// cannot silently repoint a production module at an unverified snapshot.
const PINNED_SNAPSHOTS = Object.freeze({
    audio: '0.3.0',
    output: '0.3.3'
})

test('the audio integration imports the pinned audio SDK snapshot', async () => {
    const audioModule = await read('public/js/sync/audio.js')
    assert.match(audioModule,
        /export \{ SyncBridgeClient \} from '\.\/sdk\/0\.3\.0\/browser\/index\.js'/,
        'audio.js must re-export SyncBridgeClient from the pinned 0.3.0 snapshot')
    const audioClient = await import('../../public/js/sync/audio.js')
    const pinnedClient = await import('../../public/js/sync/sdk/0.3.0/browser/index.js')
    assert.equal(audioClient.SyncBridgeClient, pinnedClient.SyncBridgeClient)
})

test('the shared sync bundle exports the pinned output SDK snapshot at runtime', async () => {
    const bundleModule = await read('public/js/sync/bundle.js')
    assert.match(bundleModule,
        /export \* from '\.\/sdk\/0\.3\.3\/browser\/index\.js'/,
        'bundle.js must re-export the pinned 0.3.3 snapshot')
    const bundle = await import('../../public/js/sync/bundle.js')
    const pinned = await import('../../public/js/sync/sdk/0.3.3/browser/index.js')
    assert.equal(bundle.SYNC_SDK_VERSION, '0.3.3')
    assert.equal(bundle.SYNC_SDK_VERSION, pinned.SYNC_SDK_VERSION)
    assert.equal(bundle.SyncBridgeClient, pinned.SyncBridgeClient)
})

test('every production SDK import points at a pinned snapshot with checksums', async () => {
    const sources = [
        'public/js/sync/audio.js',
        'public/js/sync/bundle.js',
        'public/js/syncOutput.js',
        'public/js/syncH264CanvasSender.js',
        'public/js/syncH264EncoderWorker.js',
        'public/js/sync/audioInput.js',
        'public/js/sync/cameraSession.js',
        'public/js/sync/cameraFrameQueue.js',
        'public/js/sync/audioChannels.js',
        'public/js/sync/credentials.js'
    ]
    for (const relative of sources) {
        const source = await read(relative)
        for (const match of source.matchAll(/'\.\/?sync?\/?\.?\/?(sdk\/(0\.\d+\.\d+)\/browser\/[^']*)'/g)) {
            const [, specifier, version] = match
            assert.ok(
                Object.values(PINNED_SNAPSHOTS).includes(version),
                `${relative} imports SDK ${version} which is not a pinned snapshot`)
            await assert.doesNotReject(() => readFile(resolve(root, 'public/js/sync', specifier)))
        }
    }
    for (const version of Object.values(PINNED_SNAPSHOTS)) {
        const sums = await readFile(resolve(root, `public/js/sync/sdk/${version}/SHA256SUMS`), 'utf8')
        assert.match(sums, /^[a-f0-9]{64}  browser\//m,
            `snapshot ${version} must keep its immutable manifest`)
    }
})

test('the output controller and H.264 sender consume the shared bundle, not a stray snapshot', async () => {
    const output = await read('public/js/syncOutput.js')
    assert.match(output, /import \{ SyncBridgeClient \} from '\.\/sync\/bundle\.js'/)
    const sender = await read('public/js/syncH264CanvasSender.js')
    assert.match(sender, /from '\.\/sync\/bundle\.js'/)
    assert.doesNotMatch(output, /sdk\/0\.\d+\.\d+\/browser/)
    assert.doesNotMatch(sender, /sdk\/0\.\d+\.\d+\/browser/)
})