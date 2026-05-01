// Verify gallery preview pips don't go broken when cards scroll offscreen.
//   1. Open the gallery
//   2. Wait for first batch of live previews to render
//   3. Scroll cards out of view
//   4. Scroll them back into view
//   5. Inspect each thumb — every one should still be filled with pixels

import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:3000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', e => errs.push('[pe] ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.click('#gallery-btn');
await page.waitForTimeout(4000);

// Scroll the gallery body all the way down so the first cards drop out of view
await page.evaluate(() => {
    const body = document.querySelector('.gallery-body');
    body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(2500);

// Inspect what the first cards (now offscreen) look like:
// they should now have a gallery-card-snapshot <img> visible.
const offState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.gallery-card')].slice(0, 6);
    return cards.map((c, i) => ({
        idx: i,
        title: c.querySelector('.gallery-card-title')?.textContent?.trim(),
        snapshotImg: !!c.querySelector('.gallery-card-snapshot'),
        canvasDisplayed: c.querySelector('canvas')?.style.display !== 'none',
        snapshotSize: (() => {
            const img = c.querySelector('.gallery-card-snapshot');
            return img ? `${img.naturalWidth}x${img.naturalHeight}` : null;
        })()
    }));
});
console.log('=== After scrolling to bottom (top cards offscreen) ===');
console.log(JSON.stringify(offState, null, 2));

await page.screenshot({ path: '/tmp/poly-pip-snapshot-scrolled.png' });

// Scroll back to top
await page.evaluate(() => {
    document.querySelector('.gallery-body').scrollTop = 0;
});
await page.waitForTimeout(2500);

const onState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.gallery-card')].slice(0, 6);
    return cards.map((c, i) => ({
        idx: i,
        title: c.querySelector('.gallery-card-title')?.textContent?.trim(),
        snapshotImg: !!c.querySelector('.gallery-card-snapshot'),
        canvasDisplayed: c.querySelector('canvas')?.style.display !== 'none'
    }));
});
console.log('\n=== After scrolling back to top ===');
console.log(JSON.stringify(onState, null, 2));

await page.screenshot({ path: '/tmp/poly-pip-snapshot-restored.png' });

const allOffShowSnapshot = offState.every(s => s.snapshotImg);
const allOnShowCanvas = onState.every(s => s.canvasDisplayed && !s.snapshotImg);
console.log('\nVerdict:',
    allOffShowSnapshot && allOnShowCanvas && errs.length === 0 ? 'PASS' : 'FAIL');
if (errs.length) console.log('errs:', errs.join(' | '));

await browser.close();
process.exit(allOffShowSnapshot && allOnShowCanvas && errs.length === 0 ? 0 : 1);
