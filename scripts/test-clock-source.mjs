// Smoke test: clock source picker in the BPM bar.
// Verifies UI toggle, persistence, and that the page loads without errors.
//
//   npm run dev   (in another terminal)
//   node scripts/test-clock-source.mjs

import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('[pageerror] ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()) })

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 1. BPM bar exists, defaults to manual source.
const bar = await page.$('.bpm-indicator')
if (!bar) throw new Error('FAIL: .bpm-indicator not in DOM')
const initialSource = await page.evaluate(() => {
    const el = document.querySelector('.bpm-indicator')
    return {
        midiClass: el.classList.contains('midi'),
        labelText: el.querySelector('[data-id=label]').textContent.trim(),
        hintText: el.querySelector('[data-id=hint]').textContent.trim(),
        stored: localStorage.getItem('polymorphic.bpm.source')
    }
})
if (initialSource.midiClass) throw new Error('FAIL: starts in midi mode')
if (initialSource.labelText !== 'bpm') throw new Error(`FAIL: label is "${initialSource.labelText}", expected "bpm"`)
if (initialSource.hintText !== 'tap T · scroll · drag') throw new Error(`FAIL: hint is "${initialSource.hintText}"`)
console.log('PASS: defaults to manual source')

// 2. Clicking the label toggles to midi.
await page.click('.bpm-indicator [data-id=label]')
await page.waitForTimeout(300)
const afterToggle = await page.evaluate(() => {
    const el = document.querySelector('.bpm-indicator')
    return {
        midiClass: el.classList.contains('midi'),
        labelText: el.querySelector('[data-id=label]').textContent.trim(),
        hintText: el.querySelector('[data-id=hint]').textContent.trim(),
        stored: localStorage.getItem('polymorphic.bpm.source')
    }
})
if (!afterToggle.midiClass) throw new Error('FAIL: did not enter midi mode')
if (afterToggle.labelText !== 'midi') throw new Error(`FAIL: label is "${afterToggle.labelText}", expected "midi"`)
if (afterToggle.stored !== 'midi') throw new Error(`FAIL: localStorage is "${afterToggle.stored}", expected "midi"`)
// Hint is one of the MIDI status strings (status depends on whether the
// headless browser exposes a MIDI access surface — usually "no device").
const validHints = ['synced', 'no device', 'no clock', 'stopped', 'permission denied']
if (!validHints.includes(afterToggle.hintText)) throw new Error(`FAIL: hint is "${afterToggle.hintText}", expected one of ${validHints.join('|')}`)
console.log(`PASS: toggled to midi (status hint: "${afterToggle.hintText}")`)

// 3. Clicking again returns to manual.
await page.click('.bpm-indicator [data-id=label]')
await page.waitForTimeout(200)
const afterToggleBack = await page.evaluate(() => {
    const el = document.querySelector('.bpm-indicator')
    return {
        midiClass: el.classList.contains('midi'),
        labelText: el.querySelector('[data-id=label]').textContent.trim(),
        stored: localStorage.getItem('polymorphic.bpm.source')
    }
})
if (afterToggleBack.midiClass) throw new Error('FAIL: did not return to manual')
if (afterToggleBack.labelText !== 'bpm') throw new Error(`FAIL: label is "${afterToggleBack.labelText}", expected "bpm"`)
if (afterToggleBack.stored !== 'manual') throw new Error(`FAIL: localStorage is "${afterToggleBack.stored}", expected "manual"`)
console.log('PASS: toggled back to manual')

// 4. Set midi, reload, verify persistence.
await page.click('.bpm-indicator [data-id=label]')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const afterReload = await page.evaluate(() => {
    const el = document.querySelector('.bpm-indicator')
    return {
        midiClass: el.classList.contains('midi'),
        labelText: el.querySelector('[data-id=label]').textContent.trim(),
        stored: localStorage.getItem('polymorphic.bpm.source')
    }
})
if (!afterReload.midiClass) throw new Error('FAIL: midi state did not persist across reload')
if (afterReload.labelText !== 'midi') throw new Error(`FAIL: label is "${afterReload.labelText}" after reload`)
console.log('PASS: midi source persisted across reload')

// Defocus editor so T keys reach the document-level bpm shortcut handler
// (and don't get typed into the DSL textarea, which would corrupt the program).
const blurAll = () => page.evaluate(() => document.activeElement?.blur?.())

// 5. Six taps in midi mode should NOT change the BPM (tap() returns early).
await blurAll()
const bpmMidiBefore = await page.evaluate(() =>
    document.querySelector('.bpm-indicator [data-id=value]').textContent.trim()
)
for (let i = 0; i < 6; i++) {
    await page.keyboard.press('t')
    await page.waitForTimeout(160)
}
const bpmMidiAfter = await page.evaluate(() =>
    document.querySelector('.bpm-indicator [data-id=value]').textContent.trim()
)
if (bpmMidiBefore !== bpmMidiAfter) {
    throw new Error(`FAIL: T key changed BPM in midi mode (${bpmMidiBefore} → ${bpmMidiAfter})`)
}
console.log('PASS: T key ignored in midi mode')

// 6. Switch back to manual; T keys should change BPM.
await page.click('.bpm-indicator [data-id=label]')
await page.waitForTimeout(200)
await blurAll()
const bpmManualBefore = await page.evaluate(() =>
    document.querySelector('.bpm-indicator [data-id=value]').textContent.trim()
)
// page.keyboard.press dispatches at the focused element (body, after blurAll),
// which the bpm shortcut handler picks up via document-level listener.
for (let i = 0; i < 6; i++) {
    await page.keyboard.press('t')
    await page.waitForTimeout(160)
}
const bpmManualAfter = await page.evaluate(() =>
    document.querySelector('.bpm-indicator [data-id=value]').textContent.trim()
)
if (bpmManualBefore === bpmManualAfter) {
    throw new Error(`FAIL: T key did NOT change BPM in manual mode (still ${bpmManualBefore})`)
}
// Exact value depends on Playwright scheduling jitter (often 100..400 BPM);
// just confirm the result is in setBpm's clamp range.
const bpmAfterNum = Number(bpmManualAfter)
if (!(bpmAfterNum >= 20 && bpmAfterNum <= 400)) {
    throw new Error(`FAIL: BPM after taps (${bpmAfterNum}) outside clamp range`)
}
console.log(`PASS: T key changed BPM in manual mode (${bpmManualBefore} → ${bpmManualAfter})`)

if (errors.length) {
    console.log('\nERRORS:')
    for (const e of errors) console.log('  ' + e)
    await browser.close()
    process.exit(1)
}

console.log('\nAll checks passed.')
await browser.close()
