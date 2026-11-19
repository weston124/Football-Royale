// Player data must survive crashes, bad files and restarts.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic, loadJson, jsonStore } from '../server/safefile.js';
import { createAccounts } from '../server/accounts.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fr-safe-'));

test('atomic write leaves no temp files and replaces the file', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  writeFileAtomic(f, '{"n":1}');
  writeFileAtomic(f, '{"n":2}');
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { n: 2 });
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});

test('a corrupt file is kept, and the newest good backup is loaded', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  const data = { users: { x: 1 } };
  const st = jsonStore(f, () => data);
  st.save(); st.flush();         // first write (nothing to back up yet)
  data.users.y = 2; st.save(); st.flush(); // backs up the first version
  assert.ok(fs.existsSync(f + '.bak-1'));
  fs.writeFileSync(f, '{"users": {"x": 1, "y":'); // half-written / damaged
  const r = loadJson(f);
  assert.equal(r.source, 'backup');
  assert.deepEqual(r.data, { users: { x: 1 } });
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('a.json.corrupt-')), 'bad file kept for a human to look at');
});

test('corrupt file and no backups: start clean but keep the bad file', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  fs.writeFileSync(f, 'garbage');
  const r = loadJson(f);
  assert.equal(r.source, 'corrupt');
  assert.equal(r.data, null);
  const kept = fs.readdirSync(dir).find((n) => n.startsWith('a.json.corrupt-'));
  assert.equal(fs.readFileSync(path.join(dir, kept), 'utf8'), 'garbage');
});

test('saves keep happening while the server is busy (throttle, not endless debounce)', async () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  const data = { n: 0 };
  const st = jsonStore(f, () => data, { delay: 100 });
  const t0 = Date.now();
  while (Date.now() - t0 < 400) { data.n++; st.save(); await new Promise((r) => setTimeout(r, 20)); }
  assert.ok(fs.existsSync(f), 'saved during constant changes');
  st.flush();
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).n, data.n);
});

test('accounts: new account is on disk right away and survives a corrupt main file', async () => {
  const root = tmpDir();
  const ac = createAccounts(root);
  const r = await ac.signup({ email: 'a@b.com', username: 'Safe Kid', password: 'abcdef', ageOk: true }, '1');
  assert.ok(r.user);
  const file = path.join(root, 'data', 'accounts.json');
  assert.ok(fs.readFileSync(file, 'utf8').includes('SAFE KID'), 'written without waiting');
  // the next restart makes a backup; then the main file gets damaged
  const ac2 = createAccounts(root);
  await ac2.signup({ email: 'c@d.com', username: 'Second', password: 'abcdef', ageOk: true }, '2');
  fs.writeFileSync(file, '{"users":');
  const ac3 = createAccounts(root);
  assert.ok(ac3.findByUsername('SAFE KID'), 'restored from backup');
  assert.ok((await ac3.login({ login: 'safe kid', password: 'abcdef' }, '3')).user);
});

test('accounts: delete needs the right password and removes sessions', async () => {
  const ac = createAccounts(tmpDir());
  const { user, token } = await ac.signup({ email: 'del@b.com', username: 'Byebye', password: 'abcdef', ageOk: true }, '1');
  assert.match((await ac.deleteAccount(user, 'nope', '1')).error, /Wrong/);
  assert.ok(ac.findByUsername('BYEBYE'));
  assert.ok((await ac.deleteAccount(user, 'abcdef', '1')).ok);
  assert.equal(ac.findByUsername('BYEBYE'), undefined);
  assert.equal(ac.resume(token), null, 'session gone');
  assert.ok((await ac.login({ login: 'Byebye', password: 'abcdef' }, '1')).error);
  // the email can be used again
  assert.ok((await ac.signup({ email: 'del@b.com', username: 'Back Again', password: 'abcdef', ageOk: true }, '1')).user);
  assert.ok(ac.adminDelete('back again'));
  assert.equal(ac.count(), 0);
});
