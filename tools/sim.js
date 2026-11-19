// Headless match simulator: runs whole matches (75 players) in fast-forward with a fake
// clock, scripted "humans" that only act through the same messages a browser sends, and
// invariant checks every second. Prints match length, tick cost and anything suspicious.
//
//   node tools/sim.js [matches=3] [mode=nobuild|build|mixed] [difficulty=normal] [kind=normal|partyRoyale]
//
import { Match, setClock, MAP } from '../server/match.js';
import { stepPlayer, stepFalling, lineOfSight, supportHeight } from '../shared/physics.js';
import { TICK_RATE, PLAYER, BUILD, PICKUP_RANGE, MAX_HP, MAX_PADDING } from '../shared/constants.js';
import { WEAPONS, CONSUMABLES } from '../shared/weapons.js';
import { nav, updateBot } from '../server/bots.js';

const DT = 1 / TICK_RATE;
let T = 1000;
setClock(() => T);

const fakeWs = () => {
  const ws = { readyState: 1, pe: [], end: null, send(s) {
    if (typeof s !== 'string') s = JSON.stringify(s);
    if (s.includes('"pe"')) { const m = JSON.parse(s); if (m.pe) ws.pe.push(...m.pe); }
    else if (s.startsWith('{"t":"end"')) ws.end = JSON.parse(s);
  } };
  return ws;
};
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const dirFrom = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };

// A scripted player that behaves roughly like a 10-12 year old: lands at a POI, grabs the
// closest weapon, fights what it sees with moderate aim, heals, follows the storm and
// throws up walls in build mode when shot.
function makeScripted(m, p, skill) {
  const L = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: 'blimp', onGround: false };
  const S = { L, target: null, jumpAt: 3 + Math.random() * 12, nextThink: 0, enemy: null, lastHp: 100, nextBuild: 0, stuckT: 0, enemySince: 0, react: 0.35, hits: 0, shots: 0, sx: 0, sz: 0, unstick: 0, uy: 0 };
  const land = MAP.pois[Math.floor(Math.random() * MAP.pois.length)];
  S.land = { x: land.x + (Math.random() - 0.5) * land.r, z: land.z + (Math.random() - 0.5) * land.r };
  const send = (msg) => m.handle(p, msg);
  S.step = (t) => {
    if (!p.alive) return;
    for (const e of p.ws.pe) if (e[0] === 'hit') S.hits++;
    for (const e of p.ws.pe) if (e[0] === 'corr') { L.x = e[1]; L.y = e[2]; L.z = e[3]; if (e[4]) L.phase = e[4]; L.vx = L.vy = L.vz = 0; }
    p.ws.pe.length = 0;
    if (L.phase === 'blimp') {
      if (t - m.blimp.t0 > S.jumpAt) send({ t: 'jump' });
      if (p.phase !== 'blimp' && L.phase === 'blimp') { L.phase = p.phase; Object.assign(L, { x: p.x, y: p.y, z: p.z }); }
      return;
    }
    const input = { f: 0, s: 0, yaw: p.yaw, pitch: -1, jump: false, sprint: true };
    if (L.phase === 'fall' || L.phase === 'glide') {
      input.yaw = yawTo(S.land.x - L.x, S.land.z - L.z);
      input.f = Math.hypot(S.land.x - L.x, S.land.z - L.z) > 3 ? 1 : 0;
      stepFalling(m.world, L, input, DT);
      send({ t: 'in', x: L.x, y: L.y, z: L.z, yaw: input.yaw, pitch: 0, ph: L.phase });
      return;
    }
    // ground: think a few times a second
    const me = p;
    if (t >= S.nextThink) {
      S.nextThink = t + 0.25;
      const prevEnemy = S.enemy;
      S.enemy = null;
      let bd = 70;
      for (const q of m.players.values()) {
        if (q === p || !q.alive || q.phase !== 'ground' || q.team === p.team) continue;
        const d = Math.hypot(q.x - L.x, q.z - L.z);
        if (d < bd && lineOfSight(m.world, L.x, L.y + PLAYER.eye, L.z, q.x, q.y + 1.3, q.z)) { bd = d; S.enemy = q; }
      }
      if (S.enemy !== prevEnemy) S.enemySince = t;
      const rank = { shotgun: 3, smg: 3.5, rifle: 4, pistol: 1, sniper: 2, pigskin: 1.5 };
      let hasGun = -1, hr = -1;
      me.inv.forEach((it, i) => { if (it && it.w && it.w !== 'whistle' && rank[it.w] + it.r * 0.3 > hr) { hr = rank[it.w] + it.r * 0.3; hasGun = i; } });
      const z = m.zone;
      S.target = null;
      if (Math.hypot(L.x - z.cx, L.z - z.cz) > z.r - 10 || (z.st === 0 && t > z.end - 15 && Math.hypot(L.x - z.tx, L.z - z.tz) > z.tr - 6)) {
        S.target = z.st === 0 && t > z.end - 15 ? { x: z.tx, z: z.tz } : { x: z.cx, z: z.cz };
      } else if (!S.enemy || hasGun < 0) {
        let best = null, bl = hasGun >= 0 ? 30 : 120;
        for (const l of m.loot.values()) {
          if (l.item.mats && m.mode !== 'build') continue;
          const d = Math.hypot(l.x - L.x, l.z - L.z) + Math.abs(l.y - L.y) * 4;
          if (d < bl && !(S.skip && S.skip.has(l.id))) { bl = d; best = l; }
        }
        if (best) {
          S.target = { x: best.x, z: best.z, id: best.id };
          if (Math.hypot(best.x - L.x, best.z - L.z) < PICKUP_RANGE - 0.4) send({ t: 'pickup', id: best.id });
        } else S.target = { x: z.cx + Math.sin(t * 0.1) * z.r * 0.3, z: z.cz + Math.cos(t * 0.1) * z.r * 0.3 };
      }
      // heal when hurt and nobody around
      const heal = me.inv.findIndex((it) => it && it.c && ((CONSUMABLES[it.c].heal && me.hp < CONSUMABLES[it.c].max - 10) || (it.c === 'padding' && me.pad < 60)));
      if (!S.enemy && heal >= 0 && me.useUntil <= t) {
        if (me.slot !== heal + 1) send({ t: 'slot', i: heal + 1 }); else send({ t: 'fire', aim: [0, 0, -1], rt: t });
      } else if (hasGun >= 0 && me.slot !== hasGun + 1 && (S.enemy || me.useUntil <= t)) send({ t: 'slot', i: hasGun + 1 });
      // stuck: try a sidestep and hop, and give up on that loot
      if (Math.hypot(L.x - S.sx, L.z - S.sz) < 0.5 && S.target) {
        if (++S.stuckT > 4) { S.unstick = t + 1; S.uy = Math.random() * Math.PI * 2; S.stuckT = 0; if (S.target.id) (S.skip ||= new Set()).add(S.target.id); }
      } else S.stuckT = 0;
      S.sx = L.x; S.sz = L.z;
    }
    const cur = m.currentItem(me);
    const armed = me.inv.some((it) => it && it.w && it.w !== 'whistle');
    if (S.enemy && S.enemy.alive && (armed || Math.hypot(S.enemy.x - L.x, S.enemy.z - L.z) < 3)) {
      const q = S.enemy;
      const dx = q.x - L.x, dz = q.z - L.z, dy = q.y + 1.1 - (L.y + PLAYER.eye), d = Math.hypot(dx, dz);
      input.yaw = yawTo(dx, dz); input.pitch = Math.atan2(dy, d);
      input.s = Math.sin(t * 2) > 0 ? 1 : -1; input.f = d > 25 ? 1 : d < 8 ? -1 : 0; input.sprint = false;
      if (cur && cur.w && cur.w !== 'tackle') {
        const W = WEAPONS[cur.w];
        if (W.mag && cur.ammo <= 0) send({ t: 'reload' });
        else if (t >= me.nextFire && t - S.enemySince > S.react) {
          const e = skill * (1 + d / 50);
          const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * e;
                    const sp = (W.adsSpread || 0) * 1.5; // aiming down sights while strafing
          const ay = input.yaw + g(), ap = input.pitch + g();
          const dirs = []; for (let i = 0; i < (W.pellets || 1); i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * sp; dirs.push(dirFrom(ay + Math.cos(a) * r, ap + Math.sin(a) * r)); }
          S.shots++; send({ t: 'fire', aim: dirFrom(ay, ap), dirs, rt: t - 0.1 });
        }
      } else if (d < 2.5) send({ t: 'fire', aim: dirFrom(input.yaw, input.pitch), rt: t });
      // build a wall toward the enemy when getting shot
      if (m.mode === 'build' && me.hp < S.lastHp - 5 && me.mats >= BUILD.cost && t > S.nextBuild) {
        S.nextBuild = t + 1.5;
        const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw);
        const rot = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2);
        send({ t: 'build', k: 'wall', gx: Math.floor(L.x / 4), gy: Math.floor((L.y + 0.2) / 4), gz: Math.floor(L.z / 4), r: rot });
      }
    } else if (S.target) {
      // a person can find doors: walk the nav-grid path like the bots do
      const tg = S.target;
      if (!S.path || t > S.pathAt + 2.5 || Math.hypot(S.pathGoal[0] - tg.x, S.pathGoal[1] - tg.z) > 3) {
        S.path = nav().findPath(L.x, L.z, tg.x, tg.z, 4000, L.y) || [[tg.x, tg.z]]; S.pathI = 0; S.pathAt = t; S.pathGoal = [tg.x, tg.z];
      }
      while (S.pathI < S.path.length - 1 && Math.hypot(S.path[S.pathI][0] - L.x, S.path[S.pathI][1] - L.z) < 0.9) S.pathI++;
      const w = S.path[S.pathI];
      input.yaw = t < S.unstick ? S.uy : yawTo(w[0] - L.x, w[1] - L.z);
      input.f = Math.hypot(S.target.x - L.x, S.target.z - L.z) > 1 ? 1 : 0;
      input.jump = S.stuckT > 2;
      input.pitch = 0;
      // tackle a nearby tree for turf in build mode
      if (m.mode === 'build' && me.mats < 60 && Math.random() < 0.02) send({ t: 'slot', i: 0 }), send({ t: 'fire', aim: dirFrom(input.yaw, 0), rt: t });
    }
    S.lastHp = me.hp;
    // 3 sub-steps like the browser's 60 Hz loop
    for (let k = 0; k < 3; k++) stepPlayer(m.world, L, input, DT / 3);
    send({ t: 'in', x: L.x, y: L.y, z: L.z, yaw: input.yaw, pitch: input.pitch, ph: L.phase });
  };
  return S;
}

// An average 10-12 year old, expressed in bot-difficulty terms.
export const KID = {
  aimError: 0.07, react: 0.6, fireMul: 1, sight: 70, glideSight: 30, hearing: 12, fov: 1.4, turn: 7,
  burst: [3, 0.25], warmup: 1.5, maxOnHuman: 9, aggro: 0.5, healAt: 55, jumpy: 0.2,
  build: 0.3, buildCooldown: 2, rampChance: 0.2, nade: 0.3, rotateEarly: 5, matsWanted: 50,
};
function makeBotKid(m, p, D) {
  const S = { hits: 0, shots: 0, inited: false };
  S.step = (t) => {
    for (const e of p.ws.pe) if (e[0] === 'hit') S.hits++;
    p.ws.pe.length = 0;
    if (!p.alive) return;
    if (!S.inited) { updateBot.init(m, p); p.ai.D = D; S.inited = true; }
    updateBot(m, p, DT, t);
    p.lastIn = { t, x: p.x, y: p.y, z: p.z };
  };
  return S;
}

function solidAt(world, x, y, z) {
  const r = PLAYER.radius - 0.05;
  for (const b of world.query(x - r, z - r, x + r, z + r)) {
    if (b.ramp) continue;
    if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
    if (y + 0.75 >= b.max[1] || y + PLAYER.height - 0.1 <= b.min[1]) continue;
    return b;
  }
  return null;
}

export function runMatch({ mode = 'nobuild', difficulty = 'normal', kind = 'normal', humans = 1, squad = false, leaveAt = 0, skill = 0.05, maxMin = 25, verbose = false, brain = 'script', kid = KID, keepTimes = false } = {}) {
  setClock(() => T);
  const m = new Match({ code: 'SIM', mode, difficulty, kind, isPublic: false });
  clearInterval(m.timer);
  const hs = [];
  for (let i = 0; i < humans; i++) {
    const p = m.addHuman(fakeWs(), `KID ${i + 1}`, null, squad ? 9 : 0, null);
    hs.push(p);
  }
  m.handle(hs[0], { t: 'start' });
  // brain 'bot': the first human is driven by the bot AI with a kid-like skill profile
  // (still a human to the server: full fire rate, bots limit how many gang up on it)
  const scripted = hs.map((p, i) => (i === 0 && brain === 'bot' ? makeBotKid(m, p, kid) : makeScripted(m, p, skill)));
  const issues = [];
  const issue = (s) => { if (issues.length < 40) issues.push(`[${(T - m.startTime).toFixed(0)}s] ${s}`); };
  const tickMs = [], simMs = [];
  const start = m.startTime;
  let nextCheck = T + 1;
  const lastPos = new Map(); // bot id -> {x,z,t}
  let stuckBots = 0, stuckSamples = 0;
  const aliveAt = {};
  let left = false;
  const counts = {};
  const origHandle = m.handle.bind(m);
  m.handle = (p, msg) => { if (msg.t !== 'in') { const k = (p.bot ? 'bot_' : 'kid_') + msg.t; counts[k] = (counts[k] || 0) + 1; } return origHandle(p, msg); };
  const origBuild = m.onBuild.bind(m);
  m.onBuild = (p, msg) => { const n = m.pieces.size; origBuild(p, msg); if (m.pieces.size > n) counts[(p.bot ? 'bot' : 'kid') + '_built'] = (counts[(p.bot ? 'bot' : 'kid') + '_built'] || 0) + 1; };
  const origSim = m.simulate.bind(m);
  m.simulate = (t) => { const a = process.hrtime.bigint(); origSim(t); simMs.push(Number(process.hrtime.bigint() - a) / 1e6); };
  while (!m.closed && T - start < maxMin * 60) {
    T += DT;
    for (const s of scripted) s.step(T);
    if (leaveAt && !left && T - start > leaveAt && hs[1]) { left = true; m.removeHuman(hs[1]); }
    const a = process.hrtime.bigint();
    try { m.tick(); } catch (e) { issue(`CRASH ${e.stack}`); break; }
    tickMs.push(Number(process.hrtime.bigint() - a) / 1e6);
    if (T >= nextCheck && m.state === 'play') {
      nextCheck = T + 1;
      const el = Math.floor(T - start);
      if (el % 60 === 0) aliveAt[el / 60] = m.alive.length;
      const seen = new Set();
      for (const l of m.loot.values()) {
        if (seen.has(l.item)) issue(`loot item object duplicated ${JSON.stringify(l.item)}`);
        seen.add(l.item);
        if (!Number.isFinite(l.x + l.y + l.z)) issue('loot NaN pos');
        if (!l._ok) {
          if (m.insideSolid(l.x, l.y, l.z) && !m.world.query(l.x - 0.3, l.z - 0.3, l.x + 0.3, l.z + 0.3).some((bx) => bx.pid)) issue(`loot inside solid ${JSON.stringify(l.item)} at ${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`);
          else if (l.y - supportHeight(m.world, l.x, l.y + 0.05, l.z) > 0.3) issue(`loot floating ${JSON.stringify(l.item)} at ${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`);
          else l._ok = true;
        }
      }
      for (const p of m.players.values()) {
        if (!p.alive) continue;
        if (!Number.isFinite(p.x + p.y + p.z)) issue(`${p.name} NaN position`);
        if (p.hp <= 0 || p.hp > MAX_HP || p.pad < 0 || p.pad > MAX_PADDING) issue(`${p.name} bad hp/pad ${p.hp}/${p.pad}`);
        if (p.mats < 0 || p.mats > BUILD.maxMats) issue(`${p.name} mats ${p.mats}`);
        for (const it of p.inv) {
          if (!it) continue;
          if (seen.has(it)) issue(`${p.name} item duplicated ${JSON.stringify(it)}`);
          seen.add(it);
          if (it.w) {
            const W = WEAPONS[it.w];
            const cap = it.w === 'whistle' ? W.stack : W.mag;
            if (!(it.ammo >= 0) || it.ammo > cap) issue(`${p.name} ${it.w} ammo ${it.ammo}`);
          }
          if (it.c && (!(it.n >= 1) || it.n > CONSUMABLES[it.c].stack)) issue(`${p.name} ${it.c} n=${it.n}`);
        }
        if (p.phase === 'ground') {
          if (p.y < -0.5) issue(`${p.name} below the world y=${p.y.toFixed(2)}`);
          const b = solidAt(m.world, p.x, p.y, p.z);
          if (b) issue(`${p.name}${p.bot ? '(bot)' : ''} inside ${b.kind} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
          const sup = supportHeight(m.world, p.x, p.y + 0.05, p.z);
          p._float = p.onGround && p.y - sup > 0.6 ? (p._float || 0) + 1 : 0; // (one tick after a piece breaks is fine)
          if (p._float >= 2 && p.bot) issue(`${p.name} floating ${p.y.toFixed(2)} over ${sup.toFixed(2)}`);
          if (p.bot && el % 10 === 0) {
            const lp = lastPos.get(p.id);
            if (lp && el - lp.t >= 20) {
              stuckSamples++;
              const enemyNear = p.ai.enemy && p.ai.enemy.alive;
              if (Math.hypot(p.x - lp.x, p.z - lp.z) < 3 && !enemyNear && p.useUntil <= T) { stuckBots++; if (verbose) issue(`stuck bot ${p.name} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} mode=${p.ai.mode} goal=${p.ai.goal ? [p.ai.goal.kind, p.ai.goal.x.toFixed(1), p.ai.goal.z.toFixed(1), p.ai.goal.id].join(',') : '-'} path=${p.ai.path ? p.ai.path.length + '@' + p.ai.pathI : '-'} enemy=${p.ai.enemy ? p.ai.enemy.name + (p.ai.vis ? ' vis' : '') : '-'} slot=${p.slot} inv=${p.inv.map((i) => i ? (i.w || i.c) : '_').join('/')} hp=${p.hp}`); }
              lastPos.set(p.id, { x: p.x, z: p.z, t: el });
            } else if (!lp) lastPos.set(p.id, { x: p.x, z: p.z, t: el });
          }
        }
        if ((p.phase === 'fall' || p.phase === 'glide') && T - start > 150) issue(`${p.name} still ${p.phase} at ${p.y.toFixed(0)}`);
      }
    }
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const sorted = [...simMs].sort((a, b) => a - b);
  const res = {
    kind, mode, difficulty, ended: m.state === 'ended' || m.closed,
    length: m.endedAt ? (m.endedAt - start) : null,
    winner: m.final ? m.final.winnerName : null,
    humanPlaces: hs.map((p) => p.alive && m.state === 'ended' ? 1 : p.place),
    humanKills: hs.map((p) => p.kills),
    humanShots: scripted.map((s) => `${s.hits}/${s.shots}`),
    tickAvg: avg(tickMs), simAvg: avg(simMs), simP99: sorted[Math.floor(sorted.length * 0.99)] || 0, simMax: sorted[sorted.length - 1] || 0,
    stuckPct: stuckSamples ? (100 * stuckBots / stuckSamples) : 0,
    aliveAt, issues, zonePhase: m.zone && m.zone.ph,
    topKills: m.final && m.final.top, counts, simTimes: keepTimes ? simMs : undefined,
  };
  if (!m.closed) m.close();
  return res;
}

if (process.argv[1] && process.argv[1].endsWith('sim.js')) {
  const n = +process.argv[2] || 3;
  const modeArg = process.argv[3] || 'mixed';
  const diff = process.argv[4] || 'normal';
  const kind = process.argv[5] || 'normal';
  const humans = +(process.env.HUMANS || 2);
  const results = [];
  for (let i = 0; i < n; i++) {
    const mode = modeArg === 'mixed' ? (i % 2 ? 'build' : 'nobuild') : modeArg;
    const r = runMatch({ mode, difficulty: diff, kind, humans, squad: !!process.env.SQUAD, leaveAt: humans > 1 ? 200 : 0, skill: +(process.env.SKILL || 0.05), verbose: !!process.env.VERBOSE, brain: process.env.BRAIN || 'script' });
    results.push(r);
    console.log(JSON.stringify({ ...r, issues: undefined }));
    for (const s of r.issues) console.log('   !', s.slice(0, 300));
  }
  const len = results.filter((r) => r.length).map((r) => r.length / 60);
  console.log(`\nmatches ${results.length}, lengths(min) ${len.map((v) => v.toFixed(1)).join(' ')}, sim avg ${(results.reduce((s, r) => s + r.simAvg, 0) / results.length).toFixed(2)} ms/tick, human places ${results.map((r) => r.humanPlaces.join('/')).join(' ')}`);
}
