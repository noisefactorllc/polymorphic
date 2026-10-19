// Thumbnails of a program with four different corners, for the agent specs.
// A flipped, blank or stale image does not match the corner colours.
import { expect } from '@playwright/test'

export const CORNERS = 'search synth\ngradient(type: 2).write(o0)\nrender(o0)'

// gradient(type: 2) puts its four default colours in the corners: red top
// left, yellow top right, green bottom left and blue bottom right.
const EXPECTED = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 0, 255]]

/** The corner pixels of a paused thumbnail of CORNERS, and the backend that drew it. */
export async function cornerPixels(page) {
  return page.evaluate(async (dsl) => {
    const A = window.PolymorphicAgent
    await A.setProgram({ dsl })
    await A.pause()
    const env = await A.getThumbnail({ maxDimension: 64, format: 'png' })
    const bytes = Uint8Array.from(atob(env.result.bytes), char => char.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0)
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
    const { width, height } = image
    return { backend: env.state.backend, corners: [at(1, 1), at(width - 2, 1), at(1, height - 2), at(width - 2, height - 2)] }
  }, CORNERS)
}

export function expectCorners(corners) {
  corners.forEach((pixel, corner) => {
    expect(pixel[3], `corner ${corner} is opaque`).toBe(255)
    EXPECTED[corner].forEach((value, channel) => {
      expect(Math.abs(pixel[channel] - value), `corner ${corner} channel ${channel}: ${pixel}`).toBeLessThan(24)
    })
  })
}
