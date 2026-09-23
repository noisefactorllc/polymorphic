import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const JS_DIR = path.join(REPO_ROOT, 'public', 'js')

test('gallery.js participates in Handfish escape stack without ad-hoc document listeners', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'gallery.js'), 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*registerEscapeable[^}]*unregisterEscapeable[^}]*\}\s*from\s*['"]handfish['"]/,
        'gallery.js must import registerEscapeable and unregisterEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\._overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'gallery.js must register this._overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\._overlay\s*\)/,
        'gallery.js must unregister this._overlay from the Handfish escape stack on close'
    )
    assert.doesNotMatch(
        src,
        /_escHandler/,
        'gallery.js must not retain ad-hoc _escHandler document listener'
    )
})

test('shortcutsDialog.js participates in Handfish escape stack without ad-hoc document listeners', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'shortcutsDialog.js'), 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*registerEscapeable[^}]*unregisterEscapeable[^}]*\}\s*from\s*['"]handfish['"]/,
        'shortcutsDialog.js must import registerEscapeable and unregisterEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\._overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'shortcutsDialog.js must register this._overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\._overlay\s*\)/,
        'shortcutsDialog.js must unregister this._overlay from the Handfish escape stack on close'
    )
    assert.doesNotMatch(
        src,
        /_escHandler/,
        'shortcutsDialog.js must not retain ad-hoc _escHandler document listener'
    )
})

test('shareModal.js participates in Handfish escape stack without ad-hoc document listeners', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'shareModal.js'), 'utf8')
    assert.match(
        src,
        /(?:import\s*\{[^}]*registerEscapeable|await\s+import\s*\(\s*['"]handfish['"]\s*\))/,
        'shareModal.js must import registerEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\.overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'shareModal.js must register this.overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\.overlay\s*\)/,
        'shareModal.js must unregister this.overlay from the Handfish escape stack on close'
    )
    assert.doesNotMatch(
        src,
        /escapeHandler/,
        'shareModal.js must not retain ad-hoc escapeHandler document listener'
    )
})

test('import-from-url-dialog.js participates in Handfish escape stack without ad-hoc listeners', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'import-from-url-dialog.js'), 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*registerEscapeable[^}]*unregisterEscapeable[^}]*\}\s*from\s*['"]handfish['"]/,
        'import-from-url-dialog.js must import registerEscapeable and unregisterEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\._overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'import-from-url-dialog.js must register this._overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\._overlay\s*\)/,
        'import-from-url-dialog.js must unregister this._overlay from the Handfish escape stack on close'
    )
    assert.doesNotMatch(
        src,
        /_escHandler/,
        'import-from-url-dialog.js must not retain ad-hoc _escHandler document listener'
    )
})

test('import-effect-dialog.js participates in Handfish escape stack without ad-hoc listeners', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'import-effect-dialog.js'), 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*registerEscapeable[^}]*unregisterEscapeable[^}]*\}\s*from\s*['"]handfish['"]/,
        'import-effect-dialog.js must import registerEscapeable and unregisterEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\.overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'import-effect-dialog.js must register this.overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\.overlay\s*\)/,
        'import-effect-dialog.js must unregister this.overlay from the Handfish escape stack on close'
    )
    assert.doesNotMatch(
        src,
        /escHandler/,
        'import-effect-dialog.js must not retain ad-hoc escHandler document listener'
    )
})

test('commandPalette.js participates in Handfish escape stack and stops Escape propagation', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'commandPalette.js'), 'utf8')
    assert.match(
        src,
        /(?:import\s*\{[^}]*registerEscapeable|await\s+import\s*\(\s*['"]handfish['"]\s*\))/,
        'commandPalette.js must import registerEscapeable from handfish'
    )
    assert.match(
        src,
        /registerEscapeable\s*\(\s*this\._overlay\s*,\s*\(\)\s*=>\s*this\.close\(\)\s*\)/,
        'commandPalette.js must register this._overlay on the Handfish escape stack when opened'
    )
    assert.match(
        src,
        /unregisterEscapeable\s*\(\s*this\._overlay\s*\)/,
        'commandPalette.js must unregister this._overlay from the Handfish escape stack on close'
    )
    assert.match(
        src,
        /if\s*\(\s*e\.key\s*===\s*'Escape'\s*\)\s*\{[\s\S]*?e\.stopPropagation(?:\?\.)?\(\)/,
        'commandPalette.js must stop Escape propagation to prevent bubbling side effects'
    )
})

test('scrubber.js aborting scrub stops Escape propagation', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'ui', 'scrubber.js'), 'utf8')
    assert.match(
        src,
        /if\s*\(\s*scrubbing\s*&&\s*e\.key\s*===\s*'Escape'\s*\)\s*\{[\s\S]*?e\.stopPropagation(?:\?\.)?\(\)/,
        'scrubber.js must stop Escape propagation when aborting a scrub'
    )
})

test('embed.js guards performance mode Escape exit against open escapeables and dialogs', async () => {
    const src = await fs.readFile(path.join(JS_DIR, 'embed.js'), 'utf8')
    assert.match(
        src,
        /import\s*\{[^}]*hasOpenEscapeables[^}]*\}\s*from\s*['"]handfish['"]/,
        'embed.js must import hasOpenEscapeables from handfish'
    )
    assert.match(
        src,
        /e\.key\s*===\s*'Escape'[\s\S]*?hasOpenEscapeables\(\)/,
        'embed.js must check hasOpenEscapeables() before exiting performance mode on Escape'
    )
    assert.match(
        src,
        /e\.key\s*===\s*'Escape'[\s\S]*?dialog\[open\]/,
        'embed.js must check for open native dialogs before exiting performance mode on Escape'
    )
})
