import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Open palette
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-palette-open.png' });

// Type a query
await page.keyboard.type('blur');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/poly-palette-search.png' });

// Close
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Test block evaluation
await page.click('code-editor');
// Place cursor in middle of program (line 5 say)
await page.keyboard.press('Control+End');
await page.waitForTimeout(200);
// Trigger block eval (Alt+Enter)
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/poly-block-eval.png' });

// Trigger force recompile (Cmd+Enter — Control on Linux)
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/poly-eval-all.png' });

console.log('PAGE_ERRORS', JSON.stringify(errors));
await browser.close();
