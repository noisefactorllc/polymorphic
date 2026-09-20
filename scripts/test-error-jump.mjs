import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1024, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    ed.value = 'search synth\n\n\n@invalid syntax here\n\nrender(o0)'
    ed.dispatchEvent(new CustomEvent('forcerecompile', { bubbles: true }))
})
await p.waitForSelector('#compiler-error.visible', { timeout: 10000 })
// Click the compile error banner
const bannerText = await p.evaluate(() => document.getElementById('compiler-error')?.textContent || '')
await p.click('#compiler-error')
await p.waitForTimeout(400)
const details = await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    const ta = ed.getTextarea()
    const before = ta.value.slice(0, ta.selectionStart)
    const line = before.split('\n').length
    const selectedText = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    const displayErrorLine = ed.querySelector('.code-editor-display .code-line.error-line')?.getAttribute('data-line-number')
    const gutterErrorLine = ed.querySelector('.code-editor-gutter .line-number.error-line')?.textContent?.trim()
    return {
        line,
        selectionStart: ta.selectionStart,
        selectionEnd: ta.selectionEnd,
        selectedText,
        displayErrorLine,
        gutterErrorLine
    }
})
console.log('Banner text:', bannerText)
console.log('Jump details:', JSON.stringify(details, null, 2))
const okInput = details.line === 4 &&
              details.selectedText === '@' &&
              details.displayErrorLine === '4' &&
              details.gutterErrorLine === '4' &&
              bannerText.includes('line 4:1 — ')
console.log('Input compile jump test:', okInput ? 'PASS' : 'FAIL')

// Test 2: forceevalblock coordinate translation
console.log('Testing block-evaluation coordinate translation...')
await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    const ta = ed.getTextarea()
    const text = 'search synth\n\nsine()\n  .write(o0)\n\n@syntax error in block\n\nrender(o0)'
    ed.value = text
    const blockStart = text.indexOf('@syntax')
    ta.selectionStart = blockStart
    ta.selectionEnd = blockStart + '@syntax error in block'.length
    ed.dispatchEvent(new CustomEvent('forceevalblock', { bubbles: true }))
})
await p.waitForTimeout(1000)

const blockBanner = await p.evaluate(() => document.getElementById('compiler-error')?.textContent || '')
await p.click('#compiler-error')
await p.waitForTimeout(400)
const blockDetails = await p.evaluate(() => {
    const ed = document.querySelector('code-editor')
    const ta = ed.getTextarea()
    const before = ta.value.slice(0, ta.selectionStart)
    const line = before.split('\n').length
    const selectedText = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    const displayErrorLine = ed.querySelector('.code-editor-display .code-line.error-line')?.getAttribute('data-line-number')
    const gutterErrorLine = ed.querySelector('.code-editor-gutter .line-number.error-line')?.textContent?.trim()
    const allDisplayLines = Array.from(ed.querySelectorAll('.code-editor-display .code-line')).map(el => ({ line: el.getAttribute('data-line-number'), class: el.className }))
    const allGutterLines = Array.from(ed.querySelectorAll('.code-editor-gutter .line-number')).map(el => ({ text: el.textContent, class: el.className }))
    return {
        line,
        selectionStart: ta.selectionStart,
        selectionEnd: ta.selectionEnd,
        selectedText,
        displayErrorLine,
        gutterErrorLine,
        allDisplayLines,
        allGutterLines
    }
})
console.log('Block banner text:', blockBanner)
console.log('Block jump details:', JSON.stringify(blockDetails, null, 2))
const okBlock = blockDetails.line === 6 &&
                blockDetails.selectedText === '@' &&
                blockDetails.displayErrorLine === '6' &&
                blockDetails.gutterErrorLine === '6' &&
                blockBanner.includes('line 6:1 — ')
console.log('Block eval jump test:', okBlock ? 'PASS' : 'FAIL')

await b.close()
const ok = okInput && okBlock
process.exit(ok ? 0 : 1)
