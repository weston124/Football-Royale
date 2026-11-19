// Football Royale server: serves the game files, runs matches, friend parties
// and the admin tools over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './match.js';
import { createAdmin } from './admin.js';
import { createAccounts } from './accounts.js';
import { MAX_PLAYERS } from '../shared/constants.js';
import { sanitizeSkin } from '../shared/skins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;

const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/', path.join(ROOT, 'node_modules/three')],
  ['/', path.join(ROOT, 'client')],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

// ---------- the hub: everyone connected, rooms and parties ----------
const clients = new Set();   // { ws, name, skin, match, player, party, profile }
const accounts = createAccounts(ROOT);
const rooms = new Map();     // code -> Match
const parties = new Map();   // code -> { code, leader, members:Set }
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
let partyTeamSeq = 1;

function newCode(taken) {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (taken.has(c));
  return c;
}
function createMatch(opts) {
  const code = opts.code || newCode(rooms);
  const m = new Match({ ...opts, code, onReward, onClose: (mm) => {
    rooms.delete(mm.code);
    for (const c of clients) if (c.match === mm) { c.match = null; c.player = null; }
  } });
  rooms.set(code, m);
  return m;
}
function sendProfile(c) {
  if (c.profile) send(c, { t: 'profile', ...accounts.publicView(c.profile) });
}
// Ball Bucks earned in a match
function onReward(player, bucks, why, stat) {
  accounts.award(player.profile, bucks, stat);
  for (const c of clients) if (c.profile === player.profile) { send(c, { t: 'reward', bucks, why, total: c.profile.bucks }); sendProfile(c); }
}
const send = (c, obj) => { if (c.ws.readyState === 1) c.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

const hub = {
  stats() {
    return {
      online: clients.size,
      inMatch: [...clients].filter((c) => c.match).length,
      matches: [...rooms.values()].map((m) => ({ code: m.code, kind: m.kind, mode: m.mode, state: m.state, humans: m.humans.length, alive: m.state === 'play' ? m.alive.length : null })),
      parties: parties.size,
      players: [...clients].filter((c) => c.profile).map((c) => ({ name: c.name, bucks: c.profile.bucks, inMatch: !!c.match })),
      profiles: accounts.count(),
      accounts: accounts.adminList(),
    };
  },
  gift(name, amount) {
    const targets = new Set();
    if (name === '*') { for (const c of clients) if (c.profile) targets.add(c.profile); }
    else { const u = accounts.findByUsername(name); if (u) targets.add(u); } // works even if they're offline
    for (const u of targets) {
      accounts.award(u, amount);
      for (const c of clients) if (c.profile === u) { send(c, { t: 'reward', bucks: amount, why: 'a gift from the admin 🎁', total: u.bucks }); sendProfile(c); }
    }
    return targets.size;
  },
  broadcast(text, style = 'info') {
    const msg = JSON.stringify({ t: 'bc', text, style });
    for (const c of clients) send(c, msg);
    return clients.size;
  },
  pushInfo(info) {
    const msg = JSON.stringify({ t: 'info', ...info });
    for (const c of clients) send(c, msg);
  },
  globalParty(kind, title) {
    let m = [...rooms.values()].find((r) => r.kind === (kind === 'island' ? 'island' : 'partyRoyale') && r.canJoin());
    if (!m) {
      m = createMatch({ kind: kind === 'island' ? 'island' : 'partyRoyale', isPublic: true, mode: 'nobuild', difficulty: 'easy', title, code: kind === 'island' ? newCode(rooms) : newCode(rooms) });
      if (m.kind === 'island') m.start(); // island is open right away
    }
    const msg = JSON.stringify({ t: 'party_time', kind: m.kind, code: m.code, title });
    for (const c of clients) send(c, msg);
    return m.code;
  },
  setAdmin(username, on) {
    const u = accounts.setAdmin(username, on);
    if (u) for (const c of clients) if (c.profile === u) sendProfile(c);
    return u;
  },
  // in-game admin drop-down (only for accounts marked as admin)
  adminAction(c, m) {
    if (!c.profile || !c.profile.isAdmin) return;
    const reply = (msg, ok = true) => send(c, { t: 'admin_ok', msg, ok });
    const text = (v, n) => String(v || '').slice(0, n).trim();
    switch (m.action) {
      case 'party': {
        const code = hub.globalParty(m.kind === 'island' ? 'island' : 'royale', text(m.title, 80) || 'GLOBAL PARTY!');
        return reply(`🎉 Party started! Code ${code}`);
      }
      case 'endparty': hub.endParties(); return reply('Parties ended.');
      case 'broadcast': {
        const t = text(m.text, 200);
        if (!t) return reply('Type a message first', false);
        return reply(`📢 Sent to ${hub.broadcast(t, ['info', 'alert', 'hype'].includes(m.style) ? m.style : 'info')} players`);
      }
      case 'gift': {
        const amount = Math.round(Number(m.amount));
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return reply('Pick an amount from 1 to 100,000', false);
        const n = hub.gift(m.name === '*' ? '*' : text(m.name, 16), amount);
        return n ? reply(`🎁 Gifted ${amount} Ball Bucks to ${n} player${n === 1 ? '' : 's'}`) : reply('No player with that username', false);
      }
      case 'stats': {
        const st = hub.stats();
        return reply(`${st.online} online · ${st.inMatch} in matches · ${st.matches.length} matches · ${st.profiles} accounts`);
      }
    }
  },
  endParties() {
    for (const m of [...rooms.values()]) if (m.kind !== 'normal' && (m.kind === 'island' || m.state === 'lobby')) m.close();
    hub.broadcast('🎉 The party is over. Thanks for coming!', 'info');
  },
};
const admin = createAdmin({ root: ROOT, hub });

// ---------- friend parties ----------
function partyState(p) {
  return { t: 'party', code: p.code, leader: p.leader.name, members: [...p.members].map((c) => ({ name: c.name, skin: c.skin, busy: !!c.match })) };
}
function pushParty(p) { const s = partyState(p); for (const c of p.members) send(c, { ...s, youLead: c === p.leader }); }
function leaveParty(c) {
  const p = c.party;
  if (!p) return;
  p.members.delete(c);
  c.party = null;
  send(c, { t: 'party', code: null });
  if (!p.members.size) { parties.delete(p.code); return; }
  if (p.leader === c) p.leader = [...p.members][0];
  pushParty(p);
}

function joinMatch(c, m, team) {
  c.match = m;
  c.player = m.addHuman(c.ws, c.name, c.skin, team, c.profile);
}

// ---------- http ----------
const server = http.createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.startsWith('/api/') || url.startsWith('/admin/api/')) {
    if ((await admin.handle(req, res, url)) !== false) return;
  }
  if (url === '/') url = '/index.html';
  if (url === '/admin' || url === '/admin/') url = '/admin.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

const err = (c, msg) => send(c, { t: 'error', msg });

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  const c = { ws, name: 'Rookie', skin: sanitizeSkin(null), match: null, player: null, party: null };
  clients.add(c);
  send(c, { t: 'info', ...admin.publicInfo() });
  let msgCount = 0, msgWindow = Date.now();

  ws.on('message', (raw) => {
    const nowMs = Date.now();
    if (nowMs - msgWindow > 1000) { msgWindow = nowMs; msgCount = 0; }
    if (++msgCount > 120) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (c.match) { // in a match
      if (m.t === 'leave') {
        c.match.removeHuman(c.player); c.match = null; c.player = null;
        if (c.party) pushParty(c.party);
        return;
      }
      if (m.t === 'ping') return send(c, { t: 'pong', c: m.c });
      if (m.t === 'admin') return hub.adminAction(c, m);
      return c.match.handle(c.player, m);
    }

    if (!c.profile && !['hello', 'signup', 'login'].includes(m.t)) return send(c, { t: 'auth_needed' });
    switch (m.t) {
      // ---------- sign in ----------
      case 'hello': {
        if (!c.profile && m.token) {
          const u = accounts.resume(m.token);
          if (u) { c.profile = u; c.token = m.token; c.name = u.username; }
        }
        if (!c.profile) return send(c, { t: 'auth_needed' });
        c.skin = sanitizeSkin(m.skin, c.profile);
        sendProfile(c);
        if (c.party) pushParty(c.party);
        return;
      }
      case 'signup': case 'login': {
        if (c.profile) return;
        (m.t === 'signup' ? accounts.signup(m, ip) : accounts.login(m, ip)).then((r) => {
          if (r.error) return send(c, { t: 'auth_error', msg: r.error });
          c.profile = r.user; c.token = r.token; c.name = r.user.username;
          send(c, { t: 'auth', token: r.token, username: r.user.username });
          sendProfile(c);
        }).catch(() => send(c, { t: 'auth_error', msg: 'Something went wrong. Try again.' }));
        return;
      }
      case 'logout': {
        if (c.token) accounts.logout(c.token);
        leaveParty(c);
        c.profile = null; c.token = null; c.name = 'Rookie';
        return send(c, { t: 'auth_needed' });
      }
      case 'buy': {
        const problem = profiles.buy(c.profile, String(m.item || ''));
        if (problem) return err(c, problem);
        send(c, { t: 'bought', item: m.item });
        sendProfile(c);
        return;
      }
      case 'party_create': {
        leaveParty(c);
        const p = { code: newCode(parties), leader: c, members: new Set([c]), team: partyTeamSeq++ };
        parties.set(p.code, p); c.party = p; pushParty(p);
        return;
      }
      case 'party_join': {
        const p = parties.get(String(m.code || '').toUpperCase());
        if (!p) return err(c, 'No party with that code.');
        if (p.members.size >= 4) return err(c, 'That party is full (4 max).');
        leaveParty(c);
        p.members.add(c); c.party = p; pushParty(p);
        return;
      }
      case 'party_leave': return leaveParty(c);
      case 'admin': return hub.adminAction(c, m);
      case 'join': {
        c.skin = sanitizeSkin(m.skin, c.profile);
        const mode = m.mode === 'build' ? 'build' : 'nobuild';
        const party = c.party;
        if (party && party.leader !== c && !m.room) return err(c, 'Only your party leader can start. Or leave the party.');
        const group = party && party.leader === c ? [...party.members].filter((x) => !x.match) : [c];
        let match;
        if (m.create) match = createMatch({ mode, isPublic: false, difficulty: m.difficulty });
        else if (m.room) {
          const code = String(m.room).toUpperCase().slice(0, 4);
          match = rooms.get(code);
          if (!match) return err(c, `No room called ${code}. Check the code!`);
        } else {
          match = [...rooms.values()].find((r) => r.isPublic && r.kind === 'normal' && r.mode === mode && r.canJoin() && r.players.size + group.length <= MAX_PLAYERS)
            || createMatch({ mode, isPublic: true, difficulty: 'normal' });
        }
        if (!match.canJoin() || match.players.size + group.length > MAX_PLAYERS) return err(c, 'That room already started or is full.');
        const solo = m.room && party && party.leader !== c; // a member joining a party event alone
        for (const g of solo ? [c] : group) joinMatch(g, match, party ? party.team : 0);
        if (party) pushParty(party);
        return;
      }
    }
  });
  ws.on('close', () => {
    if (c.match && c.player) c.match.removeHuman(c.player);
    leaveParty(c);
    clients.delete(c);
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`🏈 Football Royale running at http://localhost:${PORT}   admin panel: http://localhost:${PORT}/admin`);
});
