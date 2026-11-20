// Skins, emotes and the Longhorn Item Shop. All designs are original to Football Royale.

export const SKIN_TONES = ['#f6d3b3', '#e8b48a', '#c98e62', '#a8693f', '#7a4a2a', '#4f2f1c'];
export const HAIR_COLORS = ['#b8894f', '#8a6239', '#5a3d24', '#2e1f14', '#121010', '#e0c27a', '#a8452a'];
export const HAIR_STYLES = ['wavy', 'flow', 'short', 'buzz'];
export const EYE_COLORS = ['#3d78b8', '#5f8f6a', '#5a3a22', '#2a1a10', '#7a8a96'];

// unlock: earned by playing. price: bought with Ball Bucks in the Longhorn Item Shop, or, with
// shop: 'daily', in the Daily Item Shop when today's rotation has it (shared/shop.js).
export const SKIN_PRESETS = [
  // style: extra uniform details drawn by the game (lightning bolts, towel, pads, crowns...)
  { id: 'thunder', team: 'Royale Thunder', jersey: '#1c2030', accent: '#d42a2a', helmet: '#1c2030', stripe: '#d42a2a', mask: '#d9d9d9', pants: '#1c2030',
    style: { bolts: true, towel: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#d42a2a' } },
  // ---------- the football crew ----------
  { id: 'pylon',    team: 'Pylon Prince',     jersey: '#ff6b1a', accent: '#ffffff', helmet: '#ff6b1a', stripe: '#ffffff', mask: '#ffffff', pants: '#ffffff', body: 'm' },
  { id: 'tank',     team: 'Two-Point Tank',   jersey: '#2e5a2e', accent: '#f2c14e', helmet: '#f2c14e', stripe: '#2e5a2e', mask: '#2e5a2e', pants: '#f2c14e', body: 'm' },
  { id: 'hailmary', team: 'Hail Mary Hero',   jersey: '#f4f4f4', accent: '#2050c8', helmet: '#2050c8', stripe: '#f4f4f4', mask: '#f4f4f4', pants: '#2050c8', body: 'm' },
  { id: 'storm',    team: 'Sideline Storm',   jersey: '#6a2bd1', accent: '#3fe0d0', helmet: '#6a2bd1', stripe: '#3fe0d0', mask: '#ffffff', pants: '#ffffff', body: 'f' },
  { id: 'redzone',  team: 'Red Zone Queen',   jersey: '#c8102e', accent: '#f4f4f4', helmet: '#111111', stripe: '#c8102e', mask: '#c8102e', pants: '#111111', body: 'f' },
  { id: 'picksix',  team: 'Pick-Six Phantom', jersey: '#101820', accent: '#00e5ff', helmet: '#101820', stripe: '#00e5ff', mask: '#00e5ff', pants: '#101820', body: 'f',
    style: { bolts: true, towel: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#00e5ff' } },
  { id: 'zebra',    team: 'Zebra Captain',    jersey: '#f4f4f4', accent: '#111111', helmet: '#f4f4f4', stripe: '#111111', mask: '#111111', pants: '#f0f0f0', body: 'm',
    style: { referee: true, cleats: '#151515' } },
  { id: 'sergeant', team: 'Sideline Sergeant', jersey: '#f4f4f4', accent: '#111111', helmet: '#111111', stripe: '#f4f4f4', mask: '#111111', pants: '#151515', body: 'm',
    style: { referee: true, cleats: '#151515' } },
  { id: 'llamas',   team: 'Lava Llamas',       jersey: '#e2471f', accent: '#ffd23f', helmet: '#e2471f', stripe: '#ffd23f', mask: '#222222', pants: '#ffffff' },
  { id: 'narwhals', team: 'Neon Narwhals',     jersey: '#14d1c4', accent: '#ff3fa4', helmet: '#1d1f3a', stripe: '#14d1c4', mask: '#ff3fa4', pants: '#1d1f3a' },
  { id: 'coyotes',  team: 'Cosmic Coyotes',    jersey: '#4b2a8c', accent: '#f2c14e', helmet: '#4b2a8c', stripe: '#f2c14e', mask: '#c0c0c0', pants: '#f2c14e' },
  { id: 'toads',    team: 'Thunder Toads',     jersey: '#4cae3c', accent: '#1b3a1b', helmet: '#f7e04a', stripe: '#1b3a1b', mask: '#1b3a1b', pants: '#ffffff' },
  { id: 'moose',    team: 'Midnight Moose',    jersey: '#1a2340', accent: '#9fb4ff', helmet: '#1a2340', stripe: '#9fb4ff', mask: '#9fb4ff', pants: '#9fb4ff' },
  { id: 'gophers',  team: 'Gold Rush Gophers', jersey: '#8a5a2b', accent: '#ffcf33', helmet: '#ffcf33', stripe: '#8a5a2b', mask: '#8a5a2b', pants: '#ffcf33', unlock: { kills: 10 } },
  { id: 'pirates',  team: 'Ice Pirates',       jersey: '#dff3ff', accent: '#2a7bd6', helmet: '#2a7bd6', stripe: '#ffffff', mask: '#0d2440', pants: '#2a7bd6', unlock: { wins: 1 } },
  { id: 'rhinos',   team: 'Robo Rhinos',       jersey: '#7a8088', accent: '#ff2e2e', helmet: '#3a3f45', stripe: '#ff2e2e', mask: '#ff2e2e', pants: '#3a3f45', unlock: { wins: 3 } },
  { id: 'galaxy',   team: 'Galaxy Gladiators', jersey: '#0b0b2a', accent: '#ff7bf2', helmet: '#0b0b2a', stripe: '#6df7ff', mask: '#ffffff', pants: '#0b0b2a', unlock: { kills: 50 } },
  // ---------- LONGHORN ITEM SHOP ----------
  { id: 'lh_ranch',    team: 'Ranch Hand Longhorn', jersey: '#c9a26b', accent: '#5a3a1e', helmet: '#5a3a1e', stripe: '#e9d8b4', mask: '#e9d8b4', pants: '#e9d8b4', horns: '#f3ead2', price: 1000, rarity: 2 },
  { id: 'lh_rodeo',    team: 'Rodeo Longhorn',      jersey: '#b3202a', accent: '#ffffff', helmet: '#ffffff', stripe: '#b3202a', mask: '#222222', pants: '#2b2b2b', horns: '#efe6cf', price: 1000, rarity: 2 },
  { id: 'lh_desert',   team: 'Desert Longhorn',     jersey: '#e2c48f', accent: '#1f8a87', helmet: '#1f8a87', stripe: '#e2c48f', mask: '#e2c48f', pants: '#e2c48f', horns: '#fff6e0', price: 1000, rarity: 2 },
  { id: 'lh_thunder',  team: 'Thunderhorn',         jersey: '#1f3fae', accent: '#ffe23a', helmet: '#1f3fae', stripe: '#ffe23a', mask: '#ffe23a', pants: '#ffffff', horns: '#ffe23a', price: 1200, rarity: 3 },
  { id: 'lh_midnight', team: 'Midnight Longhorn',   jersey: '#151515', accent: '#b9c0c9', helmet: '#151515', stripe: '#b9c0c9', mask: '#b9c0c9', pants: '#151515', horns: '#d9dee5', price: 1200, rarity: 3 },
  { id: 'lh_golden',   team: 'Golden Longhorn',     jersey: '#f2b705', accent: '#ffffff', helmet: '#f2b705', stripe: '#ffffff', mask: '#ffffff', pants: '#ffffff', horns: '#fff1a8', price: 2000, rarity: 4 },
  // ---------- DAILY ITEM SHOP pool (a few of these are for sale each day) ----------
  // extra style options: yoke (shoulders in the accent color), hoops (stripes around the jersey)
  { id: 'd_volcano', team: 'Volcano Vanguard', jersey: '#2b1712', accent: '#ff5a1f', helmet: '#2b1712', stripe: '#ffb02e', mask: '#ff5a1f', pants: '#2b1712', body: 'm', shop: 'daily', price: 2500, rarity: 4,
    style: { bolts: true, towel: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#ff5a1f' } },
  { id: 'd_nebula',  team: 'Nebula Ranger',    jersey: '#1b1046', accent: '#7df9ff', helmet: '#1b1046', stripe: '#ff7bf2', mask: '#7df9ff', pants: '#2c1a66', body: 'f', shop: 'daily', price: 2500, rarity: 4,
    style: { yoke: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#7df9ff' } },
  { id: 'd_dragon',  team: 'Dragon Defender',  jersey: '#1f7a3a', accent: '#ffd23f', helmet: '#145028', stripe: '#ffd23f', mask: '#ffd23f', pants: '#145028', body: 'm', horns: '#ffd23f', shop: 'daily', price: 2500, rarity: 4,
    style: { yoke: true, towel: true, pads: true, crewSocks: true, cleats: '#ffd23f' } },
  { id: 'd_arctic',  team: 'Arctic Ace',       jersey: '#eef8ff', accent: '#3fb7ff', helmet: '#eef8ff', stripe: '#3fb7ff', mask: '#3fb7ff', pants: '#cfe9ff', body: 'f', shop: 'daily', price: 2000, rarity: 3,
    style: { yoke: true, towel: true, crowns: true, pads: true, crewSocks: true, cleats: '#3fb7ff' } },
  { id: 'd_neon',    team: 'Neon Nightfall',   jersey: '#101014', accent: '#39ff6a', helmet: '#101014', stripe: '#39ff6a', mask: '#39ff6a', pants: '#101014', body: 'm', shop: 'daily', price: 2000, rarity: 3,
    style: { bolts: true, pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#39ff6a' } },
  { id: 'd_thunderq', team: 'Thunder Queen',   jersey: '#5b2bb5', accent: '#ffe23a', helmet: '#5b2bb5', stripe: '#ffe23a', mask: '#ffe23a', pants: '#ffffff', body: 'f', shop: 'daily', price: 2000, rarity: 3,
    style: { bolts: true, towel: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, cleats: '#ffe23a' } },
  { id: 'd_cyber',   team: 'Cyber Center',     jersey: '#aeb6c2', accent: '#1e7bff', helmet: '#1c2230', stripe: '#1e7bff', mask: '#1e7bff', pants: '#1c2230', body: 'm', shop: 'daily', price: 2000, rarity: 3,
    style: { yoke: true, pads: true, armSleeve: true, whiteNumbers: true, cleats: '#1e7bff' } },
  { id: 'd_retro',   team: 'Retro Rookie',     jersey: '#e3a92b', accent: '#6b3a1c', helmet: '#6b3a1c', stripe: '#e3a92b', mask: '#e3d6b8', pants: '#efe3c4', body: 'm', shop: 'daily', price: 1500, rarity: 2,
    style: { hoops: true, crewSocks: true, cleats: '#2a1a10' } },
  { id: 'd_sunset',  team: 'Sunset Striker',   jersey: '#ff7a3d', accent: '#ff3f8e', helmet: '#ff3f8e', stripe: '#ffd166', mask: '#ffffff', pants: '#ffffff', body: 'f', shop: 'daily', price: 1500, rarity: 2,
    style: { hoops: true, towel: true, pads: true, crewSocks: true, cleats: '#ff3f8e' } },
  { id: 'd_camo',    team: 'Camo Captain',     jersey: '#556b2f', accent: '#c2b280', helmet: '#3b4a22', stripe: '#c2b280', mask: '#2a2a1e', pants: '#c2b280', body: 'm', shop: 'daily', price: 1500, rarity: 2,
    style: { yoke: true, pads: true, crewSocks: true, cleats: '#3b4a22' } },
  { id: 'd_tidal',   team: 'Tidal Wave',       jersey: '#0f7c8c', accent: '#0b2a4a', helmet: '#0b2a4a', stripe: '#7ff3ff', mask: '#7ff3ff', pants: '#ffffff', body: 'm', shop: 'daily', price: 1500, rarity: 2,
    style: { hoops: true, towel: true, pads: true, armSleeve: true, cleats: '#0b2a4a' } },
  { id: 'd_bubble',  team: 'Bubblegum Blitz',  jersey: '#ff8ac8', accent: '#ffffff', helmet: '#ff8ac8', stripe: '#ffffff', mask: '#ffffff', pants: '#ffffff', body: 'f', shop: 'daily', price: 1200, rarity: 1 },
  { id: 'd_jungle',  team: 'Jungle Juggernaut', jersey: '#2f8a3b', accent: '#f2c14e', helmet: '#f2c14e', stripe: '#2f8a3b', mask: '#2f8a3b', pants: '#f2c14e', body: 'm', shop: 'daily', price: 1200, rarity: 1 },
  { id: 'd_pumpkin', team: 'Pumpkin Punter',   jersey: '#ff8a1f', accent: '#1a1a1a', helmet: '#1a1a1a', stripe: '#ff8a1f', mask: '#ff8a1f', pants: '#1a1a1a', body: 'f', shop: 'daily', price: 1200, rarity: 1,
    style: { hoops: true, crewSocks: true, cleats: '#1a1a1a' } },
];

export const EMOTES = [
  { id: 1, name: 'Gridiron Shuffle', dur: 4.0, loop: true },
  { id: 2, name: 'Touchdown Spike',  dur: 2.2 },
  { id: 3, name: 'Victory Dance',    dur: 4.0, loop: true },
  { id: 4, name: 'Helmet Salute',    dur: 2.0 },
  { id: 5, name: 'Ref Signals',      dur: 3.2, loop: true },
  // ---------- LONGHORN ITEM SHOP ----------
  { id: 6, name: 'Stampede Stomp', dur: 4.0, loop: true, price: 1000, rarity: 2 },
  { id: 7, name: 'Lasso Spin',     dur: 4.0, loop: true, price: 1000, rarity: 2 },
  { id: 8, name: 'Bull Charge',    dur: 3.0, loop: true, price: 1000, rarity: 3 },
  // ---------- DAILY ITEM SHOP pool ----------
  { id: 9,  name: 'Spin Move',      dur: 2.4,             shop: 'daily', price: 1000, rarity: 1 },
  { id: 10, name: 'Air Guitar',     dur: 4.0, loop: true, shop: 'daily', price: 1500, rarity: 3 },
  { id: 11, name: 'Sprinkler',      dur: 4.0, loop: true, shop: 'daily', price: 1200, rarity: 2 },
  { id: 12, name: 'Chest Flex',     dur: 3.0, loop: true, shop: 'daily', price: 1000, rarity: 1 },
  { id: 13, name: 'Wave Ripple',    dur: 4.0, loop: true, shop: 'daily', price: 1200, rarity: 2 },
];

const shopItems = (which) => [
  ...SKIN_PRESETS.filter((s) => s.price && (s.shop || 'longhorn') === which).map((s) => ({ id: s.id, kind: 'skin', name: s.team, price: s.price, rarity: s.rarity, shop: which })),
  ...EMOTES.filter((e) => e.price && (e.shop || 'longhorn') === which).map((e) => ({ id: `emote${e.id}`, kind: 'emote', emote: e.id, name: e.name, price: e.price, rarity: e.rarity, shop: which })),
];
// Everything in the Longhorn Item Shop (always for sale)
export const SHOP = shopItems('longhorn');
// Every item that can show up in the Daily Item Shop (today's picks: dailyShop() in shared/shop.js)
export const DAILY_POOL = shopItems('daily');

export const BUCKS = { perElim: 10, win: 100, top10: 20, top25: 10, match: 5, perDollar: 100 };

// Can this profile wear this preset?
export function canUseSkin(preset, profile) {
  if (!preset) return false;
  if (preset.price) return !!profile && profile.owned.includes(preset.id);
  if (!preset.unlock) return true;
  const s = (profile && profile.stats) || {};
  return (!preset.unlock.wins || (s.wins || 0) >= preset.unlock.wins) && (!preset.unlock.kills || (s.kills || 0) >= preset.unlock.kills);
}
export function canUseEmote(id, profile) {
  const e = EMOTES.find((x) => x.id === id);
  if (!e) return false;
  return !e.price || (!!profile && profile.owned.includes(`emote${id}`));
}

const HEX = /^#[0-9a-f]{6}$/i;
// Clean up a skin. If a profile is given, locked/unowned outfits fall back to the default.
export function sanitizeSkin(s, profile) {
  const base = SKIN_PRESETS[0];
  if (!s || typeof s !== 'object') s = {};
  let p = SKIN_PRESETS.find((x) => x.id === s.preset) || base;
  if (profile !== undefined && !canUseSkin(p, profile)) { p = base; s = {}; }
  const out = { preset: p.id };
  for (const k of ['jersey', 'accent', 'helmet', 'stripe', 'mask', 'pants']) out[k] = HEX.test(s[k]) ? s[k] : p[k];
  out.tone = SKIN_TONES.includes(s.tone) ? s.tone : SKIN_TONES[2];
  out.hair = HAIR_COLORS.includes(s.hair) ? s.hair : HAIR_COLORS[1];
  out.hairStyle = HAIR_STYLES.includes(s.hairStyle) ? s.hairStyle : 'wavy';
  out.eyes = EYE_COLORS.includes(s.eyes) ? s.eyes : EYE_COLORS[2];
  out.smile = s.smile !== false;
  out.helmetOn = s.helmetOn !== false; // players choose helmet on or off
  out.body = s.body === 'f' || s.body === 'm' ? s.body : (p.body || 'm');
  out.horns = p.horns || null;
  // every outfit gets the full game-day look; Royale Thunder also has white numbers
  out.style = p.style || { bolts: true, towel: true, crowns: true, pads: true, crewSocks: true, armSleeve: true, cleats: p.accent };
  const n = parseInt(s.number, 10);
  out.number = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 12;
  return out;
}
