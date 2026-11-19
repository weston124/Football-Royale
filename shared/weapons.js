// All weapons and items. Names are original to Football Royale.
export const RARITIES = [
  { name: 'Common',    color: '#b8bcc2', mul: 1.00 },
  { name: 'Uncommon',  color: '#4fd16b', mul: 1.06 },
  { name: 'Rare',      color: '#3fa2ff', mul: 1.12 },
  { name: 'Epic',      color: '#b55cff', mul: 1.19 },
  { name: 'Legendary', color: '#ffb31a', mul: 1.27 },
];

// kind: 'hitscan' | 'projectile' | 'throw' | 'melee'
export const WEAPONS = {
  tackle:   { name: 'Tackle', kind: 'melee', damage: 25, rate: 2.2, range: 2.6, auto: true, slotColor: '#888' },
  pistol:   { name: 'Rookie Pistol', kind: 'hitscan', damage: 23, rate: 5.5, mag: 12, reload: 1.3, spread: 0.012, adsSpread: 0.004, range: 120, auto: false, pellets: 1, head: 1.6, minRarity: 0 },
  smg:      { name: 'Blitz SMG', kind: 'hitscan', damage: 14, rate: 11, mag: 30, reload: 2.2, spread: 0.038, adsSpread: 0.022, range: 80, auto: true, pellets: 1, head: 1.5, minRarity: 0 },
  rifle:    { name: 'Linebacker Rifle', kind: 'hitscan', damage: 27, rate: 5, mag: 30, reload: 2.3, spread: 0.022, adsSpread: 0.006, range: 200, auto: true, pellets: 1, head: 1.6, minRarity: 0 },
  shotgun:  { name: 'Sack Shotgun', kind: 'hitscan', damage: 9, rate: 1.0, mag: 5, reload: 4.2, spread: 0.09, adsSpread: 0.07, range: 35, auto: false, pellets: 9, head: 1.5, minRarity: 0 },
  sniper:   { name: 'Hail Mary Sniper', kind: 'hitscan', damage: 82, rate: 0.75, mag: 1, reload: 2.4, spread: 0.06, adsSpread: 0.0, range: 600, auto: false, pellets: 1, head: 2.0, zoom: 4, minRarity: 2 },
  pigskin:  { name: 'Pigskin Cannon', kind: 'projectile', damage: 70, splash: 5.5, rate: 0.9, mag: 4, reload: 3.0, speed: 48, grav: 14, auto: false, minRarity: 2 },
  whistle:  { name: 'Whistle Grenade', kind: 'throw', damage: 70, splash: 6, rate: 1.4, speed: 24, grav: 22, fuse: 2.2, stack: 6, auto: false, minRarity: 0, fixedRarity: 2 },
};
export const GUN_IDS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'pigskin', 'whistle'];

export const CONSUMABLES = {
  tape:    { name: 'Tape Roll', heal: 15, max: 75, time: 1.5, stack: 15, rarity: 0 },
  kit:     { name: "Trainer's Kit", heal: 100, max: 100, time: 6, stack: 3, rarity: 1 },
  padding: { name: 'Padding Pack', padding: 50, max: 100, time: 3, stack: 3, rarity: 2 },
};

export function weaponDamage(wid, rarity) {
  return WEAPONS[wid].damage * RARITIES[rarity || 0].mul;
}
export function itemName(item) {
  if (!item) return '';
  if (item.w) return WEAPONS[item.w].name;
  if (item.c) return CONSUMABLES[item.c].name;
  if (item.mats) return `${item.mats} Turf`;
  return '?';
}
