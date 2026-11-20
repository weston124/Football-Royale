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
import { createStatic, securityHeaders } from './static.js';
import { clientIp, rateLimiter } from './net.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;

// Limits (all can be changed with environment variables)
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 30;  // a school class can share one IP
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS) || 3000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 150;
const MAX_AUTH_IN_FLIGHT = 64; // password hashing is CPU heavy
// Extra allowed WebSocket origins, comma separated (same origin and localhost are always allowed)
const EXTRA_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// three.js is served from a versioned URL so browsers can cache it forever
const THREE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version;
const THREE_ONLY = ['build/', 'examples/jsm/'];
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  [`/vendor/three@${THREE_VERSION}/`, path.join(ROOT, 'node_modules/three'), { cache: 'immutable', only: THREE_ONLY }],
  ['/vendor/three/', path.join(ROOT, 'node_modules/three'), { only: THREE_ONLY }],
  ['/', path.join(ROOT, 'client')],
];
const statics = createStatic({
  mounts: MOUNTS,
  rewriteHtml(html, { origin }) {
    html = html.replaceAll('"/vendor/three/', `"/vendor/three@${THREE_VERSION}/`);
    // share previews (Open Graph / Twitter) need absolute URLs
    if (origin) html = html.replace(/(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")\//g, `$1${origin}/`);
    // contact address on the privacy/terms pages (CONTACT_EMAIL setting)
    if (CONTACT_EMAIL) html = html.replace(/<span data-contact>[^<]*<\/span>/g, `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`);
    return html;
  },
});
const CONTACT_EMAIL = /^[^\s@<>"'&]{1,64}@[^\s@<>"'&]{1,190}$/.test(process.env.CONTACT_EMAIL || '') ? process.env.CONTACT_EMAIL : '';
if (!CONTACT_EMAIL) console.warn('⚠️  CONTACT_EMAIL is not set: the privacy and terms pages have no contact address for parents.');

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
  async resetPassword(username) {
    const r = await accounts.adminResetPassword(username);
    if (r) signOutEverywhere(r.user, 'An admin reset your password. Log in with the temporary password they give you.');
    return r;
  },
  deleteUser(username) {
    const u = accounts.adminDelete(username);
    if (u) signOutEverywhere(u, 'This account was deleted.');
    return u;
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
      case 'resetpw': {
        const name = text(m.name, 16);
        if (!name) return reply('Type a username first', false);
        hub.resetPassword(name).then((r) => {
          if (!r) return reply('No player with that username', false);
          console.log(`admin ${c.name} reset the password of ${r.user.username}`);
          reply(`🔑 ${r.user.username}'s temporary password: ${r.temp}  (they change it in ⚙️ Settings)`);
        }).catch(() => reply('Something went wrong. Try again.', false));
        return;
      }
      case 'armory': { // 🔫 give yourself weapons (Match.armory checks the match kind, alive, landed)
        if (!c.match || !c.player || c.match.closed) return reply('Join a Private Room or Party Island first, then open the armory', false);
        const r = c.match.armory(c.player, { give: text(m.weapon, 16), r: Number(m.rarity) | 0, refill: !!m.refill, everything: !!m.everything });
        return reply(r.msg, r.ok);
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

// sign every connection of this account out (after the account was deleted)
function signOutEverywhere(u, why) {
  for (const c of clients) {
    if (c.profile !== u) continue;
    if (c.match && c.player) c.match.removeHuman(c.player);
    c.match = null; c.player = null;
    leaveParty(c);
    c.profile = null; c.token = null; c.name = 'Rookie';
    send(c, { t: 'account_deleted', msg: why });
    send(c, { t: 'auth_needed' });
  }
}

function joinMatch(c, m, team) {
  c.match = m;
  c.player = m.addHuman(c.ws, c.name, c.skin, team, c.profile);
}

// ---------- http ----------
const server = http.createServer(async (req, res) => {
  try {
    securityHeaders(req, res);
    let url;
    try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); return res.end('Bad request'); }
    if (url.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
    if (url === '/healthz') { res.writeHead(shuttingDown ? 503 : 200, { 'Cache-Control': 'no-store' }); return res.end(shuttingDown ? 'shutting down' : 'ok'); }
    if (url.startsWith('/api/') || url.startsWith('/admin/api/')) {
      if ((await admin.handle(req, res, url)) !== false) return;
    }
    if (url === '/') url = '/index.html';
    if (url === '/admin' || url === '/admin/') url = '/admin.html';
    if (url === '/privacy' || url === '/terms' || url === '/credits') url += '.html';
    if (await statics.serve(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  } catch (e) {
    console.error('http error', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000; // longer than the proxy's idle timeout

const err = (c, msg) => send(c, { t: 'error', msg });

// Browsers send an Origin header with WebSockets: only our own pages (and localhost for
// development) may connect. Non-browser clients send none and are allowed (they could fake it).
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let o;
  try { o = new URL(origin); } catch { return false; }
  if (o.host.toLowerCase() === String(req.headers.host || '').toLowerCase()) return true;
  if (['localhost', '127.0.0.1', '[::1]'].includes(o.hostname)) return true;
  return EXTRA_ORIGINS.includes(origin.toLowerCase());
}
const connsPerIp = new Map();
const authLimiter = rateLimiter(30, 60_000);      // sign-in attempts per IP per minute
const roomLimiter = rateLimiter(10, 60_000);      // private rooms created per IP per minute
let authInFlight = 0;

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false,
  verifyClient: ({ req }, done) => {
    if (shuttingDown) return done(false, 503, 'Restarting');
    if (!originOk(req)) return done(false, 403, 'Forbidden origin');
    const ip = clientIp(req);
    if (clients.size >= MAX_CONNECTIONS) return done(false, 503, 'Server full');
    if ((connsPerIp.get(ip) || 0) >= MAX_CONN_PER_IP) return done(false, 429, 'Too many connections');
    done(true);
  },
});
wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  connsPerIp.set(ip, (connsPerIp.get(ip) || 0) + 1);
  const c = { ws, name: 'Rookie', skin: sanitizeSkin(null), match: null, player: null, party: null, alive: true };
  clients.add(c);
  send(c, { t: 'info', ...admin.publicInfo() });
  let msgCount = 0, msgWindow = Date.now(), floods = 0;
  ws.on('pong', () => { c.alive = true; });

  ws.on('message', (raw, isBinary) => {
    const nowMs = Date.now();
    if (nowMs - msgWindow > 1000) { msgWindow = nowMs; msgCount = 0; }
    if (++msgCount > 120) {
      if (msgCount === 121 && ++floods > 10) ws.close(1008, 'Too many messages'); // flooding again and again
      return;
    }
    if (isBinary) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    try { handleMessage(c, m, ip); } catch (e) { console.error('message handler error', m.t, e); }
  });
  ws.on('close', () => {
    if (c.match && c.player) try { c.match.removeHuman(c.player); } catch (e) { console.error(e); }
    c.match = null; c.player = null;
    leaveParty(c);
    clients.delete(c);
    const n = (connsPerIp.get(ip) || 1) - 1;
    if (n > 0) connsPerIp.set(ip, n); else connsPerIp.delete(ip);
  });
  ws.on('error', () => {});
});

// drop connections that stopped answering (closed laptop lids, lost Wi-Fi)
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* closing */ }
  }
}, 30_000).unref();

function handleMessage(c, m, ip) {

    if (c.match) { // in a match
      if (m.t === 'leave') {
        c.match.removeHuman(c.player); c.match = null; c.player = null;
        if (c.party) pushParty(c.party);
        return;
      }
      if (m.t === 'ping') return send(c, { t: 'pong', c: Number.isFinite(m.c) ? m.c : 0 });
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
        if (c.profile || c.authBusy) return;
        if (!authLimiter.allow(ip)) return send(c, { t: 'auth_error', msg: 'Too many tries. Wait a minute.' });
        if (authInFlight >= MAX_AUTH_IN_FLIGHT) return send(c, { t: 'auth_error', msg: 'The server is very busy. Try again in a few seconds.' });
        const fields = { email: m.email, username: m.username, password: m.password, ageOk: m.ageOk === true, login: m.login };
        for (const k of ['email', 'username', 'password', 'login']) fields[k] = typeof fields[k] === 'string' ? fields[k].slice(0, 300) : '';
        c.authBusy = true; authInFlight++;
        (m.t === 'signup' ? accounts.signup(fields, ip) : accounts.login(fields, ip)).then((r) => {
          if (r.error) return send(c, { t: 'auth_error', msg: r.error });
          if (c.ws.readyState !== 1) return;
          c.profile = r.user; c.token = r.token; c.name = r.user.username;
          send(c, { t: 'auth', token: r.token, username: r.user.username });
          sendProfile(c);
        }).catch((e) => { console.error('auth error', e); send(c, { t: 'auth_error', msg: 'Something went wrong. Try again.' }); })
          .finally(() => { c.authBusy = false; authInFlight--; });
        return;
      }
      case 'delete_account': {
        if (c.authBusy) return;
        if (typeof m.password !== 'string' || !m.password) return send(c, { t: 'delete_error', msg: 'Type your password to delete your account.' });
        if (!authLimiter.allow(ip)) return send(c, { t: 'delete_error', msg: 'Too many tries. Wait a minute.' });
        const u = c.profile;
        c.authBusy = true; authInFlight++;
        accounts.deleteAccount(u, m.password.slice(0, 300), ip).then((r) => {
          if (r.error) return send(c, { t: 'delete_error', msg: r.error });
          console.log(`account ${u.username} deleted by its owner`);
          signOutEverywhere(u, 'Your account and everything in it was deleted. Bye for now!');
        }).catch((e) => { console.error('delete error', e); send(c, { t: 'delete_error', msg: 'Something went wrong. Try again.' }); })
          .finally(() => { c.authBusy = false; authInFlight--; });
        return;
      }
      case 'change_password': {
        if (c.authBusy) return;
        if (typeof m.old !== 'string' || typeof m.new !== 'string') return send(c, { t: 'pw_result', ok: false, msg: 'Fill in both boxes.' });
        if (!authLimiter.allow(ip)) return send(c, { t: 'pw_result', ok: false, msg: 'Too many tries. Wait a minute.' });
        c.authBusy = true; authInFlight++;
        accounts.changePassword(c.profile, m.old.slice(0, 300), m.new.slice(0, 300), ip).then((r) => {
          send(c, r.error ? { t: 'pw_result', ok: false, msg: r.error } : { t: 'pw_result', ok: true, msg: 'Password changed! ✅' });
          if (!r.error) sendProfile(c);
        }).catch(() => send(c, { t: 'pw_result', ok: false, msg: 'Something went wrong. Try again.' }))
          .finally(() => { c.authBusy = false; authInFlight--; });
        return;
      }
      case 'change_email': {
        if (c.authBusy) return;
        if (typeof m.email !== 'string' || typeof m.password !== 'string') return send(c, { t: 'email_result', ok: false, msg: 'Fill in both boxes.' });
        if (!authLimiter.allow(ip)) return send(c, { t: 'email_result', ok: false, msg: 'Too many tries. Wait a minute.' });
        c.authBusy = true; authInFlight++;
        accounts.changeEmail(c.profile, m.password.slice(0, 300), m.email.slice(0, 300), ip).then((r) => {
          send(c, r.error ? { t: 'email_result', ok: false, msg: r.error } : { t: 'email_result', ok: true, msg: 'Email changed! ✅ Use it to log in next time.' });
        }).catch(() => send(c, { t: 'email_result', ok: false, msg: 'Something went wrong. Try again.' }))
          .finally(() => { c.authBusy = false; authInFlight--; });
        return;
      }
      case 'logout': {
        if (c.token) accounts.logout(c.token);
        leaveParty(c);
        c.profile = null; c.token = null; c.name = 'Rookie';
        return send(c, { t: 'auth_needed' });
      }
      case 'buy': {
        const problem = accounts.buy(c.profile, String(m.item || '').slice(0, 64));
        if (problem) return err(c, problem);
        send(c, { t: 'bought', item: String(m.item) });
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
        const p = parties.get(String(m.code || '').toUpperCase().slice(0, 4));
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
        if (m.create) {
          if (rooms.size >= MAX_ROOMS) return err(c, 'The server is full right now. Try Quick Play or try again soon!');
          if (!roomLimiter.allow(ip)) return err(c, 'Slow down! Wait a minute before making another room.');
          match = createMatch({ mode, isPublic: false, difficulty: ['easy', 'normal', 'hard'].includes(m.difficulty) ? m.difficulty : 'normal' });
        }
        else if (m.room) {
          const code = String(m.room).toUpperCase().slice(0, 4);
          match = rooms.get(code);
          if (!match) return err(c, `No room called ${code}. Check the code!`);
        } else {
          match = [...rooms.values()].find((r) => r.isPublic && r.kind === 'normal' && r.mode === mode && r.canJoin() && r.players.size + group.length <= MAX_PLAYERS);
          if (!match && rooms.size >= MAX_ROOMS) return err(c, 'The server is full right now. Try again in a minute!');
          match = match || createMatch({ mode, isPublic: true, difficulty: 'normal' });
        }
        if (!match.canJoin() || match.players.size + group.length > MAX_PLAYERS) return err(c, 'That room already started or is full.');
        const solo = m.room && party && party.leader !== c; // a member joining a party event alone
        for (const g of solo ? [c] : group) joinMatch(g, match, party ? party.team : 0);
        if (party) pushParty(party);
        return;
      }
    }
}

server.on('error', (e) => { console.error('Server could not start:', e.message); process.exit(1); });
server.listen(PORT, () => {
  const port = server.address().port;
  console.log(`🏈 Football Royale running at http://localhost:${port}   admin panel: http://localhost:${port}/admin`);
  statics.warm([`/vendor/three@${THREE_VERSION}/build/three.module.js`, '/assets/human.bin', '/assets/human_f.bin', '/js/main.js', '/js/game.js', '/js/human.js', '/js/models.js', '/css/style.css']);
});

// ---------- shutdown: save everything and tell players (Render sends SIGTERM on every deploy) ----------
let shuttingDown = false;
function flushAll() {
  try { accounts.flush(); } catch (e) { console.error('account flush failed', e); }
  try { admin.flush(); } catch (e) { console.error('admin flush failed', e); }
}
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${sig}: saving data and closing connections...`);
  flushAll();
  hub.broadcast('🔧 The server is restarting for an update. You will be back in about a minute!', 'alert');
  server.close();
  setTimeout(() => {
    for (const c of clients) try { c.ws.close(1012, 'Server restarting'); } catch { /* ignore */ }
    flushAll();
    setTimeout(() => process.exit(0), 300);
  }, 1500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// One bad bug should not end every match: log it, save data and keep going, unless errors pile up.
let crashes = [];
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT EXCEPTION', e);
  flushAll();
  crashes = crashes.filter((t) => t > Date.now() - 60_000); crashes.push(Date.now());
  if (crashes.length > 20) { console.error('Too many errors, restarting.'); process.exit(1); }
});
process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION', e));
