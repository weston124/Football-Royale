// All 3D models are built from simple shapes in code (no downloaded art).
import * as THREE from 'three';
import { RARITIES } from '/shared/weapons.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, color, x = 0, y = 0, z = 0, m) {
  const mesh = new THREE.Mesh(boxGeo, m || mat(color));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------- jersey number texture ----------
function numberTexture(num, jersey, accent) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = jersey; g.fillRect(0, 0, 128, 128);
  g.fillStyle = accent; g.fillRect(0, 0, 128, 14);
  g.font = 'bold 76px Impact, Arial Black, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#ffffff';
  g.strokeText(String(num), 64, 72);
  g.fillStyle = accent; g.fillText(String(num), 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- football player (stylized cartoon person) ----------
const capCache = new Map();
function capsule(r, len, color, y = 0) {
  const key = r + ':' + len;
  if (!capCache.has(key)) capCache.set(key, new THREE.CapsuleGeometry(r, len, 6, 12));
  const m = new THREE.Mesh(capCache.get(key), mat(color));
  m.position.y = y;
  return m;
}
function sphere(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, m) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m || mat(color));
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
  return mesh;
}

// Curved steer horns for Longhorn outfits
function makeHorn(side, color) {
  const g = new THREE.Group();
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.22, 0.02, 0),
    new THREE.Vector3(side * 0.42, 0.06, 0), new THREE.Vector3(side * 0.52, 0.22, -0.04));
  const pts = curve.getPoints(10);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const r1 = 0.055 * (1 - i / pts.length) + 0.008, r2 = 0.055 * (1 - (i + 1) / pts.length) + 0.006;
    const len = a.distanceTo(b);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 8), mat(color));
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(seg);
  }
  return g;
}

export function createPlayer(skin) {
  const root = new THREE.Group();
  const body = new THREE.Group();        // pivot at the hips
  body.position.y = 0.98;
  root.add(body);
  const parts = { body };
  const jersey = skin.jersey, accent = skin.accent, tone = skin.tone || '#c98e62';
  const numTex = numberTexture(skin.number ?? 12, jersey, accent);
  const numMat = new THREE.MeshLambertMaterial({ map: numTex, transparent: true });

  // ---- legs (hip -> knee -> shoe) ----
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.13, -0.02, 0);
    hip.add(capsule(0.115, 0.26, skin.pants, -0.2));
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), mat(accent)); // knee pad stripe
    pad.position.y = -0.36; pad.rotation.x = Math.PI / 2; hip.add(pad);
    const knee = new THREE.Group(); knee.position.y = -0.44;
    knee.add(capsule(0.09, 0.26, accent, -0.18));                  // sock
    const shoe = box(0.17, 0.11, 0.3, '#1c1c1c', 0, -0.43, -0.05);
    knee.add(shoe);
    knee.add(box(0.175, 0.025, 0.2, '#ffffff', 0, -0.41, -0.02));  // shoe stripe
    for (const zz of [-0.14, 0, 0.1]) knee.add(box(0.03, 0.02, 0.02, '#888', side * 0.05, -0.49, zz)); // cleats
    hip.add(knee);
    body.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
    parts[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  }
  // ---- hips & belt ----
  const pelvis = sphere(0.22, skin.pants, 0, 0.02, 0, 1.05, 0.55, 0.75); body.add(pelvis);
  body.add(box(0.44, 0.06, 0.3, accent, 0, 0.1, 0));

  // ---- spine / torso (V-shape hero build) ----
  const spine = new THREE.Group(); spine.position.y = 0.1; body.add(spine); parts.spine = spine;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.21, 0.5, 14), mat(jersey));
  torso.scale.z = 0.68; torso.position.y = 0.27; spine.add(torso);
  for (const zz of [-1, 1]) {           // numbers on front and back
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
    plate.position.set(0, 0.27, zz * 0.185); if (zz > 0) plate.rotation.y = 0; else plate.rotation.y = Math.PI;
    plate.position.z = zz > 0 ? 0.19 : -0.19;
    spine.add(plate);
  }
  spine.add(sphere(0.34, jersey, 0, 0.5, 0, 1.25, 0.42, 0.7));      // shoulder pads
  spine.add(sphere(0.345, accent, 0, 0.53, 0, 1.18, 0.12, 0.66));   // pad stripe
  spine.add(capsule(0.07, 0.06, tone, 0.62));                        // neck

  // ---- head: face + helmet ----
  const head = new THREE.Group(); head.position.y = 0.8; spine.add(head); parts.head = head;
  head.add(sphere(0.165, tone, 0, 0, 0, 1, 1.05, 1));
  const white = mat('#ffffff'), black = mat('#151515');
  for (const sx of [-1, 1]) {
    head.add(sphere(0.034, null, sx * 0.058, 0.02, -0.145, 1, 1.15, 0.6, white));     // eye
    head.add(sphere(0.019, null, sx * 0.058, 0.02, -0.165, 1, 1.1, 0.6, black));      // pupil
    const brow = box(0.06, 0.016, 0.02, '#3a2416', sx * 0.06, 0.07, -0.15); brow.rotation.z = sx * -0.15; head.add(brow); // eyebrow
    head.add(box(0.05, 0.016, 0.02, '#111111', sx * 0.06, -0.025, -0.155));           // eye black
  }
  head.add(sphere(0.026, tone, 0, -0.015, -0.168));                                    // nose
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 12, Math.PI), mat('#6b1f1f'));
  mouth.position.set(0, -0.07, -0.152); mouth.rotation.z = Math.PI; head.add(mouth);   // grin
  // helmet: full dome on top + shell around the back, open in front so you can see the face
  const hm = new THREE.MeshLambertMaterial({ color: skin.helmet, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 10, 0, Math.PI * 2, 0, 1.05), hm);
  dome.position.y = 0.02; dome.scale.z = 1.08; head.add(dome);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 10, -Math.PI * 0.2, Math.PI * 1.4, 1.0, 1.05), hm);
  shell.position.y = 0.02; shell.scale.z = 1.08; head.add(shell);
  head.add(box(0.05, 0.03, 0.44, skin.stripe, 0, 0.225, 0.0));                        // helmet stripe
  for (const sx of [-1, 1]) head.add(sphere(0.045, skin.stripe, sx * 0.2, -0.01, 0.0, 0.4, 1, 1)); // ear holes
  const maskMat = mat(skin.mask);
  for (const [y, r] of [[-0.03, 0.2], [-0.1, 0.19]]) {                                // face mask bars
    const bar = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 16, Math.PI * 0.75), maskMat);
    bar.rotation.x = Math.PI / 2; bar.rotation.z = Math.PI * 0.125 + Math.PI; bar.position.set(0, y, 0.01);
    head.add(bar);
  }
  head.add(box(0.016, 0.1, 0.016, skin.mask, 0, -0.06, -0.2));
  if (skin.horns) { const hl = makeHorn(-1, skin.horns); hl.position.set(-0.17, 0.08, 0); head.add(hl); const hr = makeHorn(1, skin.horns); hr.position.set(0.17, 0.08, 0); head.add(hr); }

  // ---- arms (shoulder -> elbow -> big cartoon glove) ----
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.36, 0.5, 0);
    sh.add(capsule(0.1, 0.08, jersey, -0.06));        // sleeve
    sh.add(capsule(0.072, 0.16, tone, -0.2));         // upper arm
    const elbow = new THREE.Group(); elbow.position.y = -0.31;
    elbow.add(capsule(0.066, 0.14, tone, -0.11));     // forearm
    elbow.add(capsule(0.072, 0.05, '#ffffff', -0.22)); // wrist tape
    elbow.add(sphere(0.085, accent, 0, -0.3, -0.01, 0.9, 1.05, 1.0)); // glove
    elbow.add(sphere(0.035, accent, side * -0.06, -0.27, -0.05));      // thumb
    const hand = new THREE.Group(); hand.position.set(0, -0.3, -0.02); elbow.add(hand);
    sh.add(elbow);
    spine.add(sh);
    parts[side < 0 ? 'armL' : 'armR'] = sh;
    parts[side < 0 ? 'elbowL' : 'elbowR'] = elbow;
    if (side > 0) parts.hand = hand;
  }
  // lasso for the Lasso Spin emote
  const lasso = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.018, 6, 24), mat('#c8a165'));
  lasso.rotation.x = Math.PI / 2; lasso.position.y = -0.05; lasso.visible = false;
  parts.hand.add(lasso); parts.lasso = lasso;

  // ---- parachute (hidden until gliding) ----
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshLambertMaterial({ color: accent, side: THREE.DoubleSide }));
  canopy.scale.y = 0.55; canopy.position.y = 4.4; chute.add(canopy);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(2.62, 16, 8, 0, Math.PI * 2, Math.PI / 4.5, 0.12),
    new THREE.MeshLambertMaterial({ color: jersey, side: THREE.DoubleSide }));
  stripe.scale.y = 0.55; stripe.position.y = 4.4; chute.add(stripe);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(Math.cos(a) * 2.1, 4.6, Math.sin(a) * 2.1)); }
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })));
  chute.visible = false;
  root.add(chute);
  parts.chute = chute;

  root.userData = { parts, walk: 0, held: null, heldCode: -1, numTex, blink: Math.random() * 4 };
  return root;
}

export function disposePlayer(m) {
  m.userData.numTex.dispose();
}

// Put an item model into the player's hand
export function setHeld(model, code) {
  const u = model.userData;
  if (u.heldCode === code) return;
  u.heldCode = code;
  if (u.held) { u.parts.hand.remove(u.held); u.held = null; }
  if (code > 0 && code !== 255) {
    const w = createWeaponModel(WCODES[code >> 3], code & 7);
    w.scale.setScalar(0.85);
    w.rotation.x = -Math.PI / 2;
    u.parts.hand.add(w);
    u.held = w;
  }
}
export const WCODES = ['tackle', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'pigskin', 'whistle'];

const lerp = (a, b, k) => a + (b - a) * k;
const PI = Math.PI;
// Animate a player model. s = { speed, phase, emote, emoteT, pitch, swing, t }
// Angles: arms/legs + = swing forward. Knees - = bend back. Elbows + = bend forward.
export function animatePlayer(model, s, dt) {
  const u = model.userData, p = u.parts;
  const t = s.t || 0;
  p.chute.visible = s.phase === 3;
  p.lasso.visible = s.emote === 7;
  let bx = 0, by = 0, bz = 0, bodyY = 0.98, sx = 0, sy = 0, hx = 0, hy = 0;
  let lL = 0, lR = 0, lLz = 0, lRz = 0, kL = -0.05, kR = -0.05;
  let aL = 0.05, aR = 0.05, aLz = -0.12, aRz = 0.12, eL = 0.25, eR = 0.25;
  const pitch = s.pitch || 0;
  if (s.phase === 2) { // free fall: belly down, arms and legs spread
    bx = -1.35; bodyY = 1.0;
    aL = aR = 0.3; aLz = -1.35; aRz = 1.35; eL = eR = 0.5;
    lLz = -0.3; lRz = 0.3; kL = kR = -0.7;
    hx = 0.9;
    aL += Math.sin(t * 7) * 0.08; aR -= Math.sin(t * 7) * 0.08;
  } else if (s.phase === 3) { // gliding: holding the straps
    aL = aR = PI - 0.35; aLz = -0.3; aRz = 0.3; eL = eR = 0.5;
    lL = Math.sin(t * 2) * 0.15; lR = -lL; kL = kR = -0.25;
  } else if (s.emote) {
    const e = s.emoteT;
    switch (s.emote) {
      case 1: { // Gridiron Shuffle: heel kicks, swinging arms
        const k = Math.sin(e * 9);
        lL = -Math.max(0, k) * 0.35; lR = -Math.max(0, -k) * 0.35;
        kL = -0.1 - Math.max(0, k) * 1.5; kR = -0.1 - Math.max(0, -k) * 1.5;
        aL = k * 0.9; aR = -k * 0.9; eL = eR = 1.3;
        bodyY += Math.abs(Math.cos(e * 9)) * 0.06; sy = Math.sin(e * 4.5) * 0.3; bz = Math.sin(e * 9) * 0.05;
        break;
      }
      case 2: { // Touchdown Spike
        if (e < 0.7) { aR = lerp(0, PI, e / 0.7); eR = 0.4; sx = 0.1; }
        else if (e < 0.9) { aR = lerp(PI, 0.4, (e - 0.7) / 0.2); sx = -0.45; hx = -0.3; }
        else { aL = aR = PI - 0.2; aLz = -0.5; aRz = 0.5; eL = eR = 0.2; bodyY += Math.abs(Math.sin(e * 8)) * 0.18; kL = kR = -0.3; }
        break;
      }
      case 3: { // Victory Dance
        sy = Math.sin(e * 6) * 0.5; bz = Math.sin(e * 6) * 0.12;
        aL = PI - 0.35 + Math.sin(e * 12) * 0.35; aR = PI - 0.35 - Math.sin(e * 12) * 0.35;
        aLz = -0.35; aRz = 0.35; eL = eR = 0.3;
        lL = Math.max(0, Math.sin(e * 6)) * 0.5; lR = Math.max(0, -Math.sin(e * 6)) * 0.5;
        kL = -lL * 1.4; kR = -lR * 1.4;
        bodyY += Math.abs(Math.sin(e * 12)) * 0.06;
        break;
      }
      case 4: { // Helmet Salute
        if (e < 1.1) { aR = 2.0; aRz = -0.2; eR = 2.0; hx = -0.1; }
        else { aR = PI - 0.15; aRz = 0.15; eR = 0; hx = 0.45; }
        break;
      }
      case 5: { // Ref Signals
        const ph = e % 3.2;
        if (ph < 1) { aL = aR = PI; eL = eR = 0; aLz = -0.1; aRz = 0.1; }
        else if (ph < 2) { aL = aR = PI / 2; eL = eR = 0; aLz = Math.sin(ph * 10) * 0.7; aRz = -Math.sin(ph * 10) * 0.7; }
        else { aL = PI / 2 + Math.sin(ph * 14) * 0.35; aR = PI / 2 - Math.sin(ph * 14) * 0.35; eL = eR = 1.4; }
        break;
      }
      case 6: { // Stampede Stomp: knee-high stomps with fists up like horns
        const k = Math.sin(e * 7);
        lL = Math.max(0, k) * 1.2; lR = Math.max(0, -k) * 1.2;
        kL = -Math.max(0, k) * 1.6; kR = -Math.max(0, -k) * 1.6;
        aL = aR = 2.5; aLz = -0.75; aRz = 0.75; eL = eR = 2.3;
        sx = -0.25; hx = -0.25; bodyY += Math.abs(k) * 0.05;
        break;
      }
      case 7: { // Lasso Spin
        aR = PI - 0.25 + Math.sin(e * 8) * 0.2; aRz = 0.3 + Math.cos(e * 8) * 0.2; eR = 0.15;
        aL = 0.15; aLz = -0.75; eL = 1.7;
        p.lasso.rotation.z = e * 10;
        bodyY += Math.abs(Math.sin(e * 8)) * 0.03; sy = Math.sin(e * 4) * 0.15;
        kL = kR = -0.15;
        break;
      }
      case 8: { // Bull Charge: lean in, paw the ground, then burst forward
        const ph = e % 3;
        sx = -0.55; hx = -0.4;
        aL = aR = -0.5; aLz = -0.3; aRz = 0.3; eL = eR = 0.6;
        if (ph < 2) { lR = -0.4 + Math.sin(ph * 9) * 0.45; kR = -0.6; lL = 0.25; kL = -0.35; }
        else { lL = 0.8; kL = -1.0; lR = -0.6; kR = -0.4; sx = -0.8; aL = 0.9; aR = -0.9; }
        break;
      }
    }
  } else {
    // walking / running
    const spd = Math.min(1.4, s.speed / 7);
    u.walk += dt * (3 + s.speed * 1.15);
    const w = u.walk, sw = Math.sin(w);
    lL = sw * 0.75 * spd; lR = -sw * 0.75 * spd;
    kL = -(0.08 + Math.max(0, -Math.sin(w + 0.9)) * 1.3 * spd);
    kR = -(0.08 + Math.max(0, Math.sin(w + 0.9)) * 1.3 * spd);
    aL = -sw * 0.7 * spd; aR = sw * 0.7 * spd; eL = eR = 0.3 + 0.9 * spd;
    bodyY += Math.abs(Math.cos(w)) * 0.05 * spd;
    sx = -0.12 * spd; sy = sw * 0.08 * spd;
    if (spd < 0.05) { // idle breathing
      bodyY += Math.sin(t * 2) * 0.006; aLz = -0.14 + Math.sin(t * 2) * 0.02; aRz = -aLz;
    }
    if (u.held) { // aim the weapon with both hands
      aR = PI / 2 - 0.15 + pitch * 0.9; aRz = 0.05; eR = 0.25;
      aL = PI / 2 - 0.05 + pitch * 0.9; aLz = 0.55; eL = 0.7;
      sy = 0;
    }
    if (s.swing > 0) { aR = lerp(PI / 2, 2.4, s.swing); eR = 0.1; sx = -0.2 * s.swing; } // tackle shove
    hx = pitch * 0.5;
  }
  p.body.position.y = bodyY;
  p.body.rotation.set(bx, by, bz);
  p.spine.rotation.set(sx, sy, 0);
  p.head.rotation.set(hx, hy, 0);
  p.legL.rotation.set(lL, 0, lLz); p.legR.rotation.set(lR, 0, lRz);
  p.kneeL.rotation.x = kL; p.kneeR.rotation.x = kR;
  p.armL.rotation.set(aL, 0, aLz); p.armR.rotation.set(aR, 0, aRz);
  p.elbowL.rotation.x = eL; p.elbowR.rotation.x = eR;
}

// ---------- weapons ----------
export function createWeaponModel(wid, rarity = 0) {
  const g = new THREE.Group();
  const rc = RARITIES[rarity].color;
  const dark = '#2b2f36', mid = '#4a505a';
  switch (wid) {
    case 'pistol':
      g.add(box(0.07, 0.1, 0.32, dark, 0, 0.03, -0.08));
      g.add(box(0.06, 0.16, 0.08, mid, 0, -0.08, 0.03));
      g.add(box(0.075, 0.02, 0.2, rc, 0, 0.09, -0.08));
      break;
    case 'smg':
      g.add(box(0.08, 0.12, 0.45, dark, 0, 0.02, -0.12));
      g.add(box(0.06, 0.18, 0.07, mid, 0, -0.1, 0.02));
      g.add(box(0.05, 0.2, 0.06, mid, 0, -0.1, -0.16));
      g.add(box(0.085, 0.03, 0.3, rc, 0, 0.09, -0.12));
      break;
    case 'rifle':
      g.add(box(0.08, 0.12, 0.75, dark, 0, 0.02, -0.2));
      g.add(box(0.07, 0.14, 0.22, mid, 0, -0.01, 0.25));
      g.add(box(0.06, 0.18, 0.07, mid, 0, -0.1, 0.02));
      g.add(box(0.06, 0.2, 0.08, '#333', 0, -0.12, -0.15));
      g.add(box(0.03, 0.03, 0.25, '#222', 0, 0.04, -0.68));
      g.add(box(0.085, 0.03, 0.5, rc, 0, 0.1, -0.2));
      break;
    case 'shotgun':
      g.add(box(0.1, 0.1, 0.8, '#5a3a22', 0, 0.0, -0.15));
      g.add(box(0.06, 0.06, 0.6, dark, 0, 0.08, -0.32));
      g.add(box(0.09, 0.07, 0.2, rc, 0, -0.04, -0.4));
      g.add(box(0.07, 0.16, 0.08, '#5a3a22', 0, -0.1, 0.1));
      break;
    case 'sniper':
      g.add(box(0.08, 0.1, 1.1, dark, 0, 0.02, -0.3));
      g.add(box(0.08, 0.14, 0.3, mid, 0, -0.01, 0.3));
      g.add(box(0.06, 0.16, 0.07, mid, 0, -0.1, 0.05));
      { const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.35, 10), mat('#111')); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.13, -0.15); g.add(sc); }
      g.add(box(0.085, 0.03, 0.6, rc, 0, 0.075, -0.4));
      break;
    case 'pigskin': {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.8, 12), mat('#2f6b3a'));
      tube.rotation.x = Math.PI / 2; tube.position.z = -0.2; g.add(tube);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), mat(rc));
      ring.position.z = -0.6; g.add(ring);
      const ball = createFootball(0.24); ball.position.z = -0.62; g.add(ball);
      g.add(box(0.06, 0.18, 0.08, '#333', 0, -0.15, 0.05));
      break;
    }
    case 'whistle': {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat('#d8d8d8', { emissive: 0x222222 }));
      g.add(s);
      g.add(box(0.08, 0.08, 0.16, '#d8d8d8', 0, 0.02, -0.1));
      g.add(box(0.02, 0.2, 0.02, rc, 0, 0.12, 0.05));
      break;
    }
    case 'tackle':
    default:
      break;
  }
  return g;
}

export function createFootball(len = 0.3) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(len / 2, 14, 10), mat('#8b4513'));
  ball.scale.set(0.62, 0.62, 1);
  g.add(ball);
  g.add(box(0.02, 0.01, len * 0.45, '#ffffff', 0, len * 0.31, 0));
  for (let i = -2; i <= 2; i++) g.add(box(0.06, 0.012, 0.012, '#ffffff', 0, len * 0.31, i * len * 0.07));
  return g;
}

export function createConsumable(cid) {
  const g = new THREE.Group();
  if (cid === 'tape') {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.07, 8, 16), mat('#f2f2f2'));
    g.add(t);
  } else if (cid === 'kit') {
    g.add(box(0.5, 0.32, 0.22, '#e03030'));
    g.add(box(0.26, 0.07, 0.24, '#ffffff', 0, 0, 0));
    g.add(box(0.07, 0.24, 0.24, '#ffffff', 0, 0, 0));
  } else {
    g.add(box(0.36, 0.44, 0.12, '#2a7bd6'));
    g.add(box(0.28, 0.08, 0.14, '#7cc4ff', 0, 0.08, 0));
  }
  return g;
}

export function createLootModel(item) {
  const g = new THREE.Group();
  let inner, color = '#b8bcc2';
  if (item.w) { inner = createWeaponModel(item.w, item.r); color = RARITIES[item.r || 0].color; inner.rotation.y = Math.PI / 2; inner.scale.setScalar(1.3); }
  else if (item.c) { inner = createConsumable(item.c); color = RARITIES[item.c === 'tape' ? 0 : item.c === 'kit' ? 1 : 2].color; }
  else { inner = new THREE.Group(); inner.add(box(0.5, 0.3, 0.5, '#3fa04a')); inner.add(box(0.52, 0.04, 0.52, '#ffffff', 0, 0.08, 0)); }
  inner.position.y = 0.55;
  g.add(inner);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  glow.position.y = 0.03;
  g.add(glow);
  if (item.w && item.r >= 2) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    beam.position.y = 3;
    g.add(beam);
  }
  g.userData.inner = inner;
  return g;
}

// Equipment bag (chest)
export function createChest() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.3, 14), mat('#d9a21b', { emissive: 0x3a2a00 }));
  bag.rotation.z = Math.PI / 2;
  bag.position.y = 0.42;
  g.add(bag);
  g.add(box(1.32, 0.12, 0.2, '#ffffff', 0, 0.42, 0));
  g.add(box(0.1, 0.4, 0.1, '#333', -0.3, 0.95, 0));
  g.add(box(0.1, 0.4, 0.1, '#333', 0.3, 0.95, 0));
  g.add(box(0.7, 0.08, 0.1, '#333', 0, 1.15, 0));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.04, 20), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5 }));
  glow.position.y = 0.03;
  g.add(glow);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false }));
  beam.position.y = 4;
  g.add(beam);
  return g;
}

// The Team Blimp
export function createBlimp() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), mat('#f5f5f5'));
  hull.scale.set(1, 1, 2.6);
  g.add(hull);
  const band = new THREE.Mesh(new THREE.SphereGeometry(10.05, 24, 4, 0, Math.PI * 2, Math.PI / 2 - 0.15, 0.3), mat('#ff5a2a'));
  band.scale.set(1, 1, 2.6);
  g.add(band);
  for (const [x, y, r] of [[0, 9, 0], [0, -9, 0], [9, 0, Math.PI / 2], [-9, 0, Math.PI / 2]]) {
    const fin = box(0.6, 7, 6, '#ffcc33', x * 0.6, y * 0.6, 24);
    fin.rotation.z = r;
    g.add(fin);
  }
  g.add(box(5, 3, 12, '#2a3c6a', 0, -11, 0));
  // banner
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ff5a2a'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#fff'; x.font = 'bold italic 64px Impact, Arial Black'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('FOOTBALL ROYALE', 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), new THREE.MeshBasicMaterial({ map: tex }));
    pl.position.set(s * 10.2, 0, 0);
    pl.rotation.y = s * Math.PI / 2;
    g.add(pl);
  }
  return g;
}

// Turf texture for build pieces
let turfTex = null;
export function turfMaterial(opacity = 1, color = 0xffffff) {
  if (!turfTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#3c9a3c'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 300; i++) { x.fillStyle = Math.random() < 0.5 ? '#45a845' : '#348a34'; x.fillRect(Math.random() * 64, Math.random() * 64, 2, 3); }
    x.strokeStyle = '#ffffff'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 61, 61);
    turfTex = new THREE.CanvasTexture(c); turfTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshLambertMaterial({ map: turfTex, transparent: opacity < 1, opacity, color });
}
