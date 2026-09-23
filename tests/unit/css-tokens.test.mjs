import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cssDir = path.resolve(__dirname, '../../public/css')

function readCss(filename) {
    return fs.readFileSync(path.join(cssDir, filename), 'utf8')
}

/**
 * Extracts property declaration values from CSS, ignoring comments and selectors.
 */
function extractDeclarationValues(css) {
    // Strip comments
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const declarations = []
    // Match innermost rule blocks containing declarations
    const blockRegex = /\{([^{}]+)\}/g
    let blockMatch
    while ((blockMatch = blockRegex.exec(stripped)) !== null) {
        const blockContent = blockMatch[1]
        const rules = blockContent.split(';')
        for (const rule of rules) {
            const colonIdx = rule.indexOf(':')
            if (colonIdx !== -1) {
                const prop = rule.slice(0, colonIdx).trim()
                const value = rule.slice(colonIdx + 1).trim()
                if (prop && value && !prop.startsWith('@')) {
                    declarations.push({ prop, value })
                }
            }
        }
    }
    return declarations
}

test('public/css stylesheets contain zero !important declarations', () => {
    for (const file of ['menu.css', 'sync.css', 'touch.css']) {
        const css = readCss(file)
        assert.doesNotMatch(
            css,
            /!important/,
            `${file} must not contain any !important declarations`
        )
    }
})

test('public/css stylesheets contain zero raw rgb/rgba or hsl/hsla color literals', () => {
    for (const file of ['menu.css', 'sync.css', 'touch.css']) {
        const decls = extractDeclarationValues(readCss(file))
        for (const { prop, value } of decls) {
            assert.doesNotMatch(
                value,
                /\b(?:rgba?|hsla?)\s*\(/i,
                `${file} [${prop}: ${value}] must not use raw rgb/rgba or hsl/hsla literals; use --hf-* tokens`
            )
        }
    }
})

test('public/css stylesheets contain zero raw hex color literals', () => {
    for (const file of ['menu.css', 'sync.css', 'touch.css']) {
        const decls = extractDeclarationValues(readCss(file))
        for (const { prop, value } of decls) {
            assert.doesNotMatch(
                value,
                /#[0-9a-fA-F]{3,8}\b/,
                `${file} [${prop}: ${value}] must not use raw hex colors; use --hf-* tokens`
            )
        }
    }
})

test('public/css/menu.css maps theme variables to Handfish tokens', () => {
    const css = readCss('menu.css')
    const decls = extractDeclarationValues(css)
    const map = new Map(decls.map(d => [d.prop, d.value]))

    // Neutral color aliases
    assert.match(map.get('--color2') || '', /var\(--hf-/)
    assert.match(map.get('--color6') || '', /var\(--hf-/)
    assert.match(map.get('--color7') || '', /var\(--hf-/)
    assert.match(map.get('--accent3') || '', /var\(--hf-/)
    assert.match(map.get('--accent4') || '', /var\(--hf-/)

    // Menu color aliases
    assert.match(map.get('--menu-bg') || '', /var\(--hf-bg-surface/)
    assert.match(map.get('--menu-bg') || '', /var\(--hf-header-opacity/)
    assert.match(map.get('--menu-text') || '', /var\(--hf-/)
    assert.match(map.get('--menu-text-hover') || '', /var\(--hf-/)
    assert.match(map.get('--menu-accent') || '', /var\(--hf-/)
    assert.match(map.get('--menu-accent-hover') || '', /var\(--hf-/)
    assert.match(map.get('--menu-border') || '', /var\(--hf-/)
})

test('public/css/menu.css tooltip uses Handfish design tokens', () => {
    const css = readCss('menu.css')
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-bg-surface/)
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-text-bright/)
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-border-subtle/)
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-radius-sm/)
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-shadow-md/)
    assert.match(css, /\.tooltip::before[\s\S]*?var\(--hf-z-tooltip/)
})

test('public/css/sync.css uses Handfish tokens for dialog variables and backdrop', () => {
    const css = readCss('sync.css')
    const decls = extractDeclarationValues(css)
    const map = new Map(decls.map(d => [d.prop, d.value]))

    assert.match(map.get('--sync-panel') || '', /var\(--hf-/)
    assert.match(map.get('--sync-line') || '', /var\(--hf-/)
    assert.match(map.get('--sync-copy') || '', /var\(--hf-/)
    assert.match(map.get('--sync-muted') || '', /var\(--hf-/)
    assert.match(map.get('--sync-ready') || '', /var\(--hf-/)
    assert.match(map.get('--sync-live') || '', /var\(--hf-/)

    // Backdrop tokens
    assert.match(css, /\.sync-output-dialog::backdrop[\s\S]*?var\(--hf-backdrop/)
    assert.match(css, /\.sync-output-dialog::backdrop[\s\S]*?var\(--hf-glass-blur/)
})

test('public/css/touch.css canvas-flash keyframe references Handfish accent token', () => {
    const css = readCss('touch.css')
    assert.match(css, /canvas-flash[\s\S]*?var\(--hf-accent/)
})

test('public/css/menu.css menu dropdown panel uses elevation shadow and hover token', () => {
    const css = readCss('menu.css')
    assert.match(
        css,
        /#menu \.hf-menubar-panel\b[\s\S]*?box-shadow:\s*var\(--hf-shadow/,
        'menu dropdown panel must use an elevation shadow token'
    )
    assert.match(
        css,
        /#menu \.hf-menubar-panel \.hf-menu-item:hover[\s\S]*?background-color:\s*(?:var\(--hf-|color-mix)/,
        'menu item hover must provide a visible surface highlight'
    )
})

test('public/index.html modal dialogs and panels use Handfish semantic tokens', () => {
    const htmlPath = path.resolve(__dirname, '../../public/index.html')
    const html = fs.readFileSync(htmlPath, 'utf8')

    // #programModal should use semantic Handfish tokens for theme contrast
    assert.match(
        html,
        /#programModal\s*\{[\s\S]*?color:\s*var\(--hf-text-normal/,
        '#programModal must use var(--hf-text-normal) or semantic token for body text'
    )
    assert.doesNotMatch(
        html,
        /#programModal\s*\{[\s\S]*?color:\s*#d9deeb/,
        '#programModal must not hardcode light text color #d9deeb'
    )
    assert.match(
        html,
        /\.control-select\s*\{[\s\S]*?background:\s*var\(--hf-bg-elevated/,
        '.control-select must use var(--hf-bg-elevated) or semantic background token'
    )
    assert.doesNotMatch(
        html,
        /\.control-select\s*\{[\s\S]*?background:\s*#131927/,
        '.control-select must not hardcode dark background #131927'
    )

    // #share-modal should use semantic Handfish tokens
    assert.match(
        html,
        /\.share-modal-content\s*\{[\s\S]*?var\(--hf-bg-surface/,
        '.share-modal-content must use var(--hf-bg-surface) for theme adaptability'
    )
    assert.doesNotMatch(
        html,
        /\.share-modal-content\s*\{[\s\S]*?background:\s*rgba\(10,\s*10,\s*15/,
        '.share-modal-content must not hardcode dark rgba background'
    )

    // #doc-reader-panel should use semantic Handfish tokens
    assert.match(
        html,
        /#doc-reader-panel\s*\{[\s\S]*?var\(--hf-bg-surface/,
        '#doc-reader-panel must use var(--hf-bg-surface) for theme adaptability'
    )
    assert.doesNotMatch(
        html,
        /#doc-reader-panel\s*\{[\s\S]*?background:\s*rgba\(0,\s*0,\s*0/,
        '#doc-reader-panel must not hardcode dark rgba background'
    )
})

test('public/js/ui/gallery.js uses Handfish semantic tokens and no hardcoded error hexes', () => {
    const galleryPath = path.resolve(__dirname, '../../public/js/ui/gallery.js')
    const galleryCode = fs.readFileSync(galleryPath, 'utf8')

    assert.doesNotMatch(
        galleryCode,
        /#ff7b72/,
        'gallery.js must not contain hardcoded #ff7b72 color literal; use var(--hf-red)'
    )
    assert.match(
        galleryCode,
        /\.gallery-modal\s*\{[\s\S]*?var\(--hf-bg-surface/,
        '.gallery-modal must use var(--hf-bg-surface)'
    )
})

test('public/js/ui/shortcutsDialog.js uses Handfish semantic tokens', () => {
    const shortcutsPath = path.resolve(__dirname, '../../public/js/ui/shortcutsDialog.js')
    const shortcutsCode = fs.readFileSync(shortcutsPath, 'utf8')

    assert.match(
        shortcutsCode,
        /\.shortcuts-modal\s*\{[\s\S]*?var\(--hf-bg-surface/,
        '.shortcuts-modal must use var(--hf-bg-surface)'
    )
})

test('public/js/ui/recorder.js uses Handfish semantic tokens and contains zero raw color literals or !important', () => {
    const recorderPath = path.resolve(__dirname, '../../public/js/ui/recorder.js')
    const recorderCode = fs.readFileSync(recorderPath, 'utf8')

    const styleMatch = recorderCode.match(/style\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, 'recorder.js must define injected style.textContent')
    const css = styleMatch[1]

    assert.doesNotMatch(
        css,
        /!important/,
        'recorder.js injected CSS must not use !important'
    )
    assert.doesNotMatch(
        css,
        /#[0-9a-fA-F]{3,8}\b/,
        'recorder.js injected CSS must not contain raw hex color literals'
    )
    assert.doesNotMatch(
        css,
        /\b(?:rgba?|hsla?)\s*\(/i,
        'recorder.js injected CSS must not contain raw rgb/rgba/hsl/hsla literals'
    )
    assert.match(
        css,
        /var\(--hf-red\)/,
        'recorder.js must use var(--hf-red)'
    )
    assert.match(
        css,
        /var\(--hf-yellow\)/,
        'recorder.js must use var(--hf-yellow) for warning state'
    )
    assert.match(
        css,
        /var\(--hf-bg-surface\)/,
        'recorder.js must use var(--hf-bg-surface)'
    )
    assert.match(
        css,
        /var\(--hf-text-bright\)/,
        'recorder.js must use var(--hf-text-bright)'
    )
    assert.match(
        css,
        /var\(--hf-border-subtle\)/,
        'recorder.js must use var(--hf-border-subtle)'
    )
})


