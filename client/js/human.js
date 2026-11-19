// Realistic skinned football player built on the MakeHuman base body (CC0).
// The uniform is painted onto the body; helmet, face mask, pads and eyes are added on top.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '/shared/rng.js';

let DATA = null;          // { info, attrs }
let MATS = null;          // shared materials
let BONE_INV = null;      // shared bind inverses
let CHEST = null;         // chest surface for jersey numbers
let FEET = null;
let WAIST = null;
let JERSEY_GEO = null;
let HEAD = null;          // head shape for hair
let MOUTH = null;         // where the smile goes
let LEGS = null;          // thigh/knee fronts for pads    // loose jersey shell over the shoulder pads          // foot boxes for the cleats

const SKIN = 0, JERSEY = 1, PANTS = 2, SOCK = 3, SHOE = 4, GLOVE = 5, ACCENT = 6, BROW = 7, LIPS = 8, EYEBLACK = 9, TAPE = 10, LASH = 11, PSTRIPE = 12;

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
  // head shape (for hair) and mouth (for the smile)
  {
    const eyeY = info.meta.eyes.L.c[1];
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    let lx = 0, ly = 0, lz = 1e9, ln = 0;
    for (let i = 0; i < n; i++) {
      const y = p[i * 3 + 1];
      if (y < eyeY - 0.13 || ![SKIN, BROW, LIPS, EYEBLACK].includes(reg[i])) continue;
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[i * 3 + a]); mx[a] = Math.max(mx[a], p[i * 3 + a]); }
      if (reg[i] === LIPS) { lx += p[i * 3]; ly += y; lz = Math.min(lz, p[i * 3 + 2]); ln++; }
    }
    HEAD = { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2 + 0.02, (mn[2] + mx[2]) / 2], r: [(mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2 - 0.02, (mx[2] - mn[2]) / 2], top: mx[1], eyeY };
    MOUTH = ln ? { x: lx / ln, y: ly / ln, z: lz } : { x: 0, y: eyeY - 0.075, z: info.meta.eyes.L.c[2] - 0.01 };
  }
  // thigh and knee fronts (for the pads)
  LEGS = {};
  for (const s of ['L', 'R']) {
    const pick = (y0) => {
      let best = null;
      for (let i = 0; i < n; i++) {
        if ((s === 'L') !== (p[i * 3] < 0) || Math.abs(p[i * 3 + 1] - y0) > 0.012) continue;
        if (!best || p[i * 3 + 2] < best[2]) best = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
      }
      return best || [0, y0, 0];
    };
    const th = pick(0.79), kn = pick(info.meta.kneeY + 0.01);
    LEGS[s] = { thighX: th[0], thighZ: th[2], kneeX: kn[0], kneeZ: kn[2] };
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
    [SKIN]: tone, [JERSEY]: c(skin.jersey), [PANTS]: c(skin.pants), [SOCK]: c(skin.jersey), [SHOE]: c('#f2f2f2'),
    [GLOVE]: c('#f4f4f4'), [ACCENT]: c(skin.accent), [BROW]: tone, [LIPS]: tone.clone().lerp(c('#a0524a'), 0.45),
    [EYEBLACK]: skin.helmetOn === false ? tone : c('#111111'), [PSTRIPE]: c(skin.jersey), [TAPE]: c('#f2f2f2'), [LASH]: c('#1a120c'),
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
  // real helmets have a glossy clear-coat shell
  const hm = new THREE.MeshPhysicalMaterial({ color: skin.helmet, roughness: 0.32, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
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
  // face mask cage: thick coated bars like a real lineman/receiver mask
  const mm = new THREE.MeshPhysicalMaterial({ color: skin.mask, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  for (const [y, r, arc] of [[-0.03, 0.152, 0.6], [-0.062, 0.15, 0.62], [-0.094, 0.143, 0.64], [-0.124, 0.122, 0.56]]) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0085, 8, 28, Math.PI * arc), mm);
    bar.rotation.x = Math.PI / 2; bar.rotation.z = Math.PI + Math.PI * (1 - arc) / 2; bar.position.set(0, y, 0.008);
    g.add(bar);
  }
  for (const sx of [-0.05, 0, 0.05]) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.11, 8), mm);
    v.position.set(sx, -0.075, -0.14 + Math.abs(sx) * 0.25); v.rotation.x = -0.18; g.add(v);
  }
  for (const sx of [-1, 1]) { // side bars that hook to the helmet
    const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.075, 8), mm);
    sb.position.set(sx * 0.118, -0.06, -0.075); sb.rotation.set(0.6, 0, sx * 0.35); g.add(sb);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.014), smat('#222222', 0.6)); // nose bumper
  bumper.position.set(0, -0.018, -0.155); g.add(bumper);
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
  g.userData.disposeMask = mm;
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

// Hair: lots of small soft clumps laid over the scalp. Returns { top, low } meshes
// (top hides under the helmet; low is what sticks out the back).
function buildHair(skin) {
  const style = skin.hairStyle || 'wavy';
  const rnd = makeRng(style.length * 7919 + 13);
  const { c, r, eyeY } = HEAD;
  const cut = eyeY - 0.045;
  const tops = [[], []], lows = [[], []];
  const up = new THREE.Vector3(0, 1, 0);
  if (style === 'buzz') {
    const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, 1.45);
    g.scale(r[0] + 0.006, r[1] + 0.006, r[2] + 0.006); g.rotateX(-0.32); g.translate(c[0], c[1] - 0.005, c[2] + 0.004);
    tops[0].push(g);
  } else {
    const count = style === 'short' ? 170 : style === 'flow' ? 260 : 230;
    const size = style === 'short' ? [0.018, 0.026] : [0.022, 0.034];
    for (let i = 0; i < count; i++) {
      // random point on the upper/back part of the head
      const th = Math.acos(1 - rnd() * (style === 'flow' ? 1.35 : 1.15)), ph = rnd() * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      const pos = new THREE.Vector3(c[0] + d.x * r[0], c[1] + d.y * r[1], c[2] + d.z * r[2]);
      const front = d.z < -0.3, side = Math.abs(d.x) > 0.7;
      if (front && pos.y < eyeY + 0.055 + (Math.abs(d.x) * 0.02)) continue;         // keep the face clear (hairline)
      if (side && pos.y < eyeY + 0.01 && d.z < 0.15) continue;                      // ears
      if (style !== 'flow' && pos.y < eyeY - 0.02) continue;
      const nrm = new THREE.Vector3(d.x / r[0], d.y / r[1], d.z / r[2]).normalize();
      const rad = size[0] + rnd() * (size[1] - size[0]);
      const g = new THREE.SphereGeometry(rad, 7, 5);
      g.scale(1.4, 0.42, 1.0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, nrm);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, (rnd() - 0.5) * (style === 'wavy' ? 0.9 : 0.4))));
      g.applyQuaternion(q);
      const out = pos.clone().addScaledVector(nrm, rad * 0.12);
      if (front && style !== 'short') out.y -= 0.008, out.z -= 0.006;               // fringe sweeps forward
      g.translate(out.x, out.y, out.z);
      (out.y < cut && d.z > 0 ? lows : tops)[rnd() < 0.72 ? 0 : 1].push(g);
    }
    if (style === 'flow') { // longer locks curling out under the back of the helmet
      for (let i = 0; i < 16; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 15));
        const g = new THREE.SphereGeometry(0.024 + rnd() * 0.008, 7, 5);
        g.scale(1, 1.6, 0.55);
        g.rotateX(0.5); g.rotateZ((i / 25 - 0.5) * 0.8);
        g.translate(c[0] + Math.cos(a) * r[0] * 0.95, cut - 0.03 - rnd() * 0.02, c[2] + Math.sin(a) * r[2] * 0.85 + 0.01);
        lows[rnd() < 0.7 ? 0 : 1].push(g);
      }
    }
  }
  const base = new THREE.Color(skin.hair || '#8a6239');
  const mats = [new THREE.MeshStandardMaterial({ color: base, roughness: 0.82 }),
    new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.18), roughness: 0.75 })];
  const make = (sets) => {
    const g = new THREE.Group();
    sets.forEach((list, k) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list), mats[k])); });
    return g;
  };
  return { top: make(tops), low: make(lows), mats };
}

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
  const st = skin.style || {}, pa = attrs.position.array;
  const cJ = new THREE.Color(skin.jersey), cA = new THREE.Color(skin.accent), cW = new THREE.Color('#f4f4f4');
  for (let i = 0; i < n; i++) {
    let c = cmap[reg[i]] || cmap[SKIN];
    const x = pa[i * 3], y = pa[i * 3 + 1];
    if (reg[i] === PSTRIPE && st.bolts) c = cA;
    if (reg[i] === SOCK && st.crewSocks) c = y > 0.4 ? cA : y > 0.27 ? (y > 0.315 && y < 0.34 ? cA : cJ) : cW;   // red band, navy with stripe, white crew socks
    if (reg[i] === SKIN && st.armSleeve && x < -0.25 && y < 1.25 && y > 0.75) c = cJ;                          // forearm sleeve
    if (reg[i] === TAPE && st.armSleeve) c = x > 0 ? cA : cW;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
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
  const helmet = buildHelmet(skin); owned.push(helmet.userData.disposeMat, helmet.userData.disposeMask);
  attach('head', helmet, new THREE.Vector3(0, eyeY + 0.03, eyeZ + 0.105));
  const iris = skin.eyes || IRIS[(skin.number || 0) % IRIS.length];
  for (const s of ['L', 'R']) attach('head', buildEye(meta.eyes[s].r * 0.95, iris), new THREE.Vector3(...meta.eyes[s].c));
  const padMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }); owned.push(padMat);
  // two white stripes around each sleeve, like a real game jersey
  const jgeo = new THREE.BufferGeometry();
  for (const k of ['position', 'skinIndex', 'skinWeight', 'normal']) jgeo.setAttribute(k, JERSEY_GEO.getAttribute(k));
  jgeo.setIndex(JERSEY_GEO.index); jgeo.boundingSphere = JERSEY_GEO.boundingSphere;
  {
    const jp = JERSEY_GEO.getAttribute('position').array, jc = new Float32Array(jp.length);
    const base = new THREE.Color(skin.jersey), white = new THREE.Color('#ffffff'), trim = new THREE.Color(skin.accent);
    const sh = info.meta.shoulder;
    for (let i = 0; i < jc.length / 3; i++) {
      const x = jp[i * 3], y = jp[i * 3 + 1], z = jp[i * 3 + 2];
      let col = base;
      if ((skin.style || {}).bolts) {
        if (Math.abs(x) > 0.12 && y > 1.3) {
          const d = (Math.abs(x) - Math.abs(sh[0])) * 0.6 - (y - sh[1]) * 0.8;   // down the arm
          const tri = (v) => 2 * Math.abs(v - Math.floor(v + 0.5));               // zig-zag
          const bolt = d - 0.02 - 0.045 * tri(z * 14 + 0.25);
          if (d > 0.06) col = trim;                                                 // red sleeve
          if (Math.abs(bolt) < 0.017) col = white;                                  // white lightning bolt
          else if (bolt > 0.017 && bolt < 0.04 && d < 0.06) col = trim;             // red edge under the bolt
        }
        jc[i * 3] = col.r; jc[i * 3 + 1] = col.g; jc[i * 3 + 2] = col.b;
        continue;
      }
      if (Math.abs(x) > 0.17) {
        // distance down the arm (arms rest angled out ~37 degrees)
        const d = (Math.abs(x) - Math.abs(sh[0])) * 0.6 - (y - sh[1]) * 0.8;
        if ((d > 0.085 && d < 0.1) || (d > 0.115 && d < 0.13)) col = white;
        else if (d >= 0.1 && d <= 0.115) col = trim;
      }
      jc[i * 3] = col.r; jc[i * 3 + 1] = col.g; jc[i * 3 + 2] = col.b;
    }
    jgeo.setAttribute('color', new THREE.BufferAttribute(jc, 3));
  }
  const jersey = new THREE.SkinnedMesh(jgeo, padMat);
  jersey.bind(mesh.skeleton, mesh.bindMatrix);
  mesh.add(jersey);
  const accMat = smat(skin.accent, 0.72);
  const sh = meta.shoulder;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), accMat);
  collar.rotation.x = Math.PI / 2;
  attach('spine01', collar, new THREE.Vector3(0, meta.neckY + 0.005, sh[2] + 0.01));
  // cleats over the feet
  const st2 = skin.style || {};
  const shoeMat = smat(st2.cleats || '#f4f4f4', 0.35, 0.02), soleMat = smat(st2.cleats ? '#f4f4f4' : '#1d1d1d', 0.5), stripeMat = smat(st2.cleats ? '#f4f4f4' : skin.jersey, 0.4);
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
  if (st2.crowns || st2.towel) {
    const crownTex = crownTexture();
    const crownMat = new THREE.MeshStandardMaterial({ map: crownTex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    owned.push(crownMat, crownTex);
    if (st2.crowns) for (const sx of [-1, 1]) {
      const cr = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.045), crownMat);
      cr.rotation.y = Math.PI; cr.rotation.x = 0.35;
      attach('spine01', cr, new THREE.Vector3(sx * 0.085, 1.475, CHEST.front - 0.05));
    }
    if (st2.towel) {
      const tg = new THREE.PlaneGeometry(0.11, 0.3, 1, 6);
      const tp = tg.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, -Math.pow((0.15 - tp.getY(i)) / 0.3, 2) * 0.03); // hangs out a little
      tg.computeVertexNormals();
      const towelTex = towelTexture(); owned.push(towelTex);
      const towel = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: towelTex, roughness: 0.95, side: THREE.DoubleSide }));
      owned.push(towel.material);
      towel.rotation.y = Math.PI;
      attach('root', towel, new THREE.Vector3(WAIST.cx + 0.075, WAIST.y - 0.165, WAIST.cz - WAIST.rz - 0.012));
    }
  }
  const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.036, 0.012, 2, 0.004), smat('#c9ccd1', 0.25, 0.9));
  attach('root', buckle, new THREE.Vector3(WAIST.cx, WAIST.y, WAIST.cz - WAIST.rz - 0.012));
  if (st2.pads) {
    const padMat2 = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(skin.pants).multiplyScalar(1.25), roughness: 0.45, clearcoat: 0.4 });
    owned.push(padMat2);
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? -1 : 1;
      const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), padMat2);
      thigh.scale.set(1.0, 0.42, 1.6); thigh.rotation.x = -Math.PI / 2 + 0.05;
      attach('upperleg02.' + s, thigh, new THREE.Vector3(LEGS[s].thighX, 0.79, LEGS[s].thighZ + 0.004));
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), padMat2);
      knee.scale.set(1.05, 0.5, 1.2); knee.rotation.x = -Math.PI / 2;
      attach('lowerleg01.' + s, knee, new THREE.Vector3(LEGS[s].kneeX + sx * 0.002, info.meta.kneeY + 0.01, LEGS[s].kneeZ + 0.004));
    }
  }
  const numTex = numberTexture(skin.number ?? 12, skin.accent, st2.whiteNumbers);
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4 });
  owned.push(numMat, numTex);
  for (const [z, ry] of [[CHEST.front - 0.036, Math.PI], [CHEST.back + 0.036, 0]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
    plate.rotation.y = ry;
    attach('spine02', plate, new THREE.Vector3(0, CHEST.y, z));
  }
  // hair and smile
  const hair = buildHair(skin);
  owned.push(...hair.mats);
  attach('head', hair.top, new THREE.Vector3());
  attach('head', hair.low, new THREE.Vector3());
  if (skin.smile !== false) {
    const smile = new THREE.Group();
    const teeth = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0065, 6, 16, Math.PI * 0.8), smat('#f7f4ee', 0.3));
    teeth.rotation.z = Math.PI + Math.PI * 0.1; teeth.scale.set(1.15, 0.75, 0.6);
    smile.add(teeth);
    for (const sx of [-1, 1]) { // smile lines at the mouth corners
      const dim = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), smat(new THREE.Color(skin.tone || '#c98e62').multiplyScalar(0.7).getStyle(), 0.6));
      dim.position.set(sx * 0.024, 0.003, 0.002); smile.add(dim);
    }
    attach('head', smile, new THREE.Vector3(MOUTH.x, MOUTH.y + 0.004, MOUTH.z - 0.002));
  }
  // eyebrows (shaped, in a darker shade of the hair color)
  {
    const browMat = smat(new THREE.Color(skin.hair || '#8a6239').multiplyScalar(0.55).getStyle(), 0.9);
    for (const s of ['L', 'R']) {
      const e = meta.eyes[s].c, sx = Math.sign(e[0]);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(e[0] - sx * 0.016, e[1] + 0.019, e[2] - 0.019),
        new THREE.Vector3(e[0] + sx * 0.002, e[1] + 0.025, e[2] - 0.018),
        new THREE.Vector3(e[0] + sx * 0.02, e[1] + 0.021, e[2] - 0.011),
      ]);
      const brow = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.0032, 5), browMat);
      attach('head', brow, new THREE.Vector3());
    }
  }
  const setHelmet = (on) => { helmet.visible = on; hair.top.visible = !on; };
  setHelmet(skin.helmetOn !== false);
  // weapon hand point
  const hand = new THREE.Group();
  attach('wrist.R', hand, restWorld('wrist.R').add(new THREE.Vector3(0, -0.07, -0.01)));
  hand.quaternion.identity();
  return { mesh, bones: byName, hand, owned, setHelmet };
}

function crownTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; g.lineJoin = 'round'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(14, 78); g.lineTo(10, 28); g.lineTo(38, 52); g.lineTo(64, 14); g.lineTo(90, 52); g.lineTo(118, 28); g.lineTo(114, 78); g.closePath(); g.fill();
  g.fillRect(14, 82, 100, 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function towelTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 176;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, 64, 176);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 64, Math.random() * 176, 1, 2); }
  g.fillStyle = '#2a2d3a';
  g.beginPath(); g.moveTo(17, 150); g.lineTo(15, 124); g.lineTo(25, 136); g.lineTo(32, 118); g.lineTo(39, 136); g.lineTo(49, 124); g.lineTo(47, 150); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function numberTexture(num, accent, whiteFill) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 82px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = whiteFill ? accent : '#ffffff'; g.strokeText(String(num), 64, 70);
  g.fillStyle = whiteFill ? '#ffffff' : accent; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
