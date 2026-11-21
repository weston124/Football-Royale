// Skins, emotes and the Longhorn Item Shop. All designs are original to Football Royale.

export const SKIN_TONES = ['#f6d3b3', '#e8b48a', '#c98e62', '#a8693f', '#7a4a2a', '#4f2f1c'];
export const HAIR_COLORS = ['#b8894f', '#8a6239', '#5a3d24', '#2e1f14', '#121010', '#e0c27a', '#a8452a'];
export const HAIR_STYLES = ['wavy', 'flow', 'short', 'buzz'];
export const EYE_COLORS = ['#3d78b8', '#5f8f6a', '#5a3a22', '#2a1a10', '#7a8a96'];

// The newest Daily Shop batch: its items carry added: NEW_BATCH_DATE, wear a NEW! badge for NEW_DAYS days
// and get guaranteed spots in the rotation while they are new (shared/shop.js).
export const NEW_BATCH_DATE = '2026-11-21';
export const NEW_DAYS = 30;
// Outfit style options drawn by client/js/human.js (checked by test/newbatch.test.js)
export const OUTFIT_PATTERNS = ['flames', 'camo', 'stars', 'chevron', 'sash', 'candy', 'split', 'sweater', 'frost', 'dino', 'mech', 'stripes'];
export const HELMET_DECALS = ['flame', 'snowflake', 'planet', 'star', 'bolt', 'crown', 'shuriken', 'gear', 'claw', 'anchor', 'tree', 'peppermint', 'shield', 'paw', 'heart', 'comet'];
export const HELMET_FINS = ['spikes', 'antenna'];
export const BACK_ITEMS = ['cape', 'jetpack'];

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
  // ---------- DAILY ITEM SHOP: the "Big Game Drop" batch (NEW_BATCH_DATE) ----------
  // More style options (client/js/human.js): pattern (flames, camo, stars, chevron, sash, candy, split, sweater,
  // frost, dino, mech, stripes; pat2 = its second color), gloves, visor (tint), glow (glowing trim color), chrome (metal
  // helmet + mask), decal (helmet side icon, HELMET_DECALS; decalColor/decalEdge), fin (spikes, antenna),
  // back (cape, jetpack; backColor/backColor2), chute ([canopy, stripe] parachute colors).
  // Legendary
  { id: 'd_magma', team: 'Magma Monarch', jersey: '#1c0f0b', accent: '#ff4a12', helmet: '#1c0f0b', stripe: '#ff4a12', mask: '#ff7a1a', pants: '#1c0f0b', body: 'm', shop: 'daily', price: 2500, rarity: 4, added: NEW_BATCH_DATE,
    style: { pattern: 'flames', pat2: '#ffd23a', glow: '#ff6a1a', decal: 'flame', decalColor: '#ff7a1a', decalEdge: '#ffd23a', visor: '#ff8a00', gloves: '#ff4a12',
      pads: true, crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#ff4a12', chute: ['#ff4a12', '#ffd23a'] } },
  { id: 'd_starfield', team: 'Starfield Sentinel', jersey: '#120a36', accent: '#9a5cff', helmet: '#120a36', stripe: '#6df7ff', mask: '#cfd8ff', pants: '#1d1250', body: 'f', shop: 'daily', price: 2500, rarity: 4, added: NEW_BATCH_DATE,
    style: { pattern: 'stars', pat2: '#c9b8ff', glow: '#6df7ff', decal: 'planet', decalColor: '#ffb3f5', decalEdge: '#6df7ff', visor: '#7a5cff', gloves: '#120a36',
      back: 'jetpack', backColor: '#2a1d6e', backColor2: '#a89cff', pads: true, crewSocks: true, whiteNumbers: true, cleats: '#6df7ff', chute: ['#120a36', '#6df7ff'] } },
  { id: 'd_karat', team: 'Golden Goalpost', jersey: '#e8ae1c', accent: '#7a4a00', helmet: '#ffcc33', stripe: '#ffffff', mask: '#ffcc33', pants: '#fff8e6', body: 'm', shop: 'daily', price: 2500, rarity: 4, added: NEW_BATCH_DATE,
    style: { pattern: 'chevron', pat2: '#ffffff', chrome: true, decal: 'crown', decalColor: '#ffffff', decalEdge: '#7a4a00', visor: '#ffb000', gloves: '#ffcc33',
      pads: true, crewSocks: true, whiteNumbers: true, cleats: '#e8ae1c', chute: ['#ffcc33', '#ffffff'] } },
  { id: 'd_kickoff', team: 'Captain Kickoff', jersey: '#1f4fd8', accent: '#ffd400', helmet: '#1f4fd8', stripe: '#e8202a', mask: '#ffd400', pants: '#e8202a', body: 'm', shop: 'daily', price: 2500, rarity: 4, added: NEW_BATCH_DATE,
    style: { pattern: 'chevron', pat2: '#e8202a', decal: 'shield', decalColor: '#ffd400', decalEdge: '#e8202a', visor: '#ffd400', gloves: '#e8202a',
      back: 'cape', backColor: '#e8202a', backColor2: '#ffd400', crewSocks: true, cleats: '#e8202a', chute: ['#e8202a', '#ffd400'] } },
  // Epic
  { id: 'd_glacier', team: 'Glacier Guardian', jersey: '#b9e2ff', accent: '#2e9bff', helmet: '#cdeeff', stripe: '#ffffff', mask: '#2e9bff', pants: '#bfe6ff', body: 'f', shop: 'daily', price: 2000, rarity: 3, added: NEW_BATCH_DATE,
    style: { pattern: 'frost', pat2: '#ffffff', chrome: true, decal: 'snowflake', decalColor: '#ffffff', decalEdge: '#2e9bff', visor: '#7fd8ff', gloves: '#ffffff',
      pads: true, crewSocks: true, cleats: '#2e9bff', chute: ['#7fd8ff', '#ffffff'] } },
  { id: 'd_volt', team: 'Volt Viper', jersey: '#0c0c12', accent: '#00ffc8', helmet: '#0c0c12', stripe: '#00ffc8', mask: '#ff2bd6', pants: '#0c0c12', body: 'f', shop: 'daily', price: 2000, rarity: 3, added: NEW_BATCH_DATE,
    style: { pattern: 'sash', pat2: '#ff2bd6', glow: '#00ffc8', decal: 'bolt', decalColor: '#00ffc8', decalEdge: '#ff2bd6', visor: '#00ffc8', gloves: '#ff2bd6',
      crewSocks: true, armSleeve: true, whiteNumbers: true, cleats: '#00ffc8', chute: ['#ff2bd6', '#00ffc8'] } },
  { id: 'd_shadow', team: 'Shadow Snap', jersey: '#16161c', accent: '#d61f3a', helmet: '#16161c', stripe: '#d61f3a', mask: '#2a2a33', pants: '#16161c', body: 'm', shop: 'daily', price: 2000, rarity: 3, added: NEW_BATCH_DATE,
    style: { pattern: 'sash', pat2: '#5a5a66', decal: 'shuriken', decalColor: '#d61f3a', decalEdge: '#000000', visor: '#1a1a1a', gloves: '#16161c',
      armSleeve: true, cleats: '#16161c', chute: ['#16161c', '#d61f3a'] } },
  { id: 'd_ironclad', team: 'Ironclad Lineman', jersey: '#9aa4b1', accent: '#ff8a00', helmet: '#aab3bf', stripe: '#ff8a00', mask: '#2b313a', pants: '#3a414c', body: 'm', shop: 'daily', price: 2000, rarity: 3, added: NEW_BATCH_DATE,
    style: { pattern: 'mech', pat2: '#3a414c', chrome: true, glow: '#ff9a1a', fin: 'antenna', decal: 'gear', decalColor: '#ff8a00', decalEdge: '#1c2128', visor: '#ff8a00', gloves: '#3a414c',
      back: 'jetpack', backColor: '#3a414c', backColor2: '#9aa4b1', pads: true, cleats: '#3a414c', chute: ['#ff8a00', '#3a414c'] } },
  // Rare
  { id: 'd_thicket', team: 'Thicket Tracker', jersey: '#5b6b34', accent: '#a99a63', helmet: '#4a5629', stripe: '#a99a63', mask: '#2a2a1e', pants: '#7b7448', body: 'f', shop: 'daily', price: 1500, rarity: 2, added: NEW_BATCH_DATE,
    style: { pattern: 'camo', pat2: '#2f3a1c', decal: 'star', decalColor: '#d9cc93', decalEdge: '#2a2a1e', gloves: '#3b4a22',
      pads: true, crewSocks: true, cleats: '#3b4a22', chute: ['#5b6b34', '#a99a63'] } },
  { id: 'd_stego', team: 'Stego Stomper', jersey: '#4f9a2c', accent: '#2d5e18', helmet: '#4f9a2c', stripe: '#f2a33a', mask: '#2d5e18', pants: '#2d5e18', body: 'm', shop: 'daily', price: 1500, rarity: 2, added: NEW_BATCH_DATE,
    style: { pattern: 'dino', pat2: '#d8f07a', fin: 'spikes', decal: 'claw', decalColor: '#d8f07a', decalEdge: '#1b3a0e', gloves: '#2d5e18',
      pads: true, crewSocks: true, cleats: '#2d5e18', chute: ['#4f9a2c', '#f2a33a'] } },
  { id: 'd_cannonball', team: 'Captain Cannonball', jersey: '#f4ecd8', accent: '#b3202a', helmet: '#141414', stripe: '#f2d27a', mask: '#f2d27a', pants: '#141414', body: 'f', shop: 'daily', price: 1500, rarity: 2, added: NEW_BATCH_DATE,
    style: { pattern: 'stripes', decal: 'anchor', decalColor: '#f2d27a', decalEdge: '#000000', gloves: '#141414',
      back: 'cape', backColor: '#141414', backColor2: '#f2d27a', crewSocks: true, cleats: '#141414', chute: ['#141414', '#f2d27a'] } },
  // Uncommon
  { id: 'd_holly', team: 'Holly Jolly Halfback', jersey: '#c8102e', accent: '#1f7a3a', helmet: '#c8102e', stripe: '#ffffff', mask: '#ffffff', pants: '#ffffff', body: 'm', shop: 'daily', price: 1200, rarity: 1, added: NEW_BATCH_DATE,
    style: { pattern: 'sweater', pat2: '#ffffff', decal: 'tree', decalColor: '#1f7a3a', decalEdge: '#ffffff', gloves: '#1f7a3a',
      crewSocks: true, whiteNumbers: true, cleats: '#1f7a3a', chute: ['#c8102e', '#1f7a3a'] } },
  { id: 'd_candycane', team: 'Candy Cane Cornerback', jersey: '#ffffff', accent: '#e8203a', helmet: '#ffffff', stripe: '#e8203a', mask: '#e8203a', pants: '#e8203a', body: 'f', shop: 'daily', price: 1200, rarity: 1, added: NEW_BATCH_DATE,
    style: { pattern: 'candy', decal: 'peppermint', decalColor: '#e8203a', decalEdge: '#ffffff', gloves: '#e8203a',
      crewSocks: true, cleats: '#e8203a', chute: ['#ffffff', '#e8203a'] } },
  { id: 'd_twotone', team: 'Two-Tone Tailback', jersey: '#ff7a00', accent: '#1d2a6b', helmet: '#1d2a6b', stripe: '#ff7a00', mask: '#ffffff', pants: '#1d2a6b', body: 'f', shop: 'daily', price: 1200, rarity: 1, added: NEW_BATCH_DATE,
    style: { pattern: 'split', decal: 'comet', decalColor: '#ff7a00', decalEdge: '#ffffff', gloves: '#ff7a00',
      crewSocks: true, whiteNumbers: true, cleats: '#ff7a00', chute: ['#ff7a00', '#1d2a6b'] } },
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
  // "Big Game Drop" batch
  // art: the moment of the emote shown on its shop card (seconds)
  { id: 14, name: 'Robo Rumble',      dur: 4.0, loop: true, shop: 'daily', price: 1500, rarity: 2, added: NEW_BATCH_DATE, art: 0.3 },
  { id: 15, name: 'Field Goal Kick',  dur: 2.8,             shop: 'daily', price: 1200, rarity: 1, added: NEW_BATCH_DATE, art: 1.0 },
  { id: 16, name: 'Trophy Hoist',     dur: 4.0, loop: true, shop: 'daily', price: 2000, rarity: 3, added: NEW_BATCH_DATE, art: 0.3 },
  { id: 17, name: 'End Zone Twirl',   dur: 3.0,             shop: 'daily', price: 1500, rarity: 2, added: NEW_BATCH_DATE, art: 1.75 },
  { id: 18, name: 'Hike Hike Hike',   dur: 3.2, loop: true, shop: 'daily', price: 1000, rarity: 1, added: NEW_BATCH_DATE, art: 1.3 },
  { id: 19, name: 'Dino Stomp',       dur: 4.0, loop: true, shop: 'daily', price: 1200, rarity: 1, added: NEW_BATCH_DATE, art: 3.4 },
];

const shopItems = (which) => [
  ...SKIN_PRESETS.filter((s) => s.price && (s.shop || 'longhorn') === which).map((s) => ({ id: s.id, kind: 'skin', name: s.team, price: s.price, rarity: s.rarity, shop: which, ...(s.added && { added: s.added }) })),
  ...EMOTES.filter((e) => e.price && (e.shop || 'longhorn') === which).map((e) => ({ id: `emote${e.id}`, kind: 'emote', emote: e.id, name: e.name, price: e.price, rarity: e.rarity, shop: which, ...(e.added && { added: e.added }) })),
];
// Is this shop item from the newest batch and still new on dateKey ('YYYY-MM-DD')?
export function isNewItem(item, dateKey) {
  if (!item || !item.added) return false;
  const d = (Date.parse(dateKey) - Date.parse(item.added)) / 86400_000;
  return d >= 0 && d < NEW_DAYS;
}
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
