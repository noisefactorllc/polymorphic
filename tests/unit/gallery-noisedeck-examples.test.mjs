import { test } from 'node:test'
import assert from 'node:assert'

const origFetch = globalThis.fetch
function stubFetch(impl) { globalThis.fetch = impl }
function restoreFetch() { globalThis.fetch = origFetch }

test('loadNoisedeckExamples returns the listing payload from the JSON endpoint', async () => {
    const fakeListing = {
        artist: 'noisedeck',
        show: 'product-examples',
        episode: 'example-programs',
        filesUrl: '/noisedeck/video/product-examples/example-programs/files/',
        files: [
            { file: 'one.dsl', title: 'one', type: 'noisemaker', duration: 30 },
            { file: 'two.dsl', title: 'two', type: 'noisemaker', duration: 30 },
        ],
    }
    let calls = 0
    stubFetch(async (url) => {
        calls += 1
        assert.match(String(url), /listing\.json$/)
        return new Response(JSON.stringify(fakeListing), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    })
    try {
        const { loadNoisedeckExamples } = await import('../../public/js/ui/noisedeckExamples.js')
        const out = await loadNoisedeckExamples({ force: true })
        assert.strictEqual(out.files.length, 2)
        assert.strictEqual(out.filesUrl, fakeListing.filesUrl)
        assert.strictEqual(calls, 1)
    } finally {
        restoreFetch()
    }
})

test('loadNoisedeckExamples throws on non-2xx', async () => {
    stubFetch(async () => new Response('boom', { status: 503 }))
    try {
        const { loadNoisedeckExamples } = await import('../../public/js/ui/noisedeckExamples.js')
        await assert.rejects(
            () => loadNoisedeckExamples({ force: true }),
            /503/
        )
    } finally {
        restoreFetch()
    }
})

test('fetchNoisedeckExampleSource builds the right URL and returns text', async () => {
    const listing = { filesUrl: '/noisedeck/video/product-examples/example-programs/files/' }
    let seenUrl = null
    stubFetch(async (url) => {
        seenUrl = String(url)
        return new Response('noise().write(o0)', { status: 200 })
    })
    try {
        const { fetchNoisedeckExampleSource } = await import('../../public/js/ui/noisedeckExamples.js')
        const text = await fetchNoisedeckExampleSource(listing, 'abstract squiggletown.dsl')
        assert.strictEqual(text, 'noise().write(o0)')
        assert.strictEqual(
            seenUrl,
            'https://shuffleset.stream/noisedeck/video/product-examples/example-programs/files/abstract%20squiggletown.dsl'
        )
    } finally {
        restoreFetch()
    }
})
