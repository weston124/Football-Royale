// The Daily Item Shop: a new pick of items every day at midnight UTC.
// The pick comes from a seeded RNG on the UTC date, so it is the same for every player and
// every server; the server decides what can be bought (server/accounts.js buy()).
import { DAILY_POOL, SHOP } from './skins.js';
import { makeRng } from './rng.js';

export const DAILY = { featured: 2, outfits: 3, emotes: 2, maxForced: 3 };
export const DAY_MS = 86400_000;

// 'YYYY-MM-DD' of the UTC day that contains time t
export const utcDateKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
// when the next UTC day starts (the shop changes)
export function nextResetAt(t = Date.now()) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export const isDateKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

// FNV-1a: a stable 32-bit seed from a string
function seedOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const dailyItem = (id) => DAILY_POOL.find((i) => i.id === id) || null;

function pick(dateKey) {
  const rnd = makeRng(seedOf('football-royale-daily|' + dateKey));
  const outfits = shuffled(DAILY_POOL.filter((i) => i.kind === 'skin'), rnd);
  const emotes = shuffled(DAILY_POOL.filter((i) => i.kind === 'emote'), rnd);
  // Featured: the big cards, always Epic or Legendary outfits
  const featured = outfits.filter((i) => i.rarity >= 3).slice(0, DAILY.featured);
  const regular = [...outfits.filter((i) => !featured.includes(i)).slice(0, DAILY.outfits), ...emotes.slice(0, DAILY.emotes)];
  return { featured, regular };
}

// Today's Daily Shop. forced = item ids an admin added to today's rotation (shown as Featured too).
// Returns ids only: { date, resetsAt, featured: [id], items: [id] }
export function dailyShop(dateKey = utcDateKey(), forced = []) {
  const { featured, regular } = pick(dateKey);
  const f = featured.map((i) => i.id), r = regular.map((i) => i.id);
  for (const id of forced || []) {
    if (!dailyItem(id) || f.includes(id)) continue;
    const k = r.indexOf(id);
    if (k >= 0) r.splice(k, 1);
    f.push(id);
  }
  const [y, m, d] = dateKey.split('-').map(Number);
  return { date: dateKey, resetsAt: Date.UTC(y, m - 1, d + 1), featured: f, items: r };
}
export const dailyIds = (shop) => [...shop.featured, ...shop.items];

// The full item (from either shop) by id
export const anyShopItem = (id) => SHOP.find((i) => i.id === id) || dailyItem(id);
