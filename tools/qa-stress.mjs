// Scenario 7: 60s stress run of default lesson code.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.click('#btn-run');
const samples = [];
let nan = false, outOfBounds = null, maxAbsX = 0, maxAbsZ = 0;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const t = await page.evaluate(() => window.__oa.sim.telemetry);
  samples.push(t);
  for (const v of Object.values(t)) if (typeof v === 'number' && Number.isNaN(v)) nan = true;
  maxAbsX = Math.max(maxAbsX, Math.abs(t.x)); maxAbsZ = Math.max(maxAbsZ, Math.abs(t.z));
  if (Math.abs(t.x) > 12.5 || Math.abs(t.z) > 12.5) outOfBounds = { i, t };
}
await page.screenshot({ path: 'shots/qa-7-stress.png' });
console.log(JSON.stringify({ nan, outOfBounds, maxAbsX, maxAbsZ, last: samples.at(-1), sampleEvery2s: samples.map(s => [ +s.x.toFixed(2), +s.z.toFixed(2) ]), pageErrors: errors }, null, 2));
await browser.close();
