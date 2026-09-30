import { test, expect } from '@playwright/test'
import { routePortableImagesLocal } from './portableImagesLocal.js'

test.beforeEach(async ({ page }) => routePortableImagesLocal(page))

test('image dimensions survive initial ProgramState sync and parameter controls', async ({ page }) => {
  await page.goto('/')
  const dataUrl = await page.evaluate(() => {
    const source = document.createElement('canvas'); source.width = 96; source.height = 32
    const context = source.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 96, 32)
    return source.toDataURL('image/png')
  })
  await page.goto('/?dsl=' + encodeURIComponent(`search synth\nmedia(url: "${dataUrl}").write(o0)\nrender(o0)`))
  await page.waitForFunction(() => window.__poly?.programState?.getStructure().some(effect => effect.effectKey === 'synth.media'))
  const result = await page.evaluate(() => {
    const app = window.__poly
    const dimensions = () => app.renderer.inner.pipeline.graph.passes.filter(pass => pass.effectKey === 'synth.media').map(pass => [...pass.uniforms.imageSize])
    const before = dimensions()
    app.programState.setValue('step_0', 'offsetX', 1)
    return { before, after: dimensions(), dsl: document.getElementById('dsl-editor').value }
  })
  expect(result.before).toEqual([[96, 32]])
  expect(result.after).toEqual([[96, 32]])
  expect(result.dsl).toContain(dataUrl)
})

const sketches = [
  ['existing render, cursor inside a call', 'search synth\n\nsolid(color: #00ff00).write(o0)\n\nrender(o0)', 'o0'],
  ['another selected output', 'search synth\n\nsolid(color: #00ff00).write(o3)\n\nrender(o3)', 'o3'],
  ['no render and a trailing comment', 'search synth\n\nsolid().write(o0) // render(o2)', 'o0'],
  ['empty editor', '', 'o0'],
  ['render text in a comment', 'search synth\n/*\nrender(o2)\n*/\nsolid().write(o0)\nrender(o0)', 'o0'],
  ['missing synth namespace', 'search filter\nrender(o0)', 'o0'],
  ['existing live media', 'search synth\nmedia(url: "live", rotation: 0).write(o0)\nrender(o0)', 'o0'],
  ['existing media without a url', 'search synth\nmedia(rotation: 0).write(o0)\nrender(o0)', 'o0'],
  ['existing media without render', 'search synth\nmedia(rotation: 0).write(o3)', 'o3'],
  ['positional media parameters', 'search synth\nmedia(4, 0).write(o0)\nrender(o0)', 'o0'],
]

for (const input of ['picker', 'drop']) {
for (const [name, program, output] of sketches) {
  test(`image ${input} inserts a runnable source: ${name}`, async ({ page }) => {
    await page.goto('/?dsl=' + encodeURIComponent('search synth\nsolid().write(o0)\nrender(o0)'))
    await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
    const image = await page.evaluate((program) => {
      const editor = document.getElementById('dsl-editor')
      editor.value = program
      const ta = editor.getTextarea()
      const cursor = Math.max(0, program.indexOf('solid') + 2)
      ta.setSelectionRange(cursor, cursor + 2)
      window.__poly.liveInputsPanel.open()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 16
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 16, 16)
      return canvas.toDataURL().split(',')[1]
    }, program)
    if (input === 'picker') {
      const chooser = page.waitForEvent('filechooser')
      await page.locator('[data-source="image"]').click()
      await (await chooser).setFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })
    } else {
      await page.evaluate(image => {
        const bytes = Uint8Array.from(atob(image), c => c.charCodeAt(0))
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([bytes], 'red.png', { type: 'image/png' }))
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
      }, image)
    }
    await expect.poll(() => page.locator('#dsl-editor').evaluate(el => el.value)).toContain('data:image/png;base64,')
    const result = await page.evaluate(async () => {
      const dsl = document.getElementById('dsl-editor').value
      const { parse, lex } = await import('/js/noisemaker/bundle.js')
      try {
        const ast = parse(lex(dsl))
        return { dsl, output: ast.render?.name }
      } catch (error) {
        return { dsl, error: error.message }
      }
    })
    expect(result.error, JSON.stringify(result)).toBeUndefined()
    expect(result.output).toBe(output)
    if (!program.includes('media(')) {
      for (const line of program.split('\n').filter(Boolean)) expect(result.dsl).toContain(line)
    } else {
      expect(result.dsl.match(/\bmedia\(/g)).toHaveLength(1)
      if (name === 'positional media parameters') {
        expect(result.dsl).toContain('position: 4')
        expect(result.dsl).toContain('tiling: 0')
      } else {
        expect(result.dsl).toContain('rotation: 0')
      }
    }
    // Wait for real rendered image pixels, not just successful parsing.
    await expect.poll(() => page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d')
      ctx.drawImage(document.getElementById('canvas'), 0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    })).toEqual([255, 0, 0, 255])
  })
}
}

test('image drop failure surfaces a warning toast', async ({ page }) => {
  await page.goto('/?dsl=' + encodeURIComponent('search synth\nsolid().write(o0)\nrender(o0)'))
  await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
  // Break FileReader so the drop's async path rejects.
  await page.evaluate(() => {
    class FailingFileReader {
      set onload(_) {}
      readAsDataURL() {
        setTimeout(() => this.onerror?.({ target: { error: new Error('read failed') } }), 0)
      }
    }
    window.FileReader = FailingFileReader
  })
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([new Uint8Array(8)], 'broken.png', { type: 'image/png' }))
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.polymorphic-toast[data-type="warning"]')).toContainText('broken.png')
  // The editor must be untouched by the failed drop.
  await expect.poll(() => page.locator('#dsl-editor').evaluate(el => el.value)).not.toContain('data:image')
})

test('resize during image decoding keeps the newly compiled image and waits for its upload', async ({ page }) => {
  await page.goto('/?dsl=' + encodeURIComponent('search synth\nsolid().write(o0)\nrender(o0)'))
  await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
  await page.evaluate(async () => {
    const renderer = window.__poly.renderer
    const tools = await import('https://sharing.noisedeck.app/js/portableImages.js?v=images-20260929')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 8
    const ctx = canvas.getContext('2d')
    const assets = []
    for (const color of ['#ff0000', '#00ff00']) {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 8, 8)
      assets.push(await tools.prepareImage(await new Promise(resolve => canvas.toBlob(resolve))))
    }
    renderer.images = assets
    const program = asset => `search synth\nmedia(url:"image:${asset.id}").write(o0)\nrender(o0)`
    const first = await renderer.compile(program(assets[0]))
    if (!first.success) throw new Error(first.error)
    const NativeImage = window.Image
    const created = [], held = [], uploads = []
    const upload = renderer.inner.updateTextureFromSource.bind(renderer.inner)
    renderer.inner.updateTextureFromSource = (id, source, options) => {
      if (id.startsWith('imageTex_')) uploads.push(source.src)
      return upload(id, source, options)
    }
    window.Image = function () {
      const image = new NativeImage()
      created.push(image)
      Object.defineProperty(image, 'onload', { set(handler) {
        image.addEventListener('load', event => {
          if (image.src === assets[1].dataUrl) held.push(() => handler.call(image, event))
          else handler.call(image, event)
        }, {once:true})
      } })
      return image
    }
    window.__imageResizeTest = { created, held, uploads, expected:assets[1].dataUrl, NativeImage }
    window.__imageResizeTest.pending = renderer.compile(program(assets[1]))
  })
  await page.waitForFunction(() => window.__imageResizeTest.held.length === 1)
  const result = await page.evaluate(async () => {
    const state = window.__imageResizeTest
    const renderer = window.__poly.renderer
    renderer.resize(128, 128)
    const created = state.created.length
    try {
      state.held[0]()
      const compiled = await state.pending
      return { compiled, created, uploads:state.uploads, expected:state.expected }
    } finally {
      window.Image = state.NativeImage
    }
  })
  expect(result.compiled.success).toBe(true)
  expect(result.created, 'resize must reuse the pending decode for the installed program').toBe(1)
  expect(result.uploads).toEqual([result.expected])
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.drawImage(document.getElementById('canvas'), 0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  })).toEqual([0, 255, 0, 255])
})
