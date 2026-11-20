// Player accounts: username (public), email (stored only as a one-way hash), password (scrypt hash).
// Nobody, including the admin, can read a player's email or password back out of this data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SHOP } from '../shared/skins.js';
import { dailyItem, dailyIds } from '../shared/shop.js';
import { loadJson, jsonStore, writeFileAtomic } from './safefile.js';

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
  const loaded = loadJson(file, { validate: (d) => d && typeof d === 'object' && d.users && typeof d.users === 'object' });
  let db = { users: {}, sessions: {}, ...(loaded.data || {}) };
  if (!pepper) {
    try { pepper = fs.readFileSync(pepperFile, 'utf8').trim(); } catch { /* none yet */ }
    if (!pepper) {
      if (Object.keys(db.users).length) {
        console.error(`!!! DATA WARNING: ${pepperFile} is missing but accounts exist. Logging in with an email and the`
          + ' "email already used" check will not work for existing accounts (usernames still work). Restore the key file if you can.');
      }
      pepper = crypto.randomBytes(32).toString('hex');
      writeFileAtomic(pepperFile, pepper);
    }
  }
  const store = jsonStore(file, () => db);
  const save = store.save;
  const emailHash = (e) => crypto.createHmac('sha256', pepper).update(e.trim().toLowerCase()).digest('hex');
  const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const hashPw = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString('hex')))));
  const byUsername = (u) => Object.values(db.users).find((x) => x.usernameLower === String(u).toLowerCase());
  const byEmail = (e) => { const h = emailHash(e); return Object.values(db.users).find((x) => x.emailHash === h); };
  const fails = new Map(); // key -> {n, until}
  // new accounts per IP: a whole school class can sign up from one IP, so this is generous
  const SIGNUPS_PER_IP_HOUR = Number(process.env.SIGNUPS_PER_IP_HOUR) || 30;
  const signups = new Map(); // ip -> [timestamps]
  const signupAllowed = (ip) => {
    const t = Date.now(), list = (signups.get(ip) || []).filter((x) => x > t - 3600_000);
    signups.set(ip, list);
    if (signups.size > 50_000) signups.clear(); // memory guard
    return list.length < SIGNUPS_PER_IP_HOUR;
  };
  const checkPw = async (user, password) => crypto.timingSafeEqual(Buffer.from(await hashPw(String(password || '').slice(0, 1000), user.salt), 'hex'), Buffer.from(user.pwHash, 'hex'));
  function removeUser(user) {
    delete db.users[user.id];
    for (const [k, s] of Object.entries(db.sessions)) if (s.id === user.id) delete db.sessions[k];
    store.save(); store.flush(); // deletions are written right away
  }
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
      if (!signupAllowed(ip)) return { error: 'Too many new accounts from this network. Try again later.' };
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
      signups.get(ip)?.push(Date.now());
      const token = newSession(user);
      store.flush(); // a brand-new account is written to disk right away
      return { user, token };
    },
    async login({ login, password }, ip) {
      login = String(login || '').trim(); password = String(password || '');
      const user = login.includes('@') ? byEmail(login) : byUsername(login);
      const key = 'acct:' + (user ? user.id : login.toLowerCase());
      if (locked(key) || locked('ip:' + ip)) return { error: 'Too many wrong tries. Wait a minute and try again.' };
      const ok = user && await checkPw(user, password);
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
    publicView(u) { return { username: u.username, bucks: u.bucks, owned: u.owned, stats: u.stats, isAdmin: !!u.isAdmin, mustChangePw: !!u.mustChangePw }; },
    setAdmin(username, on) { const u = byUsername(username); if (!u) return false; u.isAdmin = !!on; save(); return u; },
    award(u, amount, stat) {
      if (!u) return;
      u.bucks = Math.max(0, u.bucks + Math.round(amount));
      if (stat) u.stats[stat] = (u.stats[stat] || 0) + 1;
      save();
    },
    // daily = today's Daily Item Shop ({featured, items} ids, see shared/shop.js). Longhorn items
    // are always for sale; Daily items only while they are in today's rotation.
    buy(u, itemId, daily = null) {
      const item = SHOP.find((i) => i.id === itemId) || (daily && dailyIds(daily).includes(itemId) ? dailyItem(itemId) : null);
      if (!item) return dailyItem(itemId) ? 'That item is not in today\'s Daily Shop. Check back tomorrow!' : 'That item is not in the shop.';
      if (u.owned.includes(item.id)) return 'You already own that!';
      if (u.bucks < item.price) return `You need ${item.price - u.bucks} more Ball Bucks.`;
      u.bucks -= item.price;
      u.owned.push(item.id);
      save();
      return null;
    },
    // the player deletes their own account (needs their password)
    async deleteAccount(user, password, ip) {
      if (!user || !db.users[user.id]) return { error: 'No account.' };
      const key = 'acct:' + user.id;
      if (locked(key) || locked('ip:' + ip)) return { error: 'Too many wrong tries. Wait a minute and try again.' };
      if (!(await checkPw(user, password))) { fail(key); fail('ip:' + ip); return { error: 'Wrong password.' }; }
      if (!db.users[user.id]) return { error: 'No account.' };
      removeUser(user);
      return { ok: true };
    },
    // admin gives a player a temporary password (the old one stops working, all their devices sign out)
    async adminResetPassword(username) {
      const u = byUsername(String(username || '').trim());
      if (!u) return null;
      const W = ['BLITZ', 'PYLON', 'HUDDLE', 'SPIRAL', 'KICKOFF', 'ENDZONE', 'TURF', 'ROOKIE', 'GRIDIRON', 'SNAP', 'PUNT', 'TACKLE'];
      const temp = `${W[crypto.randomInt(W.length)]}-${crypto.randomInt(1000, 10000)}-${W[crypto.randomInt(W.length)]}`;
      u.salt = crypto.randomBytes(16).toString('hex');
      u.pwHash = await hashPw(temp, u.salt);
      u.mustChangePw = true;
      for (const [k, s] of Object.entries(db.sessions)) if (s.id === u.id) delete db.sessions[k];
      store.save(); store.flush();
      return { user: u, temp };
    },
    // a signed-in player changes their email (needs their password); only the scrambled hash is stored
    async changeEmail(user, password, newEmail, ip) {
      if (!user || !db.users[user.id]) return { error: 'No account.' };
      newEmail = String(newEmail || '').trim();
      const key = 'acct:' + user.id;
      if (locked(key) || locked('ip:' + ip)) return { error: 'Too many wrong tries. Wait a minute and try again.' };
      if (!EMAIL.test(newEmail)) return { error: 'That email does not look right.' };
      if (!(await checkPw(user, password))) { fail(key); fail('ip:' + ip); return { error: 'Wrong password.' }; }
      const other = byEmail(newEmail);
      if (other && other !== user) return { error: 'That email already has another account.' };
      user.emailHash = emailHash(newEmail);
      store.save(); store.flush();
      return { ok: true };
    },
    // a signed-in player changes their own password (needs the current one)
    async changePassword(user, oldPw, newPw, ip) {
      if (!user || !db.users[user.id]) return { error: 'No account.' };
      newPw = String(newPw || '');
      const key = 'acct:' + user.id;
      if (locked(key) || locked('ip:' + ip)) return { error: 'Too many wrong tries. Wait a minute and try again.' };
      if (!(await checkPw(user, oldPw))) { fail(key); fail('ip:' + ip); return { error: 'Your current password is not right.' }; }
      if (newPw.length < 6 || newPw.length > 200) return { error: 'New passwords need at least 6 characters.' };
      if (newPw.toLowerCase() === user.usernameLower) return { error: 'Your password can not be your username.' };
      user.salt = crypto.randomBytes(16).toString('hex');
      user.pwHash = await hashPw(newPw, user.salt);
      delete user.mustChangePw;
      store.save(); store.flush();
      return { ok: true };
    },
    // admin deletes an account by username
    adminDelete(username) {
      const u = byUsername(String(username || '').trim());
      if (!u) return null;
      removeUser(u);
      return u;
    },
    flush: () => store.flush(),
    findByUsername: byUsername,
    // Admin view: usernames and game info ONLY (never emails or passwords)
    adminList() {
      return Object.values(db.users).map((u) => ({ username: u.username, bucks: u.bucks, wins: u.stats.wins, kills: u.stats.kills, created: u.created, isAdmin: !!u.isAdmin }))
        .sort((a, b) => b.created - a.created);
    },
    count() { return Object.keys(db.users).length; },
  };
}
