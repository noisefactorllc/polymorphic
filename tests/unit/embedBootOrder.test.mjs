import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

// The engine can replace the canvas during boot. The onCanvasReplaced
// handler in startShader calls detachTouchControls, so that let binding must
// exist before the PolymorphicRenderer construction. Otherwise a boot-time
// replacement throws a ReferenceError inside _adoptFreshCanvas and aborts
// the adoption.

test('startShader declares the touch detach handle before the renderer boots', async () => {
    const source = await readFile(new URL('../../public/js/embed.js', import.meta.url), 'utf8')
    const declaration = source.indexOf('let detachTouchControls = null')
    const construction = source.indexOf('renderer = new PolymorphicRenderer(')
    assert.ok(declaration >= 0, 'the detach handle binding is declared')
    assert.ok(construction >= 0, 'the renderer construction is present')
    assert.ok(
        declaration < construction,
        'the declaration precedes the renderer construction'
    )
    assert.doesNotMatch(
        source,
        /let detachTouchControls = attachTouchControls\(/,
        'the later attach assigns the existing binding instead of redeclaring it'
    )
})
