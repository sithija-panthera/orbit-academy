// Physics validation: command straight / turn / arc via /cmd_vel and measure response.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

async function drive(v, w, seconds) {
  await page.evaluate(([v, w]) => {
    window.__oa.sim.reset();
    window.__oa.graph.topic('/cmd_vel').publish({ linear: { x: v, y: 0, z: 0 }, angular: { x: 0, y: 0, z: w } });
  }, [v, w]);
  await page.waitForTimeout(seconds * 1000);
  return page.evaluate(() => {
    const t = window.__oa.sim.telemetry;
    return { x: +t.x.toFixed(2), z: +t.z.toFixed(2), yawDeg: +(t.yaw * 180 / Math.PI).toFixed(1), speed: +t.speed.toFixed(2) };
  });
}

console.log('straight 0.8 m/s, 4s (expect x≈+3.2, yaw≈0):', await drive(0.8, 0, 4));
console.log('turn-in-place 1.5 rad/s, 3s (expect yaw≈+250° mod, pos≈0):', await drive(0, 1.5, 3));
console.log('arc v=0.6 w=0.8, 4s (expect curve left, yaw>90):', await drive(0.6, 0.8, 4));
console.log('reverse -0.5, 3s (expect x≈-1.5):', await drive(-0.5, 0, 3));
await browser.close();
