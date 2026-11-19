// Sign up / log in, and making sure emails and passwords stay private.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccounts } from '../server/accounts.js';

const fresh = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')); return { dir, ac: createAccounts(dir) }; };

test('sign up, then log in with username or email', async () => {
  const { ac } = fresh();
  const s = await ac.signup({ email: 'Kid@Example.com', username: 'TouchdownTom', password: 'hunter22', ageOk: true }, '1');
  assert.ok(s.token && s.user);
  assert.equal(ac.resume(s.token), s.user, 'session token works');
  assert.ok((await ac.login({ login: 'touchdowntom', password: 'hunter22' }, '1')).user, 'username, any case');
  assert.ok((await ac.login({ login: 'kid@example.com', password: 'hunter22' }, '1')).user, 'email, any case');
  assert.ok((await ac.login({ login: 'TouchdownTom', password: 'wrong!!' }, '1')).error);
  ac.logout(s.token);
  assert.equal(ac.resume(s.token), null);
});

test('signup rules', async () => {
  const { ac } = fresh();
  const base = { email: 'x@y.com', username: 'Player_1', password: 'abcdef', ageOk: true };
  assert.match((await ac.signup({ ...base, ageOk: false }, '1')).error, /13/);
  assert.match((await ac.signup({ ...base, email: 'nope' }, '1')).error, /email/);
  assert.match((await ac.signup({ ...base, username: 'a!b' }, '1')).error, /Usernames/);
  assert.match((await ac.signup({ ...base, password: '123' }, '1')).error, /6/);
  assert.ok((await ac.signup(base, '1')).user);
  assert.match((await ac.signup({ ...base, email: 'other@y.com', username: 'PLAYER_1' }, '1')).error, /taken/);
  assert.match((await ac.signup({ ...base, username: 'Someone' }, '1')).error, /already has an account/);
});

test('emails and passwords are never stored or shown readably', async () => {
  const { dir, ac } = fresh();
  await ac.signup({ email: 'secret.kid@school.org', username: 'Visible', password: 'MyPassw0rd', ageOk: true }, '1');
  await new Promise((r) => setTimeout(r, 700)); // let it save
  const disk = fs.readFileSync(path.join(dir, 'data', 'accounts.json'), 'utf8');
  assert.ok(!disk.includes('secret.kid') && !disk.includes('school.org'), 'email not on disk');
  assert.ok(!disk.includes('MyPassw0rd'), 'password not on disk');
  assert.ok(disk.includes('VISIBLE'));
  const admin = JSON.stringify(ac.adminList());
  assert.ok(admin.includes('VISIBLE'));
  assert.equal(ac.adminList()[0].username, 'VISIBLE', 'names are all caps');
  assert.ok(!/email|pwHash|salt/.test(admin), 'admin view has usernames only');
});

test('too many wrong passwords locks for a minute', async () => {
  const { ac } = fresh();
  await ac.signup({ email: 'l@k.com', username: 'Locky', password: 'rightpw', ageOk: true }, '1');
  for (let i = 0; i < 5; i++) await ac.login({ login: 'Locky', password: 'nope' + i }, 'ip' + i);
  assert.match((await ac.login({ login: 'Locky', password: 'rightpw' }, 'other')).error, /Too many/);
});

test('usernames can have single spaces, and ADMIN_USERS become admins', async () => {
  process.env.ADMIN_USERS = 'LONGHORNS 1, someone_else';
  const { createAccounts: fresh2 } = await import('../server/accounts.js?admin=' + Date.now());
  const ac = fresh2(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')));
  const r = await ac.signup({ email: 'owner@test.dev', username: 'LONGHORNS 1', password: 'abcdef1', ageOk: true }, '1');
  assert.ok(r.user, r.error);
  assert.equal(r.user.isAdmin, true);
  assert.ok((await ac.login({ login: 'longhorns 1', password: 'abcdef1' }, '1')).user);
  assert.match((await ac.signup({ email: 'b@test.dev', username: 'two  spaces', password: 'abcdef1', ageOk: true }, '1')).error, /Usernames/);
  assert.match((await ac.signup({ email: 'c@test.dev', username: 'bad$name', password: 'abcdef1', ageOk: true }, '1')).error, /Usernames/);
  const other = await ac.signup({ email: 'd@test.dev', username: 'Regular Joe', password: 'abcdef1', ageOk: true }, '1');
  assert.ok(other.user && !other.user.isAdmin);
  delete process.env.ADMIN_USERS;
});
