// Ball Bucks and the Longhorn Item Shop.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccounts } from '../server/accounts.js';
import { sanitizeSkin, canUseEmote, SHOP, BUCKS } from '../shared/skins.js';
import { Match } from '../server/match.js';

test('shop only sells Longhorn items', () => {
  assert.ok(SHOP.length >= 6);
  for (const i of SHOP) assert.ok(/Longhorn|horn|Stampede|Lasso|Bull/.test(i.name), i.name);
});

test('buying spends Ball Bucks and unlocks the item', async () => {
  const ac = createAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')));
  const { user } = await ac.signup({ email: 'a@b.co', username: 'Buyer', password: 'secret1', ageOk: true }, 'ip');
  assert.equal(user.bucks, 0);
  assert.match(ac.buy(user, 'lh_golden'), /more Ball Bucks/);
  ac.award(user, 2500);
  assert.equal(ac.buy(user, 'lh_golden'), null);
  assert.equal(user.bucks, 500);
  assert.match(ac.buy(user, 'lh_golden'), /already own/);
});

test('you cannot wear or emote with items you do not own', () => {
  const none = { owned: [], stats: {} };
  const own = { owned: ['lh_golden', 'emote7'], stats: {} };
  assert.equal(sanitizeSkin({ preset: 'lh_golden' }, none).preset, 'thunder');
  assert.equal(sanitizeSkin({ preset: 'lh_golden' }, own).preset, 'lh_golden');
  assert.ok(sanitizeSkin({ preset: 'lh_golden' }, own).horns);
  assert.equal(sanitizeSkin({ preset: 'pirates' }, none).preset, 'thunder', 'win-locked skin');
  assert.ok(!canUseEmote(7, none)); assert.ok(canUseEmote(7, own)); assert.ok(canUseEmote(1, none));
});

test('eliminations and wins pay Ball Bucks', () => {
  const paid = [];
  const m = new Match({ code: 'BB', onReward: (p, b, why) => paid.push([p.name, b, why]) });
  const ws = { readyState: 1, send() {} };
  const a = m.addHuman(ws, 'A', null, 0, { owned: [], stats: {} });
  m.start();
  const bots = [...m.players.values()].filter((p) => p.bot);
  m.kill(bots[0], a, 'rifle', false);
  for (const b of bots.slice(1)) m.kill(b, null, 'storm', false);
  const total = paid.filter((x) => x[0] === 'A').reduce((s, x) => s + x[1], 0);
  assert.equal(total, BUCKS.match + BUCKS.perElim + BUCKS.win);
  m.close();
});
