// The "Big Game Drop" Daily Shop batch: prices, NEW! window, rotation, buying and equipping.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccounts } from '../server/accounts.js';
import { Match } from '../server/match.js';
import {
  DAILY_POOL, SHOP, SKIN_PRESETS, EMOTES, NEW_BATCH_DATE, NEW_DAYS, isNewItem, sanitizeSkin, canUseSkin, canUseEmote,
  OUTFIT_PATTERNS, HELMET_DECALS, HELMET_FINS, BACK_ITEMS,
} from '../shared/skins.js';
import { dailyShop, dailyIds, utcDateKey, DAILY } from '../shared/shop.js';

const day = (n, from = NEW_BATCH_DATE) => utcDateKey(Date.parse(from) + n * 86400_000);
const batch = DAILY_POOL.filter((i) => i.added === NEW_BATCH_DATE);
const batchOutfits = batch.filter((i) => i.kind === 'skin'), batchEmotes = batch.filter((i) => i.kind === 'emote');
const HEX = /^#[0-9a-f]{6}$/i;

test('the new batch: 12+ outfits and 4+ emotes, all in the Daily pool, every one 1,000+ Ball Bucks', () => {
  assert.ok(batchOutfits.length >= 12, `${batchOutfits.length} outfits`);
  assert.ok(batchEmotes.length >= 4, `${batchEmotes.length} emotes`);
  assert.ok(new Set(batchOutfits.map((i) => i.rarity)).size >= 3, 'several rarity tiers');
  for (const i of batch) {
    assert.equal(i.shop, 'daily');
    assert.ok(Number.isInteger(i.price) && i.price >= 1000, `${i.name} costs ${i.price}`);
    assert.ok(i.rarity >= 1 && i.rarity <= 4, `${i.name} rarity`);
    assert.ok(!SHOP.some((x) => x.id === i.id));
  }
  // rarer costs more (never less than a more common item of the same kind)
  for (const a of batch) for (const b of batch) {
    if (a.kind === b.kind && a.rarity > b.rarity) assert.ok(a.price > b.price, `${a.name} (${a.price}) vs ${b.name} (${b.price})`);
  }
});

test('new items are original, kid-friendly and well-formed', () => {
  const banned = /fortnite|epic games|nfl|ncaa|nike|adidas|marvel|dc comics|disney|pokemon|superman|batman|spider|iron man|dab|floss|skull|blood|gun|kill/i;
  for (const i of batch) assert.ok(!banned.test(i.name), i.name);
  const names = [...SKIN_PRESETS.map((p) => p.team), ...EMOTES.map((e) => e.name)];
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'no duplicate names');
  for (const it of batchOutfits) {
    const p = SKIN_PRESETS.find((x) => x.id === it.id), st = p.style;
    for (const k of ['jersey', 'accent', 'helmet', 'stripe', 'mask', 'pants']) assert.match(p[k], HEX, `${p.id}.${k}`);
    assert.ok(st && OUTFIT_PATTERNS.includes(st.pattern), `${p.id} pattern ${st && st.pattern}`);
    assert.ok(HELMET_DECALS.includes(st.decal), `${p.id} decal`);
    if (st.fin) assert.ok(HELMET_FINS.includes(st.fin));
    if (st.back) assert.ok(BACK_ITEMS.includes(st.back));
    for (const k of ['pat2', 'glow', 'visor', 'gloves', 'decalColor', 'decalEdge', 'backColor', 'backColor2', 'cleats']) if (st[k]) assert.match(st[k], HEX, `${p.id}.style.${k}`);
    assert.ok(Array.isArray(st.chute) && st.chute.length === 2 && st.chute.every((c) => HEX.test(c)), `${p.id} parachute colors`);
  }
  for (const it of batchEmotes) {
    const e = EMOTES.find((x) => x.id === it.emote);
    assert.ok(e.dur > 1 && e.dur <= 5 && typeof e.art === 'number' && e.art < e.dur, e.name);
  }
});

test('NEW! badge: only this batch, only for NEW_DAYS days from its release', () => {
  const one = batch[0];
  assert.ok(isNewItem(one, NEW_BATCH_DATE));
  assert.ok(isNewItem(one, day(NEW_DAYS - 1)));
  assert.ok(!isNewItem(one, day(NEW_DAYS)));
  assert.ok(!isNewItem(one, day(-1)));
  assert.ok(!DAILY_POOL.filter((i) => !i.added).some((i) => isNewItem(i, NEW_BATCH_DATE)), 'older items are not NEW');
});

test('rotation: every new item shows up within 14 days, every day mixes new and older items', () => {
  const seen = new Set();
  for (let d = 0; d < 14; d++) {
    const s = dailyShop(day(d)), ids = dailyIds(s);
    assert.equal(ids.length, DAILY.featured + DAILY.outfits + DAILY.emotes);
    assert.equal(new Set(ids).size, ids.length);
    const items = ids.map((id) => DAILY_POOL.find((i) => i.id === id));
    assert.ok(s.featured.some((id) => isNewItem(DAILY_POOL.find((i) => i.id === id), s.date)), `${s.date}: a NEW featured outfit`);
    const fresh = items.filter((i) => isNewItem(i, s.date));
    assert.ok(fresh.some((i) => i.kind === 'skin') && fresh.some((i) => i.kind === 'emote'), `${s.date}: new outfits and a new emote`);
    assert.ok(items.some((i) => !i.added), `${s.date}: older items too`);
    assert.ok(items.filter((i) => i.kind === 'emote').length === DAILY.emotes);
    for (const id of s.featured) assert.ok(DAILY_POOL.find((i) => i.id === id).rarity >= 3);
    ids.forEach((id) => seen.add(id));
  }
  for (const i of batch) assert.ok(seen.has(i.id), `${i.name} is in the shop within 14 days`);
  // after the NEW window the rotation is a plain random pick again (no guaranteed spots)
  const later = Array.from({ length: 30 }, (_, k) => dailyIds(dailyShop(day(NEW_DAYS + 5 + k)))).flat();
  assert.ok(later.some((id) => !batch.some((i) => i.id === id)) && later.some((id) => batch.some((i) => i.id === id)));
});

test('server: new items can only be bought on a day they are in the shop, are kept forever and can be equipped', async () => {
  const ac = createAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-new-')));
  const { user } = await ac.signup({ email: 'n@b.co', username: 'Newbie', password: 'secret1', ageOk: true }, 'ip');
  ac.award(user, 1e6);
  const bought = [];
  for (let d = 0; d < 14; d++) {
    const shop = dailyShop(day(d)), ids = dailyIds(shop);
    for (const it of batch) {
      if (bought.includes(it.id)) { const was = user.bucks; assert.ok(ac.buy(user, it.id, shop), 'no buying twice'); assert.equal(user.bucks, was); continue; }
      const before = user.bucks, err = ac.buy(user, it.id, shop);
      if (ids.includes(it.id)) {
        assert.equal(err, null, `${it.name} is for sale on ${shop.date}`);
        assert.equal(before - user.bucks, it.price, 'charged the listed price');
        bought.push(it.id);
      } else {
        assert.match(err, /not in today's Daily Shop/, `${it.name} is not for sale on ${shop.date}`);
        assert.equal(user.bucks, before);
      }
    }
  }
  assert.equal(bought.length, batch.length, 'everything was buyable within two weeks');
  // equip: outfits keep their preset + style for the owner, fall back to the default for anyone else
  const nobody = { owned: [], stats: {} };
  for (const it of batchOutfits) {
    const p = SKIN_PRESETS.find((x) => x.id === it.id);
    assert.ok(canUseSkin(p, user));
    const s = sanitizeSkin({ preset: it.id, number: 7 }, user);
    assert.equal(s.preset, it.id); assert.deepEqual(s.style, p.style); assert.equal(s.jersey, p.jersey); assert.equal(s.number, 7);
    assert.equal(sanitizeSkin({ preset: it.id, style: { glow: '#ffffff' } }, nobody).preset, 'thunder', 'not owned: default outfit');
    assert.ok(!sanitizeSkin({ preset: 'thunder', style: { chrome: true, back: 'cape' } }).style.back, 'style comes from the preset, never the client');
  }
  for (const it of batchEmotes) { assert.ok(canUseEmote(it.emote, user)); assert.ok(!canUseEmote(it.emote, nobody)); }
  // in a match: an owned new emote plays, an unowned one is refused
  const m = new Match({ code: 'NB' });
  const ws = { readyState: 1, send() {} };
  const a = m.addHuman(ws, 'A', sanitizeSkin({ preset: batchOutfits[0].id }, user), 0, user);
  const b = m.addHuman(ws, 'B', sanitizeSkin({ preset: batchOutfits[0].id }, nobody), 0, nobody);
  assert.equal(a.skin.preset, batchOutfits[0].id); assert.equal(b.skin.preset, 'thunder');
  m.onInput(a, { em: batchEmotes[0].emote }); m.onInput(b, { em: batchEmotes[0].emote });
  assert.equal(a.emote, batchEmotes[0].emote); assert.equal(b.emote, 0);
  m.close();
});
