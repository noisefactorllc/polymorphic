import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') console.log('[ce]', m.text().slice(0,200)); });
page.on('pageerror', e => console.log('[pe]', e.message));

await page.goto('http://localhost:3000?dsl=' + encodeURIComponent('search synth, render\n\nnoise().write(o0)\nrender(o0)'), { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Inject a syntax error
await page.evaluate(() => {
  const ed = document.querySelector('code-editor');
  ed.value = 'this is not valid dsl @#%';
  ed.getTextarea().dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
  const ce = document.getElementById('compiler-error');
  const rect = ce?.getBoundingClientRect();
  return {
    exists: !!ce,
    classList: ce?.className,
    style: ce ? {
      display: getComputedStyle(ce).display,
      visibility: getComputedStyle(ce).visibility,
      opacity: getComputedStyle(ce).opacity,
      zIndex: getComputedStyle(ce).zIndex
    } : null,
    rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
    text: ce?.textContent?.slice(0, 200)
  };
});
console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: '/tmp/poly-error-repro.png' });
await browser.close();
