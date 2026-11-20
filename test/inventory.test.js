// Backpack rules: 5 item slots for everyone, an unlimited (capped) backpack and the 👑 armory
// for admins, but only in the match kinds listed in ADMIN_POWER_MATCHES.
import { test } from 'node:test';
import assert from 'node:assert';
import { Match, INV_SLOTS, ADMIN_MAX_SLOTS, ADMIN_POWER_MATCHES } from '../server/match.js';
import { GUN_IDS } from '../shared/weapons.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); } });
const ADMIN = { username: 'LONGHORNS 1', isAdmin: true, owned: [], stats: {} };
const KID = { username: 'KID', isAdmin: false, owned: [], stats: {} };
const GUNS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'pigskin'];

function setup(opts = {}) {
  const m = new Match({ code: 'INV', mode: 'nobuild', isPublic: false, ...opts });
  const a = m.addHuman(fakeWs(), 'LONGHORNS 1', null, 0, ADMIN);
  const k = m.addHuman(fakeWs(), 'KID', null, 0, KID);
  m.start();
  for (const [p, x] of [[a, 300], [k, 304]]) Object.assign(p, { phase: 'ground', x, y: 0, z: 150, onGround: true });
  return { m, a, k };
}
// put loot right at the player's feet and pick it up the normal way
function pickUp(m, p, item) {
  const l = m.addLoot(item, p.x, p.y, p.z);
  m.handle(p, { t: 'pickup', id: l.id });
  return !m.loot.has(l.id);
}
const gun = (i) => ({ w: GUNS[i % GUNS.length], r: i % 5, ammo: 1 });

test('Quick Play is not an admin-power match (one-line constant)', () => {
  assert.deepEqual([...ADMIN_POWER_MATCHES].sort(), ['island', 'partyRoyale', 'private']);
  const { m, a } = setup({ isPublic: true });
  assert.equal(m.category, 'quickPlay');
  assert.equal(m.adminPowers(a), false);
  m.close();
});

test('admin in a Private Room picks up 12 guns and keeps them all', () => {
  const { m, a } = setup();
  assert.equal(m.category, 'private');
  m.loot.clear();
  for (let i = 0; i < 12; i++) assert.ok(pickUp(m, a, gun(i)), `picked up gun ${i}`);
  assert.equal(a.inv.length, 12);
  assert.equal(a.inv.filter(Boolean).length, 12);
  assert.equal(m.loot.size, 0, 'nothing was swapped out onto the floor');
  m.close();
});

test('normal player is still limited to 5 slots (swaps the held item)', () => {
  const { m, k } = setup();
  for (let i = 0; i < 5; i++) assert.ok(pickUp(m, k, gun(i)));
  assert.equal(k.inv.length, INV_SLOTS);
  k.slot = 0; // holding Tackle: backpack full, nothing picked up
  assert.equal(pickUp(m, k, gun(5)), false);
  k.slot = 2; // holding an item: swap it
  const before = k.inv[1];
  assert.ok(pickUp(m, k, gun(6)));
  assert.equal(k.inv.length, INV_SLOTS);
  assert.ok([...m.loot.values()].some((l) => l.item === before), 'old item dropped on the floor');
  m.handle(k, { t: 'slot', i: 6 });
  assert.equal(k.slot, 2, 'slot 6+ is refused with 5 items');
  m.close();
});

test('admin in public Quick Play is limited like everyone', () => {
  const { m, a } = setup({ isPublic: true });
  for (let i = 0; i < 6; i++) pickUp(m, a, gun(i));
  assert.equal(a.inv.length, INV_SLOTS);
  m.close();
});

test('slot selection beyond 6 works and reaches the right item', () => {
  const { m, a } = setup();
  for (let i = 0; i < 12; i++) pickUp(m, a, gun(i));
  m.handle(a, { t: 'slot', i: 12 });
  assert.equal(a.slot, 12);
  assert.equal(m.currentItem(a), a.inv[11]);
  m.handle(a, { t: 'slot', i: 13 });
  assert.equal(a.slot, 12, 'no slot past the end');
  // fire the 9th gun
  m.handle(a, { t: 'slot', i: 9 });
  const it = a.inv[8];
  it.ammo = 5;
  m.handle(a, { t: 'fire', aim: [0, 0, -1] });
  assert.ok(it.ammo < 5 || it.w === 'pigskin', 'held gun fired');
  // dropping the last item and switching away shrinks the backpack again (never below 5)
  m.handle(a, { t: 'slot', i: 12 });
  m.handle(a, { t: 'drop' });
  assert.equal(a.inv[11], null);
  m.handle(a, { t: 'slot', i: 1 });
  assert.equal(a.inv.length, 11);
  m.close();
});

test('death drops every item of a big backpack', () => {
  const { m, a, k } = setup();
  for (let i = 0; i < 12; i++) pickUp(m, a, gun(i));
  m.handle(a, { t: 'slot', i: 12 });
  m.loot.clear();
  m.kill(a, k, 'rifle', false);
  assert.equal(m.loot.size, 12);
  assert.equal(a.inv.length, INV_SLOTS);
  assert.ok(a.inv.every((s) => s === null));
  assert.equal(a.slot, 0);
  m.close();
});

test('armory: gives any weapon/rarity to admins in Private Rooms and parties', () => {
  const { m, a } = setup();
  for (let i = 0; i < 15; i++) {
    const r = m.armory(a, { give: GUN_IDS[i % GUN_IDS.length], r: i % 5 });
    assert.ok(r.ok, r.msg);
  }
  // 15 gifts; whistle grenades stack into one slot (6 per stack)
  assert.ok(a.inv.filter(Boolean).length >= 13, `kept ${a.inv.filter(Boolean).length}`);
  const sn = a.inv.find((it) => it && it.w === 'sniper');
  assert.ok(sn.r >= 2, 'sniper starts at Rare');
  assert.equal(m.armory(a, { give: 'tackle', r: 0 }).ok, false);
  assert.equal(m.armory(a, { give: 'nuke', r: 0 }).ok, false);
  a.hp = 20; a.pad = 0; a.inv[0].ammo = 0;
  assert.ok(m.armory(a, { refill: true }).ok);
  assert.deepEqual([a.hp, a.pad], [100, 100]);
  assert.ok(a.inv[0].ammo > 0);
  const n = a.inv.length;
  assert.ok(m.armory(a, { everything: true }).ok);
  assert.ok(a.inv.length > n);
  m.close();
  for (const kind of ['island', 'partyRoyale']) {
    const p = setup({ kind, isPublic: true });
    assert.ok(p.m.armory(p.a, { give: 'rifle', r: 4 }).ok, kind);
    p.m.close();
  }
});

test('armory refuses in Quick Play, for non-admins, in the air and when dead', () => {
  const q = setup({ isPublic: true });
  const r = q.m.armory(q.a, { give: 'rifle', r: 4 });
  assert.equal(r.ok, false);
  assert.match(r.msg, /Private Rooms and Party Island/);
  q.m.close();
  const { m, a, k } = setup();
  assert.equal(m.armory(k, { give: 'rifle', r: 4 }).ok, false);
  assert.equal(m.armory(k, { refill: true }).ok, false);
  a.phase = 'glide';
  assert.equal(m.armory(a, { give: 'rifle', r: 4 }).ok, false);
  a.phase = 'ground';
  m.kill(a, k, 'rifle', false);
  assert.equal(m.armory(a, { give: 'rifle', r: 4 }).ok, false);
  m.close();
});

test('armory is capped at ADMIN_MAX_SLOTS', () => {
  const { m, a } = setup();
  let ok = 0;
  for (let i = 0; i < ADMIN_MAX_SLOTS + 5; i++) if (m.armory(a, { give: 'rifle', r: 1 }).ok) ok++;
  assert.equal(ok, ADMIN_MAX_SLOTS);
  assert.equal(a.inv.length, ADMIN_MAX_SLOTS);
  assert.equal(pickUp(m, a, gun(1)), false, 'full: holding Tackle, nothing picked up');
  m.close();
});

test('bots keep 5 slots even in a Private Room', () => {
  const { m } = setup();
  for (const b of m.players.values()) if (b.bot) assert.equal(b.inv.length, INV_SLOTS);
  m.close();
});
