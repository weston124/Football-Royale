// Triangles per level of detail for a few outfits (server must be running).
//   PORT=4103 node tools/lodstats.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`http://localhost:${Number(process.env.PORT) || 4103}/`);
await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
const r = await page.evaluate(async () => {
  const H = await import('/js/human.js');
  const SK = await import('/shared/skins.js');
  const tri = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  const out = {};
  for (const preset of SK.SKIN_PRESETS.slice(0, 6)) {
    const row = {};
    for (const detail of ['full', 'game']) {
      const h = H.createHuman({ ...preset, number: 23 }, detail === 'game' ? { detail: 'lazy' } : {});
      if (detail === 'game') h.setDetail('full');
      let n = 0, calls = 0;
      h.mesh.traverse((m) => { if (m.isMesh && m.visible) { n += tri(m); calls += Array.isArray(m.material) ? m.geometry.groups.length : 1; } });
      row[detail] = { tris: n, calls };
      h.setDetail('mid');
      let mid = 0; h.mesh.traverse((m) => { if (m.isMesh && m.visible) mid += tri(m); });
      row.mid = mid;
      h.dispose();
    }
    out[preset.id] = row;
  }
  const c = H.crowdGeometry('m');
  out.crowd = c.index ? c.index.count / 3 : c.attributes.position.count / 3;
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
