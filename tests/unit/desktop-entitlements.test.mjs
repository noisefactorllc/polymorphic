import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = relative => readFile(resolve(root, relative), 'utf8')

/** Minimal flat XML plist reader: returns the <dict> as a { key: value } map. */
function parseFlatPlist(text) {
    const dict = text.slice(text.indexOf('<dict>'))
    const entries = {}
    const pattern = /<key>([^<]+)<\/key>\s*(<true\/>|<false\/>|<string>([^<]*)<\/string>)/g
    let match
    while ((match = pattern.exec(dict))) {
        entries[match[1]] = match[2] === '<true/>' ? true
            : match[2] === '<false/>' ? false
            : match[3]
    }
    return entries
}

// The desktop app runs under the hardened runtime, so macOS denies camera and
// microphone access unless the app carries both device entitlements. The same
// file is the entitlementsInherit source, so helper processes inherit both
// keys. The packaged app's Info.plist keeps Electron's default usage
// descriptions, which the TCC prompt requires.
const ENTITLEMENTS_FILE = 'desktop/build-resources/entitlements.mac.plist'
const CAMERA_KEY = 'com.apple.security.device.camera'
const AUDIO_KEY = 'com.apple.security.device.audio-input'

test('the macOS desktop build grants camera and audio-input device entitlements', async () => {
    const entries = parseFlatPlist(await read(ENTITLEMENTS_FILE))
    assert.equal(entries[CAMERA_KEY], true,
        `${ENTITLEMENTS_FILE} must grant ${CAMERA_KEY}`)
    assert.equal(entries[AUDIO_KEY], true,
        `${ENTITLEMENTS_FILE} must grant ${AUDIO_KEY}`)
})

test('the macOS desktop build wires the entitlements file into the hardened runtime', async () => {
    const build = JSON.parse(await read('desktop/package.json'))
    assert.equal(build.build.mac.hardenedRuntime, true,
        'the hardened runtime must be enabled for the macOS build')
    assert.equal(build.build.mac.entitlements, 'build-resources/entitlements.mac.plist',
        'the mac build must sign with the entitlements file')
    assert.equal(build.build.mac.entitlementsInherit, 'build-resources/entitlements.mac.plist',
        'helper processes must inherit the same entitlements file')
})
