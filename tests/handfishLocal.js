// SPDX-License-Identifier: MIT
//
// Pre-release helper: serve the Handfish CDN from a local Handfish build so
// components and editor APIs can be exercised before they ship. The build is
// HANDFISH_LOCAL when set (e.g. HANDFISH_LOCAL=../handfish/dist), otherwise a
// ../handfish/dist sibling checkout when one exists. No machine path is
// committed; with neither, these tests run against the real CDN.
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const siblingHandfishDist = resolve(process.cwd(), '../handfish/dist')

function handfishLocalDir() {
    if (process.env.HANDFISH_LOCAL) return process.env.HANDFISH_LOCAL
    return existsSync(siblingHandfishDist) ? siblingHandfishDist : null
}

export async function routeHandfishLocal(page) {
    const local = handfishLocalDir()
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
