import assert from 'node:assert/strict'
import test from 'node:test'
import { liveInputsPanel } from '../../public/js/ui/liveInputsPanel.js'

test('an unavailable selected Sync input never becomes the default microphone', async t => {
    const oldDocument = globalThis.document
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    t.after(() => {
        if (oldDocument === undefined) delete globalThis.document
        else globalThis.document = oldDocument
        if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
        else delete globalThis.navigator
    })
    globalThis.document = { createElement: () => ({ value: '', textContent: '' }) }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { enumerateDevices: async () => [] } } })
    const select = { value: 'sync-audio:lost', options: [],
        set innerHTML(value) { this.options = []; this.value = '' },
        appendChild(option) { this.options.push(option); if (this.options.length === 1) this.value = option.value }
    }
    liveInputsPanel._audioDeviceSelect = select
    await liveInputsPanel._refreshAudioDevices()
    assert.equal(select.value, 'sync-audio:lost')
    assert.match(select.options.find(option => option.value === select.value).textContent, /unavailable/)
    let enabledId
    liveInputsPanel._innerRenderer = {}
    liveInputsPanel._audioMgr = { enabled: false, async enable(id) { enabledId = id; return false } }
    await liveInputsPanel._toggleAudio()
    assert.equal(enabledId, 'sync-audio:lost')
})

test('older camera enumeration cannot overwrite a newer device list', async t => {
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const oldOption = globalThis.Option
    t.after(() => {
        if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
        else delete globalThis.navigator
        if (oldOption === undefined) delete globalThis.Option
        else globalThis.Option = oldOption
    })
    let finishFirst, calls = 0
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
        enumerateDevices() { return ++calls === 1 ? new Promise(resolve => { finishFirst = resolve }) : Promise.resolve([{ kind: 'videoinput', deviceId: 'sync-camera', label: 'Sync Camera' }]) }
    } } })
    globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value } }
    const select = { value: '', options: [], replaceChildren(...options) { this.options = options }, add(option) { this.options.push(option) } }
    liveInputsPanel._cameraSelect = select
    const older = liveInputsPanel._refreshCameras()
    await liveInputsPanel._refreshCameras()
    finishFirst([])
    await older
    assert.deepEqual(select.options.map(option => option.value), ['', 'sync-camera'])
})
