// Skins, emotes and the Longhorn Item Shop. All designs are original to Football Royale.

export const SKIN_TONES = ['#f6d3b3', '#e8b48a', '#c98e62', '#a8693f', '#7a4a2a', '#4f2f1c'];
export const HAIR_COLORS = ['#b8894f', '#8a6239', '#5a3d24', '#2e1f14', '#121010', '#e0c27a', '#a8452a'];
export const HAIR_STYLES = ['wavy', 'flow', 'short', 'buzz'];
export const EYE_COLORS = ['#3d78b8', '#5f8f6a', '#5a3a22', '#2a1a10', '#7a8a96'];

// unlock: earned by playing. price: bought in the Longhorn Item Shop with Ball Bucks.
export const SKIN_PRESETS = [
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
  { id: 'lh_ranch',    team: 'Ranch Hand Longhorn', jersey: '#c9a26b', accent: '#5a3a1e', helmet: '#5a3a1e', stripe: '#e9d8b4', mask: '#e9d8b4', pants: '#e9d8b4', horns: '#f3ead2', price: 800,  rarity: 2 },
  { id: 'lh_rodeo',    team: 'Rodeo Longhorn',      jersey: '#b3202a', accent: '#ffffff', helmet: '#ffffff', stripe: '#b3202a', mask: '#222222', pants: '#2b2b2b', horns: '#efe6cf', price: 800,  rarity: 2 },
  { id: 'lh_desert',   team: 'Desert Longhorn',     jersey: '#e2c48f', accent: '#1f8a87', helmet: '#1f8a87', stripe: '#e2c48f', mask: '#e2c48f', pants: '#e2c48f', horns: '#fff6e0', price: 800,  rarity: 2 },
  { id: 'lh_thunder',  team: 'Thunderhorn',         jersey: '#1f3fae', accent: '#ffe23a', helmet: '#1f3fae', stripe: '#ffe23a', mask: '#ffe23a', pants: '#ffffff', horns: '#ffe23a', price: 1200, rarity: 3 },
  { id: 'lh_midnight', team: 'Midnight Longhorn',   jersey: '#151515', accent: '#b9c0c9', helmet: '#151515', stripe: '#b9c0c9', mask: '#b9c0c9', pants: '#151515', horns: '#d9dee5', price: 1200, rarity: 3 },
  { id: 'lh_golden',   team: 'Golden Longhorn',     jersey: '#f2b705', accent: '#ffffff', helmet: '#f2b705', stripe: '#ffffff', mask: '#ffffff', pants: '#ffffff', horns: '#fff1a8', price: 2000, rarity: 4 },
];

export const EMOTES = [
  { id: 1, name: 'Gridiron Shuffle', dur: 4.0, loop: true },
  { id: 2, name: 'Touchdown Spike',  dur: 2.2 },
  { id: 3, name: 'Victory Dance',    dur: 4.0, loop: true },
  { id: 4, name: 'Helmet Salute',    dur: 2.0 },
  { id: 5, name: 'Ref Signals',      dur: 3.2, loop: true },
  // ---------- LONGHORN ITEM SHOP ----------
  { id: 6, name: 'Stampede Stomp', dur: 4.0, loop: true, price: 500, rarity: 2 },
  { id: 7, name: 'Lasso Spin',     dur: 4.0, loop: true, price: 500, rarity: 2 },
  { id: 8, name: 'Bull Charge',    dur: 3.0, loop: true, price: 700, rarity: 3 },
];

// Everything in the Longhorn Item Shop
export const SHOP = [
  ...SKIN_PRESETS.filter((s) => s.price).map((s) => ({ id: s.id, kind: 'skin', name: s.team, price: s.price, rarity: s.rarity })),
  ...EMOTES.filter((e) => e.price).map((e) => ({ id: `emote${e.id}`, kind: 'emote', emote: e.id, name: e.name, price: e.price, rarity: e.rarity })),
];

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
  out.horns = p.horns || null;
  const n = parseInt(s.number, 10);
  out.number = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 12;
  return out;
}
