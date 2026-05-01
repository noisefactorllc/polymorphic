// Drives a real Google Chrome at https://polymorphic.noisedeck.app/, opens the
// program browser, switches to NoiseBLASTER!, and asserts that the feed
// actually populates without CORS errors.
//
// Pass exit code 0 = the live site can fetch and render the live feed.

import { chromium } from 'playwright';

const URL = 'https://polymorphic.noisedeck.app/';
const TIMEOUT = 60_000;

const browser = await chromium.launch({
    channel: 'chrome',  // real Chrome, not the bundled headless shell
    headless: false
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
page.on('console', m => {
    if (m.type() === 'error') errs.push(`[console.error] ${m.text().slice(0, 300)}`);
});

console.log('Navigating to', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
await page.waitForTimeout(4000);

await page.click('#gallery-btn');
await page.waitForTimeout(800);
await page.click('.gallery-tab[data-tab="blaster"]');
await page.waitForTimeout(5000);  // wait for fetch + render

const summary = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.gallery-card')];
    const errBanner = document.querySelector('.gallery-error');
    const empty = document.querySelector('.gallery-empty');
    const loading = document.querySelector('.gallery-loading');
    const sample = cards.slice(0, 3).map(c => ({
        title: c.querySelector('.gallery-card-title')?.textContent?.trim(),
        meta:  c.querySelector('.gallery-card-meta')?.textContent?.trim().replace(/\s+/g, ' '),
        hasImg: !!c.querySelector('.gallery-card-thumb img')
    }));
    return {
        cardCount: cards.length,
        error: errBanner?.textContent?.trim() || null,
        empty: empty?.textContent?.trim() || null,
        loading: loading?.textContent?.trim() || null,
        sample
    };
});

await page.screenshot({ path: '/tmp/poly-prod-blaster.png' });

console.log(JSON.stringify(summary, null, 2));
if (errs.length) {
    console.log('\n=== Console errors (first 5) ===');
    for (const e of errs.slice(0, 5)) console.log(' ', e);
}
const corsBlocked = errs.some(e => /CORS|Access-Control/i.test(e));
const ok = summary.cardCount > 0 && !summary.error && !corsBlocked;
console.log('\nVerdict:', ok ? 'PASS' : 'FAIL');

await browser.close();
process.exit(ok ? 0 : 1);
