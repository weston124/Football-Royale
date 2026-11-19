// HTTP/WebSocket plumbing: security headers, caching, compression, origin checks,
// account deletion, admin deletion, and saving everything on shutdown.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// PORT=0: the server picks a free port and prints it, so this never clashes with other tests
function startServer(env = {}) {
  const dir = env.FR_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'fr-srv-'));
  const proc = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '0', ADMIN_PASSWORD: 'admin-test-pass', FR_DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
    const onData = (d) => {
      out += d;
      const m = out.match(/localhost:(\d+)/);
      if (m) { clearTimeout(t); resolve({ proc, port: Number(m[1]), dir, output: () => out }); }
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', (d) => { out += d; });
  });
}

function connect(port, headers = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  ws.next = (t, ms = 8000) => new Promise((resolve, reject) => {
    const pred = typeof t === 'function' ? t : (m) => m.t === t;
    const found = inbox.find(pred);
    if (found) { inbox.splice(inbox.indexOf(found), 1); return resolve(found); }
    const w = { pred: (m) => { if (pred(m)) { inbox.splice(inbox.indexOf(m), 1); return true; } return false; }, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error('timeout waiting for ' + t)), ms);
  });
  ws.json = (o) => ws.send(JSON.stringify(o));
  ws.opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (req, r) => rej(new Error('HTTP ' + r.statusCode))); });
  return ws;
}

let S;
before(async () => { S = await startServer(); });
after(() => { S.proc.kill('SIGKILL'); });

test('pages have security headers and a CSP that allows our inline scripts', async () => {
  const r = await fetch(`http://localhost:${S.port}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('referrer-policy'));
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  // every inline script (the import map) is allowed by its hash
  for (const m of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const h = crypto.createHash('sha256').update(m[1]).digest('base64');
    assert.ok(csp.includes(`'sha256-${h}'`), 'inline script hash in CSP');
  }
  assert.match(html, /\/vendor\/three@\d+\.\d+\.\d+\/build\/three\.module\.js/, 'import map uses versioned three.js');
  const admin = await fetch(`http://localhost:${S.port}/admin`);
  assert.equal(admin.status, 200);
  assert.ok(admin.headers.get('content-security-policy').includes("'sha256-"), 'admin inline script hashed');
});

test('compression, caching and revalidation', async () => {
  const html = await (await fetch(`http://localhost:${S.port}/`)).text();
  const three = html.match(/\/vendor\/three@[^"]+\/build\/three\.module\.js/)[0];
  const r = await fetch(`http://localhost:${S.port}${three}`, { headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'br');
  assert.match(r.headers.get('cache-control'), /immutable/);
  await r.arrayBuffer();
  const js = await fetch(`http://localhost:${S.port}/js/main.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(js.headers.get('content-encoding'), 'gzip');
  assert.equal(js.headers.get('cache-control'), 'no-cache');
  const etag = js.headers.get('etag');
  assert.ok(etag && js.headers.get('last-modified'));
  await js.text();
  const again = await fetch(`http://localhost:${S.port}/js/main.js`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  const bin = await fetch(`http://localhost:${S.port}/assets/human.bin`, { method: 'HEAD' });
  assert.equal(bin.headers.get('content-type'), 'application/octet-stream');
  for (const p of ['/privacy', '/terms', '/credits', '/manifest.webmanifest', '/og.png', '/icons/icon-512.png', '/healthz']) {
    const x = await fetch(`http://localhost:${S.port}${p}`);
    assert.equal(x.status, 200, p);
    await x.arrayBuffer();
  }
});

test('no path tricks: dotfiles, .. and node_modules extras are not served', async () => {
  for (const p of ['/..%2fpackage.json', '/%2e%2e/server/index.js', '/vendor/three/package.json', '/vendor/three/src/Three.js', '/.git/config', '/js/%00']) {
    const r = await fetch(`http://localhost:${S.port}${p}`);
    assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
  }
});

test('WebSocket origin check', async () => {
  const bad = connect(S.port, { Origin: 'https://evil.example' });
  await assert.rejects(bad.opened, /403/);
  const ok = connect(S.port, { Origin: `http://localhost:${S.port}` });
  await ok.opened;
  ok.close();
});

test('buy does not crash the server, and players can delete their account', async () => {
  const ws = connect(S.port);
  await ws.opened;
  ws.json({ t: 'signup', email: 'del@test.dev', username: 'Delete Me', password: 'secret1', ageOk: true });
  await ws.next('auth');
  ws.json({ t: 'buy', item: 'nope' });
  await ws.next('error');
  ws.json({ t: 'delete_account', password: 'wrong' });
  assert.match((await ws.next('delete_error')).msg, /Wrong/);
  ws.json({ t: 'delete_account', password: 'secret1' });
  await ws.next('account_deleted');
  ws.json({ t: 'login', login: 'Delete Me', password: 'secret1' });
  assert.ok((await ws.next('auth_error')).msg);
  ws.close();
  const disk = fs.readFileSync(path.join(S.dir, 'accounts.json'), 'utf8');
  assert.ok(!disk.includes('DELETE ME'), 'gone from disk right away');
});

test('admin can delete an account by username', async () => {
  const ws = connect(S.port);
  await ws.opened;
  ws.json({ t: 'signup', email: 'bad@test.dev', username: 'Kick Me Out', password: 'secret1', ageOk: true });
  await ws.next('auth');
  const call = (body, key = 'admin-test-pass') => fetch(`http://localhost:${S.port}/admin/api/deleteuser`, { method: 'POST', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await call({ username: 'KICK ME OUT', confirm: 'KICK ME OUT' }, 'wrong')).status, 401);
  assert.equal((await call({ username: 'KICK ME OUT', confirm: 'nope' })).status, 400);
  assert.equal((await call({ username: 'KICK ME OUT', confirm: 'kick me out' })).status, 200);
  await ws.next('account_deleted');
  const state = await (await fetch(`http://localhost:${S.port}/admin/api/state`, { headers: { 'x-admin-key': 'admin-test-pass' } })).json();
  assert.ok(!state.accounts.some((a) => a.username === 'KICK ME OUT'));
  ws.close();
});

test('SIGTERM saves data, tells players and exits cleanly; bad files do not stop startup', async () => {
  const s = await startServer();
  const ws = connect(s.port);
  await ws.opened;
  ws.json({ t: 'signup', email: 'save@test.dev', username: 'Saved Kid', password: 'secret1', ageOk: true });
  await ws.next('auth');
  ws.json({ t: 'buy', item: 'x' }); // touch data again right before shutdown
  const exited = new Promise((r) => s.proc.on('exit', (code) => r(code)));
  s.proc.kill('SIGTERM');
  const bc = await ws.next('bc');
  assert.match(bc.text, /restarting/);
  assert.equal(await exited, 0);
  assert.ok(fs.readFileSync(path.join(s.dir, 'accounts.json'), 'utf8').includes('SAVED KID'));

  // damage the file: the server still starts, keeps the bad file and restores from the backup
  fs.writeFileSync(path.join(s.dir, 'accounts.json'), '{"users": {');
  fs.writeFileSync(path.join(s.dir, 'admin.json'), 'not json');
  const s2 = await startServer({ FR_DATA_DIR: s.dir });
  try {
    assert.equal((await fetch(`http://localhost:${s2.port}/healthz`)).status, 200);
    const files = fs.readdirSync(s.dir);
    assert.ok(files.some((f) => f.startsWith('accounts.json.corrupt-')));
    assert.ok(files.some((f) => f.startsWith('admin.json.corrupt-')));
    assert.match(s2.output(), /DATA WARNING/);
  } finally { s2.proc.kill('SIGKILL'); }
});
