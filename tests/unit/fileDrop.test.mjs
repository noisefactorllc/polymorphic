import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

// ---------------------------------------------------------------------------
// Behavioral tests for the file-drop controller in embed.js. The drop path is
// source-sliced into a vm sandbox (same strategy as
// tests/unit/editor-normalization.test.mjs) so that a failing FileReader,
// a missing synth/media effect, or a rejected video activation surfaces as a
// Handfish warning toast instead of an unhandled promise rejection.
// ---------------------------------------------------------------------------

const embedSource = readFileSync(new URL('../../public/js/embed.js', import.meta.url), 'utf8')

const dropSliceStart = embedSource.indexOf('function setupFileDrop()')
const dropSliceEnd = embedSource.indexOf('function togglePerformanceMode()')
const dropSlice = embedSource.slice(dropSliceStart, dropSliceEnd)

function makeStyle() { return { cssText: '', display: '', fontSize: '' } }

function makeOverlay() {
    const style = makeStyle()
    return {
        style,
        className: '',
        innerHTML: '',
        querySelector(sel) {
            return { '.file-drop-message': { style: makeStyle() }, '.icon-material': { style: makeStyle() } }[sel] || null
        },
    }
}

function makeSandbox({ fileReader, liveInputsPanel = { stopMediaSource: async () => {} }, renderer }) {
    const overlay = makeOverlay()
    const handlers = {}
    const dropTarget = {
        addEventListener: (type, fn) => { handlers[type] = fn },
    }
    const toasts = []
    const insertedImages = []
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        document: {
            body: {
                ...dropTarget,
                appendChild: () => {},
            },
            createElement: () => overlay,
        },
        FileReader: fileReader,
        showToast: (message, kind) => toasts.push({ message, kind }),
        publishLocalDsl: () => {},
        dslEditor: { value: 'search synth\n', },
        insertImageSource: (editor, dataUrl, globals) => insertedImages.push({ editor, dataUrl, globals }),
        getEffect: () => ({ globals: { W: 512 } }),
        renderer,
        liveInputsPanel,
    }
    vm.createContext(sandbox)
    vm.runInContext(`${dropSlice}\nsetupFileDrop();\n({ setupFileDrop, hasDraggedFiles, handleDroppedFile })`, sandbox)
    return { sandbox, handlers, toasts, insertedImages, overlay }
}

function makeFileReader({ fail = false } = {}) {
    return class {
        readAsDataURL() {
            setTimeout(() => {
                if (fail) {
                    this.onerror?.({ target: { error: new Error('read error') } })
                } else {
                    this.result = 'data:image/png;base64,AAAA'
                    this.onload?.()
                }
            }, 0)
        }
    }
}

function dropEvent(file) {
    return {
        preventDefault: () => {},
        dataTransfer: { types: ['Files'], files: [file] },
    }
}

test('file drop slice exists in embed.js', () => {
    assert.ok(dropSliceStart > 0 && dropSliceEnd > dropSliceStart, 'embed.js must expose the file-drop slice')
})

test('a failing image drop surfaces a warning toast instead of an unhandled rejection', async () => {
    const { handlers, toasts } = makeSandbox({
        fileReader: makeFileReader({ fail: true }),
    })
    const file = { name: 'sketch.png', type: 'image/png' }
    // The handler must settle (not reject) even though the FileReader failed.
    await handlers.drop(dropEvent(file))
    const warning = toasts.find(t => t.kind === 'warning')
    assert.ok(warning, 'a warning toast must be shown')
    assert.match(warning.message, /sketch\.png/)
    assert.match(warning.message, /read error|Couldn't use/)
})

test('a failing media-effect load on image drop surfaces a warning toast', async () => {
    const { handlers, toasts } = makeSandbox({
        fileReader: makeFileReader(),
        renderer: { inner: { loadEffects: async () => { throw new Error('network down') } } },
    })
    await handlers.drop(dropEvent({ name: 'photo.jpg', type: 'image/jpeg' }))
    const warning = toasts.find(t => t.kind === 'warning')
    assert.ok(warning, 'a warning toast must be shown')
    assert.match(warning.message, /photo\.jpg/)
    assert.match(warning.message, /network down/)
})

test('a successful image drop inserts the media source and reports success', async () => {
    const { handlers, toasts, insertedImages } = makeSandbox({
        fileReader: makeFileReader(),
        renderer: { inner: { loadEffects: async () => {} } },
    })
    await handlers.drop(dropEvent({ name: 'sky.png', type: 'image/png' }))
    assert.equal(insertedImages.length, 1)
    assert.equal(insertedImages[0].dataUrl, 'data:image/png;base64,AAAA')
    assert.deepEqual(insertedImages[0].globals, { W: 512 })
    const success = toasts.find(t => t.kind === 'success')
    assert.ok(success, 'a success toast must be shown')
    assert.match(success.message, /sky\.png/)
})

test('a failing video drop surfaces a warning toast', async () => {
    const { handlers, toasts } = makeSandbox({
        fileReader: makeFileReader(),
        liveInputsPanel: { useVideoFile: async () => { throw new Error('bad video') } },
    })
    await handlers.drop(dropEvent({ name: 'clip.webm', type: 'video/webm' }))
    const warning = toasts.find(t => t.kind === 'warning')
    assert.ok(warning, 'a warning toast must be shown')
    assert.match(warning.message, /clip\.webm/)
    assert.match(warning.message, /bad video/)
})

test('non-file drops and unsupported types stay silent or warn without throwing', async () => {
    const { handlers, toasts } = makeSandbox({
        fileReader: makeFileReader(),
        liveInputsPanel: { useVideoFile: async () => {} },
    })
    await handlers.drop({ preventDefault: () => {}, dataTransfer: { types: ['text/plain'], files: [] } })
    assert.equal(toasts.length, 0, 'non-file drags must not toast')
    await handlers.drop(dropEvent({ name: 'notes.txt', type: 'text/plain' }))
    const warning = toasts.find(t => t.kind === 'warning')
    assert.ok(warning, 'unsupported type must warn')
    assert.match(warning.message, /Unsupported file type/)
})
