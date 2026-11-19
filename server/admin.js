// Admin tools: news/updates, broadcast messages, scheduled parties and GLOBAL PARTIES.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadJson, jsonStore } from './safefile.js';
import { clientIp } from './net.js';

export function createAdmin({ root, hub }) {
  const dataDir = process.env.FR_DATA_DIR || path.join(root, 'data');
  const file = path.join(dataDir, 'admin.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const loaded = loadJson(file, { validate: (d) => d && typeof d === 'object' && Array.isArray(d.news || []) && Array.isArray(d.events || []) });
  let data = { news: [], events: [], ...(loaded.data || {}) };
  if (!data.news.length) {
    data.news.push({ id: 1, title: 'Welcome to Football Royale! 🏈', body: 'Season 1 is live. Drop from the Team Blimp, grab loot and be the last player standing!', date: Date.now() });
  }
  const store = jsonStore(file, () => data, { delay: 50, mode: 0o600, pretty: true });
  const save = store.save;

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(5).toString('hex');
    console.log(`\n🔐 No ADMIN_PASSWORD set. Your admin password for this run is: ${password}\n   (Set the ADMIN_PASSWORD environment variable to choose your own.)\n`);
  }
  if (password.length < 12) console.warn('⚠️  ADMIN_PASSWORD is short. Use 12+ random characters for a public server.');
  const keyHash = crypto.createHash('sha256').update(password).digest();
  const fails = new Map(); // ip -> {n, until}
  // a global brake too, so guessing from many IPs (or faked IP headers) stays slow
  let globalFails = [], globalUntil = 0;

  function authed(req) {
    const ip = clientIp(req);
    const t = Date.now();
    const f = fails.get(ip);
    if ((f && f.until > t) || globalUntil > t) return 'locked';
    // compare fixed-length hashes so neither the content nor the length of the password leaks
    const given = crypto.createHash('sha256').update(String(req.headers['x-admin-key'] || '')).digest();
    const ok = crypto.timingSafeEqual(given, keyHash);
    if (!ok) {
      const n = (f ? f.n : 0) + 1;
      fails.set(ip, { n, until: n >= 5 ? t + 60_000 : 0 });
      if (fails.size > 10_000) fails.clear();
      globalFails = globalFails.filter((x) => x > t - 15 * 60_000); globalFails.push(t);
      if (globalFails.length >= 100) { globalUntil = t + 5 * 60_000; globalFails = []; console.warn('⚠️  Many wrong admin passwords: admin API locked for 5 minutes.'); }
    } else fails.delete(ip);
    return ok;
  }

  const publicInfo = () => ({
    news: data.news.slice().sort((a, b) => b.date - a.date).slice(0, 10),
    events: data.events.filter((e) => e.time > Date.now() - 60_000).sort((a, b) => a.time - b.time),
  });

  // Scheduled parties fire automatically
  setInterval(() => {
    const t = Date.now();
    let changed = false;
    for (const e of data.events) {
      if (!e.fired && e.time <= t) {
        e.fired = true; changed = true;
        hub.globalParty(e.kind, e.title);
      }
    }
    if (changed) { data.events = data.events.filter((e) => e.time > t - 3600_000); save(); hub.pushInfo(publicInfo()); }
  }, 2000);

  function readBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20000) { req.destroy(); resolve({}); } });
      req.on('error', () => resolve({}));
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    });
  }
  const clean = (s, n) => String(s || '').slice(0, n).trim();

  async function handle(req, res, url) {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (url === '/api/info') return json(200, publicInfo());
    if (!url.startsWith('/admin/api/')) return false;
    const a = authed(req);
    if (a === 'locked') return json(429, { error: 'Too many wrong passwords. Wait a minute.' });
    if (!a) return json(401, { error: 'Wrong password' });
    const action = url.slice('/admin/api/'.length);
    const b = req.method === 'POST' ? await readBody(req) : {};
    switch (action) {
      case 'state': return json(200, { ...hub.stats(), ...publicInfo(), allEvents: data.events });
      case 'news': {
        if (b.delete) data.news = data.news.filter((n) => n.id !== b.delete);
        else {
          const title = clean(b.title, 80), body = clean(b.body, 1500);
          if (!title) return json(400, { error: 'Give your update a title' });
          const ex = data.news.find((n) => n.id === b.id);
          if (ex) Object.assign(ex, { title, body });
          else data.news.push({ id: Date.now(), title, body, date: Date.now() });
          if (b.announce) hub.broadcast(`📰 New update: ${title}`, 'news');
        }
        save(); hub.pushInfo(publicInfo());
        return json(200, { ok: true });
      }
      case 'broadcast': {
        const text = clean(b.text, 200);
        if (!text) return json(400, { error: 'Type a message first' });
        const n = hub.broadcast(text, ['info', 'alert', 'hype'].includes(b.style) ? b.style : 'info');
        return json(200, { ok: true, sent: n });
      }
      case 'event': {
        if (b.delete) data.events = data.events.filter((e) => e.id !== b.delete);
        else {
          const time = Number(b.time);
          if (!Number.isFinite(time) || time < Date.now()) return json(400, { error: 'Pick a time in the future' });
          data.events.push({ id: Date.now(), title: clean(b.title, 80) || 'Party Time!', time, kind: b.kind === 'island' ? 'island' : 'royale', fired: false });
        }
        save(); hub.pushInfo(publicInfo());
        return json(200, { ok: true });
      }
      case 'party': {
        const code = hub.globalParty(b.kind === 'island' ? 'island' : 'royale', clean(b.title, 80) || 'GLOBAL PARTY!');
        return json(200, { ok: true, code });
      }
      case 'gift': {
        const amount = Math.round(Number(b.amount));
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return json(400, { error: 'Pick an amount from 1 to 100,000' });
        const n = hub.gift(b.name === '*' ? '*' : clean(b.name, 16), amount);
        if (!n) return json(400, { error: 'That player is not online right now' });
        return json(200, { ok: true, sent: n });
      }
      case 'setadmin': {
        const u = hub.setAdmin(clean(b.username, 16), !!b.on);
        if (!u) return json(400, { error: 'No player with that username' });
        return json(200, { ok: true });
      }
      case 'endparty': hub.endParties(); return json(200, { ok: true });
      case 'deleteuser': {
        const name = clean(b.username, 16);
        if (!name || clean(b.confirm, 16).toUpperCase() !== name.toUpperCase()) return json(400, { error: 'Type the username again to confirm' });
        if (!hub.deleteUser(name)) return json(400, { error: 'No player with that username' });
        console.log(`admin deleted account ${name.toUpperCase()}`);
        return json(200, { ok: true });
      }
      default: return json(404, { error: 'Unknown action' });
    }
  }
  return { handle, publicInfo, flush: () => store.flush() };
}
