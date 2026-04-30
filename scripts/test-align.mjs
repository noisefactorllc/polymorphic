import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Open live inputs (docs is open by default)
await page.click('#inputs-toggle-btn');
await page.waitForTimeout(500);

const rects = await page.evaluate(() => {
  const docs = document.getElementById('doc-reader-panel');
  const live = document.querySelector('.live-inputs-panel');
  const perf = document.querySelector('.perf-overlay');
  const r = el => el ? el.getBoundingClientRect() : null;
  return {
    docs: r(docs),
    live: r(live),
    perf: r(perf),
    viewportW: window.innerWidth,
    viewportH: window.innerHeight
  };
});
console.log(JSON.stringify(rects, null, 2));

await page.screenshot({ path: '/tmp/poly-aligned.png' });

// Also screenshot with perf overlay open
await page.click('#perf-toggle-btn');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/poly-aligned-with-perf.png' });
const rects2 = await page.evaluate(() => {
  const docs = document.getElementById('doc-reader-panel');
  const live = document.querySelector('.live-inputs-panel');
  const perf = document.querySelector('.perf-overlay');
  const r = el => el ? el.getBoundingClientRect() : null;
  return { docs: r(docs), live: r(live), perf: r(perf) };
});
console.log('with perf:', JSON.stringify(rects2, null, 2));

await browser.close();
