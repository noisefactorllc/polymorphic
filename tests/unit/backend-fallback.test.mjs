import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    resolveBackendPreference,
    isWebGPUFallback,
    WEBGPU_FALLBACK_MESSAGE
} from '../../public/js/backendFallback.js'

test('resolveBackendPreference: defaults to WebGL2 when no parameter or stored preference is present', () => {
    const result = resolveBackendPreference('', null)
    assert.equal(result.urlBackend, null)
    assert.equal(result.storedBackend, null)
    assert.equal(result.preferWebGPU, false)
})

test('resolveBackendPreference: honors ?backend=webgpu in URL parameter', () => {
    const result = resolveBackendPreference('?backend=webgpu', null)
    assert.equal(result.urlBackend, 'webgpu')
    assert.equal(result.preferWebGPU, true)
})

test('resolveBackendPreference: URL parameter takes precedence over stored backend', () => {
    const result = resolveBackendPreference('?backend=webgl2', 'webgpu')
    assert.equal(result.urlBackend, 'webgl2')
    assert.equal(result.storedBackend, 'webgpu')
    assert.equal(result.preferWebGPU, false)
})

test('resolveBackendPreference: honors stored backend when URL parameter is absent', () => {
    const result = resolveBackendPreference('', 'webgpu')
    assert.equal(result.urlBackend, null)
    assert.equal(result.storedBackend, 'webgpu')
    assert.equal(result.preferWebGPU, true)
})

test('resolveBackendPreference: accepts URLSearchParams directly', () => {
    const params = new URLSearchParams('backend=webgpu&dsl=osc()')
    const result = resolveBackendPreference(params, null)
    assert.equal(result.urlBackend, 'webgpu')
    assert.equal(result.preferWebGPU, true)
})

test('resolveBackendPreference: handles case-insensitive backend parameters and stored values', () => {
    const fromUrl = resolveBackendPreference('?backend=WebGPU', null)
    assert.equal(fromUrl.urlBackend, 'webgpu')
    assert.equal(fromUrl.preferWebGPU, true)

    const fromStorage = resolveBackendPreference('', 'WebGPU')
    assert.equal(fromStorage.preferWebGPU, true)
})

test('resolveBackendPreference: rejects unrecognized backend values as preferWebGPU', () => {
    const result = resolveBackendPreference('?backend=unknown', 'other')
    assert.equal(result.preferWebGPU, false)
})

test('isWebGPUFallback: detects fallback when WebGPU was requested but backend is webgl2', () => {
    assert.equal(isWebGPUFallback({ preferWebGPU: true, actualBackend: 'webgl2' }), true)
})

test('isWebGPUFallback: returns false when WebGPU was requested and backend is webgpu', () => {
    assert.equal(isWebGPUFallback({ preferWebGPU: true, actualBackend: 'webgpu' }), false)
})

test('isWebGPUFallback: returns false when WebGPU was not requested', () => {
    assert.equal(isWebGPUFallback({ preferWebGPU: false, actualBackend: 'webgl2' }), false)
})

test('WEBGPU_FALLBACK_MESSAGE: informs the user of WebGL2 fallback', () => {
    assert.match(WEBGPU_FALLBACK_MESSAGE, /WebGPU is not supported/)
    assert.match(WEBGPU_FALLBACK_MESSAGE, /WebGL2/)
})
