// All 3D models are built from simple shapes in code (no downloaded art).
import * as THREE from 'three';
import { RARITIES } from '/shared/weapons.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createHuman, humanReady, loadHuman } from './human.js';
export { loadHuman };

// Soft studio lighting for characters (glossy helmets, smooth skin). Only affects the players' materials.
const envCache = new WeakMap();
export function setupEnvironment(renderer, scene, intensity = 0.55) {
  if (!envCache.has(renderer)) {
    const pm = new THREE.PMREMGenerator(renderer);
    envCache.set(renderer, pm.fromScene(new RoomEnvironment(), 0.04).texture);
    pm.dispose();
  }
  scene.environment = envCache.get(renderer);
  scene.environmentIntensity = intensity;
}
let shadowTex = null;
function blobShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 1;
  return m;
}

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
  g.font = 'bold 76px Impact, Arial Black, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#ffffff';
  g.strokeText(String(num), 64, 72);
  g.fillStyle = accent; g.fillText(String(num), 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- football player (realistic athlete) ----------
const smatCache = new Map();
// Physically-based material: rough = 0 shiny .. 1 matte
function smat(color, rough = 0.75, metal = 0, extra = {}) {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  if (!smatCache.has(key)) smatCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  return smatCache.get(key);
}
// A smooth limb/torso shape spun from a list of [radius, height] points (bottom to top)
const latheCache = new Map();
function lathe(profile, m, segs = 22) {
  const key = JSON.stringify(profile) + segs;
  if (!latheCache.has(key)) latheCache.set(key, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs));
  return new THREE.Mesh(latheCache.get(key), m);
}
function ball(r, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ws = 24, hs = 18) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
  return mesh;
}
function cyl(r1, r2, h, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 16), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function cube(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
// Merge the plain meshes directly inside a group (one draw call per material) for speed
function mergeGroup(g) {
  const byMat = new Map();
  for (const c of [...g.children]) {
    if (!c.isMesh || c.userData.keep) continue;
    c.updateMatrix();
    const geo = (c.geometry.index ? c.geometry : c.geometry).clone().applyMatrix4(c.matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(geo.index ? geo : geo);
    g.remove(c);
  }
  for (const [m, geos] of byMat) {
    const merged = mergeGeometriesSafe(geos);
    if (merged) g.add(new THREE.Mesh(merged, m));
  }
}
function mergeGeometriesSafe(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of list) {
      const a = g.attributes[name];
      if (a) arr.set(a.array, off);
      off += g.attributes.position.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

// Gloved hand with fingers (palm faces inward, fingers point down -y)
export function createHand(color, side = 1) {
  const g = new THREE.Group();
  const m = smat(color, 0.55);
  g.add(cube(0.075, 0.085, 0.032, m, 0, -0.04, 0));
  for (let i = 0; i < 4; i++) {
    const f = cyl(0.0105, 0.0095, 0.06, m, 0, -0.105, 0);
    f.position.x = -0.027 + i * 0.018; f.position.z = 0.006; f.rotation.x = 0.35;
    if (i === 0 || i === 3) f.scale.y = 0.85;
    g.add(f);
  }
  const th = cyl(0.012, 0.011, 0.055, m, side * -0.04, -0.035, -0.012);
  th.rotation.z = side * -0.6; th.rotation.x = -0.4;
  g.add(th);
  mergeGroup(g);
  return g;
}

// Curved steer horns for Longhorn outfits
function makeHorn(side, color) {
  const g = new THREE.Group();
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.16, 0.0, 0),
    new THREE.Vector3(side * 0.3, 0.03, 0), new THREE.Vector3(side * 0.38, 0.16, -0.03));
  const pts = curve.getPoints(12);
  const m = smat(color, 0.35);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const r1 = 0.04 * (1 - i / pts.length) + 0.005, r2 = 0.04 * (1 - (i + 1) / pts.length) + 0.004;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, a.distanceTo(b) * 1.05, 10), m);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(seg);
  }
  mergeGroup(g);
  return g;
}

export function createPlayer(skin) {
  return humanReady() ? createRealPlayer(skin) : createCartoonPlayer(skin);
}

// Realistic skinned athlete; the animation code drives invisible 'proxy' joints that we copy onto the bones.
function createRealPlayer(skin) {
  const root = new THREE.Group();
  const h = createHuman(skin);
  root.add(h.mesh);
  const P = {};
  for (const k of ['body', 'spine', 'head', 'legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR']) P[k] = new THREE.Object3D();
  P.hand = h.hand;
  const lasso = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.014, 6, 28), new THREE.MeshStandardMaterial({ color: '#c8a165', roughness: 0.9 }));
  lasso.rotation.x = Math.PI / 2; lasso.position.y = -0.05; lasso.visible = false;
  P.hand.add(lasso); P.lasso = lasso;
  P.chute = makeChute(skin); root.add(P.chute);
  P.shadow = blobShadow(); root.add(P.shadow);
  const B = h.bones, rootY = B.root.position.y;
  const rig = () => {
    B.root.position.y = rootY + (P.body.position.y - 0.98);
    B.root.rotation.copy(P.body.rotation);
    B.spine03.rotation.set(P.spine.rotation.x * 0.5, P.spine.rotation.y * 0.5, 0);
    B.spine02.rotation.set(P.spine.rotation.x * 0.5, P.spine.rotation.y * 0.5, 0);
    B.neck02.rotation.set(P.head.rotation.x * 0.4, P.head.rotation.y * 0.4, 0);
    B.head.rotation.set(P.head.rotation.x * 0.6, P.head.rotation.y * 0.6, 0);
    for (const [s, l] of [['L', 'L'], ['R', 'R']]) {
      B['upperleg01.' + s].rotation.set(P['leg' + l].rotation.x, 0, P['leg' + l].rotation.z);
      B['lowerleg01.' + s].rotation.set(P['knee' + l].rotation.x, 0, 0);
      B['upperarm01.' + s].rotation.set(P['arm' + l].rotation.x, 0, P['arm' + l].rotation.z);
      B['lowerarm01.' + s].rotation.set(P['elbow' + l].rotation.x, 0, 0);
    }
  };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); // only matters where shadows are turned on
  P.shadow.castShadow = false; P.shadow.receiveShadow = false;
  root.userData = { parts: P, walk: 0, held: null, heldCode: -1, rig, human: h, setHelmet: h.setHelmet };
  rig();
  return root;
}

function makeChute(skin) {
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshLambertMaterial({ color: skin.accent, side: THREE.DoubleSide }));
  canopy.scale.y = 0.55; canopy.position.y = 4.4; chute.add(canopy);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(2.62, 16, 8, 0, Math.PI * 2, Math.PI / 4.5, 0.12),
    new THREE.MeshLambertMaterial({ color: skin.jersey, side: THREE.DoubleSide }));
  stripe.scale.y = 0.55; stripe.position.y = 4.4; chute.add(stripe);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(Math.cos(a) * 2.1, 4.6, Math.sin(a) * 2.1)); }
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })));
  chute.visible = false;
  return chute;
}

function createCartoonPlayer(skin) {
  const root = new THREE.Group();
  const body = new THREE.Group();   // pivot at the hips
  body.position.y = 0.98;
  root.add(body);
  const parts = { body };
  const tone = skin.tone || '#c98e62';
  const M = {
    skin: smat(tone, 0.5),
    iris: smat(['#4a2e1c', '#2f5f8a', '#3f6b3a', '#6b4a2a'][(skin.number || 0) % 4], 0.25),
    lid: smat(new THREE.Color(tone).multiplyScalar(0.92).getStyle(), 0.55),
    jersey: smat(skin.jersey, 0.62),
    accent: smat(skin.accent, 0.8),
    pants: smat(skin.pants, 0.5),
    helmet: smat(skin.helmet, 0.22, 0.05),
    stripe: smat(skin.stripe, 0.25, 0.05),
    mask: smat(skin.mask, 0.35, 0.4),
    sock: smat(skin.accent, 0.9),
    shoe: smat('#141414', 0.45),
    sole: smat('#e8e8e8', 0.6),
    white: smat('#f2efe8', 0.4),
    dark: smat('#1a1210', 0.5),
    brow: smat('#2a1a10', 0.9),
    lip: smat(new THREE.Color(tone).multiplyScalar(0.72).getStyle(), 0.5),
    pad: smat(new THREE.Color(skin.pants).multiplyScalar(0.88).getStyle(), 0.6),
    tape: smat('#f5f5f5', 0.8),
  };
  const numTex = numberTexture(skin.number ?? 12, skin.jersey, skin.accent);
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });

  // ---------- legs: hip -> knee -> cleat ----------
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.105, -0.03, 0);
    const thigh = lathe([[0.06, -0.46], [0.075, -0.4], [0.098, -0.25], [0.105, -0.12], [0.1, -0.02], [0.09, 0.03]], M.pants);
    thigh.scale.z = 0.95; hip.add(thigh);
    hip.add(ball(0.065, M.pad, 0, -0.42, -0.045, 1, 1.1, 0.6)); // knee pad
    mergeGroup(hip);
    const knee = new THREE.Group(); knee.position.y = -0.45;
    knee.add(lathe([[0.038, -0.42], [0.045, -0.34], [0.068, -0.16], [0.07, -0.1], [0.06, 0.0]], M.sock));
    // cleat
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.15, 4, 10), M.shoe);
    shoe.rotation.x = Math.PI / 2; shoe.scale.set(1.25, 1, 0.75); shoe.position.set(0, -0.455, -0.045);
    knee.add(shoe);
    knee.add(cube(0.1, 0.018, 0.25, M.sole, 0, -0.49, -0.045));
    knee.add(cube(0.012, 0.03, 0.1, M.white, side * 0.06, -0.45, -0.03));
    mergeGroup(knee);
    hip.add(knee);
    body.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
    parts[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  }
  // ---------- pelvis ----------
  body.add(ball(0.17, M.pants, 0, 0.0, 0, 1.0, 0.75, 0.82));
  body.add(cyl(0.165, 0.17, 0.05, M.accent, 0, 0.07, 0)).children; // belt
  body.children[body.children.length - 1].scale.z = 0.8;
  mergeGroup(body);

  // ---------- torso ----------
  const spine = new THREE.Group(); spine.position.y = 0.08; body.add(spine); parts.spine = spine;
  const chest = lathe([[0.155, 0.0], [0.15, 0.08], [0.148, 0.16], [0.17, 0.26], [0.19, 0.36], [0.195, 0.43], [0.17, 0.5], [0.09, 0.55], [0.06, 0.56]], M.jersey, 18);
  chest.scale.z = 0.66; spine.add(chest);
  // shoulder pads under the jersey
  for (const sx of [-1, 1]) {
    spine.add(ball(0.13, M.jersey, sx * 0.17, 0.49, 0, 1.25, 0.6, 1.05));
    spine.add(cyl(0.09, 0.105, 0.11, M.jersey, sx * 0.24, 0.43, 0)); // sleeve cap
  }
  spine.add(ball(0.1, M.jersey, 0, 0.52, 0, 1.6, 0.45, 1.2));
  spine.add(new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 8, 18), M.accent)); // collar
  spine.children[spine.children.length - 1].rotation.x = Math.PI / 2;
  spine.children[spine.children.length - 1].position.y = 0.56;
  for (const sx of [-1, 1]) spine.add(cyl(0.106, 0.106, 0.025, M.accent, sx * 0.24, 0.4, 0)); // sleeve stripes
  spine.add(cyl(0.05, 0.055, 0.12, M.skin, 0, 0.6, 0)); // neck
  mergeGroup(spine);
  for (const zz of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), numMat);
    plate.position.set(0, 0.32, zz * 0.13);
    plate.rotation.y = zz > 0 ? 0 : Math.PI;
    plate.rotation.x = zz * -0.12;
    plate.userData.keep = true;
    spine.add(plate);
  }

  // ---------- head ----------
  const head = new THREE.Group(); head.position.y = 0.745; spine.add(head); parts.head = head;
  const headScale = 1.13; // slightly bigger hero head
  const face = new THREE.Group(); head.add(face);
  face.add(ball(0.098, M.skin, 0, 0.02, 0, 0.9, 1.08, 1.0, 20, 16));     // skull
  face.add(ball(0.078, M.skin, 0, -0.035, -0.018, 0.92, 0.82, 0.98));     // jaw
  face.add(ball(0.03, M.skin, 0, -0.07, -0.05, 1.2, 0.8, 0.9));          // chin
  for (const sx of [-1, 1]) {
    face.add(ball(0.019, M.skin, sx * 0.091, 0.008, 0.005, 0.45, 1, 0.8)); // ear
    face.add(ball(0.0165, M.white, sx * 0.033, 0.02, -0.08, 1.1, 0.95, 0.6));     // eye white
    face.add(ball(0.0105, M.iris, sx * 0.033, 0.019, -0.0875, 1, 1, 0.45));       // colored iris
    face.add(ball(0.0052, M.dark, sx * 0.033, 0.019, -0.0905, 1, 1, 0.4));        // pupil
    face.add(ball(0.0025, M.white, sx * 0.033 + 0.004, 0.0235, -0.0925));         // shine
    face.add(ball(0.0185, M.lid, sx * 0.033, 0.03, -0.079, 1.15, 0.5, 0.68));     // upper eyelid
    for (const [dx, dy, rz] of [[-0.012, 0.045, 0.25], [0.004, 0.049, 0.0], [0.018, 0.046, -0.3]]) {    // arched eyebrow
      const b = cube(0.017, 0.0085, 0.01, M.brow, sx * (0.033 + dx), dy, -0.088); b.rotation.z = sx * -rz; face.add(b);
    }
    face.add(cube(0.03, 0.008, 0.006, M.dark, sx * 0.034, -0.004, -0.088)); // eye black
    face.add(ball(0.022, M.skin, sx * 0.045, -0.01, -0.07, 1, 0.8, 0.8)); // cheek
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 8), M.skin);
  nose.rotation.x = -Math.PI / 2 + 0.35; nose.position.set(0, 0.0, -0.096); face.add(nose);
  face.add(ball(0.012, M.skin, 0, -0.012, -0.098, 1.4, 0.8, 0.9));        // nose tip
  face.add(cube(0.034, 0.007, 0.01, M.lip, 0, -0.04, -0.087));             // lips
  face.add(cube(0.03, 0.006, 0.01, M.lip, 0, -0.049, -0.085));
  mergeGroup(face);
  // helmet: glossy shell open at the face
  const helm = new THREE.Group(); head.add(helm);
  const hmat = new THREE.MeshStandardMaterial({ color: skin.helmet, roughness: 0.22, metalness: 0.05, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12, 0, Math.PI * 2, 0, 1.2), hmat);
  dome.position.set(0, 0.025, 0.004); dome.scale.set(0.98, 1.0, 1.12); helm.add(dome);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 10, -Math.PI * 0.22, Math.PI * 1.44, 1.15, 0.95), hmat);
  shell.position.set(0, 0.025, 0.004); shell.scale.set(0.98, 1.0, 1.12); helm.add(shell);
  for (const sx of [-1, 1]) {
    const jaw = cube(0.02, 0.07, 0.07, hmat, sx * 0.105, -0.045, -0.055); jaw.rotation.y = sx * 0.35; helm.add(jaw); // jaw guard
    helm.add(ball(0.02, M.mask, sx * 0.124, -0.005, -0.03, 0.4, 1, 1));   // mask clip
  }
  helm.add(cube(0.026, 0.012, 0.29, M.stripe, 0, 0.152, 0.01));            // center stripe
  mergeGroup(helm);
  const cage = new THREE.Group(); head.add(cage);
  for (const [y, r] of [[-0.01, 0.135], [-0.05, 0.13], [-0.088, 0.115]]) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0065, 6, 20, Math.PI * 0.62), M.mask);
    bar.rotation.x = Math.PI / 2; bar.rotation.z = Math.PI + Math.PI * 0.19; bar.position.set(0, y, 0.01);
    cage.add(bar);
  }
  for (const sx of [-0.035, 0.035]) { const v = cyl(0.006, 0.006, 0.085, M.mask, sx, -0.05, -0.122); v.rotation.x = -0.15; cage.add(v); }
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16, Math.PI), M.white);
  strap.position.set(0, -0.06, -0.04); strap.rotation.set(-0.5, 0, Math.PI); cage.add(strap);   // chin strap
  mergeGroup(cage);
  if (skin.horns) {
    const hl = makeHorn(-1, skin.horns); hl.position.set(-0.115, 0.06, 0.01); head.add(hl);
    const hr = makeHorn(1, skin.horns); hr.position.set(0.115, 0.06, 0.01); head.add(hr);
  }

  // ---------- arms: shoulder -> elbow -> glove ----------
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.255, 0.46, 0);
    sh.add(lathe([[0.046, -0.3], [0.05, -0.26], [0.06, -0.16], [0.064, -0.1], [0.07, 0.0]], M.skin)); // bicep
    mergeGroup(sh);
    const elbow = new THREE.Group(); elbow.position.y = -0.3;
    elbow.add(lathe([[0.034, -0.25], [0.04, -0.2], [0.05, -0.1], [0.05, -0.05], [0.045, 0.01]], M.skin)); // forearm
    elbow.add(cyl(0.039, 0.037, 0.05, M.tape, 0, -0.23, 0)); // wrist tape
    mergeGroup(elbow);
    const glove = createHand(skin.accent, side);
    glove.position.y = -0.25; glove.rotation.y = side * Math.PI / 2; glove.scale.setScalar(1.15);
    elbow.add(glove);
    const hand = new THREE.Group(); hand.position.set(0, -0.3, -0.02); elbow.add(hand);
    sh.children[0].scale.set(1.2, 1, 1.2);      // heroic biceps
    elbow.children[0].scale.set(1.15, 1, 1.15);  // and forearms
    sh.add(elbow);
    spine.add(sh);
    parts[side < 0 ? 'armL' : 'armR'] = sh;
    parts[side < 0 ? 'elbowL' : 'elbowR'] = elbow;
    if (side > 0) parts.hand = hand;
  }
  // lasso for the Lasso Spin emote
  const lasso = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.014, 6, 28), smat('#c8a165', 0.9));
  lasso.rotation.x = Math.PI / 2; lasso.position.y = -0.05; lasso.visible = false;
  parts.hand.add(lasso); parts.lasso = lasso;

  // ---------- parachute (hidden until gliding) ----------
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshLambertMaterial({ color: skin.accent, side: THREE.DoubleSide }));
  canopy.scale.y = 0.55; canopy.position.y = 4.4; chute.add(canopy);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(2.62, 16, 8, 0, Math.PI * 2, Math.PI / 4.5, 0.12),
    new THREE.MeshLambertMaterial({ color: skin.jersey, side: THREE.DoubleSide }));
  stripe.scale.y = 0.55; stripe.position.y = 4.4; chute.add(stripe);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(Math.cos(a) * 2.1, 4.6, Math.sin(a) * 2.1)); }
  chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff })));
  chute.visible = false;
  root.add(chute);
  parts.chute = chute;

  for (const c of head.children) c.scale.multiplyScalar(headScale);
  for (const c of head.children) c.position.multiplyScalar(headScale);
  const shadow = blobShadow(); root.add(shadow); parts.shadow = shadow;
  root.userData = { parts, walk: 0, held: null, heldCode: -1, numTex, owned: [hmat, numMat] };
  return root;
}

export function disposePlayer(m) {
  const h = m.userData.human;
  if (h) {
    for (const x of h.owned) x.dispose();
    const g = h.mesh.geometry;
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) g.deleteAttribute(k); // shared, keep on GPU
    g.setIndex(null); g.dispose();
    h.mesh.skeleton.dispose();
    return;
  }
  m.userData.numTex.dispose();
  for (const x of m.userData.owned || []) x.dispose();
  m.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.parameters) o.geometry.dispose(); });
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
  if (p.shadow) p.shadow.visible = s.phase === 0 || !s.phase;
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
  } else if (s.hero) {
    // confident Locker Room stance: feet apart, item held out in the right hand
    lLz = -0.13; lRz = 0.12; lL = 0.04; lR = -0.06; kL = kR = -0.06;
    aR = 0.55; aRz = 0.32; eR = 0.95;
    aL = 0.12; aLz = -0.28; eL = 0.45;
    sy = 0.12; sx = 0.03; hx = -0.04; hy = -0.08;
    bodyY += Math.sin(t * 1.8) * 0.004; aLz += Math.sin(t * 1.8) * 0.015;
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
  if (u.rig) u.rig();
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
