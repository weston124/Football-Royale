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

// ---------- football player ----------
export function createPlayer(skin) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts when falling
  root.add(body);
  const parts = {};
  const jersey = skin.jersey, accent = skin.accent;
  const numTex = numberTexture(skin.number ?? 12, jersey, accent);
  const numMat = new THREE.MeshLambertMaterial({ map: numTex });
  const jMat = mat(jersey);

  // legs
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.15, 0.9, 0);
    hip.add(box(0.24, 0.5, 0.26, skin.pants, 0, -0.25, 0));
    hip.add(box(0.2, 0.36, 0.22, accent, 0, -0.66, 0));
    hip.add(box(0.22, 0.1, 0.34, '#1a1a1a', 0, -0.86, -0.05));
    body.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
  }
  // torso with numbers front & back
  const torso = new THREE.Mesh(boxGeo, [jMat, jMat, jMat, jMat, numMat, numMat]);
  torso.scale.set(0.62, 0.6, 0.36);
  torso.position.y = 1.2;
  body.add(torso);
  body.add(box(0.86, 0.16, 0.46, jersey, 0, 1.48, 0)); // shoulder pads
  body.add(box(0.88, 0.04, 0.48, accent, 0, 1.56, 0));
  body.add(box(0.64, 0.08, 0.38, accent, 0, 0.93, 0)); // belt
  // arms
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(side * 0.43, 1.45, 0);
    sh.add(box(0.2, 0.34, 0.22, jersey, 0, -0.15, 0));
    sh.add(box(0.16, 0.3, 0.18, '#c68e62', 0, -0.45, 0));
    sh.add(box(0.18, 0.12, 0.2, accent, 0, -0.64, 0)); // glove
    body.add(sh);
    parts[side < 0 ? 'armL' : 'armR'] = sh;
  }
  // helmet
  const head = new THREE.Group();
  head.position.y = 1.72;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), mat(skin.helmet));
  helmet.scale.set(1, 1.02, 1.12);
  head.add(helmet);
  head.add(box(0.06, 0.06, 0.52, skin.stripe, 0, 0.23, 0.02));
  head.add(box(0.3, 0.14, 0.05, '#2a1a10', 0, -0.03, -0.24)); // face shadow
  for (const y of [-0.02, -0.1]) head.add(box(0.36, 0.03, 0.03, skin.mask, 0, y, -0.29));
  head.add(box(0.03, 0.14, 0.03, skin.mask, 0, -0.06, -0.3));
  head.add(box(0.03, 0.1, 0.1, skin.mask, 0.18, -0.06, -0.24));
  head.add(box(0.03, 0.1, 0.1, skin.mask, -0.18, -0.06, -0.24));
  body.add(head);
  parts.head = head;

  // held item slot in the right hand
  const hand = new THREE.Group();
  hand.position.set(0, -0.62, -0.1);
  parts.armR.add(hand);
  parts.hand = hand;

  // parachute (hidden until gliding)
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshLambertMaterial({ color: accent, side: THREE.DoubleSide }));
  canopy.scale.y = 0.55;
  canopy.position.y = 4.4;
  chute.add(canopy);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(2.62, 16, 8, 0, Math.PI * 2, Math.PI / 4.5, 0.12),
    new THREE.MeshLambertMaterial({ color: jersey, side: THREE.DoubleSide }));
  stripe.scale.y = 0.55; stripe.position.y = 4.4;
  chute.add(stripe);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(Math.cos(a) * 2.1, 4.6, Math.sin(a) * 2.1));
  }
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  chute.visible = false;
  root.add(chute);
  parts.chute = chute;
  parts.body = body;

  root.userData = { parts, walk: 0, held: null, heldCode: -1, numTex, emoteT: 0, emote: 0 };
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
    const wid = WCODES[code >> 3];
    const w = createWeaponModel(wid, code & 7);
    w.scale.setScalar(0.8);
    w.rotation.x = Math.PI / 2;
    u.parts.hand.add(w);
    u.held = w;
  }
}
export const WCODES = ['tackle', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'pigskin', 'whistle'];

const lerp = (a, b, k) => a + (b - a) * k;
// Animate a player model. s = { speed, phase, emote, emoteT, pitch, firing, t }
export function animatePlayer(model, s, dt) {
  const u = model.userData, p = u.parts;
  const t = s.t;
  p.chute.visible = s.phase === 3;
  p.body.rotation.set(0, 0, 0);
  p.body.position.set(0, 0, 0);
  p.head.rotation.set(0, 0, 0);
  let lL = 0, lR = 0, aL = 0, aR = 0, aLz = 0, aRz = 0;
  if (s.phase === 2) { // free fall: spread out
    p.body.rotation.x = -1.2;
    p.body.position.y = 0.9;
    aL = aR = -0.3; aLz = -1.3; aRz = 1.3; lL = 0.3; lR = -0.3;
  } else if (s.phase === 3) { // gliding: hold the straps
    aL = aR = -2.8; aLz = -0.3; aRz = 0.3; lL = 0.2; lR = -0.1;
  } else if (s.emote) {
    const e = s.emoteT;
    switch (s.emote) {
      case 1: { // Gridiron Shuffle: heel taps with swinging arms
        const k = Math.sin(e * 9);
        lL = Math.max(0, k) * 0.9; lR = Math.max(0, -k) * 0.9;
        aL = Math.sin(e * 9) * 1.1 - 0.4; aR = -Math.sin(e * 9) * 1.1 - 0.4;
        p.body.position.y = Math.abs(Math.cos(e * 9)) * 0.08;
        p.body.rotation.y = Math.sin(e * 4.5) * 0.25;
        break;
      }
      case 2: { // Touchdown Spike
        if (e < 0.7) { aR = lerp(0, -3, e / 0.7); }
        else if (e < 0.9) { aR = lerp(-3, -0.4, (e - 0.7) / 0.2); p.body.rotation.x = -0.4; }
        else { aL = aR = -2.6; aLz = -0.6; aRz = 0.6; p.body.position.y = Math.abs(Math.sin(e * 8)) * 0.15; }
        break;
      }
      case 3: { // Victory Dance
        p.body.rotation.y = Math.sin(e * 6) * 0.6;
        p.body.rotation.z = Math.sin(e * 6) * 0.12;
        aL = -2.8 + Math.sin(e * 12) * 0.4; aR = -2.8 - Math.sin(e * 12) * 0.4;
        aLz = -0.4; aRz = 0.4;
        lL = Math.max(0, Math.sin(e * 6)) * 0.5; lR = Math.max(0, -Math.sin(e * 6)) * 0.5;
        p.body.position.y = Math.abs(Math.sin(e * 12)) * 0.1;
        break;
      }
      case 4: { // Helmet Salute
        if (e < 1.1) { aR = -2.5; aRz = -0.9; p.head.rotation.x = 0.15; }
        else { aR = -3.0; aRz = 0.1; p.head.rotation.x = -0.4; }
        break;
      }
      case 5: { // Ref Signals
        const ph = e % 3.2;
        if (ph < 1) { aL = aR = -3.1; }
        else if (ph < 2) { aL = aR = -1.57; aLz = -Math.sin(ph * 10) * 0.6; aRz = Math.sin(ph * 10) * 0.6; }
        else { aL = -1.5 + Math.sin(ph * 14) * 0.5; aR = -1.5 - Math.sin(ph * 14) * 0.5; }
        break;
      }
    }
  } else {
    // walking / running
    const spd = Math.min(1.4, s.speed / 7);
    u.walk += dt * (4 + s.speed * 1.1);
    const sw = Math.sin(u.walk) * 0.9 * spd;
    lL = sw; lR = -sw; aL = -sw * 0.8;
    aR = u.held ? -1.3 - (s.pitch || 0) * 0.8 : sw * 0.8;
    if (u.held) { aL = -1.1 - (s.pitch || 0) * 0.6; aLz = 0.5; }
    if (s.swing > 0) { aR = -2.2 + (1 - s.swing) * 2; }
    p.body.position.y = Math.abs(Math.sin(u.walk)) * 0.05 * spd;
    p.head.rotation.x = (s.pitch || 0) * 0.4;
  }
  p.legL.rotation.x = lL; p.legR.rotation.x = lR;
  p.armL.rotation.x = aL; p.armR.rotation.x = aR;
  p.armL.rotation.z = aLz; p.armR.rotation.z = aRz;
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
