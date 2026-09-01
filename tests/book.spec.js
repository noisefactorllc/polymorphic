import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Browser sweep over The Book of Polymorphic DSL.
 *
 * The claim each page makes is that the program shown compiles and renders on
 * the real engine. Only a browser can check that, so this walks every page and
 * fails on a compile error, a blank canvas, or a console error.
 *
 * The full sweep compiles 187 shaders and takes minutes. BOOK_PAGES=12 walks an
 * evenly-spread sample instead, for a quick pass while writing.
 */

// Playwright transpiles specs as CommonJS, so import.meta is unavailable here.
// Walk up from the working directory to find the repo instead.
function findRepo() {
    let dir = process.cwd()
    for (let i = 0; i < 6; i++) {
        if (existsSync(join(dir, 'book', 'data', 'effects.json'))) return dir
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    throw new Error(`book/data/effects.json not found above ${process.cwd()}`)
}

const REPO = resolve(findRepo())
const book = JSON.parse(readFileSync(join(REPO, 'book', 'data', 'effects.json'), 'utf8'))

// Reading order: chapters as declared, effects as extracted within each.
const pages = book.chapters.flatMap(c => book.effects.filter(e => e.chapter === c.id))

const sampleSize = Number(process.env.BOOK_PAGES || 0)
const walk = sampleSize > 0
    ? Array.from({ length: Math.min(sampleSize, pages.length) },
        (_, i) => pages[Math.floor(i * pages.length / Math.min(sampleSize, pages.length))])
    : pages

const url = (effect) => `/book/${effect.chapter}/${effect.slug}/`

/**
 * Pages whose canvas output is reported rather than asserted, with the reason.
 *
 * Every entry was checked by running the identical program in Polymorphic
 * itself, and renders there exactly as it renders here, so the book is
 * faithful and the blankness belongs to the effect, not to the page.
 *
 * Their output is not asserted in either direction. The measured spread is
 * printed on every run instead, so a page that starts or stops rendering is
 * visible in the log rather than silent.
 *
 * The effects that could only ever be flat here, because they need a camera, a
 * microphone or a MIDI keyboard, no longer have pages at all. See the exclude
 * list in book/curation.json.
 */
const CANVAS_NOT_ASSERTED = {
    'synth/solid': 'a solid colour fill is flat by definition',
}

/** True when the canvas has drawn something other than a single flat colour. */
async function canvasHasImage(page) {
    return page.evaluate(() => {
        const source = document.getElementById('canvas')
        const w = 64
        const h = 64
        const probe = document.createElement('canvas')
        probe.width = w
        probe.height = h
        const ctx = probe.getContext('2d')
        ctx.drawImage(source, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        let min = 255
        let max = 0
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
            if (luma < min) min = luma
            if (luma > max) max = luma
        }
        return { spread: max - min, max }
    })
}

test.describe('The Book of Polymorphic DSL', () => {
    // A stated desktop window, because some of the claims below are about
    // layout. 1440x900 is the window the book is designed against.
    test.use({ viewport: { width: 1440, height: 900 } })

    test('contents lists every page exactly once', async ({ page }) => {
        await page.goto('/book/')
        const links = await page.locator('a.book-entry').evaluateAll(
            els => els.map(el => el.getAttribute('href')),
        )
        expect(links).toHaveLength(pages.length)
        expect(new Set(links).size).toBe(pages.length)
        for (const effect of pages) expect(links).toContain(url(effect))

        await expect(page.locator('.book-chapter')).toHaveCount(book.chapters.length)
        await expect(page.locator('.book-cover__title')).toHaveText('The Book of Polymorphic DSL')
    })

    test('reader navigation runs the whole book end to end', async ({ page }) => {
        const first = pages[0]
        const last = pages[pages.length - 1]

        await page.goto(url(first))
        // First page: no previous page, and no previous chapter.
        await expect(page.locator('.book-rail__step[aria-label="Previous page"]')).toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('.book-rail__step[aria-label="Previous chapter"]')).toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('.book-rail__folio')).toContainText(`1 of ${pages.length}`)

        // Next page lands on page two.
        await page.locator('.book-rail__step[aria-label="Next page"]').click()
        await expect(page).toHaveURL(new RegExp(`${url(pages[1])}$`))

        await page.goto(url(last))
        await expect(page.locator('.book-rail__step[aria-label="Next page"]')).toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('.book-rail__step[aria-label="Next chapter"]')).toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('.book-rail__folio')).toContainText(`${pages.length} of ${pages.length}`)
    })

    test('tear off carries the edited program into Polymorphic', async ({ page }) => {
        const effect = pages.find(e => e.chapter === 'synth') || pages[0]
        await page.goto(url(effect))
        await page.waitForFunction(() => document.body.dataset.bookReady)

        const initial = await page.locator('#tear-off').getAttribute('href')
        const parsed = new URL(initial)
        expect(parsed.origin + parsed.pathname).toBe('https://polymorphic.noisedeck.app/')
        expect(parsed.searchParams.get('dsl')).toBe(effect.program)

        // Editing the program must move the link with it, or tearing off would
        // hand Polymorphic something the reader is no longer looking at.
        await page.evaluate(() => {
            const editor = document.getElementById('dsl-editor')
            editor.value = 'search synth\n\nnoise(seed: 42)\n  .write(o0)\n\nrender(o0)'
            editor.dispatchEvent(new Event('input', { bubbles: true }))
        })
        const edited = new URL(await page.locator('#tear-off').getAttribute('href'))
        expect(edited.searchParams.get('dsl')).toContain('seed: 42')
    })

    test('a control moved in the panel writes back to the program', async ({ page }) => {
        // Round trip: the panel writes through ProgramState, which updates the
        // running pipeline directly, and the program text on the page has to
        // follow or the reader is looking at source that no longer describes
        // what is on screen.
        await page.goto(url(pages.find(e => e.id === 'filter/adjust') || pages[0]))
        await page.waitForFunction(() => document.body.dataset.bookReady, { timeout: 45000 })

        const before = await page.locator('#dsl-editor').evaluate(el => el.value)
        const moved = await page.evaluate(() => {
            const slider = document.querySelector('effect-controls slider-value')
            if (!slider) return null
            const from = Number(slider.value)
            slider.value = from + 40
            slider.dispatchEvent(new Event('input', { bubbles: true }))
            return { from, to: Number(slider.value) }
        })
        expect(moved, 'no slider in the panel to move').not.toBeNull()
        expect(moved.to).not.toBe(moved.from)

        await expect
            .poll(() => page.locator('#dsl-editor').evaluate(el => el.value), { timeout: 5000 })
            .not.toBe(before)

        // And the link out to Polymorphic carries the edited program, not the
        // one the page shipped with.
        const href = await page.locator('#tear-off').getAttribute('href')
        const carried = new URL(href).searchParams.get('dsl')
        expect(carried).toBe(await page.locator('#dsl-editor').evaluate(el => el.value))
    })

    // The panel is only useful if you can watch the picture while you move a
    // control. It briefly was not: the panel was placed below the writing, on
    // the plate's ground, which is 95% opaque — scrolling to it covered the
    // canvas and a reader dragging a slider had nothing to see. The panel now
    // sits above that ground, on bare shader beside the program.
    //
    // filter/grade is the page that makes this hardest: its panel is over
    // 1000px tall, taller than the window. What saves it is width — the panel
    // is one measure wide, so the canvas is never fully covered.
    test('the canvas stays visible behind the parameter panel', async ({ page }) => {
        await page.goto('/book/filter/grade/')
        await page.waitForFunction(() => document.body.dataset.bookReady, { timeout: 45000 })
        await expect(page.locator('effect-controls')).toBeVisible()

        const view = await page.evaluate(() => {
            const panel = document.querySelector('effect-controls')
            // Put the panel just under the rail, where a reader turning knobs
            // would have it.
            window.scrollTo(0, window.scrollY + panel.getBoundingClientRect().top - 60)

            const plate = document.querySelector('.book-plate').getBoundingClientRect()
            const box = panel.getBoundingClientRect()
            const vw = window.innerWidth
            const vh = window.innerHeight
            // Area of the viewport covered by neither the writing's opaque
            // ground nor the panel itself. Whatever is left is live canvas.
            const plateArea = Math.max(0, Math.min(plate.bottom, vh) - Math.max(plate.top, 0)) * vw
            const panelArea = Math.max(0, Math.min(box.bottom, vh) - Math.max(box.top, 0))
                * Math.min(box.width, vw)
            return {
                freeFraction: (vw * vh - plateArea - panelArea) / (vw * vh),
                panelOnTheGround: Boolean(panel.closest('.book-plate')),
            }
        })

        expect(view.panelOnTheGround,
            'the panel is on the writing\'s ground, which hides the canvas').toBe(false)
        expect(view.freeFraction,
            'too little of the canvas is visible while using the panel').toBeGreaterThan(0.25)
    })

    for (const effect of walk) {
        test(`${effect.chapter}/${effect.slug} compiles and renders`, async ({ page }) => {
            const consoleErrors = []
            page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
            page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`))

            await page.goto(url(effect))
            await page.waitForFunction(() => document.body.dataset.bookReady, { timeout: 45000 })

            expect(await page.evaluate(() => document.body.dataset.bookReady)).toBe('true')
            await expect(page.locator('#compile-error')).toBeEmpty()

            // The program on the page is the one the engine derives for it.
            expect(await page.locator('#dsl-editor').evaluate(el => el.value)).toBe(effect.program)

            // The writing is in the HTML, not injected, so it is there whether
            // or not the shader came up.
            const prose = await page.locator('.book-prose').innerText()
            expect(prose.trim().length).toBeGreaterThan(40)
            await expect(page.locator('.book-plate__title')).toHaveText(effect.title)

            // Polymorphic's parameter panel, opened on this page's own effect
            // and populated from the engine's definition of it.
            const panel = page.locator('effect-controls')
            await expect(panel).not.toHaveAttribute('hidden', '')
            await expect(panel.locator('.ec-name')).toHaveText(effect.func)
            expect(await panel.locator('.ec-body > *').count(),
                'parameter panel is empty').toBeGreaterThan(0)

            // The reading page is one scrolling column, so length is no longer
            // the constraint it was when three pinned blocks divided the
            // viewport. What must hold is that nothing is clipped: every block
            // is as tall as its own content, and neither the writing nor the
            // parameter panel is cut off by a box it cannot scroll.
            const layout = await page.evaluate(() => {
                const clip = (sel) => {
                    const el = document.querySelector(sel)
                    return el ? el.scrollHeight - el.clientHeight : null
                }
                const plate = document.querySelector('.book-plate').getBoundingClientRect()
                return {
                    prose: clip('.book-plate__inner'),
                    panel: clip('effect-controls'),
                    hScroll: document.documentElement.scrollWidth - window.innerWidth,
                    // The writing's ground has to run to the bottom edge of the
                    // screen. A ground that stopped short would put an opaque
                    // band across the middle of the page with art above and
                    // below it.
                    groundShortOfEdge: window.innerHeight - plate.bottom,
                }
            })
            expect(layout.prose, 'the writing is clipped').toBeLessThanOrEqual(1)
            expect(layout.panel, 'the parameter panel is clipped').toBeLessThanOrEqual(1)
            expect(layout.hScroll, 'the page scrolls sideways').toBeLessThanOrEqual(0)
            expect(layout.groundShortOfEdge,
                'the writing\'s ground stops short of the bottom edge').toBeLessThanOrEqual(1)

            // Further reading. Every page sends the reader on somewhere.
            const links = page.locator('.book-plate__links a')
            expect(await links.count()).toBeGreaterThanOrEqual(2)
            for (const href of await links.evaluateAll(els => els.map(el => el.href))) {
                expect(href).toMatch(/^https:\/\//)
            }

            // Let a few frames land before judging the canvas: some effects
            // (feedback, points, reaction-diffusion) start from a blank buffer.
            await page.waitForTimeout(1500)
            const { spread } = await canvasHasImage(page)
            const reason = CANVAS_NOT_ASSERTED[effect.id]
            if (reason) {
                // Reported, not asserted. See CANVAS_NOT_ASSERTED.
                console.log(`  canvas not asserted: ${effect.id} spread=${spread.toFixed(1)} (${reason})`)
            } else {
                expect(spread, 'canvas is blank or a single flat colour').toBeGreaterThan(2)
            }

            expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
        })
    }
})
