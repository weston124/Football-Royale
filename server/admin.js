// Admin tools: news/updates, broadcast messages, scheduled parties and GLOBAL PARTIES.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createAdmin({ root, hub }) {
  const dataDir = path.join(root, 'data');
  const file = path.join(dataDir, 'admin.json');
  let data = { news: [], events: [] };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  if (!data.news.length) {
    data.news.push({ id: 1, title: 'Welcome to Football Royale! 🏈', body: 'Season 1 is live. Drop from the Team Blimp, grab loot and be the last player standing!', date: Date.now() });
  }
  const save = () => {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error('save failed', e.message); }
  };

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(5).toString('hex');
    console.log(`\n🔐 No ADMIN_PASSWORD set. Your admin password for this run is: ${password}\n   (Set the ADMIN_PASSWORD environment variable to choose your own.)\n`);
  }
  const keyBuf = Buffer.from(password);
  const fails = new Map(); // ip -> {n, until}

  function authed(req) {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const f = fails.get(ip);
    if (f && f.until > Date.now()) return 'locked';
    const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
    const ok = given.length === keyBuf.length && crypto.timingSafeEqual(given, keyBuf);
    if (!ok) {
      const n = (f ? f.n : 0) + 1;
      fails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
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
      req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    });
  }
  const clean = (s, n) => String(s || '').slice(0, n).trim();

  async function handle(req, res, url) {
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
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
      case 'endparty': hub.endParties(); return json(200, { ok: true });
      default: return json(404, { error: 'Unknown action' });
    }
  }
  return { handle, publicInfo };
}
