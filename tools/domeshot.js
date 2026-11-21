// Screenshots of the Mega Dome from fixed camera spots (no match needed): builds the city
// with client/js/world.js in a headless browser and renders each view.
//   PORT=4801 node tools/domeshot.js outdir [view ...]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || '.';
const only = process.argv.slice(3);
// [name, camera x,y,z, look-at x,y,z, fov, elevator time]
const VIEWS = [
  ['exterior', 205, 70, 175, 0, 25, 0, 50, 0],
  ['aerial', 0, 260, 150, 0, 0, 0, 55, 0],
  ['bowl', -40, 16, 54, 10, 30, -10, 75, 0],
  ['bowl-field', 30, 2, 20, 0, 34, -10, 80, 0],
  ['suites', -12, 2.5, 14, 14, 10.5, 58, 70, 0],
  ['overview', -30, 21.5, 70, 10, 12, 0, 75, 0],
  ['suite-inside', 2, L(7.2), 57.6, 3, 8.4, 30, 80, 0],
  ['concourse', -20, 1.7, 61, 60, 1.6, 61, 75, 0],
  ['concourse-upper', -30, 12.9, 66, 40, 13, 66, 75, 0],
  ['stairs', 50, 2.5, 60, 68, 5, 69, 75, 0],
  ['elevator', 84, 1.7, 56, 91, 3, 62, 70, 1],
  ['elevator-up', 84, 1.7, 56, 91, 8, 62, 70, 12],
  ['gate', 0, 3, 95, 0, 6, 70, 70, 0],
  ['snack', -6, 2, 63, -14, 3.2, 53, 70, 0],
];
function L(y) { return y + 1.6; }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${Number(process.env.PORT) || 4801}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.evaluate(async () => {
  const THREE = await import('three');
  const { buildWorld } = await import('/js/world.js');
  const { generateMap } = await import('/shared/map.js');
  const M = await import('/js/models.js');
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  Object.assign(c.style, { position: 'fixed', left: 0, top: 0, zIndex: 9999 });
  document.body.appendChild(c);
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const map = generateMap();
  const w = buildWorld(scene, map);
  w.storm.visible = false;
  M.setupEnvironment(r, scene, 0.5);
  const cam = new THREE.PerspectiveCamera(70, 1280 / 720, 0.1, 2000);
  window.__shot = (v) => {
    cam.fov = v[7]; cam.updateProjectionMatrix();
    cam.position.set(v[1], v[2], v[3]); cam.lookAt(v[4], v[5], v[6]);
    w.stadium.update(v[8], 0.016, { alive: 42, kind: 'normal', clock: '3:27' });
    r.render(scene, cam);
    return [r.info.render.calls, r.info.render.triangles];
  };
});
for (const v of VIEWS) {
  if (only.length && !only.includes(v[0])) continue;
  const calls = await page.evaluate((v) => window.__shot(v), v);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/dome-${v[0]}.png` });
  console.log(v[0], 'draw calls', calls);
}
await browser.close();
