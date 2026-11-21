// Plays Party Island in a headless browser and rides a Mega Dome elevator: signs up, starts
// Party Island through the admin API, walks onto an elevator cab and screenshots the ride.
// Checks that the local player goes up with the cab and the server never corrects them.
//   PORT=4801 ADMIN_PASSWORD=... node tools/domeplay.js outdir
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 4801, out = process.argv[2] || '.';
const base = `http://localhost:${PORT}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(base);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.click('#auth-tabs button[data-v=signup]');
const name = 'DOME' + Math.floor(Math.random() * 1e5);
await page.fill('#a-email', `${name.toLowerCase()}@example.com`);
await page.fill('#a-user', name);
await page.fill('#a-pass', 'secret123');
await page.check('#a-age');
await page.click('#a-go');
await page.waitForSelector('#auth.hidden', { state: 'attached', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const r = await fetch(`${base}/admin/api/party`, { method: 'POST', headers: { 'x-admin-key': process.env.ADMIN_PASSWORD, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'island', title: 'Dome test' }) });
console.log('party', r.status, await r.text());
await page.waitForSelector('#party-pop:not(.hidden)', { timeout: 15000 });
await page.$eval('#party-go', (b) => b.click());
await page.waitForFunction(() => window.__fr.game && window.__fr.game.local.phase === 'ground', null, { timeout: 60000 });
await page.waitForTimeout(3000);
console.log('in game');

// the server only accepts sprint-speed moves, so "fly" there in small hops (it doesn't check walls)
async function glide(x, y, z) {
  for (;;) {
    const done = await page.evaluate(([x, y, z]) => {
      const L = window.__fr.game.local;
      const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz), k = Math.min(1, 0.9 / Math.max(d, 1e-6));
      L.x += dx * k; L.z += dz * k; L.y = y; L.vx = L.vy = L.vz = 0; L.onGround = true;
      return d < 0.05;
    }, [x, y, z]);
    if (done) return;
    await page.waitForTimeout(45);
  }
}
const E0 = await page.evaluate(() => window.__fr.game.map.elevators.find((q) => q.x0 > 0 && q.z0 < 0));
const cx = (E0.x0 + E0.x1) / 2, cz = (E0.z0 + E0.z1) / 2;
// walk up to the elevator doors (outside the shaft, on the -x side)
await glide(cx - 4, 0, cz);
await page.evaluate(() => { const g = window.__fr.game; g.yaw = -Math.PI / 2; g.pitch = -0.05; }); // look toward +x
const info = await page.evaluate(async () => {
  const E = await import('/shared/elevators.js');
  const g = window.__fr.game, e = g.map.elevators.find((q) => q.x0 > 0 && q.z0 < 0);
  const st = g.serverNow(), T = E.elevatorPeriod(e);
  let arrive = 0; // seconds until the cab is next resting at the ground
  for (let t = 0; t < T; t += 0.05) if (E.elevatorStop(e, st + t) === 0) { arrive = t; break; }
  return { arrive };
});
console.log('cab at the ground in', info.arrive.toFixed(1), 's');
await page.screenshot({ path: `${out}/elevator-waiting.png` });
await page.waitForTimeout(info.arrive * 1000 + 600);
await page.screenshot({ path: `${out}/elevator-open.png` });
await glide(cx, 0, cz);
await page.evaluate(() => { const g = window.__fr.game; g.yaw = Math.PI / 2; g.pitch = -0.05; }); // face the doors (-x)
const samples = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(700);
  const s = await page.evaluate(async () => {
    const E = await import('/shared/elevators.js');
    const g = window.__fr.game, L = g.local;
    const e = g.map.elevators.find((q) => q.x0 > 0 && q.z0 < 0);
    return { y: +L.y.toFixed(2), x: +L.x.toFixed(2), z: +L.z.toFixed(2), cab: +E.elevatorHeight(e, g.serverNow()).toFixed(2) };
  });
  samples.push(s);
  if (i === 4 || i === 7 || i === 11) await page.screenshot({ path: `${out}/ride-${i}.png` });
}
console.log('ride', JSON.stringify(samples));
// look at the field from the top stop
await page.evaluate(() => { const g = window.__fr.game; g.yaw = Math.PI / 2 + 0.6; g.pitch = -0.15; });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/ride-top.png` });
await browser.close();
