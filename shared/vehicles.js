// Drivable vehicles: types, spawn spots and the arcade car physics. Shared by server and browser.
//
// A vehicle is a rectangle (length L along its heading, width W) that we approximate with
// circles of radius W/2 for its own collisions, and with square AABB boxes in the collision
// World (so players, bots, bullets and other vehicles bump into it). Heading follows the
// player convention: forward is -Z at yaw 0, and yaw grows when turning left.
import { MAP_HALF, PLAYER } from './constants.js';
import { supportHeight } from './physics.js';

export const VEHICLE_TYPES = {
  truck: {
    name: 'Tailgate Truck', L: 4.8, W: 2.1, h: 1.3, max: 22, rev: 8, accel: 9, brake: 22, turn: 1.9, hp: 450,
    colors: ['#e8412c', '#2f6fe0', '#f2c230', '#2fae5a'],
  },
  cart: {
    name: 'Sideline Cart', L: 2.9, W: 1.6, h: 1.3, max: 17, rev: 7, accel: 11, brake: 24, turn: 2.4, hp: 260,
    colors: ['#ffffff', '#ff7a1a', '#18b6c9', '#c44fd8'],
  },
};
export const VEHICLE = {
  enterRange: 3,        // m from the vehicle's edge
  stepUp: 0.75,         // curbs / floor pieces / ramp starts a vehicle drives over
  runOverSpeed: 8,      // m/s: faster than this and you tackle whoever you drive into
  runOverDamage: 35,    // at 14 m/s, scaled by speed (20..55)
  runOverCooldown: 1.0, // s per target
  maxSpeed: 22,
};

// Fixed spots for the normal city (filled by shared/map.js, see `vehicles` there) and two
// carts on the stadium field for Party Island.
export const ISLAND_VEHICLES = [
  { type: 'cart', x: -48, z: 22, yaw: Math.PI / 2, color: 1 },
  { type: 'cart', x: 48, z: -22, yaw: -Math.PI / 2, color: 2 },
];
// Vehicle list for a match: ids are 1-based indexes, the same on server and every client.
export function vehicleSpawns(map, kind) {
  const list = kind === 'island' ? ISLAND_VEHICLES : map.vehicles || [];
  return list.map((s, i) => ({ id: i + 1, ...s }));
}

// Centres of the collision circles (radius W/2) along the heading.
function circles(x, z, yaw, T, out = []) {
  const r = T.W / 2, half = T.L / 2 - r;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const n = Math.max(2, Math.ceil((T.L - T.W) / r) + 1);
  out.length = 0;
  for (let i = 0; i < n; i++) {
    const k = -half + (2 * half * i) / (n - 1);
    out.push(x + fx * k, z + fz * k);
  }
  return out;
}

const _q = [], _c = [];
// First solid box (not a ramp, not this vehicle, not something we can drive over) that the
// vehicle footprint at (x, y, z, yaw) overlaps. `vid`: this vehicle's id (its own boxes don't count;
// -1 ignores every vehicle). `ignore`: boxes already overlapped (skipped).
export function vehicleBlocked(world, x, y, z, yaw, T, vid = 0, ignore = null, shrink = 0) {
  const r = T.W / 2 - shrink;
  const c = circles(x, z, yaw, T, _c);
  for (let i = 0; i < c.length; i += 2) {
    const cx = c[i], cz = c[i + 1];
    for (const b of world.query(cx - r, cz - r, cx + r, cz + r, _q)) {
      if (b.ramp || (b.vid && (b.vid === vid || vid === -1)) || (ignore && ignore.includes(b))) continue;
      if (b.max[1] <= y + VEHICLE.stepUp || b.min[1] >= y + T.h + 0.4) continue;
      const px = Math.max(b.min[0], Math.min(cx, b.max[0])), pz = Math.max(b.min[2], Math.min(cz, b.max[2]));
      if ((px - cx) ** 2 + (pz - cz) ** 2 < r * r) return b;
    }
  }
  return null;
}

// Square AABBs that stand in for the vehicle in the collision World (a 2-square "capsule").
export function vehicleBoxes(v, T) {
  const r = T.W / 2, half = T.L / 2 - r;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const s = r * 0.95;
  return [-half, half].map((k) => {
    const cx = v.x + fx * k, cz = v.z + fz * k;
    return { min: [cx - s, v.y, cz - s], max: [cx + s, v.y + T.h, cz + s], kind: 'vehicle', vid: v.id };
  });
}

// Ground under the vehicle (ramps and floor pieces count, other vehicles don't).
export function vehicleSupport(world, x, y, z) {
  return supportHeight(world, x, y + VEHICLE.stepUp - PLAYER.stepUp, z);
}

function clampMap(v) {
  const m = MAP_HALF - 3;
  v.x = Math.max(-m, Math.min(m, v.x));
  v.z = Math.max(-m, Math.min(m, v.z));
}

// One physics step. v: { id, type, x, y, z, yaw, speed, vy }; input: { f: -1..1 gas/brake/reverse,
// s: -1..1 steer (+1 = right), brake: bool handbrake }. Returns impact speed when it hit something.
export function stepVehicle(world, v, input, dt) {
  const T = VEHICLE_TYPES[v.type];
  const f = Math.max(-1, Math.min(1, input.f || 0)), st = Math.max(-1, Math.min(1, input.s || 0));
  let sp = v.speed || 0;
  if (input.brake) sp -= Math.sign(sp) * Math.min(Math.abs(sp), 18 * dt);
  else if (f > 0) sp = sp < -0.3 ? Math.min(0, sp + T.brake * f * dt) : Math.min(T.max, sp + T.accel * f * (1 - 0.55 * Math.max(0, sp) / T.max) * dt);
  else if (f < 0) sp = sp > 0.3 ? Math.max(0, sp + T.brake * f * dt) : Math.max(-T.rev, sp + T.accel * 0.8 * f * dt);
  else sp -= Math.sign(sp) * Math.min(Math.abs(sp), 3.5 * dt);
  // steering grows with speed up to ~6 m/s, then gets a bit calmer at top speed; reversed in reverse
  const a = Math.abs(sp);
  const grip = Math.min(1, a / 6) * (1 - 0.4 * Math.min(1, a / T.max)) * (input.brake ? 1.35 : 1);
  const dyaw = -st * T.turn * grip * Math.sign(sp) * dt;
  let impact = 0;
  if (dyaw) {
    const ny = v.yaw + dyaw;
    if (!vehicleBlocked(world, v.x, v.y, v.z, ny, T, v.id)) v.yaw = ny;
  }
  // move in small sub-steps so fast cars can't tunnel through thin walls
  const dist = sp * dt, n = Math.max(1, Math.ceil(Math.abs(dist) / 0.4));
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  for (let i = 0; i < n; i++) {
    const dx = (fx * dist) / n, dz = (fz * dist) / n;
    if (!vehicleBlocked(world, v.x + dx, v.y, v.z + dz, v.yaw, T, v.id)) { v.x += dx; v.z += dz; continue; }
    // scrape along walls at shallow angles, bounce off when hitting them head-on
    const slideX = !vehicleBlocked(world, v.x + dx, v.y, v.z, v.yaw, T, v.id);
    const slideZ = !slideX && !vehicleBlocked(world, v.x, v.y, v.z + dz, v.yaw, T, v.id);
    const along = slideX ? Math.abs(fx) : slideZ ? Math.abs(fz) : 0;
    if (along > 0.5) {
      if (slideX) v.x += dx; else v.z += dz;
      sp *= 1 - (1 - along) * 0.5;
      continue;
    }
    impact = Math.abs(sp);
    sp = impact > 5 ? -Math.sign(sp) * Math.min(5, impact * 0.3) : 0;
    break;
  }
  v.speed = sp;
  clampMap(v);
  // stay on the ground (drive up ramps, roll off ledges)
  const sup = vehicleSupport(world, v.x, v.y, v.z);
  if (sup >= v.y - 0.05) { v.y = sup; v.vy = 0; }
  else {
    v.vy = (v.vy || 0) - 24 * dt;
    v.y = Math.max(sup, v.y + v.vy * dt);
    if (v.y === sup) v.vy = 0;
  }
  return impact;
}

// Closest distance from point (x, z) to the vehicle's outline (0 when inside).
export function distToVehicle(v, x, z) {
  const T = VEHICLE_TYPES[v.type];
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const dx = x - v.x, dz = z - v.z;
  const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
  const ox = Math.max(0, Math.abs(along) - T.L / 2), oz = Math.max(0, Math.abs(side) - T.W / 2);
  return Math.hypot(ox, oz);
}
