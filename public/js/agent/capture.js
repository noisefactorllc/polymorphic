/**
 * Canvas capture for the agent API's images.
 *
 * The engine's WebGL2 context keeps its drawing buffer, so the canvas reads
 * back after the frame that drew it. A WebGPU canvas displays correctly but
 * reads back blank through drawImage(); its picture is read from the texture
 * the engine presented instead, and toBlob() is the fallback.
 *
 * @module agent/capture
 */

// A stalled or lost GPU device must not hold the command queue forever.
const FENCE_TIMEOUT_MS = 10000

/**
 * Wait for the next animation frame, or a turn of the task queue where there
 * will not be one: browsers stop animation frames for a hidden page.
 */
function waitForFrame() {
    if (typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden') {
        return new Promise(resolve => {
            const { port1, port2 } = new MessageChannel()
            port1.onmessage = () => { port1.close(); resolve() }
            port2.postMessage(null)
        })
    }
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function pipelineOf(inner) {
    return inner?.pipeline || inner?._pipeline || null
}

/**
 * Wait until the last rendered frame can be read: one animation frame, then,
 * on WebGPU, the GPU queue's submitted work.
 * @param {object} inner - The engine's CanvasRenderer
 */
export async function waitForReadback(inner) {
    await waitForFrame()
    const queue = pipelineOf(inner)?.backend?.device?.queue || pipelineOf(inner)?.backend?.queue
    if (typeof queue?.onSubmittedWorkDone !== 'function') return
    let timer
    try {
        await Promise.race([
            queue.onSubmittedWorkDone(),
            new Promise(resolve => { timer = setTimeout(resolve, FENCE_TIMEOUT_MS) }),
        ])
    } catch {
        // A lost device reads back what the canvas has.
    } finally {
        clearTimeout(timer)
    }
}

function isWebGPUCanvas(canvas) {
    try {
        return typeof GPUCanvasContext !== 'undefined' && Boolean(canvas.getContext('webgpu'))
    } catch {
        return false
    }
}

// The engine's WebGPU surfaces store their bottom row first, and presenting
// them flips them; readPixels() returns the rows as stored.
async function presentedWebGPUTexture(inner) {
    const pipeline = pipelineOf(inner)
    const surface = pipeline?.graph?.renderSurface
    const textureId = pipeline?.frameReadTextures?.get?.(surface) || pipeline?.surfaces?.get?.(surface)?.read
    if (!textureId || typeof pipeline?.backend?.readPixels !== 'function') return null
    const { data, width, height } = await pipeline.backend.readPixels(textureId) || {}
    if (!data || !width || !height) return null
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')
    const image = ctx.createImageData(width, height)
    const rowBytes = width * 4
    for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * rowBytes
        image.data.set(data.subarray(from, from + rowBytes), y * rowBytes)
    }
    ctx.putImageData(image, 0, 0)
    return out
}

/**
 * A canvas that holds the picture on screen and can be read with drawImage().
 * @param {HTMLCanvasElement} canvas - The app canvas
 * @param {object} inner - The engine's CanvasRenderer
 * @returns {Promise<HTMLCanvasElement|ImageBitmap>}
 */
export async function readableCanvas(canvas, inner) {
    await waitForReadback(inner)
    if (!isWebGPUCanvas(canvas)) return canvas
    try {
        const presented = await presentedWebGPUTexture(inner)
        if (presented) return presented
    } catch {
        // Fall back to the canvas's own encoder below.
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    return blob ? createImageBitmap(blob) : canvas
}
