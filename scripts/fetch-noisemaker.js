#!/usr/bin/env node
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const REPO_ROOT = path.resolve(__dirname, '..')
const PIN_PATH = path.join(REPO_ROOT, 'desktop', 'noisemaker.version.json')

/**
 * True when a bundle that states `stated` as its version is what `pin` names.
 * A pin without a dot names a channel alias, such as `1`, which a release of
 * its series serves, so the stated version may carry the alias as its major.
 * A pin that names one release is stated exactly.
 */
function statesPinnedVersion(stated, pin) {
    if (typeof stated !== 'string') return false
    if (stated === pin) return true
    return !pin.includes('.') && stated.startsWith(`${pin}.`)
}

/** The version that a deployment-meta.json states, or undefined when it states none. */
function statedVersion(metaText) {
    try {
        return JSON.parse(metaText).version
    } catch {
        return undefined
    }
}

/**
 * Read the deployment-meta.json of the directory that the pin names, and fail
 * unless the bundle there states the pinned version. The desktop build records
 * the pin as the engine's version, so the bytes it bakes must be that
 * release's. Returns the text, which is baked beside the engine.
 */
async function fetchPinnedMeta(versionUrl, pin, fetchImpl) {
    const url = `${versionUrl}/deployment-meta.json`
    const resp = await fetchImpl(url)
    if (!resp.ok) throw new Error(`Failed ${resp.status}: ${url}`)
    const text = await resp.text()
    const stated = statedVersion(text)
    if (stated === undefined) {
        throw new Error(`noisemaker: ${url} states no version, so the engine there cannot be checked against the pin ${pin}. Refusing to bake it.`)
    }
    if (!statesPinnedVersion(stated, pin)) {
        throw new Error(`noisemaker: ${url} states version ${stated}, and the build records ${pin}. Refusing to bake one release under the name of another.`)
    }
    return text
}

/**
 * Vendor the pinned engine: core, every effect bundle, manifest, the pin's
 * deployment-meta.json and SHA256SUMS, into public/vendor/noisemaker/<pin>.
 *
 * @param {object} [options]
 * @param {string} [options.pinPath] - Path of the checked-in pin file.
 * @param {string} [options.repoRoot] - Repository root that holds public/.
 * @param {typeof fetch} [options.fetchImpl] - Fetch implementation.
 * @param {(line: string) => void} [options.log] - Progress logger.
 */
async function vendorNoisemaker({ pinPath = PIN_PATH, repoRoot = REPO_ROOT, fetchImpl = fetch, log = console.log } = {}) {
    const pin = JSON.parse(await fs.readFile(pinPath, 'utf8'))
    const { version, baseUrl } = pin
    const versionUrl = `${baseUrl}/${version}`
    const destRoot = path.join(repoRoot, 'public', 'vendor', 'noisemaker', version)
    const effectsDest = path.join(destRoot, 'effects')
    await fs.mkdir(effectsDest, { recursive: true })

    // Check what the directory states before the build downloads the engine,
    // so it cannot ship the bytes of one release under the name of another.
    const pinnedMeta = await fetchPinnedMeta(versionUrl, version, fetchImpl)

    const checksums = []

    async function download(url, destPath) {
        const resp = await fetchImpl(url)
        if (!resp.ok) throw new Error(`Failed ${resp.status}: ${url}`)
        const buf = Buffer.from(await resp.arrayBuffer())
        await fs.mkdir(path.dirname(destPath), { recursive: true })
        await fs.writeFile(destPath, buf)
        const hash = crypto.createHash('sha256').update(buf).digest('hex')
        checksums.push(`${hash}  ${path.relative(destRoot, destPath).split(path.sep).join('/')}`)
    }

    log(`Fetching Noisemaker ${version} from ${versionUrl}`)

    await download(
        `${versionUrl}/noisemaker-shaders-core.esm.min.js`,
        path.join(destRoot, 'noisemaker-shaders-core.esm.min.js')
    )

    const manifestResp = await fetchImpl(`${versionUrl}/effects/manifest.json`)
    if (!manifestResp.ok) throw new Error(`Manifest fetch failed: ${manifestResp.status}`)
    const manifestText = await manifestResp.text()
    const manifest = JSON.parse(manifestText)

    const effectIds = Object.keys(manifest)
    log(`Downloading ${effectIds.length} effect bundles...`)
    for (const id of effectIds) {
        const rel = `${id}.js`
        await download(`${versionUrl}/effects/${rel}`, path.join(effectsDest, rel))
    }

    const manifestDest = path.join(effectsDest, 'manifest.json')
    await fs.writeFile(manifestDest, manifestText)
    const manifestHash = crypto.createHash('sha256').update(manifestText).digest('hex')
    checksums.push(`${manifestHash}  effects/manifest.json`)

    // deployment-meta.json — the checked file itself, baked beside the engine.
    await fs.writeFile(path.join(destRoot, 'deployment-meta.json'), pinnedMeta)
    checksums.push(`${crypto.createHash('sha256').update(pinnedMeta).digest('hex')}  deployment-meta.json`)

    const sumsPath = path.join(destRoot, 'SHA256SUMS')
    await fs.writeFile(sumsPath, checksums.join('\n') + '\n')
    log(`Wrote ${checksums.length} checksums to ${sumsPath}`)
}

module.exports = { vendorNoisemaker, statesPinnedVersion, statedVersion, fetchPinnedMeta }

if (require.main === module) {
    vendorNoisemaker().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
