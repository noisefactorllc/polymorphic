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

const FALLBACK_TOAST = {
  text: 'WebGPU is not supported by this browser; falling back to WebGL2',
  role: 'status',
  visible: true,
}

async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.__poly && window.__poly.backend), null, { timeout: 30000 })
}

// Deterministically make WebGPU unavailable to trigger the fallback.
async function hideWebGPU(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        get: () => undefined,
        configurable: true
      })
    } catch {
      try {
        Object.defineProperty(navigator, 'gpu', {
          get: () => undefined,
          configurable: true
        })
      } catch {}
    }
  })
}

// Record every toast at the moment it enters the page: its text, its role and
// whether it is visible. The fallback toast can appear before the page's load
// event and removes itself about four seconds later, so on a slow host it can
// come and go before `goto` returns. The record does not depend on when the
// test looks. Visibility follows Playwright's toBeVisible(): a non-empty box,
// `visibility: visible`, and checkVisibility().
async function recordToasts(page) {
  await page.addInitScript(() => {
    const records = []
    Object.defineProperty(window, '__toastRecords', { value: records })
    const describe = (toast) => {
      const box = toast.getBoundingClientRect()
      return {
        text: toast.textContent,
        role: toast.getAttribute('role'),
        visible: toast.isConnected && box.width > 0 && box.height > 0 &&
          getComputedStyle(toast).visibility === 'visible' && toast.checkVisibility(),
      }
    }
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const toasts = node.matches('.polymorphic-toast') ? [node] : [...node.querySelectorAll('.polymorphic-toast')]
          for (const toast of toasts) records.push(describe(toast))
        }
      }
    }).observe(document, { childList: true, subtree: true })
  })
}

// The toasts recorded so far, once at least `count` have appeared.
async function recordedToasts(page, count = 1) {
  await page.waitForFunction((count) => window.__toastRecords.length >= count, count, { timeout: 30000 })
  return page.evaluate(() => window.__toastRecords)
}

test('shows informative toast when WebGPU is requested via URL but browser falls back to WebGL2', async ({ page }) => {
  await hideWebGPU(page)
  await recordToasts(page)

  await page.goto(`/?backend=webgpu&dsl=${encodeURIComponent(SKETCH)}`)
  await waitForApp(page)

  expect(await page.evaluate(() => window.__poly.backend)).toBe('webgl2')
  expect(await recordedToasts(page)).toEqual([FALLBACK_TOAST])
})

test('verifies the fallback toast when the page finishes loading after the toast is gone', async ({ page }) => {
  await hideWebGPU(page)
  await recordToasts(page)

  // A slow host can finish loading the page after the toast has already
  // dismissed itself. Make that happen every time: an image the page loads
  // holds its load event, and so `goto`, until the toast has left the page.
  let toastGone
  let goneBeforeLoad = false
  const gone = new Promise(resolve => { toastGone = resolve })
  await page.exposeBinding('__toastGone', () => toastGone())
  await page.addInitScript(() => {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && node.matches('.polymorphic-toast')) window.__toastGone()
        }
      }
    }).observe(document, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', () => {
      const hold = document.createElement('img')
      hold.alt = ''
      hold.src = '/__hold-load-until-toast-gone'
      document.body.appendChild(hold)
    })
  })
  await page.route('**/__hold-load-until-toast-gone', async (route) => {
    goneBeforeLoad = await Promise.race([gone.then(() => true), new Promise(resolve => setTimeout(resolve, 30000, false))])
    await route.fulfill({ status: 204 })
  })

  await page.goto(`/?backend=webgpu&dsl=${encodeURIComponent(SKETCH)}`)

  // `goto` returned only after the toast was gone, and the toast was still
  // checked.
  expect(goneBeforeLoad).toBe(true)
  expect(await page.locator('.polymorphic-toast').count()).toBe(0)
  await waitForApp(page)
  expect(await page.evaluate(() => window.__poly.backend)).toBe('webgl2')
  expect(await recordedToasts(page)).toEqual([FALLBACK_TOAST])
})

test('does not show fallback toast when default WebGL2 backend is loaded', async ({ page }) => {
  await recordToasts(page)
  const url = `/?dsl=${encodeURIComponent(SKETCH)}`
  await page.goto(url)
  await waitForApp(page)
  // The fallback decision is made right after the renderer starts; any
  // toast it showed is in the record even if it has since gone.
  await page.waitForFunction(() => window.__poly.renderer?.isRunning === true, null, { timeout: 30000 })

  const toasts = await page.evaluate(() => window.__toastRecords)
  expect(toasts.filter(toast => toast.text === FALLBACK_TOAST.text)).toEqual([])
  await expect(page.locator('.polymorphic-toast')).toHaveCount(0)
})

test('reports the active hardware WebGPU pipeline in the performance overlay', async ({ page }) => {
  await recordToasts(page)
  await page.goto(`/?backend=webgpu&dsl=${encodeURIComponent(SKETCH)}`)
  const hardware = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter()
    return Boolean(adapter && !adapter.info?.isFallbackAdapter)
  })
  test.skip(!hardware, 'A physical WebGPU adapter is required')
  await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
  const backends = await page.evaluate(() => {
    const renderer = window.__poly.renderer
    window.__poly.perfOverlay.open()
    return { wrapper: renderer.backend, actual: renderer.inner.pipeline.backend.getName().toLowerCase() }
  })
  expect(backends).toEqual({ wrapper: 'webgpu', actual: 'webgpu' })
  await expect(page.locator('.perf-overlay [data-id="backend"]')).toHaveText('webgpu')
  const toasts = await page.evaluate(() => window.__toastRecords)
  expect(toasts.filter(toast => toast.text === FALLBACK_TOAST.text)).toEqual([])
})

test('cleans up stored backend preference and notifies user when stored WebGPU falls back', async ({ page }) => {
  await hideWebGPU(page)
  await recordToasts(page)

  const url = `/?dsl=${encodeURIComponent(SKETCH)}`
  await page.goto(url)
  await waitForApp(page)

  await page.evaluate(() => {
    try { localStorage.setItem('polymorphic-backend', 'webgpu') } catch {}
  })

  // The init scripts run again for the reloaded page, with a fresh record.
  await page.reload()
  await waitForApp(page)

  expect(await page.evaluate(() => window.__poly.backend)).toBe('webgl2')
  expect(await recordedToasts(page)).toEqual([FALLBACK_TOAST])
  const stored = await page.evaluate(() => localStorage.getItem('polymorphic-backend'))
  expect(stored).toBeNull()
})
