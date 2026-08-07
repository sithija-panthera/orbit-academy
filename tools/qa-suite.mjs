// QA suite: scenarios 1-6. Usage: node tools/qa-suite.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e)));

const tel = () => page.evaluate(() => window.__oa?.sim?.telemetry ?? null);
const hud = () => page.textContent('#hud-telemetry').catch(() => '');
const consoleTail = (n = 8) => page.$$eval('#console-out .log-line', (els, k) => els.slice(-k).map((e) => e.textContent), n);
const shot = (name) => page.screenshot({ path: `shots/qa-${name}.png` });
const report = {};

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// --- 1. Run -> Stop -> Run again ---
await page.click('#btn-run'); await page.waitForTimeout(4000);
const runTel = await tel();
await page.click('#btn-stop'); await page.waitForTimeout(2000);
const stopTel = await tel();
await page.click('#btn-run'); await page.waitForTimeout(4000);
const rerunTel = await tel();
await shot('1-run-stop-rerun');
report.s1 = { runTel, stopTel, rerunTel, hud: await hud(), console: await consoleTail() };
await page.click('#btn-stop'); await page.waitForTimeout(500);
await page.click('#btn-reset'); await page.waitForTimeout(1000);

// --- 2. Syntax error code ---
await page.click('.monaco-editor');
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
await page.keyboard.press('Delete');
await page.keyboard.type('function ( { this is not valid js !!!');
await page.waitForTimeout(300);
await page.click('#btn-run'); await page.waitForTimeout(1500);
await shot('2-syntax-error');
report.s2 = { console: await consoleTail(10), pageErrorsSoFar: errors.slice() };
// restore default code via reload
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(3000);

// --- 3. Huge cmd_vel ---
await page.evaluate(() => window.__oa.graph.topic('/cmd_vel').publish({ linear: { x: 999 }, angular: { z: 999 } }));
await page.waitForTimeout(2500);
const t3 = await tel();
await shot('3-huge-cmdvel');
report.s3 = { tel: t3, hud: await hud() };
await page.evaluate(() => window.__oa.sim.reset()); await page.waitForTimeout(500);

// --- 4. Topics tab while running ---
await page.click('#btn-run'); await page.waitForTimeout(3000);
await page.click('[data-tab="topics"]'); await page.waitForTimeout(1500);
const topicsText = await page.evaluate(() => document.querySelector('#topics-list')?.innerText ?? '');
await shot('4-topics');
report.s4 = { topicsText: topicsText?.slice(0, 1500) };

// --- 5. AI Tutor no API key ---
await page.click('#btn-stop').catch(() => {});
await page.evaluate(() => { for (const k of Object.keys(localStorage)) localStorage.removeItem(k); });
await page.click('[data-tab="tutor"]'); await page.waitForTimeout(500);
await page.fill('#chat-input', 'How do I make the rover turn left?');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(1500);
const tutorText = await page.evaluate(() => document.querySelector('#chat-log')?.innerText ?? '');
await shot('5-tutor-nokey');
report.s5 = { tutorText: tutorText?.slice(0, 1200) };

// --- 6. Reset while running ---
await page.click('#btn-run'); await page.waitForTimeout(5000);
await page.click('#btn-reset'); await page.waitForTimeout(1500);
const t6 = await tel();
const status6 = await page.textContent('#hud-status').catch(() => '');
await shot('6-reset-while-running');
report.s6 = { tel: t6, status: status6, hud: await hud() };

report.pageErrors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
