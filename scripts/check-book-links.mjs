/**
 * Reachability check for the book's further-reading links.
 *
 * Every page ends with two or three links out to the paper, the algorithm, or
 * the history behind the effect. Those claims are only worth making if they
 * resolve, and a link rots quietly: nothing in the build or the offline tests
 * can tell. So this walks every link and reports what does not answer with a
 * 200.
 *
 * Network-dependent by nature, so it is not part of `npm test`. Run it before
 * shipping a batch of new links, and periodically after.
 *
 *   node scripts/check-book-links.mjs            all chapters
 *   node scripts/check-book-links.mjs filter     one chapter
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { splitProseFile } from './build-book.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT = join(REPO, 'book', 'content')
const CONCURRENCY = 8

// Some hosts answer a bare fetch with 403. Ask the way a browser would.
const HEADERS = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/pdf,*/*',
}

const only = process.argv[2] || ''
const pagesByUrl = new Map()
const noLinks = []

for (const chapter of await readdir(CONTENT)) {
    if (only && chapter !== only) continue
    for (const file of await readdir(join(CONTENT, chapter))) {
        const page = `${chapter}/${file.replace(/\.md$/, '')}`
        const { links } = splitProseFile(await readFile(join(CONTENT, chapter, file), 'utf8'))
        if (!links.length) noLinks.push(page)
        for (const { url } of links) {
            if (!pagesByUrl.has(url)) pagesByUrl.set(url, [])
            pagesByUrl.get(url).push(page)
        }
    }
}

const urls = [...pagesByUrl.keys()]
const failures = []
let next = 0

async function worker() {
    while (next < urls.length) {
        const url = urls[next++]
        try {
            // HEAD first: most of these are large pages and PDFs. Fall back to
            // a GET where the host refuses HEAD, which several do.
            let response = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: HEADERS })
            if ([403, 405, 501].includes(response.status)) {
                response = await fetch(url, { redirect: 'follow', headers: HEADERS })
            }
            if (response.status !== 200) failures.push({ url, reason: `HTTP ${response.status}` })
        } catch (err) {
            failures.push({ url, reason: err.message })
        }
    }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

for (const { url, reason } of failures.sort((a, b) => a.url.localeCompare(b.url))) {
    process.stdout.write(`FAIL ${reason}  ${url}\n      cited by: ${pagesByUrl.get(url).join(', ')}\n`)
}
if (noLinks.length) {
    process.stdout.write(`no further reading on ${noLinks.length} page(s): ${noLinks.join(', ')}\n`)
}
process.stdout.write(`${urls.length - failures.length}/${urls.length} links reachable\n`)

if (failures.length || noLinks.length) process.exit(1)
