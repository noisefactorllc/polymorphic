import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EMBED_JS_PATH = path.join(REPO_ROOT, 'public', 'js', 'embed.js')
const SHORTCUTS_DIALOG_PATH = path.join(REPO_ROOT, 'public', 'js', 'ui', 'shortcutsDialog.js')

test('embed.js imports formatShortcut from handfish', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*formatShortcut[^}]*\}\s*from\s*['"]handfish['"]/,
        'embed.js must import formatShortcut from handfish'
    )
})

test('viewMenu items declare platform-correct shortcut accelerators', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')

    // Live inputs item carries shortcut: formatShortcut('Mod+I')
    assert.match(
        src,
        /id:\s*'viewMenuItem-live-inputs'[\s\S]*?shortcut:\s*formatShortcut\(['"]Mod\+I['"]\)/,
        'viewMenuItem-live-inputs must define shortcut: formatShortcut("Mod+I")'
    )

    // Status row item carries shortcut: formatShortcut('Mod+;')
    assert.match(
        src,
        /id:\s*'viewMenuItem-status'[\s\S]*?shortcut:\s*formatShortcut\(['"]Mod\+;['"]\)/,
        'viewMenuItem-status must define shortcut: formatShortcut("Mod+;")'
    )

    // Keyboard shortcuts item carries shortcut: '?'
    assert.match(
        src,
        /id:\s*'viewMenuItem-shortcuts'[\s\S]*?shortcut:\s*['"]\?['"]/,
        'viewMenuItem-shortcuts must define shortcut: "?"'
    )

    // Performance mode item carries shortcut: formatShortcut('Mod+Shift+H')
    assert.match(
        src,
        /id:\s*'viewMenuItem-performance-mode'[\s\S]*?shortcut:\s*formatShortcut\(['"]Mod\+Shift\+H['"]\)/,
        'viewMenuItem-performance-mode must define shortcut: formatShortcut("Mod+Shift+H")'
    )
})

test('icon toolbar buttons declare accurate tooltips and accelerators', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')

    // inputs-toggle-btn includes formatShortcut('Mod+I') in its tooltip
    assert.match(
        src,
        /id:\s*'inputs-toggle-btn'[\s\S]*?tooltip:\s*\(\)\s*=>[\s\S]*?formatShortcut\(['"]Mod\+I['"]\)/,
        'inputs-toggle-btn must format its Mod+I accelerator into its tooltip'
    )

    // perf-toggle-btn tooltip clarifies performance overlay to prevent confusion with performance mode
    assert.match(
        src,
        /id:\s*'perf-toggle-btn'[\s\S]*?tooltip:\s*'performance overlay'/,
        'perf-toggle-btn tooltip must say "performance overlay"'
    )
})

test('embed.js registers Mod+I shortcut listener to toggle liveInputsPanel', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')
    assert.match(
        src,
        /mod\s*&&[\s\S]*?\(e\.key\s*===\s*'i'\s*\|\|\s*e\.key\s*===\s*'I'\)[\s\S]*?liveInputsPanel\.toggle\(\)/,
        'embed.js keydown listener must toggle liveInputsPanel on Mod+I'
    )
})

test('shortcutsDialog registers Mod+I for Live inputs panel', async () => {
    const src = await fs.readFile(SHORTCUTS_DIALOG_PATH, 'utf8')
    assert.match(
        src,
        /\['Live inputs panel',\s*\[['"]⌘\/Ctrl['"],\s*['"]I['"]\]\]/,
        'shortcutsDialog must document ["Live inputs panel", ["⌘/Ctrl", "I"]]'
    )
})

test('scene recall reports empty slot feedback', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')
    assert.match(
        src,
        /showToast\(`Scene \$\{slot\} is empty`,\s*'info'\)/,
        'embed.js must provide subtle toast feedback when recalling an empty scene slot'
    )
})

test('scene save reports empty editor feedback', async () => {
    const src = await fs.readFile(EMBED_JS_PATH, 'utf8')
    assert.match(
        src,
        /showToast\(`Cannot save empty scene \$\{slot\}`,\s*'warning'\)/,
        'embed.js must provide warning toast feedback when saving an empty scene slot'
    )
})

