// Collision world, player movement and ray casting. Shared by server and client.
import { PLAYER, MAP_HALF, DROP } from './constants.js';

const CELL = 16;

// A box is { id, min:[x,y,z], max:[x,y,z], ramp?: {axis:0|2, sign:1|-1}, piece?: true }
export class World {
  constructor() {
    this.cells = new Map();
    this.boxes = new Map();
    this.nextId = 1;
    this.stamp = 0;
  }
  key(cx, cz) { return cx * 4096 + cz; }
  add(box) {
    if (box.id == null) box.id = this.nextId++;
    box._s = 0;
    this.boxes.set(box.id, box);
    this._forCells(box, (k) => {
      let c = this.cells.get(k);
      if (!c) { c = []; this.cells.set(k, c); }
      c.push(box);
    });
    return box;
  }
  remove(id) {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    this._forCells(box, (k) => {
      const c = this.cells.get(k);
      if (c) { const i = c.indexOf(box); if (i >= 0) c.splice(i, 1); }
    });
  }
  _forCells(box, fn) {
    const x0 = Math.floor(box.min[0] / CELL), x1 = Math.floor(box.max[0] / CELL);
    const z0 = Math.floor(box.min[2] / CELL), z1 = Math.floor(box.max[2] / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) fn(this.key(x, z));
  }
  // Collect boxes overlapping an XZ rectangle (each box returned once).
  query(minx, minz, maxx, maxz, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const c = this.cells.get(this.key(x, z));
      if (!c) continue;
      for (const b of c) if (b._s !== s) { b._s = s; out.push(b); }
    }
    return out;
  }
}

export function rampHeight(b, x, z) {
  const a = b.ramp.axis === 0 ? x : z;
  const lo = b.min[b.ramp.axis], hi = b.max[b.ramp.axis];
  let t = (a - lo) / (hi - lo);
  if (b.ramp.sign < 0) t = 1 - t;
  t = Math.max(0, Math.min(1, t));
  return b.min[1] + t * (b.max[1] - b.min[1]);
}

const tmp = [];
// Highest walkable surface under the player whose top is not above y + stepUp.
export function supportHeight(world, x, y, z) {
  const r = PLAYER.radius;
  let best = 0;
  const list = world.query(x - r, z - r, x + r, z + r, tmp);
  for (const b of list) {
    if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
    let top;
    if (b.ramp) {
      if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
      top = rampHeight(b, x, z);
    } else top = b.max[1];
    if (top <= y + PLAYER.stepUp && top > best) best = top;
  }
  return best;
}

function blocked(world, x, y, z, onGround, ignore = null) {
  const r = PLAYER.radius;
  const list = world.query(x - r, z - r, x + r, z + r, tmp);
  for (const b of list) {
    if (b.ramp || (ignore && ignore.includes(b))) continue;
    if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
    const feet = y + (onGround ? PLAYER.stepUp : 0.05);
    if (feet >= b.max[1] || y + PLAYER.height <= b.min[1]) continue;
    return b;
  }
  return null;
}

function clampMap(p) {
  const m = MAP_HALF - 1;
  if (p.x < -m) p.x = -m; if (p.x > m) p.x = m;
  if (p.z < -m) p.z = -m; if (p.z > m) p.z = m;
}

// Move a grounded/jumping player one step.
// input: { f: forward -1..1, s: strafe -1..1, yaw, jump: bool, sprint: bool }
export function stepPlayer(world, p, input, dt) {
  const speed = input.sprint && input.f > 0 ? PLAYER.sprint : PLAYER.walk;
  let mx = 0, mz = 0;
  if (input.f || input.s) {
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    // forward is -Z when yaw = 0
    mx = -sin * input.f + cos * input.s;
    mz = -cos * input.f - sin * input.s;
    const l = Math.hypot(mx, mz) || 1;
    mx = (mx / l) * speed; mz = (mz / l) * speed;
  }
  const accel = p.onGround ? 14 : 3;
  const k = Math.min(1, accel * dt);
  p.vx += (mx - p.vx) * k;
  p.vz += (mz - p.vz) * k;
  if (input.jump && p.onGround) { p.vy = PLAYER.jump; p.onGround = false; }
  p.vy -= PLAYER.gravity * dt;
  if (p.vy < -60) p.vy = -60;

  // Horizontal, one axis at a time. Anything we already overlap (a wall built on top of
  // us, a squeeze after a correction) doesn't block, so nobody gets stuck inside a box.
  let inside = null;
  for (let b = blocked(world, p.x, p.y, p.z, p.onGround); b; b = blocked(world, p.x, p.y, p.z, p.onGround, inside)) {
    (inside ||= []).push(b);
    if (inside.length > 4) break;
  }
  const nx = p.x + p.vx * dt;
  if (!blocked(world, nx, p.y, p.z, p.onGround, inside)) p.x = nx; else p.vx = 0;
  const nz = p.z + p.vz * dt;
  if (!blocked(world, p.x, p.y, nz, p.onGround, inside)) p.z = nz; else p.vz = 0;
  clampMap(p);

  // Vertical.
  const ny = p.y + p.vy * dt;
  if (p.vy > 0) {
    const hit = blocked(world, p.x, ny, p.z, false);
    if (hit && hit.min[1] >= p.y + PLAYER.height - 0.2) { p.vy = 0; }
    else p.y = ny;
    p.onGround = false;
  } else {
    const sup = supportHeight(world, p.x, p.y, p.z);
    if (ny <= sup + 0.02 && (p.onGround || ny <= sup)) {
      // snap down slopes/steps when grounded, land when falling
      if (p.onGround && p.y - sup > PLAYER.stepUp) { p.y = ny; p.onGround = false; }
      else { p.y = sup; p.vy = 0; p.onGround = true; }
    } else {
      if (p.onGround && p.y - sup < 0.35) { p.y = sup; p.vy = 0; } // stick to ramps going down
      else { p.y = ny; p.onGround = false; }
    }
  }
}

// Sky-diving and parachute. Returns true when landed.
export function stepFalling(world, p, input, dt) {
  const gliding = p.phase === 'glide';
  const h = gliding ? DROP.glideH : DROP.freefallH;
  const v = gliding ? DROP.glide : DROP.freefall;
  let mx = 0, mz = 0;
  if (input.f || input.s) {
    const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
    mx = -sin * input.f + cos * input.s;
    mz = -cos * input.f - sin * input.s;
    const l = Math.hypot(mx, mz) || 1;
    mx = (mx / l) * h; mz = (mz / l) * h;
  }
  p.vx += (mx - p.vx) * Math.min(1, 2 * dt);
  p.vz += (mz - p.vz) * Math.min(1, 2 * dt);
  let fall = v;
  if (!gliding && input.f > 0 && input.pitch < -0.6) fall = v * 1.35; // dive
  p.vy += (-fall - p.vy) * Math.min(1, 3 * dt);
  p.x += p.vx * dt; p.z += p.vz * dt;
  clampMap(p);
  p.y += p.vy * dt;
  const sup = supportHeight(world, p.x, 1e4, p.z);
  if (!gliding && p.y - sup < DROP.autoDeploy) p.phase = 'glide';
  if (p.y <= sup) { p.y = sup; p.vy = 0; p.phase = 'ground'; p.onGround = true; return true; }
  return false;
}

// Ray vs boxes. Returns { t, box } or null. dir must be normalized.
export function raycastWorld(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let bestT = maxDist, best = null;
  // ground
  if (dy < 0) { const t = -oy / dy; if (t >= 0 && t < bestT) { bestT = t; best = { ground: true }; } }
  const step = CELL * 0.9;
  const s = ++world.stamp;
  for (let d = 0; d <= bestT + step; d += step) {
    const px = ox + dx * d, pz = oz + dz * d;
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const c = world.cells.get(world.key(ix, iz));
      if (!c) continue;
      for (const b of c) {
        if (b._s === s) continue;
        b._s = s;
        const t = b.ramp ? rayRamp(b, ox, oy, oz, dx, dy, dz) : rayBox(b, ox, oy, oz, dx, dy, dz);
        if (t !== null && t < bestT) { bestT = t; best = b; }
      }
    }
  }
  return best ? { t: bestT, box: best.ground ? null : best } : null;
}

export function rayBox(b, ox, oy, oz, dx, dy, dz) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
    } else {
      let t1 = (b.min[i] - o[i]) / d[i], t2 = (b.max[i] - o[i]) / d[i];
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function rayRamp(b, ox, oy, oz, dx, dy, dz) {
  if (rayBox(b, ox, oy, oz, dx, dy, dz) === null) return null;
  const a = b.ramp.axis;
  const L = b.max[a] - b.min[a], H = b.max[1] - b.min[1];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const u0 = b.ramp.sign > 0 ? o[a] - b.min[a] : b.max[a] - o[a];
  const du = b.ramp.sign > 0 ? d[a] : -d[a];
  const f0 = H * u0 - L * (oy - b.min[1]);
  const df = H * du - L * dy;
  if (Math.abs(df) < 1e-9) return null;
  const t = -f0 / df;
  if (t < 0) return null;
  const e = 0.05;
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  if (px < b.min[0] - e || px > b.max[0] + e || pz < b.min[2] - e || pz > b.max[2] + e || py < b.min[1] - e || py > b.max[1] + e) return null;
  return t;
}

// Ray vs standing player (vertical cylinder). Returns t or null.
export function rayPlayer(px, py, pz, ox, oy, oz, dx, dy, dz, r = PLAYER.radius + 0.08, h = PLAYER.height) {
  let t0 = -Infinity, t1 = Infinity;
  const fx = ox - px, fz = oz - pz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    if (fx * fx + fz * fz > r * r) return null;
  } else {
    const bq = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - r * r;
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    t0 = (-bq - sq) / (2 * a); t1 = (-bq + sq) / (2 * a);
  }
  let y0, y1;
  if (Math.abs(dy) < 1e-9) {
    if (oy < py || oy > py + h) return null;
    y0 = -Infinity; y1 = Infinity;
  } else {
    y0 = (py - oy) / dy; y1 = (py + h - oy) / dy;
    if (y0 > y1) { const q = y0; y0 = y1; y1 = q; }
  }
  const lo = Math.max(t0, y0, 0), hi = Math.min(t1, y1);
  if (lo > hi) return null;
  return lo;
}

// Has a clear line between two points?
export function lineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  if (L < 0.01) return true;
  const hit = raycastWorld(world, ax, ay, az, dx / L, dy / L, dz / L, L);
  return !hit || hit.t >= L - 0.1;
}

// Build piece geometry from grid cell info.
export function pieceBox(kind, gx, gy, gz, rot, grid, thick) {
  const x0 = gx * grid, y0 = gy * grid, z0 = gz * grid;
  const x1 = x0 + grid, y1 = y0 + grid, z1 = z0 + grid;
  const h = thick / 2;
  if (kind === 'floor') return { min: [x0, y0, z0], max: [x1, y0 + thick, z1] };
  if (kind === 'wall') {
    if (rot === 0) return { min: [x0, y0, z1 - h], max: [x1, y1, z1 + h] };
    if (rot === 1) return { min: [x1 - h, y0, z0], max: [x1 + h, y1, z1] };
    if (rot === 2) return { min: [x0, y0, z0 - h], max: [x1, y1, z0 + h] };
    return { min: [x0 - h, y0, z0], max: [x0 + h, y1, z1] };
  }
  // ramp rises toward rot direction
  const ramp = rot === 0 ? { axis: 2, sign: 1 } : rot === 1 ? { axis: 0, sign: 1 } : rot === 2 ? { axis: 2, sign: -1 } : { axis: 0, sign: -1 };
  return { min: [x0, y0, z0], max: [x1, y1, z1], ramp };
}
