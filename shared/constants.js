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
// Full close takes ~11.5 minutes; most matches end around 9-11 minutes.
export const ZONE_PHASES = [
  { wait: 90, shrink: 60, radius: 360, dps: 1 },
  { wait: 60, shrink: 50, radius: 220, dps: 1 },
  { wait: 50, shrink: 45, radius: 130, dps: 2 },
  { wait: 45, shrink: 40, radius: 75, dps: 4 },
  { wait: 35, shrink: 35, radius: 40, dps: 6 },
  { wait: 30, shrink: 30, radius: 18, dps: 8 },
  { wait: 20, shrink: 25, radius: 6, dps: 10 },
  { wait: 15, shrink: 30, radius: 0, dps: 14 },
];

export const BUILD = {
  grid: 4, cost: 10, maxMats: 500, harvest: 8, crateMats: 40,
  hp: { wall: 150, floor: 140, ramp: 140 },
  thick: 0.3,
};

export const PICKUP_RANGE = 2.6;

// Bot skill. aimError: radians of aim wobble; react: seconds before the first shot;
// fireMul: fraction of the weapon's fire rate; sight/hearing/fov: how they spot you
// (outside `fov` radians of where they look they only notice you within `hearing` m);
// burst: [seconds shooting, seconds pausing]; warmup: seconds until their aim settles;
// maxOnHuman: bots allowed to gang up on one human at range; aggro: 0 careful .. 1 pushy.
export const BOT_DIFFICULTY = {
  easy: {
    aimError: 0.19, react: 1.4, fireMul: 0.4, sight: 50, glideSight: 0, hearing: 8, fov: 1.2, turn: 4,
    burst: [0.8, 1.5], warmup: 3, maxOnHuman: 1, aggro: 0.3, healAt: 45, jumpy: 0.05,
    build: 0.15, buildCooldown: 4, rampChance: 0, nade: 0.1, rotateEarly: 0, matsWanted: 30,
  },
  normal: {
    aimError: 0.13, react: 0.95, fireMul: 0.55, sight: 70, glideSight: 25, hearing: 14, fov: 1.5, turn: 6,
    burst: [1.6, 0.8], warmup: 2, maxOnHuman: 2, aggro: 0.5, healAt: 60, jumpy: 0.15,
    build: 0.45, buildCooldown: 2, rampChance: 0.3, nade: 0.3, rotateEarly: 8, matsWanted: 60,
  },
  hard: {
    aimError: 0.085, react: 0.6, fireMul: 0.75, sight: 90, glideSight: 50, hearing: 20, fov: 1.9, turn: 8,
    burst: [2.6, 0.45], warmup: 1.2, maxOnHuman: 3, aggro: 0.65, healAt: 70, jumpy: 0.3,
    build: 0.8, buildCooldown: 1.1, rampChance: 0.5, nade: 0.5, rotateEarly: 18, matsWanted: 100,
  },
};
// How bots fight *each other*, whatever the difficulty. Difficulty only changes how bots
// treat humans; bot-vs-bot fights use this so every match has the same pacing.
export const BOT_VS_BOT = { aimError: 0.16, react: 1.0, fireMul: 0.5, sight: 36, burst: [1.2, 1.2], warmup: 2.5 };
