// The city generator: deterministic, the new districts are there, stairs are climbable,
// loot isn't inside walls, buildings don't overlap roads or each other.
import { test } from 'node:test';
import assert from 'node:assert';
import { generateMap } from '../shared/map.js';
import { World, stepPlayer, supportHeight } from '../shared/physics.js';
import { PLAYER, MAP_HALF } from '../shared/constants.js';
import { FH } from '../shared/districts.js';
import { buildNav } from '../server/nav.js';

const MAP = generateMap();
const world = new World();
for (const b of MAP.boxes) world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
const insideSolid = (x, y, z) => world.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3)
  .some((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && y + 0.5 > b.min[1] && y + 0.5 < b.max[1]);

test('same seed, same city', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(generateMap())), JSON.parse(JSON.stringify(MAP)));
});

test('the new places are on the map', () => {
  const names = MAP.pois.map((p) => p.name);
  for (const n of ['Skyline Heights', 'Gridiron Galleria', 'Huddle Shops', 'Fuel Stop', 'Kickoff Academy', 'Splash Zone',
    'Signal Hill', 'Hayfield Farm', 'Cornerback Farm', 'Sunrise Farm', 'Touchback Terrace', 'Two-Point Pines', 'Hash Mark Hills']) {
    assert.ok(names.includes(n), `${n} is a named place`);
  }
  assert.equal(new Set(names).size, names.length, 'names are unique');
  for (const p of MAP.pois) assert.ok(Math.abs(p.x) < MAP_HALF && Math.abs(p.z) < MAP_HALF, `${p.name} inside the map`);
  assert.ok(MAP.boxes.filter((b) => b.kind === 'tower').length >= 15, 'a real skyline');
  assert.ok(MAP.boxes.some((b) => b.max[1] >= 90), 'something tall to look at');
});

test('the new districts keep out of the Mega Dome area', () => {
  // the stadium (|x| < 135, |z| < 105) is rebuilt separately: nothing from shared/districts.js lands there
  const mine = MAP.boxes.filter((b) => ['facade', 'stairs', 'slab', 'fence'].includes(b.kind) && !b.dome);
  for (const b of mine) assert.ok(b.max[0] < -135 || b.min[0] > 135 || b.max[2] < -105 || b.min[2] > 105, `box at ${b.min} is outside the dome area`);
});

test('floor loot spots are never inside walls, steps or partitions (new districts)', () => {
  let n = 0;
  for (const s of MAP.loot) {
    const domeOrOld = Math.abs(s.x) < 135 && Math.abs(s.z) < 105;
    if (domeOrOld) continue;
    const y = supportHeight(world, s.x, s.y + 0.5, s.z);
    if (insideSolid(s.x, y, s.z)) n++;
  }
  // a couple of random "wild" spots can land inside an older building (spawnLoot skips them)
  assert.ok(n <= 3, `${n} loot spots inside something solid`);
});

test('every step of every staircase is low enough to walk up', () => {
  const steps = MAP.boxes.filter((b) => b.kind === 'stairs');
  assert.ok(steps.length > 100, `${steps.length} steps`);
  for (const s of steps) {
    // each step rises 0.5 m above the one before it (the floor or the previous step)
    const h = s.max[1] - s.min[1];
    assert.ok(Math.abs(h / 0.5 - Math.round(h / 0.5)) < 1e-6, `step height ${h}`);
  }
  assert.ok(0.5 <= PLAYER.stepUp);
});

test('you can walk up the stairs of Huddle HQ to its roof', () => {
  // Huddle HQ: 3 floors, x 158..186, z 139..161, stairs along the east wall
  const p = { x: 184.75, y: 0, z: 139.9, vx: 0, vy: 0, vz: 0, onGround: true };
  const walk = (yaw, until, max = 400) => {
    for (let i = 0; i < max && !until(); i++) stepPlayer(world, p, { f: 1, s: 0, yaw, jump: false }, 1 / 60);
  };
  walk(Math.PI, () => p.z > 147.6);           // flight 1 (+z)
  assert.ok(Math.abs(p.y - FH) < 0.05, `first floor, y=${p.y.toFixed(2)}`);
  walk(Math.PI / 2, () => p.x < 182.75);      // over to the next flight
  walk(0, () => p.z < 140.2);                 // flight 2 (-z)
  assert.ok(Math.abs(p.y - 2 * FH) < 0.05, `second floor, y=${p.y.toFixed(2)}`);
  walk(-Math.PI / 2, () => p.x > 184.75);
  walk(Math.PI, () => p.z > 147.6);           // flight 3 (+z) comes out on the roof
  assert.ok(Math.abs(p.y - 3 * FH) < 0.05, `on the roof, y=${p.y.toFixed(2)}`);
  walk(Math.PI / 2, () => p.x < 170);         // and walk across it
  assert.ok(Math.abs(p.y - 3 * FH) < 0.05 && p.x < 171, 'roof is walkable');
});

test('hugging the side of a staircase never puts your head through the floor above', () => {
  const r = PLAYER.radius - 0.02;
  const inBox = (p) => world.query(p.x - r, p.z - r, p.x + r, p.z + r).find((b) => p.x + r > b.min[0] && p.x - r < b.max[0]
    && p.z + r > b.min[2] && p.z - r < b.max[2] && p.y + 0.05 < b.max[1] && p.y + PLAYER.height - 0.05 > b.min[1]);
  // Huddle HQ flights 1 (+z) and 2 (-z), pushing sideways into the building the whole way
  for (const [x, z, yaw, y, s] of [[184.75, 139.9, Math.PI, 0, 1], [183.5, 139.9, Math.PI, 0, 0], [183.45, 139.9, Math.PI, 0, 0.3], [182.75, 147.6, 0, FH, -1], [184.0, 147.6, 0, FH, 0]]) {
    const p = { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true };
    for (let i = 0; i < 240; i++) {
      stepPlayer(world, p, { f: 1, s, yaw, jump: i % 40 === 20 }, 1 / 60);
      const b = inBox(p);
      assert.ok(!b, `inside ${b && b.kind} at ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
    }
  }
});

test('bots can climb the ground-standing stairs (slide towers, TV tower base)', () => {
  const N = buildNav(MAP);
  for (const [x, y, z] of [[352, 8, 462], [404, 6, 462], [445.4, 3, -320.6]]) {
    assert.ok(N.reachable(x, y, z), `platform at ${x},${y},${z}`);
    const p = N.findPath(x - 40, z + 30, x, z, 20000);
    assert.ok(p && p.complete, `path up to ${x},${z}`);
  }
});

test('Equipment Bags are not inside anything', () => {
  for (const c of MAP.chests) {
    assert.ok(!insideSolid(c.x, c.y, c.z), `bag at ${c.x},${c.y},${c.z}`);
    assert.ok(Math.abs(supportHeight(world, c.x, c.y + 0.5, c.z) - c.y) < 0.05, `bag at ${c.x},${c.y},${c.z} stands on something`);
  }
});
