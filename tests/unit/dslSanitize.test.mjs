import { test } from 'node:test'
import assert from 'node:assert'
import { stripMediaUrlArg, restoreMediaUrls } from '../../public/js/noisemaker/dslSanitize.js'

// ---- stripMediaUrlArg ----

test('strips a simple media url', () => {
    assert.strictEqual(stripMediaUrlArg('media(url: "live").write(o0)'), 'media().write(o0)')
})

test('strips a data: url containing commas and = + /', () => {
    assert.strictEqual(
        stripMediaUrlArg('media(url:"data:image/png;base64,iVBOR,abc==").write(o0)'),
        'media().write(o0)'
    )
})

test('strips a url containing parentheses', () => {
    assert.strictEqual(
        stripMediaUrlArg('media(url: "https://x/File_(1).png").write(o0)'),
        'media().write(o0)'
    )
})

test('strips single-quoted urls', () => {
    assert.strictEqual(stripMediaUrlArg("media(url: 'single').write(o0)"), 'media().write(o0)')
})

test('preserves other args when url is first or last', () => {
    assert.strictEqual(stripMediaUrlArg('media(url: "x", scale: 2).write(o0)'), 'media(scale: 2).write(o0)')
    assert.strictEqual(stripMediaUrlArg('media(scale: 2, url: "x").write(o0)'), 'media(scale: 2).write(o0)')
})

test('leaves url-less media() and non-media DSL unchanged', () => {
    assert.strictEqual(stripMediaUrlArg('media().write(o0)'), 'media().write(o0)')
    assert.strictEqual(stripMediaUrlArg('noise().write(o0)'), 'noise().write(o0)')
})

test('does not match identifiers that merely contain "media" or "url"', () => {
    assert.strictEqual(stripMediaUrlArg('myMedia(url: "x")'), 'myMedia(url: "x")')
    assert.strictEqual(stripMediaUrlArg('noise(blurly: 2).write(o0)'), 'noise(blurly: 2).write(o0)')
})

test('strips every media() call', () => {
    assert.strictEqual(
        stripMediaUrlArg('media(url:"a").write(o0)\nmedia(url:"b").write(o1)'),
        'media().write(o0)\nmedia().write(o1)'
    )
})

test('strip is idempotent and never leaves a url behind', () => {
    const once = stripMediaUrlArg('media(url: "x", scale: 2).write(o0)')
    assert.strictEqual(stripMediaUrlArg(once), once)
    assert.ok(!/\bmedia\s*\([^)]*\burl\s*:/i.test(once))
})

// ---- restoreMediaUrls ----

test('restores url from reference into a stripped call', () => {
    const ref = 'media(url: "data:image/png;base64,AAAA").write(o0)'
    const stripped = 'media().write(o0)'
    assert.strictEqual(restoreMediaUrls(ref, stripped), 'media(url: "data:image/png;base64,AAAA").write(o0)')
})

test('restores url and keeps regenerated args', () => {
    const ref = 'media(url: "x").adjust(rotation: 90).write(o0)'
    const regen = 'media().adjust(rotation: 120).write(o0)'  // a param edit changed rotation
    assert.strictEqual(restoreMediaUrls(ref, regen), 'media(url: "x").adjust(rotation: 120).write(o0)')
})

test('restore is a no-op when reference has no media url', () => {
    assert.strictEqual(restoreMediaUrls('noise().write(o0)', 'noise().write(o0)'), 'noise().write(o0)')
})

test('restore does not double-inject when target already has a url', () => {
    const ref = 'media(url: "x").write(o0)'
    const target = 'media(url: "x").write(o0)'
    assert.strictEqual(restoreMediaUrls(ref, target), 'media(url: "x").write(o0)')
})

test('restores multiple media urls by source order', () => {
    const ref = 'media(url: "a").write(o0)\nmedia(url: "b").write(o1)'
    const stripped = 'media().write(o0)\nmedia().write(o1)'
    assert.strictEqual(restoreMediaUrls(ref, stripped), 'media(url: "a").write(o0)\nmedia(url: "b").write(o1)')
})

test('strip then restore round-trips the original url', () => {
    const original = 'media(url: "data:image/png;base64,iVBOR,x(y)==").adjust(rotation: 45).write(o0)'
    const stripped = stripMediaUrlArg(original)
    assert.ok(!/url\s*:/.test(stripped))
    const restored = restoreMediaUrls(original, stripped)
    assert.ok(/url:\s*"data:image\/png;base64,iVBOR,x\(y\)=="/.test(restored))
})
