// Real-time end-to-end harness: starts a server, signs up two players over the real
// WebSocket protocol, makes a private room, plays a whole match with them (drop, glide,
// land, loot, shoot, heal, build, follow the storm), has the second player leave mid-match
// and start a new room from the menu, and reports anything odd.
//
//   PORT=4102 node tools/wsplay.js [build|nobuild] [easy|normal|hard]
//
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { World, stepFalling, stepPlayer, lineOfSight } from '../shared/physics.js';
import { generateMap } from '../shared/map.js';
import { PLAYER, TICK_RATE, BUILD, DROP } from '../shared/constants.js';
import { WEAPONS, CONSUMABLES } from '../shared/weapons.js';
import { buildNav } from '../server/nav.js';

const PORT = +(process.env.PORT || 4102);
const MODE = process.argv[2] || 'nobuild';
const DIFF = process.argv[3] || 'normal';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const map = generateMap();
const world = new World();
for (const b of map.boxes) world.add({ min: b.min.slice(), max: b.max.slice() });
const nav = buildNav(map);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const dirFrom = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };
const nowS = () => performance.now() / 1000;
const report = { errors: [], corrections: {}, ended: null, kills: {}, places: {}, notes: [] };

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { name, ws, st: { me: null, loot: new Map(), ents: new Map(), zone: null, hits: 0 }, msgs: [] };
  c.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const st = c.st;
    if (m.t === 'error' || m.t === 'auth_error') report.errors.push(`${name}: ${m.t} ${m.msg}`);
    if (m.t === 'auth') st.authed = true;
    if (m.t === 'welcome') { st.id = m.id; st.code = m.code; }
    if (m.t === 'lobby') st.lobby = m;
    if (m.t === 'start') { st.started = m; st.loot.clear(); for (const l of m.loot) st.loot.set(l[0], l); st.blimp = m.blimp; st.tm0 = m.tm; st.local0 = nowS(); }
    if (m.t === 'end') { st.end = m; report.ended = report.ended || { winner: m.winnerName, at: nowS() }; }
    if (m.t === 'closed') st.closed = true;
    if (m.t !== 's') return;
    st.tm = m.tm; st.tl = nowS(); st.al = m.al;
    if (process.env.PROGRESS && name === 'KIDONE' && (!st.lastLog || nowS() - st.lastLog > 30)) { st.lastLog = nowS(); console.error(`[${(nowS() - (st.local0 || nowS())).toFixed(0)}s] alive ${m.al} zone ${JSON.stringify(st.zone)}`); }
    if (m.me) st.me = m.me;
    if (m.zn) st.zone = m.zn;
    st.ents.clear();
    for (const p of m.ps) st.ents.set(p[0], p);
    for (const e of m.ev) {
      if (e[0] === 'l+') st.loot.set(e[1], e.slice(1));
      if (e[0] === 'l-') st.loot.delete(e[1]);
      if (e[0] === 'kf' && e[2] === st.id) st.killedBy = e;
      if (e[0] === 'win') st.win = e;
    }
    for (const e of m.pe || []) {
      if (e[0] === 'corr') { st.corr = e; report.corrections[name] = (report.corrections[name] || 0) + 1; }
      if (e[0] === 'hit') st.hits++;
      if (e[0] === 'dead') { st.dead = e; report.places[name] = e[1]; }
    }
  });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

// One "kid" brain driven only by what the server sends.
async function play(c, { leaveAfter = 0 } = {}) {
  const st = c.st;
  const L = { x: 0, y: DROP.height, z: 0, vx: 0, vy: 0, vz: 0, phase: 'blimp', onGround: false };
  const t0 = nowS();
  const jumpAt = 4 + Math.random() * 14;
  let target = null, path = null, pi = 0, pathAt = 0, lastHp = 100, nextFire = 0, nextBuild = 0, skip = new Set(), stuck = 0, sx = 0, sz = 0;
  const land = map.pois[Math.floor(Math.random() * map.pois.length)];
  while (!st.dead && !st.end && !st.closed) {
    await wait(1000 / TICK_RATE);
    const t = nowS();
    if (leaveAfter && t - t0 > leaveAfter) { c.send({ t: 'leave' }); report.notes.push(`${c.name} left at ${(t - t0).toFixed(0)}s`); return 'left'; }
    if (st.corr) { const e = st.corr; st.corr = null; L.x = e[1]; L.y = e[2]; L.z = e[3]; if (e[4]) L.phase = e[4]; L.vx = L.vy = L.vz = 0; }
    const me = st.me;
    if (!me) continue;
    if (L.phase === 'blimp') {
      if (t - t0 > jumpAt) c.send({ t: 'jump' });
      continue;
    }
    const input = { f: 0, s: 0, yaw: 0, pitch: 0, jump: false, sprint: true };
    if (L.phase === 'fall' || L.phase === 'glide') {
      input.yaw = yawTo(land.x - L.x, land.z - L.z); input.pitch = -1;
      input.f = Math.hypot(land.x - L.x, land.z - L.z) > 5 ? 1 : 0;
      stepFalling(world, L, input, 1 / TICK_RATE);
      c.send({ t: 'in', x: +L.x.toFixed(2), y: +L.y.toFixed(2), z: +L.z.toFixed(2), yaw: input.yaw, pitch: 0, ph: L.phase });
      continue;
    }
    // ---- ground ----
    let enemy = null, bd = 60;
    for (const e of st.ents.values()) {
      if (e[0] === st.id || e[6] !== 0) continue;
      const d = Math.hypot(e[1] - L.x, e[3] - L.z);
      if (d < bd && lineOfSight(world, L.x, L.y + PLAYER.eye, L.z, e[1], e[2] + 1.3, e[3])) { bd = d; enemy = e; }
    }
    const guns = me.inv.map((it, i) => [it, i]).filter(([it]) => it && it.w && it.w !== 'whistle');
    const zn = st.zone;
    const outside = zn && Math.hypot(L.x - zn[0], L.z - zn[1]) > zn[2] - 8;
    if (outside) target = { x: zn[3], z: zn[4] };
    else if (!enemy || !guns.length) {
      let best = null, bl = guns.length ? 25 : 80;
      for (const l of st.loot.values()) {
        if (skip.has(l[0]) || (l[4].mats && MODE !== 'build')) continue;
        if (Math.abs(l[2] - L.y) > 1.5) continue;
        const d = Math.hypot(l[1] - L.x, l[3] - L.z);
        if (d < bl) { bl = d; best = l; }
      }
      target = best ? { x: best[1], z: best[3], id: best[0] } : zn ? { x: zn[3], z: zn[4] } : null;
      if (best && bl < 2.3) {
        if (guns.length >= 3 && best[4].w) { skip.add(best[0]); } else c.send({ t: 'pickup', id: best[0] });
        skip.add(best[0]);
      }
    } else target = null;
    // heal / weapon
    const heal = me.inv.findIndex((it) => it && it.c && CONSUMABLES[it.c].heal && me.hp < CONSUMABLES[it.c].max - 10);
    if (!enemy && heal >= 0 && !me.us) { if (me.slot !== heal + 1) c.send({ t: 'slot', i: heal + 1 }); else c.send({ t: 'fire', aim: [0, 0, -1], rt: st.tm }); }
    else if (guns.length && !me.us) {
      const [g, gi] = guns.sort((a, b) => (b[0].ammo > 0) - (a[0].ammo > 0) || b[0].r - a[0].r)[0];
      if (me.slot !== gi + 1) c.send({ t: 'slot', i: gi + 1 });
      else if (g.ammo <= 0 && !me.rl) c.send({ t: 'reload' });
    }
    if (enemy && guns.length) {
      const dx = enemy[1] - L.x, dz = enemy[3] - L.z, dy = enemy[2] + 1.1 - (L.y + PLAYER.eye), d = Math.hypot(dx, dz);
      input.yaw = yawTo(dx, dz); input.pitch = Math.atan2(dy, d);
      input.s = Math.sin(t * 2.3) > 0 ? 1 : -1; input.sprint = false;
      const it = me.slot > 0 ? me.inv[me.slot - 1] : null;
      if (it && it.w && it.ammo > 0 && t > nextFire) {
        const W = WEAPONS[it.w];
        nextFire = t + 1 / W.rate + 0.05;
        const e = 0.04 * (1 + d / 50), g = () => (Math.random() - 0.5) * 2 * e;
        const ay = input.yaw + g(), ap = input.pitch + g();
        const dirs = []; for (let i = 0; i < (W.pellets || 1); i++) dirs.push(dirFrom(ay + (Math.random() - 0.5) * W.adsSpread * 2, ap + (Math.random() - 0.5) * W.adsSpread * 2));
        c.send({ t: 'fire', aim: dirFrom(ay, ap), dirs, rt: +(st.tm + (t - st.tl) - 0.1).toFixed(3) });
      }
      if (MODE === 'build' && me.hp < lastHp - 5 && me.mats >= BUILD.cost && t > nextBuild) {
        nextBuild = t + 1.5;
        const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw);
        const rot = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2);
        c.send({ t: 'build', k: 'wall', gx: Math.floor(L.x / 4), gy: Math.floor((L.y + 0.2) / 4), gz: Math.floor(L.z / 4), r: rot });
        report.notes.push(`${c.name} built a wall`);
      }
    } else if (target) {
      if (!path || t - pathAt > 2 || Math.hypot(path.gx - target.x, path.gz - target.z) > 3) {
        path = nav.findPath(L.x, L.z, target.x, target.z, 4000, L.y) || [[target.x, target.z]]; path.gx = target.x; path.gz = target.z; pi = 0; pathAt = t;
      }
      while (pi < path.length - 1 && Math.hypot(path[pi][0] - L.x, path[pi][1] - L.z) < 0.9) pi++;
      input.yaw = yawTo(path[pi][0] - L.x, path[pi][1] - L.z);
      input.f = Math.hypot(target.x - L.x, target.z - L.z) > 1 ? 1 : 0;
      if (Math.hypot(L.x - sx, L.z - sz) < 0.05 && input.f) { if (++stuck > 30) { input.jump = true; if (target.id) skip.add(target.id); stuck = 0; } } else stuck = 0;
      sx = L.x; sz = L.z;
    }
    lastHp = me.hp;
    for (let k = 0; k < 3; k++) stepPlayer(world, L, input, 1 / (TICK_RATE * 3));
    c.send({ t: 'in', x: +L.x.toFixed(2), y: +L.y.toFixed(2), z: +L.z.toFixed(2), yaw: +input.yaw.toFixed(3), pitch: +input.pitch.toFixed(3), em: 0, ph: L.phase });
  }
  return st.end ? 'end' : st.dead ? 'dead' : 'closed';
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-wsplay-'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, ADMIN_PASSWORD: 'x', FR_DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvErr = '';
srv.stderr.on('data', (d) => { srvErr += d; });
srv.on('exit', (code) => { if (code) report.errors.push(`SERVER EXITED code ${code}: ${srvErr.slice(-800)}`); });
await wait(1200);
const start = nowS();
try {
  const a = client('KIDONE'), b = client('KIDTWO');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'signup', email: 'one@example.com', username: 'Kid One', password: 'testing123', ageOk: true });
  b.send({ t: 'signup', email: 'two@example.com', username: 'Kid Two', password: 'testing123', ageOk: true });
  while (!a.st.authed || !b.st.authed) await wait(50);
  a.send({ t: 'buy', item: 'lh_golden' }); // not enough Ball Bucks: must answer with an error, not crash
  a.send({ t: 'join', create: true, mode: MODE, difficulty: DIFF });
  while (!a.st.code) await wait(50);
  b.send({ t: 'join', room: a.st.code });
  while (!a.st.lobby || a.st.lobby.players.length < 2) await wait(50);
  a.send({ t: 'start' });
  while (!a.st.started || !b.st.started) await wait(50);
  const [ra, rb] = await Promise.all([play(a), play(b, { leaveAfter: 75 })]);
  report.notes.push(`A finished: ${ra}, B: ${rb}`);
  // B is back in the menu: it can make and start a new room right away
  b.st.code = null; b.st.started = null; b.st.end = null; b.st.dead = null;
  b.send({ t: 'join', create: true, mode: 'nobuild', difficulty: 'easy' });
  const tb = nowS();
  while (!b.st.code && nowS() - tb < 5) await wait(50);
  b.send({ t: 'start' });
  while (!b.st.started && nowS() - tb < 8) await wait(50);
  report.notes.push(b.st.started ? 'B started a new match from the menu after leaving' : 'B could NOT start a new match after leaving');
  b.send({ t: 'leave' });
  // A keeps watching until the match ends
  const ta = nowS();
  while (!a.st.end && !a.st.closed && nowS() - ta < 900) await wait(500);
  report.matchSeconds = report.ended ? +(report.ended.at - start).toFixed(0) : null;
  report.winner = a.st.end ? a.st.end.winnerName : null;
  report.aKilledBy = a.st.killedBy || null;
  report.aHits = a.st.hits;
  a.ws.close(); b.ws.close();
} catch (e) {
  report.errors.push('HARNESS ' + e.stack);
} finally {
  await wait(300);
  srv.kill();
}
console.log(JSON.stringify(report, null, 1));
