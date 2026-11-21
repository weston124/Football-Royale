// The Mega Dome: a giant domed stadium in the middle of the Giant Sports City.
// Collision boxes, loot spots, Equipment Bags and elevators for shared/map.js.
// Drawn by client/js/stadium.js (roof, arches, video board, glass...).
//
// Layout (everything is a rectangular "ring" around the field; `o` = how far out from the
// podium rectangle |x| = HX, |z| = HZ):
//   field + apron (y 0) | lower deck 12 rows o 0..19.2 (0.6 m steps) | cross-aisle o 19.2..20.4 (y 7.2)
//   L0 ground concourse  o 20.4..37.2, y 0     (gates in the outer wall, vomitory tunnels to the bowl)
//   L1 suite level       o 20.4..37.2, y 7.2   (glass-front suites o 20.6..26.6, corridor behind)
//   L2 upper concourse   o 27.4..37.2, y 11.2  (under the upper deck; vomitory trenches into it)
//   upper deck 12 rows   o 20.4..37.2 (0.65 m steps, top 19.0)
//   outer wall o 37.2..37.6, glass curtain above; barrel-vault roof (walkable ramps) with a
//   96 x 38 m opening over the field; two giant arches; center-hung video board.
// Stairs L0->L1->L2 and an elevator (shared/elevators.js) in each corner.
import { makeRng } from './rng.js';
import { shaftWalls } from './elevators.js';

export const DOME = {
  HX: 62, HZ: 33,
  L1: 7.2, L2: 11.2, SLAB: 0.4,
  LOW: { rows: 12, rise: 0.6, run: 1.6 },
  UP: { rows: 12, rise: 0.65, run: 1.4, solid: 5 },
  OUT: 37.2, WALL: 0.4,
  CROWN: 50, R: 112.7, EDGE_Z: 71.2,
  OPEN: { x: 48, z: 19 },
  KNOTS: [0, 19, 32, 45, 58, 71.2],
  BOARD: { x: 24, z: 6, y0: 30, y1: 41 },
  ARCH: { z: 19, foot: 125, h: 88 },
  SUITE_W: 8, SUITES_X: 76, SUITES_Z: 44,
};
const D = DOME;
// height of the roof vault at distance |z| from the middle
export const roofY = (z) => D.CROWN - (D.R - Math.sqrt(D.R * D.R - Math.min(z * z, D.R * D.R)));
// outer footprint (walls) and "under the roof" test (inside the walls, outside the opening)
export const DOME_FOOT = { x: D.HX + D.OUT + D.WALL, z: D.HZ + D.OUT + D.WALL };
export const underDomeRoof = (x, z) => Math.abs(x) < DOME_FOOT.x + 1 && Math.abs(z) < D.EDGE_Z
  && !(Math.abs(x) < D.OPEN.x && Math.abs(z) < D.OPEN.z);

export function buildMegaDome({ box: mapBox, decor, loot, chests, pois, elevators, seed }) {
  const box = (...a) => { const b = mapBox(...a); b.dome = true; return b; }; // drawn by stadium.js
  const rnd = makeRng((seed ^ 0x5eedd0e) >>> 0);
  const { HX, HZ, L1, L2, SLAB } = D;
  const C = {
    seatA: 0x2f62c9, seatB: 0x3a70d8, upA: 0x2a55b0, upB: 0x9aa6b8, aisle: 0x7e8794,
    concrete: 0xb7b3aa, slab: 0xc9c3b6, wall: 0xe6e1d6, glass: 0x9fd8ff, rail: 0xf2c230,
    suiteWall: 0xece6d8, wood: 0x8b5a2b, leather: 0x6b3d2a, stair: 0xa7a299, outer: 0xd5d8de, steel: 0x8a94a6,
  };

  // ---- ring helpers ----
  const rect = (side, o0, o1, a0, a1) => {
    if (side === 'S') return [a0, HZ + o0, a1, HZ + o1];
    if (side === 'N') return [a0, -(HZ + o1), a1, -(HZ + o0)];
    if (side === 'E') return [HX + o0, a0, HX + o1, a1];
    return [-(HX + o1), a0, -(HX + o0), a1];
  };
  const sideBox = (side, o0, o1, a0, a1, y0, y1, color, kind, extra) => {
    const [x0, z0, x1, z1] = rect(side, o0, o1, a0, a1);
    const b = box(x0, y0, z0, x1, y1, z1, color, kind);
    b.face = side; // which way is "out" (used to draw seat backs)
    if (extra) Object.assign(b, extra);
    return b;
  };
  const SIDES = ['S', 'N', 'E', 'W'];
  const run = (side, o1, o0) => (side === 'S' || side === 'N' ? [-(HX + o1), HX + o1] : [-(HZ + o0), HZ + o0]);
  // a band all the way round, minus `cuts[side]` intervals of the run
  const ring = (o0, o1, y0, y1, color, kind, cuts = {}, extra) => {
    for (const side of SIDES) {
      let [a, end] = run(side, o1, o0);
      const cs = (cuts[side] || []).slice().sort((p, q) => p[0] - q[0]);
      for (const [c0, c1] of cs) { if (c0 > a) sideBox(side, o0, o1, a, c0, y0, y1, color, kind, extra); a = Math.max(a, c1); }
      if (end > a) sideBox(side, o0, o1, a, end, y0, y1, color, kind, extra);
    }
  };
  const flatDecor = (side, o0, o1, a0, a1, y, color) => {
    const [x0, z0, x1, z1] = rect(side, o0, o1, a0, a1);
    decor.push({ type: 'floor', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y, color });
  };
  // a slab (floor) band with rectangular holes [x0,z0,x1,z1] cut out
  const slab = (o0, o1, y0, y1, color, kind, holes) => {
    for (const side of SIDES) {
      const [a, end] = run(side, o1, o0);
      const [X0, Z0, X1, Z1] = rect(side, o0, o1, a, end);
      const hs = holes.filter((h) => h[0] < X1 && h[2] > X0 && h[1] < Z1 && h[3] > Z0);
      const xs = [...new Set([X0, X1, ...hs.flatMap((h) => [Math.max(X0, h[0]), Math.min(X1, h[2])])])].sort((p, q) => p - q);
      for (let i = 0; i < xs.length - 1; i++) {
        const xa = xs[i], xb = xs[i + 1];
        if (xb - xa < 1e-6) continue;
        const cover = hs.filter((h) => h[0] < xb - 1e-6 && h[2] > xa + 1e-6).map((h) => [Math.max(Z0, h[1]), Math.min(Z1, h[3])]).sort((p, q) => p[0] - q[0]);
        let z = Z0;
        for (const [c0, c1] of cover) { if (c0 > z) box(xa, y0, z, xb, y1, c0, color, kind); z = Math.max(z, c1); }
        if (Z1 > z) box(xa, y0, z, xb, y1, Z1, color, kind);
      }
    }
  };

  pois.push({ name: 'Mega Dome', x: 0, z: 0, r: 100 });
  // plaza and turf apron: on the minimap; drawn by stadium.js (depth-offset, no flicker with the roads)
  decor.push({ type: 'pavement', x: 0, z: 0, w: 262, d: 196, dome: true });
  decor.push({ type: 'floor', x: 0, z: 0, w: HX * 2, d: HZ * 2, color: 0x3f8f3f, y: 0.03, dome: true });
  decor.push({ type: 'field', x: 0, z: 0, w: 110, d: 54 });
  decor.push({ type: 'goalpost', x: -56, z: 0, rot: 0 });
  decor.push({ type: 'goalpost', x: 56, z: 0, rot: 0 });
  decor.push({ type: 'megadome' }); // roof, arches, video board, glass... (client/js/stadium.js)

  // ---- lower deck (ground-standing steps) with vomitory tunnels from the concourse ----
  const lowCuts = { S: [[-32, -28], [28, 32]], N: [[-32, -28], [28, 32]], E: [[-2, 2]], W: [[-2, 2]] };
  const TUNNEL = 3.2;
  const bridge = (o0, o1, top, color, kind, cuts, extra) => {
    if (top < TUNNEL + 0.6) return;
    for (const side of SIDES) for (const [c0, c1] of cuts[side] || []) sideBox(side, o0, o1, c0, c1, TUNNEL, top, color, kind, extra);
  };
  for (let i = 0; i < D.LOW.rows; i++) {
    const o0 = i * D.LOW.run, o1 = o0 + D.LOW.run, top = D.LOW.rise * (i + 1);
    const c = i % 2 ? C.seatA : C.seatB;
    ring(o0, o1, 0, top, c, 'stand', lowCuts, { seat: 1 });
    bridge(o0, o1, top, c, 'stand', lowCuts, { seat: 1 });
  }
  const LOW_END = D.LOW.rows * D.LOW.run; // 19.2
  ring(LOW_END, 20.4, 0, L1, C.aisle, 'stand', lowCuts);
  bridge(LOW_END, 20.4, L1, C.aisle, 'stand', lowCuts);
  for (const side of SIDES) for (const [c0, c1] of lowCuts[side]) flatDecor(side, 0, 20.4, c0, c1, 0.05, 0x8d8a84);

  // ---- corners: stairs and elevators ----
  const holesL1 = [], holesL2 = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const zIn = HZ + D.OUT - 3.3, zOut = HZ + D.OUT; // stairs run along the outer wall
    const Z0 = sz > 0 ? zIn : -zOut, Z1 = sz > 0 ? zOut : -zIn;
    // A: L0 -> L1, 12 steps of 0.6 m
    const a0 = 58, step = 0.8;
    for (let k = 0; k < 12; k++) {
      const xa = sx * (a0 + step * k), xb = sx * (a0 + step * (k + 1));
      box(Math.min(xa, xb), 0, Z0, Math.max(xa, xb), 0.6 * (k + 1), Z1, k % 2 ? C.stair : 0xb3aea5, 'stair');
    }
    const aEnd = a0 + step * 12;
    holesL1.push([sx > 0 ? a0 : -aEnd, Z0, sx > 0 ? aEnd : -a0, Z1]);
    // B: L1 -> L2, 7 steps of 4/7 m
    const b0 = 70, nB = 7, rB = (L2 - L1) / nB;
    for (let k = 0; k < nB; k++) {
      const xa = sx * (b0 + step * k), xb = sx * (b0 + step * (k + 1));
      box(Math.min(xa, xb), L1, Z0, Math.max(xa, xb), L1 + rB * (k + 1), Z1, k % 2 ? C.stair : 0xb3aea5, 'stair');
    }
    const bEnd = b0 + step * nB;
    holesL2.push([sx > 0 ? b0 : -bEnd, Z0, sx > 0 ? bEnd : -b0, Z1]);
    // railings along the stairwell openings
    const zr = sz > 0 ? [zIn - 0.15, zIn] : [-zIn, -zIn + 0.15];
    box(sx > 0 ? a0 : -aEnd, L1, zr[0], sx > 0 ? aEnd : -a0, L1 + 1, zr[1], C.rail, 'rail').stairRail = [0, L1];
    box(sx * a0 - (sx > 0 ? 0.15 : 0), L1, Z0, sx * a0 + (sx > 0 ? 0 : 0.15), L1 + 1, Z1, C.rail, 'rail');
    box(sx > 0 ? b0 : -bEnd, L2, zr[0], sx > 0 ? bEnd : -b0, L2 + 1, zr[1], C.rail, 'rail').stairRail = [L1, L2];
    box(sx * b0 - (sx > 0 ? 0.15 : 0), L2, Z0, sx * b0 + (sx > 0 ? 0 : 0.15), L2 + 1, Z1, C.rail, 'rail');
    // elevator in the corner, doors facing the side concourse
    const ex = sx * (HX + 29), ez = sz * (HZ + 29);
    const e = { id: elevators.length, x0: ex - 1.5, x1: ex + 1.5, z0: ez - 1.5, z1: ez + 1.5, stops: [0, L1, L2], door: sx > 0 ? 2 : 3, phase: elevators.length * 6.5 };
    elevators.push(e);
    for (const w of shaftWalls(e, 15.6)) box(w.min[0], w.min[1], w.min[2], w.max[0], w.max[1], w.max[2], C.glass, 'glass');
    const hole = [e.x0 - 0.25, e.z0 - 0.25, e.x1 + 0.25, e.z1 + 0.25];
    holesL1.push(hole); holesL2.push(hole);
  }

  // ---- floors: L1 (suites + corridor) and L2 (upper concourse) slabs ----
  slab(20.4, D.OUT, L1 - SLAB, L1, C.slab, 'slab', holesL1);
  slab(20.4, D.OUT, L2 - SLAB, L2, C.slab, 'slab', holesL2);

  // ---- L0 concourse: pillars and snack stands ----
  const pill = (side, o, a, y0, y1) => sideBox(side, o - 0.6, o + 0.6, a - 0.6, a + 0.6, y0, y1, 0x2a55b0, 'pillar');
  for (const side of ['S', 'N']) for (const a of [-80, -44, -24, -8, 8, 24, 44, 80]) { pill(side, 29.5, a, 0, L1 - SLAB); pill(side, 31, a, L1, L2 - SLAB); }
  for (const side of ['E', 'W']) for (const a of [-40, -14, 14, 40]) { pill(side, 29.5, a, 0, L1 - SLAB); pill(side, 31, a, L1, L2 - SLAB); }
  const awnings = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71, 0x9b59b6, 0xe67e22];
  let ai = 0;
  const snack = (side, a) => {
    const col = awnings[ai++ % awnings.length];
    const [x0, z0] = rect(side, 20.45, 20.45, a, a);
    decor.push({ type: 'snacksign', side, x: x0, z: z0, y: 4.6 });
    sideBox(side, 20.4, 22.0, a - 3, a + 3, 0, 1.1, 0xf3efe6, 'counter');
    sideBox(side, 20.4, 22.8, a - 3.4, a + 3.4, 3.0, 3.4, col, 'awning');
  };
  for (const side of ['S', 'N']) for (const a of [-70, -50, -14, 14, 50, 70]) snack(side, a);
  for (const side of ['E', 'W']) for (const a of [-30, 30]) snack(side, a);

  // ---- L1: glass-front suites ----
  const SW = D.SUITE_W;
  let suiteN = 0;
  const suiteSpots = [];
  for (const side of SIDES) {
    const lim = side === 'S' || side === 'N' ? D.SUITES_X : D.SUITES_Z;
    sideBox(side, 20.4, 20.6, -lim, lim, L1, L2 - SLAB, C.glass, 'glass');
    for (let a0 = -lim; a0 <= lim + 1e-6; a0 += SW) sideBox(side, 20.6, 26.6, a0 - 0.15, a0 + 0.15, L1, L2 - SLAB, C.suiteWall, 'wall');
    for (let a0 = -lim; a0 < lim - 1e-6; a0 += SW) {
      const c = a0 + SW / 2;
      // back wall with a door into the corridor
      sideBox(side, 26.6, 26.9, a0, c - 0.9, L1, L2 - SLAB, C.suiteWall, 'wall');
      sideBox(side, 26.6, 26.9, c + 0.9, a0 + SW, L1, L2 - SLAB, C.suiteWall, 'wall');
      sideBox(side, 26.6, 26.9, c - 0.9, c + 0.9, L1 + 2.7, L2 - SLAB, C.suiteWall, 'wall');
      // furniture: drink rail at the glass, a couch facing the field, a bar along a side wall
      sideBox(side, 20.6, 21.1, a0 + 0.4, a0 + SW - 0.4, L1, L1 + 1.05, C.wood, 'furniture');
      sideBox(side, 22.7, 23.5, a0 + 1.6, a0 + SW - 1.6, L1, L1 + 0.45, suiteN % 2 ? C.leather : 0x2d3e63, 'furniture');
      sideBox(side, 23.5, 23.8, a0 + 1.6, a0 + SW - 1.6, L1, L1 + 1.0, suiteN % 2 ? C.leather : 0x2d3e63, 'furniture');
      sideBox(side, 24.4, 26.4, a0 + 0.3, a0 + 0.9, L1, L1 + 1.1, C.wood, 'furniture');
      flatDecor(side, 20.6, 26.6, a0 + 0.15, a0 + SW - 0.15, L1 + 0.02, suiteN % 3 === 0 ? 0x7a2531 : suiteN % 3 === 1 ? 0x24345e : 0x3f4a3a);
      suiteSpots.push({ side, a: a0 + SW / 2 + 1.6, o: 25.2, n: suiteN });
      suiteN++;
    }
  }

  // ---- upper deck: solid front rows, then rows raised over the L2 concourse ----
  const upCuts = { S: [[-42, -38], [-2, 2], [38, 42]], N: [[-42, -38], [-2, 2], [38, 42]], E: [[-2, 2]], W: [[-2, 2]] };
  const upTop = (i) => L2 + D.UP.rise * (i + 1);
  for (let i = 0; i < D.UP.rows; i++) {
    const o0 = 20.4 + i * D.UP.run, o1 = o0 + D.UP.run, top = upTop(i);
    const c = i % 2 ? C.upA : C.upB;
    if (i < D.UP.solid) ring(o0, o1, L2, top, c, 'stand', upCuts, { seat: 1 });
    else ring(o0, o1, top - 0.8, top, c, 'stand', {}, { seat: 1 });
  }
  ring(20.4, 20.6, upTop(0), upTop(0) + 1, C.rail, 'rail', upCuts);
  for (const side of SIDES) for (const [c0, c1] of upCuts[side]) {
    sideBox(side, 20.4, 20.6, c0, c1, L2, L2 + 1, C.rail, 'rail');
    flatDecor(side, 20.6, 20.4 + D.UP.solid * D.UP.run, c0, c1, L2 + 0.02, 0x8d8a84);
  }

  // ---- outer wall: concrete with gates at the bottom, glass curtain above ----
  const gateCuts = { S: [[-39, -33], [-3, 3], [33, 39]], N: [[-39, -33], [-3, 3], [33, 39]], E: [[-3, 3]], W: [[-3, 3]] };
  const GATE_H = 4.5;
  ring(D.OUT, D.OUT + D.WALL, 0, L1, C.outer, 'wall', gateCuts);
  for (const side of SIDES) for (const [c0, c1] of gateCuts[side]) {
    sideBox(side, D.OUT, D.OUT + D.WALL, c0, c1, GATE_H, L1, C.outer, 'wall');
    // gate canopy: two posts and a roof sticking out
    const c = (c0 + c1) / 2;
    sideBox(side, D.OUT + D.WALL, D.OUT + 4.4, c - 4, c - 3.4, 0, 5.6, C.steel, 'pillar');
    sideBox(side, D.OUT + D.WALL, D.OUT + 4.4, c + 3.4, c + 4, 0, 5.6, C.steel, 'pillar');
    sideBox(side, D.OUT + D.WALL, D.OUT + 4.8, c - 4.4, c + 4.4, 5.6, 6.2, C.rail, 'roof');
    flatDecor(side, D.OUT - 1, D.OUT + 4.8, c0, c1, 0.06, 0x8d8a84);
    if (Math.abs(c) < 1) decor.push({ type: 'domesign', side, ...(() => { const [x0, z0, x1, z1] = rect(side, D.OUT + 4.8, D.OUT + 4.85, c - 6, c + 6); return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }; })(), y: 7.6 });
  }
  // long sides: glass up to the roof edge; ends: concrete to L2, then glass under the vault
  for (const side of ['S', 'N']) {
    const [a, b] = run(side, D.OUT + D.WALL, D.OUT);
    sideBox(side, D.OUT, D.OUT + 0.3, a, b, L1, roofY(HZ + D.OUT + 0.3), C.glass, 'glass');
  }
  for (const side of ['E', 'W']) {
    const [a, b] = run(side, D.OUT + D.WALL, D.OUT);
    sideBox(side, D.OUT, D.OUT + D.WALL, a, b, L1, L2, C.outer, 'wall');
    // stepped under the curve (each piece as high as the curve at its outer end, so the
    // collision never sticks out above the roof); drawn as one smooth arched glass wall
    const n = 36;
    for (let k = 0; k < n; k++) {
      const z0 = a + (b - a) * k / n, z1 = a + (b - a) * (k + 1) / n;
      const h = roofY(Math.max(Math.abs(z0), Math.abs(z1)));
      sideBox(side, D.OUT, D.OUT + 0.3, z0, z1, L2, h, C.glass, 'endglass');
    }
  }

  // ---- roof: a barrel vault (ramps you can walk on) with the big opening over the field ----
  const K = D.KNOTS, XR = DOME_FOOT.x + 0.6;
  for (let j = 0; j < K.length - 1; j++) {
    const za = K[j], zb = K[j + 1], ya = roofY(za), yb = roofY(zb);
    const spans = za < D.OPEN.z - 1e-6 ? [[-XR, -D.OPEN.x], [D.OPEN.x, XR]] : [[-XR, XR]];
    for (const [x0, x1] of spans) {
      box(x0, yb, za, x1, ya, zb, C.outer, 'roof').ramp = { axis: 2, sign: -1 };
      box(x0, yb, -zb, x1, ya, -za, C.outer, 'roof').ramp = { axis: 2, sign: 1 };
    }
  }
  // the video board (solid: you can land on it) and the arch feet
  const B = D.BOARD;
  box(-B.x, B.y0, -B.z, B.x, B.y1, B.z, 0x1b1f27, 'board');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * D.ARCH.foot, z = sz * D.ARCH.z;
    box(x - 4, 0, z - 4, x + 4, 5, z + 4, 0xc8c4bb, 'box');
  }

  // ---- loot ----
  const L = (x, y, z) => loot.push({ x, y, z });
  const at = (side, o, a, y) => { const [x0, z0, x1, z1] = rect(side, o, o, a, a); L(x0, y, z0); };
  for (let i = 0; i < 7; i++) L(rnd.range(-48, 48), 0, rnd.range(-22, 22));                 // field
  for (const side of ['S', 'N']) for (const a of [-86, -38, 4, 38, 86]) at(side, rnd.range(25, 27), a + rnd.range(-2, 2), 0); // L0 concourse
  for (const side of ['E', 'W']) for (const a of [-22, 22]) at(side, rnd.range(25, 27), a + rnd.range(-2, 2), 0);
  for (const side of SIDES) { const i = 4 + ((rnd() * 4) | 0); at(side, i * D.LOW.run + 0.8, side === 'E' || side === 'W' ? rnd.range(-20, 20) : rnd.range(-20, 20), D.LOW.rise * (i + 1)); } // lower seats
  for (const s of suiteSpots) if (s.n % 4 === 1) at(s.side, s.o, s.a, L1);                 // every 4th suite
  for (const side of ['S', 'N']) for (const a of [-50, 50]) at(side, 33, a, L1);           // L1 corridor
  for (const side of ['E', 'W']) at(side, 33, 0, L1);
  for (const side of ['S', 'N']) for (const a of [-60, -20, 20, 60]) at(side, 32.5, a, L2); // L2 concourse
  for (const side of ['E', 'W']) at(side, 32.5, side === 'E' ? 20 : -20, L2);
  at('S', 20.4 + 8 * D.UP.run + 0.7, -12, upTop(8)); at('N', 20.4 + 8 * D.UP.run + 0.7, 12, upTop(8)); // upper seats
  L(0, B.y1, 0);                    // on top of the video board
  L(74, roofY(0), 0); L(-74, roofY(0), 0); // on the roof crown

  // ---- Equipment Bags ----
  chests.push(
    { x: 0, y: 0, z: 0 }, { x: -40, y: 0, z: 20 },                     // the field
    { x: -52, y: 0, z: HZ + 26 }, { x: 52, y: 0, z: -(HZ + 26) },       // L0 concourse
    { x: HX + 26, y: 0, z: 8 }, { x: -(HX + 26), y: 0, z: -8 },
    { x: -2, y: L1, z: HZ + 24.6 },                                     // a suite (L1)
    { x: 4, y: L2, z: -(HZ + 33) },                                     // upper concourse (L2)
  );
}

// Bots only path-find on the ground (server/nav.js). A bot that ends up on an upper level
// of the dome (landed on the roof or the video board, pushed up the stairs...) gets a
// waypoint toward the way down from here: { x, z, jump } or null when not up in the dome.
//  roof -> into the opening; board -> off its edge; upper deck / trenches -> over the front
//  rail; upper concourse -> the nearest trench; suite -> its door; suite level -> a corner
//  lounge, then the lower deck's cross-aisle (on the bots' grid again).
export function domeEscape(x, y, z) {
  const { HX, HZ, L1, L2, BOARD: B, OPEN } = D;
  if (Math.abs(x) > DOME_FOOT.x || Math.abs(z) > DOME_FOOT.z) return null;
  const sx = x < 0 ? -1 : 1, sz = z < 0 ? -1 : 1;
  const ox = Math.abs(x) - HX, oz = Math.abs(z) - HZ, o = Math.max(ox, oz);
  const endSide = ox > oz; // nearer the E/W ends than the long sides
  if (y >= B.y0 && Math.abs(x) < B.x + 1 && Math.abs(z) < B.z + 1) return { x, z: sz * (B.z + 4) };
  if (y > 21) return { x: Math.max(-OPEN.x + 6, Math.min(OPEN.x - 6, x)), z: Math.max(-OPEN.z + 6, Math.min(OPEN.z - 6, z)) };
  if (o < 20.3 || y < L1 - 0.3) return null;
  const inward = (to) => (endSide ? { x: sx * (HX + to), z } : { x, z: sz * (HZ + to) });
  if (y > L2 + 0.3) return { ...inward(18.5), jump: o < 21.6 };          // upper deck rows: over the rail
  if (y > L2 - 0.3) {
    if (o < 27.6) return { ...inward(18.5), jump: o < 21.6 };            // in a trench
    const along = endSide ? z : x;
    const t = endSide ? 0 : [-40, 0, 40].reduce((p, q) => (Math.abs(q - along) < Math.abs(p - along) ? q : p));
    if (Math.abs(along - t) > 1.2) return endSide ? { x: sx * (HX + 29.5), z: t } : { x: t, z: sz * (HZ + 29.5) };
    return inward(18.5);
  }
  if (y > L1 + 0.3) return endSide ? { x: sx * (HX + 29.5), z } : { x: sx * 68.5, z };  // on the L1 -> L2 stairs: go down
  // suite level
  const lim = endSide ? D.SUITES_Z : D.SUITES_X, a = endSide ? z : x;
  if (o > 20.5 && o < 26.7 && Math.abs(a) < lim) {                       // inside a suite: out of its door
    const c = (Math.floor((a + lim) / D.SUITE_W) + 0.5) * D.SUITE_W - lim;
    return endSide ? { x: sx * (HX + 28), z: c } : { x: c, z: sz * (HZ + 28) };
  }
  const lounge = endSide ? 49 : 78.5; // between the last suite and the corner
  if (Math.abs(a) < lounge - 1 || o > 35) return endSide ? { x: sx * (HX + 34.5), z: (z < 0 ? -1 : 1) * lounge } : { x: sx * lounge, z: sz * (HZ + 34.5) };
  return endSide ? { x: sx * (HX + 19.6), z: (z < 0 ? -1 : 1) * lounge } : { x: sx * lounge, z: sz * (HZ + 19.6) };
}
