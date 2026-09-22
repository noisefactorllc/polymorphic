import { test, expect } from '@playwright/test'

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
