// Builds the Giant Sports City. Same seed => same city on server and every browser.
import { makeRng } from './rng.js';
import { MAP_HALF } from './constants.js';
import { buildDistricts } from './districts.js';
import { VEHICLE_TYPES } from './vehicles.js';
import { buildMegaDome, DOME_FOOT } from './megadome.js';

export const MAP_SEED = 20261119;

export function generateMap(seed = MAP_SEED) {
  const rnd = makeRng(seed);
  const boxes = [];   // solid things: {min,max,color,kind,ramp?}
  const decor = [];   // flat/visual only things
  const trees = [];
  const loot = [];    // floor-loot spots {x,y,z}
  const chests = [];  // equipment bag spots
  const pois = [];    // named places {name,x,z,r}
  const reserved = []; // rectangles where we shouldn't scatter trees
  const vehicles = []; // drivable vehicle spots {type,x,z,yaw,color} (see shared/vehicles.js)
  const elevators = []; // Mega Dome elevators (shared/elevators.js)

  const box = (x0, y0, z0, x1, y1, z1, color, kind = 'box') => {
    const b = { min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], color, kind };
    boxes.push(b); return b;
  };
  const reserve = (x, z, w, d) => reserved.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
  const isReserved = (x, z, pad = 0) => reserved.some((r) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad);

  // A building you can walk into. door: 0=-z,1=+z,2=-x,3=+x
  function house(cx, cz, w, d, h, color, door, roof = 0x8a3b2e) {
    const t = 0.5, dw = 2.6, dh = 3.0;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const wallX = (z, hasDoor) => { // wall running along x at z
      if (!hasDoor) return box(x0, 0, z - t / 2, x1, h, z + t / 2, color, 'wall');
      box(x0, 0, z - t / 2, cx - dw / 2, h, z + t / 2, color, 'wall');
      box(cx + dw / 2, 0, z - t / 2, x1, h, z + t / 2, color, 'wall');
      box(cx - dw / 2, dh, z - t / 2, cx + dw / 2, h, z + t / 2, color, 'wall');
    };
    const wallZ = (x, hasDoor) => {
      if (!hasDoor) return box(x - t / 2, 0, z0, x + t / 2, h, z1, color, 'wall');
      box(x - t / 2, 0, z0, x + t / 2, h, cz - dw / 2, color, 'wall');
      box(x - t / 2, 0, cz + dw / 2, x + t / 2, h, z1, color, 'wall');
      box(x - t / 2, dh, cz - dw / 2, x + t / 2, h, cz + dw / 2, color, 'wall');
    };
    wallX(z0, door === 0); wallX(z1, door === 1);
    wallZ(x0, door === 2); wallZ(x1, door === 3);
    box(x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.5, z1 + 0.3, roof, 'roof');
    decor.push({ type: 'floor', x: cx, z: cz, w: w - t, d: d - t, color: 0xc9b28a });
    loot.push({ x: cx + rnd.range(-w / 4, w / 4), y: 0, z: cz + rnd.range(-d / 4, d / 4) });
    if (w * d > 90) loot.push({ x: cx + rnd.range(-w / 4, w / 4), y: 0, z: cz + rnd.range(-d / 4, d / 4) });
    if (rnd() < 0.35) chests.push({ x: cx + (w / 2 - 1.2) * (rnd() < 0.5 ? -1 : 1), y: 0, z: cz + (d / 2 - 1.2) * (rnd() < 0.5 ? -1 : 1) });
    reserve(cx, cz, w + 6, d + 6);
  }

  function scatterLoot(cx, cz, rad, n, y = 0) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * rad;
      loot.push({ x: cx + Math.cos(a) * r, y, z: cz + Math.sin(a) * r });
    }
  }

  // ---------------- Mega Dome (center stadium): shared/megadome.js ----------------
  // (draws its own random numbers, and burns the 32 the old stadium used so the rest of
  // the city stays exactly where it was)
  for (let i = 0; i < 32; i++) rnd();
  reserve(0, 0, 190, 130);
  buildMegaDome({ box, decor, loot, chests, pois, elevators, seed });

  // ---------------- Practice Fields ----------------
  pois.push({ name: 'Practice Fields', x: -290, z: -280, r: 90 });
  reserve(-290, -280, 200, 150);
  for (let i = 0; i < 3; i++) {
    const fx = -290 + (i - 1) * 64;
    decor.push({ type: 'field', x: fx, z: -295, w: 56, d: 30, small: true });
    decor.push({ type: 'goalpost', x: fx, z: -295 - 16, rot: 1, small: true });
    for (let k = 0; k < 3; k++) box(fx - 20, 0, -276 + k * 1.4, fx + 20, 0.6 * (k + 1), -272, 0x9aa2ad, 'stand');
    scatterLoot(fx, -295, 18, 3);
  }
  house(-290, -232, 24, 14, 5, 0xc96f3a, 0);
  house(-350, -240, 12, 10, 4.5, 0x7d8fa8, 1);
  chests.push({ x: -290, y: 0, z: -295 });
  for (let i = 0; i < 6; i++) box(-340 + i * 3, 0, -330, -339 + i * 3, 1.2 + (i % 2), -326, 0xe0b040, 'box'); // tackling sleds

  // ---------------- Locker Town (downtown) ----------------
  pois.push({ name: 'Locker Town', x: 280, z: -280, r: 110 });
  reserve(280, -280, 220, 220);
  decor.push({ type: 'pavement', x: 280, z: -280, w: 210, d: 210 });
  const townColors = [0x6b7a8f, 0x8f6b6b, 0x6b8f78, 0xa39270, 0x5d5f73, 0xb0a8a0, 0x7f6aa3];
  for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 5; gz++) {
    const cx = 200 + gx * 40, cz = -360 + gz * 40;
    const col = rnd.pick(townColors);
    if (rnd() < 0.42) {
      const w = rnd.range(14, 24), d = rnd.range(14, 24), h = rnd.range(14, 48);
      box(cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2, col, 'tower');
      loot.push({ x: cx + w / 2 + 2, y: 0, z: cz });
    } else {
      house(cx, cz, rnd.range(12, 20), rnd.range(10, 18), rnd.range(4.5, 6.5), col, rnd.int(0, 3), 0x3c3f47);
    }
  }
  chests.push({ x: 300, y: 0, z: -300 }, { x: 240, y: 0, z: -320 }); // street crossing + inside a shop (block centres can be solid towers)

  // ---------------- Tailgate Lot ----------------
  pois.push({ name: 'Tailgate Lot', x: 290, z: 260, r: 95 });
  reserve(290, 260, 180, 140);
  decor.push({ type: 'asphalt', x: 290, z: 260, w: 170, d: 130 });
  // Every car in the lot is a drivable vehicle (there are no static car boxes anywhere any
  // more). The same random numbers are drawn as when most of them were parked boxes, so the
  // rest of the city doesn't change.
  const lotTypes = ['hatch', 'truck', 'hatch', 'cart', 'truck', 'hatch', 'truck'];
  const driveSlots = { '0,3': 0, '1,8': 1, '2,1': 2, '3,6': 3, '4,10': 0 };
  for (let row = 0; row < 5; row++) for (let i = 0; i < 12; i++) {
    const slot = driveSlots[`${row},${i}`];
    const yaw = row % 2 ? 0 : Math.PI;
    if (slot !== undefined) {
      if (rnd() >= 0.35) { rnd.range(-1, 1); rnd(); }
      vehicles.push({ type: 'truck', x: 220 + i * 12, z: 210 + row * 24, yaw, color: slot });
      continue;
    }
    if (rnd() < 0.35) continue;
    const x = 220 + i * 12 + rnd.range(-1, 1), z = 210 + row * 24;
    const c = Math.floor(rnd() * 7), type = lotTypes[(c + row + i) % lotTypes.length];
    vehicles.push({ type, x: Math.round(x * 100) / 100, z, yaw, color: (c + i) % (type === 'hatch' ? 8 : 4) });
  }
  for (let i = 0; i < 6; i++) {
    const x = 225 + i * 26, z = 320;
    decor.push({ type: 'tent', x, z, color: rnd.pick([0xff5a5a, 0x4a90ff, 0xffd34a, 0x50d080]) });
    loot.push({ x, y: 0, z });
  }
  box(330, 0, 196, 342, 3.2, 201, 0xffffff, 'box'); // food truck
  box(250, 0, 196, 262, 3.2, 201, 0xffb84d, 'box');
  scatterLoot(290, 260, 70, 10);
  chests.push({ x: 290, y: 0, z: 258 }, { x: 336, y: 0, z: 204 });

  // ---------------- New districts (shared/districts.js) ----------------
  // Skyline Heights, Gridiron Galleria + Huddle Shops, Fuel Stop, Kickoff Academy, Splash Zone,
  // Signal Hill, three farms, three neighborhoods and the roads between them. Built before any
  // trees so the reserved areas stay clear.
  buildDistricts({ seed, box, boxes, decor, loot, chests, pois, reserve, vehicles, trees });

  // ---------------- Training Camp Woods ----------------
  pois.push({ name: 'Training Camp Woods', x: -300, z: 260, r: 110 });
  house(-320, 230, 12, 9, 4.2, 0x8b5a2b, 1, 0x4d2f17);
  house(-270, 300, 12, 9, 4.2, 0x8b5a2b, 0, 0x4d2f17);
  house(-350, 310, 10, 8, 4.2, 0x8b5a2b, 3, 0x4d2f17);
  house(-240, 220, 16, 10, 4.6, 0x6f4a2a, 2, 0x4d2f17);
  for (let i = 0; i < 8; i++) box(-300 + i * 6, 0, 260, -299 + i * 6, 1.2 + (i % 3) * 0.6, 263, 0xa0522d, 'box'); // obstacle course
  for (let i = 0; i < 160; i++) {
    const x = -300 + rnd.range(-110, 110), z = 260 + rnd.range(-110, 110);
    if (isReserved(x, z, 2)) continue;
    trees.push({ x, z, h: rnd.range(7, 13), r: rnd.range(2.2, 3.6), pine: rnd() < 0.7 });
  }
  scatterLoot(-300, 260, 100, 12);
  chests.push({ x: -300, y: 0, z: 268 }, { x: -230, y: 0, z: 330 });

  // ---------------- Hall of Champs ----------------
  pois.push({ name: 'Hall of Champs', x: 0, z: 330, r: 50 });
  {
    const cx = 0, cz = 330, w = 54, d = 32, h = 11, t = 0.8, col = 0xe8e2d0;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    for (const z of [z0, z1]) {
      box(x0, 0, z - t / 2, cx - 3, h, z + t / 2, col, 'wall');
      box(cx + 3, 0, z - t / 2, x1, h, z + t / 2, col, 'wall');
      box(cx - 3, 4, z - t / 2, cx + 3, h, z + t / 2, col, 'wall');
    }
    for (const x of [x0, x1]) {
      box(x - t / 2, 0, z0, x + t / 2, h, cz - 2.5, col, 'wall');
      box(x - t / 2, 0, cz + 2.5, x + t / 2, h, z1, col, 'wall');
      box(x - t / 2, 4, cz - 2.5, x + t / 2, h, cz + 2.5, col, 'wall');
    }
    box(x0 - 1, h, z0 - 1, x1 + 1, h + 1, z1 + 1, 0xb08d57, 'roof');
    for (let i = 0; i < 5; i++) for (const z of [cz - 8, cz + 8]) box(x0 + 6 + i * 10.5 - 0.8, 0, z - 0.8, x0 + 6 + i * 10.5 + 0.8, h, z + 0.8, 0xd8d0b8, 'pillar');
    box(cx - 3, 0, cz - 3, cx + 3, 1.2, cz + 3, 0x555555, 'box');
    decor.push({ type: 'floor', x: cx, z: cz, w: w - 1, d: d - 1, color: 0x9c2b2b });
    decor.push({ type: 'trophy', x: cx, z: cz, y: 1.2 });
    scatterLoot(cx, cz, 12, 6);
    chests.push({ x: cx - 20, y: 0, z: cz }, { x: cx + 20, y: 0, z: cz });
    reserve(cx, cz, w + 10, d + 10);
  }

  // ---------------- Suburbs ----------------
  pois.push({ name: 'Sideline Suburbs', x: 0, z: -320, r: 90 });
  const houseColors = [0xe8d8b0, 0xb0d0e8, 0xe8b0b0, 0xc0e8b0, 0xf0e0f0, 0xd0c0a0];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    house(-75 + i * 50, -370 + j * 45, rnd.range(10, 14), rnd.range(9, 12), 4.5, rnd.pick(houseColors), j === 1 ? 1 : 0, rnd.pick([0x8a3b2e, 0x3b4a8a, 0x555555]));
  }

  // ---------------- Snack Shack Row ----------------
  pois.push({ name: 'Snack Shack Row', x: -270, z: 0, r: 60 });
  for (let i = 0; i < 5; i++) house(-330 + i * 30, -10, 11, 9, 4.2, rnd.pick([0xff8a5c, 0xffd35c, 0x5cc8ff, 0xff5ca8, 0x8cff5c]), 1, 0xffffff);
  for (let i = 0; i < 5; i++) house(-330 + i * 30, 25, 11, 9, 4.2, rnd.pick([0xff8a5c, 0xffd35c, 0x5cc8ff, 0xff5ca8, 0x8cff5c]), 0, 0xffffff);
  decor.push({ type: 'asphalt', x: -270, z: 7.5, w: 160, d: 14 });

  // ---------------- Mascot Plaza ----------------
  pois.push({ name: 'Mascot Plaza', x: 280, z: 0, r: 55 });
  reserve(280, 0, 110, 110);
  decor.push({ type: 'pavement', x: 280, z: 0, w: 100, d: 100 });
  box(272, 0, -8, 288, 3, 8, 0x999999, 'box'); // statue base
  box(276, 3, -2, 284, 6, 2, 0x8b4513, 'box');  // giant football
  decor.push({ type: 'bigball', x: 280, z: 0, y: 3 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    house(280 + Math.cos(a) * 40, Math.sin(a) * 40, 12, 12, 6, 0xc0b8d8, i < 2 ? 0 : 1, 0x5a4a8a);
  }
  scatterLoot(280, 0, 30, 6);
  chests.push({ x: 280, y: 0, z: 14 });

  // ---------------- Water tower hill & scattered stuff ----------------
  box(-120, 0, -150, -116, 22, -146, 0x9aa7b8, 'pillar');
  box(-124, 22, -154, -112, 30, -142, 0x9aa7b8, 'box');
  decor.push({ type: 'tank', x: -118, z: -148, y: 22 });
  pois.push({ name: 'Water Tower', x: -118, z: -148, r: 25 });
  loot.push({ x: -118, y: 30, z: -148 });
  reserve(-118, -148, 20, 20);
  for (let i = 0; i < 25; i++) {
    let x, z, tries = 0;
    do { x = rnd.range(-MAP_HALF + 40, MAP_HALF - 40); z = rnd.range(-MAP_HALF + 40, MAP_HALF - 40); } while (isReserved(x, z, 10) && ++tries < 30);
    if (tries >= 30) continue;
    house(x, z, rnd.range(9, 13), rnd.range(8, 11), 4.4, rnd.pick(houseColors), rnd.int(0, 3), rnd.pick([0x8a3b2e, 0x3b4a8a, 0x555555]));
  }
  // Roads
  decor.push({ type: 'road', x: 0, z: 0, w: 10, d: MAP_HALF * 2 });
  decor.push({ type: 'road', x: 0, z: 0, w: MAP_HALF * 2, d: 10 });
  decor.push({ type: 'road', x: 0, z: -200, w: MAP_HALF * 2, d: 8 });
  decor.push({ type: 'road', x: 0, z: 200, w: MAP_HALF * 2, d: 8 });
  // Trees everywhere else
  for (let i = 0; i < 420; i++) {
    const x = rnd.range(-MAP_HALF + 5, MAP_HALF - 5), z = rnd.range(-MAP_HALF + 5, MAP_HALF - 5);
    if (isReserved(x, z, 3) || Math.abs(x) < 8 || Math.abs(z) < 8 || Math.abs(Math.abs(z) - 200) < 7) continue;
    trees.push({ x, z, h: rnd.range(6, 12), r: rnd.range(2, 3.5), pine: rnd() < 0.4 });
  }
  // Random floor loot in the wild (fewer since the new districts brought ~150 indoor spots)
  const wildLoot0 = loot.length;
  for (let i = 0; i < 60; i++) {
    const x = rnd.range(-MAP_HALF + 20, MAP_HALF - 20), z = rnd.range(-MAP_HALF + 20, MAP_HALF - 20);
    loot.push({ x, y: 0, z });
  }
  // nothing random inside the Mega Dome or around its arch feet
  const inDome = (x, z, pad) => Math.abs(x) < DOME_FOOT.x + pad && Math.abs(z) < DOME_FOOT.z + pad;
  for (let i = trees.length - 1; i >= 0; i--) if (inDome(trees[i].x, trees[i].z, 18) || (Math.abs(trees[i].x) < 135 && Math.abs(trees[i].z) < 32)) trees.splice(i, 1);
  for (let i = loot.length - 1; i >= wildLoot0; i--) if (inDome(loot[i].x, loot[i].z, 2)) loot.splice(i, 1);
  // Tree trunks are solid
  for (const t of trees) box(t.x - 0.4, 0, t.z - 0.4, t.x + 0.4, t.h * 0.6, t.z + 0.4, 0x6b4423, 'trunk');

    // Drivable vehicles around the rest of the city (spots checked clear of buildings and trees
  // by test/vehicles.test.js)
  vehicles.push(
    { type: 'cart', x: -6, z: 88, yaw: 0, color: 0 },             // Mega Dome, south road
    { type: 'truck', x: 6, z: -88, yaw: Math.PI, color: 1 },      // Mega Dome, north road
    { type: 'cart', x: 112, z: 4, yaw: -Math.PI / 2, color: 1 },  // Mega Dome, east road
    { type: 'truck', x: -112, z: -4, yaw: Math.PI / 2, color: 2 }, // Mega Dome, west road
    { type: 'truck', x: 220, z: -300, yaw: 0, color: 3 },         // Locker Town streets
    { type: 'cart', x: 300, z: -220, yaw: Math.PI / 2, color: 2 },
    { type: 'cart', x: -50, z: -330, yaw: 0, color: 3 },          // Sideline Suburbs
    { type: 'truck', x: 25, z: -302, yaw: Math.PI / 2, color: 0 },
    { type: 'truck', x: -160, z: 200, yaw: Math.PI / 2, color: 1 }, // the big roads
    { type: 'cart', x: 160, z: -200, yaw: -Math.PI / 2, color: 0 },
    { type: 'truck', x: 0, z: 160, yaw: 0, color: 2 },
    { type: 'cart', x: -250, z: 7.5, yaw: Math.PI / 2, color: 1 }, // Snack Shack Row
  );
  // Safety net: a vehicle spot must have room around it to get in and drive off (the city
  // layout is checked by test/vehicles.test.js; this only drops a spot a tree or a random
  // house happened to land on).
  const clear = (v) => {
    const T = VEHICLE_TYPES[v.type], c = Math.abs(Math.cos(v.yaw)), s = Math.abs(Math.sin(v.yaw));
    const hx = ((T.W + 1.5) * c + (T.L + 1.5) * s) / 2, hz = ((T.W + 1.5) * s + (T.L + 1.5) * c) / 2;
    return !boxes.some((b) => b.max[1] > 0.75 && b.min[1] < T.h + 0.4 && b.min[0] < v.x + hx && b.max[0] > v.x - hx && b.min[2] < v.z + hz && b.max[2] > v.z - hz);
  };
  return { boxes, decor, trees, loot, chests, pois, vehicles: vehicles.filter(clear), elevators };
}
