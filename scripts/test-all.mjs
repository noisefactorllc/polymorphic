import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const consoleErrors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => {
  if (m.type() === 'error') consoleErrors.push('[console.error] ' + m.text());
});

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

await page.screenshot({ path: '/tmp/poly-step3-default.png' });

// Open palette + close
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/poly-step3-palette.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Open live inputs
await page.click('#inputs-toggle-btn');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/poly-step3-inputs.png' });

// Open performance overlay
await page.click('#perf-toggle-btn');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-step3-perf.png' });

// Tap T for tempo
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('t');
  await page.waitForTimeout(500);
}
await page.screenshot({ path: '/tmp/poly-step3-bpm.png' });

// Open gallery
await page.click('#gallery-btn');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/poly-step3-gallery.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Final state
await page.screenshot({ path: '/tmp/poly-step3-final.png' });

console.log('PAGE_ERRORS', JSON.stringify(errors));
console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors));

await browser.close();
