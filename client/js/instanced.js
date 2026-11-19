// Instanced rendering for the hundreds of floor-loot items and equipment bags.
// One InstancedMesh per loot type (weapon+rarity / consumable / turf) plus one for all glow discs
// and one for all light beams: ~15 draw calls for every visible item instead of ~8 per item.
import * as THREE from 'three';
import { RARITIES } from '/shared/weapons.js';
import { bakedGeometry, propMaterial, createWeaponModel, createConsumable, chestGeometry } from './models.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

function lootGeometry(item) {
  if (item.w) {
    return bakedGeometry(`loot-w${item.w}${item.r || 0}`, () => {
      const g = new THREE.Group(); const w = createWeaponModel(item.w, item.r || 0);
      w.rotation.y = Math.PI / 2; w.scale.setScalar(1.3); g.add(w); return g;
    });
  }
  if (item.c) return bakedGeometry('loot-c' + item.c, () => { const g = new THREE.Group(); g.add(createConsumable(item.c)); return g; });
  return bakedGeometry('loot-mats', () => {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: '#3fa04a' }));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.52), new THREE.MeshLambertMaterial({ color: '#ffffff' })); b.position.y = 0.08;
    g.add(a, b); return g;
  });
}
const lootColor = (item) => (item.w ? RARITIES[item.r || 0].color : item.c ? RARITIES[item.c === 'tape' ? 0 : item.c === 'kit' ? 1 : 2].color : '#b8bcc2');

// A growable InstancedMesh that is refilled every frame with the visible instances only.
class Batch {
  constructor(scene, geo, mat, colors = false) {
    this.scene = scene; this.geo = geo; this.mat = mat; this.colors = colors; this.cap = 0; this.mesh = null; this.n = 0;
  }
  ensure(n) {
    if (n <= this.cap) return;
    const cap = Math.max(16, this.cap * 2, n);
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.frustumCulled = false;   // instances move every frame; we only fill nearby ones
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.scene.add(this.mesh);
    this.cap = cap;
  }
  begin() { this.n = 0; }
  push(m, color) {
    this.ensure(this.n + 1);
    this.mesh.setMatrixAt(this.n, m);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end() {
    if (!this.mesh) return;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colors && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); } }
}

let glowGeo = null, beamGeo = null, chestGlowGeo = null, chestBeamGeo = null;
function sharedGeos() {
  if (glowGeo) return;
  glowGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.04, 20);
  beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 6, 6, 1, true);
  chestGlowGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.04, 20);
  chestBeamGeo = new THREE.CylinderGeometry(0.12, 0.12, 8, 6, 1, true);
}

export class LootRenderer {
  constructor(scene) {
    sharedGeos();
    this.scene = scene;
    this.items = new Map();
    this.types = new Map();
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
    this.glow = new Batch(scene, glowGeo, this.glowMat, true);
    this.beam = new Batch(scene, beamGeo, this.beamMat, true);
  }
  add(id, item, x, y, z) {
    const key = item.w ? `w${item.w}${item.r || 0}` : item.c ? 'c' + item.c : 'm';
    if (!this.types.has(key)) this.types.set(key, new Batch(this.scene, lootGeometry(item), propMaterial));
    this.items.set(id, { key, x, y, z, spin: Math.random() * 6, color: new THREE.Color(lootColor(item)), beam: !!(item.w && item.r >= 2) });
  }
  remove(id) { this.items.delete(id); }
  // Draw items within `dist` (square) of (px, pz), spinning and bobbing.
  update(dt, px, pz, dist) {
    for (const b of this.types.values()) b.begin();
    this.glow.begin(); this.beam.begin();
    for (const it of this.items.values()) {
      if (Math.abs(it.x - px) > dist || Math.abs(it.z - pz) > dist) continue;
      it.spin += dt * 1.5;
      _q.setFromAxisAngle(_up, it.spin);
      _m.compose(_p.set(it.x, it.y + 0.55 + Math.sin(it.spin * 2) * 0.08, it.z), _q, _s);
      this.types.get(it.key).push(_m);
      _m.makeTranslation(it.x, it.y + 0.03, it.z);
      this.glow.push(_m, it.color);
      if (it.beam) { _m.makeTranslation(it.x, it.y + 3, it.z); this.beam.push(_m, it.color); }
    }
    for (const b of this.types.values()) b.end();
    this.glow.end(); this.beam.end();
  }
  dispose() {
    for (const b of this.types.values()) b.dispose();
    this.glow.dispose(); this.beam.dispose();
    this.glowMat.dispose(); this.beamMat.dispose();
  }
}

export class ChestRenderer {
  constructor(scene) {
    sharedGeos();
    this.scene = scene;
    this.chests = new Map();
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false });
    this.bags = new Batch(scene, chestGeometry(), propMaterial);
    this.glow = new Batch(scene, chestGlowGeo, this.glowMat);
    this.beam = new Batch(scene, chestBeamGeo, this.beamMat);
  }
  add(id, x, y, z) { this.chests.set(id, { x, y, z }); }
  remove(id) { this.chests.delete(id); }
  update(px, pz, dist) {
    this.bags.begin(); this.glow.begin(); this.beam.begin();
    for (const c of this.chests.values()) {
      if (Math.abs(c.x - px) > dist || Math.abs(c.z - pz) > dist) continue;
      this.bags.push(_m.makeTranslation(c.x, c.y, c.z));
      this.glow.push(_m.makeTranslation(c.x, c.y + 0.03, c.z));
      this.beam.push(_m.makeTranslation(c.x, c.y + 4, c.z));
    }
    this.bags.end(); this.glow.end(); this.beam.end();
  }
  dispose() { this.bags.dispose(); this.glow.dispose(); this.beam.dispose(); this.glowMat.dispose(); this.beamMat.dispose(); }
}
