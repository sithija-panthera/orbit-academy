// Full-site test against the production build (vite preview on :5200):
// landing → signup → run lesson 1 → goal complete → progress on dashboard.
import { chromium } from 'playwright';

const BASE = 'http://localhost:5200';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// 1. landing
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/site-1-landing.png', fullPage: false });
const readout = await page.textContent('#lidar-readout');
console.log('landing lidar readout:', readout);

// 2. dashboard signup
await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
await page.click('#auth-toggle'); // switch to signup
await page.fill('#auth-name', 'TestPilot');
await page.fill('#auth-pass', 'rover42');
await page.click('#auth-submit');
await page.waitForTimeout(400);
const hello = await page.textContent('#dash-hello');
console.log('after signup:', hello);
await page.screenshot({ path: 'shots/site-2-dashboard-empty.png' });

// 3. app: run lesson 1 to completion (same browser profile keeps the session)
await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const chip = await page.textContent('#user-chip');
console.log('app user chip:', chip);
await page.click('#btn-run');
let done = false;
const t0 = Date.now();
while (Date.now() - t0 < 35000 && !done) {
  await page.waitForTimeout(500);
  done = await page.evaluate(() => !document.getElementById('goal-toast').classList.contains('hidden'));
}
console.log('lesson 1 goal complete:', done);
await page.screenshot({ path: 'shots/site-3-app-goal.png' });

// 4. dashboard shows progress
await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const stats = await page.$$eval('.stat', (els) => els.map((e) => e.textContent.trim()));
const missions = await page.$$eval('.mission', (els) => els.map((e) => e.className + ' | ' + e.querySelector('.best').textContent));
console.log('stats:', stats);
console.log('missions:', missions);
await page.screenshot({ path: 'shots/site-4-dashboard-progress.png' });

// 5. sign out → auth panel returns
await page.click('#btn-logout');
await page.waitForTimeout(300);
const authVisible = await page.evaluate(() => !document.getElementById('auth-panel').classList.contains('hidden'));
console.log('after logout, auth panel visible:', authVisible);

console.log('pageErrors:', errors.length ? errors : 'none');
await browser.close();
