// Fast rule checks run straight against the Match class.
import { test } from 'node:test';
import assert from 'node:assert';
import { Match } from '../server/match.js';
import { stepPlayer } from '../shared/physics.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); } });
function setup(opts = {}) {
  const m = new Match({ code: 'TEST', mode: 'build', ...opts });
  const a = m.addHuman(fakeWs(), 'A', null, 7);
  const b = m.addHuman(fakeWs(), 'B', null, 7);
  const c = m.addHuman(fakeWs(), 'C', null, 0);
  m.start();
  for (const [p, x] of [[a, 300], [b, 302], [c, 304]]) { Object.assign(p, { phase: 'ground', x, y: 0, z: 150, onGround: true }); }
  return { m, a, b, c };
}

test('building a wall uses Turf and blocks movement', () => {
  const { m, a } = setup();
  a.mats = 30;
  m.handle(a, { t: 'build', k: 'wall', gx: 75, gy: 0, gz: 37, r: 0 }); // wall on z=152 edge
  assert.equal(m.pieces.size, 1);
  assert.equal(a.mats, 20);
  m.handle(a, { t: 'build', k: 'wall', gx: 75, gy: 0, gz: 38, r: 2 }); // same edge from the other side
  assert.equal(m.pieces.size, 1, 'no duplicate wall on the same edge');
  const p = { x: 302, y: 0, z: 150, vx: 0, vy: 0, vz: 0, onGround: true };
  for (let i = 0; i < 120; i++) stepPlayer(m.world, p, { f: -1, s: 0, yaw: 0, jump: false }, 1 / 60); // walk +z
  assert.ok(p.z < 152, `stopped by wall, z=${p.z.toFixed(2)}`);
  m.close();
});

test('ramps can be walked up', () => {
  const { m, a } = setup();
  a.mats = 30;
  m.handle(a, { t: 'build', k: 'ramp', gx: 75, gy: 0, gz: 38, r: 0 }); // rises toward +z
  const p = { x: 302, y: 0, z: 150, vx: 0, vy: 0, vz: 0, onGround: true };
  let top = 0;
  for (let i = 0; i < 180; i++) { stepPlayer(m.world, p, { f: -1, s: 0, yaw: 0, jump: false }, 1 / 60); top = Math.max(top, p.y); }
  assert.ok(top > 3, `climbed ramp, top=${top.toFixed(2)}`);
  m.close();
});

test('squad mates cannot hurt each other, enemies can', () => {
  const { m, a, b, c } = setup();
  m.damage(b, 50, a, 'rifle', false);
  assert.equal(b.hp, 100);
  m.damage(c, 50, a, 'rifle', false);
  assert.equal(c.hp, 50);
  m.close();
});

test('padding absorbs damage first, tape heals up to 75', () => {
  const { m, a, c } = setup();
  c.pad = 30;
  m.damage(c, 50, a, 'rifle', false);
  assert.deepEqual([c.pad, c.hp], [0, 80]);
  c.hp = 40; c.inv[0] = { c: 'tape', n: 2 }; c.slot = 1;
  m.handle(c, { t: 'fire', aim: [0, 0, -1] });
  c.useUntil = performance.now() / 1000 - 0.01;
  m.simulate(performance.now() / 1000);
  assert.equal(c.hp, 55);
  assert.equal(c.inv[0].n, 1);
  m.close();
});

test('Party Island: no damage, everyone on the field with party gear', () => {
  const m = new Match({ code: 'ISLE', kind: 'island' });
  const a = m.addHuman(fakeWs(), 'A'); m.start();
  const late = m.addHuman(fakeWs(), 'Late');
  assert.equal(m.players.size, 2, 'no bots on Party Island');
  assert.equal(late.phase, 'ground');
  assert.ok(Math.abs(late.x) <= 40 && Math.abs(late.z) <= 20);
  assert.equal(late.inv[0].w, 'pigskin');
  m.damage(late, 500, a, 'pigskin', false);
  assert.equal(late.hp, 100);
  assert.ok(m.canJoin(), 'island stays open');
  m.close();
});

test('last team standing wins', () => {
  const { m, a, b, c } = setup();
  for (const p of m.players.values()) if (p.bot) m.kill(p, null, 'storm', false);
  assert.equal(m.state, 'play');
  m.kill(c, a, 'rifle', false);
  assert.equal(m.state, 'ended');
  assert.equal(a.place, 1); assert.equal(b.place, 1);
  m.close();
});
