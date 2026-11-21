// Drivable vehicles in the browser: 3D models, smooth movement of everyone's vehicles from the
// `vh` snapshot field, and driving my own vehicle (simulated here with shared/vehicles.js, the
// server checks it like normal movement).
import * as THREE from 'three';
import { VEHICLE_TYPES, VEHICLE, vehicleSpawns, vehicleBoxes, stepVehicle, distToVehicle } from '/shared/vehicles.js';
import { mat, bakeGroup, propMaterial } from './models.js';

const nowS = () => performance.now() / 1000;
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const BOX = new THREE.BoxGeometry(1, 1, 1);
const box = (w, h, d, color, x, y, z, opts) => { const m = new THREE.Mesh(BOX, mat(color, opts)); m.scale.set(w, h, d); m.position.set(x, y, z); return m; };
const DARK = '#1d2026', GLASS = '#26384f', CHROME = '#c9ced6';

// ---------- models (front of the vehicle is -Z, like the players) ----------
function buildTruck(color) {
  const g = new THREE.Group();
  g.add(box(2.0, 0.55, 4.7, color, 0, 0.78, 0));                        // body
  g.add(box(1.9, 0.62, 1.6, color, 0, 1.36, -0.25));                    // cab
  g.add(box(1.94, 0.42, 1.2, GLASS, 0, 1.46, -0.25));                   // side windows
  g.add(box(1.8, 0.42, 0.06, GLASS, 0, 1.46, -1.06));                   // windshield
  g.add(box(1.8, 0.36, 0.06, GLASS, 0, 1.46, 0.56));                    // rear window
  g.add(box(1.94, 0.1, 1.64, color, 0, 1.72, -0.25));                   // roof
  g.add(box(1.7, 0.1, 0.5, '#fff7d6', 0, 1.82, -0.25, { emissive: '#6b5a1a' })); // roof light bar
  for (const x of [-0.97, 0.97]) g.add(box(0.08, 0.36, 1.8, color, x, 1.22, 1.45)); // bed sides
  g.add(box(2.0, 0.36, 0.08, color, 0, 1.22, 2.33));                    // tailgate
  g.add(box(2.06, 0.08, 0.06, '#ffffff', 0, 1.0, 2.36));                // tailgate stripe
  g.add(box(0.8, 0.42, 0.5, '#2f6fe0', -0.35, 1.26, 1.5));              // cooler
  g.add(box(0.84, 0.08, 0.54, '#ffffff', -0.35, 1.5, 1.5));
  // football laces on the hood
  g.add(box(0.1, 0.03, 1.0, '#ffffff', 0, 1.07, -1.75));
  for (let i = -2; i <= 2; i++) g.add(box(0.36, 0.03, 0.08, '#ffffff', 0, 1.07, -1.75 + i * 0.2));
  // team pennant on the bed
  g.add(box(0.04, 1.1, 0.04, CHROME, 0.75, 1.75, 2.15));
  const flag = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0, 0.7)]), mat('#ffcc33', { side: THREE.DoubleSide }));
  flag.geometry.computeVertexNormals(); flag.position.set(0.75, 2.0, 2.15); g.add(flag);
  for (const z of [-2.36, 2.36]) g.add(box(2.08, 0.24, 0.16, CHROME, 0, 0.56, z));   // bumpers
  for (const x of [-0.7, 0.7]) {
    g.add(box(0.36, 0.16, 0.05, '#fffbe0', x, 0.9, -2.36, { emissive: '#bba64a' })); // headlights
    g.add(box(0.3, 0.16, 0.05, '#ff3030', x, 0.9, 2.37, { emissive: '#801010' }));  // tail lights
  }
  return g;
}
function buildCart(color) {
  const g = new THREE.Group();
  g.add(box(1.5, 0.32, 2.8, color, 0, 0.5, 0));                         // base
  g.add(box(1.42, 0.42, 0.62, color, 0, 0.86, -1.08));                  // front cowl
  g.add(box(1.3, 0.14, 0.62, '#2b2f3a', 0, 0.86, 0.22));                // seat
  g.add(box(1.3, 0.5, 0.12, '#2b2f3a', 0, 1.16, 0.55));                 // backrest
  for (const [x, z] of [[-0.68, -0.8], [0.68, -0.8], [-0.68, 0.62], [0.68, 0.62]]) g.add(box(0.06, 1.3, 0.06, CHROME, x, 1.35, z)); // posts
  g.add(box(1.56, 0.08, 1.8, color, 0, 2.02, -0.08));                   // roof
  g.add(box(1.56, 0.1, 0.1, '#ffcc33', 0, 1.95, -0.98));                // roof trim
  g.add(box(1.3, 0.7, 0.04, '#b9dcff', 0, 1.5, -0.8, { transparent: true, opacity: 0.45 })); // windshield
  g.add(box(1.2, 0.3, 0.5, '#6b4a2b', 0, 0.82, 1.12));                  // ball basket
  for (const x of [-0.35, 0, 0.35]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat('#8b4513')); b.scale.set(0.65, 0.65, 1); b.position.set(x, 1.02, 1.12); b.rotation.y = x; g.add(b); }
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 14), mat(DARK)); wheel.position.set(-0.32, 1.22, -0.5); wheel.rotation.x = -1.0; g.add(wheel);
  g.add(box(0.04, 0.04, 0.4, DARK, -0.32, 1.08, -0.62));
  for (const x of [-0.45, 0.45]) g.add(box(0.26, 0.12, 0.05, '#fffbe0', x, 0.92, -1.4, { emissive: '#bba64a' }));
  g.add(box(1.56, 0.16, 0.12, CHROME, 0, 0.42, -1.42));                 // bumper
  return g;
}
// A small original hatchback: rounded-ish cabin at the back, sporty stripe over the hood.
function buildHatch(color) {
  const g = new THREE.Group();
  g.add(box(1.86, 0.6, 3.96, color, 0, 0.66, 0));                       // lower body
  g.add(box(1.72, 0.62, 2.3, color, 0, 1.27, 0.35));                    // cabin
  g.add(box(1.76, 0.4, 1.96, GLASS, 0, 1.3, 0.35));                     // side windows
  g.add(box(1.58, 0.44, 0.06, GLASS, 0, 1.3, -0.82));                   // windshield
  g.add(box(1.58, 0.38, 0.06, GLASS, 0, 1.32, 1.52));                   // rear window
  g.add(box(1.76, 0.08, 2.1, DARK, 0, 1.62, 0.35));                     // roof rack
  g.add(box(0.34, 0.02, 1.4, '#ffffff', -0.25, 0.97, -1.25));           // twin hood stripes
  g.add(box(0.34, 0.02, 1.4, '#ffffff', 0.25, 0.97, -1.25));
  g.add(box(1.92, 0.14, 0.04, '#ffffff', 0, 0.62, 1.99));               // stripe on the hatch
  for (const z of [-2.0, 2.0]) g.add(box(1.9, 0.22, 0.14, CHROME, 0, 0.44, z)); // bumpers
  for (const x of [-0.66, 0.66]) {
    g.add(box(0.34, 0.15, 0.05, '#fffbe0', x, 0.82, -2.0, { emissive: '#bba64a' })); // headlights
    g.add(box(0.28, 0.15, 0.05, '#ff3030', x, 0.82, 2.0, { emissive: '#801010' }));  // tail lights
  }
  g.add(box(0.5, 0.12, 0.05, '#ffcc33', 0, 0.62, -2.03));               // grille badge (a football)
  return g;
}
const BUILD = { truck: buildTruck, cart: buildCart, hatch: buildHatch };
const WHEEL_GEO = new THREE.CylinderGeometry(1, 1, 1, 14);
const HELMET_GEO = new THREE.SphereGeometry(0.19, 12, 10);
const WHEELS = {
  truck: { r: 0.42, w: 0.32, pos: [[-0.98, -1.55], [0.98, -1.55], [-0.98, 1.55], [0.98, 1.55]] },
  cart: { r: 0.27, w: 0.22, pos: [[-0.72, -0.95], [0.72, -0.95], [-0.72, 0.95], [0.72, 0.95]] },
  hatch: { r: 0.36, w: 0.28, pos: [[-0.9, -1.3], [0.9, -1.3], [-0.9, 1.3], [0.9, 1.3]] },
};
const SEAT = { truck: [-0.45, 0.55, -0.2], cart: [-0.33, 0.95, 0.2], hatch: [-0.42, 0.5, 0.1] };
const bodyCache = new Map(), parkedCache = new Map();
const bodyGeo = (type, color) => {
  const key = type + color;
  if (!bodyCache.has(key)) bodyCache.set(key, bakeGroup(BUILD[type](color)));
  return bodyCache.get(key);
};
function addWheels(g, type) {
  const W = WHEELS[type], wheels = [];
  for (const [x, z] of W.pos) {
    const pivot = new THREE.Group(); pivot.position.set(x, W.r, z);
    const spin = new THREE.Group(); pivot.add(spin);
    const tire = new THREE.Mesh(WHEEL_GEO, mat(DARK)); tire.scale.set(W.r, W.w, W.r); tire.rotation.z = Math.PI / 2; spin.add(tire);
    const hub = new THREE.Mesh(BOX, mat(CHROME)); hub.scale.set(W.w + 0.02, W.r * 0.8, W.r * 0.3); spin.add(hub); // a spoke you can see turning
    g.add(pivot); wheels.push({ pivot, spin, front: z < 0 });
  }
  return wheels;
}
// Body + wheels baked into one geometry: what parked / far vehicles are drawn with (instanced).
function parkedGeo(type, color) {
  const key = type + color;
  if (!parkedCache.has(key)) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo(type, color), propMaterial));
    addWheels(g, type);
    parkedCache.set(key, bakeGroup(g));
  }
  return parkedCache.get(key);
}
export function createVehicleMesh(type, color) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(bodyGeo(type, color), propMaterial));
  const wheels = addWheels(g, type);
  // a simple seated driver: jersey + helmet in their colors (the full body stays hidden)
  const bust = new THREE.Group();
  const [sx, sy, sz] = SEAT[type];
  bust.position.set(sx, sy, sz);
  const torso = new THREE.Mesh(BOX, mat('#c03030')); torso.scale.set(0.5, 0.62, 0.32); torso.position.y = 0.42; bust.add(torso);
  const helmet = new THREE.Mesh(HELMET_GEO, mat('#c03030')); helmet.position.y = 0.92; bust.add(helmet);
  const mask = new THREE.Mesh(BOX, mat('#dddddd')); mask.scale.set(0.24, 0.05, 0.05); mask.position.set(0, 0.86, -0.19); bust.add(mask);
  bust.visible = false; g.add(bust);
  g.userData = { wheels, bust, torso, helmet };
  return g;
}

// ---------- smoke from damaged / broken-down vehicles ----------
const PUFF_GEO = new THREE.SphereGeometry(0.35, 8, 6);
const DETAIL = 16; // m: closer than this a parked vehicle gets its full model (see-through cart windshield)
const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class Vehicles {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.list = new Map();
    this.driving = null;   // my vehicle's simulated state while I drive
    this.puffs = [];
    this.reset(game.kind);
  }

  // Every vehicle has a slot in an InstancedMesh per model+color (one draw call each, used while
  // it's parked or far away) and gets its full model (turning wheels, driver) only when it's
  // close to the camera, moving or driven.
  reset(kind) {
    this.kind = kind;
    for (const v of this.list.values()) this.removeBoxes(v);
    for (const im of this.inst?.values() || []) im.dispose();
    this.group.clear();
    this.list.clear();
    this.driving = null;
    this.inst = new Map();
    const spawns = vehicleSpawns(this.g.map, kind);
    const count = new Map();
    for (const s of spawns) { const k = s.type + ':' + (s.color % VEHICLE_TYPES[s.type].colors.length); count.set(k, (count.get(k) || 0) + 1); }
    for (const [k, n] of count) {
      const [type, ci] = k.split(':');
      const im = new THREE.InstancedMesh(parkedGeo(type, VEHICLE_TYPES[type].colors[ci]), propMaterial, n);
      im.frustumCulled = false; // instances are all over the map; ~12 meshes, cheap to always submit
      im.count = 0;
      this.inst.set(k, im);
      this.group.add(im);
    }
    for (const s of spawns) {
      const T = VEHICLE_TYPES[s.type], ci = s.color % T.colors.length, im = this.inst.get(s.type + ':' + ci);
      const v = { id: s.id, type: s.type, color: T.colors[ci], x: s.x, y: 0, z: s.z, yaw: s.yaw, speed: 0, driver: 0, hp: 100, broken: 0, buf: [], boxes: [], mesh: null, im, ii: im.count++, shown: null, roll: 0, steer: 0, smokeT: 0, movedAt: -1e9 };
      this.list.set(v.id, v);
      this.placeBoxes(v);
      this.showInstance(v, true);
    }
  }

  // parked look (instance) on/off; `on` also refreshes its position
  showInstance(v, on) {
    if (on) {
      _m4.compose(_p.set(v.x, v.y, v.z), _q.setFromEuler(_e.set(0, v.yaw, v.broken ? 0.06 : 0)), _s.set(1, 1, 1));
      v.shown = { x: v.x, y: v.y, z: v.z, yaw: v.yaw, broken: v.broken };
    } else {
      _m4.makeScale(0, 0, 0);
      v.shown = null;
    }
    v.im.setMatrixAt(v.ii, _m4);
    v.im.instanceMatrix.needsUpdate = true;
  }
  setDetailed(v, on) {
    if (on && !v.mesh) { v.mesh = createVehicleMesh(v.type, v.color); v.roll = 0; }
    if (on && !v.mesh.parent) { this.group.add(v.mesh); this.showInstance(v, false); }
    if (!on && v.mesh && v.mesh.parent) { this.group.remove(v.mesh); this.showInstance(v, true); }
  }

  // keep the vehicle's collision boxes in my World (I bump into parked and moving vehicles)
  placeBoxes(v) {
    this.removeBoxes(v);
    v.boxes = vehicleBoxes(v, VEHICLE_TYPES[v.type]).map((b) => this.g.world.add(b));
    v.bx = v.x; v.bz = v.z; v.byaw = v.yaw;
  }
  removeBoxes(v) { for (const b of v.boxes) this.g.world.remove(b.id); v.boxes = []; }

  // `vh` entries: [id, x, y, z, yaw, speed, driver, hp%, broken]
  onSnapshot(vh, tm) {
    for (const [id, x, y, z, yaw, sp, driver, hp, broken] of vh) {
      const v = this.list.get(id);
      if (!v) continue;
      const b = v.buf, last = b[b.length - 1];
      if (last && tm - last.t > 0.25) b.push({ ...last, t: tm - 0.05 }); // it was parked: start moving from here
      b.push({ t: tm, x, y, z, yaw, sp });
      while (b.length > 20) b.shift();
      if (broken && !v.broken) this.g.burst(new THREE.Vector3(x, y + 1.2, z), ['#555555', '#888888', '#ffcc33'], 24);
      Object.assign(v, { driver, hp, broken });
    }
  }
  onBroken(id) {
    const v = this.list.get(id);
    if (v) this.g.burst(new THREE.Vector3(v.x, v.y + 1.2, v.z), ['#555555', '#888888', '#ff8a30'], 30);
  }

  // personal events: ['veh', id, x, y, z, yaw] got in (id 0: got out), ['vc', x, y, z, yaw] correction
  onEnterExit(e) {
    if (!e[1]) { this.driving = null; return; }
    const v = this.list.get(e[1]);
    if (!v) return;
    this.driving = { id: v.id, type: v.type, x: e[2], y: e[3], z: e[4], yaw: e[5], speed: 0, vy: 0 };
    this.lookYaw = this.g.yaw; this.lookAt = 0;
    this.g.yaw = e[5]; this.g.pitch = -0.2; this.g.emote = null; this.g.buildKind = null; this.g.mouse.right = false;
    const T = VEHICLE_TYPES[v.type];
    this.g.hud.tip('drive', this.g.tipText(
      `You're driving a <b>${T.name}</b>! <kbd>W</kbd>/<kbd>S</kbd> gas, brake and reverse, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>SPACE</kbd> handbrake, <kbd>E</kbd> to get out. Drive into enemies to tackle them!`,
      `You're driving a <b>${T.name}</b>! Push the <b>joystick</b> up for gas, down to brake/reverse, sideways to steer. <b>JUMP</b> is the handbrake, <b>USE</b> gets you out.`), 9000);
  }
  correct(e) {
    const d = this.driving;
    if (!d) return;
    d.x = e[1]; d.y = e[2]; d.z = e[3]; d.yaw = e[4]; d.speed = 0;
  }

  // My driving step (instead of stepPlayer). input: the usual { f, s, jump } from keys/joystick.
  drive(input, dt) {
    const d = this.driving, L = this.g.local;
    const vin = { f: input.f, s: input.s, brake: input.jump };
    let left = dt, impact = 0;
    while (left > 0) { const h = Math.min(left, 1 / 60); impact = Math.max(impact, stepVehicle(this.g.world, d, vin, h)); left -= h; }
    if (impact > 6) { this.g.addShake(Math.min(0.6, impact / 30)); this.g.sfxBump?.(impact); }
    L.x = d.x; L.y = d.y; L.z = d.z; L.vx = L.vz = L.vy = 0; L.onGround = true;
    // chase camera: swing back behind the vehicle unless you just looked around
    const g = this.g, t = nowS();
    if (Math.abs(g.yaw - (this.camYaw ?? g.yaw)) > 1e-4 || Math.abs(g.pitch - (this.camPitch ?? g.pitch)) > 1e-4) this.lookAt = t;
    if (t - (this.lookAt || 0) > 1.2) {
      const k = Math.min(1, dt * (1.5 + Math.min(3, Math.abs(d.speed) / 4)));
      g.yaw = lerpAngle(g.yaw, d.yaw, k);
      g.pitch += (-0.2 - g.pitch) * Math.min(1, dt * 2);
    }
    g.pitch = Math.max(-0.9, Math.min(0.35, g.pitch));
    this.camYaw = g.yaw; this.camPitch = g.pitch;
  }
  inFields() { const d = this.driving; return d ? { vy: +d.yaw.toFixed(3), vs: +d.speed.toFixed(2) } : null; }
  get myVehicle() { return this.driving && this.list.get(this.driving.id); }

  sample(v, t) {
    const b = v.buf;
    if (!b.length) return v;
    if (t <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const a = b[i - 1], c = b[i];
        if (t >= c.t) return c;
        const k = (t - a.t) / (c.t - a.t);
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: lerpAngle(a.yaw, c.yaw, k), sp: a.sp + (c.sp - a.sp) * k };
      }
    }
    return b[b.length - 1];
  }

  // Once per frame, after other players were interpolated.
  update(dt, renderT, input) {
    const L = this.g.local, drivers = new Map(), cam = this.g.camera.position, now = nowS();
    for (const v of this.list.values()) {
      let s;
      if (this.driving && this.driving.id === v.id) {
        s = { x: this.driving.x, y: this.driving.y, z: this.driving.z, yaw: this.driving.yaw, sp: this.driving.speed };
        v.steer += ((input ? -input.s * 0.45 : 0) - v.steer) * Math.min(1, dt * 10);
      } else {
        // far vehicles are sent every 4th tick: draw them a bit further back so they glide
        const far = Math.abs(v.x - L.x) > 160 || Math.abs(v.z - L.z) > 160;
        s = this.sample(v, renderT - (far ? 0.15 : 0));
        v.steer *= 0.9;
      }
      v.x = s.x; v.y = s.y; v.z = s.z; v.yaw = s.yaw; v.speed = s.sp ?? v.speed;
      if (Math.hypot(v.x - v.bx, v.z - v.bz) > 0.05 || Math.abs(v.yaw - v.byaw) > 0.01) { this.placeBoxes(v); v.movedAt = now; }
      const driver = this.driving && this.driving.id === v.id ? this.g.myId : v.driver;
      if (driver) drivers.set(driver, v);
      // full model when close, driven or just moved; otherwise the instanced parked model
      const near = Math.abs(v.x - cam.x) < DETAIL && Math.abs(v.z - cam.z) < DETAIL && (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 < DETAIL * DETAIL;
      this.setDetailed(v, near || !!driver || now - v.movedAt < 2);
      if (v.mesh && v.mesh.parent) {
        this.pose(v, s, dt);
        this.dressDriver(v, driver);
      } else if (!v.shown || v.shown.x !== v.x || v.shown.z !== v.z || v.shown.yaw !== v.yaw || v.shown.y !== v.y || v.shown.broken !== v.broken) this.showInstance(v, true);
      // smoke when badly damaged or broken down
      if ((v.broken || v.hp < 35) && Math.abs(v.x - L.x) < 120 && Math.abs(v.z - L.z) < 120) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) { v.smokeT = v.broken ? 0.12 : 0.3; this.puff(v); }
      }
    }
    // hide the full player model of anyone driving (they show as the seated driver)
    for (const e of this.g.ents.values()) e.inVehicle = drivers.has(e.id);
    this.updatePuffs(dt);
  }

  pose(v, s, dt = 0) {
    const m = v.mesh, T = VEHICLE_TYPES[v.type], W = WHEELS[v.type];
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.yaw;
    v.roll += ((s.sp || 0) * dt) / W.r;
    for (const w of m.userData.wheels) {
      w.spin.rotation.x = -v.roll;
      w.pivot.rotation.y = w.front ? v.steer : 0;
    }
    // a little lean in turns and a sag when broken
    m.rotation.z = v.broken ? 0.06 : Math.max(-0.05, Math.min(0.05, v.steer * Math.abs(s.sp || 0) / T.max * 0.12));
  }
  dressDriver(v, driver) {
    const u = v.mesh.userData;
    u.bust.visible = !!driver;
    if (!driver || u.driverId === driver) return;
    u.driverId = driver;
    const r = this.g.roster.get(driver);
    const k = (r && r.skin) || this.g.mySkin || {};
    u.torso.material = mat(k.jersey || '#c03030');
    u.helmet.material = mat(k.helmetOn === false ? (k.hair || '#3a2a1a') : (k.helmet || k.jersey || '#c03030'));
  }

  puff(v) {
    const m = new THREE.Mesh(PUFF_GEO, new THREE.MeshBasicMaterial({ color: v.broken ? 0x555555 : 0x9a9a9a, transparent: true, opacity: 0.7, depthWrite: false }));
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), T = VEHICLE_TYPES[v.type];
    m.position.set(v.x + fx * T.L * 0.32 + (Math.random() - 0.5) * 0.4, v.y + 1.2, v.z + fz * T.L * 0.32 + (Math.random() - 0.5) * 0.4);
    this.group.add(m);
    this.puffs.push({ m, life: 1.6, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6 });
  }
  updatePuffs(dt) {
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) { this.group.remove(p.m); p.m.material.dispose(); return false; }
      p.m.position.x += p.vx * dt; p.m.position.y += 1.4 * dt; p.m.position.z += p.vz * dt;
      p.m.scale.setScalar(1 + (1.6 - p.life) * 1.3);
      p.m.material.opacity = 0.7 * (p.life / 1.6);
      return true;
    });
  }

  // Closest vehicle I could get into: { veh: id, label, d } (d = distance from its edge).
  nearest(L) {
    if (this.driving) {
      const v = this.myVehicle;
      return { veh: 'exit', label: `Get out of ${VEHICLE_TYPES[v.type].name}`, d: 0 };
    }
    let best = null;
    for (const v of this.list.values()) {
      if (v.driver || v.broken || Math.abs(v.y - L.y) > 1.8) continue;
      const d = distToVehicle(v, L.x, L.z);
      if (d < VEHICLE.enterRange && (!best || d < best.d)) best = { veh: v.id, label: `Drive ${VEHICLE_TYPES[v.type].name}`, d };
    }
    return best;
  }

  mapIcons() {
    const out = [];
    for (const v of this.list.values()) out.push({ x: v.x, z: v.z, yaw: v.yaw, len: VEHICLE_TYPES[v.type].L, broken: v.broken, mine: !!this.driving && this.driving.id === v.id });
    return out;
  }

  dispose() {
    for (const v of this.list.values()) this.removeBoxes(v);
    for (const p of this.puffs) p.m.material.dispose();
    for (const im of this.inst.values()) im.dispose(); // (the baked geometries are shared and cached)
    this.g.scene.remove(this.group);
    this.list.clear();
  }
}
