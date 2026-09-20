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
