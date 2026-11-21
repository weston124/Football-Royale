// Close-up screenshots of outfits (front + back) and emote poses, to check new shop content by eye.
//   PORT=4803 node tools/skinshot.js out.png [ids...]        ids = preset ids (default: the newest Daily batch)
//   PORT=4803 EMOTES=14,15,16 node tools/skinshot.js out.png d_magma   (pose those emotes instead of front/back)
//   DETAIL=lazy: the in-match full-detail model instead of the Locker Room one; COLS=n per row; ZOOM=2.5 close-up of the top row
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'skins.png';
const ids = process.argv.slice(3);
const emotes = (process.env.EMOTES || '').split(',').filter(Boolean).map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
await page.goto(`http://localhost:${Number(process.env.PORT) || 4803}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
const info = await page.evaluate(async ({ ids, emotes, detail, zoom, maxCols }) => {
  const THREE = await import('three');
  const M = await import('/js/models.js');
  const SK = await import('/shared/skins.js');
  const list = ids.length ? ids : SK.SKIN_PRESETS.filter((p) => p.added === SK.NEW_BATCH_DATE).map((p) => p.id);
  const W = 1600, H = 900;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  Object.assign(c.style, { position: 'fixed', left: 0, top: 0, zIndex: 9999 });
  document.body.appendChild(c);
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#3a2a6e');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(2, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.6); rim.position.set(-3, 3, -4); scene.add(rim);
  M.setupEnvironment(r, scene, 0.7);
  const poses = emotes.length ? emotes.map((e) => ({ e })) : [{ y: Math.PI + 0.35 }, { y: 0.5 }];
  const n = list.length * poses.length, cols = Math.min(n, maxCols), rows = Math.ceil(n / cols);
  const viewW = Math.max(cols, rows * 1.1 * W / H), viewH = viewW * H / W;
  const cam = new THREE.OrthographicCamera(-viewW / 2, viewW / 2, viewH, 0, 0.1, 50);
  cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0);
  let i = 0;
  for (const id of list) {
    const p = SK.SKIN_PRESETS.find((x) => x.id === id);
    const skin = SK.sanitizeSkin({ ...p, preset: id, number: 27 });
    for (const pose of poses) {
      const m = M.createPlayer(skin, detail ? { detail } : {});
      if (detail) m.userData.human.setDetail('full');
      const col = i % cols, row = Math.floor(i / cols);
      m.position.set(-cols * 0.5 + 0.5 + col, (viewH + rows * 1.1) / 2 - (row + 1) * 1.1 + 0.12, 0);
      m.scale.setScalar(0.52);
      m.rotation.y = pose.e ? Math.PI + 0.4 : pose.y;
      const E = SK.EMOTES.find((x) => x.id === pose.e);
      M.animatePlayer(m, { speed: 0, phase: 0, hero: !pose.e, emote: pose.e || 0, emoteT: pose.e ? (E.art ?? Math.min(E.dur * 0.55, 1.4)) : 0, t: 1 }, 1 / 60);
      if (m.userData.ball) m.userData.ball.visible = false;
      scene.add(m);
      i++;
    }
  }
  if (zoom) { cam.zoom = zoom; cam.position.y = (viewH + rows * 1.1) / 2 - 1.1 + 0.12 + 0.62 - viewH / 2; cam.updateProjectionMatrix(); }   // ZOOM=2: top rows' heads + chests
  r.render(scene, cam);
  return { list, info: r.info.render };
}, { ids, emotes, detail: process.env.DETAIL || '', zoom: Number(process.env.ZOOM) || 0, maxCols: Number(process.env.COLS) || 6 });
console.log(JSON.stringify(info));
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
