import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_RECONNECT_BASE_MS,
    DEFAULT_RECONNECT_JITTER,
    DEFAULT_RECONNECT_MAX_MS,
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

// Joining by an upper-case code looks each of its case variants up on the
// Seance server. These tests must never reach the production server, so every
// fetch here gets the 404 the server gives an unknown session.
globalThis.fetch = async () => new Response(null, { status: 404 })

test('online adapter uses the rolling major SDK URL by default', () => {
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.test/?backend=webgl2',
    })

    assert.equal(config.seanceUrl, DEFAULT_SEANCE_URL)
    assert.equal(config.sdkUrl, DEFAULT_SEANCE_SDK_URL)
    assert.equal(DEFAULT_SEANCE_SDK_URL, 'https://seance.noisefactor.io/sdk/0/index.js?v=images-20261006')
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

test('taking an image composition online seeds separate original assets and short references', async () => {
    let seed
    const images = [{ id: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AAAA' }]
    const editor = { value: 'media(url:"data:image/png;base64,AAAA").write(o0)' }
    const layer = {
        on() { return () => {} }, bindEditor() {}, getStatus: () => 'offline', getSessionId: () => 'ImageSession',
        async takeOnline(value) { seed = value }, getShareUrl: () => '', writeSessionToUrl: url => url,
    }
    const adapter = createPolymorphicOnlineAdapter({
        editor, location: 'https://polymorphic.test/', history: { replaceState() {} },
        importSdk: async () => ({ createOnlineDslLayer: () => layer }),
        prepareImages: async () => ({ dsl: `media(url:"image:${images[0].id}").write(o0)`, images }),
    })
    await adapter.takeOnline()
    assert.deepEqual(seed.images, images)
    assert.equal(seed.docs[0].text, `media(url:"image:${images[0].id}").write(o0)`)
    assert.equal(editor.value, seed.docs[0].text)
})

test('live image edits upload bytes before the reference and read-only editors never upload', async () => {
    const editor = { value: 'media(url:"local").write(o0)' }
    const image = { id: 'b'.repeat(64), dataUrl: 'original bytes' }
    const events = []
    let release
    const layer = {
        status: 'online', on() { return () => {} }, bindEditor() {}, getStatus() { return this.status },
        getSessionId: () => 'ImageSession',
        uploadImage: async () => { events.push('upload'); await new Promise(resolve => { release = resolve }) },
        updateLocalText: (id, text) => events.push([id, text]),
    }
    const adapter = createPolymorphicOnlineAdapter({
        editor, location: 'https://polymorphic.test/',
        importSdk: async () => ({ createOnlineDslLayer: () => layer }),
        prepareImages: async () => ({ dsl: 'media(url:"image:resolved").write(o0)', images: [image] }),
        imageBlob: async asset => asset,
    })
    await adapter.ensureOnline()
    const pending = adapter.updateLocalText()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(events, ['upload'])
    release()
    await pending
    assert.deepEqual(events[1], ['main', 'media(url:"image:resolved").write(o0)'])
    layer.status = 'readonly'
    editor.value = 'media(url:"local").write(o0)'
    await adapter.updateLocalText()
    assert.equal(events.length, 2)
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
        updateLocalText(docId, text, meta) {
            this.calls.push({ type: 'updateLocalText', docId, text, meta })
            return null
        },
        ...overrides,
    }
}

function harness(layer, options = {}) {
    const toasts = []
    const urls = []
    const dialogAttrs = new Map()
    const dialog = {
        state: 'offline',
        sessionId: '',
        sessionUrl: '',
        setAttribute(k, v) { dialogAttrs.set(k, String(v)) },
        removeAttribute(k) { dialogAttrs.delete(k) },
        getAttribute(k) { return dialogAttrs.has(k) ? dialogAttrs.get(k) : null },
        addEventListener() {},
    }
    const adapter = createPolymorphicOnlineAdapter({
        editor: { value: 'search synth\n\nnoise().write(o0)' },
        importSdk: async () => ({
            createOnlineDslLayer: (opts) => {
                if (typeof layer === 'function') return layer(opts)
                layer.options = opts
                return layer
            },
        }),
        location: new URL(options.href || 'https://poly.test/?seance=OLD123'),
        history: { replaceState(_state, _title, url) { urls.push(url) } },
        dialog,
        showToast: (message, type) => toasts.push({ message, type }),
        ...options.adapterOptions,
    })
    return { adapter, toasts, urls, dialog, dialogAttrs }
}

test('a failed SDK import can be retried without reloading the page', async () => {
    const layer = fakeLayer()
    let attempts = 0
    const adapter = createPolymorphicOnlineAdapter({
        editor: { value: 'noise().write(o0)' },
        location: new URL('https://poly.test/'),
        importSdk: async () => {
            if (++attempts === 1) throw new Error('temporary network failure')
            return { createOnlineDslLayer: () => layer }
        },
    })
    await assert.rejects(adapter.takeOnline(), /temporary network failure/)
    await adapter.takeOnline()
    assert.equal(adapter.getStatus(), 'online')
    assert.equal(attempts, 2)
    adapter.dispose()
})

test('an ambiguous reconnect explains how to preserve and recover the local draft', async () => {
    const layer = fakeLayer()
    const { adapter, toasts } = harness(layer)
    await adapter.ensureOnline()
    for (const reason of ['reconnect_ambiguous', 'readonly_draft']) {
        toasts.length = 0
        layer.handlers['doc-reject']?.({ reason, docId: 'main' })
        assert.match(toasts.at(-1)?.message || '', /copy.*draft.*rejoin/i)
    }
    adapter.dispose()
})

test('an absent session document explains how to keep and share the local draft', async () => {
    const layer = fakeLayer()
    const { adapter, toasts } = harness(layer)
    await adapter.ensureOnline()
    layer.handlers['doc-reject']?.({ reason: 'missing_document', docId: 'main' })
    assert.match(toasts.at(-1)?.message || '', /not.*session.*copy.*draft.*new session/i)
    adapter.dispose()
})

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

// --- reconnection backoff & status -----------------------------------------

test('online adapter forwards exponential backoff parameters to Seance SDK layer', async () => {
    const layer = fakeLayer()
    const { adapter } = harness(layer, {
        adapterOptions: {
            reconnectBaseMs: 250,
            reconnectMaxMs: 4000,
            reconnectJitter: 0.1,
            maxReconnectAttempts: 5,
        },
    })

    assert.deepEqual(adapter.reconnectConfig, {
        baseMs: 250,
        maxMs: 4000,
        jitter: 0.1,
        maxAttempts: 5,
    })

    await adapter.ensureOnline()
    assert.equal(layer.options.reconnectBaseMs, 250)
    assert.equal(layer.options.reconnectMaxMs, 4000)
    assert.equal(layer.options.reconnectJitter, 0.1)
    adapter.dispose()
})

test('online adapter applies standard defaults for exponential backoff parameters', async () => {
    const layer = fakeLayer()
    const { adapter } = harness(layer)

    assert.deepEqual(adapter.reconnectConfig, {
        baseMs: DEFAULT_RECONNECT_BASE_MS,
        maxMs: DEFAULT_RECONNECT_MAX_MS,
        jitter: DEFAULT_RECONNECT_JITTER,
        maxAttempts: 0,
    })

    await adapter.ensureOnline()
    assert.equal(layer.options.reconnectBaseMs, 500)
    assert.equal(layer.options.reconnectMaxMs, 8000)
    assert.equal(layer.options.reconnectJitter, 0.25)
    adapter.dispose()
})

test('a recoverable WebSocket disconnect initiates reconnecting status and warns user once', async () => {
    const layer = fakeLayer()
    const { adapter, toasts, dialog, dialogAttrs } = harness(layer)

    await adapter.takeOnline()
    assert.equal(adapter.isReconnecting(), false)
    assert.equal(adapter.getReconnectAttempt(), 0)

    // Layer drops socket and initiates reconnect attempt 0
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0, code: 1006 })

    assert.equal(adapter.isReconnecting(), true)
    assert.equal(adapter.getReconnectAttempt(), 1)
    assert.equal(dialog.state, 'connecting')
    assert.equal(dialog.sessionId, 'S1')
    assert.equal(dialogAttrs.get('connecting-label'), 'Reconnecting…')
    assert.deepEqual(toasts.at(-1), {
        message: 'Connection lost. Reconnecting...',
        type: 'warning',
    })

    adapter.dispose()
})

test('repeated backoff errors during reconnection are suppressed from toast spam', async () => {
    const layer = fakeLayer()
    const { adapter, toasts } = harness(layer)

    await adapter.takeOnline()
    const baselineToastCount = toasts.length // 1 ('Session is online')

    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(toasts.length, baselineToastCount + 1)
    assert.equal(toasts.at(-1)?.message, 'Connection lost. Reconnecting...')

    // Retry 1 fails: socket error fires, followed by next disconnect attempt
    layer.handlers['error']?.(new Error('WebSocket connection failed'))
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 1 })

    // Toast count should NOT increase; repeated reconnect errors are suppressed
    assert.equal(toasts.length, baselineToastCount + 1)
    assert.equal(adapter.getReconnectAttempt(), 2)

    // Retry 2 fails
    layer.handlers['error']?.(new Error('WebSocket connection failed'))
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 2 })
    assert.equal(toasts.length, baselineToastCount + 1)
    assert.equal(adapter.getReconnectAttempt(), 3)

    adapter.dispose()
})

test('reconnection recovery clears reconnecting state, updates dialog, and notifies user', async () => {
    const layer = fakeLayer()
    let reconnectedFired = false
    const { adapter, toasts, dialog, dialogAttrs } = harness(layer, {
        adapterOptions: {
            onReconnected: () => { reconnectedFired = true },
        },
    })

    await adapter.takeOnline()
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(adapter.isReconnecting(), true)

    // Connection restored; layer status flips to online
    layer.status = 'online'
    layer.handlers['status']?.('online')

    assert.equal(adapter.isReconnecting(), false)
    assert.equal(adapter.getReconnectAttempt(), 0)
    assert.equal(reconnectedFired, true)
    assert.equal(dialogAttrs.has('connecting-label'), false)
    assert.equal(dialog.state, 'online')
    assert.deepEqual(toasts.at(-1), {
        message: 'Reconnected to session',
        type: 'success',
    })

    // Local edits are re-synchronized
    const syncCalls = layer.calls.filter((c) => typeof c === 'object' && c.type === 'updateLocalText')
    assert.ok(syncCalls.length > 0)
    assert.equal(syncCalls.at(-1)?.meta?.source, 'reconnect')

    adapter.dispose()
})

test('a code retyped in capitals takes one lookup and joins the session by its own id', async () => {
    const layer = fakeLayer()
    const { adapter } = harness(layer)
    const lookups = []
    const stub = globalThis.fetch
    globalThis.fetch = async (url) => {
        lookups.push(String(url))
        return new Response(JSON.stringify({ id: 'RouFjG', open: true, dialect: 'noisemaker-dsl' }), { status: 200 })
    }
    try {
        await adapter.joinSession('ROUFJG')
    } finally {
        globalThis.fetch = stub
    }
    assert.equal(lookups.length, 1)
    assert.match(lookups[0], /\/v1\/sessions\/ROUFJG$/)
    assert.equal(adapter.getSessionId(), 'RouFjG')
    adapter.dispose()
})

test('a terminal server close during reconnection ends the session and cleans up URL', async () => {
    const layer = fakeLayer()
    const { adapter, toasts, urls, dialog } = harness(layer)

    await adapter.joinSession('TERM99')
    assert.equal(adapter.getSessionId(), 'TERM99')

    // Disconnect with real Seance SDK terminal disconnect payload (numeric code, hyphenated kind, no error property)
    layer.handlers['disconnect']?.({
        willReconnect: false,
        code: 4404,
        reason: '',
        kind: 'unknown-session',
        attempt: 0,
    })

    assert.equal(adapter.isReconnecting(), false)
    assert.equal(adapter.getStatus(), 'offline')
    assert.equal(dialog.state, 'offline')
    assert.equal(urls.at(-1), 'https://poly.test/')
    assert.deepEqual(toasts.at(-1), {
        message: 'Disconnected: That session has ended or never existed',
        type: 'error',
    })

    adapter.dispose()
})

test('reconnecting into a read-only state does not trigger local text resync', async () => {
    const layer = fakeLayer()
    const { adapter, toasts, dialog } = harness(layer)

    await adapter.takeOnline()
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(adapter.isReconnecting(), true)

    // Clear prior calls
    layer.calls.length = 0

    // Reconnected, but now as readonly (e.g. host moderated user during drop)
    layer.status = 'readonly'
    layer.handlers['status']?.('readonly')

    assert.equal(adapter.isReconnecting(), false)
    assert.equal(dialog.state, 'readonly')
    assert.deepEqual(toasts.at(-1), {
        message: 'Reconnected to session',
        type: 'success',
    })

    // Local edit resync must NOT be attempted when readonly
    const syncCalls = layer.calls.filter((c) => typeof c === 'object' && c.type === 'updateLocalText')
    assert.equal(syncCalls.length, 0)

    adapter.dispose()
})

test('dispose clears reconnecting state and resets dialog to offline', async () => {
    const layer = fakeLayer()
    const { adapter, dialog, dialogAttrs } = harness(layer)

    await adapter.takeOnline()
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(adapter.isReconnecting(), true)
    assert.equal(dialogAttrs.get('connecting-label'), 'Reconnecting…')

    adapter.dispose()
    assert.equal(adapter.isReconnecting(), false)
    assert.equal(dialog.state, 'offline')
    assert.equal(dialogAttrs.has('connecting-label'), false)
})

test('maxReconnectAttempts bounds the retry loop and goes offline if exceeded', async () => {
    const layer = fakeLayer()
    let disconnectedInfo = null
    const { adapter, toasts, urls, dialog } = harness(layer, {
        adapterOptions: {
            maxReconnectAttempts: 2,
            onDisconnect: (info) => { disconnectedInfo = info },
        },
    })

    await adapter.takeOnline()

    // 1st attempt: within bounds
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(adapter.isReconnecting(), true)
    assert.equal(adapter.getReconnectAttempt(), 1)

    // 2nd attempt: within bounds
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 1 })
    assert.equal(adapter.isReconnecting(), true)
    assert.equal(adapter.getReconnectAttempt(), 2)

    // 3rd attempt: exceeds maxReconnectAttempts = 2
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 2 })
    assert.equal(adapter.isReconnecting(), false)
    assert.equal(adapter.getReconnectAttempt(), 0)
    assert.equal(adapter.getStatus(), 'offline')
    assert.equal(dialog.state, 'offline')
    assert.equal(urls.at(-1), 'https://poly.test/')
    assert.equal(disconnectedInfo?.maxAttemptsExceeded, true)
    assert.deepEqual(toasts.at(-1), {
        message: 'Could not reconnect to session: connection timed out',
        type: 'error',
    })

    adapter.dispose()
})

test('user going offline manually cancels active reconnection', async () => {
    const layer = fakeLayer()
    const { adapter, toasts, dialog, dialogAttrs } = harness(layer)

    await adapter.takeOnline()
    layer.handlers['disconnect']?.({ willReconnect: true, attempt: 0 })
    assert.equal(adapter.isReconnecting(), true)

    adapter.goOffline()
    assert.equal(adapter.isReconnecting(), false)
    assert.equal(adapter.getReconnectAttempt(), 0)
    assert.equal(adapter.getStatus(), 'offline')
    assert.equal(dialog.state, 'offline')
    assert.equal(dialogAttrs.has('connecting-label'), false)
    assert.deepEqual(toasts.at(-1), {
        message: 'Offline',
        type: 'info',
    })

    adapter.dispose()
})


test('pending and rejected image replacements cannot publish through unrelated control edits', async () => {
    const oldText = 'media(url:"image:old", rotation:0).write(o0)'
    const editor = { value: oldText }
    const uploaded = []
    const published = []
    let binding
    const layer = {
        status: 'online', on() { return () => {} }, bindEditor(value) { binding = value },
        getStatus() { return this.status }, getSessionId: () => 'ImageSession',
        uploadImage: () => new Promise((resolve, reject) => uploaded.push({ resolve, reject })),
        updateLocalText: (_id, text) => published.push(text),
    }
    const adapter = createPolymorphicOnlineAdapter({
        editor, location: 'https://polymorphic.test/',
        importSdk: async () => ({ createOnlineDslLayer: () => layer }),
        prepareImages: async text => ({ dsl: text.replace('local-new', 'image:new'), images: [{ id: 'new', dataUrl: 'new original bytes' }] }),
        imageBlob: async image => image,
    })
    await adapter.ensureOnline()
    editor.value = 'media(url:"local-new", rotation:0).write(o0)'
    const first = adapter.updateLocalText('image')
    const firstRejected = assert.rejects(first, /upload refused/)
    await new Promise(resolve => setTimeout(resolve, 0))
    editor.value = 'media(url:"local-new", rotation:25).write(o0)'
    const control = adapter.updateLocalText('control')
    const controlRejected = assert.rejects(control, /upload refused/)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(published, [], 'the session keeps its previous image while uploads are pending')
    for (const upload of uploaded.splice(0)) upload.reject(new Error('upload refused'))
    await Promise.all([firstRejected, controlRejected])
    assert.deepEqual(published, [])
    assert.equal(binding.validateText(editor.value).ok, false, 'editor binding also blocks the unuploaded reference')
    await new Promise(resolve => setTimeout(resolve, 0))
    for (const upload of uploaded) upload.reject(new Error('upload refused'))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(published, [])
    adapter.dispose()
})


for (const cancel of ['edit', 'offline']) {
    test(`initial image preparation cannot overwrite a newer draft or go online after ${cancel}`, async () => {
        const original = 'media(url:"https://images.test/picture.png", rotation:0).write(o0)'
        const editor = { value: original }
        const seeds = [], toasts = []
        let release
        const layer = { on() { return () => {} }, bindEditor() {}, getStatus: () => 'offline', getSessionId: () => null,
            takeOnline: async value => seeds.push(value), goOffline() {}, writeSessionToUrl: url => url }
        const adapter = createPolymorphicOnlineAdapter({
            editor, location: 'https://poly.test/', importSdk: async () => ({ createOnlineDslLayer: () => layer }),
            showToast: text => toasts.push(text),
            prepareImages: text => new Promise(resolve => { release = () => resolve({dsl:text.replace('https://images.test/picture.png','image:ready'),images:[{id:'ready'}]}) }),
        })
        const creating = adapter.takeOnline()
        while (!release) await Promise.resolve()
        if (cancel === 'edit') editor.value = original.replace('rotation:0','rotation:42')
        else adapter.goOffline()
        const expected = editor.value
        release()
        await creating
        assert.equal(editor.value, expected)
        assert.deepEqual(seeds, [], 'no session may be created from canceled or stale preparation')
        if (cancel === 'edit') assert.ok(toasts.some(text => /changed|latest/i.test(text)))
        adapter.dispose()
    })
}

test('go offline during the initial SDK import cancels session creation before image preparation', async () => {
    let releaseSdk, prepared = 0, created = 0
    const sdk = new Promise(resolve => { releaseSdk = resolve })
    const adapter = createPolymorphicOnlineAdapter({
        editor:{value:'media(url:"local")'}, location:'https://poly.test/', importSdk:() => sdk,
        prepareImages:async () => { prepared++; return {dsl:'prepared',images:[]} },
    })
    const creating = adapter.takeOnline()
    adapter.goOffline()
    releaseSdk({createOnlineDslLayer:() => ({on(){return () => {}},bindEditor(){},getStatus:()=> 'offline',getSessionId:()=> null, takeOnline:async () => {created++}})})
    await creating
    assert.equal(prepared, 0)
    assert.equal(created, 0)
    adapter.dispose()
})
