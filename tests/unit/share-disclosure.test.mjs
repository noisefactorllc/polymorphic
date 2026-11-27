// The Share dialog tells the user what a shared program exposes and how long
// it stays reachable. The dialog sends no ttlMinutes (public/js/shareModal.js),
// and the sharing service keeps a link forever unless the caller asks for
// expiry, so the text must not promise that the link goes away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const INDEX = new URL('../../public/index.html', import.meta.url)
const SHARE_MODAL = new URL('../../public/js/shareModal.js', import.meta.url)
// The page's text before the dialog checks the program names every kind.
const DISCLOSURE = "Anyone with the link can open the editable program, including the original images and custom shader code it uses. This link doesn't expire automatically. To share only the finished result, export an image or video."

test('the Share dialog says the link does not expire automatically', async () => {
    const html = await readFile(INDEX, 'utf8')
    const info = html.match(/<div class="share-info">(?:(?!<\/div>)[\s\S])*?<span id="share-exposure">([^<]*)<\/span>\s*<\/div>/)
    assert.ok(info, 'the Share dialog has its share-info text')
    assert.equal(info[1], DISCLOSURE)
    assert.doesNotMatch(html, /accessible for \d+ days/)
})

test('the Share request asks for no expiry, which the disclosure relies on', async () => {
    const source = await readFile(SHARE_MODAL, 'utf8')
    assert.doesNotMatch(source, /ttlMinutes/)
})
