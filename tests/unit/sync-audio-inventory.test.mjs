import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SharedAudio } from '../../public/js/audio.js'

test('native audio forwards the complete current discovery inventory to every renderer state', async t => {
    const originals = [globalThis.AudioWorkletNode, globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame]
    t.after(() => { [globalThis.AudioWorkletNode, globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = originals })
    const node = () => ({ connect() {}, disconnect() {} })
    globalThis.AudioWorkletNode = class { constructor() { this.port = {} } connect() {} disconnect() {} }
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {}
    const context = {
        destination: {}, async resume() {}, async close() {}, createChannelSplitter: node,
        createAnalyser: () => ({ ...node(), frequencyBinCount: 128, fftSize: 256,
            getByteFrequencyData(bytes) { bytes.fill(0) }, getByteTimeDomainData(bytes) { bytes.fill(128) } })
    }
    const devices = [
        { id: 'sync-audio:left', name: 'Same interface', connected: true, channelCount: 1 },
        { id: 'sync-audio:right', name: 'Same interface', connected: true, channelCount: 2 }
    ]
    let inventory = devices
    const audio = new SharedAudio({ syncAudio: {
        getSyncAudioDevices: () => inventory,
        openSyncAudioSource: async () => ({ context, source: node(), channelCount: 1, bridge: { stop() {} } })
    } })
    t.after(() => audio.disable())
    const seen = []
    const state = { setDeviceInventory(devices) { seen.push(devices.map(device => ({ ...device }))) } }
    audio.addDeck({ ensureAudioState: () => state })
    assert.equal(await audio.enable('sync-audio:left'), true)
    assert.deepEqual(seen.at(-1), devices)
    inventory = [devices[0], { ...devices[1], connected: false }]
    audio._loop()
    assert.deepEqual(seen.at(-1), inventory)
    const added = []
    audio.addDeck({ ensureAudioState: () => ({ setDeviceInventory(devices) { added.push(devices) } }) })
    audio._loop()
    assert.deepEqual(added.at(-1), inventory)
    await audio.disable()
    assert.deepEqual(seen.at(-1), [])
})
