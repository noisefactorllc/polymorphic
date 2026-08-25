#!/usr/bin/env node
/**
 * Local static server for Polymorphic with the book mounted at /book.
 *
 * The book is built to dist/book/ rather than into the web root (see the header
 * of build-book.mjs for why), so `npx serve public` alone cannot reach it. This
 * serves public/ and mounts dist/book/ at /book, which is exactly the layout
 * the deploy produces on the server. Playwright uses it too, so the browser
 * tests exercise the real URLs rather than a rearranged local tree.
 *
 *   node scripts/serve-book.mjs [port]
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve, extname, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PUBLIC = join(REPO, 'public')
const BOOK = join(REPO, 'dist', 'book')

const PORT = Number(process.argv[2] || process.env.PORT || 3000)

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
}

/**
 * Map a request path to a file on disk. /book/... resolves inside dist/book,
 * everything else inside public. Returns null for anything that escapes either
 * root once normalized.
 */
function resolvePath(urlPath) {
    const decoded = decodeURIComponent(urlPath.split('?')[0])
    const clean = normalize(decoded).replace(/\\/g, '/')
    if (clean.includes('..')) return null

    const [root, rel] = clean === '/book' || clean.startsWith('/book/')
        ? [BOOK, clean.slice('/book'.length) || '/']
        : [PUBLIC, clean]

    const candidate = resolve(root, `.${rel}`)
    if (candidate !== root && !candidate.startsWith(root + '/')) return null
    return candidate
}

async function pick(path) {
    try {
        const info = await stat(path)
        if (info.isDirectory()) {
            const index = join(path, 'index.html')
            await stat(index)
            return index
        }
        return path
    } catch {
        return null
    }
}

createServer(async (req, res) => {
    const target = resolvePath(req.url || '/')
    const file = target ? await pick(target) : null

    if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('404\n')
        return
    }

    res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
    })
    createReadStream(file).pipe(res)
}).listen(PORT, () => {
    process.stdout.write(`polymorphic  http://localhost:${PORT}/\n`)
    process.stdout.write(`book         http://localhost:${PORT}/book/\n`)
})
