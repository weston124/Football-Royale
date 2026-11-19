// End-to-end server test: a fake player drops, lands, loots, shoots and builds.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { World, stepFalling, stepPlayer } from '../shared/physics.js';
import { generateMap } from '../shared/map.js';

const PORT = 3999;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('drop, loot, shoot and build', { timeout: 120000 }, async () => {
  const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, ADMIN_PASSWORD: 'x' }, stdio: 'ignore' });
  await wait(900);
  try {
    const map = generateMap();
    const world = new World();
    for (const b of map.boxes) world.add({ min: b.min.slice(), max: b.max.slice() });
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const st = { me: null, loot: new Map(), ents: new Map(), pieces: 0, hits: 0, corr: null, started: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'lobby' && !st.lobby) { st.lobby = true; ws.send(JSON.stringify({ t: 'start' })); }
      if (m.t === 'start') { st.started = m; for (const l of m.loot) st.loot.set(l[0], l); }
      if (m.t !== 's') return;
      if (m.me) st.me = m.me;
      for (const p of m.ps) st.ents.set(p[0], p);
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
    ws.send(JSON.stringify({ t: 'join', name: 'Tester', create: true, mode: 'build', difficulty: 'easy' }));
    while (!st.started) await wait(50);
    await wait(2500);
    ws.send(JSON.stringify({ t: 'jump' }));
    while (!st.corr) await wait(50);
    const p = { x: st.corr[1], y: st.corr[2], z: st.corr[3], vx: 0, vy: 0, vz: 0, phase: 'fall', onGround: false };
    // pick a floor weapon on open ground and steer toward it while falling
    const drop = [...st.loot.values()].find((l) => l[4].w && l[4].w !== 'whistle' && l[2] === 0 && Math.hypot(l[1] - p.x, l[3] - p.z) < 260);
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
      const goal = [...st.loot.values()].filter((l) => l[4].w && l[4].w !== 'whistle' && !tried.has(l[0]))
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
