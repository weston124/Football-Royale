// Rendering cost meter (software GL is slow, so we look at draw calls / triangles / GPU memory, not fps).
// Starts a private match full of bots in headless Chromium, jumps, lands, then spectates the bot with the
// most players around it (worst case) and reads renderer.info. Also stress-tests spawning/despawning.
//   PORT=4103 node tools/rendermeter.js [quality]        (server must be running)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 4103;
const QUALITY = process.argv[2] || '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
if (QUALITY) await page.addInitScript((q) => localStorage.setItem('fr_quality', q), QUALITY);
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
await page.click('#auth-tabs button[data-v=signup]');
const tag = Math.random().toString(36).slice(2, 8);
await page.fill('#a-email', `r${tag}@example.com`);
await page.fill('#a-user', `Render${tag}`);
await page.fill('#a-pass', 'testing123');
await page.check('#a-age');
await page.click('#a-go');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
await page.click('button[data-tab=rooms]');
await page.click('#create');
await page.waitForSelector('#lobby-start:not(.hidden)', { timeout: 30000 });
await page.click('#lobby-start');
await page.waitForFunction(() => window.__fr && window.__fr.game, null, { timeout: 30000 });
await wait(3500);
await page.keyboard.press('Space');
// wait until landed (or 70 s)
const t0 = Date.now();
while (Date.now() - t0 < 70000) {
  const ph = await page.evaluate(() => window.__fr.game.local.phase);
  if (ph === 'ground') break;
  await wait(1000);
}
await wait(4000);
const info = () => page.evaluate(async () => {
  const g = window.__fr.game, r = g.renderer;
  // count everything drawn in whole frames (world + first-person view model), averaged per frame
  await new Promise((res) => requestAnimationFrame(res));
  r.info.autoReset = false; r.info.reset();
  const f0 = g.frame;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
  const frames = Math.max(1, g.frame - f0);
  const i = r.info;
  const calls = Math.round(i.render.calls / frames), triangles = Math.round(i.render.triangles / frames);
  r.info.autoReset = true;
  return {
    calls, triangles, players: g.players ? { ...g.players.stats } : null, geometries: i.memory.geometries, textures: i.memory.textures,
    programs: i.programs ? i.programs.length : 0, ents: g.ents.size,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    sceneObjects: (() => { let n = 0; g.scene.traverse(() => n++); return n; })(),
    quality: window.__fr.quality ? window.__fr.quality.info() : null,
  };
});
const own = await info();
// Synthetic worst case: freeze the network and surround the player with all 74 other players
// (10 within 15 m, 20 at 15-40 m, 20 at 40-120 m, 24 at 120-400 m), using the real roster skins.
const placed = await page.evaluate(() => {
  const g = window.__fr.game;
  g.onSnapshot = () => {};
  for (const id of [...g.ents.keys()]) g.removeEnt(id);
  const ids = [...g.roster.keys()].filter((id) => id !== g.myId).slice(0, 74);
  const L = g.local;
  L.phase = 'ground'; L.y = 0; L.vx = L.vy = L.vz = 0;   // stand on the ground (the server can no longer correct us)
  const rings = [[10, 3, 15], [20, 15, 40], [20, 40, 120], [24, 120, 400]];
  let k = 0;
  for (const [n, r0, r1] of rings) {
    for (let i = 0; i < n && k < ids.length; i++, k++) {
      const a = (i / n) * Math.PI * 2 + k, r = r0 + (((i * 7919) % 97) / 97) * (r1 - r0);
      const s = { t: 0, x: L.x + Math.cos(a) * r, y: L.y, z: L.z + Math.sin(a) * r, yaw: a, pitch: 0, ph: 0, w: (k % 6) * 8 + 9, em: 0, fl: 0, every: 1 };
      g.ents.set(ids[k], { id: ids[k], buf: [s], model: null, lod: null, em: 0, emStart: 0, swing: 0, every: 1, delay: 0 });
    }
  }
  return k;
});
await wait(4000);
const crowd = await info();
if (process.env.SHOT) {
  // look along a line of players at 3..60 m
  await page.evaluate(() => {
    const g = window.__fr.game, L = g.local;
    g.yaw = 0; g.pitch = -0.05;
    const ids = [...g.ents.keys()].slice(0, 8);
    ids.forEach((id, i) => { const e = g.ents.get(id); e.buf = [{ ...e.buf[0], x: L.x + (i % 2 ? 1.2 : -1.2) * (1 + i * 0.4), z: L.z - 3 - i * i * 1.0, yaw: Math.PI, w: 0 }]; });
  });
  await wait(3000);
  await page.screenshot({ path: process.env.SHOT + '-line.png' });
}
crowd.placed = placed;
// spawn/despawn stress: remove every remote player and add them back, 5 times
const stress = await page.evaluate(async () => {
  const g = window.__fr.game, r = g.renderer;
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const snap = () => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures });
  await frame();
  const before = snap();
  const cycles = [];
  for (let k = 0; k < 5; k++) {
    const saved = [...g.ents.values()].map((e) => ({ id: e.id, buf: e.buf, em: 0, emStart: 0, swing: 0, every: 1, delay: 0, model: null, lod: null }));
    for (const e of saved) g.removeEnt(e.id);
    await frame();
    for (const e of saved) g.ents.set(e.id, e);
    await new Promise((res) => setTimeout(res, 1500));
    await frame();
    cycles.push(snap());
  }
  return { before, cycles, after: snap() };
});
console.log(JSON.stringify({ own, crowd, stress }, null, 1));
await browser.close();
process.exit(0);
