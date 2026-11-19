// Shared numbers that both the server and the browser use.
export const TICK_RATE = 20;              // server updates per second
export const MAP_HALF = 500;              // map goes from -500 to +500 meters
export const MAX_PLAYERS = 75;
export const LOBBY_COUNTDOWN = 30;        // seconds before a public match starts

export const PLAYER = {
  radius: 0.45, height: 1.8, eye: 1.6, head: 1.45,
  walk: 6.5, sprint: 10, jump: 8.2, gravity: 24, stepUp: 0.7,
};

export const DROP = {
  height: 210, speed: 38, doorsOpen: 2,
  freefall: 42, freefallH: 22, glide: 8, glideH: 15, autoDeploy: 60,
};

export const MAX_HP = 100;
export const MAX_PADDING = 100;

// The Overtime Storm. Each phase: wait, then shrink to radius over `shrink` seconds.
export const ZONE_START_RADIUS = 720;
export const ZONE_PHASES = [
  { wait: 70, shrink: 45, radius: 330, dps: 1 },
  { wait: 50, shrink: 40, radius: 190, dps: 2 },
  { wait: 40, shrink: 35, radius: 110, dps: 4 },
  { wait: 35, shrink: 30, radius: 55, dps: 6 },
  { wait: 25, shrink: 25, radius: 25, dps: 8 },
  { wait: 20, shrink: 20, radius: 8, dps: 10 },
  { wait: 15, shrink: 25, radius: 0, dps: 14 },
];

export const BUILD = {
  grid: 4, cost: 10, maxMats: 500, harvest: 8, crateMats: 40,
  hp: { wall: 150, floor: 140, ramp: 140 },
  thick: 0.3,
};

export const PICKUP_RANGE = 2.6;

export const BOT_DIFFICULTY = {
  easy:   { aimError: 0.09, react: 1.1, fireMul: 0.55, sight: 55 },
  normal: { aimError: 0.055, react: 0.7, fireMul: 0.75, sight: 70 },
  hard:   { aimError: 0.03, react: 0.4, fireMul: 0.95, sight: 90 },
};
