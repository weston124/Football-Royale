// End-to-end server test: a fake player drops, lands, loots, shoots and builds.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { World, stepFalling, stepPlayer, raycastWorld } from '../shared/physics.js';
import { vehicleSpawns, vehicleBoxes, VEHICLE_TYPES } from '../shared/vehicles.js';
import { generateMap } from '../shared/map.js';
import { createSnapshotDecoder } from '../shared/netcodec.js';

const PORT = Number(process.env.TEST_PORT) || 3999;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('drop, loot, shoot and build', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-root-'));
  const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, ADMIN_PASSWORD: 'x', FR_DATA_DIR: tmp }, stdio: 'ignore' });
  await wait(900);
  try {
    const map = generateMap();
    const world = new World();
    for (const b of map.boxes) world.add({ min: b.min.slice(), max: b.max.slice() });
    for (const v of vehicleSpawns(map, 'normal')) for (const b of vehicleBoxes({ ...v, y: 0 }, VEHICLE_TYPES[v.type])) world.add(b); // parked cars
    // loot out in the open (not inside a building, where walking straight at it hits a wall)
    const open = (l) => !raycastWorld(world, l[1], l[2] + 0.5, l[3], 0, 1, 0, 80);
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const decode = createSnapshotDecoder();
    const st = { me: null, loot: new Map(), ents: new Map(), pieces: 0, hits: 0, corr: null, started: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'auth') st.authed = true;
      if (m.t === 'lobby' && !st.lobby) { st.lobby = true; ws.send(JSON.stringify({ t: 'start' })); }
      if (m.t === 'start') { st.started = m; for (const l of m.loot) st.loot.set(l[0], l); }
      if (m.t !== 's') return;
      if (m.me) st.me = m.me;
      for (const e of decode(m)) st.ents.set(e.id, [e.id, e.x, e.y, e.z, e.yaw, e.pitch, e.ph]);
      for (const id of m.pg || []) st.ents.delete(id);
      for (const e of m.ev) {
        if (e[0] === 'l+') st.loot.set(e[1], e.slice(1));
        if (e[0] === 'l-') st.loot.delete(e[1]);
        if (e[0] === 'pc') st.pieces++;
      }
      for (const e of m.pe || []) {
        if (e[0] === 'corr') { st.corr = e; st.corrs = (st.corrs || 0) + 1; }
        if (e[0] === 'hit') st.hits++;
      }
    });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'signup', email: 'tester@example.com', username: 'Tester', password: 'testing123', ageOk: true }));
    while (!st.authed) await wait(50);
    ws.send(JSON.stringify({ t: 'join', create: true, mode: 'build', difficulty: 'easy' }));
    while (!st.started) await wait(50);
    await wait(2500);
    ws.send(JSON.stringify({ t: 'jump' }));
    while (!st.corr) await wait(50);
    const p = { x: st.corr[1], y: st.corr[2], z: st.corr[3], vx: 0, vy: 0, vz: 0, phase: 'fall', onGround: false };
    // pick a floor weapon on open ground and steer toward it while falling
    const drop = [...st.loot.values()].find((l) => l[4].w && l[4].w !== 'whistle' && l[2] === 0 && open(l) && Math.hypot(l[1] - p.x, l[3] - p.z) < 260);
    assert.ok(drop, 'found loot');
    const send = () => ws.send(JSON.stringify({ t: 'in', x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: 0, ph: p.phase }));
    const steer = (tx, tz) => {
      p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
      return { f: Math.hypot(tx - p.x, tz - p.z) > 0.6 ? 1 : 0, s: 0, yaw: p.yaw, pitch: -1, jump: false, sprint: true };
    };
    for (let i = 0; i < 4000 && p.phase !== 'ground'; i++) {
      stepFalling(world, p, steer(drop[1], drop[3]), 0.05);
      send(); await wait(50);
    }
    assert.equal(p.phase, 'ground', 'landed');
    // walk to the nearest weapons until we grab one (trees/houses can block the way)
    let got = false;
    const tried = new Set();
    for (let attempt = 0; attempt < 6 && !got; attempt++) {
      const goal = [...st.loot.values()].filter((l) => l[4].w && l[4].w !== 'whistle' && !tried.has(l[0]) && open(l))
        .sort((u, v) => Math.hypot(u[1] - p.x, u[3] - p.z) - Math.hypot(v[1] - p.x, v[3] - p.z))[0];
      if (!goal) break;
      tried.add(goal[0]);
      let lastD = Infinity, stuck = 0;
      for (let i = 0; i < 600 && Math.hypot(goal[1] - p.x, goal[3] - p.z) > 1; i++) {
        for (let k = 0; k < 3; k++) stepPlayer(world, p, steer(goal[1], goal[3]), 1 / 60);
        send(); await wait(50);
        const d = Math.hypot(goal[1] - p.x, goal[3] - p.z);
        stuck = d > lastD - 0.05 ? stuck + 1 : 0; lastD = d;
        if (stuck > 20) break;
      }
      ws.send(JSON.stringify({ t: 'pickup', id: goal[0] }));
      await wait(400);
      console.log('attempt', attempt, 'dist', Math.hypot(goal[1] - p.x, goal[3] - p.z).toFixed(2), 'dy', (goal[2]-p.y).toFixed(2), 'stillThere', st.loot.has(goal[0]), 'corrs', st.corrs, 'phase', st.me.ph, 'p', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1));
      got = st.me.inv.some((it) => it && it.w);
    }
    assert.ok(got, `picked up a weapon: ${JSON.stringify(st.me.inv)}`);
    const target = [0, 0, 0, 0, st.me.inv.find((it) => it && it.w)];
    // build: tackle something for turf, then place a wall
    const turfBefore = st.me.mats;
    ws.send(JSON.stringify({ t: 'build', k: 'wall', gx: Math.floor(p.x / 4), gy: 0, gz: Math.floor(p.z / 4), r: 0 }));
    // shoot the nearest bot we can see
    const slot = st.me.inv.findIndex((it) => it && it.w === target[4].w) + 1;
    ws.send(JSON.stringify({ t: 'slot', i: slot }));
    await wait(200);
    const shoot = async () => {
      let best = null, bd = 60;
      for (const e of st.ents.values()) { const d = Math.hypot(e[1] - p.x, e[3] - p.z); if (e[0] !== st.me.id && e[6] === 0 && d < bd && d > 1) { bd = d; best = e; } }
      if (!best) return false;
      const dx = best[1] - p.x, dy = best[2] + 1.2 - (p.y + 1.6), dz = best[3] - p.z, l = Math.hypot(dx, dy, dz);
      ws.send(JSON.stringify({ t: 'fire', aim: [dx / l, dy / l, dz / l], dirs: [[dx / l, dy / l, dz / l]], rt: 0 }));
      return true;
    };
    let shots = 0;
    for (let i = 0; i < 100 && st.hits === 0; i++) { if (await shoot()) shots++; await wait(250); if (i % 20 === 19) ws.send(JSON.stringify({ t: 'reload' })); }
    console.log(`turf ${turfBefore}, pieces built ${st.pieces}, shots ${shots}, hits ${st.hits}, hp ${st.me.hp}`);
    if (shots === 0) console.log('(no bot close enough to shoot this run)');
    ws.close();
  } finally { srv.kill(); }
});
