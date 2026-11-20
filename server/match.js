// One Football Royale match. The server is the referee: it owns health, loot,
// the storm, build pieces and who wins.
import { World, stepPlayer, stepFalling, raycastWorld, rayPlayer, lineOfSight, pieceBox, supportHeight } from '../shared/physics.js';
import { generateMap } from '../shared/map.js';
import { makeRng } from '../shared/rng.js';
import { WEAPONS, GUN_IDS, CONSUMABLES, RARITIES, weaponDamage } from '../shared/weapons.js';
import { sanitizeSkin, SKIN_PRESETS, EMOTES, canUseEmote, BUCKS } from '../shared/skins.js';
import {
  TICK_RATE, MAX_PLAYERS, LOBBY_COUNTDOWN, PLAYER, DROP, MAX_HP, MAX_PADDING,
  ZONE_START_RADIUS, ZONE_PHASES, BUILD, PICKUP_RANGE, MAP_HALF, BOT_DIFFICULTY,
} from '../shared/constants.js';
import { updateBot, BOT_NAMES } from './bots.js';
import { VehicleSystem } from './vehicles.js';
import { NFIELDS, KEY_TICKS, quantize, encodeEntry, bandFor, extraDelay } from '../shared/netcodec.js';

const MAP = generateMap();
const DT = 1 / TICK_RATE;
// Clock: real time normally; tests and the headless simulator can swap in a fake one.
let clockFn = () => performance.now() / 1000;
export const now = () => clockFn();
export function setClock(fn) { clockFn = fn || (() => performance.now() / 1000); }
const NO_DRIVING = new Set(['fire', 'reload', 'pickup', 'open', 'drop', 'build']);
const PHASE_CODE = { ground: 0, blimp: 1, fall: 2, glide: 3, dead: 4 };
export const WCODES = ['tackle', ...GUN_IDS];

let nextPlayerId = 1;

// ---------- backpack ----------
export const INV_SLOTS = 5;          // item slots everyone gets (slot 0 is always Tackle)
export const ADMIN_MAX_SLOTS = 40;   // safety cap for the admins' unlimited backpack
// Where admin accounts (profile.isAdmin) get the unlimited backpack and the 👑 armory.
// Public Quick Play is left out on purpose so it stays fair: add 'quickPlay' here to change that.
export const ADMIN_POWER_MATCHES = ['private', 'partyRoyale', 'island'];
const emptyInv = () => new Array(INV_SLOTS).fill(null);

export class Match {
  constructor({ code, mode = 'nobuild', isPublic = false, difficulty = 'normal', onClose, kind = 'normal', title = '', onReward = null }) {
    this.onReward = onReward; // (player, bucks, why, stat) -> gives Ball Bucks
    this.code = code;
    this.kind = kind; // 'normal' | 'partyRoyale' | 'island'
    this.title = title;
    this.mode = mode === 'build' ? 'build' : 'nobuild';
    this.isPublic = isPublic;
    this.difficulty = BOT_DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.onClose = onClose;
    this.state = 'lobby';
    this.players = new Map();
    this.hostId = null;
    this.countdownEnd = null;
    this.rnd = makeRng((Math.random() * 2 ** 32) >>> 0);
    this.world = new World();
    for (const b of MAP.boxes) this.world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
    this.loot = new Map();
    this.chests = MAP.chests.map((c, i) => ({ id: i, x: c.x, y: c.y, z: c.z, open: false }));
    this.pieces = new Map();
    this.pieceKeys = new Map();
    this.veh = new VehicleSystem(this, MAP, now); // drivable vehicles (server/vehicles.js)
    this.projectiles = [];
    this.nextId = 1;
    this.events = [];
    this.zone = null;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.lastTick = now();
    this.closed = false;
  }

  // ---------- players ----------
  get humans() { return [...this.players.values()].filter((p) => !p.bot); }
  get alive() { return [...this.players.values()].filter((p) => p.alive); }

  newPlayer(name, skin, bot) {
    return {
      id: nextPlayerId++, name, skin: sanitizeSkin(skin), bot,
      alive: true, phase: 'lobby', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true,
      yaw: 0, pitch: 0, hp: MAX_HP, pad: 0, inv: emptyInv(), slot: 0,
      team: 0, mats: 0, kills: 0, emote: 0, reloadUntil: 0, reloadSlot: -1, useUntil: 0, useSlot: -1,
      nextFire: 0, hist: [], lastIn: null, pev: [], lastMe: '', place: 0,
    };
  }

  addHuman(ws, name, skin, team = 0, profile = null) {
    const p = this.newPlayer(name, skin, false);
    p.ws = ws;
    p.profile = profile;
    p.team = team || -p.id;
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    if (this.isPublic && this.countdownEnd == null) this.countdownEnd = now() + (this.kind === 'partyRoyale' ? 60 : LOBBY_COUNTDOWN);
    this.send(p, { t: 'welcome', id: p.id, code: this.code, mode: this.mode, isPublic: this.isPublic, kind: this.kind, title: this.title });
    if (this.kind === 'island' && this.state === 'play') this.lateJoinIsland(p);
    else this.broadcastLobby();
    return p;
  }

  // Party Island: no fighting, everyone hangs out on the stadium field.
  placeOnField(p) {
    p.phase = 'ground'; p.onGround = true;
    p.x = this.rnd.range(-40, 40); p.z = this.rnd.range(-20, 20); p.y = 0;
    p.lastIn = { t: now(), x: p.x, y: p.y, z: p.z };
    p.inv[0] = { w: 'pigskin', r: 4, ammo: 4 };
    p.inv[1] = { w: 'whistle', r: 2, ammo: 6 };
    p.pev.push(['corr', p.x, p.y, p.z]);
  }
  lateJoinIsland(p) {
    this.placeOnField(p);
    this.events.push(['ro', ...this.rosterEntry(p)]);
    this.send(p, this.startMsg());
  }
  startMsg() {
    return {
      t: 'start', roster: [...this.players.values()].map((q) => this.rosterEntry(q)),
      loot: [...this.loot.values()].map((l) => this.lootEntry(l)), blimp: this.blimp,
      chests: this.chests.filter((c) => c.open).map((c) => c.id), tm: now(), kind: this.kind,
      pieces: [...this.pieces.values()].map((pc) => [pc.id, pc.kind, pc.gx, pc.gy, pc.gz, pc.r, pc.hp]),
    };
  }

  removeHuman(p) {
    if (!this.players.has(p.id)) return;
    if (p.vehicle) this.veh.exit(p);
    if (this.state === 'play' && p.alive) this.kill(p, null, 'quit', false);
    this.players.delete(p.id);
    this.events.push(['rm', p.id]);
    if (this.hostId === p.id) this.hostId = this.humans[0]?.id ?? null;
    if (this.humans.length === 0 && this.kind !== 'island') return this.close();
    if (this.state === 'lobby') this.broadcastLobby();
  }

  canJoin() { return (this.state === 'lobby' || (this.kind === 'island' && this.state === 'play')) && this.players.size < MAX_PLAYERS; }

  broadcastLobby() {
    const msg = {
      t: 'lobby', code: this.code, mode: this.mode, isPublic: this.isPublic, host: this.hostId,
      difficulty: this.difficulty,
      players: this.humans.map((p) => ({ id: p.id, name: p.name, team: p.team })), kind: this.kind, title: this.title,
      countdown: this.countdownEnd ? Math.max(0, Math.ceil(this.countdownEnd - now())) : null,
    };
    for (const p of this.humans) this.send(p, msg);
  }

  send(p, obj) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  rosterEntry(p) { return [p.id, p.name, p.skin, p.bot ? 1 : 0, p.team]; }

  // ---------- match start ----------
  start() {
    if (this.state !== 'lobby') return;
    this.state = 'play';
    this.startTime = now();
    if (this.kind === 'island') {
      this.blimp = null;
      this.zone = { ph: 0, st: 2, cx: 0, cz: 0, r: 5000, fx: 0, fz: 0, fr: 5000, tx: 0, tz: 0, tr: 5000, t0: 1e12, end: 0 };
      for (const p of this.players.values()) this.placeOnField(p);
      const msg = JSON.stringify(this.startMsg());
      for (const p of this.humans) this.send(p, msg);
      return;
    }
    const used = new Set(this.humans.map((p) => p.name));
    let n = 0;
    while (this.players.size < MAX_PLAYERS) {
      let name = BOT_NAMES[n % BOT_NAMES.length] + (n >= BOT_NAMES.length ? Math.floor(n / BOT_NAMES.length) + 1 : '');
      n++;
      if (used.has(name)) continue;
      const preset = this.rnd.pick(SKIN_PRESETS);
      const bot = this.newPlayer(name, { ...preset, preset: preset.id, number: this.rnd.int(1, 99) }, true);
      bot.team = -bot.id;
      this.players.set(bot.id, bot);
    }
    this.startTime = now();
    const a = this.rnd() * Math.PI * 2;
    const off = this.rnd.range(-120, 120);
    const dx = Math.cos(a), dz = Math.sin(a);
    this.blimp = {
      x0: -dx * 560 - dz * off, z0: -dz * 560 + dx * off, dx, dz,
      len: 1120, t0: this.startTime,
    };
    for (const p of this.players.values()) {
      p.phase = 'blimp';
      if (p.bot) updateBot.init(this, p);
    }
    this.spawnLoot();
    for (const p of this.humans) this.reward(p, BUCKS.match, 'joined a match', 'matches');
    this.zone = {
      ph: 0, st: 0, cx: 0, cz: 0, r: ZONE_START_RADIUS, fx: 0, fz: 0, fr: ZONE_START_RADIUS,
      tx: 0, tz: 0, tr: ZONE_PHASES[0].radius, t0: this.startTime + 25, end: 0,
    };
    this.pickZoneTarget();
    this.zone.end = this.zone.t0 + ZONE_PHASES[0].wait;
    const msg = JSON.stringify(this.startMsg());
    for (const p of this.humans) this.send(p, msg);
  }

  blimpPos(t) {
    const b = this.blimp;
    const d = Math.min(b.len, (t - b.t0) * DROP.speed);
    return { x: b.x0 + b.dx * d, y: DROP.height, z: b.z0 + b.dz * d, done: d >= b.len };
  }

  reward(p, bucks, why, stat) {
    if (p.bot || !p.profile || this.kind === 'island' || !this.onReward) return;
    this.onReward(p, bucks, why, stat);
  }

  // ---------- loot ----------
  rollRarity(chest) {
    const w = chest ? [10, 30, 32, 20, 8] : [42, 30, 17, 8, 3];
    let r = this.rnd() * 100;
    for (let i = 0; i < 5; i++) { if ((r -= w[i]) < 0) return i; }
    return 0;
  }
  rollWeapon(chest) {
    const rarity = this.rollRarity(chest);
    const pool = GUN_IDS.filter((g) => (WEAPONS[g].minRarity || 0) <= rarity && g !== 'whistle');
    const weights = { pistol: 3.2, smg: 3, rifle: 2.6, shotgun: 3, sniper: 1, pigskin: 0.8 };
    let tot = pool.reduce((s, g) => s + weights[g], 0), r = this.rnd() * tot;
    let w = pool[0];
    for (const g of pool) { if ((r -= weights[g]) < 0) { w = g; break; } }
    return { w, r: rarity, ammo: WEAPONS[w].mag };
  }
  rollItem(chest) {
    const r = this.rnd();
    if (r < 0.55) return this.rollWeapon(chest);
    if (r < 0.65) return { w: 'whistle', r: 2, ammo: 2 };
    if (r < 0.80) return { c: 'tape', n: 4 };
    if (r < 0.88) return { c: 'kit', n: 1 };
    return { c: 'padding', n: 1 };
  }
  addLoot(item, x, y, z) {
    const l = { id: this.nextId++, item, x, y, z };
    this.loot.set(l.id, l);
    return l;
  }
  lootEntry(l) { return [l.id, Math.round(l.x * 10) / 10, Math.round(l.y * 10) / 10, Math.round(l.z * 10) / 10, l.item]; }
  // Dropped things land on the floor below (not mid-air where someone was hit while
  // jumping or parachuting) and never inside a wall: pulled back toward (fx, fz) if needed.
  dropLoot(item, x, y, z, fx = x, fz = z) {
    x = Math.max(-MAP_HALF + 2, Math.min(MAP_HALF - 2, x)); z = Math.max(-MAP_HALF + 2, Math.min(MAP_HALF - 2, z));
    for (let k = 0; k < 4 && this.insideSolid(x, supportHeight(this.world, x, y + 0.5, z), z); k++) { x = (x + fx) / 2; z = (z + fz) / 2; }
    y = supportHeight(this.world, x, y + 0.5, z);
    const l = this.addLoot(item, x, y, z);
    this.events.push(['l+', ...this.lootEntry(l)]);
    return l;
  }
  spawnLoot() {
    const party = this.kind === 'partyRoyale';
    for (const s of MAP.loot) {
      // MORE LOOT: every spot spawns something (it used to skip 1 in 5)
      const y = supportHeight(this.world, s.x, s.y + 0.5, s.z);
      if (this.insideSolid(s.x, y, s.z)) continue;
      const item = this.rollItem(party);
      this.addLoot(item, s.x, y, s.z);
      // extras sit next to the main item, or on top of it if that spot is inside something
      const near = (dx, dz) => (this.insideSolid(s.x + dx, y, s.z + dz) || Math.abs(supportHeight(this.world, s.x + dx, y + 0.5, s.z + dz) - y) > 0.3 ? [s.x, s.z] : [s.x + dx, s.z + dz]);
      const at = (it, dx, dz) => { const [x, z] = near(dx, dz); this.addLoot(it, x, y, z); };
      if (party) at(this.rollItem(true), -0.9, 0.9);
      else if (this.rnd() < 0.5) at(this.rollItem(false), -0.9, 0.9); // bonus item half the time
      if (item.w && item.w !== 'whistle' && this.rnd() < 0.7) at({ c: 'tape', n: 2 }, 0.8, 0.5);
      if (this.mode === 'build' && this.rnd() < 0.25) at({ mats: 30 }, -0.8, -0.5);
    }
  }
  insideSolid(x, y, z) {
    const list = this.world.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
    return list.some((b) => !b.ramp && x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && y + 0.5 > b.min[1] && y + 0.5 < b.max[1]);
  }

  // 'quickPlay' | 'private' | 'partyRoyale' | 'island' (see ADMIN_POWER_MATCHES)
  get category() { return this.kind === 'normal' ? (this.isPublic ? 'quickPlay' : 'private') : this.kind; }
  adminPowers(p) { return !!(p && !p.bot && p.profile && p.profile.isAdmin && ADMIN_POWER_MATCHES.includes(this.category)); }
  // Drop empty slots off the end of a grown (admin) backpack, never below the normal size
  // or the slot in hand, so slot numbers of the other items never shift.
  trimInv(p) {
    while (p.inv.length > INV_SLOTS && p.inv[p.inv.length - 1] == null && p.inv.length > p.slot) p.inv.pop();
  }

  giveItem(p, item) {
    if (item.mats) {
      if (this.mode !== 'build') return false;
      p.mats = Math.min(BUILD.maxMats, p.mats + item.mats);
      return true;
    }
    const stackMax = item.c ? CONSUMABLES[item.c].stack : item.w === 'whistle' ? WEAPONS.whistle.stack : 0;
    if (stackMax) {
      for (const s of p.inv) {
        if (!s) continue;
        if (item.c && s.c === item.c && s.n < stackMax) {
          const add = Math.min(item.n, stackMax - s.n); s.n += add; item.n -= add;
        } else if (item.w === 'whistle' && s.w === 'whistle' && s.ammo < stackMax) {
          const add = Math.min(item.ammo, stackMax - s.ammo); s.ammo += add; item.ammo -= add;
        }
      }
      if ((item.c && item.n <= 0) || (item.w === 'whistle' && item.ammo <= 0)) return true;
    }
    const free = p.inv.indexOf(null);
    if (free >= 0) { p.inv[free] = item; return true; }
    // admins in Private Rooms / parties: a full backpack just grows a new slot
    if (this.adminPowers(p) && p.inv.length < ADMIN_MAX_SLOTS) { p.inv.push(item); return true; }
    if (p.slot > 0) {
      const old = p.inv[p.slot - 1];
      p.inv[p.slot - 1] = item;
      this.dropLoot(old, p.x + this.rnd.range(-0.7, 0.7), p.y, p.z + this.rnd.range(-0.7, 0.7), p.x, p.z);
      return true;
    }
    p.pev.push(['msg', 'Backpack full! Pick a slot (2-6) to swap.']);
    return false;
  }

  // 👑 Admin armory (in-game admin drop-down). Returns { ok, msg } for the admin's status line.
  //   req: { give: weaponId, r: rarity } | { refill: true } | { everything: true }
  armory(p, req) {
    const no = (msg) => ({ ok: false, msg });
    if (!p || !p.profile || !p.profile.isAdmin) return no('Admins only');
    if (!this.adminPowers(p)) return no('Admin armory works in Private Rooms and Party Island (not in public Quick Play)');
    if (this.state !== 'play') return no('Start the match first');
    if (!p.alive) return no('You are knocked out. Wait for the next match!');
    if (p.phase !== 'ground') return no('Land first, then open the armory');
    const make = (w, r) => {
      const W = WEAPONS[w];
      r = W.fixedRarity != null ? W.fixedRarity : Math.max(W.minRarity || 0, Math.min(RARITIES.length - 1, r | 0));
      return { w, r, ammo: W.stack || W.mag };
    };
    const room = () => p.inv.length < ADMIN_MAX_SLOTS || p.inv.includes(null);
    if (req.refill) {
      for (const it of p.inv) {
        if (it && it.w) it.ammo = WEAPONS[it.w].stack || WEAPONS[it.w].mag;
        if (it && it.c) it.n = CONSUMABLES[it.c].stack;
      }
      p.hp = MAX_HP; p.pad = MAX_PADDING; p.reloadUntil = 0;
      return { ok: true, msg: '💪 Full ammo, full health and full padding!' };
    }
    if (req.everything) {
      let n = 0;
      const all = [...GUN_IDS.map((w) => make(w, 4)), ...Object.keys(CONSUMABLES).map((c) => ({ c, n: CONSUMABLES[c].stack }))];
      for (const it of all) if (room() && this.giveItem(p, it)) n++;
      return n ? { ok: true, msg: `🎁 Gave you ${n} items (Legendary weapons). Backpack: ${p.inv.filter(Boolean).length} items` } : no(`Backpack is full (${ADMIN_MAX_SLOTS} slots)`);
    }
    if (!GUN_IDS.includes(req.give)) return no('Pick a weapon');
    if (!room()) return no(`Backpack is full (${ADMIN_MAX_SLOTS} slots). Drop something with Q first`);
    const it = make(req.give, req.r);
    if (!this.giveItem(p, it)) return no('No room in your backpack');
    return { ok: true, msg: `🔫 ${RARITIES[it.r].name} ${WEAPONS[it.w].name} added! Backpack: ${p.inv.filter(Boolean).length} items` };
  }

  // ---------- input handlers ----------
  handle(p, m) {
    if (this.closed) return;
    if (m.t === 'start') {
      if (this.state === 'lobby' && p.id === this.hostId) this.start();
      return;
    }
    if (m.t === 'spec') { p.specId = m.id | 0; return; }   // who a dead player watches (interest management)
    if (this.state !== 'play' || !p.alive) return;
    if (m.t === 'veh') return this.veh.onVeh(p, m);
    if (p.vehicle && NO_DRIVING.has(m.t)) return; // hands on the wheel
    switch (m.t) {
      case 'in': return this.onInput(p, m);
      case 'jump': if (p.phase === 'blimp' && now() - this.blimp.t0 > DROP.doorsOpen) this.jumpOut(p); return;
      case 'deploy': if (p.phase === 'fall') p.phase = 'glide'; return;
      case 'fire': return this.onFire(p, m);
      case 'reload': return this.startReload(p);
      case 'slot': {
        const i = m.i | 0;
        if (i >= 0 && i <= p.inv.length && i !== p.slot) { p.slot = i; p.reloadUntil = 0; p.useUntil = 0; this.trimInv(p); }
        return;
      }
      case 'pickup': return this.onPickup(p, m.id);
      case 'open': return this.onOpen(p, m.id);
      case 'drop': {
        if (p.slot > 0 && p.inv[p.slot - 1]) {
          const it = p.inv[p.slot - 1]; p.inv[p.slot - 1] = null;
          this.trimInv(p);
          const fx = -Math.sin(p.yaw) * 1.5, fz = -Math.cos(p.yaw) * 1.5;
          this.dropLoot(it, p.x + fx, p.y, p.z + fz, p.x, p.z);
        }
        return;
      }
      case 'build': return this.onBuild(p, m);
    }
  }

  jumpOut(p) {
    const b = this.blimpPos(now());
    p.phase = 'fall';
    p.x = b.x; p.y = b.y - 4; p.z = b.z;
    p.vx = this.blimp.dx * DROP.speed * 0.4; p.vz = this.blimp.dz * DROP.speed * 0.4; p.vy = 0;
    p.lastIn = { t: now(), x: p.x, y: p.y, z: p.z };
    this.events.push(['jmp', p.id]);
    if (!p.bot) p.pev.push(['corr', r2(p.x), r2(p.y), r2(p.z), 'fall']);
  }

  onInput(p, m) {
    if (typeof m.yaw === 'number') p.yaw = m.yaw;
    if (typeof m.pitch === 'number') p.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
    p.emote = (p.bot ? EMOTES.some((e) => e.id === m.em) : canUseEmote(m.em, p.profile)) ? m.em : 0;
    if (p.phase === 'blimp') return;
    if (p.vehicle) { p.emote = 0; return this.veh.onDriveInput(p, m); }
    const x = +m.x, y = +m.y, z = +m.z;
    if (![x, y, z].every(Number.isFinite)) return;
    const t = now();
    const last = p.lastIn || { t: t - DT, x: p.x, y: p.y, z: p.z };
    const dt = Math.max(DT, Math.min(1, t - last.t));
    const spd = p.phase === 'fall' ? 40 : p.phase === 'glide' ? 26 : PLAYER.sprint;
    const allowed = spd * dt * 1.6 + 1.5;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > allowed || y > p.y + 14 * dt + 2 || Math.abs(x) > MAP_HALF || Math.abs(z) > MAP_HALF) {
      p.pev.push(['corr', p.x, p.y, p.z]);
      p.lastIn = { t, x: p.x, y: p.y, z: p.z };
      return;
    }
    p.x = x; p.y = y; p.z = z;
    if (m.ph === 'glide' && p.phase === 'fall') p.phase = 'glide';
    if (m.ph === 'ground' && (p.phase === 'fall' || p.phase === 'glide')) { p.phase = 'ground'; p.onGround = true; }
    p.lastIn = { t, x, y, z };
  }

  posAt(p, t) {
    const h = p.hist;
    if (!h.length || t >= h[h.length - 1].t) return p;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return h[0];
  }

  currentItem(p) { return p.slot === 0 ? { w: 'tackle', r: 0 } : p.inv[p.slot - 1] || null; }

  startReload(p) {
    const it = this.currentItem(p);
    if (!it || !it.w) return;
    const W = WEAPONS[it.w];
    // reloadUntil stays set until simulate() finishes the reload: restarting it in the
    // tick it runs out used to throw the reload away (bots then reloaded forever)
    if (!W.mag || it.ammo >= W.mag || p.reloadUntil) return;
    p.reloadUntil = now() + W.reload;
    p.reloadSlot = p.slot;
    p.useUntil = 0;
  }

  onFire(p, m) {
    if (p.phase !== 'ground') return;
    const t = now();
    const it = this.currentItem(p);
    if (!it) return;
    p.emote = 0;
    if (it.c) { // consumable: start using
      const C = CONSUMABLES[it.c];
      if (p.useUntil) return; // still using (or just finished: simulate() applies it this tick)
      if (C.heal && p.hp >= C.max) return p.pev.push(['msg', `Already at ${C.max} health`]);
      if (C.padding && p.pad >= C.max) return p.pev.push(['msg', 'Padding is full']);
      p.useUntil = t + C.time; p.useSlot = p.slot;
      p.pev.push(['use', C.time]);
      return;
    }
    const W = WEAPONS[it.w];
    if (t < p.nextFire - 0.04) return;
    if (W.mag && (it.ammo <= 0 || p.reloadUntil)) return;
    const rateMul = p.bot ? (p.ai && p.ai.rateMul) || BOT_DIFFICULTY[this.difficulty].fireMul : 1;
    p.nextFire = Math.max(t, p.nextFire) + 1 / (W.rate * rateMul);
    if (p.nextFire < t) p.nextFire = t + 1 / (W.rate * rateMul);
    p.useUntil = 0;
    const aim = norm(m.aim);
    if (!aim) return;
    const ox = p.x, oy = p.y + PLAYER.eye, oz = p.z;
    const rt = Math.max(t - 0.35, Math.min(t, +m.rt || t));
    const rtFor = (q) => rt - this.netDelay(p, q);   // far players are drawn a little further in the past
    const code = WCODES.indexOf(it.w) * 8 + (it.r || 0);

    if (W.kind === 'melee') {
      let hitAny = false;
      for (const q of this.players.values()) {
        if (q === p || !q.alive || q.phase !== 'ground') continue;
        const pos = this.posAt(q, rtFor(q));
        const dx = pos.x - ox, dz = pos.z - oz, dist = Math.hypot(dx, dz);
        if (dist > W.range + 0.4 || Math.abs(pos.y - p.y) > 1.6) continue;
        if ((dx * aim[0] + dz * aim[2]) / (dist || 1) < 0.5) continue;
        this.damage(q, W.damage, p, 'tackle', false);
        p.pev.push(['hit', W.damage, 0, q.x, q.y + 1.2, q.z]);
        hitAny = true; break;
      }
      if (!hitAny) {
        const hit = raycastWorld(this.world, ox, oy, oz, aim[0], aim[1], aim[2], 3);
        if (hit && hit.box) {
          if (hit.box.pid) this.damagePiece(hit.box.pid, 50);
          if (hit.box.vid) this.veh.damage(hit.box.vid, 25);
          if (this.mode === 'build') { p.mats = Math.min(BUILD.maxMats, p.mats + BUILD.harvest); p.pev.push(['mats', BUILD.harvest]); }
        }
      }
      this.events.push(['sw', p.id]);
      return;
    }

    if (W.kind === 'projectile' || W.kind === 'throw') {
      const sp = W.speed;
      const pr = {
        id: this.nextId++, kind: it.w, owner: p.id, x: ox + aim[0] * 0.8, y: oy + aim[1] * 0.8 - 0.1, z: oz + aim[2] * 0.8,
        vx: aim[0] * sp, vy: aim[1] * sp + (W.kind === 'throw' ? 5 : 1.5), vz: aim[2] * sp,
        grav: W.grav, born: t, fuse: W.fuse || 6, dmg: weaponDamage(it.w, it.r), splash: W.splash,
      };
      this.projectiles.push(pr);
      this.events.push(['pr', pr.id, it.w, r2(pr.x), r2(pr.y), r2(pr.z), r2(pr.vx), r2(pr.vy), r2(pr.vz), p.id]);
      it.ammo--;
      if (W.kind === 'throw' && it.ammo <= 0) p.inv[p.slot - 1] = null;
      return;
    }

    // hitscan
    it.ammo--;
    const pellets = W.pellets || 1;
    const maxSpread = Math.max(W.spread, W.adsSpread) * 2.5 + 0.03;
    const dirs = Array.isArray(m.dirs) ? m.dirs.slice(0, pellets) : [];
    while (dirs.length < pellets) dirs.push(aim);
    const ends = [];
    let total = 0, head = false, lastHit = null, hitTarget = null;
    const dmgBase = weaponDamage(it.w, it.r);
    for (let raw of dirs) {
      let d = norm(raw) || aim;
      if (d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2] < Math.cos(maxSpread)) d = aim;
      const wh = raycastWorld(this.world, ox, oy, oz, d[0], d[1], d[2], W.range);
      let bestT = wh ? wh.t : W.range, bestQ = null;
      for (const q of this.players.values()) {
        if (q === p || !q.alive || q.phase === 'blimp') continue;
        const pos = q.phase === 'ground' ? this.posAt(q, rtFor(q)) : q;
        if (Math.abs(pos.x - ox) > bestT + 2 || Math.abs(pos.z - oz) > bestT + 2) continue;
        const tq = rayPlayer(pos.x, pos.y, pos.z, ox, oy, oz, d[0], d[1], d[2]);
        if (tq !== null && tq < bestT) {
          bestT = tq; bestQ = q;
          bestQ._hy = oy + d[1] * tq - pos.y;
        }
      }
      ends.push(r2(ox + d[0] * bestT), r2(oy + d[1] * bestT), r2(oz + d[2] * bestT));
      if (bestQ) {
        let dmg = dmgBase;
        const isHead = bestQ._hy > PLAYER.head;
        if (isHead) { dmg *= W.head; head = true; }
        if (it.w === 'shotgun' && bestT > 8) dmg *= Math.max(0.25, 1 - (bestT - 8) / 22);
        else if (bestT > W.range * 0.6) dmg *= 0.8;
        total += dmg; hitTarget = bestQ;
        lastHit = [bestQ.x, bestQ.y + 1.2, bestQ.z];
        this.damage(bestQ, dmg, p, it.w, isHead);
      } else if (wh && wh.box && wh.box.pid) {
        this.damagePiece(wh.box.pid, dmgBase);
      } else if (wh && wh.box && wh.box.vid) {
        this.veh.damage(wh.box.vid, dmgBase);
      }
    }
    this.events.push(['sh', p.id, code, r2(ox), r2(oy), r2(oz), ...ends]);
    if (hitTarget) p.pev.push(['hit', Math.round(total), head ? 1 : 0, ...lastHit.map(r2), hitTarget.alive ? 0 : 1]);
  }

  damage(q, amount, by, wid, head) {
    if (!q.alive || this.kind === 'island' || this.state !== 'play') return; // nobody gets hurt after the win
    if (by && by !== q && by.team === q.team) return; // no hurting teammates
    amount = Math.round(amount);
    const fromPad = Math.min(q.pad, amount);
    q.pad -= fromPad;
    q.hp -= amount - fromPad;
    q.emote = 0;
    q.useUntil = 0;
    if (by) {
      q.pev.push(['hurt', r2(by.x), r2(by.z)]);
      if (q.bot && q.ai) { q.ai.attacker = by.id; q.ai.hurtAt = now(); }
    }
    if (q.hp <= 0) this.kill(q, by, wid, head);
  }

  kill(q, by, wid, head) {
    if (q.vehicle) this.veh.exit(q);
    q.hp = 0; q.alive = false;
    const remaining = this.alive.length;
    q.place = remaining + 1;
    q.phase = 'dead';
    if (by && by !== q) { by.kills++; this.reward(by, BUCKS.perElim, 'elimination', 'kills'); }
    if (wid !== 'quit' && q.place <= 10 && q.place > 1) this.reward(q, BUCKS.top10, `top ${q.place}`);
    else if (wid !== 'quit' && q.place <= 25 && q.place > 1) this.reward(q, BUCKS.top25, `top ${q.place}`);
    this.events.push(['kf', by ? by.id : 0, q.id, wid || 'storm', head ? 1 : 0]);
    q.pev.push(['dead', q.place, by ? by.id : 0]);
    // fumble the loot (not on Party Island: people leaving would pile up party gear)
    const items = this.kind === 'island' ? [] : q.inv.filter(Boolean);
    if (q.mats > 0) items.push({ mats: q.mats });
    items.forEach((it, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2;
      this.dropLoot(it, q.x + Math.cos(a) * 1.3, q.y, q.z + Math.sin(a) * 1.3, q.x, q.z);
    });
    q.inv = emptyInv();
    if (q.slot > INV_SLOTS) q.slot = 0;
    q.mats = 0;
    this.checkWin();
  }

  checkWin() {
    if (this.state !== 'play') return;
    const alive = this.alive;
    const teams = new Set(alive.map((p) => p.team));
    if (this.kind !== 'island' && teams.size <= 1) {
      const w = alive.find((p) => !p.bot) || alive[0];
      this.state = 'ended';
      this.endedAt = now();
      if (w) w.place = 1;
      const top = [...this.players.values()].sort((a, b) => b.kills - a.kills).slice(0, 5).map((p) => [p.name, p.kills]);
      const names = alive.map((p) => p.name).join(' & ') || 'Nobody';
      for (const p of alive) { p.place = 1; this.reward(p, BUCKS.win, 'VICTORY', 'wins'); }
      this.events.push(['win', w ? w.id : 0, names, w ? w.team : 0]);
      this.final = { t: 'end', winner: w ? w.id : 0, winnerName: names, team: w ? w.team : 0, top };
    }
  }

  onPickup(p, id) {
    const l = this.loot.get(id);
    if (!l || p.phase !== 'ground') return;
    if (Math.hypot(l.x - p.x, l.z - p.z) > PICKUP_RANGE + 1.2 || Math.abs(l.y - p.y) > 2.5) return;
    if (this.giveItem(p, l.item)) {
      this.loot.delete(id);
      this.events.push(['l-', id]);
    }
  }

  onOpen(p, id) {
    const c = this.chests[id];
    if (!c || c.open || p.phase !== 'ground') return;
    if (Math.hypot(c.x - p.x, c.z - p.z) > PICKUP_RANGE + 1.2 || Math.abs(c.y - p.y) > 2.5) return;
    c.open = true;
    this.events.push(['co', id]);
    const items = [this.rollWeapon(true), this.rollWeapon(true), this.rollItem(true)]; // MORE LOOT: 2 weapons per bag
    if (this.rnd() < 0.7) items.push({ c: 'padding', n: 1 });
    if (this.mode === 'build') items.push({ mats: BUILD.crateMats });
    items.forEach((it, i) => {
      const a = (i / items.length) * Math.PI * 2 + 0.4;
      this.dropLoot(it, c.x + Math.cos(a) * 1.2, c.y, c.z + Math.sin(a) * 1.2, c.x, c.z);
    });
  }

  // ---------- building ----------
  onBuild(p, m) {
    if (this.mode !== 'build' || p.phase !== 'ground') return;
    const kind = ['wall', 'floor', 'ramp'].includes(m.k) ? m.k : null;
    if (!kind || p.mats < BUILD.cost) return;
    let gx = m.gx | 0, gy = m.gy | 0, gz = m.gz | 0, r = (m.r | 0) & 3;
    if (gy < 0 || gy > 20) return;
    if (kind === 'wall') { // normalise so each edge has one key
      if (r === 2) { gz -= 1; r = 0; } else if (r === 3) { gx -= 1; r = 1; }
    }
    const key = kind === 'wall' ? `w${gx},${gy},${gz},${r}` : kind === 'floor' ? `f${gx},${gy},${gz}` : `r${gx},${gy},${gz}`;
    if (this.pieceKeys.has(key)) return;
    const G = BUILD.grid;
    const cx = gx * G + G / 2, cy = gy * G + G / 2, cz = gz * G + G / 2;
    if (Math.hypot(cx - p.x, cz - p.z) > 12 || Math.abs(cy - p.y) > 12) return;
    const b = pieceBox(kind, gx, gy, gz, r, G, BUILD.thick);
    // no walling other players in (you can step out of your own)
    if (kind === 'wall') {
      for (const q of this.players.values()) {
        if (q === p || !q.alive || q.phase !== 'ground') continue;
        const R = PLAYER.radius;
        if (q.x + R > b.min[0] && q.x - R < b.max[0] && q.z + R > b.min[2] && q.z - R < b.max[2] && q.y < b.max[1] && q.y + PLAYER.height > b.min[1]) return;
      }
    }
    const piece = { id: this.nextId++, kind, gx, gy, gz, r, hp: BUILD.hp[kind], key };
    b.pid = piece.id; b.kind = 'piece';
    piece.box = this.world.add(b);
    this.pieces.set(piece.id, piece);
    this.pieceKeys.set(key, piece.id);
    p.mats -= BUILD.cost;
    this.events.push(['pc', piece.id, kind, gx, gy, gz, r, piece.hp]);
  }

  damagePiece(id, dmg) {
    const pc = this.pieces.get(id);
    if (!pc) return;
    pc.hp -= dmg;
    if (pc.hp <= 0) {
      this.world.remove(pc.box.id);
      this.pieces.delete(id);
      this.pieceKeys.delete(pc.key);
      this.events.push(['pd', id]);
      // loot that was lying on this piece falls down
      const bx = pc.box;
      for (const l of [...this.loot.values()]) {
        if (l.x < bx.min[0] || l.x > bx.max[0] || l.z < bx.min[2] || l.z > bx.max[2] || l.y < bx.min[1] - 0.1) continue;
        const y = supportHeight(this.world, l.x, l.y + 0.1, l.z);
        if (y < l.y - 0.05) { this.loot.delete(l.id); this.events.push(['l-', l.id]); this.dropLoot(l.item, l.x, y, l.z); }
      }
    } else this.events.push(['ph', id, Math.round(pc.hp)]);
  }

  // ---------- explosions & projectiles ----------
  explode(pr, x, y, z) {
    this.events.push(['bm', pr.id, r2(x), r2(y), r2(z), pr.kind]);
    const owner = this.players.get(pr.owner);
    let hitAny = 0;
    for (const q of this.players.values()) {
      if (!q.alive || q.phase === 'blimp') continue;
      const d = Math.hypot(q.x - x, q.y + 0.9 - y, q.z - z);
      if (d > pr.splash) continue;
      // drivers sit up high in their vehicle (whose box would otherwise hide them)
      if (!lineOfSight(this.world, x, y + 0.2, z, q.x, q.y + (q.vehicle ? 1.6 : 1), q.z)) continue;
      let dmg = pr.dmg * (0.35 + 0.65 * (1 - d / pr.splash));
      if (q === owner) dmg *= 0.4;
      const kd = Math.max(0.5, d), kp = (1 - d / pr.splash) * 16;
      if (!q.bot) q.pev.push(['kb', r2((q.x - x) / kd * kp), r2(6 + kp * 0.5), r2((q.z - z) / kd * kp)]);
      if (owner && q !== owner) hitAny += dmg;
      this.damage(q, dmg, owner && owner.alive !== undefined ? owner : null, pr.kind, false);
    }
    if (owner && hitAny) owner.pev.push(['hit', Math.round(hitAny), 0, r2(x), r2(y), r2(z), 0]);
    this.veh.explode(x, y, z, pr.dmg, pr.splash);
    for (const b of this.world.query(x - pr.splash, z - pr.splash, x + pr.splash, z + pr.splash, [])) {
      if (!b.pid) continue;
      const bx = (b.min[0] + b.max[0]) / 2, by = (b.min[1] + b.max[1]) / 2, bz = (b.min[2] + b.max[2]) / 2;
      if (Math.hypot(bx - x, by - y, bz - z) < pr.splash + 2) this.damagePiece(b.pid, pr.dmg * 1.6);
    }
  }

  stepProjectiles(t) {
    const keep = [];
    for (const pr of this.projectiles) {
      let dead = false;
      const steps = 2, dt = DT / steps;
      for (let s = 0; s < steps && !dead; s++) {
        pr.vy -= pr.grav * dt;
        const L = Math.hypot(pr.vx, pr.vy, pr.vz) * dt;
        const dx = pr.vx * dt / L, dy = pr.vy * dt / L, dz = pr.vz * dt / L;
        const hit = raycastWorld(this.world, pr.x, pr.y, pr.z, dx, dy, dz, L + 0.15);
        // players
        let pt = null;
        if (pr.kind === 'pigskin') {
          for (const q of this.players.values()) {
            if (!q.alive || q.phase === 'blimp' || (q.id === pr.owner && t - pr.born < 0.3)) continue;
            const tq = rayPlayer(q.x, q.y, q.z, pr.x, pr.y, pr.z, dx, dy, dz);
            if (tq !== null && tq <= L && (pt === null || tq < pt)) pt = tq;
          }
        }
        if (pt !== null && (!hit || pt < hit.t)) {
          this.explode(pr, pr.x + dx * pt, pr.y + dy * pt, pr.z + dz * pt); dead = true; break;
        }
        if (hit) {
          const hx = pr.x + dx * hit.t, hy = pr.y + dy * hit.t, hz = pr.z + dz * hit.t;
          if (pr.kind === 'pigskin') { this.explode(pr, hx - dx * 0.2, hy - dy * 0.2, hz - dz * 0.2); dead = true; break; }
          // bounce
          const n = hit.box && !hit.box.ramp ? faceNormal(hit.box, hx, hy, hz) : 1;
          pr.x = hx - dx * 0.05; pr.y = hy - dy * 0.05; pr.z = hz - dz * 0.05;
          if (n === 0) pr.vx = -pr.vx * 0.45; else if (n === 2) pr.vz = -pr.vz * 0.45;
          else { pr.vy = Math.abs(pr.vy) * 0.4; pr.vx *= 0.6; pr.vz *= 0.6; if (pr.vy < 1) pr.vy = 0; }
          if (pr.y < 0.05) pr.y = 0.05;
        } else { pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; }
      }
      if (!dead && t - pr.born > pr.fuse) { this.explode(pr, pr.x, pr.y + 0.2, pr.z); dead = true; }
      if (!dead) keep.push(pr);
    }
    this.projectiles = keep;
  }

  // ---------- storm ----------
  pickZoneTarget() {
    const z = this.zone, ph = ZONE_PHASES[z.ph];
    const slack = Math.max(0, z.r - ph.radius);
    const lim = MAP_HALF - ph.radius * 0.6 - 20;
    for (let i = 0; i < 20; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * slack * (z.ph === 0 ? 0.55 : 0.9);
      const tx = z.cx + Math.cos(a) * d, tz = z.cz + Math.sin(a) * d;
      if (Math.abs(tx) < lim && Math.abs(tz) < lim) { z.tx = tx; z.tz = tz; break; }
      z.tx = z.cx * 0.5; z.tz = z.cz * 0.5;
    }
    z.tr = ph.radius;
  }

  stepZone(t) {
    const z = this.zone;
    if (t < z.t0) return;
    const ph = ZONE_PHASES[z.ph];
    if (z.st === 0 && t >= z.end) { z.st = 1; z.fx = z.cx; z.fz = z.cz; z.fr = z.r; z.end = t + ph.shrink; z.sStart = t; }
    if (z.st === 1) {
      const k = Math.min(1, (t - z.sStart) / ph.shrink);
      z.cx = z.fx + (z.tx - z.fx) * k; z.cz = z.fz + (z.tz - z.fz) * k; z.r = z.fr + (z.tr - z.fr) * k;
      if (k >= 1) {
        if (z.ph < ZONE_PHASES.length - 1) {
          z.ph++; z.st = 0; z.end = t + ZONE_PHASES[z.ph].wait; this.pickZoneTarget();
        } else z.st = 2;
      }
    }
  }

  zoneMsg() {
    const z = this.zone;
    return [r2(z.cx), r2(z.cz), r2(z.r), r2(z.tx), r2(z.tz), r2(z.tr), z.st, r2(z.end), z.ph, r2(z.t0)];
  }

  // ---------- main loop ----------
  tick() {
    if (this.closed) return;
    const t = now();
    this.lastTick = t;
    if (this.state === 'lobby') {
      if (this.countdownEnd && t >= this.countdownEnd) this.start();
      else if (Math.floor(t * TICK_RATE) % TICK_RATE === 0) this.broadcastLobby();
      return;
    }
    if (this.kind === 'island' && this.humans.length === 0) {
      this.emptySince = this.emptySince || t;
      if (t - this.emptySince > 600) return this.close(); // empty for 10 minutes
    } else this.emptySince = 0;
    if (this.state === 'play') this.simulate(t);
    this.sendSnapshots(t);
    if (this.state === 'ended') {
      if (!this.finalSent) {
        this.finalSent = true;
        const s = JSON.stringify(this.final);
        for (const p of this.humans) this.send(p, s);
      }
      if (t - this.endedAt > 20) this.close();
    }
  }

  simulate(t) {
    const bp = this.blimp ? this.blimpPos(t) : { done: false };
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.phase === 'blimp') {
        p.x = bp.x; p.y = bp.y; p.z = bp.z;
        if (bp.done) this.jumpOut(p);
      }
      if (p.bot) updateBot(this, p, DT, t);
      // reload / consumables
      if (p.reloadUntil && t >= p.reloadUntil) {
        const it = p.slot === p.reloadSlot ? this.currentItem(p) : null;
        if (it && it.w && WEAPONS[it.w].mag) it.ammo = WEAPONS[it.w].mag;
        p.reloadUntil = 0;
      }
      if (p.useUntil && t >= p.useUntil) {
        p.useUntil = 0;
        const it = p.slot === p.useSlot ? this.currentItem(p) : null;
        if (it && it.c) {
          const C = CONSUMABLES[it.c];
          if (C.heal) p.hp = Math.max(p.hp, Math.min(C.max, p.hp + C.heal));
          if (C.padding) p.pad = Math.min(MAX_PADDING, p.pad + C.padding);
          if (--it.n <= 0) p.inv[p.slot - 1] = null;
        }
      }
      // history for lag compensation
      p.hist.push({ t, x: p.x, y: p.y, z: p.z });
      if (p.hist.length > 12) p.hist.shift();
    }
    this.stepProjectiles(t);
    this.stepZone(t);
    // storm damage once per second
    if (t >= this.zone.t0 && Math.floor(t) !== this.lastStormSec) {
      this.lastStormSec = Math.floor(t);
      const z = this.zone, dps = ZONE_PHASES[z.ph].dps;
      for (const p of this.players.values()) {
        if (!p.alive || p.phase === 'blimp') continue;
        if (this.state !== 'play') break; // the match was just won
        if (Math.hypot(p.x - z.cx, p.z - z.cz) > z.r) {
          p.hp -= dps; p.emote = 0;
          p.pev.push(['storm']);
          if (p.hp <= 0) this.kill(p, null, 'storm', false);
        }
      }
    }
  }

  // Snapshots: per-client interest management + delta encoding (see shared/netcodec.js).
  // Near players are sent every tick, far ones every 2nd/4th tick, unchanged ones not at all.
  sendSnapshots(t) {
    const tick = Math.round(t * TICK_RATE);
    // quantize every visible player once per tick
    const cur = this._netCur || (this._netCur = new Map());
    cur.clear();
    const vis = [];
    for (const p of this.players.values()) {
      if (!p.alive || p.phase === 'blimp') continue;
      const it = this.currentItem(p);
      const w = !it ? 0 : it.c ? 255 : WCODES.indexOf(it.w) * 8 + (it.r || 0);
      const flags = (p.reloadUntil > t ? 1 : 0) | (p.useUntil > t ? 2 : 0);
      const q = p._nq || (p._nq = new Int32Array(NFIELDS));
      quantize(p.x, p.y, p.z, p.yaw, p.pitch, PHASE_CODE[p.phase], w, p.emote, flags, q);
      cur.set(p.id, q);
      vis.push(p);
    }
    // events: shots and tackle swings only go to players close enough to see/hear them
    const glob = [], local = [];
    for (const e of this.events) {
      if (e[0] === 'sh') local.push({ e, x: e[3], z: e[5], r: 320 });
      else if (e[0] === 'sw') { const q = this.players.get(e[1]); if (q) local.push({ e, x: q.x, z: q.z, r: 160 }); }
      else glob.push(e);
    }
    this.events = [];
    let head = '{"t":"s","tm":' + r3(t) + ',"al":' + this.alive.length;
    if (tick % 4 === 0) head += ',"zn":' + JSON.stringify(this.zoneMsg());
    const globStr = glob.map((e) => JSON.stringify(e));
    const localStr = local.map((l) => JSON.stringify(l.e));
    const parts = [], gone = [], evs = [];
    const tmp = new Int32Array(NFIELDS);
    for (const p of this.players.values()) {
      if (p.bot) { p.pev.length = 0; continue; }
      if (!p.ws || p.ws.readyState !== 1) continue;
      const net = p.net || (p.net = { known: new Map(), band: new Map() });
      // where this client is looking from: itself, or the player it spectates
      let ref = p;
      if (!p.alive && p.specId) { const sp = this.players.get(p.specId); if (sp && sp.alive) ref = sp; }
      parts.length = 0; gone.length = 0;
      for (const id of net.known.keys()) if (!cur.has(id)) { net.known.delete(id); net.band.delete(id); gone.push(id); }
      for (const q of vis) {
        if (q === p) continue;
        const prevEvery = net.band.get(q.id) || 0;
        const dx = q.x - ref.x, dz = q.z - ref.z;
        const every = q.team === p.team ? 1 : bandFor(Math.sqrt(dx * dx + dz * dz), prevEvery);
        const last = net.known.get(q.id);
        // due on its staggered slot; sent right away when new or when it moved to a finer band
        if (last && every >= prevEvery && (tick + q.id) % every !== 0) continue;
        net.band.set(q.id, every);
        tmp.set(cur.get(q.id)); tmp[9] = every;
        // a full keyframe now and then (staggered) so a client can never drift
        const key = !!last && (tick + q.id * 7) % KEY_TICKS < every;
        const upd = encodeEntry(q.id, tmp, last || null, parts, key);
        if (upd && !last) net.known.set(q.id, upd);
      }
      evs.length = 0;
      for (const s of globStr) evs.push(s);
      for (let i = 0; i < local.length; i++) {
        const l = local[i];
        if (Math.abs(l.x - ref.x) < l.r && Math.abs(l.z - ref.z) < l.r) evs.push(localStr[i]);
      }
      let msg = head + ',"ps":[' + parts.join(',') + '],"ev":[' + evs.join(',') + ']';
      msg += this.veh.snapshotFor(p, ref, tick);
      if (gone.length) msg += ',"pg":[' + gone.join(',') + ']';
      const me = {
        hp: Math.max(0, Math.round(p.hp)), pad: Math.round(p.pad), inv: p.inv, slot: p.slot, mats: p.mats, k: p.kills,
        ph: p.phase, rl: p.reloadUntil > t ? r2(p.reloadUntil - t) : 0, us: p.useUntil > t ? r2(p.useUntil - t) : 0,
      };
      if (p.phase === 'blimp') { me.x = r2(p.x); me.y = r2(p.y); me.z = r2(p.z); }
      const meStr = JSON.stringify(me);
      if (meStr !== p.lastMe || tick % 10 === 0) { msg += ',"me":' + meStr; p.lastMe = meStr; }
      if (p.pev.length) { msg += ',"pe":' + JSON.stringify(p.pev); p.pev = []; }
      p.ws.send(msg + '}');
    }
  }

  // Extra delay (s) the client `p` draws player `q` with (far players arrive less often);
  // hit detection rewinds `q` by the same amount so lag compensation matches what was on screen.
  netDelay(p, q) {
    const every = p.net && p.net.band.get(q.id);
    return every ? extraDelay(every, TICK_RATE) : 0;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    for (const p of this.humans) this.send(p, { t: 'closed' });
    this.onClose && this.onClose(this);
  }
}

function norm(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v.map(Number);
  const l = Math.hypot(x, y, z);
  if (!Number.isFinite(l) || l < 1e-6) return null;
  return [x / l, y / l, z / l];
}
function faceNormal(b, x, y, z) {
  const d = [
    Math.min(Math.abs(x - b.min[0]), Math.abs(x - b.max[0])),
    Math.min(Math.abs(y - b.min[1]), Math.abs(y - b.max[1])),
    Math.min(Math.abs(z - b.min[2]), Math.abs(z - b.max[2])),
  ];
  return d[0] < d[1] && d[0] < d[2] ? 0 : d[2] < d[1] ? 2 : 1;
}
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
export { MAP };
