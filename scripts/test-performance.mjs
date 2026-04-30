import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Open everything
await page.click('#inputs-toggle-btn');
await page.click('#perf-toggle-btn');
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Control+;');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-perf-before.png' });

// Toggle performance mode
await page.keyboard.press('Control+Shift+H');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-perf-on.png' });

// Exit
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/poly-perf-after.png' });

console.log('PAGE_ERRORS', JSON.stringify(errors));
await browser.close();
