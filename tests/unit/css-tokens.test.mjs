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

// Raw color function literals (oklch/oklab/lab/lch/color()) are hardcoding
// too. The only permitted use is *defining* an app-level directional color
// alias (e.g. `--ui-chrome-highlight-color: oklch(100% 0 0)` inside a rule
// whose block contains only custom-property definitions) — the Handfish
// "add a semantic alias rather than hardcoding" rule. Any use inside a real
// (non-custom) property declaration is rejected.
function assertNoRawColorFunctionLiterals(css, file) {
    const decls = extractDeclarationValues(css)
    for (const { prop, value } of decls) {
        if (prop.startsWith('--')) continue
        assert.doesNotMatch(
            value,
            /\b(?:oklch|oklab|lab|lch|color)\s*\(/i,
            `${file} [${prop}: ${value}] must not use raw oklch/lab/color() literals; reference the app-level alias`
        )
    }
}

test('public/css stylesheets contain zero raw oklch/lab/color() literals in declarations', () => {
    for (const file of ['menu.css', 'sync.css', 'touch.css']) {
        assertNoRawColorFunctionLiterals(readCss(file), file)
    }
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8')
    assertNoRawColorFunctionLiterals(html, 'public/index.html')
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

test('public/css/menu.css chrome gradient anchors are fixed directional endpoints', () => {
    const css = readCss('menu.css')
    // The titlebar gradient must lighten at top and darken at bottom in EVERY
    // theme, so its endpoints are fixed neutral directional anchors declared
    // once as app-level aliases and referenced by name — theme-flipping
    // tokens (e.g. --hf-text-bright) would invert the gradient in the light
    // theme. Raw literal values are permitted only inside the alias
    // definitions themselves (see the comment on the definitions in
    // menu.css); every real declaration must reference the alias.
    assert.match(css, /--ui-titlebar-highlight:/)
    assert.match(css, /var\(--ui-chrome-highlight-color\)/)
    assert.match(css, /var\(--ui-chrome-shadow-color\)/)
    // The aliases must be defined exactly once, in the :root token block.
    const defs = css.match(/--ui-chrome-(?:highlight|shadow)-color:/g) || []
    assert.equal(defs.length, 2, 'chrome anchor aliases must be defined exactly once (highlight + shadow)')
    assert.doesNotMatch(css, /--ui-chrome-highlight-color:\s*var\(--hf-/)
    assert.doesNotMatch(css, /--ui-chrome-shadow-color:\s*var\(--hf-/)
})

test('Polymorphic delegates tooltips to Handfish without a competing CSS tooltip', () => {
    const css = readCss('menu.css')
    assert.doesNotMatch(css, /\.tooltip::before/)
    const embed = fs.readFileSync(new URL('../../public/js/embed.js', import.meta.url), 'utf8')
    assert.match(embed, /initializeTooltips\(\)/)
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

function assertInjectedCssTokenClean(moduleName) {
    const modulePath = path.resolve(__dirname, `../../public/js/ui/${moduleName}`)
    const code = fs.readFileSync(modulePath, 'utf8')
    const styleMatch = code.match(/style(?:El)?\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, `${moduleName} must define injected style.textContent`)
    const css = styleMatch[1]

    assert.doesNotMatch(
        css,
        /#[0-9a-fA-F]{3,8}\b/,
        `${moduleName} injected CSS must not contain raw hex color literals`
    )
    assert.doesNotMatch(
        css,
        /\b(?:rgba?|hsla?)\s*\(/i,
        `${moduleName} injected CSS must not contain raw rgb/rgba/hsl/hsla literals`
    )
    // Named CSS color literals are hardcoding too (e.g. `black` fallbacks).
    // Black and white commonly appear in shadow/gesture values; reject every
    // other named color outright and reject black/white unless the token
    // fallback chain already provides a `--hf-` reference.
    const NAMED_COLORS = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|grey|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat'
    assert.doesNotMatch(
        css,
        new RegExp(`\\b(?:${NAMED_COLORS})\\b`, 'i'),
        `${moduleName} injected CSS must not contain named color literals; use --hf-* tokens`
    )
    // Inside a var() fallback chain a bare `black`/`white` terminal fallback
    // hardcodes the value the token resolves to; assert every black/white
    // occurrence is wrapped in an inner var() token reference instead.
    // Non-color properties (`white-space`) legitimately contain `white`, so
    // only color-ish declarations are inspected.
    const COLOR_PROPS = /(?:^|\n)\s*(?:color|background(?:-color)?|border(?:-\w+)?-color|box-shadow|text-shadow|fill|stroke|-webkit-text-fill-color)\s*:/
    for (const decl of css.split(';')) {
        const valuePart = decl.includes(':') ? decl.slice(decl.indexOf(':') + 1) : ''
        if (!/\b(?:black|white)\b/.test(valuePart)) continue
        assert.match(
            decl,
            COLOR_PROPS,
            `${moduleName} black/white outside a color declaration is unexpected: ${decl.trim()}`
        )
        assert.match(
            decl,
            /var\(--hf-color-1(?:,\s*(?:black|white)\s*)?\)/,
            `${moduleName} injected CSS must not use a bare black/white fallback outside a var(--hf-color-1) chain: ${decl.trim()}`
        )
    }
    // The same rule applies to stylesheets and inline style blocks in HTML:
    // a bare `black`/`white` color value is hardcoding even inside a fallback.
    assertNoBareBlackWhite(readCss('menu.css'), 'menu.css')
    assertNoBareBlackWhite(readCss('sync.css'), 'sync.css')
    assertNoBareBlackWhite(readCss('touch.css'), 'touch.css')
    const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8')
    assertNoBareBlackWhite(html, 'public/index.html')
}

function assertNoBareBlackWhite(css, label) {
    // `--sync-input-shade: black` lives in menu.css's :root block (sync.css
    // references it by name); anything else must be a real color declaration.
    const SHADE_ALIASES = /--(?:ui-chrome-(?:highlight|shadow)-color|sync-input-shade)\s*:\s*(?:black|white)\s*(?:$|;)/
    for (const decl of css.split(';')) {
        if (SHADE_ALIASES.test(decl)) continue
        const valuePart = decl.includes(':') ? decl.slice(decl.indexOf(':') + 1) : ''
        if (!/\b(?:black|white)\b/.test(valuePart)) continue
        assert.match(
            decl,
            /var\(--hf-color-1(?:,\s*(?:black|white)\s*)?\)/,
            `${label} must not use a bare black/white value outside a var(--hf-color-1) chain or a documented :root shade alias: ${decl.trim()}`
        )
    }
}

test('perfOverlay, scrubber, and import dialogs injected CSS contain zero raw color literals', () => {
    for (const moduleName of [
        'perfOverlay.js',
        'scrubber.js',
        'import-effect-dialog.js',
        'import-from-url-dialog.js',
        'gallery.js',
        'shortcutsDialog.js',
    ]) {
        assertInjectedCssTokenClean(moduleName)
    }
})

test('gallery and shortcuts overlays use the Handfish backdrop token', () => {
    const galleryCode = fs.readFileSync(path.resolve(__dirname, '../../public/js/ui/gallery.js'), 'utf8')
    const shortcutsCode = fs.readFileSync(path.resolve(__dirname, '../../public/js/ui/shortcutsDialog.js'), 'utf8')
    for (const [name, code] of [['gallery.js', galleryCode], ['shortcutsDialog.js', shortcutsCode]]) {
        assert.match(
            code,
            /var\(--hf-backdrop/,
            `${name} overlay backdrop must use var(--hf-backdrop)`
        )
    }
})

test('scrubber !important declarations are confined to cursor and user-select guards', () => {
    const scrubberCode = fs.readFileSync(path.resolve(__dirname, '../../public/js/ui/scrubber.js'), 'utf8')
    const styleMatch = scrubberCode.match(/style\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, 'scrubber.js must define injected style.textContent')
    for (const decl of styleMatch[1].split(';')) {
        if (!decl.includes('!important')) continue
        assert.match(
            decl,
            /(?:cursor|user-select)\s*:/,
            `scrubber.js injected CSS may only use !important for cursor or user-select guards, got: ${decl.trim()}`
        )
    }
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

test('public/js/ui/commandPalette.js uses Handfish semantic tokens and contains zero raw color literals or !important', () => {
    const palettePath = path.resolve(__dirname, '../../public/js/ui/commandPalette.js')
    const paletteCode = fs.readFileSync(palettePath, 'utf8')

    const styleMatch = paletteCode.match(/style\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, 'commandPalette.js must define injected style.textContent')
    const css = styleMatch[1]

    assert.doesNotMatch(
        css,
        /!important/,
        'commandPalette.js injected CSS must not use !important'
    )
    assert.doesNotMatch(
        css,
        /#[0-9a-fA-F]{3,8}\b/,
        'commandPalette.js injected CSS must not contain raw hex color literals'
    )
    assert.doesNotMatch(
        css,
        /\b(?:rgba?|hsla?)\s*\(/i,
        'commandPalette.js injected CSS must not contain raw rgb/rgba/hsl/hsla literals'
    )
    assert.match(css, /var\(--hf-backdrop/, 'overlay backdrop must use var(--hf-backdrop)')
    assert.match(css, /var\(--hf-bg-surface/, '.cmd-palette must use var(--hf-bg-surface)')
    assert.match(css, /var\(--hf-border-subtle/, 'borders must use var(--hf-border-subtle)')
    assert.match(css, /var\(--hf-shadow-xl/, '.cmd-palette must use var(--hf-shadow-xl)')
    assert.match(css, /var\(--hf-accent/, 'active/hover highlight must use var(--hf-accent)')
    assert.match(css, /var\(--hf-text-bright/, 'title text must use var(--hf-text-bright)')
    assert.match(css, /var\(--hf-text-dim/, 'secondary text must use var(--hf-text-dim)')
    assert.match(css, /var\(--hf-text-muted/, 'placeholder/empty text must use var(--hf-text-muted)')
    assert.match(css, /var\(--hf-font-family-mono/, 'mono text must use var(--hf-font-family-mono)')
    assert.match(
        css,
        /\.cmd-palette-input:focus-visible[\s\S]*?var\(--hf-focus-ring-width/,
        'palette input must define a :focus-visible ring with --hf-focus-ring tokens'
    )
    assert.doesNotMatch(
        css,
        /\.cmd-palette-input\s*\{[^}]*?outline:\s*none/,
        'palette input must not strip focus outline without a replacement focus ring'
    )
    // No theme-specific accent hexes: #a5b8ff (accent), legacy grays
    for (const legacy of ['#a5b8ff', '#e3e3e3', '#f0f0f0', '#888', '#666', '#555']) {
        assert.doesNotMatch(paletteCode, new RegExp(legacy.replace('#', '#') + '\\b'), `commandPalette.js must not hardcode ${legacy}`)
    }
})

test('public/css/menu.css toolbar buttons follow Handfish component guidelines (padding, focus-visible, active states)', () => {
    const css = readCss('menu.css')
    // Button padding uses Handfish spacing token
    assert.match(
        css,
        /#menu \.hf-menubar-btn\s*\{[^}]*?padding:\s*var\(--hf-space-1/,
        '#menu .hf-menubar-btn must have Handfish token padding'
    )
    // Focus visible styling
    assert.match(
        css,
        /#menu \.hf-menubar-btn:focus-visible\s*\{[^}]*?outline:\s*var\(--hf-focus-ring-width/,
        '#menu .hf-menubar-btn:focus-visible must use --hf-focus-ring-width'
    )
    // Active pressed state has visible accent background (not background: none)
    assert.match(
        css,
        /#menu \.hf-menubar-btn\.active\s*\{[^}]*?color:\s*var\(--menu-accent-hover\)/,
        '#menu .hf-menubar-btn.active must use --menu-accent-hover'
    )
    assert.match(
        css,
        /#menu \.hf-menubar-btn\.active\s*\{[^}]*?background:\s*color-mix\(/,
        '#menu .hf-menubar-btn.active must provide a color-mix background'
    )
    assert.doesNotMatch(
        css,
        /#menu \.hf-menubar-btn\.active\s*\{[^}]*?background:\s*none;/,
        '#menu .hf-menubar-btn.active must not silence active state with background: none'
    )
    // Recording button active state
    assert.match(
        css,
        /#menu #record-toggle-btn\.active[^}]*?var\(--hf-red\)/,
        '#record-toggle-btn active state must use --hf-red'
    )
})

test('public/js/ui/statusRow.js uses Handfish semantic tokens and contains zero raw color literals', () => {
    const statusRowPath = path.resolve(__dirname, '../../public/js/ui/statusRow.js')
    const statusRowCode = fs.readFileSync(statusRowPath, 'utf8')

    const styleMatch = statusRowCode.match(/style\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, 'statusRow.js must define injected style.textContent')
    const css = styleMatch[1]

    assert.doesNotMatch(
        css,
        /!important/,
        'statusRow.js injected CSS must not use !important'
    )
    assert.doesNotMatch(
        css,
        /#[0-9a-fA-F]{3,8}\b/,
        'statusRow.js injected CSS must not contain raw hex color literals'
    )
    assert.doesNotMatch(
        css,
        /\b(?:rgba?|hsla?)\s*\(/i,
        'statusRow.js injected CSS must not contain raw rgb/rgba/hsl/hsla literals'
    )
    assert.match(css, /var\(--hf-text-normal/, 'status row text must use var(--hf-text-normal)')
    assert.match(css, /var\(--hf-text-muted/, 'idle chip dot must use var(--hf-text-muted)')
    assert.match(css, /var\(--hf-text-bright/, 'recording text must mix with var(--hf-text-bright)')
    assert.match(css, /var\(--hf-bg-base/, 'chip background must derive from var(--hf-bg-base)')
    assert.match(css, /var\(--hf-border-subtle/, 'chip borders must use var(--hf-border-subtle)')
    assert.match(css, /var\(--hf-border-hover/, 'chip hover border must use var(--hf-border-hover)')
    assert.match(css, /var\(--hf-accent/, 'chip hover background must use var(--hf-accent)')
    assert.match(css, /var\(--hf-green/, 'active dot must use var(--hf-green)')
    assert.match(css, /var\(--hf-yellow/, 'warn/midi dot must use var(--hf-yellow)')
    assert.match(css, /var\(--hf-red/, 'error/recording dot must use var(--hf-red)')
    assert.match(css, /var\(--hf-font-family-mono/, 'mono text must use var(--hf-font-family-mono)')
    assert.match(css, /var\(--hf-radius-pill/, 'chip radius must use var(--hf-radius-pill)')
    assert.match(css, /var\(--hf-glass-blur-sm/, 'chip backdrop blur must use var(--hf-glass-blur-sm)')
    assert.doesNotMatch(
        statusRowCode,
        /#d9deeb|#4ade80|#facc15|#ff6b6b|#ff4d4d|#ffb4b4|#ffd0a0|#ffb070|#555\b/,
        'statusRow.js must not hardcode legacy hex color literals'
    )
})

test('public/js/ui/liveInputsPanel.js uses Handfish semantic tokens and contains zero raw color literals', () => {
    const panelPath = path.resolve(__dirname, '../../public/js/ui/liveInputsPanel.js')
    const panelCode = fs.readFileSync(panelPath, 'utf8')

    const styleMatch = panelCode.match(/style\.textContent\s*=\s*`([\s\S]*?)`/m)
    assert.ok(styleMatch, 'liveInputsPanel.js must define injected style.textContent')
    const css = styleMatch[1]

    assert.doesNotMatch(
        css,
        /!important/,
        'liveInputsPanel.js injected CSS must not use !important'
    )
    assert.doesNotMatch(
        css,
        /#[0-9a-fA-F]{3,8}\b/,
        'liveInputsPanel.js injected CSS must not contain raw hex color literals'
    )
    assert.doesNotMatch(
        css,
        /\b(?:rgba?|hsla?)\s*\(/i,
        'liveInputsPanel.js injected CSS must not contain raw rgb/rgba/hsl/hsla literals'
    )
    assert.match(css, /var\(--hf-bg-surface/, 'panel surface must use var(--hf-bg-surface)')
    assert.match(css, /var\(--hf-bg-elevated/, 'snippets must use var(--hf-bg-elevated)')
    assert.match(css, /var\(--hf-border-subtle/, 'borders must use var(--hf-border-subtle)')
    assert.match(css, /var\(--hf-shadow-xl/, 'panel shadow must use var(--hf-shadow-xl)')
    assert.match(css, /var\(--hf-accent/, 'spectrum bars must derive from var(--hf-accent)')
    assert.match(css, /var\(--hf-green/, 'level meter gradient must use var(--hf-green)')
    assert.match(css, /var\(--hf-yellow/, 'level meter gradient must use var(--hf-yellow)')
    assert.match(css, /var\(--hf-red/, 'level meter gradient must use var(--hf-red)')
    assert.match(css, /var\(--hf-text-bright/, 'header text must use var(--hf-text-bright)')
    // Snippet flash feedback is applied inline via color-mix with the green token.
    assert.match(
        panelCode,
        /color-mix\(in srgb, var\(--hf-green\) 22%, transparent\)/,
        'snippet flash must derive from var(--hf-green) via color-mix'
    )
})

test('dialog action and close buttons declare focus-visible and active scale', () => {
    const indexHtml = fs.readFileSync(path.resolve(cssDir, '../index.html'), 'utf8')
    assert.match(
        indexHtml,
        /\.doc-reader-close:focus-visible\s*\{[^}]*?var\(--hf-focus-ring-width/,
        '.doc-reader-close must define :focus-visible'
    )
    assert.match(
        indexHtml,
        /\.share-btn-primary:active:not\(:disabled\)\s*\{[^}]*?transform:\s*scale\(/,
        '.share-btn-primary must define active scale'
    )
    assert.match(
        indexHtml,
        /\.program-modal-close:focus-visible\s*\{[^}]*?var\(--hf-focus-ring-width/,
        '.program-modal-close must define :focus-visible'
    )
})



