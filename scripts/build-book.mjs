#!/usr/bin/env node
/**
 * Render The Book of Polymorphic DSL into dist/book/.
 *
 * Input is book/data/effects.json (committed, produced by
 * scripts/extract-book-data.mjs) plus one prose file per effect under
 * book/content/. No network, no engine import: this stage is pure text, so it
 * runs in CI and in the deploy job without reaching the shader CDN.
 *
 *   node scripts/build-book.mjs
 *   node scripts/build-book.mjs --allow-missing   # local preview while writing
 *   node scripts/build-book.mjs --out some/dir
 *
 * A missing prose file is a build failure by default, and so is a page whose
 * prose names a parameter the engine does not define. The book's whole claim
 * is that every page describes what its shader actually does; a page with
 * nothing under the title breaks that loudly, and a page telling the reader to
 * type a parameter that was renamed three versions ago breaks it quietly.
 * See scripts/check-book-params.mjs for the resolution rules.
 *
 * Output lands in dist/, NOT in public/. The standalone desktop and mobile
 * pipeline stages polymorphic/public straight from the working checkout without
 * running any build (scaffold apps/standalone-build/bin/build), so a generated
 * public/book/ would ride into three shipped apps on whichever machine happened
 * to have built it, and not on one that had not. Keeping the book out of the
 * web root makes those app payloads identical to what they are today, on every
 * machine, with no change to that pipeline. The deploy rsyncs dist/book/
 * separately; scripts/serve-book.mjs mounts it at /book for local work.
 */

import { mkdir, writeFile, readFile, rm, readdir, copyFile } from 'node:fs/promises'
import { buildIndex, checkParagraph } from './check-book-params.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DATA = join(REPO, 'book', 'data', 'effects.json')
const CONTENT = join(REPO, 'book', 'content')
const ASSETS = join(REPO, 'book', 'assets')

const argv = process.argv.slice(2)
const ALLOW_MISSING = argv.includes('--allow-missing')
const outFlag = argv.indexOf('--out')
const OUT = outFlag >= 0 && argv[outFlag + 1]
    ? resolve(REPO, argv[outFlag + 1])
    : join(REPO, 'dist', 'book')

const SITE = 'https://polymorphic.noisedeck.app'
const BOOK_TITLE = 'The Book of Polymorphic DSL'
const HANDFISH = 'https://handfish.noisefactor.io/0'
const FONTS = 'https://fonts.noisefactor.io/fonts'

const ORDINALS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/**
 * The cover demo. Uses only chapters the book covers, and stays cheap. Every
 * effect in it is one that renders reliably on an idle machine: `octaveWarp`
 * looked right here but paints only under load, which left the cover black.
 */
const COVER_PROGRAM = `search synth, filter

noise(
  type: simplex,
  octaves: 5,
  ridges: true,
  scaleX: 38,
  scaleY: 38,
  speed: 9,
  colorMode: mono
)
  .warp(strength: 55, scale: 2, speed: 1)
  .palette(index: palette.neptune, repeat: 2)
  .bloom(threshold: 0.6, intensity: 0.9, radius: 48, taps: 16)
  .vignette(alpha: 0.6)
  .write(o0)

render(o0)`

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c])
}

/**
 * Prose files are plain text: blank-line-separated paragraphs, with backticks
 * for inline code. Deliberately not a markdown dependency — this is the entire
 * vocabulary the writing uses, and a parser that accepts more would let
 * unreviewed markup into 187 pages.
 */
function renderProse(text, where) {
    const paragraphs = text.trim().split(/\n\s*\n/).filter(Boolean)
    if (!paragraphs.length) throw new Error(`${where}: prose file is empty`)
    return paragraphs
        .map((para) => {
            const collapsed = para.replace(/\s*\n\s*/g, ' ').trim()
            const html = esc(collapsed).replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
            return `<p>${html}</p>`
        })
        .join('\n            ')
}

/**
 * A prose file ends with a `Further reading:` block, one `- Label | URL` per
 * line. Split here rather than in the page builder so the prose renderer only
 * ever sees prose, and so the same parse serves the offline tests and the link
 * checker (bin/check-book-links.mjs).
 */
export function splitProseFile(text) {
    const marker = /^Further reading:\s*$/m
    const at = text.search(marker)
    if (at < 0) return { prose: text, links: [] }
    const prose = text.slice(0, at)
    const links = text.slice(at).split('\n').slice(1)
        .map(line => line.trim())
        .filter(line => line.startsWith('- '))
        .map((line) => {
            const [label, url] = line.slice(2).split('|').map(s => s.trim())
            return { label, url }
        })
    return { prose, links }
}

/**
 * The further-reading row. One line at the foot of the plate, so a reader who
 * wants the actual paper, the original algorithm, or the history can get there
 * without the page turning into a bibliography.
 */
function renderLinks(links, where) {
    if (!links.length) throw new Error(`${where}: no Further reading links`)
    for (const { label, url } of links) {
        if (!label || !url) throw new Error(`${where}: malformed link line`)
        if (!url.startsWith('https://')) throw new Error(`${where}: ${url} is not https`)
    }
    const items = links
        .map(({ label, url }) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`)
        .join('\n                ')
    return `<nav class="book-plate__links" aria-label="Further reading">
                <span class="book-plate__links-label">Further reading</span>
                ${items}
            </nav>`
}

/** First sentence of the prose, for <meta name="description">. */
function metaDescription(effect, prose) {
    const flat = prose.trim().replace(/\s*\n\s*/g, ' ').replace(/`/g, '')
    const sentence = flat.match(/^.*?[.!?](?=\s|$)/)
    const text = (sentence ? sentence[0] : flat).trim()
    if (text.length <= 155) return text
    return `${effect.title}: ${effect.description}`
}

/* ------------------------------------------------------------------ *
 * Shared page furniture
 * ------------------------------------------------------------------ */

function head({ title, description, canonical, extraHead = '' }) {
    return `    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="author" content="Noise Factor">
    <link rel="canonical" href="${esc(canonical)}">
    <link rel="icon" type="image/png" href="/img/polymorphic.png">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="${esc(BOOK_TITLE)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:image" content="${SITE}/img/og-image.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${SITE}/img/og-image.png">
    <link rel="preconnect" href="${FONTS.replace('/fonts', '')}" crossorigin>
    <link rel="preconnect" href="https://shaders.noisedeck.app" crossorigin>
    <link rel="preload" href="${FONTS}/comfortaa/Comfortaa-Block.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="${FONTS}/nunito/Nunito-Blank.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="${FONTS}/noto-sans-mono/NotoSansMono-Blank.woff2" as="font" type="font/woff2" crossorigin>
    <script type="importmap">
        { "imports": { "handfish": "${HANDFISH}/handfish.esm.min.js" } }
    </script>
    <link rel="stylesheet" href="${HANDFISH}/styles/tokens.css">
    <!-- neutral-dark: pure greys, zero chroma, so the shader on the page is the
         only colour in the room. Set on <html> above. -->
    <link rel="stylesheet" href="${HANDFISH}/styles/themes/neutral.css">
    <!-- The same handfish chrome Polymorphic loads for the parameter panel:
         dialogs.css for the <color-picker> modal, forms.css for the native
         inputs inside it, menus-and-toolbars.css for its .hf-icon-btn
         titlebar buttons. All .hf-* scoped, so none of it reaches the book's
         own styles. -->
    <link rel="stylesheet" href="${HANDFISH}/styles/dialogs.css">
    <link rel="stylesheet" href="${HANDFISH}/styles/forms.css">
    <link rel="stylesheet" href="${HANDFISH}/styles/menus-and-toolbars.css">
    <link rel="stylesheet" href="/book/assets/book.css">
${extraHead}`
}

function icon(name) {
    return `<span class="hf-icon" aria-hidden="true">${name}</span>`
}

function railStep(href, label, glyph) {
    if (!href) {
        return `<span class="book-rail__step" aria-disabled="true" aria-label="${esc(label)}">${icon(glyph)}</span>`
    }
    return `<a class="book-rail__step" href="${esc(href)}" aria-label="${esc(label)}" title="${esc(label)}">${icon(glyph)}</a>`
}

/* ------------------------------------------------------------------ *
 * Reading page
 * ------------------------------------------------------------------ */

function pageUrl(effect) {
    return `/book/${effect.chapter}/${effect.slug}/`
}

function readingPage({ effect, prose, links = '', chapter, chapterIndex, nav, folio }) {
    const title = `${effect.title} · ${chapter.title} · ${BOOK_TITLE}`
    const canonical = `${SITE}${pageUrl(effect)}`
    const description = metaDescription(effect, prose)

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: effect.title,
        description,
        url: canonical,
        articleSection: `${chapter.title} — ${chapter.subtitle}`,
        isPartOf: { '@type': 'Book', name: BOOK_TITLE, url: `${SITE}/book/` },
        publisher: { '@type': 'Organization', name: 'Noise Factor', url: 'https://noisefactor.io' },
        about: { '@type': 'SoftwareSourceCode', programmingLanguage: 'Noisemaker DSL', name: effect.func },
    }

    const pageData = {
        id: effect.id,
        // The function name the program calls, so the page can open the
        // parameter panel on this effect rather than on the one feeding it.
        func: effect.func,
        program: effect.program,
        polymorphic: `${SITE}/`,
        nav: { index: '/book/', prev: nav.prev, next: nav.next },
    }

    return `<!DOCTYPE html>
<html lang="en" data-theme="neutral-dark">
<head>
${head({ title, description, canonical, extraHead: `    <script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 4).split('\n').map(l => '    ' + l).join('\n')}\n    </script>` })}
</head>
<body class="book-reader">
    <canvas id="canvas"></canvas>
    <div class="book-boot" id="boot">compiling ${esc(effect.func)}</div>

    <header class="book-rail">
        <a class="book-rail__mark" href="/book/" title="Contents" aria-label="Contents">${icon('menu_book')}<span class="book-rail__mark-text">The Book of <span>Polymorphic DSL</span></span></a>
        <nav class="book-rail__nav" aria-label="Reader navigation">
            ${railStep(nav.prevChapter, 'Previous chapter', 'first_page')}
            ${railStep(nav.prev, 'Previous page', 'chevron_left')}
            <!-- The effect's own name leads here. A parameter-heavy page starts
                 its title below the fold, so without this a reader landing from
                 search sees a program and a panel with nothing saying what they
                 are for. The chapter is the part that drops on a phone. -->
            <span class="book-rail__folio"><b>${esc(effect.title)}</b> · ${folio.position} of ${folio.total}<span class="book-rail__folio-chapter"> · ${esc(chapter.title)}</span></span>
            ${railStep(nav.next, 'Next page', 'chevron_right')}
            ${railStep(nav.nextChapter, 'Next chapter', 'last_page')}
        </nav>
        <a class="book-rail__tear" id="tear-off" href="${SITE}/?dsl=${encodeURIComponent(effect.program)}" target="_blank" rel="noopener" title="Open this program in Polymorphic" aria-label="Tear off into Polymorphic"><span class="book-rail__tear-text">tear off</span>${icon('open_in_new')}</a>
    </header>

    <!-- One scrolling column over a fixed canvas. The program and the
         parameter panel sit on bare shader, because both are operated while
         watching the picture; the writing sits on a scrim that ramps in once
         and runs to the bottom of the page. -->
    <main class="book-article">
        <div class="book-program">
            <code-editor id="dsl-editor" spellcheck="false" aria-label="${esc(effect.title)} program"></code-editor>
            <p class="book-program__note">edit anything · <kbd>&#8984;&#8629;</kbd> or <kbd>Ctrl&#8629;</kbd> recompiles</p>
            <div class="book-error" id="compile-error" role="alert"></div>
        </div>

        <!-- Polymorphic's own <effect-controls> panel, built by book-page.js.
             Open by default, since the whole page is about one effect. Above
             the writing's ground rather than on it: the ground is 95% opaque,
             and a reader moving a control has to be able to see what it
             does. -->
        <div class="book-controls" id="effect-controls-host"></div>

        <footer class="book-plate">
            <div class="book-plate__inner">
                <p class="book-plate__eyebrow">Chapter ${ORDINALS[chapterIndex]} · ${esc(chapter.title)} <em>(${esc(chapter.subtitle)})</em></p>
                <h1 class="book-plate__title">${esc(effect.title)}</h1>
                <hr class="book-plate__rule">
                <div class="book-prose">
                ${prose}
                </div>
                ${links}
            </div>
        </footer>
    </main>

    <script type="application/json" id="book-page-data">${JSON.stringify(pageData)}</script>
    <script type="module" src="/book/assets/book-page.js"></script>
</body>
</html>
`
}

/* ------------------------------------------------------------------ *
 * Contents
 * ------------------------------------------------------------------ */

function indexPage({ chapters, effects }) {
    const title = BOOK_TITLE
    const canonical = `${SITE}/book/`
    const description = `An illustrated reference to every effect in the Noisemaker DSL. ${effects.length} pages, each one a running program you can edit.`

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Book',
        name: BOOK_TITLE,
        url: canonical,
        description,
        numberOfPages: effects.length,
        inLanguage: 'en',
        publisher: { '@type': 'Organization', name: 'Noise Factor', url: 'https://noisefactor.io' },
        hasPart: chapters.map((c, i) => ({
            '@type': 'Chapter',
            position: i + 1,
            name: `${c.title} — ${c.subtitle}`,
            url: `${canonical}#${c.id}`,
        })),
    }

    const sections = chapters.map((chapter, i) => {
        const own = effects.filter(e => e.chapter === chapter.id)
        const entries = own.map(effect => `                    <li><a class="book-entry" href="${pageUrl(effect)}">
                        <span class="book-entry__name">${esc(effect.title)}</span>
                        <span class="book-entry__func">${esc(effect.func)}()</span>
                        <span class="book-entry__desc">${esc(effect.description)}</span>
                    </a></li>`).join('\n')

        return `            <section class="book-chapter" id="${esc(chapter.id)}">
                <div class="book-chapter__head">
                    <p class="book-chapter__number">Chapter ${ORDINALS[i]} · ${own.length} page${own.length === 1 ? '' : 's'}</p>
                    <h2 class="book-chapter__title">${esc(chapter.title)}<small>${esc(chapter.subtitle)}</small></h2>
                    <p class="book-chapter__blurb">${esc(chapter.blurb)}</p>
                </div>
                <ul class="book-entries">
${entries}
                </ul>
            </section>`
    }).join('\n')

    return `<!DOCTYPE html>
<html lang="en" data-theme="neutral-dark">
<head>
${head({ title, description, canonical, extraHead: `    <script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 4).split('\n').map(l => '    ' + l).join('\n')}\n    </script>` })}
</head>
<body class="book-index">
    <canvas id="canvas"></canvas>

    <div class="book-index__scroll">
        <header class="book-cover">
            <p class="book-cover__kicker">Noise Factor · Polymorphic</p>
            <h1 class="book-cover__title">The Book of Polymorphic DSL</h1>
            <p class="book-cover__standfirst">Polymorphic is Noisemaker Engine's high-level composition language that
            compiles into a WebGL2 or WebGPU shader graph. Explore the shader effects library and learn about the
            algorithms behind the pixels. Jump off into further reading, or experiment with the effects in-app.</p>
        </header>

        <nav class="book-chapter-nav" aria-label="Chapters">
${chapters.map(c => `            <a class="book-chapter-nav__link" href="#${esc(c.id)}">${esc(c.title)} <b>${effects.filter(e => e.chapter === c.id).length}</b></a>`).join('\n')}
        </nav>

        <div class="book-contents-ground">
            <main class="book-contents">
${sections}

                <div class="book-colophon">
                    <p><a href="/">Polymorphic</a> · <a href="https://noisemaker.app">Noisemaker</a> · <a href="https://noisefactor.io">Noise Factor</a></p>
                </div>
            </main>
        </div>
    </div>

    <script type="application/json" id="book-page-data">${JSON.stringify({ program: COVER_PROGRAM })}</script>
    <script type="module" src="/book/assets/book-index.js"></script>
</body>
</html>
`
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

async function copyAssets() {
    const dest = join(OUT, 'assets')
    await mkdir(dest, { recursive: true })
    for (const name of await readdir(ASSETS)) {
        await copyFile(join(ASSETS, name), join(dest, name))
    }
}

async function main() {
    const { chapters, effects } = JSON.parse(await readFile(DATA, 'utf8'))

    // Reading order: chapters in book order, effects alphabetical within each.
    const ordered = []
    for (const chapter of chapters) {
        for (const effect of effects.filter(e => e.chapter === chapter.id)) ordered.push(effect)
    }
    if (ordered.length !== effects.length) {
        throw new Error(`chapter list does not cover every effect (${ordered.length} of ${effects.length})`)
    }

    const firstOfChapter = new Map()
    for (const effect of ordered) {
        if (!firstOfChapter.has(effect.chapter)) firstOfChapter.set(effect.chapter, pageUrl(effect))
    }

    await rm(OUT, { recursive: true, force: true })
    await mkdir(OUT, { recursive: true })
    await copyAssets()

    const missing = []
    // Identifiers the prose puts in backticks that the engine does not define.
    // A page can compile, render and read perfectly while telling the reader
    // to type a parameter name that no longer exists, so the build checks the
    // writing against the extracted definitions the same way it checks that
    // the writing is there at all.
    const index = buildIndex({ effects })
    const unresolved = []
    let written = 0

    for (let i = 0; i < ordered.length; i++) {
        const effect = ordered[i]
        const chapterIndex = chapters.findIndex(c => c.id === effect.chapter)
        const chapter = chapters[chapterIndex]

        const file = join(CONTENT, effect.chapter, `${effect.slug}.md`)
        let raw = await readFile(file, 'utf8').catch(() => null)
        if (raw === null) {
            missing.push(`${effect.chapter}/${effect.slug}.md`)
            if (!ALLOW_MISSING) continue
            raw = `Not yet written. This page demonstrates \`${effect.func}\`: ${effect.description}.`
        }

        const where = `${effect.chapter}/${effect.slug}`
        const split = splitProseFile(raw)
        for (const paragraph of split.prose.trim().split(/\n\s*\n/).filter(Boolean)) {
            for (const token of checkParagraph(paragraph, effect, index)) {
                unresolved.push(`${where}: \`${token}\` is not a parameter, choice, or effect the engine defines`)
            }
        }
        const prose = renderProse(split.prose, where)
        const links = ALLOW_MISSING && !split.links.length ? '' : renderLinks(split.links, where)

        // Page turns run straight through the book; chapter turns jump to the
        // head of the neighbouring chapter.
        const prevChapter = chapters[chapterIndex - 1]
        const nextChapter = chapters[chapterIndex + 1]
        const nav = {
            prev: i > 0 ? pageUrl(ordered[i - 1]) : null,
            next: i < ordered.length - 1 ? pageUrl(ordered[i + 1]) : null,
            prevChapter: prevChapter ? firstOfChapter.get(prevChapter.id) : null,
            nextChapter: nextChapter ? firstOfChapter.get(nextChapter.id) : null,
        }

        const html = readingPage({
            effect,
            prose,
            links,
            chapter,
            chapterIndex,
            nav,
            folio: { position: i + 1, total: ordered.length },
        })

        const dest = join(OUT, effect.chapter, effect.slug, 'index.html')
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, html)
        written++
    }

    await writeFile(join(OUT, 'index.html'), indexPage({ chapters, effects: ordered }))

    if (missing.length && !ALLOW_MISSING) {
        process.stderr.write(`\nmissing prose for ${missing.length} effect(s):\n`)
        for (const m of missing) process.stderr.write(`  book/content/${m}\n`)
        process.stderr.write('\nWrite them, or pass --allow-missing to preview locally.\n')
        process.exit(1)
    }

    if (unresolved.length && !ALLOW_MISSING) {
        process.stderr.write(`\n${unresolved.length} identifier(s) in the prose do not resolve:\n`)
        for (const u of unresolved) process.stderr.write(`  ${u}\n`)
        process.stderr.write('\nThe writing has drifted from the engine. book/data/effects.json is\n')
        process.stderr.write('the authority; regenerate it with scripts/extract-book-data.mjs if the\n')
        process.stderr.write('engine itself has changed. Run scripts/check-book-params.mjs for detail.\n')
        process.exit(1)
    }

    process.stdout.write(`book: ${written} pages + contents -> ${OUT.replace(REPO + "/", "")}/\n`)
    if (missing.length) {
        process.stdout.write(`  ${missing.length} placeholder page(s) (--allow-missing)\n`)
    }
}

// Only build when run as a command. The offline tests import splitProseFile
// from here so the parse they check is the parse that ships.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(err => {
        process.stderr.write(`${err.stack || err}\n`)
        process.exit(1)
    })
}
