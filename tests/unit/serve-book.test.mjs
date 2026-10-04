/**
 * Unit tests for scripts/serve-book.mjs — path resolution and crash
 * resilience of the dev/e2e web server.
 *
 * The server is also Playwright's webServer, so a request that kills it takes
 * down a whole e2e run. `GET /%` once did exactly that: decodeURIComponent
 * threw URIError inside the request handler and the process died on the
 * unhandled rejection. These tests pin both the resolution rules and the
 * behavior of the live server on such a request.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { resolvePath } from '../../scripts/serve-book.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PUBLIC = join(REPO, 'public')
const BOOK = join(REPO, 'dist', 'book')

test('root resolves inside public', () => {
    assert.equal(resolvePath('/'), PUBLIC)
})

test('/book paths resolve inside dist/book', () => {
    assert.equal(resolvePath('/book/'), BOOK)
    assert.equal(resolvePath('/book/index.html'), join(BOOK, 'index.html'))
})

test('traversal stays inside the served roots', () => {
    // Both literal and encoded '..' normalize away before the containment
    // check, so they clamp to the served tree (which 404s) rather than being
    // rejected outright — the containment check is the security boundary.
    for (const url of ['/book/../package.json', '/%2e%2e/%2e%2e/%2e%2e/etc/passwd']) {
        const resolved = resolvePath(url)
        assert.ok(
            resolved.startsWith(PUBLIC + '/') || resolved.startsWith(BOOK + '/'),
            `${url} must stay inside a served root, got ${resolved}`
        )
    }
})

test('a malformed percent-escape resolves to nothing instead of throwing', () => {
    // decodeURIComponent('%') throws URIError; the handler must treat it as
    // an unresolvable path, not crash.
    assert.equal(resolvePath('/%'), null)
    assert.equal(resolvePath('/%zz'), null)
    assert.equal(resolvePath('/%2'), null)
})

test('query strings are ignored and encoding is honored', () => {
    assert.equal(resolvePath('/?dsl=x'), PUBLIC)
    assert.equal(resolvePath('/book/index.html?x=%2'), join(BOOK, 'index.html'))
})

// Some environments only permit loopback binds on a narrow port range. When
// the OS refuses an ephemeral bind, fall back to that range instead of
// skipping the live-server checks; the checks themselves are unchanged.
async function pickPort() {
    const tryListen = port => new Promise((res, rej) => {
        const probe = createServer()
        probe.listen(port, '127.0.0.1', () => {
            const { port } = probe.address()
            probe.close(() => res(port))
        })
        probe.on('error', rej)
    })
    try {
        return await tryListen(0)
    } catch (error) {
        if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    }
    for (let port = 43117; port <= 43126; port++) {
        try {
            return await tryListen(port)
        } catch (error) {
            if (error.code !== 'EADDRINUSE' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error
        }
    }
    throw new Error('No bindable loopback port for the serve-book live check')
}

test('the live server answers a malformed escape with 404 and stays up', async () => {
    const port = await pickPort()

    const child = spawn(process.execPath, [join(REPO, 'scripts', 'serve-book.mjs'), String(port)], {
        stdio: 'ignore',
    })
    try {
        const base = `http://127.0.0.1:${port}`
        await waitFor(base, 5000)

        const bad = await fetch(`${base}/%`)
        assert.equal(bad.status, 404)

        // The malformed request must not have taken the server down.
        const ok = await fetch(`${base}/`)
        assert.equal(ok.status, 200)
        // The Sync developer contract requires the top-level application to
        // delegate loopback-network so the SDK's permission query can succeed.
        assert.equal(ok.headers.get('permissions-policy'), 'loopback-network=(self)')

        // And it still answers normally afterwards.
        const again = await fetch(`${base}/%`)
        assert.equal(again.status, 404)
    } finally {
        child.kill()
    }
})

async function waitFor(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url)
            if (res.status === 404 || res.status === 200) return
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 100))
    }
    throw new Error(`server did not come up at ${url} within ${timeoutMs}ms`)
}
