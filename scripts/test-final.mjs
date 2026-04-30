import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
const consoleErrors = [];
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('console', m => {
  if (m.type() === 'error') consoleErrors.push('[console.error] ' + m.text());
});

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const initial = await page.evaluate(() => ({
  canvasVisible: document.getElementById('canvas')?.classList.contains('visible'),
  editorValue: document.querySelector('code-editor')?.value?.slice(0, 80),
  hasCmdPaletteStyles: !!document.getElementById('command-palette-styles'),
  hasGalleryStyles: !!document.getElementById('gallery-styles'),
  hasInputsPanel: !!document.querySelector('.live-inputs-panel'),
  hasPerfOverlay: !!document.querySelector('.perf-overlay'),
  hasBpmIndicator: !!document.querySelector('.bpm-indicator'),
  hasStatusRow: !!document.querySelector('.status-row'),
}));
console.log('INITIAL', JSON.stringify(initial, null, 2));

await page.screenshot({ path: '/tmp/poly-final-1-clean.png' });

// Blur editor and press ? to show shortcuts dialog
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(100);
await page.keyboard.press('?');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-final-2-shortcuts.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Open command palette and search for 'cell'
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.type('cell');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/poly-final-3-palette-cell.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Open gallery and click first card
await page.click('#gallery-btn');
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/poly-final-4-gallery.png' });
// Click "Voronoi Cells" (3rd card if order holds)
const cards = await page.locator('.gallery-card').all();
if (cards.length >= 3) {
  await cards[2].click();
  await page.waitForTimeout(2500);
}
await page.screenshot({ path: '/tmp/poly-final-5-voronoi.png' });

// Open live inputs + perf
await page.click('#inputs-toggle-btn');
await page.click('#perf-toggle-btn');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/poly-final-6-panels.png' });

// Tap tempo
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('t');
  await page.waitForTimeout(450);
}
await page.screenshot({ path: '/tmp/poly-final-7-bpm.png' });

// Show status row
await page.keyboard.press('Control+;');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/poly-final-8-status-row.png' });

// Block eval test
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/poly-final-9-block-eval.png' });

// Final state
await page.screenshot({ path: '/tmp/poly-final-10-everything.png' });

console.log('PAGE_ERRORS', JSON.stringify(errors));
console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors));

await browser.close();
