/**
 * The contents page.
 *
 * Same renderer as a reading page, but with no editor and nothing to navigate:
 * one program runs behind the cover as a backdrop. The canvas is fixed and the
 * contents scroll over it.
 */

import { PolymorphicRenderer } from '/js/noisemaker/renderer.js'
import { ProgramState } from '/js/noisemaker/bundle.js'

const page = JSON.parse(document.getElementById('book-page-data').textContent)
const canvas = document.getElementById('canvas')

let renderer = null
let resizeRaf = 0

function resizeCanvas() {
    const baseDpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth || window.innerWidth
    const cssHeight = canvas.clientHeight || window.innerHeight
    const isHighRes = cssWidth * baseDpr > 1920 || cssHeight * baseDpr > 1080
    const dpr = isHighRes ? baseDpr * 0.5 : baseDpr
    canvas.width = Math.max(1, Math.floor(cssWidth * dpr))
    canvas.height = Math.max(1, Math.floor(cssHeight * dpr))
    return { width: canvas.width, height: canvas.height }
}

async function main() {
    const { width, height } = resizeCanvas()
    renderer = new PolymorphicRenderer(canvas, {
        width,
        height,
        loopDuration: 20,
        onError: (err) => console.error('Cover render error:', err),
    })

    try {
        await renderer.init()

        // Same contract every other host follows: the pipeline needs the
        // program's per-step state pushed in after each compile, or a pass that
        // samples more than one texture never gets its inputs bound. See
        // syncProgramState in book-page.js.
        const programState = new ProgramState({ renderer: renderer.canvasRenderer })

        const result = await renderer.compile(page.program)
        if (!result.success) throw new Error(result.error)
        try {
            programState.fromDsl(page.program)
        } catch (err) {
            console.warn('[book] programState.fromDsl failed:', err)
        }
        canvas.classList.add('visible')
        renderer.start()
        document.body.dataset.bookReady = 'true'
    } catch (err) {
        // The contents are readable without the backdrop, so a failure here
        // leaves the page usable rather than blocking it behind an error.
        console.error('Cover failed to start:', err)
        document.body.dataset.bookReady = 'error'
        return
    }

    window.addEventListener('resize', () => {
        if (resizeRaf) return
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0
            const size = resizeCanvas()
            renderer.resize(size.width, size.height)
        })
    })

    window.addEventListener('pagehide', (e) => {
        if (e.persisted) return
        renderer.dispose()
    })
}

main()
