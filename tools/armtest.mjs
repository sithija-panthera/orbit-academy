import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://localhost:5199/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__oa.loadLesson('arm-1'));
await page.waitForTimeout(1500);

async function setJoints(yaw, sh, el, secs = 2.5) {
  await page.evaluate(([yaw, sh, el]) => {
    window.__oa.sim.jointTargets = [yaw, sh, el];
  }, [yaw, sh, el]);
  await page.waitForTimeout(secs * 1000);
  return page.evaluate(() => {
    const s = window.__oa.sim;
    const a = s._jointAngles().map((x) => +x.toFixed(3));
    const t = s.telemetry;
    return { angles: a, ee: { x: +t.x.toFixed(3), y: +t.alt.toFixed(3), z: +t.z.toFixed(3) } };
  });
}

console.log('zero pose      :', await setJoints(0, 0, 0));
console.log('shoulder +0.76 :', await setJoints(0, 0.763, 0));
console.log('elbow -1.74    :', await setJoints(0, 0.763, -1.737));
console.log('elbow +1.0     :', await setJoints(0, 0.763, 1.0));
await page.screenshot({ path: 'shots/armdebug.png' });
await browser.close();
