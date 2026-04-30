#!/usr/bin/env node
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:3000';
const out = process.argv[3] || '/tmp/polymorphic.png';
const wait = parseInt(process.argv[4] || '3000');
const viewport = (process.argv[5] || '1440x900').split('x').map(Number);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('[PAGE-ERROR] ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warning') {
    console.log(`[${m.type()}]`, m.text());
  }
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: false });

const info = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  return {
    canvasVisible: c?.classList.contains('visible'),
    canvasW: c?.width, canvasH: c?.height,
    docOpen: document.getElementById('doc-reader-panel')?.classList.contains('visible'),
    editorVisible: document.getElementById('dsl-overlay')?.style.display !== 'none',
    editorValue: document.querySelector('code-editor')?.value?.slice(0, 200)
  };
});
console.log('PAGE_INFO', JSON.stringify(info, null, 2));
if (errors.length) console.log('PAGE_ERRORS', errors);
await browser.close();
console.log('SCREENSHOT', out);
