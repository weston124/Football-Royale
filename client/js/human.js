// Realistic skinned football player built on the MakeHuman base body (CC0).
// The uniform is painted onto the body; helmet, face mask, pads and eyes are added on top.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let DATA = null;          // { info, attrs }
let MATS = null;          // shared materials
let BONE_INV = null;      // shared bind inverses
let CHEST = null;         // chest surface for jersey numbers
let FEET = null;
let WAIST = null;
let JERSEY_GEO = null;    // loose jersey shell over the shoulder pads          // foot boxes for the cleats

const SKIN = 0, JERSEY = 1, PANTS = 2, SOCK = 3, SHOE = 4, GLOVE = 5, ACCENT = 6, BROW = 7, LIPS = 8, EYEBLACK = 9, TAPE = 10, LASH = 11;

export async function loadHuman(base = '/assets/') {
  const [info, bin] = await Promise.all([
    fetch(base + 'human.json').then((r) => r.json()),
    fetch(base + 'human.bin').then((r) => r.arrayBuffer()),
  ]);
  const n = info.vertexCount, o = info.offsets;
  const attrs = {
    position: new THREE.BufferAttribute(new Float32Array(bin, o.position, n * 3), 3),
    normal: new THREE.BufferAttribute(new Float32Array(bin, o.normal, n * 3), 3),
    skinIndex: new THREE.Uint8BufferAttribute(new Uint8Array(bin, o.skinIndex, n * 4), 4),
    skinWeight: new THREE.BufferAttribute(new Uint8Array(bin, o.skinWeight, n * 4), 4, true),
    index: new THREE.BufferAttribute(new Uint16Array(bin, o.index, info.indexCount), 1),
    region: new Uint8Array(bin, o.region, n),
  };
  DATA = { info, attrs };
  MATS = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0 }),  // skin, face
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }),  // fabric
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }), // cleats
  ];
  // where the chest is, for the jersey numbers
  const p = attrs.position.array, reg = attrs.region;
  let front = 0, back = -1;
  for (let i = 0; i < n; i++) {
    if (reg[i] !== JERSEY || Math.abs(p[i * 3]) > 0.03 || Math.abs(p[i * 3 + 1] - 1.33) > 0.03) continue;
    front = Math.min(front, p[i * 3 + 2]); back = Math.max(back, p[i * 3 + 2]);
  }
  CHEST = { y: 1.33, front, back };
  // Loose jersey: copy the jersey triangles and push them outward (more over the shoulder pads)
  {
    const nr = attrs.normal.array, ix = attrs.index.array;
    const pos = new Float32Array(n * 3);
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1];
      let off = 0.016 + 0.014 * smooth(1.15, 1.32, y);                      // fabric hangs looser on the chest
      off += 0.05 * smooth(1.36, 1.5, y) * (1 - smooth(1.5, 1.6, y));       // shoulder pads underneath
      if (Math.abs(x) > 0.22) off = 0.022 + 0.03 * smooth(1.3, 1.45, y);    // sleeves
      for (let a = 0; a < 3; a++) pos[i * 3 + a] = p[i * 3 + a] + nr[i * 3 + a] * off;
    }
    const tri = [];
    for (let t = 0; t < ix.length; t += 3) {
      if (reg[ix[t]] === JERSEY && reg[ix[t + 1]] === JERSEY && reg[ix[t + 2]] === JERSEY) tri.push(ix[t], ix[t + 1], ix[t + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('skinIndex', attrs.skinIndex);
    g.setAttribute('skinWeight', attrs.skinWeight);
    g.setIndex(tri);
    g.computeVertexNormals();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 1);
    JERSEY_GEO = g;
  }
  // waist ring for the belt
  const wy = info.meta.waistY - 0.015;
  const wmn = [1e9, 1e9], wmx = [-1e9, -1e9];
  for (let i = 0; i < n; i++) {
    if (Math.abs(p[i * 3 + 1] - wy) > 0.012 || (reg[i] !== JERSEY && reg[i] !== PANTS)) continue;
    wmn[0] = Math.min(wmn[0], p[i * 3]); wmx[0] = Math.max(wmx[0], p[i * 3]);
    wmn[1] = Math.min(wmn[1], p[i * 3 + 2]); wmx[1] = Math.max(wmx[1], p[i * 3 + 2]);
  }
  WAIST = { y: wy, cx: (wmn[0] + wmx[0]) / 2, cz: (wmn[1] + wmx[1]) / 2, rx: (wmx[0] - wmn[0]) / 2, rz: (wmx[1] - wmn[1]) / 2 };
  FEET = {};
  for (const side of ['L', 'R']) {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < n; i++) {
      if (reg[i] !== SHOE || (side === 'L') !== (p[i * 3] < 0)) continue;
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[i * 3 + a]); mx[a] = Math.max(mx[a], p[i * 3 + a]); }
    }
    FEET[side] = { min: mn, max: mx };
  }
  return true;
}
export const humanReady = () => !!DATA;

function regionColors(skin) {
  const c = (h) => new THREE.Color(h);
  const tone = c(skin.tone || '#c98e62');
  const map = {
    [SKIN]: tone, [JERSEY]: c(skin.jersey), [PANTS]: c(skin.pants), [SOCK]: c(skin.accent), [SHOE]: c('#161616'),
    [GLOVE]: c(skin.accent), [ACCENT]: c(skin.accent), [BROW]: c('#2a1a10'), [LIPS]: tone.clone().lerp(c('#a0524a'), 0.45),
    [EYEBLACK]: c('#111111'), [TAPE]: c('#f2f2f2'), [LASH]: c('#1a120c'),
  };
  return map;
}

const smats = new Map();
function smat(color, rough = 0.6, metal = 0, extra = {}) {
  const k = color + rough + metal + JSON.stringify(extra);
  if (!smats.has(k)) smats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  return smats.get(k);
}

function buildHelmet(skin) {
  const g = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: skin.helmet, roughness: 0.18, metalness: 0.05, side: THREE.DoubleSide });
  const R = 0.15;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, 1.2), hm);
  dome.scale.set(0.93, 1.0, 1.12); g.add(dome);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, -Math.PI * 0.22, Math.PI * 1.44, 1.15, 0.98), hm);
  shell.scale.set(0.93, 1.0, 1.12); g.add(shell);
  // center stripe follows the curve of the shell from forehead to the back
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * 1.005, 0.009, 6, 28, Math.PI - 0.55), smat(skin.stripe, 0.25));
  stripe.rotation.y = Math.PI / 2; stripe.rotation.z = 0.3; stripe.scale.set(1.12, 1, 0.5); g.add(stripe);
  for (const sx of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.075, 0.08), hm);
    jaw.position.set(sx * 0.118, -0.07, -0.06); jaw.rotation.y = sx * 0.35; g.add(jaw);
    const clip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), smat(skin.mask, 0.35, 0.4));
    clip.position.set(sx * 0.133, -0.02, -0.04); clip.scale.set(0.4, 1, 1); g.add(clip);
  }
  const mm = smat(skin.mask, 0.35, 0.45);
  for (const [y, r] of [[-0.035, 0.15], [-0.075, 0.145], [-0.112, 0.125]]) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0065, 8, 24, Math.PI * 0.62), mm);
    bar.rotation.x = Math.PI / 2; bar.rotation.z = Math.PI + Math.PI * 0.19; bar.position.set(0, y, 0.008);
    g.add(bar);
  }
  for (const sx of [-0.037, 0.037]) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.095, 8), mm);
    v.position.set(sx, -0.075, -0.142); v.rotation.x = -0.15; g.add(v);
  }
  const visor = new THREE.Mesh(new THREE.SphereGeometry(R * 0.97, 24, 8, Math.PI * 1.5 - 0.85, 1.7, 1.28, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
  visor.scale.set(0.93, 1.0, 1.12); g.add(visor);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.008, 6, 18, Math.PI), smat('#f2efe8', 0.4));
  strap.position.set(0, -0.11, -0.03); strap.rotation.set(-0.45, 0, Math.PI); g.add(strap);
  if (skin.horns) {
    for (const side of [-1, 1]) {
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.16, 0, 0),
        new THREE.Vector3(side * 0.3, 0.03, 0), new THREE.Vector3(side * 0.38, 0.16, -0.03));
      const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.03, 10), smat(skin.horns, 0.35));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 10), smat(skin.horns, 0.35));
      tip.position.copy(curve.getPoint(1)); tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1));
      const h = new THREE.Group(); h.add(horn, tip);
      h.position.set(side * 0.12, 0.05, 0.01);
      g.add(h);
    }
  }
  g.userData.disposeMat = hm;
  return g;
}

function buildEye(r, iris) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), smat('#f4f1ec', 0.15)));
  const ir = new THREE.Mesh(new THREE.SphereGeometry(r * 0.52, 18, 12), smat(iris, 0.2));
  ir.scale.z = 0.35; ir.position.z = -r * 0.86; g.add(ir);
  const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 12, 8), smat('#050505', 0.1));
  pu.scale.z = 0.3; pu.position.z = -r * 0.95; g.add(pu);
  const hl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  hl.position.set(r * 0.25, r * 0.25, -r * 0.98); g.add(hl);
  return g;
}

const IRIS = ['#4a2e1c', '#2f5f8a', '#3f6b3a', '#6b4a2a', '#5a4632'];

// Returns { mesh, bones: {name: Bone}, attach(boneName, obj, worldPos), restWorld(name) }
export function createHuman(skin) {
  const { info, attrs } = DATA;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', attrs.position);
  geo.setAttribute('normal', attrs.normal);
  geo.setAttribute('skinIndex', attrs.skinIndex);
  geo.setAttribute('skinWeight', attrs.skinWeight);
  geo.setIndex(attrs.index);
  const n = info.vertexCount, reg = attrs.region, cmap = regionColors(skin);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = cmap[reg[i]] || cmap[SKIN]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const gr of info.groups) geo.addGroup(gr.start, gr.count, gr.mat);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.3);

  const bones = info.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.fromArray(b.pos);
    bone.quaternion.fromArray(b.quat);
    return bone;
  });
  info.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(geo, MATS);
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  if (!BONE_INV) {
    BONE_INV = bones.map((b) => b.matrixWorld.clone().invert());
  }
  mesh.bind(new THREE.Skeleton(bones, BONE_INV.map((m) => m.clone())), new THREE.Matrix4());
  mesh.frustumCulled = true;
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  const restWorld = (name) => byName[name].getWorldPosition(new THREE.Vector3());
  const attach = (name, obj, worldPos) => {
    const bone = byName[name];
    obj.position.copy(worldPos).sub(restWorld(name));
    // rest frames of limb bones are rotated; convert the offset into the bone's frame
    const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    obj.position.applyQuaternion(q);
    obj.quaternion.premultiply(q);
    bone.add(obj);
    return obj;
  };

  // accessories
  const owned = [];
  const meta = info.meta;
  const eyeY = meta.eyes.L.c[1], eyeZ = meta.eyes.L.c[2];
  const helmet = buildHelmet(skin); owned.push(helmet.userData.disposeMat);
  attach('head', helmet, new THREE.Vector3(0, eyeY + 0.03, eyeZ + 0.105));
  const iris = IRIS[(skin.number || 0) % IRIS.length];
  for (const s of ['L', 'R']) attach('head', buildEye(meta.eyes[s].r * 0.95, iris), new THREE.Vector3(...meta.eyes[s].c));
  const padMat = new THREE.MeshStandardMaterial({ color: skin.jersey, roughness: 0.68, side: THREE.DoubleSide }); owned.push(padMat);
  const jersey = new THREE.SkinnedMesh(JERSEY_GEO, padMat);
  jersey.bind(mesh.skeleton, mesh.bindMatrix);
  mesh.add(jersey);
  const accMat = smat(skin.accent, 0.72);
  const sh = meta.shoulder;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), accMat);
  collar.rotation.x = Math.PI / 2;
  attach('spine01', collar, new THREE.Vector3(0, meta.neckY + 0.005, sh[2] + 0.01));
  // cleats over the feet
  const shoeMat = smat('#151515', 0.35, 0.05), soleMat = smat('#e9e9e9', 0.5), stripeMat = smat(skin.accent, 0.4);
  for (const s of ['L', 'R']) {
    const f = FEET[s];
    const w = f.max[0] - f.min[0] + 0.022, h = f.max[1] - f.min[1] + 0.012, d = f.max[2] - f.min[2] + 0.03;
    const shoe = new THREE.Group();
    shoe.add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h) * 0.45), shoeMat));
    const sole = new THREE.Mesh(new RoundedBoxGeometry(w * 0.92, 0.016, d * 0.9, 2, 0.007), soleMat);
    sole.position.y = -h / 2 + 0.006; shoe.add(sole);
    for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.004, h * 0.35, d * 0.4), stripeMat);
      st.position.set(sx * (w / 2 + 0.001), -h * 0.05, -d * 0.05); st.rotation.x = 0.5; shoe.add(st);
    }
    const c = new THREE.Vector3((f.min[0] + f.max[0]) / 2, (f.min[1] + f.max[1]) / 2 + 0.004, (f.min[2] + f.max[2]) / 2 - 0.008);
    attach('foot.' + s, shoe, c);
  }
  // belt around the waist (covers the jersey/pants line)
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.045, 32, 1, true), new THREE.MeshStandardMaterial({ color: skin.accent, roughness: 0.6, side: THREE.DoubleSide }));
  owned.push(belt.material);
  belt.scale.set(WAIST.rx + 0.008, 1, WAIST.rz + 0.008);
  attach('root', belt, new THREE.Vector3(WAIST.cx, WAIST.y, WAIST.cz));
  // numbers
  const numTex = numberTexture(skin.number ?? 12, skin.accent);
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4 });
  owned.push(numMat, numTex);
  for (const [z, ry] of [[CHEST.front - 0.036, Math.PI], [CHEST.back + 0.036, 0]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
    plate.rotation.y = ry;
    attach('spine02', plate, new THREE.Vector3(0, CHEST.y, z));
  }
  // weapon hand point
  const hand = new THREE.Group();
  attach('wrist.R', hand, restWorld('wrist.R').add(new THREE.Vector3(0, -0.07, -0.01)));
  hand.quaternion.identity();
  return { mesh, bones: byName, hand, owned };
}

function numberTexture(num, accent) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 82px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.strokeText(String(num), 64, 70);
  g.fillStyle = accent; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
