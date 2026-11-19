// Headless bandwidth meter: signs up, starts a private match full of bots, jumps, lands,
// stands still and measures the bytes per second it receives.
//   PORT=4103 node tools/netmeter.js [seconds=30]
// Prints JSON: { kbps (all messages), snapKbps, avgSnapBytes, maxSnapBytes, ents }
import WebSocket from 'ws';
import { World, stepFalling } from '../shared/physics.js';
import { generateMap } from '../shared/map.js';
import { createSnapshotDecoder } from '../shared/netcodec.js';

const PORT = Number(process.env.PORT) || 4103;
const SECS = Number(process.argv[2]) || 30;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const map = generateMap();
const world = new World();
for (const b of map.boxes) world.add({ min: b.min.slice(), max: b.max.slice() });
const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const st = { started: false, corr: null, me: null, measuring: false, bytes: 0, snapBytes: 0, snaps: 0, max: 0, ents: new Map(), evBytes: 0, psBytes: 0 };
const dec = createSnapshotDecoder();
ws.on('message', (raw) => {
  const len = raw.length;
  const m = JSON.parse(raw);
  if (m.t === 'auth') st.authed = true;
  if (m.t === 'lobby' && !st.lobby) { st.lobby = true; ws.send(JSON.stringify({ t: 'start' })); }
  if (m.t === 'start') st.started = true;
  if (st.measuring) st.bytes += len;
  if (m.t !== 's') return;
  if (st.measuring) {
    st.snapBytes += len; st.snaps++; st.max = Math.max(st.max, len);
    st.evBytes += JSON.stringify(m.ev || []).length; st.psBytes += JSON.stringify(m.ps || []).length;
  }
  for (const e of dec(m)) st.ents.set(e.id, e);
  if (m.me) st.me = m.me;
  for (const e of m.pe || []) if (e[0] === 'corr') st.corr = e;
});
await new Promise((r) => ws.on('open', r));
const tag = Math.random().toString(36).slice(2, 8);
ws.send(JSON.stringify({ t: 'signup', email: `m${tag}@example.com`, username: `Meter${tag}`, password: 'testing123', ageOk: true }));
while (!st.authed) await wait(50);
ws.send(JSON.stringify({ t: 'join', create: true, mode: 'nobuild', difficulty: 'normal' }));
while (!st.started) await wait(50);
await wait(2500);
ws.send(JSON.stringify({ t: 'jump' }));
while (!st.corr) await wait(50);
const p = { x: st.corr[1], y: st.corr[2], z: st.corr[3], vx: 0, vy: 0, vz: 0, phase: 'fall', onGround: false };
for (let i = 0; i < 4000 && p.phase !== 'ground'; i++) {
  stepFalling(world, p, { f: 0, s: 0, yaw: 0, pitch: -1, jump: false, sprint: false }, 0.05);
  ws.send(JSON.stringify({ t: 'in', x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, ph: p.phase }));
  await wait(50);
}
const keep = setInterval(() => ws.send(JSON.stringify({ t: 'in', x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, ph: 'ground' })), 50);
await wait(3000);
st.measuring = true;
const t0 = Date.now();
await wait(SECS * 1000);
const dt = (Date.now() - t0) / 1000;
clearInterval(keep);
console.log(JSON.stringify({
  secs: +dt.toFixed(1), kbps: +(st.bytes / dt / 1024).toFixed(2), snapKbps: +(st.snapBytes / dt / 1024).toFixed(2),
  psKbps: +(st.psBytes / dt / 1024).toFixed(2), evKbps: +(st.evBytes / dt / 1024).toFixed(2),
  snapsPerSec: +(st.snaps / dt).toFixed(1), avgSnapBytes: Math.round(st.snapBytes / Math.max(1, st.snaps)), maxSnapBytes: st.max,
  ents: st.ents.size, hp: st.me && st.me.hp, landedAt: [Math.round(p.x), Math.round(p.z)],
}));
ws.close();
process.exit(0);
