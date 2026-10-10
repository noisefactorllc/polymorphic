import { test, expect } from '@playwright/test'

// Page setup shared by the Sync camera lifecycle specs: a fake native shared
// session, a fake enumerated device list, and a canvas captureStream standing
// in for the virtual camera's getUserMedia track.
async function prepareCameraPage(page, dsl) {
    await page.goto('/?dsl=' + encodeURIComponent(dsl))
    await page.waitForFunction(() => window.__poly?.renderer && window.__poly?.liveInputsPanel?._panel)
    await page.evaluate(async () => {
        const state = window.cameraTest = { starts: 0, stops: 0, tracks: [], devices: [], sequence: 0, uploads: [], buffer: new Uint8Array(16) }
        window.electronAPI = { syncCamera: {
            isAvailable: async () => true,
            subscribe(callback) { state.starts++; state.deliver = callback; return () => { state.stops++ } }
        } }
        navigator.mediaDevices.enumerateDevices = async () => state.devices
        navigator.mediaDevices.getUserMedia = async constraints => {
            if (constraints.video?.deviceId?.exact !== 'sync-camera') throw new Error('Selected camera was not requested')
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 2
            const stream = canvas.captureStream(30)
            const track = stream.getVideoTracks()[0]
            state.tracks.push(track)
            Object.defineProperty(track, 'label', { value: 'Sync Camera' })
            const paint = setInterval(() => canvas.getContext('2d').fillRect(0, 0, 2, 2), 16)
            const stop = track.stop.bind(track)
            track.stop = () => { clearInterval(paint); stop() }
            return stream
        }
        const panel = window.__poly.liveInputsPanel
        panel.open()
        await panel._refreshCameras()
        const upload = panel._uploadMediaFrame.bind(panel)
        panel._uploadMediaFrame = async frame => {
            const bytes = new Uint8Array(16)
            await frame.copyTo(bytes)
            state.uploads.push([...bytes.slice(0, 4)])
            return upload(frame)
        }
        state.frame = (timestamp, color = 'red') => {
            const pixel = color === 'red' ? [0, 0, 255, 255] : [0, 255, 0, 255]
            for (let offset = 0; offset < state.buffer.length; offset += 4) state.buffer.set(pixel, offset)
            state.deliver({ sequence: ++state.sequence, presentationTimeUs: timestamp,
                width: 2, height: 2, buffer: state.buffer })
        }
        state.sample = () => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const context = canvas.getContext('2d')
            context.drawImage(window.__poly.renderer.canvas, 0, 0, 1, 1)
            return [...context.getImageData(0, 0, 1, 1).data]
        }
        state.listDevice = () => { state.devices = [{ kind: 'videoinput', label: 'Sync Camera', deviceId: 'sync-camera' }] }
        state.unlistDevice = () => { state.devices = [] }
    })
}

test('selected Sync camera reaches a nonzero media step, auto-reopens after a failure, and releases capture', async ({ page }) => {
    const dsl = 'search synth\nperlin().write(o1)\nmedia().write(o0)\nrender(o0)'
    await prepareCameraPage(page, dsl)
    await expect(page.locator('[data-id=camera-device] option[value=sync-camera]')).toHaveCount(0)
    await page.evaluate(() => {
        window.cameraTest.listDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await expect(page.locator('[data-id=camera-device] option[value=sync-camera]')).toHaveText('Sync Camera')
    await page.selectOption('[data-id=camera-device]', 'sync-camera')
    await page.evaluate(() => {
        window.cameraTest.unlistDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await expect(page.locator('[data-id=camera-device]')).toHaveValue('sync-camera')
    await expect(page.locator('[data-id=camera-device] option[value=sync-camera]')).toHaveText('Sync Camera (unavailable)')
    await page.evaluate(() => {
        window.cameraTest.listDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await expect(page.locator('[data-id=camera-device] option[value=sync-camera]')).toHaveText('Sync Camera')
    await page.click('[data-source=webcam]')
    await expect.poll(() => page.evaluate(() => window.cameraTest.starts)).toBe(1)
    await expect.poll(() => page.evaluate(() => window.__poly.renderer.mediaStepIndex), { timeout: 15000 }).toBeGreaterThan(0)
    await page.evaluate(() => { window.cameraTest.frame(1000, 'red'); window.cameraTest.frame(1000, 'green') })
    await expect.poll(() => page.evaluate(() => window.cameraTest.uploads)).toEqual([[0, 0, 255, 255], [0, 255, 0, 255]])
    await expect.poll(() => page.evaluate(() => window.cameraTest.sample())).toEqual([0, 255, 0, 255])
    // A stale frame fails the session; its device is still enumerated, so the
    // source retires and reopens on its own — no manual reselect.
    await page.evaluate(() => window.cameraTest.frame(100))
    await expect(page.locator('[data-id=source-status]')).toContainText('Reconnecting when the camera returns')
    expect(await page.evaluate(() => window.cameraTest.tracks[0].readyState)).toBe('ended')
    await expect.poll(() => page.evaluate(() => window.cameraTest.starts), { timeout: 15000 }).toBe(2)
    await expect(page.locator('[data-id=source-status]')).toContainText('Sync Camera streaming')
    await page.evaluate(() => { window.cameraTest.frame(3000); window.cameraTest.frame(4000) })
    await expect.poll(() => page.evaluate(() => window.cameraTest.sample())).toEqual([255, 0, 0, 255])
    await page.click('[data-source=stop]')
    expect(await page.evaluate(() => window.cameraTest.stops)).toBe(2)
    expect(await page.evaluate(() => window.cameraTest.tracks.every(track => track.readyState === 'ended'))).toBe(true)
})

test('an unplugged Sync camera waits while its device is gone and reopens when it returns', async ({ page }) => {
    const dsl = 'search synth\nperlin().write(o1)\nmedia().write(o0)\nrender(o0)'
    await prepareCameraPage(page, dsl)
    await page.evaluate(() => {
        window.cameraTest.listDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await page.selectOption('[data-id=camera-device]', 'sync-camera')
    await page.click('[data-source=webcam]')
    await expect.poll(() => page.evaluate(() => window.cameraTest.starts)).toBe(1)
    await expect.poll(() => page.evaluate(() => window.__poly.renderer.mediaStepIndex), { timeout: 15000 }).toBeGreaterThan(0)
    await page.evaluate(() => { window.cameraTest.frame(1000); window.cameraTest.frame(2000, 'green') })
    await expect.poll(() => page.evaluate(() => window.cameraTest.sample())).toEqual([0, 255, 0, 255])
    // Unplug: the device leaves the list and the track ends (a device
    // removal ends its live tracks). The source retires, no reopen fires
    // while the camera is missing.
    await page.evaluate(() => {
        window.cameraTest.unlistDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
        const track = window.cameraTest.tracks[0]
        track.stop()
        track.dispatchEvent(new Event('ended'))
    })
    await expect(page.locator('[data-id=source-status]')).toContainText('Reconnecting when the camera returns')
    await page.waitForTimeout(900)
    expect(await page.evaluate(() => window.cameraTest.starts)).toBe(1)
    expect(await page.evaluate(() => window.cameraTest.stops)).toBe(1)
    // The camera is enumerated again: the source reopens through the same
    // path and delivers fresh frames without a manual reselect.
    await page.evaluate(() => {
        window.cameraTest.listDevice()
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    })
    await expect.poll(() => page.evaluate(() => window.cameraTest.starts), { timeout: 15000 }).toBe(2)
    await expect.poll(() => page.evaluate(() => window.__poly.renderer.mediaStepIndex), { timeout: 15000 }).toBeGreaterThan(0)
    await page.evaluate(() => { window.cameraTest.frame(5000); window.cameraTest.frame(6000, 'green') })
    await expect.poll(() => page.evaluate(() => window.cameraTest.sample())).toEqual([0, 255, 0, 255])
    await page.click('[data-source=stop]')
    expect(await page.evaluate(() => window.cameraTest.stops)).toBe(2)
    expect(await page.evaluate(() => window.cameraTest.tracks.every(track => track.readyState === 'ended'))).toBe(true)
})
