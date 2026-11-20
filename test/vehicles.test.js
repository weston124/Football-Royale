// Drivable vehicles: spawn spots, enter/exit, movement validation, collisions, run-overs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { Match, setClock, MAP } from '../server/match.js';
import { World } from '../shared/physics.js';
import { VEHICLE_TYPES, vehicleSpawns, vehicleBlocked, stepVehicle, distToVehicle } from '../shared/vehicles.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); } });
let clock = 1000;
setClock(() => clock);
afterEach(() => { clock += 10; });

function setup(opts = {}) {
  const m = new Match({ code: 'VEH', mode: 'nobuild', ...opts });
  const a = m.addHuman(fakeWs(), 'A', null, 7);
  const b = m.addHuman(fakeWs(), 'B', null, 0);
  const c = m.addHuman(fakeWs(), 'C', null, 0);
  m.start();
  // park truck #1 on open ground near x=300, z=150 and put everyone beside it
  const v = m.veh.byId.get(1);
  Object.assign(v, { x: 300, y: 0, z: 150, yaw: 0 });
  m.veh.place(v);
  for (const [p, x] of [[a, 302.2], [b, 302.6], [c, 320]]) Object.assign(p, { phase: 'ground', x, y: 0, z: 150, onGround: true, lastIn: null });
  return { m, a, b, c, v };
}
const enter = (m, p, v) => m.handle(p, { t: 'veh', id: v.id });
const drive = (m, p, x, z, extra = {}) => m.handle(p, { t: 'in', x, y: 0, z, yaw: 0, pitch: 0, vy: 0, vs: 15, ...extra });

test('vehicle spots are on open ground; ~16 in the city, 2 on Party Island', () => {
  const world = new World();
  for (const b of MAP.boxes) world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
  const city = vehicleSpawns(MAP, 'normal');
  assert.ok(city.length >= 14 && city.length <= 20, `${city.length} vehicles`);
  assert.ok(city.some((v) => v.type === 'truck') && city.some((v) => v.type === 'cart'));
  for (const v of city.concat(vehicleSpawns(MAP, 'island'))) {
    const T = VEHICLE_TYPES[v.type];
    const big = { ...T, W: T.W + 1.5, L: T.L + 1.5 }; // a little room around it to get in and drive off
    assert.equal(vehicleBlocked(world, v.x, 0, v.z, v.yaw, big), null, `vehicle ${v.id} at ${v.x},${v.z} is clear`);
  }
  assert.equal(vehicleSpawns(MAP, 'island').length, 2);
});

test('enter and exit; one driver per vehicle; no shooting while driving', () => {
  const { m, a, b, v } = setup();
  enter(m, a, v);
  assert.equal(a.vehicle, v);
  assert.equal(v.driver, a.id);
  assert.ok(a.pev.some((e) => e[0] === 'veh' && e[1] === v.id));
  enter(m, b, v);
  assert.equal(b.vehicle, undefined, 'seat taken');
  a.inv[0] = { w: 'pistol', r: 0, ammo: 10 }; a.slot = 1;
  m.handle(a, { t: 'fire', aim: [0, 0, -1] });
  assert.equal(a.inv[0].ammo, 10, 'cannot shoot while driving');
  m.handle(a, { t: 'veh' }); // E again: get out
  assert.equal(a.vehicle, null);
  assert.equal(v.driver, 0);
  assert.ok(distToVehicle(v, a.x, a.z) > 0.3 && distToVehicle(v, a.x, a.z) < 1.5, 'standing beside it');
  enter(m, b, v);
  assert.equal(b.vehicle, v, 'now B can drive');
  // too far away
  const { m: m2, c: c2, v: v2 } = setup();
  enter(m2, c2, v2);
  assert.equal(c2.vehicle, undefined);
  m.close(); m2.close();
});

test('driving speed is validated (faster than running, not teleporting)', () => {
  const { m, a, b, v } = setup();
  enter(m, a, v);
  clock += 0.5;
  drive(m, a, 300, 140); // 10 m in 0.5 s = 20 m/s
  assert.equal(v.z, 140, 'vehicle speed accepted');
  assert.equal(a.z, 140, 'driver moves with it');
  clock += 0.05;
  drive(m, a, 300, 100); // 40 m in a tick
  assert.equal(v.z, 140, 'teleport rejected');
  assert.ok(a.pev.some((e) => e[0] === 'vc'), 'vehicle correction sent');
  // on foot the same 20 m/s is too fast
  b.lastIn = { t: clock, x: b.x, y: 0, z: b.z };
  clock += 0.5;
  m.handle(b, { t: 'in', x: b.x, y: 0, z: b.z - 10, yaw: 0, pitch: 0 });
  assert.equal(b.z, 150, 'running that fast is rejected');
  m.close();
});

test('vehicles stop at buildings (physics and server check)', () => {
  // Hall of Champs south wall: z = 314 (0.8 m thick), x -27..-3
  const world = new World();
  for (const b of MAP.boxes) world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
  const car = { id: 99, type: 'truck', x: -15, y: 0, z: 295, yaw: Math.PI, speed: 0 };
  let impact = 0;
  for (let i = 0; i < 60 * 4; i++) impact = Math.max(impact, stepVehicle(world, car, { f: 1, s: 0 }, 1 / 60));
  assert.ok(car.z + VEHICLE_TYPES.truck.L / 2 < 313.65 && car.z > 300, `stopped right at the wall, z=${car.z.toFixed(2)}`);
  assert.ok(impact > 8, `hit it fast (${impact.toFixed(1)} m/s)`);
  assert.ok(Math.abs(car.speed) < 6, 'bounced / stopped');
  // the server refuses a vehicle position through the wall
  const { m, a, v } = setup();
  Object.assign(v, { x: -15, z: 311, yaw: Math.PI }); m.veh.place(v);
  Object.assign(a, { x: -13, z: 311 });
  enter(m, a, v);
  clock += 0.2;
  drive(m, a, -15, 317.5, { vy: Math.PI });
  assert.equal(v.z, 311, 'cannot drive through the wall');
  // and players / bots bump into parked vehicles
  const wv = m.veh.byId.get(2);
  assert.ok(m.world.query(wv.x - 1, wv.z - 1, wv.x + 1, wv.z + 1).some((b) => b.vid === 2), 'vehicle is in the collision world');
  m.close();
});

test('driving into an enemy fast tackles them (with cooldown); slow bumps do nothing', () => {
  const { m, a, c, v } = setup();
  enter(m, a, v);
  Object.assign(c, { x: 300, z: 146 });
  clock += 0.05;
  drive(m, a, 300, 149.5, { vs: 4 });
  assert.equal(c.hp, 100, 'slow: no damage');
  clock += 0.05;
  drive(m, a, 300, 148.8, { vs: 16 });
  assert.ok(c.hp < 100 && c.hp >= 45, `hit for ${100 - c.hp}`);
  assert.ok(c.pev.some((e) => e[0] === 'kb'), 'knocked back');
  const hp = c.hp;
  clock += 0.05;
  drive(m, a, 300, 148.2, { vs: 16 });
  assert.equal(c.hp, hp, 'cooldown');
  m.close();
});

test('dying or leaving ejects the driver; broken vehicles can not be driven', () => {
  const { m, a, b, c, v } = setup();
  enter(m, a, v);
  m.damage(a, 500, c, 'rifle', false);
  assert.equal(a.alive, false);
  assert.equal(a.vehicle, null);
  assert.equal(v.driver, 0);
  enter(m, b, v);
  m.removeHuman(b);
  assert.equal(v.driver, 0, 'quitting frees the seat');
  // shoot it until it breaks down
  Object.assign(c, { x: 302.2 });
  enter(m, c, v);
  m.veh.damage(v.id, 1000);
  assert.ok(v.broken);
  assert.equal(c.vehicle, null, 'thrown out when it breaks down');
  enter(m, c, v);
  assert.equal(c.vehicle, null, 'broken: can not drive');
  m.close();
});

test('Party Island: two carts, bumping people does no damage', () => {
  const m = new Match({ code: 'ISLE', kind: 'island' });
  const a = m.addHuman(fakeWs(), 'A'); const b = m.addHuman(fakeWs(), 'B'); m.start();
  assert.equal(m.veh.list.length, 2);
  const v = m.veh.list[0];
  Object.assign(a, { x: v.x, z: v.z + 1.5, lastIn: null });
  enter(m, a, v);
  assert.equal(a.vehicle, v);
  Object.assign(b, { x: v.x - 3, z: v.z });
  clock += 0.1;
  m.handle(a, { t: 'in', x: v.x - 2, y: 0, z: v.z, yaw: 0, pitch: 0, vy: v.yaw, vs: 15 });
  assert.equal(b.hp, 100);
  assert.ok(b.pev.some((e) => e[0] === 'kb'), 'still a fun bump');
  m.veh.damage(v.id, 9999);
  assert.ok(!v.broken);
  m.close();
});

test('vh snapshot: moved vehicles only, once per change', () => {
  const { m, a, b, v } = setup();
  b.ws.sent.length = 0;
  m.sendSnapshots(clock);
  const first = JSON.parse(b.ws.sent.pop());
  assert.equal(first.vh.length, m.veh.list.length, 'everything once at the start');
  m.sendSnapshots(clock + 0.05);
  assert.equal(JSON.parse(b.ws.sent.pop()).vh, undefined, 'parked vehicles cost nothing');
  enter(m, a, v);
  clock += 0.1;
  drive(m, a, 300, 148);
  m.sendSnapshots(clock);
  const s = JSON.parse(b.ws.sent.pop());
  assert.equal(s.vh.length, 1);
  assert.deepEqual(s.vh[0].slice(0, 4), [1, 300, 0, 148]);
  assert.equal(s.vh[0][6], a.id, 'driver id');
  m.close();
});
