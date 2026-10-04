import { test } from 'node:test'
import assert from 'node:assert'
import { safeNavigationUrl } from '../../public/js/safeUrl.js'

const BASE = 'https://polymorphic.noisedeck.app/book/page.html'

test('site-relative and http(s) URLs pass unchanged', () => {
    assert.strictEqual(safeNavigationUrl('/book/', BASE), '/book/')
    assert.strictEqual(safeNavigationUrl('next.html', BASE), 'next.html')
    assert.strictEqual(safeNavigationUrl('https://polymorphic.noisedeck.app/', BASE), 'https://polymorphic.noisedeck.app/')
    assert.strictEqual(safeNavigationUrl('http://localhost:8080/', BASE), 'http://localhost:8080/')
})

test('script-capable and non-web schemes are rejected', () => {
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'blob:https://x/y']) {
        assert.strictEqual(safeNavigationUrl(bad, BASE), null, bad)
    }
})

test('empty and non-string values are rejected', () => {
    for (const bad of ['', null, undefined, 5, {}]) {
        assert.strictEqual(safeNavigationUrl(bad, BASE), null)
    }
})
