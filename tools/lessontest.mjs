// End-to-end lesson validation: every lesson's starter code must reach its goal.
import { chromium } from 'playwright';

const LESSONS = [
  { id: 'rover-1', timeout: 30 },
  { id: 'rover-2', timeout: 45 },
  { id: 'drone-1', timeout: 25 },
  { id: 'drone-2', timeout: 40 },
  { id: 'arm-1', timeout: 30 },
  { id: 'orbit-1', timeout: 60 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.goto('http://localhost:5199/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

for (const l of LESSONS) {
  await page.evaluate((id) => window.__oa.loadLesson(id), l.id);
  await page.waitForTimeout(1500);
  await page.click('#btn-run');
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < l.timeout * 1000) {
    await page.waitForTimeout(500);
    done = await page.evaluate(() => !document.getElementById('goal-toast').classList.contains('hidden'));
    if (done) break;
  }
  const tel = await page.evaluate(() => window.__oa.sim.telemetry);
  await page.screenshot({ path: `shots/lesson-${l.id}.png` });
  console.log(`${l.id}: ${done ? 'GOAL COMPLETE' : 'TIMED OUT'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    JSON.stringify({ x: +tel.x?.toFixed(2), z: +tel.z?.toFixed(2), alt: tel.alt !== undefined ? +tel.alt.toFixed(2) : undefined }));
  await page.click('#btn-stop');
  await page.waitForTimeout(500);
}
console.log('pageErrors:', pageErrors.length ? pageErrors : 'none');
await browser.close();
