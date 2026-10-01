import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
}

test('performance mode hides the cursor only after idle and restores it on activity', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  await page.keyboard.press('Control+Shift+h')
  await expect(page.locator('body')).toHaveClass(/performance-mode/)

  // Cursor stays visible on entry — no premature hiding while the mouse moves.
  await page.mouse.move(400, 300)
  expect(await page.evaluate(() => document.body.classList.contains('cursor-idle'))).toBe(false)

  // After ~3s of inactivity the cursor hides so the projection stays clean.
  await page.waitForFunction(() => document.body.classList.contains('cursor-idle'), null, { timeout: 10000 })
  const cursor = await page.evaluate(() => getComputedStyle(document.body).cursor)
  expect(cursor).toBe('none')

  // Any motion restores the cursor instantly.
  await page.mouse.move(420, 320)
  await page.waitForFunction(() => !document.body.classList.contains('cursor-idle'), null, { timeout: 5000 })
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toBe('none')

  // Exiting performance mode stops the hider entirely.
  await page.keyboard.press('Escape')
  await expect(page.locator('body')).not.toHaveClass(/performance-mode/)
  expect(await page.evaluate(() => document.body.classList.contains('cursor-idle'))).toBe(false)
})
