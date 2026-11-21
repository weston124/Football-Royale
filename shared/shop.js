// The Daily Item Shop: a new pick of items every day at midnight UTC.
// The pick comes from a seeded RNG on the UTC date, so it is the same for every player and
// every server; the server decides what can be bought (server/accounts.js buy()).
import { DAILY_POOL, SHOP, NEW_BATCH_DATE, isNewItem } from './skins.js';
import { makeRng } from './rng.js';

// newOutfits/newEmotes: guaranteed spots for items of the newest batch while they are NEW (isNewItem)
export const DAILY = { featured: 2, outfits: 4, emotes: 3, maxForced: 3, newOutfits: 2, newEmotes: 1 };
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

// The newest batch in a fixed (seeded) order, so its spotlight cycles through every new item
const BATCH_ORDER = shuffled(DAILY_POOL.filter((i) => i.added === NEW_BATCH_DATE), makeRng(seedOf('football-royale-batch|' + NEW_BATCH_DATE)));
const cycle = (list, start, n) => (list.length ? Array.from({ length: Math.min(n, list.length) }, (_, k) => list[(start + k) % list.length]) : []);

function pick(dateKey) {
  const rnd = makeRng(seedOf('football-royale-daily|' + dateKey));
  const outfits = shuffled(DAILY_POOL.filter((i) => i.kind === 'skin'), rnd);
  const emotes = shuffled(DAILY_POOL.filter((i) => i.kind === 'emote'), rnd);
  // While the newest batch is NEW, every day spotlights some of it: one Featured outfit, a few more outfits
  // and an emote, walking through the batch in order (all of it shows up within about a week).
  const fresh = BATCH_ORDER.filter((i) => isNewItem(i, dateKey));
  const day = Math.round((Date.parse(dateKey) - Date.parse(NEW_BATCH_DATE)) / 86400_000);
  const freshOut = fresh.filter((i) => i.kind === 'skin'), freshEm = fresh.filter((i) => i.kind === 'emote');
  const spotFeat = cycle(freshOut.filter((i) => i.rarity >= 3), day, 1);
  const spotOut = cycle(freshOut, day * DAILY.newOutfits, DAILY.newOutfits);
  const spotEm = cycle(freshEm, day * DAILY.newEmotes, DAILY.newEmotes);
  const take = (first, rest, n, skip = []) => [...new Set([...first, ...rest])].filter((i) => !skip.includes(i)).slice(0, n);
  // Featured: the big cards, always Epic or Legendary outfits
  const featured = take(spotFeat, outfits.filter((i) => i.rarity >= 3), DAILY.featured);
  const regular = [...take(spotOut, outfits, DAILY.outfits, featured), ...take(spotEm, emotes, DAILY.emotes)];
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
