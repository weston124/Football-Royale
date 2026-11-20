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

test('admin password reset gives a temporary password, then the player changes it', async () => {
  const { ac } = fresh();
  const s = await ac.signup({ email: 'forgot@test.dev', username: 'Forgetful', password: 'oldpass1', ageOk: true }, '1');
  const r = await ac.adminResetPassword('forgetful');
  assert.match(r.temp, /^[A-Z]+-\d{4}-[A-Z]+$/);
  assert.equal(ac.resume(s.token), null, 'old sessions are signed out');
  assert.ok((await ac.login({ login: 'FORGETFUL', password: 'oldpass1' }, '2')).error, 'old password stops working');
  const li = await ac.login({ login: 'FORGETFUL', password: r.temp }, '2');
  assert.ok(li.user, 'temporary password works');
  assert.equal(ac.publicView(li.user).mustChangePw, true);
  assert.match((await ac.changePassword(li.user, 'wrong', 'newpass9', '2')).error, /current password/);
  assert.match((await ac.changePassword(li.user, r.temp, '123', '2')).error, /6 characters/);
  assert.ok((await ac.changePassword(li.user, r.temp, 'newpass9', '2')).ok);
  assert.equal(ac.publicView(li.user).mustChangePw, false);
  assert.ok((await ac.login({ login: 'FORGETFUL', password: 'newpass9' }, '3')).user, 'new password works');
  assert.equal(await ac.adminResetPassword('NOBODY'), null);
  assert.ok(!JSON.stringify(ac.adminList()).includes(r.temp), 'temporary password is not stored readably');
});

test('a player can change their email (needs their password)', async () => {
  const { ac } = fresh();
  const a = (await ac.signup({ email: 'old@test.dev', username: 'Mover', password: 'secret12', ageOk: true }, '1')).user;
  await ac.signup({ email: 'taken@test.dev', username: 'Other', password: 'secret12', ageOk: true }, '1');
  assert.match((await ac.changeEmail(a, 'wrongpw', 'new@test.dev', '1')).error, /Wrong password/);
  assert.match((await ac.changeEmail(a, 'secret12', 'nope', '1')).error, /does not look right/);
  assert.match((await ac.changeEmail(a, 'secret12', 'taken@test.dev', '1')).error, /another account/);
  assert.ok((await ac.changeEmail(a, 'secret12', 'New@Test.dev', '1')).ok);
  assert.ok((await ac.login({ login: 'new@test.dev', password: 'secret12' }, '2')).user, 'logs in with the new email');
  assert.ok((await ac.login({ login: 'old@test.dev', password: 'secret12' }, '2')).error, 'old email no longer works');
});
