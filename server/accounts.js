// Player accounts: username (public), email (stored only as a one-way hash), password (scrypt hash).
// Nobody, including the admin, can read a player's email or password back out of this data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SHOP } from '../shared/skins.js';

const USERNAME = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/; // single spaces between words are OK
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'slut', 'whore', 'dick', 'pussy', 'penis', 'vagina', 'rape', 'nazi', 'hitler', 'porn', 'sex', 'admin', 'moderator'];
const SESSION_DAYS = 30;
// Usernames listed in the ADMIN_USERS setting (comma separated) are admins automatically
const ADMIN_USERS = String(process.env.ADMIN_USERS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);

export function createAccounts(root) {
  const dir = process.env.FR_DATA_DIR || path.join(root, 'data');
  const file = path.join(dir, 'accounts.json');
  fs.mkdirSync(dir, { recursive: true });
  // secret "pepper" mixed into email hashes so they can't be looked up
  const pepperFile = path.join(dir, 'email-pepper.key');
  let pepper = process.env.EMAIL_PEPPER;
  if (!pepper) {
    try { pepper = fs.readFileSync(pepperFile, 'utf8').trim(); } catch { pepper = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(pepperFile, pepper, { mode: 0o600 }); }
  }
  let db = { users: {}, sessions: {} };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(file, JSON.stringify(db), { mode: 0o600 }); } catch (e) { console.error('account save failed', e.message); }
    }, 500);
  };
  const emailHash = (e) => crypto.createHmac('sha256', pepper).update(e.trim().toLowerCase()).digest('hex');
  const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const hashPw = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString('hex')))));
  const byUsername = (u) => Object.values(db.users).find((x) => x.usernameLower === String(u).toLowerCase());
  const byEmail = (e) => { const h = emailHash(e); return Object.values(db.users).find((x) => x.emailHash === h); };
  const fails = new Map(); // key -> {n, until}
  const locked = (k) => { const f = fails.get(k); return f && f.until > Date.now(); };
  const fail = (k) => { const f = fails.get(k) || { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; } fails.set(k, f); };

  function newSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions[tokenHash(token)] = { id: user.id, exp: Date.now() + SESSION_DAYS * 86400_000 };
    for (const [k, s] of Object.entries(db.sessions)) if (s.exp < Date.now()) delete db.sessions[k];
    save();
    return token;
  }

  return {
    async signup({ email, username, password, ageOk }, ip) {
      email = String(email || '').trim(); username = String(username || '').trim().toUpperCase(); password = String(password || ''); // names are ALL CAPS
      if (!ageOk) return { error: 'Please confirm you are 13 or older, or that a parent said it is OK.' };
      if (!EMAIL.test(email)) return { error: 'That email does not look right.' };
      if (!USERNAME.test(username) || username.length < 3 || username.length > 16) return { error: 'Usernames are 3-16 letters, numbers, _ or single spaces.' };
      if (BLOCKED.some((w) => username.toLowerCase().includes(w))) return { error: 'Please pick a different username.' };
      if (password.length < 6 || password.length > 200) return { error: 'Passwords need at least 6 characters.' };
      if (password.toLowerCase() === username.toLowerCase()) return { error: 'Your password can not be your username.' };
      if (locked('ip:' + ip)) return { error: 'Too many tries. Wait a minute.' };
      if (byUsername(username)) return { error: 'That username is taken.' };
      if (byEmail(email)) { fail('ip:' + ip); return { error: 'That email already has an account. Try logging in.' }; }
      const salt = crypto.randomBytes(16).toString('hex');
      const user = {
        id: crypto.randomBytes(8).toString('hex'), username, usernameLower: username.toLowerCase(),
        emailHash: emailHash(email), salt, pwHash: await hashPw(password, salt), created: Date.now(),
        bucks: 0, owned: [], stats: { wins: 0, kills: 0, matches: 0 },
      };
      if (ADMIN_USERS.includes(user.usernameLower)) user.isAdmin = true;
      db.users[user.id] = user;
      return { user, token: newSession(user) };
    },
    async login({ login, password }, ip) {
      login = String(login || '').trim(); password = String(password || '');
      const user = login.includes('@') ? byEmail(login) : byUsername(login);
      const key = 'acct:' + (user ? user.id : login.toLowerCase());
      if (locked(key) || locked('ip:' + ip)) return { error: 'Too many wrong tries. Wait a minute and try again.' };
      const ok = user && crypto.timingSafeEqual(Buffer.from(await hashPw(password, user.salt), 'hex'), Buffer.from(user.pwHash, 'hex'));
      if (!ok) { fail(key); fail('ip:' + ip); return { error: 'Wrong username/email or password.' }; }
      fails.delete(key);
      if (ADMIN_USERS.includes(user.usernameLower)) user.isAdmin = true;
      return { user, token: newSession(user) };
    },
    resume(token) {
      const s = db.sessions[tokenHash(token)];
      if (!s || s.exp < Date.now()) return null;
      const u = db.users[s.id] || null;
      if (u && u.username !== u.username.toUpperCase()) { u.username = u.username.toUpperCase(); save(); } // older accounts
      return u;
    },
    logout(token) { delete db.sessions[tokenHash(token)]; save(); },
    publicView(u) { return { username: u.username, bucks: u.bucks, owned: u.owned, stats: u.stats, isAdmin: !!u.isAdmin }; },
    setAdmin(username, on) { const u = byUsername(username); if (!u) return false; u.isAdmin = !!on; save(); return u; },
    award(u, amount, stat) {
      if (!u) return;
      u.bucks = Math.max(0, u.bucks + Math.round(amount));
      if (stat) u.stats[stat] = (u.stats[stat] || 0) + 1;
      save();
    },
    buy(u, itemId) {
      const item = SHOP.find((i) => i.id === itemId);
      if (!item) return 'That item is not in the shop.';
      if (u.owned.includes(item.id)) return 'You already own that!';
      if (u.bucks < item.price) return `You need ${item.price - u.bucks} more Ball Bucks.`;
      u.bucks -= item.price;
      u.owned.push(item.id);
      save();
      return null;
    },
    findByUsername: byUsername,
    // Admin view: usernames and game info ONLY (never emails or passwords)
    adminList() {
      return Object.values(db.users).map((u) => ({ username: u.username, bucks: u.bucks, wins: u.stats.wins, kills: u.stats.kills, created: u.created, isAdmin: !!u.isAdmin }))
        .sort((a, b) => b.created - a.created);
    },
    count() { return Object.keys(db.users).length; },
  };
}
