// SPDX-License-Identifier: MIT
//
// Pre-release helper: when HANDFISH_LOCAL points at a local Handfish build
// (e.g. HANDFISH_LOCAL=../handfish/dist), serve the Handfish CDN from it so
// components and editor APIs can be exercised before they ship. No machine path
// is committed; with the env var unset these tests run against the real CDN.
import { readFileSync } from 'fs'

export async function routeHandfishLocal(page) {
    const local = process.env.HANDFISH_LOCAL
    if (!local) return
    await page.route('https://handfish.noisefactor.io/0/**', async (route) => {
        const rel = new URL(route.request().url()).pathname.replace(/^\/0\//, '')
        try {
            const body = readFileSync(`${local}/${rel}`)
            const type = rel.endsWith('.css')
                ? 'text/css'
                : rel.endsWith('.js')
                    ? 'text/javascript'
                    : 'application/octet-stream'
            await route.fulfill({ status: 200, contentType: type, body })
        } catch {
            await route.fulfill({ status: 404, body: 'missing ' + rel })
        }
    })
}

export function installHandfishLocal(test) {
    test.beforeEach(async ({ page }) => {
        await routeHandfishLocal(page)
    })
}
