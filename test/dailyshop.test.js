// ⭐ Daily Item Shop: seeded daily rotation, only today's items can be bought, admin "feature".
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccounts } from '../server/accounts.js';
import { SHOP, DAILY_POOL, SKIN_PRESETS, EMOTES, sanitizeSkin, canUseSkin, canUseEmote } from '../shared/skins.js';
import { dailyShop, dailyIds, utcDateKey, nextResetAt, DAILY } from '../shared/shop.js';

const days = (n, from = '2026-11-20') => Array.from({ length: n }, (_, i) => utcDateKey(Date.parse(from) + i * 86400_000));

test('the Daily pool is big, original and priced 1,000-2,500; the Longhorn shop is unchanged', () => {
  const outfits = DAILY_POOL.filter((i) => i.kind === 'skin'), emotes = DAILY_POOL.filter((i) => i.kind === 'emote');
  assert.ok(outfits.length >= 12, 'at least 12 new outfits');
  assert.ok(emotes.length >= 4, 'at least 4 new emotes');
  for (const i of DAILY_POOL) {
    assert.ok(i.price >= 1000 && i.price <= 2500, `${i.name} ${i.price}`);
    assert.ok(!SHOP.some((x) => x.id === i.id), 'not in the Longhorn shop');
    assert.ok(!/fortnite|epic games|nfl|ncaa/i.test(i.name));
  }
  for (const i of SHOP) assert.ok(i.price >= 1000, `${i.name} costs at least 1,000`);
  assert.ok(SHOP.every((i) => i.shop === 'longhorn'));
  assert.equal(new Set([...SHOP, ...DAILY_POOL].map((i) => i.id)).size, SHOP.length + DAILY_POOL.length, 'unique ids');
  assert.equal(new Set(EMOTES.map((e) => e.id)).size, EMOTES.length);
  assert.equal(new Set(SKIN_PRESETS.map((e) => e.id)).size, SKIN_PRESETS.length);
});

test('rotation is deterministic per UTC date and changes the next day', () => {
  const a = dailyShop('2026-11-20'), b = dailyShop('2026-11-20');
  assert.deepEqual(a, b);
  assert.equal(a.resetsAt, Date.UTC(2026, 10, 21));
  assert.equal(nextResetAt(Date.UTC(2026, 10, 20, 18, 47)), Date.UTC(2026, 10, 21));
  assert.equal(utcDateKey(Date.UTC(2026, 10, 20, 23, 59, 59)), '2026-11-20');
  const list = days(60).map((d) => dailyShop(d));
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const s = list[i], ids = dailyIds(s);
    assert.equal(s.featured.length, DAILY.featured);
    assert.ok(ids.length >= 6 && ids.length <= 8, 'six to eight items');
    assert.equal(new Set(ids).size, ids.length, 'no duplicates');
    for (const id of s.featured) assert.ok(DAILY_POOL.find((x) => x.id === id).rarity >= 3, 'featured are Epic/Legendary');
    assert.ok(ids.some((id) => id.startsWith('emote')), 'emotes every day');
    if (i) assert.notDeepEqual(ids.slice().sort(), dailyIds(list[i - 1]).slice().sort(), 'changes the next day');
    ids.forEach((id) => seen.add(id));
  }
  assert.equal(seen.size, DAILY_POOL.length, 'every item shows up over two months');
});

test('admin-featured items join today as Featured', () => {
  const base = dailyShop('2026-11-20');
  const out = DAILY_POOL.find((i) => !dailyIds(base).includes(i.id));
  const f = dailyShop('2026-11-20', [out.id, 'lh_golden', 'nope']);
  assert.deepEqual(f.featured, [...base.featured, out.id], 'only real Daily items are added');
  const regular = base.items[0];
  const g = dailyShop('2026-11-20', [regular]);
  assert.ok(g.featured.includes(regular) && !g.items.includes(regular), 'a regular item moves up to Featured');
});

test('only today\'s Daily items can be bought; bought items are wearable forever', async () => {
  const ac = createAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')));
  const { user } = await ac.signup({ email: 'd@b.co', username: 'Daily', password: 'secret1', ageOk: true }, 'ip');
  ac.award(user, 20000);
  const today = dailyShop('2026-11-20');
  const inShop = today.featured[0];
  const notInShop = DAILY_POOL.find((i) => i.kind === 'skin' && !dailyIds(today).includes(i.id)).id;
  assert.match(ac.buy(user, notInShop, today), /not in today's Daily Shop/);
  assert.match(ac.buy(user, inShop), /not in today's Daily Shop/, 'no rotation given: Longhorn only');
  assert.equal(ac.buy(user, inShop, today), null);
  assert.equal(ac.buy(user, 'lh_golden', today), null, 'Longhorn items are always for sale');
  // tomorrow the item may be gone from the shop, but the player keeps it
  assert.equal(sanitizeSkin({ preset: inShop }, user).preset, inShop);
  assert.ok(canUseSkin(SKIN_PRESETS.find((p) => p.id === inShop), user));
  const em = today.items.find((id) => id.startsWith('emote'));
  assert.ok(!canUseEmote(+em.slice(5), user));
  assert.equal(ac.buy(user, em, today), null);
  assert.ok(canUseEmote(+em.slice(5), user));
  assert.match(ac.buy(user, em, today), /already own/);
});

// ---------- the real server ----------
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-daily-'));
  const proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '0', ADMIN_PASSWORD: 'admin-test-pass', FR_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
    const onData = (d) => { out += d; const m = out.match(/localhost:(\d+)/); if (m) { clearTimeout(t); resolve({ proc, port: Number(m[1]) }); } };
    proc.stdout.on('data', onData); proc.stderr.on('data', (d) => { out += d; });
  });
}
function connect(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [], waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw); inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); inbox.splice(inbox.indexOf(m), 1); w.resolve(m); }
  });
  ws.next = (t, ms = 8000) => new Promise((resolve, reject) => {
    const pred = typeof t === 'function' ? t : (m) => m.t === t;
    const found = inbox.find(pred);
    if (found) { inbox.splice(inbox.indexOf(found), 1); return resolve(found); }
    waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error('timeout waiting for ' + t)), ms);
  });
  ws.json = (o) => ws.send(JSON.stringify(o));
  ws.opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return ws;
}
let S;
before(async () => { S = await startServer(); });
after(() => { S.proc.kill('SIGKILL'); });
const adminApi = async (action, body) => {
  const r = await fetch(`http://localhost:${S.port}/admin/api/${action}`, { method: body ? 'POST' : 'GET', headers: { 'x-admin-key': 'admin-test-pass', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

test('server: info carries today\'s shop, buying is checked, admin can feature an item', async () => {
  const ws = connect(S.port);
  await ws.opened;
  const info = await ws.next('info');
  const today = dailyShop(utcDateKey());
  assert.equal(info.shop.date, today.date);
  assert.deepEqual(info.shop.featured, today.featured);
  assert.deepEqual(info.shop.items, today.items);
  assert.ok(info.shop.resetsAt > info.shop.now && info.shop.resetsAt - info.shop.now <= 86400_000);
  ws.json({ t: 'signup', email: 'shop@test.co', username: 'SHOPPER', password: 'secret12', ageOk: true });
  await ws.next('auth');
  await ws.next('profile');
  assert.equal((await adminApi('gift', { name: 'SHOPPER', amount: 10000 })).status, 200);
  assert.equal((await ws.next((m) => m.t === 'profile' && m.bucks === 10000)).bucks, 10000);

  const outId = DAILY_POOL.find((i) => !dailyIds(today).includes(i.id)).id;
  ws.json({ t: 'buy', item: outId });
  assert.match((await ws.next('error')).msg, /not in today's Daily Shop/);

  const inId = today.featured[0], price = DAILY_POOL.find((i) => i.id === inId).price;
  ws.json({ t: 'buy', item: inId });
  assert.equal((await ws.next('bought')).item, inId);
  const p = await ws.next('profile');
  assert.ok(p.owned.includes(inId)); assert.equal(p.bucks, 10000 - price);

  // the admin features an item that is not in today's rotation: it is for sale right away
  const st = await adminApi('state');
  assert.ok(st.body.shopPool.length === DAILY_POOL.length && st.body.shop.date === today.date);
  assert.equal((await adminApi('feature', { item: 'lh_golden' })).status, 400);
  const f = await adminApi('feature', { item: outId });
  assert.equal(f.status, 200);
  assert.ok(f.body.shop.featured.includes(outId));
  const pushed = await ws.next((m) => m.t === 'info' && m.shop.featured.includes(outId));
  assert.ok(pushed);
  ws.json({ t: 'buy', item: outId });
  assert.equal((await ws.next('bought')).item, outId);
  assert.ok((await adminApi('state')).body.forced.includes(outId));
  // un-feature it again
  const r = await adminApi('feature', { item: outId, remove: true });
  assert.ok(!r.body.shop.featured.includes(outId));
  ws.close();
});
