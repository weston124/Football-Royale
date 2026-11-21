// The newer parts of the Giant Sports City: a downtown skyscraper block, a mall and a sports
// shop strip, a gas station, a school with a gym, a water park, a TV tower, farms and more
// neighborhoods, with their parking lots full of drivable vehicles. Called by generateMap()
// (shared/map.js) before trees are planted, so trees and the random houses keep out of here.
//
// It uses its own seeded random numbers, so this part of the city stays the same whatever the
// rest of the generator does (and the other way round).
//
// Building kit (all boxes are axis aligned, nothing here uses ramps):
//  - shell(): one-floor building with door gaps on any side.
//  - office(): multi-story building. Every floor is FH = 4 m: 8 steps of 0.5 m (under
//    PLAYER.stepUp) in a switchback stairwell along one side, a hole in each slab above its
//    flight, and the last flight comes out on the roof (low 0.6 m parapet you can step over).
//    The ground-floor flight stands on the ground, so the bots' nav grid sees it as stairs;
//    upper floors are only for real players (bots skip loot they can't path to).
//  - Equipment Bags are only placed on ground floors or on solid ground-standing platforms,
//    so every bag stays reachable for bots (test/bots.test.js).
import { makeRng } from './rng.js';

export const FH = 4;          // floor height of multi-story buildings
const STEPS = 8, RUN = 0.7;   // 8 steps x 0.5 m per floor, 0.7 m deep (5.6 m flight)
const T = 0.5;                // wall thickness

export function buildDistricts(A) {
  const { box, decor, loot, chests, pois, reserve, vehicles, trees } = A;
  const rnd = makeRng((A.seed ^ 0x5eed51ab) >>> 0);
  const loot0 = loot.length, box0 = A.boxes.length;
  const L = (x, y, z) => loot.push({ x, y, z });
  const bag = (x, y, z) => chests.push({ x, y, z });

  // A wall along x (at z) or along z (at x) from a0 to a1, with door gaps [{c, w, h}].
  function wall(alongX, at, a0, a1, y0, y1, gaps, color, kind) {
    let a = a0;
    const mk = (p, q, ya, yb) => {
      if (q - p < 0.05) return;
      if (alongX) box(p, ya, at - T / 2, q, yb, at + T / 2, color, kind);
      else box(at - T / 2, ya, p, at + T / 2, yb, q, color, kind);
    };
    for (const g of [...gaps].sort((u, v) => u.c - v.c)) {
      const g0 = g.c - g.w / 2, g1 = g.c + g.w / 2;
      mk(a, g0, y0, y1);
      if (y0 + g.h < y1) mk(g0, g1, y0 + g.h, y1);
      a = g1;
    }
    mk(a, a1, y0, y1);
  }
  // doors: [{side: 0=-z 1=+z 2=-x 3=+x, off: along the wall from the middle, w, h}]
  function walls(cx, cz, w, d, y0, y1, doors, color, kind = 'wall') {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const gapsOn = (side, c) => doors.filter((o) => o.side === side).map((o) => ({ c: c + (o.off || 0), w: o.w || 2.6, h: o.h || 3 }));
    wall(true, z0, x0, x1, y0, y1, gapsOn(0, cx), color, kind);
    wall(true, z1, x0, x1, y0, y1, gapsOn(1, cx), color, kind);
    wall(false, x0, z0 + T / 2, z1 - T / 2, y0, y1, gapsOn(2, cz), color, kind);
    wall(false, x1, z0 + T / 2, z1 - T / 2, y0, y1, gapsOn(3, cz), color, kind);
  }
  const doorList = (door) => (Array.isArray(door) ? door : [{ side: door }]);

  // One-floor building you can walk into.
  function shell(cx, cz, w, d, h, color, door, roof = 0x3c3f47, opts = {}) {
    walls(cx, cz, w, d, 0, h, doorList(door), color, opts.kind || 'wall');
    box(cx - w / 2 - 0.3, h, cz - d / 2 - 0.3, cx + w / 2 + 0.3, h + 0.5, cz + d / 2 + 0.3, roof, 'roof');
    decor.push({ type: 'floor', x: cx, z: cz, w: w - T, d: d - T, color: opts.floor ?? 0xc9b28a });
    if (opts.loot !== 0) {
      const n = opts.loot ?? (w * d > 160 ? 2 : 1);
      for (let i = 0; i < n; i++) L(cx + rnd.range(-w / 4, w / 4), 0, cz + rnd.range(-d / 4, d / 4));
    }
    if (opts.bag) bag(cx + (w / 2 - 1.3) * (opts.bag[0] ?? 1), 0, cz + (d / 2 - 1.3) * (opts.bag[1] ?? 1));
    reserve(cx, cz, w + 6, d + 6);
  }

  // Multi-story building with stairs to every floor and the roof.
  // opts: stairs at +x (default) or -x side (stairX: -1), lootPer floor, bag: [sx, sz] ground corner
  function office(cx, cz, w, d, floors, color, door, opts = {}) {
    const H = floors * FH, sgn = opts.stairX || 1;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    walls(cx, cz, w, d, 0, H + 0.6, doorList(door), color, 'facade');
    // stair strips A (against the wall) and B (next to it), 2 m wide each
    const xi = sgn > 0 ? x1 - T / 2 : x0 + T / 2;
    const strip = (k) => (k % 2 === 0 ? [xi - sgn * 2, xi] : [xi - sgn * 4, xi - sgn * 2]).sort((a, b) => a - b);
    const zs = z0 + T / 2 + 1.6, ze = zs + STEPS * RUN;
    for (let k = 0; k < floors; k++) {
      const [sx0, sx1] = strip(k), base = k * FH;
      for (let i = 0; i < STEPS; i++) {
        const top = base + (i + 1) * (FH / STEPS);
        const a = k % 2 === 0 ? zs + i * RUN : ze - (i + 1) * RUN;
        box(sx0, base, a, sx1, top, a + RUN, opts.stairColor ?? 0x8d8f96, 'stairs');
      }
      // slab above this flight (floor k+1, or the roof) with a hole over the flight
      const top = (k + 1) * FH, th = k + 1 === floors ? 0.4 : 0.3;
      const roofC = k + 1 === floors ? (opts.roof ?? 0x50545e) : (opts.slab ?? 0xe2ddd2);
      const sx = [x0 + T / 2, x1 - T / 2], sz = [z0 + T / 2, z1 - T / 2];
      const kind = k + 1 === floors ? 'roof' : 'slab';
      if (sx0 > sx[0]) box(sx[0], top - th, sz[0], sx0, top, sz[1], roofC, kind);
      if (sx1 < sx[1]) box(sx1, top - th, sz[0], sx[1], top, sz[1], roofC, kind);
      box(sx0, top - th, sz[0], sx1, top, zs, roofC, kind);
      box(sx0, top - th, ze, sx1, top, sz[1], roofC, kind);
      if (k + 1 < floors) decor.push({ type: 'tint', x: (sx[0] + sx[1]) / 2 - sgn * 2, z: cz, w: w - T - 4, d: d - T, color: opts.floor ?? 0xb9b2a4, y: top + 0.02 });
      // walls along the open sides of the flight, up to the slab: beside a flight the ceiling is
      // low, and stepping up the stairs half under it would put your head through the slab
      for (const bx of k % 2 === 0 ? [xi - sgn * 2] : [xi - sgn * 2, xi - sgn * 4]) {
        box(bx - 0.1, base, zs, bx + 0.1, top - th, ze, color, 'wall');
      }
    }
    decor.push({ type: 'floor', x: cx, z: cz, w: w - T, d: d - T, color: opts.floor ?? 0xb9b2a4 });
    // loot on every floor (away from the stairwell) and on the roof
    const lx0 = sgn > 0 ? x0 + 1.5 : xi + 4.8, lx1 = sgn > 0 ? xi - 4.8 : x1 - 1.5;
    for (let k = 0; k <= floors; k++) {
      const n = k === floors ? (rnd() < 0.6 ? 1 : 0) : (opts.lootPer ?? 1);
      for (let i = 0; i < n; i++) L(rnd.range(lx0, lx1), k * FH, rnd.range(z0 + 1.5, z1 - 1.5));
    }
    if (opts.bag) bag(sgn > 0 ? x0 + 1.4 : x1 - 1.4, 0, opts.bag > 0 ? z1 - 1.4 : z0 + 1.4);
    reserve(cx, cz, w + 6, d + 6);
  }

  // Solid skyscraper (windows are drawn on 'tower' boxes); optional narrower crown and antenna.
  function tower(cx, cz, w, d, h, color, crown = 0, spire = 0) {
    box(cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2, color, 'tower');
    let top = h;
    if (crown) { box(cx - w * 0.32, h, cz - d * 0.32, cx + w * 0.32, h + crown, cz + d * 0.32, color, 'tower'); top += crown; }
    if (spire) box(cx - 0.5, top, cz - 0.5, cx + 0.5, top + spire, cz + 0.5, 0xd0d4dc, 'pillar');
    L(cx + w / 2 + 2, 0, cz + rnd.range(-d / 3, d / 3));
    reserve(cx, cz, w + 6, d + 6);
  }

  // Stairs standing on the ground up to a solid platform (nav grid friendly both ways).
  // (x, z): middle of the platform edge where the stairs arrive; dir: the way you walk going
  // up (0 -z, 1 +z, 2 -x, 3 +x); n steps of 0.5 m, 1 m deep (one step per nav cell).
  function groundStairs(x, z, width, n, dir, color) {
    const run = 1, dx = dir === 2 ? -1 : dir === 3 ? 1 : 0, dz = dir === 0 ? -1 : dir === 1 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * 0.5, far = (n - i) * run, near = (n - 1 - i) * run; // distance back from the edge
      const ax = x - dx * far, bx = x - dx * near, az = z - dz * far, bz = z - dz * near;
      if (dx) box(Math.min(ax, bx), 0, z - width / 2, Math.max(ax, bx), top, z + width / 2, color, 'stairs');
      else box(x - width / 2, 0, Math.min(az, bz), x + width / 2, top, Math.max(az, bz), color, 'stairs');
    }
  }

  // Drivable vehicle spots. yaw 0 / PI = parked along z, +-PI/2 = along x.
  const park = (type, x, z, yaw, color) => vehicles.push({ type, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw, color });
  const pickType = () => { const r = rnd(); return r < 0.4 ? 'hatch' : r < 0.78 ? 'truck' : 'cart'; };
  const colorsOf = { truck: 4, cart: 4, hatch: 8 };
  // a row of parking spaces along x (cars point along z), `fill` = chance a space is taken
  function parkRow(x0, x1, z, step, yaw, fill) {
    for (let x = x0; x <= x1 + 0.01; x += step) {
      if (rnd() > fill) continue;
      const t = pickType();
      park(t, x, z, yaw, rnd.int(0, colorsOf[t] - 1));
    }
  }
  const lines = (x0, x1, z, step, len) => { for (let x = x0 - step / 2; x <= x1 + step / 2 + 0.01; x += step) decor.push({ type: 'tint', x, z, w: 0.15, d: len, color: 0xf2f2f2, y: 0.035 }); };
  const road = (x, z, w, d) => { decor.push({ type: 'road', x, z, w, d }); reserve(x, z, w + 2, d + 2); };
  const sign = (x, y, z, rot, text, bg, fg, w = 12) => decor.push({ type: 'sign', x, y, z, rot, text, bg, fg, w });

  // ================= Skyline Heights (downtown skyscrapers) =================
  pois.push({ name: 'Skyline Heights', x: 272, z: 128, r: 95 });
  reserve(272, 128, 250, 124);
  decor.push({ type: 'pavement', x: 272, z: 128, w: 246, d: 122 });
  road(272, 110, 246, 10);                 // cross street
  // west block
  tower(172, 86, 26, 26, 72, 0x5b6b82, 14, 10);                         // Goalpost Tower
  office(172, 150, 28, 22, 3, 0x7a8696, [{ side: 2 }, { side: 1, off: -4 }], { bag: -1, roof: 0x3d424c });  // Huddle HQ
  // middle blocks
  tower(222, 86, 18, 22, 55, 0x8a7f74);
  tower(252, 86, 20, 20, 88, 0x46607a, 18, 16);                         // Skyline Spire (tallest)
  office(238, 137, 26, 22, 4, 0x9c8f7e, [{ side: 0, off: -4 }, { side: 2 }], { bag: 1, stairX: 1 });      // Overtime Tower
  tower(238, 172, 24, 14, 40, 0x6e7f73);
  // east blocks
  tower(300, 86, 22, 22, 64, 0x5d5f73, 10);
  office(344, 86, 26, 20, 3, 0x7f6aa3, [{ side: 1 }, { side: 2 }], { bag: 1, stairX: 1 });                  // Blitz Building
  tower(380, 86, 12, 20, 30, 0xa39270);
  office(360, 140, 28, 22, 2, 0x6b8f78, [{ side: 2 }, { side: 0, off: 6 }], { bag: -1 });                  // Kickoff Offices
  tower(362, 175, 24, 14, 46, 0x8f6b6b);
  // the plaza in the middle stays open (tests and players use it as open ground)
  box(298, 0, 178, 306, 0.6, 186, 0xb8c4cc, 'box');                    // fountain basin
  box(301.2, 0.6, 181.2, 302.8, 3, 182.8, 0xd8dee6, 'pillar');
  for (const [x, z] of [[285, 120], [319, 120], [285, 187], [319, 187]]) box(x - 1.5, 0, z - 1, x + 1.5, 0.9, z + 1, 0x7a6a55, 'box'); // planters
  for (const [x, z] of [[285, 120], [319, 120], [285, 187], [319, 187]]) trees.push({ x, z, h: 6, r: 2, pine: false, noTrunk: true });
  L(302, 0, 140); L(288, 0, 160); L(316, 0, 165); L(200, 0, 160); L(272, 0, 104);
  // street parking
  for (const [x, z, yaw] of [[193, 128, 0], [193, 146, 0], [207, 96, Math.PI], [207, 160, Math.PI], [330, 104.5, Math.PI / 2], [262, 104.5, -Math.PI / 2], [345, 115.5, Math.PI / 2], [180, 115.5, -Math.PI / 2]]) {
    const t = pickType(); park(t, x, z, yaw, rnd.int(0, colorsOf[t] - 1));
  }

  // ================= Gridiron Galleria (mall) + Huddle Shops =================
  pois.push({ name: 'Gridiron Galleria', x: -115, z: 160, r: 60 });
  office(-115, 140, 64, 32, 2, 0xd9cdb8, [{ side: 1, off: -14 }, { side: 1, off: 8 }, { side: 0 }, { side: 2 }, { side: 3, off: -6 }],
    { stairX: -1, lootPer: 3, bag: 1, roof: 0x8a8f99, floor: 0xd8d2c6 });
  // shop fronts inside the ground floor (low partitions with openings)
  for (const x of [-131, -115, -99]) { box(x - 0.2, 0, 124.5, x + 0.2, 3.7, 133, 0xbfb29c, 'wall'); }
  bag(-123, 0, 127);
  sign(-115, 9.2, 156.4, 0, 'GRIDIRON GALLERIA', '#1f3a68', '#ffd23f', 26);
  decor.push({ type: 'asphalt', x: -115, z: 179, w: 124, d: 34 });
  reserve(-115, 179, 126, 36);
  lines(-172, -58, 171, 5.5, 5.5); lines(-172, -58, 188, 5.5, 5.5);
  parkRow(-172, -58, 171, 5.5, 0, 0.62);
  parkRow(-172, -58, 188, 5.5, Math.PI, 0.62);
  L(-150, 0, 180); L(-90, 0, 180); L(-115, 0, 179);
  // shop strip south of the road
  pois.push({ name: 'Huddle Shops', x: -115, z: 228, r: 45 });
  const shopCols = [0xe85d5d, 0x4f8be8, 0xf2c14e, 0x47b37a, 0xa064d8];
  for (let i = 0; i < 5; i++) {
    const x = -165 + i * 25;
    shell(x, 230, i === 2 ? 22 : 18, 14, i === 2 ? 6 : 4.8, shopCols[i], [{ side: 0 }, { side: 1, off: 4 }], 0xf4f4f4,
      { loot: i === 2 ? 2 : 1, bag: i === 2 ? [1, 1] : null, floor: 0xe6dccb });
  }
  sign(-115, 7.6, 222.7, Math.PI, 'PRO SHOP', '#c0392b', '#ffffff', 14);
  decor.push({ type: 'asphalt', x: -115, z: 212.5, w: 124, d: 9 });
  parkRow(-172, -58, 212.5, 7, Math.PI / 2, 0.45);

  // ================= Fuel Stop (gas station) =================
  pois.push({ name: 'Fuel Stop', x: -226, z: -178, r: 28 });
  reserve(-226, -178, 46, 40);
  decor.push({ type: 'pavement', x: -226, z: -178, w: 44, d: 36 });
  for (const [x, z] of [[-237, -189], [-215, -189], [-237, -177], [-215, -177]]) box(x - 0.35, 0, z - 0.35, x + 0.35, 5, z + 0.35, 0xf2f2f2, 'pillar');
  box(-240, 5, -192, -212, 5.6, -174, 0xd93a2b, 'roof');               // canopy (you can land on it)
  for (const x of [-231, -221]) box(x - 0.5, 0, -184, x + 0.5, 1.7, -182, 0x3a7bd5, 'box'); // pumps
  shell(-226, -164, 18, 9, 4.4, 0xf0ead8, [{ side: 0, off: 3 }], 0xd93a2b, { loot: 2, bag: [-1, -1] });
  sign(-226, 7.2, -192.4, Math.PI, 'FUEL STOP', '#d93a2b', '#ffffff', 12);
  park('truck', -236, -183, 0, 2); park('hatch', -226, -183, Math.PI, 4); park('cart', -216, -183, 0, 1);
  L(-226, 0, -188); L(-210, 0, -170);

  // ================= Kickoff Academy (school + gym + track) =================
  pois.push({ name: 'Kickoff Academy', x: -320, z: -110, r: 75 });
  reserve(-330, -105, 170, 120);
  office(-320, -142, 56, 16, 2, 0xc96f3a, [{ side: 1, off: -12 }, { side: 1, off: 12 }, { side: 2 }], { lootPer: 2, bag: 1, roof: 0x6b3a22, floor: 0xd4c49a });
  for (const x of [-332, -308]) box(x - 0.2, 0, -149.5, x + 0.2, 3.7, -140, 0xb06030, 'wall'); // classroom walls
  sign(-320, 9.2, -133.6, 0, 'KICKOFF ACADEMY', '#6b3a22', '#ffe08a', 22);
  // gym: tall hall with bleachers along the back wall
  shell(-385, -92, 30, 26, 9, 0x8a95a8, [{ side: 1, off: -6 }, { side: 3, w: 3.2, h: 3.4 }], 0x4a5160, { loot: 3, bag: [-1, 1], floor: 0xd9a066 });
  for (let i = 0; i < 4; i++) box(-399.5, 0, -104.5, -371, 0.6 * (i + 1), -98 - 1.4 * i, i % 2 ? 0x3a6fc8 : 0x2f5fb3, 'stand');
  L(-385, 2.4, -103.5); L(-378, 0, -88);
  decor.push({ type: 'tint', x: -312, z: -82, w: 82, d: 50, color: 0xb5553c, y: 0.03 });    // running track
  decor.push({ type: 'field', x: -312, z: -82, w: 60, d: 32, small: true });
  decor.push({ type: 'goalpost', x: -312 - 31, z: -82, rot: 0, small: true });
  decor.push({ type: 'goalpost', x: -312 + 31, z: -82, rot: 0, small: true });
  for (let k = 0; k < 3; k++) box(-336, 0, -58 + k * 1.4, -288, 0.6 * (k + 1), -54, 0x9aa2ad, 'stand');
  L(-330, 0, -82); L(-295, 0, -82); L(-312, 0, -70);
  decor.push({ type: 'asphalt', x: -380, z: -170, w: 56, d: 20 });
  lines(-404, -356, -170, 6, 5.5);
  parkRow(-404, -356, -170, 6, 0, 0.75);
  park('truck', -258, -128, 0, 3); park('hatch', -258, -116, 0, 6);

  // ================= Splash Zone (water park) =================
  pois.push({ name: 'Splash Zone', x: 330, z: 420, r: 70 });
  reserve(330, 420, 150, 124);
  decor.push({ type: 'pavement', x: 330, z: 420, w: 146, d: 120 });
  decor.push({ type: 'tint', x: 310, z: 425, w: 56, d: 38, color: 0x3fb6e8, y: 0.03 });     // wave pool
  decor.push({ type: 'tint', x: 310, z: 425, w: 50, d: 32, color: 0x58c8f2, y: 0.045 });
  decor.push({ type: 'tint', x: 378, z: 395, w: 20, d: 20, color: 0x3fb6e8, y: 0.03 });     // splash pool
  decor.push({ type: 'tint', x: 378, z: 452, w: 22, d: 14, color: 0x3fb6e8, y: 0.03 });     // slide landing pool
  // slide towers: ground-standing stairs up to solid platforms (bots can climb them too)
  for (const [x, z, n, col] of [[352, 462, 16, 0xf2c14e], [404, 462, 12, 0xe85d5d]]) {
    box(x - 2.5, 0, z - 2.5, x + 2.5, n * 0.5, z + 2.5, col, 'box');
    groundStairs(x - 2.5, z, 2, n, 3, 0xdedede);   // walk up toward +x onto the platform
    L(x, n * 0.5, z);
    decor.push({ type: 'slide', x0: x, z0: z - 2.5, y0: n * 0.5, x1: x < 380 ? 372 : 384, z1: 450, color: col === 0xf2c14e ? '#ff8a30' : '#3a8bff' });
  }
  shell(268, 380, 20, 10, 4, 0x5cc8ff, [{ side: 1 }, { side: 3 }], 0xffffff, { loot: 2, bag: [-1, -1], floor: 0xdfe8ec }); // changing rooms
  shell(268, 455, 12, 9, 4, 0xffd35c, [{ side: 3 }], 0xff5ca8, { loot: 1 });                                         // snack hut
  for (let i = 0; i < 8; i++) box(285 + i * 6, 0, 449, 287 + i * 6, 0.45, 453, 0xffffff, 'box');                         // loungers
  for (const [x, z] of [[340, 405], [282, 440]]) { box(x - 0.8, 0, z - 0.8, x + 0.8, 3, z + 0.8, 0xffffff, 'box'); L(x + 2, 0, z); } // lifeguard stands
  for (let i = 0; i < 10; i++) trees.push({ x: 262 + i * 15, z: 366 + (i % 2) * 4, h: rnd.range(8, 11), r: 2.2, pine: false });
  bag(330, 0, 400);
  sign(300, 6.5, 359.8, Math.PI, 'SPLASH ZONE', '#18b6c9', '#ffffff', 14);
  box(299.6, 0, 360.2, 300.4, 4.5, 361, 0xdddddd, 'pillar');
  decor.push({ type: 'asphalt', x: 330, z: 350, w: 120, d: 12 });
  lines(276, 384, 350, 6, 5.5);
  parkRow(276, 384, 350, 6, Math.PI, 0.5);
  scatterAround(330, 425, 30, 5);

  // ================= Signal Hill (TV tower + studio) =================
  pois.push({ name: 'Signal Hill', x: 445, z: -300, r: 50 });
  reserve(445, -295, 84, 110);
  office(440, -258, 26, 16, 2, 0x5d5f73, [{ side: 1 }, { side: 2 }], { bag: 1, stairX: 1, roof: 0x2f3138 });   // KICK TV studios
  sign(440, 9.2, -249.6, 0, 'KICK TV', '#2b2f3a', '#ff5a2a', 10);
  {
    const x = 448, z = -318;
    box(x - 4, 0, z - 4, x + 4, 3, z + 4, 0x8a8f99, 'box');          // base block (stairs up to it)
    groundStairs(x, z + 4, 2.2, 6, 0, 0x9aa0a8);
    for (let i = 0; i < 9; i++) { const y = 3 + i * 8; box(x - 1.2, y, z - 1.2, x + 1.2, y + 8, z + 1.2, i % 2 ? 0xffffff : 0xe03a2a, 'pillar'); }
    box(x - 4, 38, z - 4, x + 4, 39, z + 4, 0xb0b5bd, 'box');         // service deck
    box(x - 0.3, 75, z - 0.3, x + 0.3, 92, z + 0.3, 0xe03a2a, 'pillar'); // antenna
    L(x - 2.6, 3, z - 2.6); L(x + 6, 0, z + 9);
    bag(x + 2.6, 3, z + 2.6);
  }
  for (const [x, z] of [[432, -262], [436, -254]]) box(x - 1.2, 8, z - 0.2, x + 1.2, 10.2, z + 0.2, 0xf0f0f0, 'box'); // dishes on the studio roof
  shell(470, -300, 10, 8, 4, 0x7d8fa8, [{ side: 2 }], 0x3b4a8a, { loot: 1 });
  park('truck', 425, -282, 0, 1); park('hatch', 432, -282, 0, 2);

  // ================= Farms on the edges =================
  function farm(name, cx, cz, flip) {
    pois.push({ name, x: cx, z: cz, r: 45 });
    reserve(cx, cz, 84, 84);
    // crop fields (rows of green and brown)
    for (let i = 0; i < 8; i++) decor.push({ type: 'tint', x: cx - 24 * flip + (i - 3.5) * 4, z: cz + 22, w: 3, d: 30, color: i % 2 ? 0x7a5a32 : 0x8fbf3a, y: 0.03 });
    // barn with a hayloft (ground-standing stairs up to a loft over the back half)
    const bx = cx + 12 * flip, bz = cz - 12;
    shell(bx, bz, 22, 16, 8, 0xb5332e, [{ side: 1, w: 4, h: 4.2 }, { side: 0, off: 6 }], 0x4d2f17, { loot: 2, bag: [-flip, 1], floor: 0xc8a96a });
    box(bx - 10.75, 3.2, bz - 7.75, bx + 10.75, 3.5, bz - 1, 0x9a6b3a, 'slab');          // hayloft
    for (let i = 0; i < 7; i++) box(bx + 7.5, 0, bz - 1 + (6 - i) * 0.7, bx + 9.5, (i + 1) * 0.5, bz - 1 + (7 - i) * 0.7, 0x8b5a2b, 'stairs');
    L(bx - 4, 3.5, bz - 4); L(bx + 2, 3.5, bz - 5);
    for (const [x, z] of [[bx - 6, bz + 3], [bx - 3, bz + 4]]) box(x - 0.7, 0, z - 0.6, x + 0.7, 1.2, z + 0.6, 0xe0c060, 'box'); // hay bales
    // silo
    const sx = bx + 15 * flip, sz = bz;
    box(sx - 3, 0, sz - 3, sx + 3, 16, sz + 3, 0xc8ccd2, 'pillar');
    box(sx - 2.2, 16, sz - 2.2, sx + 2.2, 18, sz + 2.2, 0x9aa3ad, 'pillar');
    reserve(sx, sz, 10, 10);
    // farmhouse and fenced pen
    shell(cx - 18 * flip, cz - 14, 13, 10, 4.6, 0xf0e0c0, [{ side: 1 }], 0x8a3b2e, { loot: 1 });
    const px = cx - 16 * flip, pz = cz + 2;
    for (const [a, b, c, d] of [[px - 8, pz - 5, px - 1, pz - 4.8], [px + 1.5, pz - 5, px + 8, pz - 4.8], [px - 8, pz + 4.8, px + 8, pz + 5], [px - 8, pz - 5, px - 7.8, pz + 5], [px + 7.8, pz - 5, px + 8, pz + 5]]) box(a, 0, b, c, 1.1, d, 0xd9c7a0, 'fence');
    for (const [x, z] of [[cx + 30, cz + 20], [cx + 26, cz + 26], [cx - 2, cz + 32]]) box(x - 0.7, 0, z - 0.6, x + 0.7, 1.2, z + 0.6, 0xe0c060, 'box');
    L(px, 0, pz); L(cx, 0, cz + 6);
    park('truck', cx + 2 * flip, cz + 3, flip > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
  }
  farm('Hayfield Farm', -445, 425, 1);
  farm('Cornerback Farm', 448, 8, -1);
  farm('Sunrise Farm', 60, -452, 1);

  // ================= Neighborhoods =================
  const houseColors = [0xe8d8b0, 0xb0d0e8, 0xe8b0b0, 0xc0e8b0, 0xf0e0f0, 0xd0c0a0, 0xf2d0a0, 0xc8c8e8];
  const roofs = [0x8a3b2e, 0x3b4a8a, 0x555555, 0x2f5a3a];
  // A street of houses: two rows facing each other across a street running along z at x = sc
  // (alongZ) or along x at z = sc. Some are two-story houses with stairs and a roof deck.
  function street(name, alongZ, sc, a0, n, da, pa) {
    const P = (along, across) => (alongZ ? [across, along] : [along, across]); // -> [x, z]
    const [px, pz] = P(pa, sc);
    pois.push({ name, x: px, z: pz, r: 55 });
    const len = Math.abs((n - 1) * da) + 20, mid = a0 + (n - 1) * da / 2;
    if (alongZ) road(sc, mid, 8, len); else road(mid, sc, len, 8);
    for (let i = 0; i < n; i++) {
      const a = a0 + i * da;
      for (const side of [-1, 1]) {
        const [cx, cz] = P(a, sc + side * 18), col = rnd.pick(houseColors), roof = rnd.pick(roofs);
        const door = alongZ ? (side < 0 ? 3 : 2) : (side < 0 ? 1 : 0);
        if (rnd() < 0.3) office(cx, cz, 13, 11, 2, col, [{ side: door }], { stairX: alongZ ? side : 1, lootPer: 1, roof, floor: 0xc9b28a });
        else shell(cx, cz, rnd.range(10, 13), rnd.range(9, 11), 4.4, col, door, roof, { bag: rnd() < 0.1 ? (alongZ ? [side, 1] : [1, side]) : null });
        if (rnd() < 0.45) {
          const t = pickType(), [vx, vz] = P(a + 1, sc + side * 7.5);
          park(t, vx, vz, (alongZ ? 0 : Math.PI / 2) + (rnd() < 0.5 ? 0 : Math.PI), rnd.int(0, colorsOf[t] - 1));
        }
      }
    }
  }
  street('Touchback Terrace', true, 115, 250, 8, 31, 360);
  street('Two-Point Pines', true, -110, 330, 5, 32, 395);
  street('Hash Mark Hills', true, 130, -372, 5, 34, -300);
  street('Fourth Down Flats', false, 92, -380, 5, 36, -300);
  street('Red Zone Row', false, -452, -360, 5, 38, -284);

  // ================= Pit Stop Garage (car repair shop + used-cart lot) =================
  pois.push({ name: 'Pit Stop Garage', x: 300, z: -450, r: 45 });
  reserve(300, -450, 110, 70);
  decor.push({ type: 'asphalt', x: 300, z: -450, w: 104, d: 64 });
  shell(285, -466, 40, 18, 7, 0x8f9aa8, [{ side: 1, off: -12, w: 5, h: 4.5 }, { side: 1, off: 0, w: 5, h: 4.5 }, { side: 1, off: 12, w: 5, h: 4.5 }, { side: 3 }],
    0x3c4250, { loot: 3, bag: [-1, -1], floor: 0x9a9a9a });
  for (const x of [279, 291]) box(x - 0.2, 0, -474.75, x + 0.2, 3.5, -466, 0x6f7886, 'wall'); // bay walls
  park('hatch', 273, -468, 0, 5); park('truck', 297, -468, Math.PI, 3);  // cars in the repair bays
  sign(285, 8.4, -456.6, 0, 'PIT STOP GARAGE', '#1d2026', '#ffcc33', 18);
  lines(256, 344, -440, 6, 5.5); lines(326, 344, -460, 6, 5.5);
  parkRow(256, 344, -440, 6, Math.PI, 0.7);
  parkRow(326, 344, -460, 6, 0, 0.8);
  for (const [x, z] of [[316, -470], [318, -478]]) box(x - 0.6, 0, z - 0.6, x + 0.6, 1.0, z + 0.6, 0x2a2d33, 'box'); // tire stacks
  L(310, 0, -452); L(262, 0, -452);

  // ================= Roads joining the new places =================
  road(200, -4, 12, 348);       // Skyline avenue: Locker Town -> Skyline Heights (x = 200)
  road(-196, 0, 10, 392);       // west avenue: Fuel Stop -> Snack Shack Row -> Galleria
  road(274, 340, 248, 8);       // Tailgate Lot <-> Splash Zone (z = 340)
  road(398, -28, 8, 744);       // east ring road (x = 398)
  road(-20, -400, 840, 8);      // north road (z = -400)
  road(-420, -10, 8, 780);      // west ring road (x = -420)
  road(-90, 478, 680, 8);       // south road (z = 478)

  function scatterAround(cx, cz, rad, n) {
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * rad; L(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r); }
  }

  // Loot never inside a wall, partition or step: nudge spots that landed in one, or drop them.
  const mine = A.boxes.slice(box0);
  const blocked = (x, y, z) => mine.some((b) => x > b.min[0] - 0.4 && x < b.max[0] + 0.4 && z > b.min[2] - 0.4 && z < b.max[2] + 0.4 && b.min[1] < y + 1 && b.max[1] > y + 0.1);
  const nudges = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [2.4, 0], [-2.4, 0], [0, 2.4], [0, -2.4]];
  const kept = loot.splice(loot0).flatMap((s) => {
    const n = nudges.find(([dx, dz]) => !blocked(s.x + dx, s.y, s.z + dz));
    return n ? [{ x: s.x + n[0], y: s.y, z: s.z + n[1] }] : [];
  });
  loot.push(...kept);
}
