// Regression tests for match rules found by the headless simulator, bot AI and pacing.
import { test } from 'node:test';
import assert from 'node:assert';
import { Match, setClock, MAP } from '../server/match.js';
import { updateBot, nav } from '../server/bots.js';
import { stepPlayer, supportHeight } from '../shared/physics.js';
import { WEAPONS } from '../shared/weapons.js';
import { ZONE_PHASES } from '../shared/constants.js';
import { runMatch } from '../tools/sim.js';

let T = 5000;
const tick = (m, n = 1) => { for (let i = 0; i < n; i++) { T += 0.05; m.simulate(T); } };
const fakeWs = () => ({ readyState: 1, send() {} });
function setup(opts = {}) {
  setClock(() => T);
  const m = new Match({ code: 'BOTS', mode: 'build', ...opts });
  clearInterval(m.timer);
  const a = m.addHuman(fakeWs(), 'A', null, 0);
  m.start();
  for (const p of m.players.values()) Object.assign(p, { phase: 'ground', x: -480, y: 0, z: -480, onGround: true, alive: true });
  Object.assign(a, { x: 300, z: 150 });
  return { m, a };
}
const done = (m) => { m.close(); setClock(null); };

test('reload finishes even if reload is pressed every tick', () => {
  const { m, a } = setup();
  a.inv[0] = { w: 'rifle', r: 0, ammo: 0 }; a.slot = 1;
  for (let i = 0; i < 80; i++) { m.handle(a, { t: 'reload' }); tick(m); }
  assert.equal(a.inv[0].ammo, WEAPONS.rifle.mag);
  done(m);
});

test('a heal finishes even if fire is pressed every tick', () => {
  const { m, a } = setup();
  a.hp = 40; a.inv[0] = { c: 'tape', n: 3 }; a.slot = 1;
  for (let i = 0; i < 60; i++) { m.handle(a, { t: 'fire', aim: [0, 0, -1] }); tick(m); }
  assert.ok(a.hp >= 55, `healed, hp=${a.hp}`);
  assert.ok(a.inv[0].n <= 2, 'tape used up');
  done(m);
});

test('a bot holding two empty guns reloads and shoots instead of swapping forever', () => {
  const { m, a } = setup();
  const bot = [...m.players.values()].find((p) => p.bot);
  Object.assign(bot, { x: 300, z: 162, yaw: 0, inv: [{ w: 'rifle', r: 0, ammo: 0 }, { w: 'smg', r: 0, ammo: 0 }, null, null, null], slot: 1 });
  bot.ai.enemy = a; bot.ai.vis = true; bot.ai.seenAt = T - 5; bot.ai.engagedAt = T - 5; bot.ai.nextSight = T + 100;
  const hp0 = a.hp;
  let fired = 0;
  const orig = m.onFire.bind(m);
  m.onFire = (p, msg) => { if (p === bot) fired++; return orig(p, msg); };
  for (let i = 0; i < 200; i++) { bot.ai.nextSight = T + 100; bot.ai.vis = true; updateBot(m, bot, 0.05, T); tick(m); }
  assert.ok(fired > 3, `bot fired ${fired} times`);
  assert.ok(a.hp < hp0 || fired > 10, 'bot actually got shots off');
  done(m);
});

test('cannot wall another player in; you can step out of your own wall', () => {
  const { m, a } = setup();
  const b = [...m.players.values()].find((p) => p.bot);
  Object.assign(b, { x: 302, z: 151.9 });
  a.mats = 100;
  m.handle(a, { t: 'build', k: 'wall', gx: 75, gy: 0, gz: 37, r: 0 }); // edge at z=152, right through b
  assert.equal(m.pieces.size, 0, 'wall through another player refused');
  Object.assign(b, { x: -480, z: -480 });
  Object.assign(a, { x: 302, z: 151.9 });
  m.handle(a, { t: 'build', k: 'wall', gx: 75, gy: 0, gz: 37, r: 0 });
  assert.equal(m.pieces.size, 1, 'own wall allowed');
  const p = { x: 302, y: 0, z: 151.9, vx: 0, vy: 0, vz: 0, onGround: true };
  for (let i = 0; i < 60; i++) stepPlayer(m.world, p, { f: 1, s: 0, yaw: 0, jump: false }, 1 / 60); // walk -z, out
  assert.ok(p.z < 151, `walked out of the wall, z=${p.z.toFixed(2)}`);
  done(m);
});

test('loot from someone hit mid-air lands on the ground, never inside walls', () => {
  const { m, a } = setup();
  Object.assign(a, { x: 300, y: 40, z: 150, phase: 'glide' });
  a.inv = [{ w: 'smg', r: 1, ammo: 30 }, { c: 'tape', n: 2 }, null, null, null];
  m.kill(a, null, 'storm', false);
  const drops = [...m.loot.values()].filter((l) => Math.hypot(l.x - 300, l.z - 150) < 3);
  assert.equal(drops.length, 2);
  for (const l of drops) assert.equal(l.y, supportHeight(m.world, l.x, 1, l.z));
  // a chest right next to a house wall: nothing ends up inside the wall
  for (const c of MAP.chests) {
    for (let i = 0; i < 6; i++) {
      const l = m.dropLoot({ c: 'tape', n: 1 }, c.x + Math.cos(i) * 1.2, c.y, c.z + Math.sin(i) * 1.2, c.x, c.z);
      assert.ok(!m.insideSolid(l.x, l.y, l.z), `loot inside solid near chest ${c.x},${c.z}`);
    }
  }
  done(m);
});

test('the storm does not eliminate the winner after the win', () => {
  const { m, a } = setup({ mode: 'nobuild' });
  const bots = [...m.players.values()].filter((p) => p.bot);
  for (const b of bots.slice(1)) m.kill(b, null, 'storm', false);
  const last = bots[0];
  // both in the storm with 1 hp: the bot dies first, a wins and must stay alive
  Object.assign(m.zone, { cx: 0, cz: 0, r: 1, t0: 0 });
  a.hp = 1; last.hp = 1;
  m.players.delete(last.id); m.players.set(last.id, last); // bot after the human in the loop
  m.players.delete(a.id); m.players.set(a.id, a);
  m.lastStormSec = -1;
  tick(m, 25);
  assert.equal(m.state, 'ended');
  assert.ok(m.final.winner === a.id || m.final.winner === last.id);
  const w = m.players.get(m.final.winner);
  assert.ok(w.alive, 'winner still standing');
  done(m);
});

test('Party Island: leaving does not leave party gear behind', () => {
  setClock(() => T);
  const m = new Match({ code: 'ISLE', kind: 'island' });
  clearInterval(m.timer);
  const a = m.addHuman(fakeWs(), 'A'); m.addHuman(fakeWs(), 'B'); m.start();
  m.removeHuman(a);
  assert.equal(m.loot.size, 0);
  done(m);
});

test('nav grid: every equipment bag is reachable and doors work', () => {
  const N = nav();
  for (const c of MAP.chests) assert.ok(N.reachable(c.x, c.y, c.z), `chest at ${c.x},${c.y},${c.z}`);
  // from outside a closed side of a house to its middle: path must go round to the door
  const p = N.findPath(-270, -215, -290, -232, 5000);
  assert.ok(p && p.complete, 'path into house');
  assert.ok(p.length >= 3, 'goes around to the door');
});

test('storm closes completely in about 11-12 minutes', () => {
  const total = 25 + ZONE_PHASES.reduce((s, p) => s + p.wait + p.shrink, 0);
  assert.ok(total > 600 && total < 760, `storm takes ${total}s`);
  assert.equal(ZONE_PHASES[ZONE_PHASES.length - 1].radius, 0);
});

test('a full fast-forward match ends with a winner and no rule violations', { timeout: 60000 }, () => {
  for (const mode of ['nobuild', 'build']) {
    const r = runMatch({ mode, difficulty: 'normal', humans: 2, leaveAt: 120, maxMin: 15 });
    assert.ok(r.ended && r.winner, `${mode} match ended (${r.length && (r.length / 60).toFixed(1)} min)`);
    assert.ok(r.length > 240 && r.length < 760, `${mode} length ${(r.length / 60).toFixed(1)} min`);
    assert.deepEqual(r.issues, [], r.issues.join('\n'));
    assert.ok(r.stuckPct < 5, `stuck bots ${r.stuckPct.toFixed(1)}%`);
    if (mode === 'build') assert.ok(r.counts.bot_built > 0, 'bots build walls/ramps in build mode');
  }
  setClock(null);
});
