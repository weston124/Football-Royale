// Draws the other players with levels of detail:
//   full  - the realistic skinned model (~8 draw calls), only for the closest few (quality.fullMax)
//   mid   - decimated skinned body + simple helmet, 1 draw call, animated at a reduced rate
//   crowd - one InstancedMesh (static pose, colored per player) for everyone far away: 1 draw call total
// Players outside the camera view are skipped entirely (no animation, no draw), and models that have
// not been needed for a while are freed. Blob shadows for nearby players are one InstancedMesh.
import * as THREE from 'three';
import { createPlayer, animatePlayer, setHeld, disposePlayer, blobShadowParts } from './models.js';
import { crowdGeometry } from './human.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);
const _sphere = new THREE.Sphere();
const FREE_AFTER = 20;   // seconds a model may stay unused before its buffers are freed

function crowdMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float part;\nattribute vec3 iJersey;\nattribute vec3 iPants;\nattribute vec3 iSkin;\nattribute vec3 iHelmet;\nvarying vec3 vCrowd;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrowd = part < 0.5 ? iJersey : part < 1.5 ? iPants : part < 2.5 ? iSkin : part < 3.5 ? iHelmet : vec3(0.9);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowd;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vCrowd;');
  };
  m.customProgramCacheKey = () => 'fr-crowd';
  return m;
}

// All far-away players of one body type in a single instanced draw call.
class Crowd {
  constructor(scene, body, mat) {
    this.scene = scene; this.base = crowdGeometry(body); this.mat = mat; this.cap = 0; this.mesh = null; this.n = 0;
  }
  ensure(n) {
    if (n <= this.cap) return;
    const cap = Math.max(32, this.cap * 2, n);
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.geo.dispose(); }
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(this.base.attributes)) g.setAttribute(k, a);
    g.setIndex(this.base.index);
    this.cols = {};
    for (const k of ['iJersey', 'iPants', 'iSkin', 'iHelmet']) {
      this.cols[k] = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, this.cols[k]);
    }
    this.geo = g;
    this.mesh = new THREE.InstancedMesh(g, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
    this.cap = cap;
  }
  begin() { this.n = 0; }
  push(s, cols) {
    this.ensure(this.n + 1);
    _q.setFromAxisAngle(_up, s.yaw);
    if (s.ph === 2) { // free fall: lying belly down, pivot at the hips
      _m.compose(_p.set(s.x, s.y + 1, s.z), _q, _one);
      _m.multiply(_m2.makeRotationAxis(_x, -1.35)).multiply(_m2.makeTranslation(0, -1, 0));
    } else _m.compose(_p.set(s.x, s.y, s.z), _q, _one);
    this.mesh.setMatrixAt(this.n, _m);
    const i = this.n * 3;
    for (const [k, c] of [['iJersey', cols[0]], ['iPants', cols[1]], ['iSkin', cols[2]], ['iHelmet', cols[3]]]) {
      const a = this.cols[k].array; a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b;
    }
    this.n++;
  }
  end() {
    if (!this.mesh) return;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(this.cols)) a.needsUpdate = true;
  }
  dispose() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.geo.dispose(); } }
}

export class PlayerRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'players'; scene.add(this.group);
    this.crowdMat = crowdMaterial();
    this.crowds = { m: new Crowd(scene, 'm', this.crowdMat), f: new Crowd(scene, 'f', this.crowdMat) };
    const sh = blobShadowParts();
    this.shadows = new THREE.InstancedMesh(sh.geo, sh.mat, 64);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1; this.shadows.count = 0;
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.shadows);
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4();
    this.frame = 0;
    this.stats = { full: 0, mid: 0, crowd: 0, hidden: 0, models: 0 };
  }

  // ents: Map of entities with e.s (interpolated state for this frame), e.dist, e.skin.
  // P: quality preset (players.fullMax, fullDist, midMax, midDist, farDist, animEvery).
  update(ents, camera, P, t, dt, focusId) {
    this.frame++;
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const vis = [];
    for (const e of ents.values()) {
      const s = e.s;
      e.want = 'none';
      if (!s || s.ph === 4 || e.inVehicle) continue; // drivers show as part of their vehicle
      // speed for the run cycle, measured on what we draw
      const prev = e.last || s;
      e.spd = Math.min(12, Math.hypot(s.x - prev.x, s.z - prev.z) / Math.max(dt, 0.001));
      e.last = { x: s.x, z: s.z };
      if (s.em && s.em !== e.em) e.emStart = t;
      e.em = s.em;
      e.swing = Math.max(0, (e.swing || 0) - dt * 4);
      if (e.dist > P.farDist && e.id !== focusId) continue;
      const glide = s.ph === 3;
      _sphere.center.set(s.x, s.y + (glide ? 3 : 0.95), s.z); _sphere.radius = glide ? 5 : 1.5;
      if (!this.frustum.intersectsSphere(_sphere)) continue;
      vis.push(e);
    }
    vis.sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : a.dist - b.dist));
    let full = 0, mid = 0, crowd = 0;
    for (const e of vis) {
      const hy = (lv) => (e.level === lv ? 1.12 : 1);   // hysteresis so players don't flicker between levels
      if (e.id === focusId || (full < P.fullMax && e.dist < P.fullDist * hy('full'))) { e.want = 'full'; full++; }
      else if (mid < P.midMax && (e.dist < P.midDist * hy('mid') || (e.s.ph === 3 && e.dist < P.midDist * 2))) { e.want = 'mid'; mid++; }
      else if (e.s.ph !== 3) { e.want = 'crowd'; crowd++; }
    }
    // apply
    for (const c of Object.values(this.crowds)) c.begin();
    let ns = 0, models = 0, built = 0;
    for (const e of ents.values()) {
      let lv = e.want;
      // build at most 3 new models (or new detail levels) per frame so turning around never hitches;
      // the rest show as crowd for a frame or two
      if ((lv === 'full' || lv === 'mid') && (!e.model || e.level !== lv) && e.id !== focusId && built >= 3) lv = e.s && e.s.ph !== 3 ? 'crowd' : 'none';
      if ((lv === 'full' || lv === 'mid') && (!e.model || e.level !== lv)) built++;
      if (lv === 'full' || lv === 'mid') {
        if (!e.model) e.model = createPlayer(e.skin, { detail: 'lazy', shadow: false });
        const u = e.model.userData;
        if (!e.model.parent) this.group.add(e.model);
        if (e.level !== lv) { u.human?.setDetail(lv); e.animAcc = 1; }
        e.unusedFor = 0;
        const s = e.s;
        e.model.position.set(s.x, s.y, s.z);
        e.model.rotation.y = s.yaw;
        // far-ish players animate at a lower rate (staggered), close ones every frame
        e.animAcc = (e.animAcc || 0) + dt;
        if (lv === 'full' || (this.frame + e.id) % P.animEvery === 0) {
          setHeld(e.model, s.ph === 0 && !s.em ? s.w : 0);
          if (u.held) u.held.visible = lv === 'full';
          animatePlayer(e.model, { speed: e.spd, phase: s.ph, emote: s.em, emoteT: t - (e.emStart || 0), pitch: s.pitch, swing: e.swing, t }, e.animAcc);
          e.animAcc = 0;
        }
        if ((s.ph === 0 || !s.ph) && ns < 64) this.shadows.setMatrixAt(ns++, _m.makeTranslation(s.x, s.y + 0.03, s.z));
      } else {
        if (e.model && e.model.parent) this.group.remove(e.model);
        if (e.model) {
          e.unusedFor = (e.unusedFor || 0) + dt;
          if (e.unusedFor > FREE_AFTER) this.release(e);
        }
        if (lv === 'crowd') {
          if (!e.crowdCols) {
            const k = e.skin || {};
            e.crowdCols = [new THREE.Color(k.jersey || '#c03030'), new THREE.Color(k.pants || '#eeeeee'), new THREE.Color(k.tone || '#c98e62'), new THREE.Color(k.helmet || '#c03030')];
          }
          (e.skin && e.skin.body === 'f' ? this.crowds.f : this.crowds.m).push(e.s, e.crowdCols);
        }
      }
      if (e.model) models++;
      e.level = lv;
    }
    for (const c of Object.values(this.crowds)) c.end();
    this.shadows.count = ns;
    this.shadows.instanceMatrix.needsUpdate = true;
    Object.assign(this.stats, { full, mid, crowd, hidden: ents.size - full - mid - crowd, models });
  }

  // Free one entity's model (its color buffers and bone texture; shared geometry stays).
  release(e) {
    if (!e.model) return;
    if (e.model.parent) this.group.remove(e.model);
    disposePlayer(e.model);
    e.model = null; e.level = 'none';
  }
  dispose() {
    for (const c of Object.values(this.crowds)) c.dispose();
    this.scene.remove(this.shadows); this.shadows.dispose();
    this.scene.remove(this.group);
    this.crowdMat.dispose();
  }
}
