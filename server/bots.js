// Computer players that fill empty spots in a match.
//
// Each bot "thinks" 5 times a second (pick a goal: storm, fight, heal, loot, harvest, roam)
// and "acts" every tick (walk a path on the nav grid, aim, shoot, build). Difficulty
// (shared/constants.js BOT_DIFFICULTY) changes aim, reaction, sight, burst length,
// aggression, healing and building, and every bot gets a bit of personality on top.
import { stepPlayer, stepFalling, lineOfSight } from '../shared/physics.js';
import { WEAPONS, CONSUMABLES } from '../shared/weapons.js';
import { PLAYER, BOT_DIFFICULTY, BOT_VS_BOT, MAP_HALF, PICKUP_RANGE, BUILD } from '../shared/constants.js';
import { MAP } from './match.js';
import { buildNav } from './nav.js';

export const BOT_NAMES = [
  'BlitzBot', 'Sir Tackles', 'QB Quinn', 'Hut Hut', 'Fumble Fox', 'Endzone Ed', 'Punt Pete', 'Linebacker Lou',
  'Safety Sam', 'Huddle Hank', 'Snap Sally', 'Kickoff Kai', 'Gridiron Gus', 'Turf Toby', 'Wideout Wes', 'Rookie Rae',
  'Coach Bot', 'Spiral Sue', 'Hike Mike', 'Sideline Sid', 'Fourth Down Fay', 'Sack Jack', 'Pylon Paz', 'Two Point Tim',
  'Halftime Hal', 'Blocker Bo', 'Scramble Sky', 'Hail Mary Mo', 'Onside Ollie', 'Field Goal Flo', 'Chain Gang Cy',
  'Red Zone Rex', 'Audible Abe', 'Blindside Bree', 'Draw Play Dee', 'Flea Flicker', 'Juke Jo', 'Overtime Otis',
].map((n) => n.toUpperCase());

// The nav grid is built once (lazily: MAP comes from match.js, which imports us).
let NAV = null;
export function nav() { return NAV || (NAV = buildNav(MAP)); }

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const REACH = PICKUP_RANGE + 0.6;          // server accepts up to PICKUP_RANGE + 1.2
const GUN_TIER = { pistol: 1, smg: 2.4, rifle: 3, shotgun: 2.8, sniper: 2.3, pigskin: 2 };
const IDEAL = { tackle: 1.4, pistol: 18, smg: 14, rifle: 26, shotgun: 6, sniper: 55, pigskin: 22 };

function init(match, b) {
  const rnd = match.rnd;
  const D = BOT_DIFFICULTY[match.difficulty];
  // Hot drops: most bots head for a named place, weighted toward the big ones.
  const poi = rnd() < 0.7 ? rnd.pick(MAP.pois) : null;
  let tx = poi ? poi.x + rnd.range(-poi.r, poi.r) * 0.7 : rnd.range(-MAP_HALF + 50, MAP_HALF - 50);
  let tz = poi ? poi.z + rnd.range(-poi.r, poi.r) * 0.7 : rnd.range(-MAP_HALF + 50, MAP_HALF - 50);
  // land next to some loot when there is one close by
  let best = null, bd = 30;
  for (const s of MAP.loot) { const d = Math.hypot(s.x - tx, s.z - tz); if (d < bd && s.y < 1) { bd = d; best = s; } }
  if (best) { tx = best.x + rnd.range(-2, 2); tz = best.z + rnd.range(-2, 2); }
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
  b.ai = {
    land: { x: tx, z: tz }, jumpAt: 0,
    aggro: Math.max(0.05, Math.min(0.95, D.aggro + rnd.range(-0.2, 0.2))),
    zoneOff: [Math.cos(a) * rr, Math.sin(a) * rr],
    enemy: null, vis: false, seenAt: 0, engagedAt: 0, lastSeen: null, attacker: null, hurtAt: -9,
    nextThink: 0, nextSight: 0, strafe: 1, strafeUntil: 0, burstUntil: 0, pauseUntil: 0,
    goal: null, path: null, pathI: 0, pathGoal: null, pathAt: -9,
    prog: { t: 0, x: 0, z: 0, fails: 0 }, unstickUntil: 0, unstickYaw: 0, wantJump: false,
    skip: new Map(), wander: null, cover: null, coverAt: -9, nextBuild: 0, nextNade: 0,
    harvest: null, harvestUntil: 0, nextHarvest: 0,
  };
  const bl = match.blimp;
  const along = (tx - bl.x0) * bl.dx + (tz - bl.z0) * bl.dz;
  b.ai.jumpAt = Math.max(2.5, Math.min(bl.len / 38 - 1, along / 38 + rnd.range(-3, 3)));
}

// ---------- inventory helpers ----------
function gunScore(it, dist = 30) {
  if (!it || !it.w || it.w === 'whistle' || it.w === 'tackle') return -1;
  let s = GUN_TIER[it.w] + it.r * 0.5;
  if (it.w === 'shotgun') s += dist < 12 ? 2.5 : dist > 25 ? -2 : 0;
  if (it.w === 'sniper') s += dist > 50 ? 2.5 : dist < 20 ? -2 : 0;
  if (it.w === 'smg') s += dist < 25 ? 1 : dist > 50 ? -1 : 0;
  if (it.w === 'rifle') s += dist > 15 ? 0.6 : 0;
  if (it.w === 'pigskin') s += dist > 10 && dist < 45 ? 0.5 : -3;
  if (it.w === 'pistol') s += dist < 30 ? 0.3 : -0.5;
  return s;
}
// Sticks with the gun in hand unless another is clearly better: flipping between two
// empty guns used to cancel every reload, so the last bots in a match never fired.
function bestWeapon(b, dist) {
  let best = -1, score = -1e9;
  b.inv.forEach((it, i) => {
    let s = gunScore(it, dist);
    if (s < 0 && !(it && it.w && it.w !== 'whistle')) return;
    if (it.ammo <= 0 && WEAPONS[it.w].mag) s -= 1.5;
    if (b.slot === i + 1) s += b.reloadUntil > 0 ? 3 : 0.75;
    if (s > score) { score = s; best = i + 1; }
  });
  return best;
}
// How much a bot wants an item (0 = not at all). Returns { v, slot } where slot is the
// inventory slot to swap out when the backpack is full (-1 = there is a free slot).
function wantItem(match, b, item) {
  if (item.mats) return { v: match.mode === 'build' && b.mats < BUILD.maxMats - 50 ? 2 : 0, slot: -1 };
  const free = b.inv.indexOf(null);
  const guns = b.inv.filter((it) => it && it.w && it.w !== 'whistle');
  let v = 0;
  if (item.w === 'whistle') {
    const have = b.inv.find((it) => it && it.w === 'whistle');
    v = have ? (have.ammo < WEAPONS.whistle.stack ? 1.5 : 0) : 1.5;
    if (have && v) return { v, slot: -1 };
  } else if (item.w) {
    const sc = gunScore({ ...item, ammo: 1 });
    if (!guns.length) v = 10 + sc;
    else {
      const same = guns.find((g) => g.w === item.w);
      if (same) v = item.r > same.r ? 3 + item.r - same.r : 0;
      else v = guns.length >= 3 ? 0 : 2.5 + sc * 0.3;
      if (same && v) return { v, slot: b.inv.indexOf(same) };
    }
  } else if (item.c) {
    const C = CONSUMABLES[item.c];
    const have = b.inv.find((it) => it && it.c === item.c);
    if (have && have.n >= C.stack) return { v: 0, slot: -1 };
    v = item.c === 'kit' ? 3 : item.c === 'padding' ? (b.pad < 100 ? 3 : 1) : 2;
    if (have) return { v, slot: -1 };
  }
  if (v <= 0) return { v: 0, slot: -1 };
  if (free >= 0) return { v, slot: -1 };
  // backpack full: swap out the least useful thing if it's worth less
  let worst = -1, wv = 1e9;
  b.inv.forEach((it, i) => {
    let iv;
    if (it.w === 'whistle') iv = 1;
    else if (it.w) iv = guns.length <= 1 ? 99 : gunScore(it);
    else iv = it.c === 'kit' ? 2.5 : it.c === 'padding' ? 2 : 1.2;
    if (iv < wv) { wv = iv; worst = i; }
  });
  return v > wv + 0.5 ? { v, slot: worst } : { v: 0, slot: -1 };
}

// ---------- perception ----------
function canSee(match, b, q, D, t) {
  const dx = q.x - b.x, dz = q.z - b.z, d = Math.hypot(dx, dz);
  if (d > (q.bot && b.bot ? BOT_VS_BOT.sight : D.sight)) return false;
  if (q.phase === 'glide' && d > D.glideSight) return false;
  // field of view: you can sneak up on a bot from behind (but not too close)
  if (d > D.hearing && Math.abs(angDiff(b.yaw, yawTo(dx, dz))) > D.fov) return false;
  if (!lineOfSight(match.world, b.x, b.y + PLAYER.eye, b.z, q.x, q.y + 1.3, q.z)) return false;
  if (d > 12 && nav().canopyBlocks(b.x, b.y + PLAYER.eye, b.z, q.x, q.y + 1.3, q.z)) return false;
  return true;
}

function perceive(match, b, D, t) {
  const ai = b.ai;
  const cur = ai.enemy && ai.enemy.alive && ai.enemy.phase !== 'dead' ? ai.enemy : null;
  // count bots already fighting each human so they don't all gang up on one kid
  let best = null, bd = 1e9;
  const att = ai.attacker ? match.players.get(ai.attacker) : null;
  ai.attacker = null;
  if (cur && canSee(match, b, cur, D, t)) { best = cur; bd = Math.hypot(cur.x - b.x, cur.z - b.z); }
  const near = [];
  for (const q of match.players.values()) {
    if (q === b || !q.alive || q.team === b.team || (q.phase !== 'ground' && q.phase !== 'glide')) continue;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d < D.sight && d < bd - 8) near.push([d, q]);
  }
  near.sort((a, c) => a[0] - c[0]);
  let checks = 0;
  for (const [d, q] of near) {
    if (checks >= 3) break;
    if (!q.bot && q !== cur && d > 15) {
      let on = 0;
      for (const o of match.players.values()) if (o.bot && o !== b && o.alive && o.ai && o.ai.enemy === q && o.ai.vis) on++;
      if (on >= D.maxOnHuman) continue;
    }
    checks++;
    if (canSee(match, b, q, D, t)) { best = q; bd = d; break; }
  }
  // being shot: turn toward the shooter and remember roughly where they are
  if (att && att.alive && !best) {
    ai.lastSeen = { x: att.x + match.rnd.range(-4, 4), z: att.z + match.rnd.range(-4, 4), t };
    if (!cur) { ai.enemy = att; ai.vis = false; ai.seenAt = t; }
    return;
  }
  if (best) {
    if (best !== ai.enemy || !ai.vis) { ai.seenAt = t; if (best !== ai.enemy) ai.engagedAt = t; }
    ai.enemy = best; ai.vis = true;
    ai.lastSeen = { x: best.x, z: best.z, t };
  } else {
    ai.vis = false;
    if (ai.enemy && (!ai.enemy.alive || !ai.lastSeen || t - ai.lastSeen.t > 6)) ai.enemy = null;
  }
}

// ---------- movement helpers ----------
function setGoal(ai, x, z, run, kind, extra) {
  ai.goal = { x, z, run, kind, ...extra };
}

// At most a few path searches per server tick (everyone lands at once); the rest wait a tick.
function navBudget(match, t) {
  if (match._navT !== t) { match._navT = t; match._navN = 0; }
  return match._navN++ < 6;
}

// Next point to walk to on the way to ai.goal (plans/replans the nav-grid path).
function waypoint(match, b, ai, t) {
  const g = ai.goal;
  const N = nav();
  // on a roof or other spot the grid can't see (but not on a build floor we can stand on)?
  const elevated = b.y > N.floorAt(b.x, b.z) + 1.5 && N.roofed(b.x, b.z);
  let wx, wz;
  if (elevated) {
    if (!ai.roofExit || t > ai.roofExit.t) { const o = N.offRoof(b.x, b.z); ai.roofExit = o ? { x: o[0], z: o[1], t: t + 4 } : { x: g.x, z: g.z, t: t + 4 }; }
    wx = ai.roofExit.x; wz = ai.roofExit.z;
    ai.path = null;
  } else {
    const moved = !ai.pathGoal || Math.hypot(ai.pathGoal.x - g.x, ai.pathGoal.z - g.z) > 4;
    const far = Math.hypot(g.x - b.x, g.z - b.z);
    if (!ai.path || moved || t - ai.pathAt > (ai.path.complete ? 8 : 3) || ai.pathI >= ai.path.length) {
      if (far < 2) { ai.path = null; wx = g.x; wz = g.z; }
      else if ((t - ai.pathAt > 0.6 || moved) && navBudget(match, t)) {
        // long trips are planned in chunks
        let tx = g.x, tz = g.z;
        if (far > 140) { tx = b.x + (g.x - b.x) * 140 / far; tz = b.z + (g.z - b.z) * 140 / far; }
        ai.path = N.findPath(b.x, b.z, tx, tz, 3500, b.y);
        // no way found and the best we got is right here: try harder once, else give up
        if (ai.path && !ai.path.complete && Math.hypot(ai.path[ai.path.length - 1][0] - b.x, ai.path[ai.path.length - 1][1] - b.z) < 3) {
          ai.path = far < 140 ? N.findPath(b.x, b.z, tx, tz, 15000, b.y) : null;
          if (!ai.path || (!ai.path.complete && Math.hypot(ai.path[ai.path.length - 1][0] - b.x, ai.path[ai.path.length - 1][1] - b.z) < 3)) {
            if (g.id != null) ai.skip.set(g.id, t + 60);
            if (g.kind === 'wander') ai.wander = null;
            ai.path = null;
          }
        }
        ai.pathI = 0; ai.pathAt = t; ai.pathGoal = { x: g.x, z: g.z };
        if (!ai.path) { ai.path = [[g.x, g.z]]; ai.path.complete = false; }
      }
    }
    if (ai.path) {
      let w = ai.path[ai.pathI];
      while (w && Math.hypot(w[0] - b.x, w[1] - b.z) < 0.9 && ai.pathI < ai.path.length - 1) w = ai.path[++ai.pathI];
      if (!w) w = [g.x, g.z];
      wx = w[0]; wz = w[1];
    } else if (wx === undefined) { wx = g.x; wz = g.z; }
  }
  return [wx, wz];
}

function followPath(match, b, ai, t, input) {
  const g = ai.goal;
  if (!g) return false;
  const [wx, wz] = waypoint(match, b, ai, t);
  const d = Math.hypot(wx - b.x, wz - b.z);
  let want = yawTo(wx - b.x, wz - b.z);
  if (t < ai.unstickUntil) want = ai.unstickYaw;
  b.yaw = turn(b.yaw, want, 8 * input.dt);
  input.yaw = b.yaw;
  input.f = Math.abs(angDiff(b.yaw, want)) < 1.2 ? 1 : 0.3;
  if (d < 0.4 && Math.hypot(g.x - b.x, g.z - b.z) < 1.5) input.f = 0;
  input.sprint = g.run || Math.hypot(g.x - b.x, g.z - b.z) > 12;
  return true;
}

function checkStuck(match, b, ai, t) {
  const pr = ai.prog;
  if (t - pr.t < 1.0) return;
  const moved = Math.hypot(b.x - pr.x, b.z - pr.z);
  const trying = ai.goal && Math.hypot(ai.goal.x - b.x, ai.goal.z - b.z) > 1.5 && !(ai.enemy && ai.vis) && b.useUntil <= t;
  if (trying && moved < 0.5) {
    pr.fails++;
    ai.wantJump = true;
    ai.pathAt = -9; // replan
    if (pr.fails >= 2) { ai.unstickUntil = t + 0.8; ai.unstickYaw = b.yaw + (match.rnd() < 0.5 ? 1 : -1) * (1.3 + match.rnd()); }
    if (pr.fails >= 4) {
      // give up on this goal for a while
      if (ai.goal.id != null) ai.skip.set(ai.goal.id, t + 40);
      if (ai.goal.kind === 'wander') ai.wander = null;
      ai.goal = null; ai.path = null; pr.fails = 0;
      // boxed in by build pieces? knock them down
      if (match.mode === 'build') ai.smashUntil = t + 1.5;
    }
  } else if (moved > 1) pr.fails = 0;
  pr.t = t; pr.x = b.x; pr.z = b.z;
}

function findCover(match, b, from, t) {
  const N = nav();
  const base = yawTo(b.x - from.x, b.z - from.z); // away from the enemy first
  for (const r of [4, 7, 11]) {
    for (let k = 0; k < 10; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.6;
      const x = b.x - Math.sin(a) * r, z = b.z - Math.cos(a) * r;
      const c = N.cellOf(x, z);
      if (!N.free(c) || N.comp[c] !== N.main || Math.abs(N.floor[c] - b.y) > 1) continue;
      if (!N.clearLine(b.x, b.z, x, z)) continue;
      const zn = match.zone;
      if (Math.hypot(x - zn.cx, z - zn.cz) > zn.r - 4) continue;
      if (!lineOfSight(match.world, from.x, from.y + PLAYER.eye, from.z, x, N.floor[c] + 1.3, z)) return { x, z, t };
    }
  }
  return null;
}

function tryBuild(match, b, ai, enemy, t, D) {
  if (match.mode !== 'build' || b.mats < BUILD.cost || t < ai.nextBuild) return;
  ai.nextBuild = t + D.buildCooldown * (0.8 + match.rnd() * 0.5);
  const G = BUILD.grid;
  const fx = enemy.x - b.x, fz = enemy.z - b.z;
  const rot = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2);
  let gx = Math.floor(b.x / G), gz = Math.floor(b.z / G);
  const gy = Math.max(0, Math.floor((b.y + 0.2) / G));
  // our own cell's edge is too close (the wall would cut through us): use the next cell's
  const ox = rot === 1 ? 1 : rot === 3 ? -1 : 0, oz = rot === 0 ? 1 : rot === 2 ? -1 : 0;
  const edge = ox ? (ox > 0 ? (gx + 1) * G - b.x : b.x - gx * G) : (oz > 0 ? (gz + 1) * G - b.z : b.z - gz * G);
  if (edge < PLAYER.radius + 0.35) { gx += ox; gz += oz; }
  match.handle(b, { t: 'build', k: 'wall', gx, gy, gz, r: rot });
  // sometimes add a ramp behind the wall to take the high ground
  if (b.mats >= BUILD.cost && match.rnd() < D.rampChance) {
    match.handle(b, { t: 'build', k: 'ramp', gx: gx - ox, gy, gz: gz - oz, r: rot });
  }
}

// Aim a lobbed throw (speed v, extra up-speed up, gravity g) to land d metres away.
function lobPitch(d, dy, v, up, g) {
  let best = 0.3, be = 1e9;
  for (let p = -0.3; p <= 1.0; p += 0.05) {
    const vx = v * Math.cos(p), vy = v * Math.sin(p) + up;
    const disc = vy * vy - 2 * g * dy;
    if (disc < 0) continue;
    const tt = (vy + Math.sqrt(disc)) / g;
    const e = Math.abs(vx * tt - d);
    if (e < be) { be = e; best = p; }
  }
  return best;
}

// ---------- the main update ----------
export function updateBot(match, b, dt, t) {
  const ai = b.ai;
  const input = { f: 0, s: 0, yaw: b.yaw, pitch: b.pitch, jump: false, sprint: false, dt };
  if (b.phase === 'blimp') {
    if (t - match.blimp.t0 > ai.jumpAt) match.jumpOut(b);
    return;
  }
  if (b.phase === 'fall' || b.phase === 'glide') {
    const dx = ai.land.x - b.x, dz = ai.land.z - b.z;
    input.yaw = yawTo(dx, dz); b.yaw = input.yaw;
    input.f = Math.hypot(dx, dz) > 4 ? 1 : 0;
    input.pitch = -0.8;
    stepFalling(match.world, b, input, dt);
    return;
  }
  if (b.phase !== 'ground') return;
  const D = ai.D || BOT_DIFFICULTY[match.difficulty]; // ai.D: per-player override (tests, simulator)

  // ---- think (5 times a second) ----
  if (t >= ai.nextThink) {
    ai.nextThink = t + 0.2 + match.rnd() * 0.05;
    if (t >= ai.nextSight) { ai.nextSight = t + 0.35 + match.rnd() * 0.1; perceive(match, b, D, t); }
    think(match, b, ai, D, t);
    checkStuck(match, b, ai, t);
  }

  // ---- act (every tick) ----
  const enemy = ai.enemy && ai.enemy.alive ? ai.enemy : null;
  const cur = match.currentItem(b);
  const armed = cur && cur.w && cur.w !== 'tackle' && cur.w !== 'whistle';
  const dist = enemy ? Math.hypot(enemy.x - b.x, enemy.z - b.z) : 1e9;
  if (enemy && ai.vis && (ai.mode === 'fight' || ai.mode === 'cover') && (armed || dist < 5)) {
    fight(match, b, ai, D, t, enemy, cur, dist, input);
  } else if (ai.mode === 'harvest' && ai.harvest) {
    const h = ai.harvest;
    const d = Math.hypot(h.x - b.x, h.z - b.z);
    if (d > 1.6) followPath(match, b, ai, t, input);
    else {
      const want = yawTo(h.x - b.x, h.z - b.z);
      b.yaw = turn(b.yaw, want, 8 * dt); input.yaw = b.yaw; b.pitch *= 0.8;
      if (b.slot !== 0) match.handle(b, { t: 'slot', i: 0 });
      else if (t >= b.nextFire && Math.abs(angDiff(b.yaw, want)) < 0.3) match.onFire(b, { aim: dirFrom(b.yaw, -0.1), rt: t });
    }
  } else {
    if (enemy && !ai.vis && ai.lastSeen && ai.mode !== 'heal') {
      // look where they were
      b.pitch *= 0.9;
    } else b.pitch *= 0.9;
    followPath(match, b, ai, t, input);
    // something built in the way? tackle it down
    if (ai.smashUntil > t && b.slot === 0 && t >= b.nextFire) match.onFire(b, { aim: dirFrom(b.yaw, 0), rt: t });
  }
  if (ai.wantJump) { input.jump = true; ai.wantJump = false; }
  stepPlayer(match.world, b, input, dt);
}
updateBot.init = init;

function think(match, b, ai, D, t) {
  const z = match.zone;
  const enemy = ai.enemy && ai.enemy.alive ? ai.enemy : null;
  const dist = enemy ? Math.hypot(enemy.x - b.x, enemy.z - b.z) : 1e9;
  const hasGun = b.inv.some((it) => it && it.w && it.w !== 'whistle');
  const healSlot = b.inv.findIndex((it) => {
    if (!it || !it.c) return false;
    const C = CONSUMABLES[it.c];
    if (C.heal) return b.hp < C.max - 8 && b.hp < (enemy ? D.healAt : 92);
    return b.pad < Math.min(C.max - 10, enemy ? 30 : 75);
  });
  const prevMode = ai.mode;

  // --- storm first: outside (or about to be) → run ---
  const zd = Math.hypot(b.x - z.cx, b.z - z.cz);
  const tgtX = z.tx + ai.zoneOff[0] * z.tr * 0.55, tgtZ = z.tz + ai.zoneOff[1] * z.tr * 0.55;
  const toNext = Math.hypot(b.x - z.tx, b.z - z.tz) - z.tr + 6;
  let storm = false;
  if (z.r < 3000 && t >= z.t0 - 10) {
    if (zd > z.r - 6) storm = true;
    else if (z.st === 0 && toNext > 0 && z.end - t < toNext / 7 + D.rotateEarly + 12 * (1 - ai.aggro)) storm = true;
    else if (z.st === 1 && toNext > 0 && zd > z.r * 0.75) storm = true;
  }
  const outside = zd > z.r - 2;
  // storm is (nearly) on us: moving beats healing
  const urgent = storm && (outside || (z.st === 1 && zd > z.r - 12));

  // --- weapon / heal management ---
  if (healSlot >= 0 && (!enemy || !ai.vis || dist > 45) && b.useUntil <= t && !urgent && b.reloadUntil <= t) {
    ai.mode = 'heal';
    if (b.slot !== healSlot + 1) match.handle(b, { t: 'slot', i: healSlot + 1 });
    else if (!enemy || !ai.vis) match.handle(b, { t: 'fire', aim: [0, 0, -1] });
    // in sight of someone: get behind something first
    if (enemy && ai.vis) {
      if (!ai.cover || t - ai.coverAt > 1.5) { ai.cover = findCover(match, b, enemy, t); ai.coverAt = t; }
      if (ai.cover) setGoal(ai, ai.cover.x, ai.cover.z, true, 'cover');
    } else if (b.useUntil > t || b.slot === healSlot + 1) { ai.goal = null; }
    if (storm && b.useUntil <= t) setGoal(ai, tgtX, tgtZ, true, 'storm');
    return;
  }
  if (b.useUntil > t && !urgent && !(enemy && ai.vis && dist < 25)) { ai.mode = 'heal'; ai.goal = null; return; } // keep healing
  // two of the same gun? drop the weaker one (giveItem fills free slots first)
  if (!(enemy && ai.vis) && b.useUntil <= t) {
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const A = b.inv[i], B = b.inv[j];
      if (A && B && A.w && A.w === B.w && A.w !== 'whistle') {
        const worse = A.r <= B.r ? i : j;
        match.handle(b, { t: 'slot', i: worse + 1 });
        match.handle(b, { t: 'drop' });
        const dropped = match.nextId - 1;
        if (match.loot.has(dropped)) ai.skip.set(dropped, t + 120);
      }
    }
  }
  if (ai.mode !== 'harvest' || (enemy && ai.vis)) {
    const w = bestWeapon(b, enemy ? dist : 30);
    if (w > 0 && b.slot !== w && b.useUntil <= t && !(ai.smashUntil > t)) match.handle(b, { t: 'slot', i: w });
    if (ai.smashUntil > t && b.slot !== 0) match.handle(b, { t: 'slot', i: 0 });
  }
  const cur = match.currentItem(b);
  if (cur && cur.w && WEAPONS[cur.w].mag && cur.ammo < WEAPONS[cur.w].mag && (!enemy || !ai.vis || cur.ammo === 0)) match.startReload(b);

  // --- fight ---
  if (enemy && hasGun) {
    if (ai.vis) {
      ai.mode = 'fight';
      if (storm && outside) setGoal(ai, tgtX, tgtZ, true, 'storm');
      // hurt or reloading: duck behind cover
      if ((b.reloadUntil > t || b.hp < D.healAt * 0.7) && (!ai.cover || t - ai.coverAt > 2)) { ai.cover = findCover(match, b, enemy, t); ai.coverAt = t; }
      if (ai.cover && t - ai.cover.t < 3 && (b.reloadUntil > t || b.hp < D.healAt * 0.7)) { ai.mode = 'cover'; setGoal(ai, ai.cover.x, ai.cover.z, true, 'cover'); }
      // shot at in build mode: throw up a wall
      if (match.mode === 'build' && t - ai.hurtAt < 0.6 && match.rnd() < D.build) tryBuild(match, b, ai, enemy, t, D);
      return;
    }
    // lost sight: aggressive bots chase / lob a whistle, careful ones move on
    if (ai.lastSeen && t - ai.lastSeen.t < 5) {
      const nade = b.inv.findIndex((it) => it && it.w === 'whistle');
      const ld = Math.hypot(ai.lastSeen.x - b.x, ai.lastSeen.z - b.z);
      if (nade >= 0 && t >= ai.nextNade && ld > 8 && ld < 28 && match.rnd() < D.nade) {
        ai.nextNade = t + 6;
        match.handle(b, { t: 'slot', i: nade + 1 });
        const yaw = yawTo(ai.lastSeen.x - b.x, ai.lastSeen.z - b.z);
        const W = WEAPONS.whistle;
        const p = lobPitch(ld, enemy.y - b.y, W.speed, 5, W.grav);
        b.yaw = yaw; b.nextFire = 0;
        match.onFire(b, { aim: dirFrom(yaw + gauss(match.rnd) * 0.08, p), rt: t });
      }
      if (!storm && match.rnd() < ai.aggro * 0.6 + 0.2) { ai.mode = 'chase'; setGoal(ai, ai.lastSeen.x, ai.lastSeen.z, false, 'chase'); return; }
    }
  }
  if (storm) { ai.mode = 'storm'; setGoal(ai, tgtX, tgtZ, true, 'storm'); return; }
  if (enemy && !hasGun && dist < 6) { ai.mode = 'fight'; return; } // fists!

  // --- harvest turf (build mode) ---
  if (match.mode === 'build' && b.mats < D.matsWanted && hasGun && !enemy && t >= ai.nextHarvest) {
    if (!ai.harvest) {
      let best = null, bd = 25;
      for (const tr of MAP.trees) { const d = Math.abs(tr.x - b.x) + Math.abs(tr.z - b.z); if (d < bd) { bd = d; best = tr; } }
      if (best) { ai.harvest = { x: best.x, z: best.z }; ai.harvestUntil = t + 9; }
      else ai.nextHarvest = t + 10;
    }
    if (ai.harvest && t < ai.harvestUntil) { ai.mode = 'harvest'; setGoal(ai, ai.harvest.x + 1.2, ai.harvest.z, false, 'harvest'); return; }
    ai.harvest = null; ai.nextHarvest = t + 12;
  } else ai.harvest = null;

  // --- loot ---
  const radius = hasGun ? 32 : 90;
  let bestL = null, bs = -1e9, bslot = -1;
  for (const l of match.loot.values()) {
    const dx = l.x - b.x, dz = l.z - b.z;
    if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue;
    const sk = ai.skip.get(l.id);
    if (sk && sk > t) continue;
    if (l.reach === undefined) l.reach = nav().reachable(l.x, l.y, l.z);
    if (!l.reach && Math.abs(l.y - b.y) > 1.5) continue;
    const w = wantItem(match, b, l.item);
    if (w.v <= 0) continue;
    const d = Math.hypot(dx, dz) + Math.abs(l.y - b.y) * 3;
    if (d > radius) continue;
    const s = w.v * 8 - d;
    if (s > bs) { bs = s; bestL = l; bslot = w.slot; }
  }
  for (const c of match.chests) {
    if (c.open) continue;
    const d = Math.hypot(c.x - b.x, c.z - b.z) + Math.abs(c.y - b.y) * 3;
    if (d > radius) continue;
    const sk = ai.skip.get('c' + c.id);
    if (sk && sk > t) continue;
    const s = (hasGun ? 30 : 90) - d;
    if (s > bs) { bs = s; bestL = { chest: c, x: c.x, y: c.y, z: c.z, id: 'c' + c.id }; bslot = -1; }
  }
  if (bestL) {
    ai.mode = 'loot';
    setGoal(ai, bestL.x, bestL.z, !hasGun, 'loot', { id: bestL.id });
    if (Math.hypot(bestL.x - b.x, bestL.z - b.z) < REACH && Math.abs(bestL.y - b.y) < 2.3) {
      if (bestL.chest) match.handle(b, { t: 'open', id: bestL.chest.id });
      else {
        if (bslot >= 0 && b.slot !== bslot + 1) match.handle(b, { t: 'slot', i: bslot + 1 });
        const before = match.nextId;
        match.handle(b, { t: 'pickup', id: bestL.id });
        if (match.loot.has(bestL.id)) ai.skip.set(bestL.id, t + 30); // couldn't take it
        else if (match.nextId > before) ai.skip.set(match.nextId - 1, t + 120); // what we swapped out
      }
    }
    return;
  }

  // --- roam: toward the safe zone, through a named place now and then ---
  ai.mode = 'roam';
  if (!ai.wander || Math.hypot(ai.wander.x - b.x, ai.wander.z - b.z) < 4 || t > ai.wander.until) {
    const a = match.rnd() * Math.PI * 2;
    const R = z.r < 3000 ? Math.min(z.tr, z.r) : 200;
    const r = Math.sqrt(match.rnd()) * Math.max(8, R * 0.7);
    const cx = z.r < 3000 ? z.tx : b.x, cz = z.r < 3000 ? z.tz : b.z;
    ai.wander = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, until: t + 25 };
  }
  setGoal(ai, ai.wander.x, ai.wander.z, false, 'wander');
  if (prevMode !== 'roam') ai.path = null;
}

function fight(match, b, ai, D, t, enemy, cur, d, input) {
  const A = enemy.bot && b.bot ? BOT_VS_BOT : D; // aim/reaction profile for this target
  const dt = input.dt;
  const dx = enemy.x - b.x, dz = enemy.z - b.z, dy = enemy.y + 1.2 - (b.y + PLAYER.eye);
  const W = cur && cur.w ? WEAPONS[cur.w] : null;
  const wantYaw = yawTo(dx, dz);
  let wantPitch = Math.atan2(dy, d);
  if (cur && cur.w === 'pigskin') { // lead the drop of the slow cannon ball
    const tt = d / W.speed;
    wantPitch = Math.atan2(dy - 0.6 + 0.5 * W.grav * tt * tt - 1.5 * tt, d);
  }
  b.yaw = turn(b.yaw, wantYaw, D.turn * dt);
  b.pitch += (wantPitch - b.pitch) * Math.min(1, 7 * dt);
  input.yaw = b.yaw;
  if (t > ai.strafeUntil) {
    ai.strafe = match.rnd() < 0.5 ? -1 : 1;
    ai.strafeUntil = t + 0.5 + match.rnd() * 1.3;
    if (match.rnd() < D.jumpy) ai.wantJump = true;
    if (match.rnd() < 0.2) ai.strafe = 0;
  }
  input.s = ai.strafe;
  const ideal = (IDEAL[cur && cur.w] || 18) * (1.25 - ai.aggro * 0.5);
  if (ai.mode === 'cover' || (ai.goal && ai.goal.kind === 'storm')) {
    // keep shooting while moving to cover / out of the storm
    const g = ai.goal;
    if (g) {
      const [wx, wz] = waypoint(match, b, ai, t);
      const mx = wx - b.x, mz = wz - b.z, L = Math.hypot(mx, mz);
      if (L > 0.8) {
        const sin = Math.sin(b.yaw), cos = Math.cos(b.yaw);
        input.f = (-sin * mx - cos * mz) / L; input.s = (cos * mx - sin * mz) / L;
      }
    }
  } else input.f = d > ideal + 6 ? 1 : d < ideal - 5 ? -1 : 0;
  if (cur && cur.w && W && W.mag && cur.ammo <= 0) { match.startReload(b); return; }
  if (!W) return;
  // burst / pause rhythm (Easy bots pause a lot, which gives kids time to fight back)
  if (t > ai.burstUntil && t > ai.pauseUntil) {
    ai.pauseUntil = t + A.burst[1] * (0.6 + match.rnd() * 0.8);
    ai.burstUntil = ai.pauseUntil + A.burst[0] * (0.6 + match.rnd() * 0.8);
  }
  if (t < ai.pauseUntil) return;
  const aligned = Math.abs(angDiff(b.yaw, wantYaw)) < 0.2;
  if (!aligned || t - ai.seenAt < A.react || t < b.nextFire) return;
  if (W.kind === 'melee' && d > 2.4) return;
  if (W.range && d > W.range * 0.95) return;
  // aim gets better the longer the bot has been fighting this target
  const warm = 1 + 1.3 * Math.max(0, 1 - (t - ai.engagedAt) / A.warmup);
  const h = enemy.hist, hl = h.length;
  const moving = hl >= 2 && Math.hypot(h[hl - 1].x - h[hl - 2].x, h[hl - 1].z - h[hl - 2].z) > 0.1 ? 1.25 : 1;
  const e = A.aimError * (1 + d / 50) * warm * moving * (enemy.phase === 'ground' ? 1 : 1.8);
  const aim = dirFrom(wantYaw + gauss(match.rnd) * e, wantPitch + gauss(match.rnd) * e);
  const dirs = [];
  const pel = W.pellets || 1;
  const ay = Math.atan2(-aim[0], -aim[2]), ap = Math.asin(Math.max(-1, Math.min(1, aim[1])));
  for (let i = 0; i < pel; i++) {
    const s = W.spread || 0;
    const a = match.rnd() * Math.PI * 2, r = Math.sqrt(match.rnd()) * s;
    dirs.push(dirFrom(ay + Math.cos(a) * r, ap + Math.sin(a) * r));
  }
  ai.rateMul = A.fireMul;
  match.onFire(b, { aim, dirs, rt: t });
}

function turn(a, b, max) {
  const d = angDiff(a, b);
  return a + Math.max(-max, Math.min(max, d));
}
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function dirFrom(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
function gauss(rnd) { return (rnd() + rnd() + rnd() - 1.5) * 1.15; }
