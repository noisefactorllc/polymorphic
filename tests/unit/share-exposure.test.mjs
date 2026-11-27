// The sentence beside Share says what anyone with the link can open: the
// editable program, and the original images and custom shader code only when
// the share carries them. The share decides both kinds the same way the
// sentence does, and the sentence hears every change to the loaded portable
// effects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const moduleFrom = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

// The share modal, with the sharing loader replaced by a stand-in whose loaded
// portable effects each test sets.
globalThis.__shareExposureLoader = { effects: new Map() }
const modalSource = (await readFile(new URL('../../public/js/shareModal.js', import.meta.url), 'utf8'))
    .replace(/import \{[^\n]+\} from '\.\/sharingLoader.js'/, 'const getLoadedPortableEffects = () => globalThis.__shareExposureLoader.effects, onLoadedPortableEffectsChange = () => () => {}')
    + '\nexport { shareExposureText, shareKinds }\n'
const { shareExposureText, shareKinds } = await moduleFrom(modalSource)

// The sharing loader, with the engine replaced by a stand-in whose
// registration each test sets.
let registerEffect = async definition => ({ name: definition.name, instance: {} })
globalThis.__shareExposureRuntime = {
    CanvasRenderer: class {
        registerPortableEffect(definition) { return registerEffect(definition) }
        registerEffectWithRuntime() {}
    },
    unregisterEffect() {},
}
const loaderSource = (await readFile(new URL('../../public/js/sharingLoader.js', import.meta.url), 'utf8'))
    .replace(/import\s*\{[\s\S]*?\}\s*from '\.\/noisemaker\/bundle.js'/, 'const { CanvasRenderer, unregisterEffect } = globalThis.__shareExposureRuntime')
const loader = await moduleFrom(loaderSource)

const RESULT = " This link doesn't expire automatically. To share only the finished result, export an image or video."

test('the sentence names exactly the kinds the share carries, in each case', () => {
    const cases = [
        [{ images: true, shaders: true }, 'Anyone with the link can open the editable program, including the original images and custom shader code it uses.' + RESULT],
        [{ images: true, shaders: false }, 'Anyone with the link can open the editable program, including the original images it uses.' + RESULT],
        [{ images: false, shaders: true }, 'Anyone with the link can open the editable program, including custom shader code it uses.' + RESULT],
        [{ images: false, shaders: false }, 'Anyone with the link can open the editable program.' + RESULT],
    ]
    for (const [kinds, sentence] of cases) assert.equal(shareExposureText(kinds), sentence, JSON.stringify(kinds))
    assert.equal(shareExposureText(), cases[0][1], 'with nothing checked, the sentence names both kinds')
})

test('the share carries images only when the program names a url, and custom code only for a named loaded effect', () => {
    const effects = globalThis.__shareExposureLoader.effects
    effects.clear()
    const picture = 'search synth\nmedia(url: "data:image/png;base64,AA==").write(o0)\nrender(o0)'
    assert.deepEqual(shareKinds('search synth\nnoise().write(o0)\nrender(o0)'), { images: false, shaders: false })
    assert.deepEqual(shareKinds(picture), { images: true, shaders: false })
    assert.deepEqual(shareKinds('search synth\nmedia().write(o0)\nrender(o0)'), { images: false, shaders: false }, 'a media call without a url')
    effects.set('user/glowProbe', { name: 'glowProbe', func: 'glowProbe' })
    assert.deepEqual(shareKinds('search user, synth\nglowProbe().write(o0)\nrender(o0)'), { images: false, shaders: true })
    assert.deepEqual(shareKinds('search synth\nnoise().write(o0)\nrender(o0)'), { images: false, shaders: false }, 'a loaded effect the program does not name')
    assert.deepEqual(shareKinds(picture.replace('media(', 'glowProbe().media(')), { images: true, shaders: true })
    // The share packages the effects it found at the click; the sentence reads the same list.
    assert.deepEqual(shareKinds('search user, synth\nglowProbe().write(o0)\nrender(o0)', []), { images: false, shaders: false })
    effects.clear()
})

test('the loaded portable effects tell their listeners of each registration, drop and clear', async () => {
    let calls = 0
    const stop = loader.onLoadedPortableEffectsChange(() => { calls++ })
    const probe = { name: 'glowProbe', func: 'glowProbe', globals: {}, passes: [], shaders: {} }

    await loader.registerPortableEffect(probe)
    assert.equal(calls, 1, 'a registration')
    assert.ok(loader.getLoadedPortableEffects().has('user/glowProbe'))

    // A rejected definition leaves the registry, and its listeners, alone.
    registerEffect = async () => { throw new Error('invalid definition') }
    await assert.rejects(loader.registerPortableEffect({ ...probe, name: 'brokenProbe', func: 'brokenProbe' }))
    assert.equal(calls, 1, 'no change for a rejected definition')

    // A replacement whose retry fails drops the earlier effect.
    registerEffect = async () => { throw new Error('glowProbe is already registered') }
    await assert.rejects(loader.registerPortableEffect(probe))
    assert.equal(loader.getLoadedPortableEffects().has('user/glowProbe'), false)
    assert.equal(calls, 2, 'a drop')

    registerEffect = async definition => ({ name: definition.name, instance: {} })
    await loader.registerPortableEffect(probe)
    loader.clearLoadedPortableEffects()
    assert.equal(calls, 4, 'a registration, then a clear')

    // A listener that throws does not stop the change or the other listeners.
    let heard = false
    const stopFailing = loader.onLoadedPortableEffectsChange(() => { throw new Error('listener failed') })
    const stopHearing = loader.onLoadedPortableEffectsChange(() => { heard = true })
    const quiet = console.error
    console.error = () => {}
    try {
        await loader.registerPortableEffect(probe)
    } finally {
        console.error = quiet
    }
    assert.ok(heard)
    assert.ok(loader.getLoadedPortableEffects().has('user/glowProbe'))
    stopFailing(); stopHearing()

    stop()
    loader.clearLoadedPortableEffects()
    assert.equal(calls, 5, 'not after it stops listening')
})
