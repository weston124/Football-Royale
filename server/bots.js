// Computer players that fill empty spots in a match.
import { stepPlayer, stepFalling, lineOfSight } from '../shared/physics.js';
import { WEAPONS, CONSUMABLES } from '../shared/weapons.js';
import { PLAYER, BOT_DIFFICULTY, MAP_HALF, PICKUP_RANGE } from '../shared/constants.js';
import { MAP } from './match.js';

export const BOT_NAMES = [
  'BlitzBot', 'Sir Tackles', 'QB Quinn', 'Hut Hut', 'Fumble Fox', 'Endzone Ed', 'Punt Pete', 'Linebacker Lou',
  'Safety Sam', 'Huddle Hank', 'Snap Sally', 'Kickoff Kai', 'Gridiron Gus', 'Turf Toby', 'Wideout Wes', 'Rookie Rae',
  'Coach Bot', 'Spiral Sue', 'Hike Mike', 'Sideline Sid', 'Fourth Down Fay', 'Sack Jack', 'Pylon Paz', 'Two Point Tim',
  'Halftime Hal', 'Blocker Bo', 'Scramble Sky', 'Hail Mary Mo', 'Onside Ollie', 'Field Goal Flo', 'Chain Gang Cy',
  'Red Zone Rex', 'Audible Abe', 'Blindside Bree', 'Draw Play Dee', 'Flea Flicker', 'Juke Jo', 'Overtime Otis',
];

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

function init(match, b) {
  const rnd = match.rnd;
  const poi = rnd() < 0.85 ? rnd.pick(MAP.pois) : null;
  const tx = poi ? poi.x + rnd.range(-poi.r, poi.r) * 0.7 : rnd.range(-MAP_HALF + 50, MAP_HALF - 50);
  const tz = poi ? poi.z + rnd.range(-poi.r, poi.r) * 0.7 : rnd.range(-MAP_HALF + 50, MAP_HALF - 50);
  b.ai = {
    land: { x: tx, z: tz }, jumpAt: 0, target: null, enemy: null, seenAt: 0,
    nextThink: 0, nextSight: 0, strafe: 1, strafeUntil: 0, stuckCheck: { t: 0, x: 0, z: 0 }, unstickUntil: 0,
    unstickYaw: 0, attacker: null, wantJump: false,
  };
  // Pick when to jump: closest blimp point to the landing target, plus noise
  const bl = match.blimp;
  const along = (tx - bl.x0) * bl.dx + (tz - bl.z0) * bl.dz;
  b.ai.jumpAt = Math.max(2.5, Math.min(bl.len / 38 - 1, along / 38 + rnd.range(-3, 3)));
}

function bestWeapon(b, dist) {
  let best = -1, score = -1;
  b.inv.forEach((it, i) => {
    if (!it || !it.w || it.w === 'whistle') return;
    const W = WEAPONS[it.w];
    let s = 1 + it.r * 0.3;
    if (it.w === 'shotgun') s += dist < 12 ? 3 : dist > 25 ? -1 : 0;
    if (it.w === 'sniper') s += dist > 60 ? 3 : dist < 20 ? -2 : 0;
    if (it.w === 'rifle') s += 1.5;
    if (it.w === 'smg') s += dist < 30 ? 1.5 : 0;
    if (it.w === 'pigskin') s += dist > 10 && dist < 50 ? 1 : -2;
    if (it.ammo <= 0 && W.mag) s -= 0.5;
    if (s > score) { score = s; best = i + 1; }
  });
  return best;
}

export function updateBot(match, b, dt, t) {
  const ai = b.ai;
  const input = { f: 0, s: 0, yaw: b.yaw, pitch: b.pitch, jump: false, sprint: false };
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
  const diff = BOT_DIFFICULTY[match.difficulty];

  // ---- think (5 times a second) ----
  if (t >= ai.nextThink) {
    ai.nextThink = t + 0.2 + match.rnd() * 0.05;
    // look for enemies
    if (t >= ai.nextSight) {
      ai.nextSight = t + 0.5;
      let best = null, bd = diff.sight;
      const att = ai.attacker ? match.players.get(ai.attacker) : null;
      if (att && att.alive && att.phase !== 'blimp') { best = att; bd = Math.hypot(att.x - b.x, att.z - b.z); }
      const near = [];
      for (const q of match.players.values()) {
        if (q === b || !q.alive || q.phase === 'blimp' || q.phase === 'fall') continue;
        const d = Math.hypot(q.x - b.x, q.z - b.z);
        if (d < bd) near.push([d, q]);
      }
      near.sort((a, c) => a[0] - c[0]);
      for (const [d, q] of near.slice(0, 3)) {
        if (q === best) break;
        if (lineOfSight(match.world, b.x, b.y + PLAYER.eye, b.z, q.x, q.y + 1.3, q.z)) { best = q; bd = d; break; }
      }
      if (best && best !== ai.enemy) ai.seenAt = t;
      ai.enemy = best;
      ai.attacker = null;
    }
    // pick a weapon / heal / loot
    const enemy = ai.enemy && ai.enemy.alive ? ai.enemy : null;
    const dist = enemy ? Math.hypot(enemy.x - b.x, enemy.z - b.z) : 50;
    if (!enemy) {
      const healSlot = b.inv.findIndex((it) => it && it.c && ((CONSUMABLES[it.c].heal && b.hp < CONSUMABLES[it.c].max - 10) || (it.c === 'padding' && b.pad < 50)));
      if (healSlot >= 0 && b.useUntil <= t) {
        if (b.slot !== healSlot + 1) match.handle(b, { t: 'slot', i: healSlot + 1 });
        else match.handle(b, { t: 'fire', aim: [0, 0, -1] });
      } else {
        const w = bestWeapon(b, dist);
        if (w > 0 && b.slot !== w && b.useUntil <= t) match.handle(b, { t: 'slot', i: w });
        const cur = match.currentItem(b);
        if (cur && cur.w && WEAPONS[cur.w].mag && cur.ammo < WEAPONS[cur.w].mag) match.startReload(b);
      }
    } else {
      const w = bestWeapon(b, dist);
      if (w > 0 && b.slot !== w) match.handle(b, { t: 'slot', i: w });
    }
    // where to go
    const z = match.zone;
    const zdist = Math.hypot(b.x - z.cx, b.z - z.cz);
    const hasGun = b.inv.some((it) => it && it.w);
    ai.target = null;
    if (zdist > z.r - 8 || (z.st === 0 && t > z.end - 20 && Math.hypot(b.x - z.tx, b.z - z.tz) > z.tr - 5)) {
      ai.target = { x: z.st === 0 && t > z.end - 20 ? z.tx : z.cx, z: z.st === 0 && t > z.end - 20 ? z.tz : z.cz, run: true };
    } else if (!enemy || !hasGun) {
      // nearest loot or chest
      let bestL = null, bdL = hasGun ? 35 : 90;
      for (const l of match.loot.values()) {
        if (l.item.mats && match.mode !== 'build') continue;
        const d = Math.hypot(l.x - b.x, l.z - b.z) + Math.abs(l.y - b.y) * 3;
        if (d < bdL) { bdL = d; bestL = l; }
      }
      for (const c of match.chests) {
        if (c.open) continue;
        const d = Math.hypot(c.x - b.x, c.z - b.z) + Math.abs(c.y - b.y) * 3 - 8;
        if (d < bdL) { bdL = d; bestL = { chest: c, x: c.x, z: c.z, y: c.y }; }
      }
      if (bestL) {
        ai.target = { x: bestL.x, z: bestL.z };
        if (Math.hypot(bestL.x - b.x, bestL.z - b.z) < PICKUP_RANGE - 0.3) {
          if (bestL.chest) match.handle(b, { t: 'open', id: bestL.chest.id });
          else match.handle(b, { t: 'pickup', id: bestL.id });
        }
      } else if (!ai.wander || Math.hypot(ai.wander.x - b.x, ai.wander.z - b.z) < 4 || t > ai.wander.until) {
        const a = match.rnd() * Math.PI * 2, r = Math.sqrt(match.rnd()) * Math.max(10, z.r * 0.6);
        ai.wander = { x: z.cx + Math.cos(a) * r, z: z.cz + Math.sin(a) * r, until: t + 25 };
      }
      if (!ai.target && ai.wander) ai.target = ai.wander;
    }
    // stuck?
    if (t - ai.stuckCheck.t > 1.2) {
      const moved = Math.hypot(b.x - ai.stuckCheck.x, b.z - ai.stuckCheck.z);
      if (ai.target && moved < 0.6 && !ai.enemy) {
        ai.unstickUntil = t + 1.0;
        ai.unstickYaw = b.yaw + (match.rnd() < 0.5 ? 1 : -1) * (1.2 + match.rnd());
        ai.wantJump = true;
        if (match.rnd() < 0.3) ai.wander = null;
      }
      ai.stuckCheck = { t, x: b.x, z: b.z };
    }
  }

  // ---- act (every tick) ----
  const enemy = ai.enemy && ai.enemy.alive ? ai.enemy : null;
  const cur = match.currentItem(b);
  const armed = cur && cur.w && cur.w !== 'tackle';
  if (enemy && (armed || Math.hypot(enemy.x - b.x, enemy.z - b.z) < 5)) {
    const dx = enemy.x - b.x, dz = enemy.z - b.z, dy = enemy.y + 1.2 - (b.y + PLAYER.eye);
    const d = Math.hypot(dx, dz);
    const wantYaw = yawTo(dx, dz), wantPitch = Math.atan2(dy, d);
    b.yaw = turn(b.yaw, wantYaw, 7 * dt);
    b.pitch += (wantPitch - b.pitch) * Math.min(1, 7 * dt);
    input.yaw = b.yaw;
    if (t > ai.strafeUntil) { ai.strafe = match.rnd() < 0.5 ? -1 : 1; ai.strafeUntil = t + 0.6 + match.rnd() * 1.2; }
    input.s = ai.strafe;
    const W = cur && WEAPONS[cur.w];
    const ideal = !W ? 2 : cur.w === 'shotgun' ? 6 : cur.w === 'sniper' ? 60 : cur.w === 'tackle' ? 1.5 : 22;
    input.f = d > ideal + 6 ? 1 : d < ideal - 4 ? -1 : 0;
    if (cur && cur.w && W.mag && cur.ammo <= 0) match.startReload(b);
    const aligned = Math.abs(angDiff(b.yaw, wantYaw)) < 0.25;
    if (aligned && t - ai.seenAt > diff.react && t >= b.nextFire && (W && (W.kind === 'melee' ? d < 2.6 : true))) {
      const e = diff.aimError * (1 + d / 60) * (enemy.phase === 'ground' ? 1 : 1.6);
      const aim = dirFrom(wantYaw + gauss(match.rnd) * e, wantPitch + gauss(match.rnd) * e);
      const dirs = [];
      const pel = (W && W.pellets) || 1;
      for (let i = 0; i < pel; i++) {
        const s = W && W.spread ? W.spread : 0;
        dirs.push(dirFrom(wantYaw + gauss(match.rnd) * e + (match.rnd() - 0.5) * 2 * s, wantPitch + gauss(match.rnd) * e + (match.rnd() - 0.5) * 2 * s));
      }
      match.onFire(b, { aim, dirs, rt: t });
    }
  } else if (ai.target) {
    const dx = ai.target.x - b.x, dz = ai.target.z - b.z;
    const d = Math.hypot(dx, dz);
    let want = yawTo(dx, dz);
    if (t < ai.unstickUntil) want = ai.unstickYaw;
    b.yaw = turn(b.yaw, want, 5 * dt);
    b.pitch *= 0.9;
    input.yaw = b.yaw;
    input.f = d > 1.2 ? 1 : 0;
    input.sprint = d > 15 || ai.target.run;
  }
  if (ai.wantJump) { input.jump = true; ai.wantJump = false; }
  stepPlayer(match.world, b, input, dt);
}
updateBot.init = init;

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
