// Football Royale server: serves the game files, runs matches, friend parties
// and the admin tools over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './match.js';
import { createAdmin } from './admin.js';
import { createProfiles } from './profiles.js';
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
const profiles = createProfiles(ROOT);
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
  if (c.profile) send(c, { t: 'profile', token: c.token, ...profiles.publicView(c.profile) });
}
// Ball Bucks earned in a match
function onReward(player, bucks, why, stat) {
  profiles.award(player.profile, bucks, stat);
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
      profiles: profiles.count(),
    };
  },
  gift(name, amount) {
    let n = 0;
    for (const c of clients) {
      if (!c.profile || (name !== '*' && c.name !== name)) continue;
      profiles.award(c.profile, amount);
      send(c, { t: 'reward', bucks: amount, why: 'a gift from the admin 🎁', total: c.profile.bucks });
      sendProfile(c);
      n++;
    }
    return n;
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

const cleanName = (n) => String(n || '').replace(/[^\w \-!.?]/g, '').trim().slice(0, 16) || 'Rookie';
const err = (c, msg) => send(c, { t: 'error', msg });

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
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
      return c.match.handle(c.player, m);
    }

    switch (m.t) {
      case 'hello': {
        if (!c.profile || (m.token && m.token !== c.token)) {
          const { token, profile } = profiles.login(m.token);
          c.token = token; c.profile = profile;
        }
        c.name = cleanName(m.name); c.profile.name = c.name;
        c.skin = sanitizeSkin(m.skin, c.profile);
        sendProfile(c);
        if (c.party) pushParty(c.party);
        return;
      }
      case 'buy': {
        if (!c.profile) return;
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
      case 'join': {
        c.name = cleanName(m.name); c.skin = sanitizeSkin(m.skin, c.profile || null);
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
