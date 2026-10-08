// SPDX-License-Identifier: MIT
//
// Type text through Chromium's trusted keyboard input at a steady human pace.
//
// Playwright's keyboard.type sends each key only after the page has handled
// the one before it. On a loaded machine, a busy page or a starved test runner
// can stretch the time between two keys past three seconds, the pause at which
// the editor starts a new undo step, and one typed note then undoes in pieces.
// A person's key presses carry the times they were pressed, however long the
// page takes to handle them. These keys carry a fixed cadence the same way, so
// the page sees one continuous burst of typing on any machine.

const NAMED_KEYS = {
    ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    '/': { key: '/', code: 'Slash', keyCode: 191, text: '/' },
    '\n': { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
}

function describeKey(ch) {
    if (NAMED_KEYS[ch]) return NAMED_KEYS[ch]
    if (/^[a-z]$/.test(ch)) return { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: ch.toUpperCase().charCodeAt(0), text: ch }
    if (/^[0-9]$/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch }
    throw new Error(`typeAtHumanPace has no key for ${JSON.stringify(ch)}`)
}

/**
 * Type `text` into the focused element, one key press every `interval` ms.
 * Chromium only: the keys go through the DevTools input domain, the path
 * Playwright's own keyboard uses, with their press times set.
 * @param {import('@playwright/test').Page} page
 * @param {string} text - lowercase letters, digits, spaces, '/' and '\n'
 * @param {{interval?: number}} [options]
 */
export async function typeAtHumanPace(page, text, { interval = 60 } = {}) {
    const session = await page.context().newCDPSession(page)
    try {
        const start = Date.now() / 1000
        let index = 0
        for (const ch of text) {
            const k = describeKey(ch)
            const pressedAt = start + (index * interval) / 1000
            index++
            // A key is never sent before its press time; it may be sent
            // later, as a busy machine delays a person's keys.
            const early = pressedAt * 1000 - Date.now()
            if (early > 0) await new Promise(resolve => setTimeout(resolve, early))
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: k.key,
                code: k.code,
                windowsVirtualKeyCode: k.keyCode,
                text: k.text,
                unmodifiedText: k.text,
                timestamp: pressedAt,
            })
            await session.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: k.key,
                code: k.code,
                windowsVirtualKeyCode: k.keyCode,
                timestamp: pressedAt + interval / 2000,
            })
        }
    } finally {
        await session.detach()
    }
}
