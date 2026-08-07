// Screenshot + interaction harness for validating the app headlessly.
// usage: node tools/shot.mjs <scenario> <outfile>
import { chromium } from 'playwright';

const [scenario = 'load', out = 'shot.png'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // let physics/monaco init

if (scenario === 'run') {
  await page.click('#btn-run');
  await page.waitForTimeout(8000); // let the rover drive
} else if (scenario === 'run-long') {
  await page.click('#btn-run');
  await page.waitForTimeout(20000);
} else if (scenario === 'topics') {
  await page.click('#btn-run');
  await page.waitForTimeout(4000);
  await page.click('[data-tab="topics"]');
  await page.waitForTimeout(1200);
} else if (scenario === 'tutor') {
  await page.click('[data-tab="tutor"]');
  await page.waitForTimeout(500);
} else if (scenario === 'stop') {
  await page.click('#btn-run');
  await page.waitForTimeout(5000);
  await page.click('#btn-stop');
  await page.waitForTimeout(2000);
} else if (scenario === 'reset') {
  await page.click('#btn-run');
  await page.waitForTimeout(6000);
  await page.click('#btn-reset');
  await page.waitForTimeout(1500);
}

const hud = await page.textContent('#hud-telemetry').catch(() => '');
const status = await page.textContent('#hud-status').catch(() => '');
const consoleTail = await page.$$eval('#console-out .log-line', (els) => els.slice(-8).map((e) => e.textContent));
await page.screenshot({ path: out });
console.log(JSON.stringify({ scenario, status, hud, consoleTail, pageErrors: errors.slice(0, 10) }, null, 2));
await browser.close();
