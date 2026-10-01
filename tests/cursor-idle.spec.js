import { test, expect } from '@playwright/test'
import { installHandfishLocal } from './handfishLocal.js'

installHandfishLocal(test)

async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
}

// Poke and read in ONE evaluate so a restore is observable even when slow
// CDP roundtrips let the 3s idle timer re-arm between separate roundtrips.
function idleAfterPoke(page) {
  return page.evaluate(() => {
    window.dispatchEvent(new Event('pointermove'))
    return document.querySelector('.cursor-fade-dot').classList.contains('cursor-idle')
  })
}

// The rendered cursor dot stands in for the OS cursor in performance mode
// (the `cursor` property itself is not animatable). It fades out over 500ms
// after idle and is restored instantly on motion.

// The dot must actually render: opacity alone resolves trivially on a
// display:none element, so check layout visibility too.
function dotVisibility(page) {
  return page.evaluate(() => {
    const dot = document.querySelector('.cursor-fade-dot')
    const cs = getComputedStyle(dot)
    return {
      display: cs.display,
      offsetWidth: dot.offsetWidth,
      opacity: cs.opacity,
    }
  })
}
test('performance mode fades the cursor dot after idle and restores it on activity', async ({ page }) => {
  test.slow() // software-GL render loop can starve CDP roundtrips on this host
  await page.goto('/')
  await waitForApp(page)

  await page.keyboard.press('Control+Shift+h')
  await expect(page.locator('body')).toHaveClass(/performance-mode/)

  // No dot before the pointer has moved over the page.
  expect(await page.locator('body > .cursor-fade-dot').count()).toBe(0)

  // Moving the pointer renders the fading dot at the pointer position.
  await page.mouse.move(400, 300)
  const dot = page.locator('body > .cursor-fade-dot')
  await expect(dot).toHaveCount(1)
  const visible = await dotVisibility(page)
  expect(visible.display).not.toBe('none')
  expect(visible.offsetWidth).toBeGreaterThan(0)
  expect(visible.opacity).toBe('1')
  await expect.poll(() => idleAfterPoke(page), { timeout: 15000 }).toBe(false)

  // After ~3s of inactivity the dot fades out (opacity 0 via its idle class).
  await page.waitForFunction(() => document.body.classList.contains('cursor-idle'), null, { timeout: 30000 })
  await expect(dot).toHaveClass(/cursor-idle/)
  // Wait for the real-time opacity transition to land on 0.
  await expect.poll(async () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.cursor-fade-dot')).opacity),
    { timeout: 10000 },
  ).toBe('0')
  // The dot stays in the layout while faded (it is hidden by opacity, not
  // display:none, so the transition is real).
  const faded = await dotVisibility(page)
  expect(faded.display).not.toBe('none')
  expect(faded.offsetWidth).toBeGreaterThan(0)
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).toBe('none')

  // Any motion restores the dot instantly (no fade on the way back) at the
  // new pointer position.
  await page.mouse.move(420, 320)
  await expect.poll(() => idleAfterPoke(page), { timeout: 15000 }).toBe(false)
  expect(await page.evaluate(() => {
    window.dispatchEvent(new Event('pointermove'))
    return {
      left: document.querySelector('.cursor-fade-dot').style.left,
      top: document.querySelector('.cursor-fade-dot').style.top,
      opacity: getComputedStyle(document.querySelector('.cursor-fade-dot')).opacity,
    }
  })).toEqual({ left: '420px', top: '320px', opacity: '1' })

  // Keyboard activity also restores the cursor without moving it.
  await page.keyboard.press('x')
  await expect.poll(() => idleAfterPoke(page), { timeout: 15000 }).toBe(false)

  // Exiting performance mode removes the dot entirely.
  await page.keyboard.press('Escape')
  await expect(page.locator('body')).not.toHaveClass(/performance-mode/)
  await expect(dot).toHaveCount(0)
  expect(await page.evaluate(() => document.body.classList.contains('cursor-idle'))).toBe(false)
})
