// Screenshots of places in the city from fixed camera spots (and the draw calls there).
//   PORT=4802 node tools/cityshots.js outDir [name ...]      (server must be running)
// Starts a private match, then overrides the game camera right before each render.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 4802;
const OUT = process.argv[2] || '.';
const ONLY = process.argv.slice(3);
export const SHOTS = {
  skyline: [[345, 70, 235], [250, 20, 110]],
  downtown: [[302, 1.7, 152], [235, 25, 100]],
  tailgate: [[290, 28, 345], [290, 0, 255]],
  galleria: [[-80, 22, 222], [-115, 3, 160]],
  huddleshops: [[-115, 5, 203], [-115, 4, 235]],
  fuelstop: [[-196, 7, -207], [-226, 2, -175]],
  academy: [[-260, 34, -20], [-335, 0, -110]],
  splash: [[330, 32, 335], [335, 0, 435]],
  signal: [[395, 18, -220], [448, 35, -318]],
  farm: [[-395, 18, 470], [-445, 4, 418]],
  terrace: [[115, 18, 228], [115, 0, 330]],
  stairs: [[178, 1.7, 158], [184.75, 3.5, 142]],
  roof: [[236, 17.7, 140], [320, 8, 170]],
  pines: [[-60, 25, 320], [-110, 0, 395]],
  garage: [[330, 18, -415], [290, 2, -462]],
  flats: [[-300, 30, 140], [-300, 0, 92]],
  lotclose: [[-130, 2.2, 176], [-100, 0.8, 186]],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.click('#auth-tabs button[data-v=signup]');
const tag = Math.random().toString(36).slice(2, 8);
await page.fill('#a-email', `c${tag}@example.com`);
await page.fill('#a-user', `City${tag}`);
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
await page.evaluate(() => {
  const g = window.__fr.game, r = g.renderer, orig = r.render.bind(r);
  r.render = (scene, cam) => {
    if (cam === g.camera && window.__shot) {
      const [p, t] = window.__shot;
      cam.position.set(p[0], p[1], p[2]); cam.lookAt(t[0], t[1], t[2]); cam.updateMatrixWorld();
    }
    orig(scene, cam);
  };
  for (const id of ['hud', 'minimap']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; }
});
const result = {};
for (const [name, shot] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  await page.evaluate((s) => { window.__shot = s; }, shot);
  await wait(2500);
  result[name] = await page.evaluate(async () => {
    const r = window.__fr.game.renderer;
    await new Promise((res) => requestAnimationFrame(res));
    r.info.autoReset = false; r.info.reset();
    await new Promise((res) => requestAnimationFrame(res));
    const out = { calls: r.info.render.calls, tris: r.info.render.triangles };
    r.info.autoReset = true;
    return out;
  });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
// the big map picture
const png = await page.evaluate(async () => {
  const { drawMapImage } = await import('/js/world.js');
  return drawMapImage(window.__fr.game.map, 1000).toDataURL('image/png');
}).catch((e) => { console.error('map image:', e.message); return null; });
if (png) fs.writeFileSync(`${OUT}/map.png`, Buffer.from(png.split(',')[1], 'base64'));
console.log(JSON.stringify(result));
await browser.close();
process.exit(0);
