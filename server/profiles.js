// Player profiles: Ball Bucks, owned Longhorn Shop items and stats.
// Each browser keeps a secret token; the real numbers live here on the server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SHOP } from '../shared/skins.js';

export function createProfiles(root) {
  const file = path.join(root, 'data', 'profiles.json');
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); } catch (e) { console.error('profile save failed', e.message); }
    }, 1000);
  };

  const fresh = () => ({ name: 'Rookie', bucks: 0, owned: [], stats: { wins: 0, kills: 0, matches: 0 }, seen: Date.now() });

  return {
    // Find a profile by token, or make a new one.
    login(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token) || !db[token]) {
        token = crypto.randomBytes(24).toString('hex');
        db[token] = fresh();
        save();
      }
      const p = db[token];
      p.seen = Date.now();
      return { token, profile: p };
    },
    publicView(p) { return { bucks: p.bucks, owned: p.owned, stats: p.stats }; },
    award(p, amount, stat) {
      if (!p) return;
      p.bucks = Math.max(0, p.bucks + Math.round(amount));
      if (stat) p.stats[stat] = (p.stats[stat] || 0) + 1;
      save();
    },
    buy(p, itemId) {
      const item = SHOP.find((i) => i.id === itemId);
      if (!item) return 'That item is not in the shop.';
      if (p.owned.includes(item.id)) return 'You already own that!';
      if (p.bucks < item.price) return `You need ${item.price - p.bucks} more Ball Bucks.`;
      p.bucks -= item.price;
      p.owned.push(item.id);
      save();
      return null;
    },
    count() { return Object.keys(db).length; },
    save,
  };
}
