import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

const SKETCH = [
  'search synth, filter',
  '',
  'perlin(scale: 75, octaves: 2)',
  '  .adjust(',
  '    mode: hsv,',
  '    rotation: 120,',
  '    hueRange: 40',
  '  )',
  '  .write(o0)',
  '',
  'render(o0)',
].join('\n')
const PAGE_URL = `/?dsl=${encodeURIComponent(SKETCH)}`

async function waitForApp(page) {
    await page.waitForFunction(() => !!(window.__poly && window.__poly.commandPalette), null, { timeout: 30000 })
    await page.waitForTimeout(300)
}

test.describe('Command Palette Keyboard Navigation', () => {
    test('Cmd+K opens palette, arrow keys wrap predictably and maintain active item in view', async ({ page }) => {
        await page.goto(PAGE_URL)
        await waitForApp(page)

        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'

        // 1. Open command palette
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)
        const input = page.locator('.cmd-palette-input')
        await expect(input).toBeFocused()
        await expect(input).toHaveAttribute('aria-expanded', 'true')
        await expect(input).toHaveAttribute('aria-haspopup', 'listbox')

        // Wait for items to populate
        const items = page.locator('.cmd-palette-item')
        await expect(items.first()).toBeVisible()
        const count = await items.count()
        expect(count).toBeGreaterThan(5)

        // First item is active initially
        await expect(items.first()).toHaveClass(/active/)
        await expect(items.first()).toHaveAttribute('aria-selected', 'true')
        await expect(input).toHaveAttribute('aria-activedescendant', 'cmd-palette-item-0')

        // 2. Press ArrowUp: wraps from first item to last item
        await page.keyboard.press('ArrowUp')
        const lastIndex = count - 1
        await expect(items.last()).toHaveClass(/active/)
        await expect(items.last()).toHaveAttribute('aria-selected', 'true')
        await expect(input).toHaveAttribute('aria-activedescendant', `cmd-palette-item-${lastIndex}`)

        // Verify last item is scrolled into view (container scrolled down)
        const listEl = page.locator('.cmd-palette-list')
        const scrollTopAfterUp = await listEl.evaluate(el => el.scrollTop)
        expect(scrollTopAfterUp).toBeGreaterThan(0)

        // 3. Press ArrowDown: wraps from last item back to first item
        await page.keyboard.press('ArrowDown')
        await expect(items.first()).toHaveClass(/active/)
        await expect(items.first()).toHaveAttribute('aria-selected', 'true')
        await expect(input).toHaveAttribute('aria-activedescendant', 'cmd-palette-item-0')

        // Verify container reset scroll to top
        const scrollTopAfterDown = await listEl.evaluate(el => el.scrollTop)
        expect(scrollTopAfterDown).toBe(0)

        // 4. Sequential ArrowDown moves down item by item
        await page.keyboard.press('ArrowDown')
        await expect(items.nth(1)).toHaveClass(/active/)
        await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true')
        await expect(input).toHaveAttribute('aria-activedescendant', 'cmd-palette-item-1')

        // 5. PageDown advances several items down
        await page.keyboard.press('PageDown')
        const activeIdxAfterPageDown = await page.evaluate(() => window.__poly.commandPalette._activeIdx)
        expect(activeIdxAfterPageDown).toBeGreaterThan(1)

        // 6. PageUp returns toward top
        await page.keyboard.press('PageUp')
        const activeIdxAfterPageUp = await page.evaluate(() => window.__poly.commandPalette._activeIdx)
        expect(activeIdxAfterPageUp).toBeLessThan(activeIdxAfterPageDown)

        // 7. Tab key is trapped
        await page.keyboard.press('Tab')
        await expect(input).toBeFocused()

        // 8. Escape closes palette and sets aria-expanded to false
        await page.keyboard.press('Escape')
        await expect(overlay).not.toHaveClass(/visible/)
        await expect(input).toHaveAttribute('aria-expanded', 'false')
    })

    test('Filtering, arrow navigation, and Enter invokes selected command', async ({ page }) => {
        await page.goto(PAGE_URL)
        await waitForApp(page)

        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'

        // Open palette and search for PNG export
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        await page.keyboard.type('Save canvas as PNG')
        await page.waitForTimeout(200)

        const items = page.locator('.cmd-palette-item')
        await expect(items.first()).toBeVisible()
        await expect(items.first()).toContainText('Save canvas as PNG')
        await expect(items.first()).toHaveClass(/active/)

        // Prepare download listener and press Enter
        const dlPromise = page.waitForEvent('download', { timeout: 10000 })
        await page.keyboard.press('Enter')

        // Palette must be closed
        await expect(overlay).not.toHaveClass(/visible/)

        const download = await dlPromise
        expect(download.suggestedFilename()).toBe('polymorphic.png')
        await download.cancel()
    })

    test('Empty match query does not crash on Arrow keys or Enter', async ({ page }) => {
        await page.goto(PAGE_URL)
        await waitForApp(page)

        const shortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
        await page.keyboard.press(shortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        await page.keyboard.type('__non_matching_search_token_xyz__')
        await page.waitForTimeout(200)

        const empty = page.locator('.cmd-palette-empty')
        await expect(empty).toBeVisible()

        // Press navigation keys and Enter
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('PageDown')
        await page.keyboard.press('PageUp')
        await page.keyboard.press('Enter')

        // Palette should remain open and intact
        await expect(overlay).toHaveClass(/visible/)

        // Escape closes
        await page.keyboard.press('Escape')
        await expect(overlay).not.toHaveClass(/visible/)
    })

    test('Cmd+Shift+F and command palette format DSL while preserving comments and multi-line strings', async ({ page }) => {
        await page.goto(PAGE_URL)
        await waitForApp(page)

        const formatShortcut = process.platform === 'darwin' ? 'Meta+Shift+f' : 'Control+Shift+f'
        const cmdShortcut = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'

        // 1. Set unformatted code with comments
        await page.evaluate(() => {
            const ed = document.getElementById('dsl-editor')
            ed.value = 'noise(scaleX:80) // base generator\n.palette(index:vaporwave)\n.write(o0)'
            ed.getTextarea().focus()
        })

        // Press Cmd/Ctrl+Shift+F
        await page.keyboard.press(formatShortcut)
        await page.waitForTimeout(200)

        const result1 = await page.evaluate(() => document.getElementById('dsl-editor').value)
        expect(result1).toBe('noise(scaleX: 80) // base generator\n  .palette(index: vaporwave)\n  .write(o0)')

        // 2. Multi-line triple quoted string preserved verbatim
        await page.evaluate(() => {
            const ed = document.getElementById('dsl-editor')
            ed.value = 'solid(alpha:0)\n.text(text:"""multi\nline""",size:0.2)\n.write(o0)'
            ed.getTextarea().focus()
        })

        await page.keyboard.press(formatShortcut)
        await page.waitForTimeout(200)

        const result2 = await page.evaluate(() => document.getElementById('dsl-editor').value)
        expect(result2).toBe('solid(alpha: 0)\n  .text(text: """multi\nline""", size: 0.2)\n  .write(o0)')

        // 3. Format via Command Palette
        await page.evaluate(() => {
            const ed = document.getElementById('dsl-editor')
            ed.value = 'perlin(scale:50)\n.adjust(mode:hsv,hueRange:30)\n.write(o0)'
        })

        await page.keyboard.press(cmdShortcut)
        const overlay = page.locator('.cmd-palette-overlay')
        await expect(overlay).toHaveClass(/visible/)

        await page.keyboard.type('Format DSL')
        await page.waitForTimeout(200)

        const items = page.locator('.cmd-palette-item')
        await expect(items.first()).toContainText('Format DSL')
        await page.keyboard.press('Enter')
        await expect(overlay).not.toHaveClass(/visible/)

        const result3 = await page.evaluate(() => document.getElementById('dsl-editor').value)
        expect(result3).toBe('perlin(scale: 50)\n  .adjust(mode: hsv, hueRange: 30)\n  .write(o0)')
    })
})

