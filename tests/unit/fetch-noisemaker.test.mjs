/**
 * Unit tests for scripts/fetch-noisemaker.js — the desktop build's engine
 * vendor step.
 *
 * The vendor step bakes the engine bytes that the desktop shell verifies
 * against vendor/noisemaker/<pin>/SHA256SUMS at launch. The build records the
 * pin as the engine's version, so it must refuse to bake engine bytes whose
 * deployment-meta.json does not state the pin, and it must bake the checked
 * meta beside the engine with its own checksum in SHA256SUMS.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { vendorNoisemaker, statesPinnedVersion, statedVersion } =
    require('../../scripts/fetch-noisemaker.js')

const CORE_BYTES = 'ENGINE CORE BYTES'
const EFFECT_BYTES = 'EFFECT BLUR BYTES'
const MANIFEST_JSON = '{"blur":{"title":"Blur"}}'
const META_JSON = JSON.stringify({ git_hash: 'a'.repeat(40), date: 1795212296, version: '1.0.353' })

/** A fetch impl that answers from an in-memory URL table. */
function stubFetch(files) {
    return async (url) => {
        const body = files[url]
        if (body === undefined) {
            return { ok: false, status: 404, text: async () => 'not found', arrayBuffer: async () => new ArrayBuffer(0) }
        }
        const bytes = new TextEncoder().encode(body)
        return {
            ok: true,
            status: 200,
            text: async () => body,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        }
    }
}

/** Serve a release directory that states `metaVersion` as its version. */
function releaseFiles(metaVersion) {
    const base = 'https://cdn.test/1'
    const files = {
        [`${base}/noisemaker-shaders-core.esm.min.js`]: CORE_BYTES,
        [`${base}/effects/manifest.json`]: MANIFEST_JSON,
        [`${base}/effects/blur.js`]: EFFECT_BYTES,
    }
    if (metaVersion !== null) {
        files[`${base}/deployment-meta.json`] =
            metaVersion === undefined ? '{}' : JSON.stringify({ version: metaVersion })
    }
    return { files, base }
}

async function makeSandbox() {
    const repoRoot = await mkdtemp(join(tmpdir(), 'fetch-noisemaker-'))
    const pinPath = join(repoRoot, 'desktop', 'noisemaker.version.json')
    await mkdir(join(repoRoot, 'desktop'), { recursive: true })
    await writeFile(pinPath, JSON.stringify({ version: '1', baseUrl: 'https://cdn.test' }))
    return { repoRoot, pinPath, vendorRoot: join(repoRoot, 'public', 'vendor', 'noisemaker', '1') }
}

test('a release of the pin series is accepted and baked beside the engine', async () => {
    const sandbox = await makeSandbox()
    try {
        const { files } = releaseFiles('1.0.353')
        await vendorNoisemaker({ pinPath: sandbox.pinPath, repoRoot: sandbox.repoRoot, fetchImpl: stubFetch(files), log: () => {} })

        const meta = await readFile(join(sandbox.vendorRoot, 'deployment-meta.json'), 'utf8')
        assert.equal(meta, files['https://cdn.test/1/deployment-meta.json'])

        const sums = await readFile(join(sandbox.vendorRoot, 'SHA256SUMS'), 'utf8')
        const metaHash = createHash('sha256').update(meta).digest('hex')
        assert.ok(
            sums.includes(`${metaHash}  deployment-meta.json`),
            `SHA256SUMS lists deployment-meta.json:\n${sums}`
        )

        const core = await readFile(join(sandbox.vendorRoot, 'noisemaker-shaders-core.esm.min.js'), 'utf8')
        assert.equal(core, CORE_BYTES)
        const effect = await readFile(join(sandbox.vendorRoot, 'effects', 'blur.js'), 'utf8')
        assert.equal(effect, EFFECT_BYTES)
        const coreHash = createHash('sha256').update(CORE_BYTES).digest('hex')
        assert.ok(sums.includes(`${coreHash}  noisemaker-shaders-core.esm.min.js`), sums)
    } finally {
        await rm(sandbox.repoRoot, { recursive: true, force: true })
    }
})

test('a directory that states no version is refused, and no engine is baked', async () => {
    const sandbox = await makeSandbox()
    try {
        const { files } = releaseFiles(undefined)
        await assert.rejects(
            vendorNoisemaker({ pinPath: sandbox.pinPath, repoRoot: sandbox.repoRoot, fetchImpl: stubFetch(files), log: () => {} }),
            /states no version/
        )
        await assert.rejects(readFile(join(sandbox.vendorRoot, 'noisemaker-shaders-core.esm.min.js')), /ENOENT/)
        await assert.rejects(readFile(join(sandbox.vendorRoot, 'SHA256SUMS')), /ENOENT/)
    } finally {
        await rm(sandbox.repoRoot, { recursive: true, force: true })
    }
})

test('another major under the pin name is refused', async () => {
    const sandbox = await makeSandbox()
    try {
        const { files } = releaseFiles('2.0.9')
        await assert.rejects(
            vendorNoisemaker({ pinPath: sandbox.pinPath, repoRoot: sandbox.repoRoot, fetchImpl: stubFetch(files), log: () => {} }),
            /one release under the name of another/
        )
    } finally {
        await rm(sandbox.repoRoot, { recursive: true, force: true })
    }
})

test('a pin that names one release is stated exactly', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'fetch-noisemaker-'))
    try {
        const pinPath = join(repoRoot, 'pin.json')
        await writeFile(pinPath, JSON.stringify({ version: '1.0.353', baseUrl: 'https://cdn.test' }))
        const base = 'https://cdn.test/1.0.353'
        const files = {
            [`${base}/noisemaker-shaders-core.esm.min.js`]: CORE_BYTES,
            [`${base}/effects/manifest.json`]: MANIFEST_JSON,
            [`${base}/effects/blur.js`]: EFFECT_BYTES,
            [`${base}/deployment-meta.json`]: META_JSON,
        }
        await vendorNoisemaker({ pinPath, repoRoot, fetchImpl: stubFetch(files), log: () => {} })
        const sums = await readFile(join(repoRoot, 'public', 'vendor', 'noisemaker', '1.0.353', 'SHA256SUMS'), 'utf8')
        assert.ok(sums.includes('deployment-meta.json'), sums)
    } finally {
        await rm(repoRoot, { recursive: true, force: true })
    }
})

test('a failed deployment-meta fetch is refused', async () => {
    const sandbox = await makeSandbox()
    try {
        const { files } = releaseFiles('1.0.353')
        delete files['https://cdn.test/1/deployment-meta.json']
        await assert.rejects(
            vendorNoisemaker({ pinPath: sandbox.pinPath, repoRoot: sandbox.repoRoot, fetchImpl: stubFetch(files), log: () => {} }),
            /Failed 404/
        )
    } finally {
        await rm(sandbox.repoRoot, { recursive: true, force: true })
    }
})

test('statesPinnedVersion matches the alias series and an exact release', () => {
    assert.equal(statesPinnedVersion('1.0.353', '1'), true)
    assert.equal(statesPinnedVersion('1', '1'), true)
    assert.equal(statesPinnedVersion('1.0.353', '1.0.353'), true)
    assert.equal(statesPinnedVersion('2.0.9', '1'), false)
    assert.equal(statesPinnedVersion('10.0.1', '1'), false)
    assert.equal(statesPinnedVersion(undefined, '1'), false)
})

test('a release pin is stated exactly, not by prefix', () => {
    assert.equal(statesPinnedVersion('1.0.353.1', '1.0.353'), false)
    assert.equal(statesPinnedVersion('1.0.3530', '1.0.353'), false)
})

test('a patch release under the name of a release pin is refused', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'fetch-noisemaker-'))
    try {
        const pinPath = join(repoRoot, 'pin.json')
        await writeFile(pinPath, JSON.stringify({ version: '1.0.353', baseUrl: 'https://cdn.test' }))
        const base = 'https://cdn.test/1.0.353'
        const files = {
            [`${base}/noisemaker-shaders-core.esm.min.js`]: CORE_BYTES,
            [`${base}/effects/manifest.json`]: MANIFEST_JSON,
            [`${base}/effects/blur.js`]: EFFECT_BYTES,
            [`${base}/deployment-meta.json`]: JSON.stringify({ version: '1.0.353.1' }),
        }
        await assert.rejects(
            vendorNoisemaker({ pinPath, repoRoot, fetchImpl: stubFetch(files), log: () => {} }),
            /one release under the name of another/
        )
    } finally {
        await rm(repoRoot, { recursive: true, force: true })
    }
})

test('statedVersion reads the stated version and none when unparsable', () => {
    assert.equal(statedVersion(META_JSON), '1.0.353')
    assert.equal(statedVersion('{}'), undefined)
    assert.equal(statedVersion('not json'), undefined)
})
