import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Click inputs toggle
await page.click('#inputs-toggle-btn');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-inputs-open.png' });

// Mouse over to verify hover styles
await page.hover('.live-input-snippet[data-snippet="osc:sine"]');
await page.waitForTimeout(200);

// Click an osc snippet to insert into editor
await page.click('.live-input-snippet[data-snippet="osc:sine"]');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/poly-inputs-after-insert.png' });

const editorValue = await page.evaluate(() => document.querySelector('code-editor')?.value);
console.log('EDITOR_VALUE_AFTER_INSERT', editorValue?.slice(-200));

console.log('PAGE_ERRORS', JSON.stringify(errors));
await browser.close();
