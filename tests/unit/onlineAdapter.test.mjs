import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_SEANCE_SDK_URL,
    DEFAULT_SEANCE_URL,
    MAX_REMOTE_DSL_LENGTH,
    applyRemoteDslText,
    createPolymorphicOnlineAdapter,
    describeSeanceError,
    getInitialDocs,
    inspectRemoteDsl,
    isTerminalJoinError,
    resolveOnlineConfig,
    shareBaseUrl,
} from '../../public/js/onlineAdapter.js'
import { hasLocalSeanceHarness, resolveSeanceHarnessPaths } from '../seanceLocal.js'

test('online adapter uses the rolling major SDK URL by default', () => {
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.test/?backend=webgl2',
    })

    assert.equal(config.seanceUrl, DEFAULT_SEANCE_URL)
    assert.equal(config.sdkUrl, DEFAULT_SEANCE_SDK_URL)
    assert.equal(DEFAULT_SEANCE_SDK_URL, 'https://seance.noisefactor.io/sdk/0/index.js')
})

test('online adapter allows tests to override SDK and server URLs on a dev host', () => {
    const config = resolveOnlineConfig({
        location: 'http://localhost:3000/?seanceUrl=http%3A%2F%2F127.0.0.1%3A8123&seanceSdk=https%3A%2F%2Fseance.noisefactor.io%2Fsdk%2F0%2Findex.js',
    })

    assert.equal(config.seanceUrl, 'http://127.0.0.1:8123')
    assert.equal(config.sdkUrl, 'https://seance.noisefactor.io/sdk/0/index.js')
})

test('online adapter ignores URL overrides on a public origin', () => {
    // sdkUrl reaches import(): honouring it off localhost would let any share
    // link execute the sender's module on polymorphic.noisedeck.app.
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.noisedeck.app/?seance=Ab12Cd&seanceSdk=https%3A%2F%2Fevil.example%2Fx.js&seanceUrl=https%3A%2F%2Fevil.example',
    })

    assert.equal(config.sdkUrl, DEFAULT_SEANCE_SDK_URL)
    assert.equal(config.seanceUrl, DEFAULT_SEANCE_URL)
})

test('a window global still configures an embedder on a public origin', () => {
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.noisedeck.app/',
        globals: { seanceUrl: 'https://seance.example', sdkUrl: 'https://seance.example/sdk/0/index.js' },
    })

    assert.equal(config.seanceUrl, 'https://seance.example')
    assert.equal(config.sdkUrl, 'https://seance.example/sdk/0/index.js')
})

test('getInitialDocs produces one default main DSL document from current editor text', () => {
    assert.deepEqual(getInitialDocs('search synth\n\nnoise().write(o0)'), [
        {
            id: 'main',
            title: 'Program',
            kind: 'noisemaker-dsl',
            text: 'search synth\n\nnoise().write(o0)',
            default: true,
        },
    ])
})

test('shareBaseUrl strips volatile share code while preserving durable params', () => {
    const url = shareBaseUrl('https://polymorphic.test/?code=ttl123&backend=webgpu&dsl=abc#frag')

    assert.equal(url, 'https://polymorphic.test/?backend=webgpu&dsl=abc#frag')
})

test('applyRemoteDslText recompiles through the host path after the editor is current', async () => {
    const calls = []
    const editor = { value: 'remote text' }

    await applyRemoteDslText('remote text', { source: 'snapshot' }, {
        editor,
        applyCurrentDsl: async (source) => {
            calls.push({ source, text: editor.value })
            return { success: true }
        },
    })

    assert.deepEqual(calls, [{ source: 'snapshot', text: 'remote text' }])
})

test('applyRemoteDslText preserves invalid remote text in editor and reports compile failure', async () => {
    const editor = { value: 'last good' }
    const failures = []

    const result = await applyRemoteDslText('not valid @@@', { source: 'remote' }, {
        editor,
        applyCurrentDsl: async (source) => {
            failures.push({ source, text: editor.value })
            return { success: false, error: 'bad syntax' }
        },
    })

    assert.deepEqual(failures, [{ source: 'remote', text: 'not valid @@@' }])
    assert.deepEqual(result, { success: false, error: 'bad syntax' })
    assert.equal(editor.value, 'not valid @@@')
})

test('switching sessions closes the active SDK connection before reconnecting', async () => {
    const calls = []
    const layer = {
        status: 'offline',
        sessionId: '',
        on() { return () => {} },
        bindEditor() { return () => {} },
        async takeOnline(seedDocs) {
            calls.push({ type: 'takeOnline', seedDocs })
            this.status = 'online'
            this.sessionId = `S${calls.length}`
        },
        async joinSession(sessionId) {
            calls.push({ type: 'joinSession', sessionId })
            this.status = 'online'
            this.sessionId = sessionId
        },
        goOffline() {
            calls.push({ type: 'goOffline', sessionId: this.sessionId })
            this.status = 'offline'
        },
        getStatus() { return this.status },
        getSessionId() { return this.sessionId },
        getShareUrl() { return this.sessionId ? `https://poly.test/?seance=${this.sessionId}` : null },
        writeSessionToUrl(url, sessionId) {
            const next = new URL(url)
            if (sessionId) next.searchParams.set('seance', sessionId)
            else next.searchParams.delete('seance')
            return next.toString()
        },
    }
    const adapter = createPolymorphicOnlineAdapter({
        editor: { value: 'search synth\n\nnoise().write(o0)' },
        importSdk: async () => ({ createOnlineDslLayer: () => layer }),
        location: new URL('https://poly.test/?dsl=one'),
        history: { replaceState() {} },
    })

    await adapter.takeOnline()
    await adapter.joinSession('NEXT01')
    await adapter.takeOnline()

    assert.deepEqual(calls.map((call) => call.type), [
        'takeOnline',
        'goOffline',
        'joinSession',
        'goOffline',
        'takeOnline',
    ])
})

test('local Seance harness paths can be inferred from SDK and Python overrides', () => {
    const paths = resolveSeanceHarnessPaths({
        env: {
            SEANCE_SDK_DIR: '/tmp/custom-seance/sdk',
            SEANCE_PYTHON: '/tmp/custom-seance/.venv/bin/python',
        },
        cwd: '/tmp/polymorphic',
    })

    assert.deepEqual(paths, {
        root: '/tmp/custom-seance',
        sdkDir: '/tmp/custom-seance/sdk',
        python: '/tmp/custom-seance/.venv/bin/python',
        app: '/tmp/custom-seance/bin/app.py',
    })

    const existing = new Set([
        '/tmp/custom-seance/sdk/index.js',
        '/tmp/custom-seance/.venv/bin/python',
        '/tmp/custom-seance/bin/app.py',
    ])
    assert.equal(hasLocalSeanceHarness(paths, (path) => existing.has(path)), true)
})


// --- helpers ---------------------------------------------------------------

function fakeLayer(overrides = {}) {
    return {
        status: 'offline',
        sessionId: '',
        calls: [],
        handlers: {},
        on(event, handler) {
            this.handlers[event] = handler
            return () => { delete this.handlers[event] }
        },
        bindEditor() { return () => {} },
        async takeOnline() {
            this.calls.push('takeOnline')
            await new Promise((resolve) => setTimeout(resolve, 5))
            this.status = 'online'
            this.sessionId = `S${this.calls.length}`
        },
        async joinSession(sessionId) {
            this.calls.push('joinSession')
            this.status = 'online'
            this.sessionId = sessionId
        },
        goOffline() { this.calls.push('goOffline'); this.status = 'offline' },
        getStatus() { return this.status },
        getSessionId() { return this.sessionId },
        getShareUrl() { return this.sessionId ? `https://poly.test/?seance=${this.sessionId}` : null },
        writeSessionToUrl(url, sessionId) {
            const next = new URL(url)
            if (sessionId) next.searchParams.set('seance', sessionId)
            else next.searchParams.delete('seance')
            return next.toString()
        },
        ...overrides,
    }
}

function harness(layer, options = {}) {
    const toasts = []
    const urls = []
    const dialog = { state: 'offline', sessionId: '', sessionUrl: '', addEventListener() {} }
    const adapter = createPolymorphicOnlineAdapter({
        editor: { value: 'search synth\n\nnoise().write(o0)' },
        importSdk: async () => ({ createOnlineDslLayer: () => layer }),
        location: new URL(options.href || 'https://poly.test/?seance=OLD123'),
        history: { replaceState(_state, _title, url) { urls.push(url) } },
        dialog,
        showToast: (message, type) => toasts.push({ message, type }),
    })
    return { adapter, toasts, urls, dialog }
}

// --- remote text inspection ------------------------------------------------

test('inspectRemoteDsl reports media urls that point off this machine', () => {
    const result = inspectRemoteDsl('search synth\n\nmedia(url: "https://tracker.example/pixel.png").write(o0)')

    assert.equal(result.ok, true)
    assert.deepEqual(result.externalMedia, ['https://tracker.example/pixel.png'])
})

test('inspectRemoteDsl leaves inline media alone', () => {
    const result = inspectRemoteDsl('media(url: "data:image/png;base64,AAAA").write(o0)')

    assert.equal(result.ok, true)
    assert.deepEqual(result.externalMedia, [])
})

test('inspectRemoteDsl refuses a document nobody could have typed', () => {
    const result = inspectRemoteDsl('x'.repeat(MAX_REMOTE_DSL_LENGTH + 1))

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'too-large')
})

test('applyRemoteDslText refuses an oversize document without touching the editor', async () => {
    const editor = { value: 'last good' }
    const rejected = []
    let compiled = false

    const result = await applyRemoteDslText('x'.repeat(MAX_REMOTE_DSL_LENGTH + 1), { source: 'remote' }, {
        editor,
        applyCurrentDsl: async () => { compiled = true; return { success: true } },
        onRemoteRejected: (inspection) => rejected.push(inspection.reason),
    })

    assert.equal(result.success, false)
    assert.equal(editor.value, 'last good')
    assert.equal(compiled, false)
    assert.deepEqual(rejected, ['too-large'])
})

test('applyRemoteDslText reports remote media before running the program', async () => {
    const seen = []
    const order = []
    const editor = { value: '' }

    await applyRemoteDslText('media(url: "http://peer.example/a.png").write(o0)', { source: 'remote' }, {
        editor,
        applyCurrentDsl: async () => { order.push('compile'); return { success: true } },
        onRemoteMedia: (urls) => { seen.push(...urls); order.push('warn') },
    })

    assert.deepEqual(seen, ['http://peer.example/a.png'])
    assert.deepEqual(order, ['warn', 'compile'])
})

// --- server errors ----------------------------------------------------------

test('server error codes become copy a person can act on', () => {
    assert.equal(describeSeanceError({ code: 'dialect_mismatch', message: "session dialect is 'layers'" }),
        'That link is for a different kind of session')
    assert.equal(describeSeanceError({ frame: { code: 'unknown_session' } }),
        'That session has ended or never existed')
    // Anything unmapped still says something rather than nothing.
    assert.equal(describeSeanceError(new Error('socket closed')), 'socket closed')
})

test('only the codes a retry cannot fix count as terminal', () => {
    assert.equal(isTerminalJoinError({ code: 'unknown_session' }), true)
    assert.equal(isTerminalJoinError({ code: 'dialect_mismatch' }), true)
    assert.equal(isTerminalJoinError({ code: 'rate_limited' }), false)
    assert.equal(isTerminalJoinError(new Error('connection closed')), false)
})

// --- session lifecycle ------------------------------------------------------

test('a double click on take online creates one session, not two', async () => {
    const layer = fakeLayer()
    const { adapter } = harness(layer)

    const [first, second] = await Promise.all([adapter.takeOnline(), adapter.takeOnline()])

    assert.equal(layer.calls.filter((call) => call === 'takeOnline').length, 1)
    assert.equal(first, 'S1')
    assert.equal(second, null)
})

test('a dead session link is cleared from the URL instead of retried forever', async () => {
    const layer = fakeLayer({
        async joinSession() {
            const error = new Error("session dialect is 'layers'")
            error.code = 'unknown_session'
            throw error
        },
    })
    const { adapter, toasts, urls } = harness(layer)

    const result = await adapter.joinFromUrl()

    assert.equal(result, null)
    assert.equal(urls.at(-1), 'https://poly.test/')
    assert.deepEqual(toasts.at(-1), {
        message: 'Could not join session: That session has ended or never existed',
        type: 'error',
    })
})

test('a join failure that might recover leaves the session link in place', async () => {
    const layer = fakeLayer({
        async joinSession() {
            const error = new Error('connection closed before session snapshot')
            throw error
        },
    })
    const { adapter, urls } = harness(layer)

    await adapter.joinFromUrl()

    assert.deepEqual(urls, [])
})

test('read-only reaches the dialog as its own state', async () => {
    const layer = fakeLayer()
    const { adapter, dialog } = harness(layer)

    await adapter.takeOnline()
    layer.status = 'readonly'
    adapter.refreshStatus('readonly')

    assert.equal(dialog.state, 'readonly')
    assert.equal(dialog.sessionId, 'S1')
})

test('a read-only write attempt tells the user why nothing happened', async () => {
    const layer = fakeLayer()
    const { adapter, toasts } = harness(layer)

    await adapter.ensureOnline()
    layer.handlers['readonly-write']({ docId: 'main' })

    assert.deepEqual(toasts.at(-1), {
        message: 'You are read-only in this session',
        type: 'warning',
    })
})
