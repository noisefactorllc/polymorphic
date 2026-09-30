import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function routePortableImagesLocal(page) {
    const file = resolve(process.env.PORTABLE_IMAGES_MODULE || '../sharing/public/js/portableImages.js')
    if (!existsSync(file)) return
    await page.route('https://sharing.noisedeck.app/js/portableImages.js*', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: readFileSync(file),
        headers: { 'Access-Control-Allow-Origin': '*' },
    }))
}
