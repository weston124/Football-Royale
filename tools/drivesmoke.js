// Browser smoke test for vehicles: starts a private match, puts the local player in the nearest
// Hatchback (client side only) and drives it around, then reports LOD bands and page errors.
//   PORT=4802 node tools/drivesmoke.js [screenshot.png]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 4802;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.click('#auth-tabs button[data-v=signup]');
const tag = Math.random().toString(36).slice(2, 8);
await page.fill('#a-email', `d${tag}@example.com`);
await page.fill('#a-user', `Drive${tag}`);
await page.fill('#a-pass', 'testing123');
await page.check('#a-age');
await page.click('#a-go');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
await page.click('button[data-tab=rooms]');
await page.click('#create');
await page.waitForSelector('#lobby-start:not(.hidden)', { timeout: 30000 });
await page.click('#lobby-start');
await page.waitForFunction(() => window.__fr && window.__fr.game, null, { timeout: 30000 });
await wait(3000);
const before = await page.evaluate(() => {
  const g = window.__fr.game;
  g.onSnapshot = () => {}; // freeze the network: we drive locally only
  const v = [...g.veh.list.values()].find((x) => x.type === 'hatch' && Math.abs(x.z + 183) < 1);
  const L = g.local;
  Object.assign(L, { phase: 'ground', x: v.x + 2, y: 0, z: v.z, vx: 0, vy: 0, vz: 0, onGround: true });
  g.veh.onEnterExit(['veh', v.id, v.x, 0, v.z, v.yaw]);
  const bands = [0, 0, 0];
  for (const x of g.veh.list.values()) if (x.band >= 0) bands[x.band]++;
  return { id: v.id, bands };
});
for (let i = 0; i < 40; i++) {
  await page.evaluate(() => { const g = window.__fr.game; g.veh.drive({ f: 1, s: 0.4, jump: false }, 0.05); });
  await wait(50);
}
await wait(1500);
const after = await page.evaluate((id) => {
  const g = window.__fr.game, d = g.veh.driving, v = g.veh.list.get(id);
  const bands = [0, 0, 0];
  for (const x of g.veh.list.values()) if (x.band >= 0) bands[x.band]++;
  const inst = [...g.veh.inst.values()].map((m) => m.count).reduce((a, b) => a + b, 0);
  return { driving: !!d, moved: Math.hypot(d.x - v.x, d.z - v.z) < 1 ? 'mesh follows' : 'mesh lags', pos: [d.x.toFixed(1), d.z.toFixed(1)], band: v.band, bands, instanced: inst, total: g.veh.list.size };
}, before.id);
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
console.log(JSON.stringify({ before, after, errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
