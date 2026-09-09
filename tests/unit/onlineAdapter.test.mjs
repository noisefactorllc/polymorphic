import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_SEANCE_SDK_URL,
    DEFAULT_SEANCE_URL,
    applyRemoteDslText,
    createPolymorphicOnlineAdapter,
    getInitialDocs,
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
