import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'vm'

// The text-texture upload must hand the engine the 2D context the wrapper
// already holds for its text canvas. The served engine never asks an uploaded
// canvas for a rendering context: asking a canvas that has none yet would pin
// it to 2D for good, and a caller holding the context passes it so a
// willReadFrequently canvas uploads the same bytes on WebGPU as WebGL2
// uploads. The renderer module imports the browser-only noisemaker bundle, so
// this test runs the sliced PolymorphicRenderer class body in a vm sandbox
// with a stub engine — the same strategy as contextLoss.test.mjs.
const source = readFileSync(new URL('../../public/js/noisemaker/renderer.js', import.meta.url), 'utf8')
const classSource = source
    .slice(source.indexOf('export class PolymorphicRenderer'))
    .replace('export class PolymorphicRenderer', 'class PolymorphicRenderer')

function makeCanvasFactory() {
    const contexts = new Map()
    const created = []
    function makeCanvas() {
        const canvas = {
            width: 0,
            height: 0,
            style: {},
            getContext(type) {
                if (!contexts.has(canvas)) {
                    contexts.set(canvas, {
                        canvas,
                        clearRect() {},
                        fillRect() {},
                        fillText() {},
                        save() {},
                        restore() {},
                        translate() {},
                        rotate() {}
                    })
                }
                return type === '2d' ? contexts.get(canvas) : null
            }
        }
        created.push(canvas)
        return canvas
    }
    return { makeCanvas, created, contexts }
}

test('the text-texture upload passes the held 2D context of its source canvas', () => {
    const { makeCanvas, created, contexts } = makeCanvasFactory()
    const uploads = []
    const engine = {
        _pipeline: {},
        updateTextureFromSource(id, source, options) {
            uploads.push({ id, source, options })
        }
    }
    const context = vm.createContext({
        console,
        document: { createElement: () => makeCanvas() },
        SHADER_BASE_PATH: 'https://shaders.noisedeck.app/1',
        CanvasRenderer: function () { return engine }
    })
    vm.runInContext(classSource, context)
    const Renderer = context.PolymorphicRenderer || vm.runInContext('PolymorphicRenderer', context)

    const hostCanvas = makeCanvas()
    hostCanvas.width = 64
    hostCanvas.height = 64
    const renderer = new Renderer(hostCanvas, { width: 64, height: 64 })
    renderer._renderTextTexture({
        matteColor: [0, 0, 0],
        matteOpacity: 0,
        size: 0.2,
        font: 'sans-serif',
        justify: 'center',
        color: [255, 255, 255],
        posX: 0.5,
        posY: 0.5,
        rotation: 0,
        text: 'hi'
    }, 0)

    assert.equal(uploads.length, 1)
    const upload = uploads[0]
    assert.equal(upload.id, 'textTex_step_0')
    assert.equal(upload.source, created[1])
    assert.equal(upload.options.flipY, true)
    // The engine uploads a willReadFrequently canvas from its getImageData
    // bytes only when the caller hands over the context it holds.
    assert.equal(upload.options.context2d, contexts.get(created[1]))
    assert.equal(upload.options.context2d.canvas, created[1])
})
