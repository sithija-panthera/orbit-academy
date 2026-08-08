// Smoke-test the LIVE GitHub Pages deployment.
import { chromium } from 'playwright';

const BASE = 'https://sithija-panthera.github.io/orbit-academy';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/live-1-landing.png' });
console.log('landing lidar:', await page.textContent('#lidar-readout'));

await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.click('#btn-run');
let done = false;
const t0 = Date.now();
while (Date.now() - t0 < 35000 && !done) {
  await page.waitForTimeout(500);
  done = await page.evaluate(() => !document.getElementById('goal-toast').classList.contains('hidden'));
}
console.log('live lesson 1 complete:', done);
await page.screenshot({ path: 'shots/live-2-app.png' });

await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/live-3-dashboard.png' });
console.log('dashboard auth visible:', await page.evaluate(() => !document.getElementById('auth-panel').classList.contains('hidden')));
console.log('pageErrors:', errors.length ? errors : 'none');
await browser.close();
