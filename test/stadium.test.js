// Mega Dome: multi-level reachability (stairs), elevators (shared clock, riding, never
// stuck or crushed), skydiving through the open roof, bots' nav grid around the stadium.
import { test } from 'node:test';
import assert from 'node:assert';
import { generateMap } from '../shared/map.js';
import { World, stepPlayer, stepFalling, supportHeight, bodyBlocked } from '../shared/physics.js';
import { elevatorHeight, elevatorPeriod, elevatorStop, elevatorBoxes, ELEVATOR } from '../shared/elevators.js';
import { DOME, DOME_FOOT, roofY, underDomeRoof } from '../shared/megadome.js';
import { PLAYER, DROP } from '../shared/constants.js';
import { Match, setClock, MAP } from '../server/match.js';
import { nav } from '../server/bots.js';

const map = generateMap();
const inDome = (x, z) => Math.abs(x) < DOME_FOOT.x + 1 && Math.abs(z) < DOME_FOOT.z + 1;
const staticWorld = () => { const w = new World(); w.addMap(map); w.elevators = []; return w; };

// Flood fill of where a player can walk/drop to inside the stadium (stairs only, no
// elevators): 0.5 m grid, levels = support heights. Returns a lookup for spots.
function flood(world) {
  const S = 0.5, X = DOME_FOOT.x + 4, Z = DOME_FOOT.z + 4;
  const nx = Math.round(2 * X / S), nz = Math.round(2 * Z / S);
  const seen = new Map(); // cell -> list of y
  const key = (i, k) => k * nx + i;
  const has = (c, y) => { const l = seen.get(c); return l && l.some((v) => Math.abs(v - y) < 0.05); };
  const add = (c, y) => { let l = seen.get(c); if (!l) seen.set(c, l = []); l.push(y); };
  const q = [];
  const i0 = Math.round((0 + X) / S), k0 = Math.round((10 + Z) / S);
  add(key(i0, k0), 0); q.push([i0, k0, 0]);
  while (q.length) {
    const [i, k, y] = q.pop();
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const x = a * S - X, z = b * S - Z;
      if (bodyBlocked(world, x, y, z, true)) continue;
      const ny = supportHeight(world, x, y, z);
      const c = key(a, b);
      if (has(c, ny)) continue;
      add(c, ny); q.push([a, b, ny]);
    }
  }
  return {
    size: [...seen.values()].reduce((s, l) => s + l.length, 0),
    reach(x, y, z, rad = 1.2) {
      for (let a = Math.round((x - rad + X) / S); a <= Math.round((x + rad + X) / S); a++) {
        for (let b = Math.round((z - rad + Z) / S); b <= Math.round((z + rad + Z) / S); b++) {
          const l = seen.get(key(a, b));
          if (l && l.some((v) => Math.abs(v - y) < 0.75)) return true;
        }
      }
      return false;
    },
  };
}

test('Mega Dome: every level, suite, loot spot and Equipment Bag can be walked to (stairs)', () => {
  const world = staticWorld();
  const F = flood(world);
  const { L1, L2, HX, HZ } = DOME;
  // each level of each side
  for (const [x, y, z, what] of [
    [0, L1, HZ + 31, 'L1 corridor S'], [0, L1, -(HZ + 31), 'L1 corridor N'], [HX + 31, L1, 0, 'L1 corridor E'], [-(HX + 31), L1, 0, 'L1 corridor W'],
    [0, L2, HZ + 33, 'L2 concourse S'], [0, L2, -(HZ + 33), 'L2 concourse N'], [HX + 33, L2, 0, 'L2 concourse E'], [-(HX + 33), L2, 0, 'L2 concourse W'],
    [0, L1, HZ + 19.8, 'cross-aisle'], [20, L2 + 0.65 * 12, HZ + 36.5, 'top row of the upper deck'],
    [0, 0, HZ + 30, 'L0 concourse S'], [0, 0, HZ + 40.5, 'outside the south gate'], [-(HX + 30), 0, 50, 'L0 corner'],
  ]) assert.ok(F.reach(x, y, z), `${what} at ${x},${y},${z}`);
  // every suite: walk in through its door
  let suites = 0;
  for (let a0 = -DOME.SUITES_X; a0 < DOME.SUITES_X; a0 += DOME.SUITE_W, suites++) {
    for (const s of [1, -1]) assert.ok(F.reach(a0 + 6, L1, s * (HZ + 25.2), 0.4), `suite at x ${a0 + 4} z ${s * (HZ + 23)}`);
  }
  assert.ok(suites >= 18);
  // nothing in the stadium is out of reach
  // (spots on the roof and the video board are for skydivers)
  for (const l of map.loot) if (inDome(l.x, l.z) && l.y < 25) assert.ok(F.reach(l.x, l.y, l.z), `loot at ${l.x.toFixed(1)},${l.y},${l.z.toFixed(1)}`);
  for (const c of map.chests) if (inDome(c.x, c.z)) assert.ok(F.reach(c.x, c.y, c.z), `bag at ${c.x},${c.y},${c.z}`);
  assert.ok(map.chests.filter((c) => inDome(c.x, c.z)).length >= 6, 'bags in the dome');
  assert.ok(map.loot.filter((c) => inDome(c.x, c.z) && c.y > 1).length >= 20, 'loot up on the levels');
});

test('Mega Dome: stairs never rise more than a step, loot and bags are not inside anything', () => {
  for (const b of map.boxes) if (b.kind === 'stair' || b.seat) assert.ok(b.max[1] - b.min[1] > 0, 'box');
  const world = staticWorld();
  const m = new Match({ code: 'DOME' }); clearInterval(m.timer);
  for (const l of map.loot) if (inDome(l.x, l.z)) {
    const y = supportHeight(world, l.x, l.y + 0.5, l.z);
    assert.ok(Math.abs(y - l.y) < 0.05, `loot rests where it should ${l.x},${l.y},${l.z} (got ${y})`);
    assert.ok(!m.insideSolid(l.x, y, l.z), `loot not inside a box ${l.x},${l.y},${l.z}`);
  }
  // a player walks from the field all the way up the south-east stairs to the upper concourse
  const p = { x: 50, y: 0, z: DOME.HZ + 35, vx: 0, vy: 0, vz: 0, onGround: true };
  const walk = (tx, tz, secs) => {
    for (let i = 0; i < secs * 60; i++) {
      const yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
      if (Math.hypot(tx - p.x, tz - p.z) < 0.3) return;
      stepPlayer(world, p, { f: 1, s: 0, yaw, jump: false, sprint: false }, 1 / 60);
    }
  };
  walk(57, DOME.HZ + 35.5, 5); walk(69, DOME.HZ + 35.5, 6);
  assert.ok(Math.abs(p.y - DOME.L1) < 0.05, `up the first stairs (y ${p.y})`);
  walk(77, DOME.HZ + 35.5, 6);
  assert.ok(Math.abs(p.y - DOME.L2) < 0.05, `up the second stairs (y ${p.y})`);
});

test('elevators: height is a function of the server clock and matches on server and client', () => {
  assert.equal(map.elevators.length, 4);
  const e = map.elevators[0];
  const T = elevatorPeriod(e);
  assert.ok(T > 20 && T < 40, `period ${T}`);
  // visits every stop, never leaves the shaft's range, moves smoothly (no jumps)
  const seen = new Set();
  let prev = elevatorHeight(e, 0), maxV = 0;
  for (let t = 0; t < T * 2; t += 0.01) {
    const y = elevatorHeight(e, t);
    assert.ok(y >= -1e-9 && y <= DOME.L2 + 1e-9);
    maxV = Math.max(maxV, Math.abs(y - prev) / 0.01); prev = y;
    const s = elevatorStop(e, t); if (s >= 0) seen.add(s);
    assert.ok(Math.abs(elevatorHeight(e, t) - elevatorHeight(e, t + T * 3)) < 1e-6, 'periodic');
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
  assert.ok(maxV < 5, `top speed ${maxV.toFixed(2)} m/s (server accepts up to 14 m/s climbs)`);
  // the server's match world and a browser's world give the very same boxes at the same time
  setClock(() => 5000);
  const m = new Match({ code: 'ELEV' }); clearInterval(m.timer);
  const client = new World(); client.addMap(MAP);
  for (const t of [5000, 5003.3, 5011.7, 5020.25]) {
    m.world.time = t; client.time = t;
    assert.deepEqual(m.world.movers().map((b) => [b.min, b.max]), client.movers().map((b) => [b.min, b.max]));
  }
  setClock(null);
});

// time when elevator e is resting at stop s and about to leave
function departure(e, s) {
  for (let t = 0; t < elevatorPeriod(e); t += 0.01) if (elevatorStop(e, t) === s && elevatorStop(e, t + 0.02) < 0) return t;
  throw new Error('no departure');
}

test('elevators: a player on the cab rides it up and down (60 fps, server 20 Hz, a slow 4 fps browser)', () => {
  // [physics step, clock step]: a slow browser caps its physics step at 0.05 s per frame
  for (const [dt, tstep] of [[1 / 60, 1 / 60], [1 / 20, 1 / 20], [0.05, 0.25]]) {
    const world = new World(); world.addMap(map);
    const e = map.elevators[1];
    const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2;
    const t0 = departure(e, 0) - 1;
    const p = { x: cx, y: 0, z: cz, vx: 0, vy: 0, vz: 0, onGround: true };
    let maxErr = 0, top = 0;
    for (let t = t0; t < t0 + elevatorPeriod(e); t += tstep) {
      world.time = t;
      stepPlayer(world, p, { f: 0, s: 0, yaw: 0, jump: false, sprint: false }, dt);
      const h = elevatorHeight(e, t);
      maxErr = Math.max(maxErr, Math.abs(p.y - h));
      top = Math.max(top, p.y);
    }
    assert.ok(maxErr < (tstep > dt ? 0.9 : 0.25), `rider follows the cab (max error ${maxErr.toFixed(3)} at dt ${dt.toFixed(3)})`);
    assert.ok(Math.abs(top - DOME.L2) < 0.05, `reaches the top (${top})`);
    // ride up to L1 and walk out of the door
    const q = { x: cx, y: 0, z: cz, vx: 0, vy: 0, vz: 0, onGround: true };
    let t = departure(e, 0) - 0.5;
    while (!(elevatorStop(e, t) === 1)) { world.time = t; stepPlayer(world, q, { f: 0, s: 0, yaw: 0 }, dt); t += tstep; }
    const out = e.door === 2 ? -1 : 1; // door on -x (2) or +x (3)
    const yaw = Math.atan2(-out, 0);
    for (let i = 0; i < 1.5 / dt; i++) { world.time = t; stepPlayer(world, q, { f: 1, s: 0, yaw }, dt); t += tstep; }
    assert.ok(Math.abs(q.y - DOME.L1) < 0.05 && Math.abs(q.x - cx) > 2.5, `walked out on L1 (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
  }
});

test('elevators: nobody gets under the cab, into an empty shaft, or stuck', () => {
  const world = new World(); world.addMap(map);
  const e = map.elevators[2];
  const cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2;
  const out = e.door === 2 ? -1 : 1, yawIn = Math.atan2(out, 0), yawOut = Math.atan2(-out, 0);
  // cab up at L2: walking into the shaft at the ground or at L1 is blocked by the closed doors
  let tUp = 0; while (elevatorStop(e, tUp) !== 2) tUp += 0.05;
  for (const [lvl, y] of [[0, 0], [1, DOME.L1]]) {
    world.time = tUp;
    const p = { x: cx + out * 3, y, z: cz, vx: 0, vy: 0, vz: 0, onGround: true };
    for (let i = 0; i < 90; i++) stepPlayer(world, p, { f: 1, s: 0, yaw: yawIn }, 1 / 60);
    assert.ok(Math.abs(p.x - cx) > 1.5 + 0.4, `door ${lvl} keeps you out (x ${p.x.toFixed(2)})`);
    assert.ok(Math.abs(p.y - y) < 0.01);
  }
  // someone standing half in the doorway when the doors close can always walk away
  for (const s of [0, 1, 2]) {
    let t = departure(e, s) + 0.6;
    world.time = t;
    const doorX = out > 0 ? e.x1 + ELEVATOR.wall / 2 : e.x0 - ELEVATOR.wall / 2;
    const p = { x: doorX, y: e.stops[s], z: cz, vx: 0, vy: 0, vz: 0, onGround: true };
    for (let i = 0; i < 120; i++) { world.time = t; stepPlayer(world, p, { f: 1, s: 0, yaw: yawOut }, 1 / 60); t += 1 / 60; }
    assert.ok(Math.abs(p.x - cx) > 3, `walked away from the closing door at stop ${s} (x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)})`);
  }
  // whatever the time, the cab column always fills the shaft below the cab: no space under it
  for (let t = 0; t < elevatorPeriod(e); t += 0.37) {
    const col = elevatorBoxes(e, t)[0];
    assert.ok(col.lift && col.min[1] <= 0 && Math.abs(col.max[1] - elevatorHeight(e, t)) < 1e-9);
  }
  // a player who somehow ends up inside the shaft (e.g. a server correction) rides on top of the cab
  for (let k = 0; k < 20; k++) {
    let t = k * 1.37;
    const p = { x: cx + 0.6, y: 0, z: cz - 0.4, vx: 0, vy: 0, vz: 0, onGround: true };
    for (let i = 0; i < 240; i++) { world.time = t; stepPlayer(world, p, { f: 0, s: 0, yaw: 0 }, 1 / 60); t += 1 / 60; }
    assert.ok(Math.abs(p.y - elevatorHeight(e, t - 1 / 60)) < 0.3, `pushed up onto the cab (y ${p.y.toFixed(2)})`);
  }
});

test('skydiving: the open roof drops you on the field, the roof is solid and walkable elsewhere', () => {
  const world = staticWorld();
  const fall = (x, z, steerX = 0) => {
    const p = { x, y: 200, z, vx: 0, vy: 0, vz: 0, phase: 'fall', onGround: false };
    for (let i = 0; i < 20 * 60; i++) {
      const input = { f: steerX ? 1 : 0, s: 0, yaw: steerX > 0 ? -Math.PI / 2 : Math.PI / 2, pitch: -0.8 };
      if (stepFalling(world, p, input, 1 / 20)) return p;
    }
    return p;
  };
  const f = fall(-20, 10);
  assert.equal(f.phase, 'ground'); assert.ok(f.y < 0.1, `landed on the field (y ${f.y})`);
  const r = fall(0, 45);
  assert.ok(Math.abs(r.y - roofY(45)) < 0.2, `landed on the roof (y ${r.y}, roof ${roofY(45)})`);
  // gliding sideways under the roof edge doesn't teleport you up onto it
  const g = fall(35, -5, 1);
  assert.ok(g.y < DOME.L2 + 9, `slid in under the roof (landed at ${g.x.toFixed(1)}, ${g.y.toFixed(1)}, ${g.z.toFixed(1)})`);
  // walk on the roof: up the slope to the crown and down to the edge, never stuck
  const p = { x: 70, y: roofY(60), z: 60, vx: 0, vy: 0, vz: 0, onGround: true };
  for (let i = 0; i < 12 * 60 && p.z > 1; i++) stepPlayer(world, p, { f: 1, s: 0, yaw: 0 }, 1 / 60); // yaw 0 = -z
  assert.ok(p.z < 2 && Math.abs(p.y - roofY(Math.abs(p.z))) < 0.1, `walked up to the crown (${p.z.toFixed(1)}, ${p.y.toFixed(1)})`);
  assert.ok(underDomeRoof(70, 30) && !underDomeRoof(0, 0) && !underDomeRoof(200, 0));
  // the video board can be landed on, and you can walk off it
  const b = fall(0, 0);
  assert.ok(Math.abs(b.y - DOME.BOARD.y1) < 0.05, `on the board (${b.y})`);
});

test('nav grid: bots walk the stadium ground level, never plan a drop under a low ceiling', () => {
  const N = nav();
  const { HX, HZ } = DOME;
  // field -> concourse through a vomitory, -> outside through a gate
  const a = N.findPath(0, 10, 0, HZ + 30, 20000);
  assert.ok(a && a.complete, 'field to concourse');
  const b = N.findPath(HX + 30, 0, 0, HZ + 50, 30000);
  assert.ok(b && b.complete, 'east concourse to outside the south gate');
  // the lower bowl's top (cross-aisle) never "drops" into the concourse under the suites
  const c0 = N.cellOf(10, HZ + 19.8), c1 = N.cellOf(10, HZ + 21.5);
  assert.ok(N.floor[c0] > 7 && N.floor[c1] < 0.5 && N.ceil[c1] < N.floor[c0] + PLAYER.height);
  const p = N.findPath(10, HZ + 19.8, 10, HZ + 24, 20000);
  assert.ok(p && p.complete, 'path from the cross-aisle down to the concourse');
  assert.ok(p.length >= 2, 'goes round through a vomitory, not straight down');
  for (const e of map.elevators) assert.ok(!N.free(N.cellOf((e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2)), 'elevator shafts are off limits');
  // vehicles still start outside the stadium
  for (const v of map.vehicles) assert.ok(!inDome(v.x, v.z), `vehicle at ${v.x},${v.z}`);
});

test('bots skydiving to the Mega Dome aim for the open roof', () => {
  setClock(() => 7000);
  const m = new Match({ code: 'DROP' }); clearInterval(m.timer);
  for (let i = 0; i < 6; i++) m.addHuman({ readyState: 1, send() {} }, 'P' + i);
  m.start();
  let n = 0;
  for (const p of m.players.values()) if (p.bot && p.ai) { n++; assert.ok(!underDomeRoof(p.ai.land.x, p.ai.land.z), `bot lands at ${p.ai.land.x},${p.ai.land.z}`); }
  assert.ok(n > 30);
  setClock(null);
  void DROP;
});

test('bots that end up on an upper level of the dome find their way back down', { timeout: 60000 }, () => {
  let T = 9000;
  setClock(() => T);
  const m = new Match({ code: 'UP', mode: 'nobuild' }); clearInterval(m.timer);
  const h = m.addHuman({ readyState: 1, send() {} }, 'H'); m.start();
  const bots = [...m.players.values()].filter((p) => p.bot);
  // everyone else far away and harmless
  for (const p of m.players.values()) Object.assign(p, { phase: 'ground', x: -480, y: 0, z: -480, onGround: true });
  Object.assign(h, { x: 480, z: 480 });
  const N = nav();
  const { HX, HZ, L1, L2 } = DOME;
  const spots = [
    ['roof', 70, roofY(30), 30], ['board', 10, DOME.BOARD.y1, 2], ['upper deck', 20, L2 + 0.65 * 9, HZ + 32.3],
    ['upper deck end', -(HX + 33), L2 + 0.65 * 10, 8], ['L2 south', 60, L2, HZ + 33], ['L2 east', HX + 33, L2, 20],
    ['L2 corner', -(HX + 34), L2, -(HZ + 34)], ['trench', 40, L2, HZ + 24], ['L1 south', -30, L1, HZ + 30],
    ['L1 east', HX + 31, L1, -10], ['L1 corner', -(HX + 33), L1, -(HZ + 33)], ['suite', -2, L1, HZ + 24.6],
    ['suite end', HX + 24, L1, 20], ['stairs B', 72.8, L1 + 2.3, HZ + 35.5],
  ];
  spots.forEach(([name, x, y, z], i) => {
    const b = bots[i];
    Object.assign(b, { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, phase: 'ground', pad: 100, inv: [{ w: 'smg', r: 0, ammo: 30 }, null, null, null, null], slot: 1 });
    b.ai.goal = null; b.ai.path = null;
    b._spot = name;
  });
  const active = bots.slice(0, spots.length);
  for (const b of bots.slice(spots.length)) m.players.delete(b.id);
  const down = new Map();
  for (let i = 0; i < 20 * 45 && down.size < active.length; i++) {
    T += 0.05;
    m.simulate(T); // moves the bots (updateBot) and finishes their heals/reloads
    for (const b of active) {
      if (down.has(b)) continue;
      if (b.onGround && Math.abs(b.y - N.floorAt(b.x, b.z)) < 0.5) down.set(b, i / 20);
    }
  }
  const results = active.map((b) => `${b._spot}: ${down.has(b) ? down.get(b).toFixed(1) + ' s' : `STILL UP at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`}`);
  assert.equal(down.size, active.length, results.join('\n'));
  m.close(); setClock(null);
});
