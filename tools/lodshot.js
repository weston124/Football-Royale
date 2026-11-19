// Screenshot of the player levels of detail side by side (menu / in-match full / mid / crowd).
//   PORT=4103 node tools/lodshot.js out.png [distance=4]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'lod.png', dist = Number(process.argv[3]) || 4;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 600 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${Number(process.env.PORT) || 4103}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.evaluate(async (dist) => {
  const THREE = await import('three');
  const M = await import('/js/models.js');
  const SK = await import('/shared/skins.js');
  const { PlayerRenderer } = await import('/js/players.js');
  const c = document.createElement('canvas'); c.width = 1200; c.height = 600;
  Object.assign(c.style, { position: 'fixed', left: 0, top: 0, zIndex: 9999 });
  document.body.appendChild(c);
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fd0ff);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4a7a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.0); sun.position.set(3, 5, 4); scene.add(sun);
  M.setupEnvironment(r, scene, 0.5);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshLambertMaterial({ color: '#5aa448' })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const cam = new THREE.PerspectiveCamera(30, 2, 0.1, 100); cam.position.set(0, 1.2, dist); cam.lookAt(0, 1.0, 0);
  const skins = SK.SKIN_PRESETS;
  const xs = [-2.4, -0.8, 0.8, 2.4].map((x) => x * dist / 6);
  // menu model, in-match full, mid
  const kinds = [['full', {}], ['full', { detail: 'lazy', shadow: false }], ['mid', { detail: 'lazy', shadow: false }]];
  kinds.forEach(([lv, o], i) => {
    const m = M.createPlayer({ ...skins[i % skins.length], number: 27 }, o);
    if (o.detail) m.userData.human.setDetail(lv);
    m.position.x = xs[i]; m.rotation.y = Math.PI + 0.4;
    M.animatePlayer(m, { speed: 0, phase: 0, t: 0 }, 0.016);
    scene.add(m);
  });
  // crowd: drive the PlayerRenderer with one entity forced into the crowd level
  const pr = new PlayerRenderer(scene);
  const e = { id: 9, skin: { ...skins[3], number: 27 }, s: { x: xs[3], y: 0, z: 0, yaw: Math.PI + 0.4, ph: 0, w: 0, em: 0 }, dist: 999 };
  pr.update(new Map([[9, e]]), cam, { fullMax: 0, fullDist: 0, midMax: 0, midDist: 0, farDist: 1e9, animEvery: 1 }, 0, 0.016, 0);
  r.render(scene, cam);
}, dist);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
await browser.close();
