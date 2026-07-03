import assert from 'node:assert/strict'
import test from 'node:test'

import {
    DEFAULT_SEANCE_SDK_URL,
    DEFAULT_SEANCE_URL,
    applyRemoteDslText,
    getInitialDocs,
    resolveOnlineConfig,
    shareBaseUrl,
} from '../../public/js/onlineAdapter.js'

test('online adapter uses the rolling major SDK URL by default', () => {
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.test/?backend=webgl2',
    })

    assert.equal(config.seanceUrl, DEFAULT_SEANCE_URL)
    assert.equal(config.sdkUrl, DEFAULT_SEANCE_SDK_URL)
    assert.equal(DEFAULT_SEANCE_SDK_URL, 'https://seance.noisefactor.io/sdk/0/index.js')
})

test('online adapter allows tests to override SDK and server URLs', () => {
    const config = resolveOnlineConfig({
        location: 'https://polymorphic.test/?seanceUrl=http%3A%2F%2F127.0.0.1%3A8123&seanceSdk=https%3A%2F%2Fseance.noisefactor.io%2Fsdk%2F0%2Findex.js',
    })

    assert.equal(config.seanceUrl, 'http://127.0.0.1:8123')
    assert.equal(config.sdkUrl, 'https://seance.noisefactor.io/sdk/0/index.js')
})

test('getInitialDocs produces one default main DSL document from current editor text', () => {
    assert.deepEqual(getInitialDocs('search synth\n\nnoise().write(o0)'), [
        {
            id: 'main',
            title: 'Program',
            kind: 'dsl',
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
