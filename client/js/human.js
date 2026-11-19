// Realistic skinned football player built on the MakeHuman base body (CC0).
// The uniform is painted onto the body; helmet, face mask, pads and eyes are added on top.
//
// Performance notes (75 players on school Chromebooks):
// - Every material is shared by all players (colors live in per-player vertex colors).
// - All rigid accessories (helmet, mask, eyes, hair, cleats, belt, pads...) are baked into a few
//   skinned meshes that share the body's skeleton: ~8 draw calls per full-detail player instead of ~50.
//   Their geometry is cached per outfit *shape* and shared; each player only owns small color arrays.
// - Jersey numbers come from one shared digit atlas (no canvas texture per player).
// - Two lighter levels of detail are generated from the body at load time (no extra download):
//   'mid' = decimated body (~3k triangles) + simple helmet in ONE draw call,
//   'crowd' = very low-poly static body for the instanced far-away crowd (see players.js).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '/shared/rng.js';

let DATA = null;          // { info, attrs }
let BONE_INV = null;      // shared bind inverses
let CHEST = null;         // chest surface for jersey numbers
let FEET = null;          // foot boxes for the cleats
let WAIST = null;
let JERSEY_GEO = null;    // loose jersey shell over the shoulder pads (compacted)
let HEAD = null;          // head shape for hair
let MOUTH = null;         // where the smile goes
let LEGS = null;          // thigh/knee fronts for pads

const SKIN = 0, JERSEY = 1, PANTS = 2, SOCK = 3, SHOE = 4, GLOVE = 5, ACCENT = 6, BROW = 7, LIPS = 8, EYEBLACK = 9, TAPE = 10, LASH = 11, PSTRIPE = 12;

// Two bodies: 'm' (human.*) and 'f' (human_f.*). Each body keeps its own measurements.
const BODIES = {};
let BODY_KEY = 'm';
function useBody(key) {
  BODY_KEY = BODIES[key] ? key : 'm';
  const b = BODIES[BODY_KEY];
  ({ DATA, BONE_INV, CHEST, FEET, WAIST, JERSEY_GEO, HEAD, MOUTH, LEGS } = b);
  return b;
}
export async function loadHuman(base = '/assets/') {
  await loadBody(base, 'human', 'm');
  try { await loadBody(base, 'human_f', 'f'); } catch (e) { console.warn('female body missing', e); }
  useBody('m');
  return true;
}
async function loadBody(base, name, key) {
  BONE_INV = null;
  const [info, bin] = await Promise.all([
    fetch(base + name + '.json').then((r) => r.json()),
    fetch(base + name + '.bin').then((r) => r.arrayBuffer()),
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
    const nr = attrs.normal.array, ix = attrs.index.array, si = attrs.skinIndex.array, sw = attrs.skinWeight.array;
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const remap = new Int32Array(n).fill(-1), used = [], tri = [];
    for (let t = 0; t < ix.length; t += 3) {
      if (reg[ix[t]] !== JERSEY || reg[ix[t + 1]] !== JERSEY || reg[ix[t + 2]] !== JERSEY) continue;
      for (let k = 0; k < 3; k++) {
        const v = ix[t + k];
        if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
        tri.push(remap[v]);
      }
    }
    const m = used.length, pos = new Float32Array(m * 3), sIdx = new Uint8Array(m * 4), sWt = new Uint8Array(m * 4);
    used.forEach((i, j) => {
      const x = p[i * 3], y = p[i * 3 + 1];
      let off = 0.016 + 0.014 * smooth(1.15, 1.32, y);                      // fabric hangs looser on the chest
      off += 0.05 * smooth(1.36, 1.5, y) * (1 - smooth(1.5, 1.6, y));       // shoulder pads underneath
      if (Math.abs(x) > 0.22) off = 0.022 + 0.03 * smooth(1.3, 1.45, y);    // sleeves
      for (let a = 0; a < 3; a++) pos[j * 3 + a] = p[i * 3 + a] + nr[i * 3 + a] * off;
      for (let a = 0; a < 4; a++) { sIdx[j * 4 + a] = si[i * 4 + a]; sWt[j * 4 + a] = sw[i * 4 + a]; }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sWt, 4, true));
    g.setIndex(tri);
    g.computeVertexNormals();
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
  const boneIndex = Object.fromEntries(info.bones.map((b, i) => [b.name, i]));
  BODIES[key] = { DATA, BONE_INV, CHEST, FEET, WAIST, JERSEY_GEO, HEAD, MOUTH, LEGS, boneIndex, key };
  return true;
}
export const humanReady = () => !!DATA;

// ---------- shared materials ----------
let SM = null;
function mats() {
  if (SM) return SM;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  SM = {
    body: [
      std({ vertexColors: true, roughness: 0.48, metalness: 0 }),   // skin, face
      std({ vertexColors: true, roughness: 0.72, metalness: 0 }),   // fabric
      std({ vertexColors: true, roughness: 0.35, metalness: 0.05 }), // cleats
    ],
    cloth: std({ vertexColors: true, roughness: 0.66, side: THREE.DoubleSide }),
    gloss: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide }),
    shiny: std({ vertexColors: true, roughness: 0.2 }),
    visor: std({ color: 0x0b0b0e, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    numbers: numberMaterial(),
    crown: std({ map: crownTexture(), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }),
    towel: std({ map: towelTexture(), roughness: 0.95, side: THREE.DoubleSide }),
    mid: std({ vertexColors: true, roughness: 0.62 }),
  };
  return SM;
}
// Low quality: drop the clear-coat layer (the most expensive shader on weak GPUs).
export function setCharacterQuality(level) {
  const m = mats();
  const cc = level === 'low' ? 0 : 1;
  if (m.gloss.clearcoat !== cc) { m.gloss.clearcoat = cc; m.gloss.needsUpdate = true; }
}

// ---------- colors ----------
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
// Body vertex color (shared by the full and mid detail meshes)
function bodyColor(skin, cmap, reg, x, y) {
  const st = skin.style || {};
  let c = cmap[reg] || cmap[SKIN];
  if (reg === PSTRIPE && st.bolts) c = cmap.cA;
  if (reg === SOCK && st.crewSocks) c = y > 0.4 ? cmap.cA : y > 0.27 ? (y > 0.315 && y < 0.34 ? cmap.cA : cmap.cJ) : cmap.cW;   // red band, navy with stripe, white crew socks
  if (reg === SKIN && st.armSleeve && x < -0.25 && y < 1.25 && y > 0.75) c = cmap.cJ;                                          // forearm sleeve
  if (reg === TAPE && st.armSleeve) c = x > 0 ? cmap.cA : cmap.cW;
  if (st.referee) {
    if (reg === GLOVE || reg === TAPE) c = cmap[SKIN];
    if (reg === SOCK) c = cmap.black;
    if (reg === PSTRIPE) c = cmap[PANTS];
  }
  return c;
}
function bodyCmap(skin) {
  const cmap = regionColors(skin);
  cmap.cJ = new THREE.Color(skin.jersey); cmap.cA = new THREE.Color(skin.accent); cmap.cW = new THREE.Color('#f4f4f4'); cmap.black = new THREE.Color('#151515');
  return cmap;
}
const IRIS = ['#4a2e1c', '#2f5f8a', '#3f6b3a', '#6b4a2a', '#5a4632'];
// Color slots used by the baked accessories; palette(skin) gives each slot its color for one player.
const SLOT_NAMES = ['helmet', 'mask', 'stripe', 'accent', 'white', 'bumper', 'eyeWhite', 'iris', 'pupil', 'shine', 'shoe', 'sole',
  'shoeStripe', 'metal', 'pads', 'hair', 'hair2', 'teeth', 'dimple', 'brow', 'horns', 'black'];
const S = Object.fromEntries(SLOT_NAMES.map((n, i) => [n, i]));
function palette(skin) {
  const c = (h) => new THREE.Color(h);
  const st = skin.style || {};
  const hair = c(skin.hair || '#8a6239');
  const P = {
    helmet: c(skin.helmet), mask: c(skin.mask), stripe: c(skin.stripe), accent: c(skin.accent), white: c('#f2efe8'), bumper: c('#222222'),
    eyeWhite: c('#f4f1ec'), iris: c(skin.eyes || IRIS[(skin.number || 0) % IRIS.length]), pupil: c('#050505'), shine: c('#ffffff'),
    shoe: c(st.cleats || '#f4f4f4'), sole: c(st.cleats ? '#f4f4f4' : '#1d1d1d'), shoeStripe: c(st.cleats ? '#f4f4f4' : skin.jersey),
    metal: c('#c9ccd1'), pads: c(skin.pants).multiplyScalar(1.25), hair, hair2: hair.clone().lerp(c('#ffffff'), 0.18),
    teeth: c('#f7f4ee'), dimple: c(skin.tone || '#c98e62').multiplyScalar(0.7), brow: hair.clone().multiplyScalar(0.55),
    horns: c(skin.horns || '#e8e0cc'), black: c('#111111'),
  };
  return SLOT_NAMES.map((n) => P[n]);
}
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
function colorAttr(count) { return new THREE.BufferAttribute(new Uint8Array(count * 3), 3, true); }
function setC(arr, i, c) { arr[i * 3] = u8(c.r); arr[i * 3 + 1] = u8(c.g); arr[i * 3 + 2] = u8(c.b); }

// ---------- accessory shapes (built once per outfit shape, then baked into skinned geometry) ----------
// SEGK scales the curve segments: 1 for the close-up Locker Room, ~0.55 in a match (players are never that close).
let SEGK = 1;
const sg = (n) => Math.max(3, Math.round(n * SEGK));
// part(geo, cls, slot): cls = which shared material (cloth | gloss | shiny | visor | crown | towel).
function part(geo, cls, slot = 0) { const m = new THREE.Mesh(geo); m.userData.cls = cls; m.userData.slot = slot; return m; }

function buildHelmet(skin) {
  const g = new THREE.Group();
  const R = 0.15;
  const dome = part(new THREE.SphereGeometry(R, sg(32), sg(16), 0, Math.PI * 2, 0, 1.2), 'gloss', S.helmet);
  dome.scale.set(0.93, 1.0, 1.12); g.add(dome);
  const shell = part(new THREE.SphereGeometry(R, sg(32), sg(12), -Math.PI * 0.22, Math.PI * 1.44, 1.15, 0.98), 'gloss', S.helmet);
  shell.scale.set(0.93, 1.0, 1.12); g.add(shell);
  // center stripe follows the curve of the shell from forehead to the back
  const stripe = part(new THREE.TorusGeometry(R * 1.005, 0.009, sg(6), sg(28), Math.PI - 0.55), 'gloss', S.stripe);
  stripe.rotation.y = Math.PI / 2; stripe.rotation.z = 0.3; stripe.scale.set(1.12, 1, 0.5); g.add(stripe);
  for (const sx of [-1, 1]) {
    const jaw = part(new THREE.BoxGeometry(0.02, 0.075, 0.08), 'gloss', S.helmet);
    jaw.position.set(sx * 0.118, -0.07, -0.06); jaw.rotation.y = sx * 0.35; g.add(jaw);
    const clip = part(new THREE.SphereGeometry(0.018, sg(10), sg(8)), 'gloss', S.mask);
    clip.position.set(sx * 0.133, -0.02, -0.04); clip.scale.set(0.4, 1, 1); g.add(clip);
  }
  // face mask cage: thick coated bars like a real lineman/receiver mask
  for (const [y, r, arc] of [[-0.03, 0.152, 0.6], [-0.062, 0.15, 0.62], [-0.094, 0.143, 0.64], [-0.124, 0.122, 0.56]]) {
    const bar = part(new THREE.TorusGeometry(r, 0.0085, sg(8), sg(28), Math.PI * arc), 'gloss', S.mask);
    bar.rotation.x = Math.PI / 2; bar.rotation.z = Math.PI + Math.PI * (1 - arc) / 2; bar.position.set(0, y, 0.008);
    g.add(bar);
  }
  for (const sx of [-0.05, 0, 0.05]) {
    const v = part(new THREE.CylinderGeometry(0.0075, 0.0075, 0.11, 8), 'gloss', S.mask);
    v.position.set(sx, -0.075, -0.14 + Math.abs(sx) * 0.25); v.rotation.x = -0.18; g.add(v);
  }
  for (const sx of [-1, 1]) { // side bars that hook to the helmet
    const sb = part(new THREE.CylinderGeometry(0.007, 0.007, 0.075, 8), 'gloss', S.mask);
    sb.position.set(sx * 0.118, -0.06, -0.075); sb.rotation.set(0.6, 0, sx * 0.35); g.add(sb);
  }
  const bumper = part(new THREE.BoxGeometry(0.05, 0.016, 0.014), 'cloth', S.bumper); // nose bumper
  bumper.position.set(0, -0.018, -0.155); g.add(bumper);
  const visor = part(new THREE.SphereGeometry(R * 0.97, sg(24), sg(8), Math.PI * 1.5 - 0.85, 1.7, 1.28, 0.42), 'visor');
  visor.scale.set(0.93, 1.0, 1.12); g.add(visor);
  const strap = part(new THREE.TorusGeometry(0.065, 0.008, 6, 18, Math.PI), 'cloth', S.white);
  strap.position.set(0, -0.11, -0.03); strap.rotation.set(-0.45, 0, Math.PI); g.add(strap);
  if (skin.horns) {
    for (const side of [-1, 1]) {
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.16, 0, 0),
        new THREE.Vector3(side * 0.3, 0.03, 0), new THREE.Vector3(side * 0.38, 0.16, -0.03));
      const horn = part(new THREE.TubeGeometry(curve, sg(16), 0.03, sg(10)), 'gloss', S.horns);
      const tip = part(new THREE.ConeGeometry(0.03, 0.08, 10), 'gloss', S.horns);
      tip.position.copy(curve.getPoint(1)); tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1));
      const h = new THREE.Group(); h.add(horn, tip);
      h.position.set(side * 0.12, 0.05, 0.01);
      g.add(h);
    }
  }
  return g;
}

function buildEye(r) {
  const g = new THREE.Group();
  g.add(part(new THREE.SphereGeometry(r, sg(20), sg(16)), 'shiny', S.eyeWhite));
  const ir = part(new THREE.SphereGeometry(r * 0.52, sg(18), sg(12)), 'shiny', S.iris);
  ir.scale.z = 0.35; ir.position.z = -r * 0.86; g.add(ir);
  const pu = part(new THREE.SphereGeometry(r * 0.24, sg(12), sg(8)), 'shiny', S.pupil);
  pu.scale.z = 0.3; pu.position.z = -r * 0.95; g.add(pu);
  const hl = part(new THREE.SphereGeometry(r * 0.1, sg(8), sg(6)), 'shiny', S.shine);
  hl.position.set(r * 0.25, r * 0.25, -r * 0.98); g.add(hl);
  return g;
}

// Hair: lots of small soft clumps laid over the scalp. Returns { top, low } groups
// (top hides under the helmet; low is what sticks out the back).
function buildHair(skin) {
  const style = skin.hairStyle || 'wavy';
  const rnd = makeRng(style.length * 7919 + 13);
  const { c, r, eyeY } = HEAD;
  const cut = eyeY - 0.045;
  const tops = [[], []], lows = [[], []];
  const up = new THREE.Vector3(0, 1, 0);
  if (style === 'buzz') {
    const g = new THREE.SphereGeometry(1, sg(28), sg(14), 0, Math.PI * 2, 0, 1.45);
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
      const g = new THREE.SphereGeometry(rad, sg(7), sg(5));
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
        const g = new THREE.SphereGeometry(0.024 + rnd() * 0.008, sg(7), sg(5));
        g.scale(1, 1.6, 0.55);
        g.rotateX(0.5); g.rotateZ((i / 25 - 0.5) * 0.8);
        g.translate(c[0] + Math.cos(a) * r[0] * 0.95, cut - 0.03 - rnd() * 0.02, c[2] + Math.sin(a) * r[2] * 0.85 + 0.01);
        lows[rnd() < 0.7 ? 0 : 1].push(g);
      }
    }
  }
  const make = (sets) => {
    const g = new THREE.Group();
    sets.forEach((list, k) => { if (list.length) g.add(part(mergeGeometries(list), 'cloth', k ? S.hair2 : S.hair)); list.forEach((x) => x.dispose()); });
    return g;
  };
  return { top: make(tops), low: make(lows) };
}

// Everything rigid that sits on the body, as a list of { obj, bone, at } (at = rest-pose position).
function buildAccessories(skin) {
  const { info } = DATA;
  const meta = info.meta, st2 = skin.style || {};
  const list = [];
  const put = (bone, obj, at) => list.push({ obj, bone, at });
  const eyeY = meta.eyes.L.c[1], eyeZ = meta.eyes.L.c[2];
  const helmetOn = skin.helmetOn !== false && !st2.referee;
  if (helmetOn) put('head', buildHelmet(skin), new THREE.Vector3(0, eyeY + 0.03, eyeZ + 0.105));
  for (const s of ['L', 'R']) put('head', buildEye(meta.eyes[s].r * 0.95), new THREE.Vector3(...meta.eyes[s].c));
  const sh = meta.shoulder;
  const collar = part(new THREE.TorusGeometry(0.075, 0.016, sg(8), sg(20)), 'cloth', S.accent);
  collar.rotation.x = Math.PI / 2;
  put('spine01', collar, new THREE.Vector3(0, meta.neckY + 0.005, sh[2] + 0.01));
  // cleats over the feet
  for (const s of ['L', 'R']) {
    const f = FEET[s];
    const w = f.max[0] - f.min[0] + 0.022, h = f.max[1] - f.min[1] + 0.012, d = f.max[2] - f.min[2] + 0.03;
    const shoe = new THREE.Group();
    shoe.add(part(new RoundedBoxGeometry(w, h, d, SEGK < 1 ? 2 : 3, Math.min(w, h) * 0.45), 'gloss', S.shoe));
    const sole = part(new RoundedBoxGeometry(w * 0.92, 0.016, d * 0.9, 2, 0.007), 'cloth', S.sole);
    sole.position.y = -h / 2 + 0.006; shoe.add(sole);
    for (const sx of [-1, 1]) {
      const st = part(new THREE.BoxGeometry(0.004, h * 0.35, d * 0.4), 'cloth', S.shoeStripe);
      st.position.set(sx * (w / 2 + 0.001), -h * 0.05, -d * 0.05); st.rotation.x = 0.5; shoe.add(st);
    }
    put('foot.' + s, shoe, new THREE.Vector3((f.min[0] + f.max[0]) / 2, (f.min[1] + f.max[1]) / 2 + 0.004, (f.min[2] + f.max[2]) / 2 - 0.008));
  }
  // belt around the waist (covers the jersey/pants line)
  const belt = part(new THREE.CylinderGeometry(1, 1, 0.045, sg(32), 1, true), 'cloth', S.accent);
  belt.scale.set(WAIST.rx + 0.008, 1, WAIST.rz + 0.008);
  put('root', belt, new THREE.Vector3(WAIST.cx, WAIST.y, WAIST.cz));
  if (st2.crowns) for (const sx of [-1, 1]) {
    const cr = part(new THREE.PlaneGeometry(0.06, 0.045), 'crown');
    cr.rotation.y = Math.PI; cr.rotation.x = 0.35;
    put('spine01', cr, new THREE.Vector3(sx * 0.085, 1.475, CHEST.front - 0.05));
  }
  if (st2.towel) {
    const tg = new THREE.PlaneGeometry(0.11, 0.3, 1, 6);
    const tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, -Math.pow((0.15 - tp.getY(i)) / 0.3, 2) * 0.03); // hangs out a little
    tg.computeVertexNormals();
    const towel = part(tg, 'towel');
    towel.rotation.y = Math.PI;
    put('root', towel, new THREE.Vector3(WAIST.cx + 0.075, WAIST.y - 0.165, WAIST.cz - WAIST.rz - 0.012));
  }
  put('root', part(new RoundedBoxGeometry(0.05, 0.036, 0.012, 2, 0.004), 'gloss', S.metal), new THREE.Vector3(WAIST.cx, WAIST.y, WAIST.cz - WAIST.rz - 0.012));
  if (st2.pads) {
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? -1 : 1;
      const thigh = part(new THREE.SphereGeometry(0.075, sg(18), sg(12), 0, Math.PI * 2, 0, Math.PI * 0.5), 'gloss', S.pads);
      thigh.scale.set(1.0, 0.42, 1.6); thigh.rotation.x = -Math.PI / 2 + 0.05;
      put('upperleg02.' + s, thigh, new THREE.Vector3(LEGS[s].thighX, 0.79, LEGS[s].thighZ + 0.004));
      const knee = part(new THREE.SphereGeometry(0.06, sg(18), sg(12), 0, Math.PI * 2, 0, Math.PI * 0.5), 'gloss', S.pads);
      knee.scale.set(1.05, 0.5, 1.2); knee.rotation.x = -Math.PI / 2;
      put('lowerleg01.' + s, knee, new THREE.Vector3(LEGS[s].kneeX + sx * 0.002, info.meta.kneeY + 0.01, LEGS[s].kneeZ + 0.004));
    }
  }
  // hair (the top part only shows without a helmet) and smile
  const hair = buildHair(skin);
  if (!helmetOn && !st2.referee) put('head', hair.top, new THREE.Vector3());
  put('head', hair.low, new THREE.Vector3());
  if (skin.smile !== false) {
    const smile = new THREE.Group();
    const teeth = part(new THREE.TorusGeometry(0.019, 0.0065, 6, 16, Math.PI * 0.8), 'shiny', S.teeth);
    teeth.rotation.z = Math.PI + Math.PI * 0.1; teeth.scale.set(1.15, 0.75, 0.6);
    smile.add(teeth);
    for (const sx of [-1, 1]) { // smile lines at the mouth corners
      const dim = part(new THREE.SphereGeometry(0.004, 6, 4), 'cloth', S.dimple);
      dim.position.set(sx * 0.024, 0.003, 0.002); smile.add(dim);
    }
    put('head', smile, new THREE.Vector3(MOUTH.x, MOUTH.y + 0.004, MOUTH.z - 0.002));
  }
  // eyebrows (shaped, in a darker shade of the hair color)
  for (const s of ['L', 'R']) {
    const e = meta.eyes[s].c, sx = Math.sign(e[0]);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(e[0] - sx * 0.016, e[1] + 0.019, e[2] - 0.019),
      new THREE.Vector3(e[0] + sx * 0.002, e[1] + 0.025, e[2] - 0.018),
      new THREE.Vector3(e[0] + sx * 0.02, e[1] + 0.021, e[2] - 0.011),
    ]);
    put('head', part(new THREE.TubeGeometry(curve, 8, 0.0032, 5), 'cloth', S.brow), new THREE.Vector3());
  }
  if (st2.referee) {
    const cap = new THREE.Group();
    const R = Math.max(HEAD.r[0], HEAD.r[2]) * 1.07;
    const dome = part(new THREE.SphereGeometry(R, sg(24), sg(10), 0, Math.PI * 2, 0, 1.3), 'cloth', S.helmet);
    dome.scale.set(HEAD.r[0] / R * 1.07, 0.9, 1.0); cap.add(dome);
    const brim = part(new THREE.CylinderGeometry(R * 0.85, R * 0.85, 0.008, sg(24), 1, false, Math.PI * 0.5, Math.PI), 'cloth', S.black);
    brim.position.set(0, R * 0.2, -R * 0.45); brim.rotation.x = 0.12; cap.add(brim);
    const button = part(new THREE.SphereGeometry(0.01, 8, 6), 'cloth', S.black); button.position.y = R * 0.9; cap.add(button);
    put('head', cap, new THREE.Vector3(HEAD.c[0], HEAD.c[1] + 0.005, HEAD.c[2] + 0.004));
    // whistle on a lanyard
    const cord = part(new THREE.TorusGeometry(0.085, 0.003, 6, 30), 'cloth', S.black);
    cord.rotation.x = Math.PI / 2 - 0.5; cord.scale.set(1, 1.35, 1);
    put('spine01', cord, new THREE.Vector3(0, info.meta.neckY - 0.06, CHEST.front * 0.25));
    const wh = new THREE.Group();
    const whb = part(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 12), 'gloss', S.metal); whb.rotation.z = Math.PI / 2; wh.add(whb);
    const mouthpiece = part(new THREE.BoxGeometry(0.01, 0.008, 0.024), 'gloss', S.metal); mouthpiece.position.set(0, 0.004, -0.01); wh.add(mouthpiece);
    put('spine01', wh, new THREE.Vector3(0, info.meta.neckY - 0.17, CHEST.front - 0.03));
  }
  return list;
}

// Merge plain geometries (position, normal, optional uv) + rigid bone binding into one skinned geometry.
function mergeSkinned(items, withUv) {
  let nv = 0, ni = 0;
  for (const it of items) { nv += it.geo.attributes.position.count; ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = withUv ? new Float32Array(nv * 2) : null;
  const si = new Uint8Array(nv * 4), sw = new Uint8Array(nv * 4), slots = new Uint8Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const it of items) {
    const g = it.geo, n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3);
    nrm.set(g.attributes.normal.array, v * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
    if (it.skinIndex) { si.set(it.skinIndex, v * 4); sw.set(it.skinWeight, v * 4); }
    else for (let i = 0; i < n; i++) { si[(v + i) * 4] = it.bone; sw[(v + i) * 4] = 255; }
    slots.fill(it.slot, v, v + n);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[k++] = a[i] + v; }
    else for (let i = 0; i < n; i++) idx[k++] = v + i;
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: out, slots };
}

// Cached per outfit shape: { cls: { geo, slots, shell } } (cloth starts with the loose jersey shell).
const ACC_CACHE = new Map();
function accessoryKey(skin) {
  const st = skin.style || {};
  return [BODY_KEY, SEGK, skin.hairStyle || 'wavy', skin.helmetOn !== false, !!skin.horns, !!st.crowns, !!st.towel, !!st.pads, !!st.referee, skin.smile !== false].join('|');
}
function accessoryGeometry(skin) {
  const key = accessoryKey(skin);
  if (ACC_CACHE.has(key)) return ACC_CACHE.get(key);
  const bi = BODIES[BODY_KEY].boneIndex;
  const byCls = {};
  for (const { obj, bone, at } of buildAccessories(skin)) {
    obj.position.copy(at);   // at rest, an accessory sits at `at` with its own rotation/scale
    obj.updateMatrixWorld(true);
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      g.applyMatrix4(m.matrixWorld);
      (byCls[m.userData.cls] = byCls[m.userData.cls] || []).push({ geo: g, bone: bi[bone], slot: m.userData.slot });
      m.geometry.dispose();
    });
  }
  // the loose jersey shell (already skinned) goes first in the cloth mesh
  const shell = JERSEY_GEO.attributes.position.count;
  (byCls.cloth = byCls.cloth || []).unshift({ geo: JERSEY_GEO, skinIndex: JERSEY_GEO.attributes.skinIndex.array, skinWeight: JERSEY_GEO.attributes.skinWeight.array, slot: 0 });
  const out = {};
  for (const [cls, items] of Object.entries(byCls)) {
    out[cls] = mergeSkinned(items, cls === 'crown' || cls === 'towel');
    out[cls].shell = cls === 'cloth' ? shell : 0;
    for (const it of items) if (it.geo !== JERSEY_GEO) it.geo.dispose();
  }
  ACC_CACHE.set(key, out);
  return out;
}

// Per-player geometry that shares every attribute of `src` except the ones passed in `own`.
function shareGeometry(src, own) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  for (const [k, a] of Object.entries(own)) g.setAttribute(k, a);
  g.setIndex(src.index);
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.userData.own = Object.keys(own);
  return g;
}
// Free a per-player geometry but keep the shared attributes on the GPU: three deletes the GL buffer
// of every attribute a disposed geometry still references, even if other players use it.
function disposeShared(g) {
  const own = g.userData.own || [];
  for (const k of Object.keys(g.attributes)) if (!own.includes(k)) g.deleteAttribute(k);
  g.setIndex(null);
  g.dispose();
}

// Jersey shell colors: stripes on the sleeves, lightning bolts, referee stripes.
function paintShell(skin, arr) {
  const jp = JERSEY_GEO.attributes.position.array, sh = DATA.info.meta.shoulder, st = skin.style || {};
  const base = new THREE.Color(skin.jersey), white = new THREE.Color('#ffffff'), trim = new THREE.Color(skin.accent), black = new THREE.Color('#111111');
  for (let i = 0; i < jp.length / 3; i++) {
    const x = jp[i * 3], y = jp[i * 3 + 1], z = jp[i * 3 + 2];
    let col = base;
    if (st.referee) col = Math.floor((x + 1) / 0.034) % 2 ? black : white;
    else if (st.bolts) {
      if (Math.abs(x) > 0.12 && y > 1.3) {
        const d = (Math.abs(x) - Math.abs(sh[0])) * 0.6 - (y - sh[1]) * 0.8;   // down the arm
        const tri = (v) => 2 * Math.abs(v - Math.floor(v + 0.5));               // zig-zag
        const bolt = d - 0.02 - 0.045 * tri(z * 14 + 0.25);
        if (d > 0.06) col = trim;                                                 // red sleeve
        if (Math.abs(bolt) < 0.017) col = white;                                  // white lightning bolt
        else if (bolt > 0.017 && bolt < 0.04 && d < 0.06) col = trim;             // red edge under the bolt
      }
    } else if (Math.abs(x) > 0.17) {
      // distance down the arm (arms rest angled out ~37 degrees)
      const d = (Math.abs(x) - Math.abs(sh[0])) * 0.6 - (y - sh[1]) * 0.8;
      if ((d > 0.085 && d < 0.1) || (d > 0.115 && d < 0.13)) col = white;
      else if (d >= 0.1 && d <= 0.115) col = trim;
    }
    setC(arr, i, col);
  }
}

// ---------- jersey numbers: one shared atlas with 0..99 ----------
let NUM_ATLAS = null;
function numberAtlas() {
  if (NUM_ATLAS) return NUM_ATLAS;
  // R = fill coverage, G = outline coverage (the shader colors them per player)
  const C = 64, c = document.createElement('canvas'); c.width = c.height = C * 10;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.font = 'bold 41px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 4.5; g.lineJoin = 'round';
  for (let n = 0; n < 100; n++) {
    const x = (n % 10) * C + C / 2, y = Math.floor(n / 10) * C + 35;
    g.strokeStyle = '#00ff00'; g.strokeText(String(n), x, y);
    g.fillStyle = '#ff0000'; g.fillText(String(n), x, y);
  }
  NUM_ATLAS = new THREE.CanvasTexture(c);
  NUM_ATLAS.colorSpace = THREE.NoColorSpace;
  NUM_ATLAS.anisotropy = 4;
  return NUM_ATLAS;
}
function numberMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: numberAtlas(), transparent: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 fillC;\nattribute vec3 strokeC;\nvarying vec3 vFill;\nvarying vec3 vStroke;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = fillC; vStroke = strokeC;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFill;\nvarying vec3 vStroke;')
      .replace('#include <map_fragment>', 'vec4 nt = texture2D( map, vMapUv );\nfloat cov = clamp( nt.r + nt.g, 0.0, 1.0 );\ndiffuseColor = vec4( ( vFill * nt.r + vStroke * nt.g ) / max( cov, 0.001 ), opacity * cov );');
  };
  m.customProgramCacheKey = () => 'fr-numbers';
  return m;
}
const PLATE_CACHE = new Map();
function numberGeometry(skin) {
  const st = skin.style || {};
  const key = BODY_KEY + (st.referee ? 'r' : '');
  if (!PLATE_CACHE.has(key)) {
    const bone = BODIES[BODY_KEY].boneIndex.spine02;
    const items = [];
    for (const [z, ry] of (st.referee ? [[CHEST.back + 0.036, 0]] : [[CHEST.front - 0.036, Math.PI], [CHEST.back + 0.036, 0]])) {
      const g = new THREE.PlaneGeometry(0.3, 0.3);
      g.rotateY(ry); g.translate(0, CHEST.y, z);
      items.push({ geo: g, bone, slot: 0 });
    }
    PLATE_CACHE.set(key, mergeSkinned(items, true).geo);
  }
  const src = PLATE_CACHE.get(key), n = src.attributes.position.count;
  const num = Math.max(0, Math.min(99, Math.round(skin.number ?? 12))), cx = num % 10, cy = Math.floor(num / 10);
  const uv = new Float32Array(n * 2), suv = src.attributes.uv.array;
  for (let i = 0; i < n; i++) { uv[i * 2] = (cx + suv[i * 2]) / 10; uv[i * 2 + 1] = 1 - (cy + 1 - suv[i * 2 + 1]) / 10; }
  const fill = colorAttr(n), stroke = colorAttr(n);
  const acc = new THREE.Color(skin.accent), wh = new THREE.Color('#ffffff');
  for (let i = 0; i < n; i++) { setC(fill.array, i, st.whiteNumbers ? wh : acc); setC(stroke.array, i, st.whiteNumbers ? acc : wh); }
  return shareGeometry(src, { uv: new THREE.BufferAttribute(uv, 2), fillC: fill, strokeC: stroke });
}

// ---------- decimated bodies for the lighter levels of detail ----------
// Region-aware vertex clustering: vertices of the same paint region inside one grid cell merge into
// one (skin weights from the vertex nearest to the cell average), degenerate triangles are dropped.
function cluster(cell, regionClass) {
  const { attrs } = DATA;
  return clusterMesh(attrs.position.array, attrs.index.array, attrs.skinIndex.array, attrs.skinWeight.array, attrs.region, cell, regionClass);
}
function clusterMesh(p, ix, srcSi, srcSw, reg, cell, regionClass) {
  const n = p.length / 3;
  const keyOf = new Map(), remap = new Int32Array(n), sum = [], members = [];
  for (let i = 0; i < n; i++) {
    const k = `${regionClass(reg[i])}|${Math.floor(p[i * 3] / cell)}|${Math.floor(p[i * 3 + 1] / cell)}|${Math.floor(p[i * 3 + 2] / cell)}`;
    let c = keyOf.get(k);
    if (c === undefined) { c = sum.length; keyOf.set(k, c); sum.push([0, 0, 0]); members.push([]); }
    remap[i] = c; members[c].push(i);
    sum[c][0] += p[i * 3]; sum[c][1] += p[i * 3 + 1]; sum[c][2] += p[i * 3 + 2];
  }
  const m = sum.length, pos = new Float32Array(m * 3), rep = new Int32Array(m);
  for (let c = 0; c < m; c++) {
    const k = members[c].length, ax = sum[c][0] / k, ay = sum[c][1] / k, az = sum[c][2] / k;
    pos[c * 3] = ax; pos[c * 3 + 1] = ay; pos[c * 3 + 2] = az;
    let best = members[c][0], bd = Infinity;
    for (const i of members[c]) { const d = (p[i * 3] - ax) ** 2 + (p[i * 3 + 1] - ay) ** 2 + (p[i * 3 + 2] - az) ** 2; if (d < bd) { bd = d; best = i; } }
    rep[c] = best;
  }
  const tri = [], seen = new Set();
  for (let t = 0; t < ix.length; t += 3) {
    const a = remap[ix[t]], b = remap[ix[t + 1]], c = remap[ix[t + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((u, v) => u - v).join(',');
    if (seen.has(s)) continue;
    seen.add(s); tri.push(a, b, c);
  }
  const si = new Uint8Array(m * 4), sw = new Uint8Array(m * 4), region = new Uint8Array(m);
  for (let c = 0; c < m; c++) {
    const r = rep[c];
    for (let a = 0; a < 4; a++) { si[c * 4 + a] = srcSi[r * 4 + a]; sw[c * 4 + a] = srcSw[r * 4 + a]; }
    region[c] = reg[r];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
  g.setIndex(tri);
  g.computeVertexNormals();
  return { geo: g, region };
}
// In-match full-detail body: fine clustering, triangles regrouped by material (skin/fabric/cleats).
const GAME_BODY = new Map();
function gameBody() {
  if (GAME_BODY.has(BODY_KEY)) return GAME_BODY.get(BODY_KEY);
  const { attrs, info } = DATA;
  const ix = attrs.index.array, reg = attrs.region, regionMat = new Uint8Array(256);
  for (const gr of info.groups) for (let t = gr.start; t < gr.start + gr.count; t += 3) regionMat[reg[ix[t]]] = gr.mat;
  const c = cluster(0.0135, (r) => r);
  const tri = c.geo.index.array, buckets = [[], [], []];
  for (let t = 0; t < tri.length; t += 3) buckets[regionMat[c.region[tri[t]]]].push(tri[t], tri[t + 1], tri[t + 2]);
  const idx = [].concat(...buckets);
  c.geo.setIndex(idx);
  let start = 0;
  buckets.forEach((b, m) => { if (b.length) c.geo.addGroup(start, b.length, m); start += b.length; });
  GAME_BODY.set(BODY_KEY, c);
  return c;
}
const MID_CACHE = new Map();
// Mid detail: decimated body + a simple helmet/cap (slot 255 = helmet color, 254 = hair) in one skinned mesh.
function midGeometry(capKind) {
  const key = BODY_KEY + capKind;
  if (MID_CACHE.has(key)) return MID_CACHE.get(key);
  const body = cluster(0.042, (r) => r);
  const meta = DATA.info.meta, bi = BODIES[BODY_KEY].boneIndex;
  // the loose jersey shell too, so the shoulders keep their padded shape
  const J = JERSEY_GEO.attributes;
  const shell = clusterMesh(J.position.array, JERSEY_GEO.index.array, J.skinIndex.array, J.skinWeight.array, new Uint8Array(J.position.count).fill(JERSEY), 0.042, (r) => r);
  const items = [body, shell].map((c) => ({ geo: c.geo, skinIndex: c.geo.attributes.skinIndex.array, skinWeight: c.geo.attributes.skinWeight.array, slot: 0 }));
  const capGeo = capKind === 'helmet'
    ? new THREE.SphereGeometry(0.15, 12, 7, 0, Math.PI * 2, 0, 1.75)
    : new THREE.SphereGeometry(Math.max(HEAD.r[0], HEAD.r[2]) * 1.05, 10, 5, 0, Math.PI * 2, 0, 1.35);
  if (capKind === 'helmet') { capGeo.scale(0.93, 1.0, 1.12); capGeo.rotateX(-0.25); capGeo.translate(0, meta.eyes.L.c[1] + 0.03, meta.eyes.L.c[2] + 0.105); }
  else capGeo.translate(HEAD.c[0], HEAD.c[1], HEAD.c[2] + 0.005);
  items.push({ geo: capGeo, bone: bi.head, slot: 1 });
  const merged = mergeSkinned(items, false);
  const region = new Uint8Array(merged.geo.attributes.position.count).fill(255);
  region.set(body.region, 0);
  region.set(shell.region, body.region.length);
  const out = { geo: merged.geo, region, tris: merged.geo.index.count / 3 };
  body.geo.dispose(); shell.geo.dispose(); capGeo.dispose();
  MID_CACHE.set(key, out);
  return out;
}
// Far crowd: very low-poly static body. Vertex attribute `part`: 0 jersey, 1 pants, 2 skin, 3 helmet, 4 white.
const CROWD_PART = { [JERSEY]: 0, [SOCK]: 0, [ACCENT]: 0, [PANTS]: 1, [PSTRIPE]: 1, [SKIN]: 2, [BROW]: 2, [LIPS]: 2, [LASH]: 2, [EYEBLACK]: 2, [SHOE]: 4, [GLOVE]: 4, [TAPE]: 4 };
const CROWD_CACHE = new Map();
export function crowdGeometry(body = 'm') {
  if (CROWD_CACHE.has(body)) return CROWD_CACHE.get(body);
  const prev = BODY_KEY;
  useBody(body);
  const c = cluster(0.085, (r) => CROWD_PART[r] ?? 2);
  const helmet = new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, 1.9);
  helmet.scale(0.95, 1, 1.12); helmet.translate(0, DATA.info.meta.eyes.L.c[1] + 0.03, DATA.info.meta.eyes.L.c[2] + 0.105);
  helmet.deleteAttribute('uv');
  c.geo.deleteAttribute('skinIndex'); c.geo.deleteAttribute('skinWeight');
  const g = mergeGeometries([c.geo, helmet]);
  const nb = c.geo.attributes.position.count, total = g.attributes.position.count;
  const partA = new Float32Array(total).fill(3);
  for (let i = 0; i < nb; i++) partA[i] = CROWD_PART[c.region[i]] ?? 2;
  g.setAttribute('part', new THREE.BufferAttribute(partA, 1));
  c.geo.dispose(); helmet.dispose();
  useBody(prev);
  CROWD_CACHE.set(body, g);
  return g;
}

// ---------- the player ----------
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.45);   // covers every pose and emote
const ACC_CLASSES = ['cloth', 'gloss', 'shiny', 'visor', 'crown', 'towel'];

// Returns { mesh, bones: {name: Bone}, hand, setHelmet(on), setDetail('full'|'mid'|'none'), dispose(), detail }
// `mesh` is a Group holding the skeleton; the detail meshes are SkinnedMeshes inside it sharing one Skeleton.
// opts.detail: 'full' (default) builds the full model now; 'lazy' builds each level the first time it is shown.
export function createHuman(skin, opts = {}) {
  const body = useBody(skin.body === 'f' ? 'f' : 'm');
  const bodyKey = BODY_KEY;
  const M = mats();
  const { info } = DATA;
  const holder = new THREE.Group();
  const bones = info.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.fromArray(b.pos);
    bone.quaternion.fromArray(b.quat);
    return bone;
  });
  info.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  holder.add(bones[0]);
  holder.updateMatrixWorld(true);
  if (!BONE_INV) {
    BONE_INV = bones.map((b) => b.matrixWorld.clone().invert());
    body.BONE_INV = BONE_INV;
  }
  const skeleton = new THREE.Skeleton(bones, BONE_INV);   // bind inverses are read-only: share them
  const ident = new THREE.Matrix4();
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  const restWorld = (name) => byName[name].getWorldPosition(new THREE.Vector3());
  const skinned = (geo, mat) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.bind(skeleton, ident);
    m.boundingSphere = BOUNDS;
    m.frustumCulled = true;
    holder.add(m);
    return m;
  };
  const levels = {}, ownGeos = [];
  let helmetOn = skin.helmetOn !== false;
  const curSkin = () => ({ ...skin, helmetOn });

  const buildFull = () => {
    useBody(bodyKey);
    const meshes = [];
    // body: shared attributes, per-player colors. In a match the body is lightly decimated
    // (~11k instead of 27k triangles): nobody gets as close as the Locker Room camera.
    const src = opts.detail === 'lazy' ? gameBody() : { geo: null, region: DATA.attrs.region };
    const { attrs } = DATA;
    const reg = src.region, pa = src.geo ? src.geo.attributes.position.array : attrs.position.array, n = pa.length / 3;
    const cmap = bodyCmap(curSkin()), col = colorAttr(n);
    for (let i = 0; i < n; i++) setC(col.array, i, bodyColor(skin, cmap, reg[i], pa[i * 3], pa[i * 3 + 1]));
    let bgeo;
    if (src.geo) bgeo = shareGeometry(src.geo, { color: col });
    else {
      bgeo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) bgeo.setAttribute(k, attrs[k]);
      bgeo.setIndex(attrs.index);
      bgeo.setAttribute('color', col);
      for (const gr of info.groups) bgeo.addGroup(gr.start, gr.count, gr.mat);
      bgeo.userData.own = ['color'];
    }
    ownGeos.push(bgeo);
    meshes.push(skinned(bgeo, M.body));
    // baked accessories
    SEGK = opts.detail === 'lazy' ? 0.55 : 1;
    const acc = accessoryGeometry(curSkin()), pal = palette(skin);
    SEGK = 1;
    for (const cls of ACC_CLASSES) {
      const a = acc[cls];
      if (!a) continue;
      let geo;
      if (cls === 'visor' || cls === 'crown' || cls === 'towel') geo = shareGeometry(a.geo, {});
      else {
        const nv = a.geo.attributes.position.count, c = colorAttr(nv);
        if (a.shell) paintShell(skin, c.array);
        for (let i = a.shell; i < nv; i++) setC(c.array, i, pal[a.slots[i]]);
        geo = shareGeometry(a.geo, { color: c });
      }
      ownGeos.push(geo);
      meshes.push(skinned(geo, M[cls]));
    }
    const ng = numberGeometry(skin); ownGeos.push(ng);
    meshes.push(skinned(ng, M.numbers));
    return meshes;
  };
  const buildMid = () => {
    useBody(bodyKey);
    const st = skin.style || {};
    const capKind = helmetOn && !st.referee ? 'helmet' : 'cap';
    const mid = midGeometry(capKind);
    const nv = mid.geo.attributes.position.count, c = colorAttr(nv), pa = mid.geo.attributes.position.array;
    const cmap = bodyCmap(curSkin());
    const capColor = new THREE.Color(capKind === 'helmet' || st.referee ? skin.helmet : (skin.hair || '#8a6239'));
    for (let i = 0; i < nv; i++) {
      const r = mid.region[i];
      setC(c.array, i, r === 255 ? capColor : r === JERSEY && pa[i * 3 + 1] > 1.2 ? cmap.cJ : bodyColor(skin, cmap, r, pa[i * 3], pa[i * 3 + 1]));
    }
    const geo = shareGeometry(mid.geo, { color: c });
    ownGeos.push(geo);
    return [skinned(geo, M.mid)];
  };
  let detail = 'none';
  const setDetail = (lv) => {
    if (lv !== 'none' && !levels[lv]) levels[lv] = lv === 'full' ? buildFull() : buildMid();
    for (const [k, list] of Object.entries(levels)) for (const m of list) m.visible = k === lv;
    detail = lv;
    h.detail = lv;
  };
  const dropLevels = () => {
    for (const list of Object.values(levels)) for (const m of list) holder.remove(m);
    for (const g of ownGeos) disposeShared(g);
    ownGeos.length = 0;
    for (const k of Object.keys(levels)) delete levels[k];
  };
  // weapon hand point
  const hand = new THREE.Group();
  {
    const bone = byName['wrist.R'];
    hand.position.copy(restWorld('wrist.R').add(new THREE.Vector3(0, -0.07, -0.01))).sub(restWorld('wrist.R'));
    hand.position.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
    bone.add(hand);
  }
  const h = {
    mesh: holder, bones: byName, hand, detail,
    setDetail,
    // helmet on/off changes the baked shapes: rebuild the levels that exist
    setHelmet(on) {
      if (on === helmetOn) return;
      helmetOn = on;
      const was = detail;
      dropLevels();
      setDetail(was);
    },
    // which bone index a body vertex is weighted to is all shared; only this player's own buffers are freed
    dispose() { dropLevels(); skeleton.dispose(); },
  };
  setDetail(opts.detail === 'lazy' ? 'none' : 'full');
  return h;
}

// ---------- shared decal textures ----------
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
  const rnd = makeRng(4242);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; g.fillRect(rnd() * 64, rnd() * 176, 1, 2); }
  g.fillStyle = '#2a2d3a';
  g.beginPath(); g.moveTo(17, 150); g.lineTo(15, 124); g.lineTo(25, 136); g.lineTo(32, 118); g.lineTo(39, 136); g.lineTo(49, 124); g.lineTo(47, 150); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
