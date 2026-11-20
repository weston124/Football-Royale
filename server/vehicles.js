// Drivable vehicles on the server: who drives what, validating the driver's vehicle
// movement, run-over tackles, vehicle damage and the `vh` snapshot field.
//
// Like player movement, the driver's browser simulates its own vehicle (shared/vehicles.js)
// and sends the result in its `in` messages; the server checks speed and that the vehicle
// isn't inside or through a wall, then moves the vehicle's boxes in the collision World so
// everyone (bots, bullets, other players and cars) bumps into it.
import { VEHICLE_TYPES, VEHICLE, vehicleSpawns, vehicleBlocked, vehicleBoxes, vehicleSupport, distToVehicle } from '../shared/vehicles.js';
import { PLAYER, MAP_HALF, TICK_RATE } from '../shared/constants.js';
import { supportHeight } from '../shared/physics.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class VehicleSystem {
  constructor(match, map, now) {
    this.m = match;
    this.now = now;
    this.list = vehicleSpawns(map, match.kind).map((s) => {
      const T = VEHICLE_TYPES[s.type];
      const v = { id: s.id, type: s.type, x: s.x, y: 0, z: s.z, yaw: s.yaw, speed: 0, hp: T.hp, driver: 0, broken: false, boxes: [], hits: new Map() };
      v.y = vehicleSupport(match.world, v.x, 0, v.z);
      this.place(v);
      return v;
    });
    this.byId = new Map(this.list.map((v) => [v.id, v]));
  }

  // (re)insert the vehicle's boxes into the collision World
  place(v) {
    for (const b of v.boxes) this.m.world.remove(b.id);
    v.boxes = vehicleBoxes(v, VEHICLE_TYPES[v.type]).map((b) => this.m.world.add(b));
  }

  // ---- enter / exit ----
  onVeh(p, m) {
    if (p.vehicle) return this.exit(p);
    const v = this.byId.get(m.id | 0);
    if (!v || v.driver || v.broken || p.phase !== 'ground' || !p.alive) return;
    if (distToVehicle(v, p.x, p.z) > VEHICLE.enterRange + 0.8 || Math.abs(p.y - v.y) > 2) return;
    v.driver = p.id; v.speed = 0;
    p.vehicle = v;
    p.x = v.x; p.y = v.y; p.z = v.z; p.vx = p.vy = p.vz = 0;
    p.emote = 0; p.reloadUntil = 0; p.useUntil = 0;
    p.lastIn = { t: this.now(), x: p.x, y: p.y, z: p.z };
    p.pev.push(['veh', v.id, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw)]);
  }

  // Leave the vehicle and stand beside it (driver's side first). Used for E, death and quitting.
  exit(p) {
    const v = p.vehicle;
    if (!v) return;
    p.vehicle = null;
    v.driver = 0; v.speed = 0;
    const T = VEHICLE_TYPES[v.type];
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = -fz, rz = fx; // forward, right
    const side = T.W / 2 + PLAYER.radius + 0.35, end = T.L / 2 + PLAYER.radius + 0.35;
    const spots = [[-rx * side, -rz * side], [rx * side, rz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
    let best = [0, 0];
    for (const [dx, dz] of spots) {
      const x = v.x + dx, z = v.z + dz;
      if (Math.abs(x) > MAP_HALF - 1 || Math.abs(z) > MAP_HALF - 1) continue;
      if (!this.playerBlocked(x, v.y, z)) { best = [dx, dz]; break; }
    }
    p.x = v.x + best[0]; p.z = v.z + best[1];
    p.y = supportHeight(this.m.world, p.x, v.y + 0.5, p.z);
    p.vx = p.vy = p.vz = 0;
    p.lastIn = { t: this.now(), x: p.x, y: p.y, z: p.z };
    if (p.alive) p.pev.push(['veh', 0], ['corr', r2(p.x), r2(p.y), r2(p.z)]);
  }

  playerBlocked(x, y, z) {
    const r = PLAYER.radius;
    for (const b of this.m.world.query(x - r, z - r, x + r, z + r, [])) {
      if (b.ramp) continue;
      if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
      if (b.max[1] <= y + PLAYER.stepUp || b.min[1] >= y + PLAYER.height) continue;
      return true;
    }
    return false;
  }

  // ---- driving input (from Match.onInput) ----
  // m: { x, y, z, vy: vehicle yaw, vs: speed }. Returns nothing; sends a `vc` correction if rejected.
  onDriveInput(p, m) {
    const v = p.vehicle, T = VEHICLE_TYPES[v.type];
    const t = this.now();
    const x = +m.x, y = +m.y, z = +m.z, yaw = +m.vy, sp = +m.vs;
    if (![x, y, z, yaw, sp].every(Number.isFinite)) return;
    const last = p.lastIn || { t: t - 1 / TICK_RATE, x: v.x, y: v.y, z: v.z };
    const dt = Math.max(1 / TICK_RATE, Math.min(1, t - last.t));
    const allowed = VEHICLE.maxSpeed * dt * 1.3 + 1.5;
    const d = Math.hypot(x - v.x, z - v.z);
    let ok = d <= allowed && Math.abs(sp) <= T.max + 1 && y <= v.y + 14 * dt + 2 && Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF;
    // not inside a wall, and not through one on the way (checked every 0.5 m)
    if (ok) {
      const n = Math.max(1, Math.ceil(d / 0.5));
      for (let i = 1; i <= n && ok; i++) {
        const k = i / n;
        if (vehicleBlocked(this.m.world, v.x + (x - v.x) * k, Math.max(y, v.y), v.z + (z - v.z) * k, yaw, T, -1, null, 0.12)) ok = false;
      }
    }
    if (!ok) {
      v.speed = 0;
      p.pev.push(['vc', r2(v.x), r2(v.y), r2(v.z), r2(v.yaw)]);
      p.lastIn = { t, x: v.x, y: v.y, z: v.z };
      return;
    }
    const moved = Math.hypot(x - v.x, z - v.z) > 0.01 || Math.abs(yaw - v.yaw) > 0.002 || Math.abs(y - v.y) > 0.01;
    v.x = x; v.y = y; v.z = z; v.yaw = yaw; v.speed = sp;
    if (moved) this.place(v);
    p.x = x; p.y = y; p.z = z;
    p.lastIn = { t, x, y, z };
    this.runOver(p, v, t);
  }

  // Driving into someone fast is a big tackle (no gore: they get bumped away).
  runOver(p, v, t) {
    const T = VEHICLE_TYPES[v.type];
    const sp = Math.abs(v.speed);
    if (sp < VEHICLE.runOverSpeed) return;
    const fx = -Math.sin(v.yaw) * Math.sign(v.speed), fz = -Math.cos(v.yaw) * Math.sign(v.speed);
    for (const q of this.m.players.values()) {
      if (q === p || !q.alive || q.phase !== 'ground' || q.vehicle) continue;
      if (Math.abs(q.x - v.x) > T.L || Math.abs(q.z - v.z) > T.L || Math.abs(q.y - v.y) > 1.5) continue;
      if (distToVehicle(v, q.x, q.z) > PLAYER.radius + 0.35) continue;
      if ((v.hits.get(q.id) || 0) > t) continue;
      v.hits.set(q.id, t + VEHICLE.runOverCooldown);
      if (p.team === q.team && this.m.kind !== 'island') continue; // squad mates: no bump either
      const dmg = Math.max(20, Math.min(55, VEHICLE.runOverDamage * sp / 14));
      // knock them forward and to the side they were on
      const side = Math.sign((q.x - v.x) * -fz + (q.z - v.z) * fx) || 1;
      const kx = fx * sp * 0.6 + -fz * side * 4, kz = fz * sp * 0.6 + fx * side * 4;
      if (q.bot) { q.vx = kx; q.vz = kz; q.vy = 6; q.onGround = false; }
      else q.pev.push(['kb', r2(kx), 6, r2(kz)]);
      this.m.damage(q, dmg, p, 'vehicle', false);
      if (this.m.kind !== 'island') p.pev.push(['hit', Math.round(dmg), 0, r2(q.x), r2(q.y + 1.2), r2(q.z), q.alive ? 0 : 1]);
      this.m.events.push(['sw', p.id]);
    }
  }

  // ---- damage ----
  damage(vid, amount) {
    const v = this.byId.get(vid);
    if (!v || v.broken || this.m.kind === 'island' || this.m.state !== 'play') return;
    v.hp -= amount;
    if (v.hp <= 0) {
      v.hp = 0; v.broken = true; v.speed = 0;
      this.m.events.push(['vb', v.id]);
      const d = this.m.players.get(v.driver);
      if (d && d.vehicle === v) { this.exit(d); d.pev.push(['msg', `Your ${VEHICLE_TYPES[v.type].name} broke down!`]); }
    }
  }
  explode(x, y, z, dmg, splash) {
    for (const v of this.list) {
      const d = Math.hypot(v.x - x, v.y + 0.6 - y, v.z - z);
      if (d < splash + 1.5) this.damage(v.id, dmg * 1.5 * (0.4 + 0.6 * (1 - Math.min(1, d / (splash + 1.5)))));
    }
  }

  // ---- snapshots ----
  // `vh` entries: [id, x, y, z, yaw, speed, driverId, hp%, broken] (positions 1/100 m). Sent to
  // each client only when the vehicle changed since the last entry that client got: every tick
  // within 160 m, every 4th tick farther away. Parked vehicles cost nothing.
  snapshotFor(p, ref, tick) {
    const known = p.vhKnown || (p.vhKnown = new Map());
    const out = [];
    for (const v of this.list) {
      const cur = v._net && v._netTick === tick ? v._net : (v._netTick = tick, v._net = JSON.stringify([
        v.id, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw), Math.round(v.speed * 10) / 10, v.driver,
        Math.round((v.hp / VEHICLE_TYPES[v.type].hp) * 100), v.broken ? 1 : 0,
      ]));
      if (known.get(v.id) === cur) continue;
      const far = Math.abs(v.x - ref.x) > 160 || Math.abs(v.z - ref.z) > 160;
      if (far && known.has(v.id) && (tick + v.id) % 4) continue;
      known.set(v.id, cur);
      out.push(cur);
    }
    return out.length ? ',"vh":[' + out.join(',') + ']' : '';
  }
}
