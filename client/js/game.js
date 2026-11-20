// The in-match game: movement, shooting, building, emotes, camera and syncing.
import * as THREE from 'three';
import { World, stepPlayer, stepFalling, raycastWorld, rayPlayer, pieceBox } from '/shared/physics.js';
import { WEAPONS, CONSUMABLES, itemName, RARITIES } from '/shared/weapons.js';
import { PLAYER, DROP, BUILD, PICKUP_RANGE, ZONE_PHASES, TICK_RATE, ZONE_START_RADIUS } from '/shared/constants.js';
import { EMOTES } from '/shared/skins.js';
import { buildWorld } from './world.js';
import {
  createPlayer, animatePlayer, disposePlayer, createWeaponModel, createConsumable,
  createBlimp, createFootball, turfMaterial, mat, WCODES, createHand, setupEnvironment,
} from './models.js';
import { sfx } from './audio.js';
import { createTouchControls } from './touch.js';
import { PlayerRenderer } from './players.js';
import { Vehicles } from './vehicles.js';
import { LootRenderer, ChestRenderer } from './instanced.js';
import { attachRenderer, getSettings, onQualityChange, frameTick } from './quality.js';
import { createSnapshotDecoder, extraDelay } from '/shared/netcodec.js';

const $ = (id) => document.getElementById(id);
const PH = ['ground', 'blimp', 'fall', 'glide', 'dead'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const dirFrom = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };
const nowS = () => performance.now() / 1000;
const WHISTLE_GEO = new THREE.SphereGeometry(0.15, 8, 6);

export class Game {
  constructor({ renderer, map, hud, net, myId, mode, kind, mySkin, settings, onLeave, emotes, onPlayAgain, onShare, confetti }) {
    this.onPlayAgain = onPlayAgain; this.onShare = onShare; this.confetti = confetti || (() => {});
    this.myEmotes = emotes || EMOTES.filter((e) => !e.price);
    this.renderer = renderer; this.map = map; this.hud = hud; this.net = net;
    this.myId = myId; this.mode = mode; this.kind = kind; this.mySkin = mySkin;
    this.settings = settings; this.onLeave = onLeave;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov(), innerWidth / innerHeight, 0.08, 2000);
    this.world = new World();
    for (const b of map.boxes) this.world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
    const before = new Set(this.scene.children);
    const w = buildWorld(this.scene, map);
    this.worldObjects = this.scene.children.filter((o) => !before.has(o));
    setupEnvironment(renderer, this.scene, 0.5);
    this.storm = w.storm; this.stormTex = w.stormTex;
    this.decodePs = createSnapshotDecoder();
    this.roster = new Map(); this.ents = new Map(); this.loot = new Map(); this.chests = new Map();
    this.pieces = new Map(); this.projs = new Map(); this.fx = []; this.kills = new Map();
    this.me = { hp: 100, pad: 0, inv: [null, null, null, null, null], slot: 0, mats: 0, k: 0, ph: 'blimp', rl: 0, us: 0 };
    this.local = { x: 0, y: DROP.height, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, phase: 'blimp' };
    this.yaw = 0; this.pitch = -0.2;
    this.keys = new Set(); this.mouse = { left: false, right: false, leftEdge: false };
    this.offset = null; this.alive = 75; this.zone = null; this.zoneDisp = null;
    this.nextFire = 0; this.reloadUntil = 0; this.recoil = 0; this.swing = 0; this.buildKind = null; this.nextBuild = 0;
    this.emote = null; this.dead = false; this.spectateId = 0; this.ended = false; this.emoteMenu = false; this.bigMap = false;
    this.lastSend = 0; this.frame = 0; this.useTotal = 1;
    this.ads = 0;
    // game feel & end-of-match bookkeeping
    this.result = { dmg: 0, bucks: 0, place: 0, win: false, elims: 0 };
    this.shake = 0; this.timeScale = 1; this.slowMoUntil = 0; this.victoryCam = null;
    this.myKillTimes = []; this.lastAlive = null; this.zoneSeen = null; this.stormWarned = '';
    this.nextHeart = 0; this.pendingDmg = 0; this.fpsAcc = { n: 0, t: 0 }; this.stepPhase = {};
    this.blimpMesh = createBlimp(); this.blimpMesh.visible = false; this.scene.add(this.blimpMesh);
    this.myModel = createPlayer(mySkin); this.myModel.visible = false; this.scene.add(this.myModel);
    // chests, floor loot and other players are drawn instanced / with levels of detail
    attachRenderer(renderer);
    this.lootR = new LootRenderer(this.scene);
    this.chestR = new ChestRenderer(this.scene);
    this.players = new PlayerRenderer(this.scene);
    this.veh = new Vehicles(this); // drivable vehicles (client/js/vehicles.js)
    map.chests.forEach((c, i) => {
      this.chestR.add(i, c.x, c.y, c.z);
      this.chests.set(i, { x: c.x, y: c.y, z: c.z });
    });
    this.applyQuality = () => {
      const P = getSettings();
      if (this.scene.fog) this.scene.fog.far = P.fogFar;
      this.camera.far = P.camFar; this.camera.updateProjectionMatrix();
    };
    this.offQuality = onQualityChange(this.applyQuality);
    this.applyQuality();
    this.setupViewmodel();
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3fa2ff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.pieceMat = turfMaterial();
    this.bindInput();
    this.touch = createTouchControls(this); // phones/tablets: on-screen controls (null on desktop)
    this.running = true;
    this.lastFrame = nowS();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.hud.show(true);
    this.hud.clearCallouts(); this.hud.clearTips(); this.hud.lowHealth(0);
    this.hud.fps(this.settings.showFps ? '-- FPS' : null);
    $('mats').classList.toggle('hidden', mode !== 'build');
    this.onResize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.vmCam.aspect = innerWidth / innerHeight; this.vmCam.updateProjectionMatrix(); };
    addEventListener('resize', this.onResize);
  }

  // ---------- first-person arms & weapon ----------
  setupViewmodel() {
    this.vmScene = new THREE.Scene();
    setupEnvironment(this.renderer, this.vmScene, 0.6);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(1, 2, 1); this.vmScene.add(d);
    this.vmCam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 10);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    this.vmHeld = null; this.vmCode = '';
    const skinMat = new THREE.MeshStandardMaterial({ color: this.mySkin.tone || '#c98e62', roughness: 0.62 });
    const tape = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.8 });
    const arm = (x, side) => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.LatheGeometry([[0.034, -0.25], [0.04, -0.2], [0.05, -0.1], [0.052, 0.05], [0.055, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 12), skinMat);
      fore.rotation.x = -Math.PI / 2; fore.position.z = 0.12; g.add(fore);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.038, 0.05, 12), tape); t.rotation.x = Math.PI / 2; t.position.z = -0.115; g.add(t);
      const h = createHand(this.mySkin.accent, side); h.rotation.x = -Math.PI / 2; h.rotation.y = side * 0.3; h.position.z = -0.135; g.add(h);
      g.position.set(x, -0.05, 0); return g;
    };
    this.vmArmR = arm(0.06, 1); this.vmArmL = arm(-0.16, -1); this.vmArmL.rotation.y = -0.5;
    this.vm.add(this.vmArmR, this.vmArmL);
  }
  updateViewmodelItem() {
    const it = this.currentItem();
    const code = this.buildKind ? 'build' : it ? JSON.stringify([it.w, it.c, it.r]) : 'none';
    if (code === this.vmCode) return;
    this.vmCode = code;
    if (this.vmHeld) this.vm.remove(this.vmHeld);
    this.vmHeld = null;
    if (this.buildKind) return;
    if (it && it.w && it.w !== 'tackle') { this.vmHeld = createWeaponModel(it.w, it.r); this.vmHeld.position.set(0.06, 0.02, -0.15); }
    else if (it && it.c) { this.vmHeld = createConsumable(it.c); this.vmHeld.scale.setScalar(0.5); this.vmHeld.position.set(0.06, 0.05, -0.25); }
    if (this.vmHeld) this.vm.add(this.vmHeld);
    sfx.reload();
  }

  currentItem() { return this.me.slot === 0 ? { w: 'tackle', r: 0 } : this.me.inv[this.me.slot - 1] || null; }
  // Tackle + item slots: 6 for everyone, more for admins with the unlimited backpack.
  slotCount() { return 1 + this.me.inv.length; }
  serverNow() { return nowS() + (this.offset || 0); }

  // ---------- input ----------
  bindInput() {
    const c = this.renderer.domElement;
    this.h = {
      keydown: (e) => {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.code === 'Tab') e.preventDefault();
        if (e.repeat) return;
        this.keys.add(e.code);
        this.onKey(e.code);
      },
      keyup: (e) => { this.keys.delete(e.code); if (e.code === 'Tab') $('scoreboard').classList.add('hidden'); },
      mousemove: (e) => {
        if (document.pointerLockElement !== c) return;
        const s = 0.0022 * this.settings.sens * (this.ads > 0.5 ? this.zoomFactor() : 1);
        this.yaw -= e.movementX * s;
        this.pitch = clamp(this.pitch - e.movementY * s * (this.settings.invertY ? -1 : 1), -1.5, 1.5);
      },
      mousedown: (e) => {
        if (e.target && e.target.closest && e.target.closest('#admin-menu, #party-pop, #shop, #settings, #pause-settings, #result')) return;
        if (this.touch?.active) return;
        if (document.pointerLockElement !== c) { if (!this.dead && !this.emoteMenu && !this.ended) c.requestPointerLock(); return; }
        if (e.button === 0) { this.mouse.left = true; this.mouse.leftEdge = true; if (this.dead) this.cycleSpectate(); }
        if (e.button === 2) this.mouse.right = true;
      },
      mouseup: (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; },
      wheel: (e) => {
        if (document.pointerLockElement !== c || this.dead) return;
        const N = this.slotCount();
        this.selectSlot((this.me.slot + (e.deltaY > 0 ? 1 : N - 1)) % N);
      },
      contextmenu: (e) => e.preventDefault(),
      lockchange: () => {
        const locked = document.pointerLockElement === c;
        $('pause').classList.toggle('hidden', locked || this.touch?.active || this.dead || this.ended || this.emoteMenu || !$('result').classList.contains('hidden'));
        if (!locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      },
    };
    addEventListener('keydown', this.h.keydown); addEventListener('keyup', this.h.keyup);
    addEventListener('mousemove', this.h.mousemove); addEventListener('mousedown', this.h.mousedown);
    addEventListener('mouseup', this.h.mouseup); addEventListener('wheel', this.h.wheel, { passive: true });
    addEventListener('contextmenu', this.h.contextmenu);
    document.addEventListener('pointerlockchange', this.h.lockchange);
    $('resume').onclick = () => (this.touch?.active ? $('pause').classList.add('hidden') : c.requestPointerLock());
    $('quit').onclick = () => this.leave();
    $('res-spectate').onclick = () => { $('result').classList.add('hidden'); this.cycleSpectate(); };
    $('res-leave').onclick = () => this.leave();
    $('res-again').onclick = () => { this.leave(); if (this.onPlayAgain) this.onPlayAgain(); };
    $('res-share').onclick = () => this.onShare && this.onShare(this.shareInfo());
    // emote buttons
    $('emotes').innerHTML = this.myEmotes.map((e, i) => `<button data-e="${e.id}"><b>${i + 1}</b><br>${e.name}${e.price ? ' 🐂' : ''}</button>`).join('');
    $('emotes').onclick = (ev) => { const b = ev.target.closest('button'); if (b) this.startEmote(+b.dataset.e); };
  }

  onKey(code) {
    if (this.emoteMenu) {
      const n = code.startsWith('Digit') ? +code.slice(5) : 0;
      if (n >= 1 && n <= this.myEmotes.length) this.startEmote(this.myEmotes[n - 1].id);
      if (code === 'KeyG' || code === 'Escape') this.toggleEmoteMenu(false);
      return;
    }
    if (code === 'KeyM') { this.bigMap = !this.bigMap; $('bigmap').classList.toggle('hidden', !this.bigMap); }
    if (code === 'Tab') this.showScoreboard();
    if (this.dead) {
      if (code === 'Space') this.cycleSpectate();
      if ((code === 'Enter' || code === 'Escape') && $('result').classList.contains('hidden')) $('result').classList.remove('hidden');
      return;
    }
    // admins: ` opens the 👑 Admin menu mid-match (the mouse is locked to the game, so it can't be clicked)
    if (code === 'Backquote' && !document.getElementById('admin-menu').classList.contains('hidden')) {
      document.exitPointerLock?.();
      document.getElementById('admin-toggle').click();
      return;
    }
    if (code.startsWith('Digit')) this.digitSlot(+code.slice(5));
    if (this.veh.driving && ['KeyR', 'KeyQ', 'KeyG', 'KeyZ', 'KeyX', 'KeyC'].includes(code)) return; // hands on the wheel
    switch (code) {
      case 'Space':
        if (this.local.phase === 'blimp') this.net.send({ t: 'jump' });
        else if (this.local.phase === 'fall') { this.local.phase = 'glide'; this.net.send({ t: 'deploy' }); sfx.chute(); }
        break;
      case 'KeyE': this.interact(); break;
      case 'KeyR': this.reload(); break;
      case 'KeyQ': this.net.send({ t: 'drop' }); break;
      case 'KeyG': if (this.local.phase === 'ground') this.toggleEmoteMenu(true); break;
      case 'KeyZ': case 'KeyX': case 'KeyC':
        if (this.mode === 'build' && this.local.phase === 'ground') {
          const k = { KeyZ: 'wall', KeyX: 'floor', KeyC: 'ramp' }[code];
          this.buildKind = this.buildKind === k ? null : k;
        }
        break;
    }
  }

  // Number keys: 1-6 as always. Big (admin) backpacks: 7-9 and 0 (= 10) too, and pressing the
  // same digit again jumps ahead by ten (2 -> slot 12 -> slot 22 ...) so every slot is reachable.
  digitSlot(d) {
    const N = this.slotCount();
    const base = d === 0 ? 9 : d - 1;
    if (N <= 6) { if (d >= 1 && d <= 6) this.selectSlot(base); return; }
    if (base >= N) return;
    const cur = this.me.slot;
    let i = base;
    if (cur % 10 === base % 10 && cur >= base) { i = cur + 10; if (i >= N) i = base; }
    this.selectSlot(i);
  }

  selectSlot(i) {
    this.buildKind = null;
    if (i === this.me.slot) return;
    this.me.slot = i;
    this.reloadUntil = 0;
    this.net.send({ t: 'slot', i });
  }

  toggleEmoteMenu(on) {
    this.emoteMenu = on;
    $('emotes').classList.toggle('hidden', !on);
    if (on) document.exitPointerLock();
    else if (!this.touch?.active) this.renderer.domElement.requestPointerLock();
  }
  startEmote(id) {
    this.toggleEmoteMenu(false);
    this.emote = { id, start: nowS() };
  }

  reload() {
    const it = this.currentItem();
    if (!it || !it.w || !WEAPONS[it.w].mag || it.ammo >= WEAPONS[it.w].mag || this.reloadUntil > nowS()) return;
    this.reloadUntil = nowS() + WEAPONS[it.w].reload;
    this.reloadTotal = WEAPONS[it.w].reload;
    this.net.send({ t: 'reload' });
    sfx.reload();
  }

  interact() {
    const t = this.nearestInteract();
    if (!t) return;
    if (t.veh) { this.net.send({ t: 'veh', id: t.veh === 'exit' ? 0 : t.veh }); sfx.click(); }
    else if (t.chest != null) { this.net.send({ t: 'open', id: t.chest }); sfx.chest(); }
    else { this.net.send({ t: 'pickup', id: t.id }); sfx.pickup(); }
  }
  nearestInteract() {
    if (this.local.phase !== 'ground' || this.dead) return null;
    const L = this.local;
    const car = this.veh.nearest(L);
    if (this.veh.driving) return car;
    let best = null, bd = PICKUP_RANGE;
    for (const [id, c] of this.chests) {
      const d = Math.hypot(c.x - L.x, c.z - L.z);
      if (d < bd && Math.abs(c.y - L.y) < 2) { bd = d; best = { chest: id, label: 'Open Equipment Bag' }; }
    }
    for (const [id, l] of this.loot) {
      const d = Math.hypot(l.x - L.x, l.z - L.z);
      if (d < bd && Math.abs(l.y - L.y) < 2) {
        bd = d;
        const r = l.item.w ? RARITIES[l.item.r || 0] : null;
        const count = l.item.c && l.item.n > 1 ? ` x${l.item.n}` : '';
        best = { id, label: `Pick up <span style="color:${r ? r.color : '#fff'}">${r ? r.name + ' ' : ''}${itemName(l.item)}${count}</span>` };
      }
    }
    if (car && (!best || car.d + 0.6 < bd)) return car; // loot right beside you wins
    return best;
  }

  zoomFactor() { const it = this.currentItem(); return it && it.w === 'sniper' ? 0.3 : 0.7; }

  // ---------- network messages ----------
  start(msg) {
    this.blimp = msg.blimp;
    this.kind = msg.kind || this.kind;
    if (this.veh.kind !== this.kind) this.veh.reset(this.kind);
    for (const r of msg.roster) this.addRoster(r);
    for (const l of msg.loot) this.addLoot(l);
    for (const id of msg.chests) this.removeChest(id);
    for (const pc of msg.pieces || []) this.addPiece(pc);
    this.offset = msg.tm - nowS();
    if (this.blimp) {
      const b = this.blimp;
      this.yaw = Math.atan2(-b.dx, -b.dz);
      this.hud.centerMsg('🎈 Press <b>SPACE</b> to jump out of the Team Blimp!');
      this.hud.tip('blimp', this.tipText('The yellow dashed line on your map is the blimp\'s route. Press <kbd>SPACE</kbd> when you\'re over a spot you like to <b>jump out</b>!', 'The yellow dashed line on your map is the blimp\'s route. Tap <b>JUMP</b> when you\'re over a spot you like to <b>jump out</b>!'), 9000);
    } else {
      this.local.phase = 'ground';
      this.hud.centerMsg(this.kind === 'island' ? '🎉 Welcome to <b>PARTY ISLAND</b>! No fighting, just fun. Press <b>G</b> to dance!' : '');
      setTimeout(() => this.hud.centerMsg(''), 6000);
    }
    this.hud.toast(this.kind === 'partyRoyale' ? '🎉 PARTY ROYALE! Double loot everywhere!' : 'Match started! 🏈', 3500);
  }

  addRoster(r) {
    this.roster.set(r[0], { name: r[1], skin: r[2], bot: r[3], team: r[4] });
  }
  get myTeam() { return this.roster.get(this.myId)?.team; }

  addLoot(l) {
    const [id, x, y, z, item] = l;
    this.lootR.add(id, item, x, y, z);
    this.loot.set(id, { item, x, y, z });
  }
  removeLoot(id) { if (this.loot.has(id)) { this.lootR.remove(id); this.loot.delete(id); } }
  removeChest(id) { if (this.chests.has(id)) { this.chestR.remove(id); this.chests.delete(id); } }

  addPiece([id, kind, gx, gy, gz, r, hp]) {
    if (this.pieces.has(id)) return;
    const b = pieceBox(kind, gx, gy, gz, r, BUILD.grid, BUILD.thick);
    b.pid = id;
    this.world.add(b);
    const mesh = this.pieceMesh(kind, b);
    this.scene.add(mesh);
    this.pieces.set(id, { mesh, box: b, hp, max: BUILD.hp[kind] });
    sfx.build();
  }
  pieceMesh(kind, b, material = this.pieceMat) {
    const G = BUILD.grid;
    if (kind !== 'ramp') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]), material);
      m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      return m;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(G, BUILD.thick, G * Math.SQRT2), material);
    m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const { axis, sign } = b.ramp;
    if (axis === 2) m.rotation.x = sign > 0 ? Math.PI / 4 : -Math.PI / 4;
    else { m.rotation.y = Math.PI / 2; m.rotation.x = sign > 0 ? -Math.PI / 4 : Math.PI / 4; }
    return m;
  }
  removePiece(id) {
    const p = this.pieces.get(id);
    if (!p) return;
    this.world.remove(p.box.id);
    this.scene.remove(p.mesh); p.mesh.geometry.dispose();
    this.pieces.delete(id);
    this.burst(p.mesh.position, ['#3c9a3c', '#ffffff'], 18);
  }

  onSnapshot(m) {
    const est = m.tm - nowS();
    this.offset = this.offset == null ? est : Math.max(est, this.offset - 0.002);
    // players arrive delta-encoded and only when they changed / are due (see shared/netcodec.js)
    if (m.pg) for (const id of m.pg) this.removeEnt(id);
    for (const s of this.decodePs(m)) {
      const id = s.id;
      if (id === this.myId) continue;
      let e = this.ents.get(id);
      if (!e) { e = { id, buf: [], model: null, lod: null, em: 0, emStart: 0, swing: 0, every: s.every, delay: extraDelay(s.every, TICK_RATE) }; this.ents.set(id, e); }
      const b = e.buf, last = b[b.length - 1], gap = s.every / TICK_RATE;
      // nothing was sent while the player stood still: hold the old state until the previous slot
      if (last && m.tm - last.t > gap * 1.5) b.push({ ...last, t: m.tm - gap });
      s.t = m.tm;
      b.push(s);
      e.every = s.every;
      while (b.length > 30) b.shift();
    }
    for (const ev of m.ev) this.onEvent(ev);
    if (m.vh) this.veh.onSnapshot(m.vh, m.tm);
    if (m.zn) {
      const z = m.zn;
      this.zone = { cx: z[0], cz: z[1], r: z[2], tx: z[3], tz: z[4], tr: z[5], st: z[6], end: z[7], ph: z[8], t0: z[9] };
      if (!this.zoneDisp) this.zoneDisp = { ...this.zone };
    }
    if (m.al != null) { this.alive = m.al; this.checkAliveCallouts(); }
    if (m.me) this.applyMe(m.me);
    if (m.pe) for (const e of m.pe) this.onPersonal(e);
  }

  applyMe(me) {
    const prevPh = this.me.ph, prev = this.me;
    const lost = (prev.hp + prev.pad) - (me.hp + me.pad);
    if (lost > 0 && prev.ph !== 'blimp') this.pendingDmg += lost;
    this.me = me;
    // low-health warning
    this.hud.lowHealth(me.hp > 0 && me.hp <= 30 && me.ph !== 'dead' ? 1 - me.hp / 30 : 0);
    // coach tips that depend on what I'm carrying
    if (me.ph === 'ground' && this.frame > 0) {
      if (me.inv.some((it) => it && it.w)) this.hud.tip('shoot', this.tipText('<b>Left click</b> to shoot, <b>right click</b> to aim. <kbd>R</kbd> reloads, <kbd>1</kbd>-<kbd>6</kbd> or the mouse wheel switches items.', 'Hold <b>FIRE</b> to shoot, tap <b>AIM</b> to zoom. <b>RELOAD</b> reloads, tap the item slots at the bottom to switch.'), 8000);
      if (me.inv.some((it) => it && it.c)) this.hud.tip('heal', this.tipText('Pick a healing item and <b>left click</b> to use it. Padding 🛡️ gives you an extra blue shield bar.', 'Tap a healing item, then hold <b>FIRE</b> to use it. Padding 🛡️ gives you an extra blue shield bar.'), 7000);
    }
    if (me.ph === 'blimp') { this.local.phase = 'blimp'; this.local.x = me.x; this.local.y = me.y; this.local.z = me.z; }
    if (prevPh !== 'ground' && me.ph === 'ground' && this.local.phase !== 'ground') this.local.phase = 'ground';
    if (me.rl && !this.reloadUntil) { this.reloadUntil = nowS() + me.rl; this.reloadTotal = me.rl; }
  }

  onEvent(ev) {
    const type = ev[0];
    switch (type) {
      case 'l+': this.addLoot(ev.slice(1)); break;
      case 'l-': this.removeLoot(ev[1]); break;
      case 'co': this.removeChest(ev[1]); break;
      case 'pc': this.addPiece(ev.slice(1)); break;
      case 'pd': this.removePiece(ev[1]); break;
      case 'ph': { const p = this.pieces.get(ev[1]); if (p) p.hp = ev[2]; break; }
      case 'ro': this.addRoster(ev.slice(1)); break;
      case 'vb': this.veh.onBroken(ev[1]); break;
      case 'rm': this.roster.delete(ev[1]); break;
      case 'jmp': break;
      case 'sw': { const e = this.ents.get(ev[1]); if (e) e.swing = 1; break; }
      case 'sh': {
        const [, id, code, ox, oy, oz, ...ends] = ev;
        const wid = WCODES[code >> 3];
        const dist = Math.hypot(ox - this.local.x, oz - this.local.z);
        if (id !== this.myId) {
          for (let i = 0; i < ends.length; i += 3) this.tracer(new THREE.Vector3(ox, oy - 0.25, oz), new THREE.Vector3(ends[i], ends[i + 1], ends[i + 2]), wid);
          if (dist < 250) sfx.gun(wid, clamp(1 - dist / 250, 0.05, 1) * 0.8);
          if (!this.dead && this.local.phase === 'ground' && dist < 120) {
            // near miss: a bullet zipped right past my head
            const L = this.local, ey = L.y + PLAYER.eye;
            for (let i = 0; i < ends.length; i += 3) {
              const dx = ends[i] - ox, dy = ends[i + 1] - oy, dz = ends[i + 2] - oz, len2 = dx * dx + dy * dy + dz * dz || 1;
              const k = clamp(((L.x - ox) * dx + (ey - oy) * dy + (L.z - oz) * dz) / len2, 0, 1);
              if (Math.hypot(ox + dx * k - L.x, oy + dy * k - ey, oz + dz * k - L.z) < 1.6) { this.addShake(0.18); break; }
            }
          }
        }
        break;
      }
      case 'pr': {
        const [, id, kind, x, y, z, vx, vy, vz, owner] = ev;
        const mesh = kind === 'pigskin' ? createFootball(0.45) : kind === 'whistle' ? new THREE.Mesh(WHISTLE_GEO, mat('#e0e0e0')) : createConsumable('tape');
        mesh.position.set(x, y, z);
        this.scene.add(mesh);
        this.projs.set(id, { mesh, x, y, z, vx, vy, vz, grav: WEAPONS[kind].grav, kind });
        if (owner !== this.myId) sfx.gun(kind, clamp(1 - Math.hypot(x - this.local.x, z - this.local.z) / 150, 0.05, 1));
        break;
      }
      case 'bm': {
        const [, id, x, y, z] = ev;
        const p = this.projs.get(id);
        if (p) { this.scene.remove(p.mesh); this.projs.delete(id); }
        this.explosion(new THREE.Vector3(x, y, z));
        const bd = Math.hypot(x - this.local.x, y - this.local.y, z - this.local.z);
        sfx.boom(clamp(1 - bd / 200, 0.05, 1));
        if (bd < 40) this.addShake(clamp(1.1 - bd / 40, 0.15, 1));
        break;
      }
      case 'kf': {
        const [, kid, vid, wid, head] = ev;
        const killer = this.roster.get(kid), victim = this.roster.get(vid);
        if (!victim) break;
        if (kid) this.kills.set(kid, (this.kills.get(kid) || 0) + 1);
        const e = this.ents.get(vid);
        if (e && e.s) this.burst(new THREE.Vector3(e.s.x, e.s.y + 1.2, e.s.z), ['#ff5a2a', '#ffcc33', '#3fa2ff', '#4fd16b', '#ff7bf2'], 40);
        const mine = kid === this.myId || vid === this.myId;
        let html;
        if (wid === 'storm') html = `<b>${esc(victim.name)}</b> got caught in the Overtime Storm 🌀`;
        else if (wid === 'quit') html = `<b>${esc(victim.name)}</b> left the game`;
        else html = `<b>${esc(killer ? killer.name : '?')}</b> ${head ? '🎯' : wid === 'vehicle' ? '🚙' : '🏈'} <small>${WEAPONS[wid] ? WEAPONS[wid].name : wid === 'vehicle' ? 'Tailgate Tackle' : ''}</small> <b>${esc(victim.name)}</b>`;
        this.hud.killfeed(html, mine);
        if (kid === this.myId && vid !== this.myId) this.onMyElim(victim, head);
        if (this.spectateId === vid && this.dead) setTimeout(() => this.cycleSpectate(), 1500);
        break;
      }
      case 'win': {
        const [, wid, names, team] = ev;
        this.ended = true;
        if (team === this.myTeam || wid === this.myId) this.victory(names);
        else {
          this.hud.centerMsg(`🏆 <b>${esc(names)}</b> won the match!`);
          $('res-kicker').textContent = `🏆 ${names} won the match`;
          if (this.dead) setTimeout(() => this.running && $('result').classList.remove('hidden'), 2500);
          $('res-spectate').classList.add('hidden');
        }
        break;
      }
    }
  }

  onPersonal(e) {
    switch (e[0]) {
      case 'corr':
        this.local.x = e[1]; this.local.y = e[2]; this.local.z = e[3];
        this.local.vx = this.local.vy = this.local.vz = 0;
        if (e[4] === 'fall') {
          this.local.phase = 'fall'; this.hud.centerMsg('');
          if (!this.hud.tip('chute', this.tipText('You\'re skydiving! Steer with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>. Press <kbd>SPACE</kbd> to <b>open your parachute</b> early (it opens by itself near the ground).', 'You\'re skydiving! Steer with the <b>joystick</b>. Tap <b>JUMP</b> to <b>open your parachute</b> early (it opens by itself near the ground).'), 8000)) this.hud.toast(this.tipText('Press SPACE to open your parachute early', 'Tap JUMP to open your parachute early'), 3000);
        }
        break;
      case 'hit': {
        const [, dmg, head, x, y, z, kill] = e;
        this.hud.hitmarker(kill, head);
        sfx.hit(head);
        this.result.dmg += dmg || 0;
        const v = new THREE.Vector3(x, y, z).project(this.camera);
        if (v.z < 1) this.hud.damageNumber((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, dmg, head);
        break;
      }
      case 'hurt': {
        const ang = Math.atan2(e[1] - this.local.x, e[2] - this.local.z);
        // angle relative to view (0 = in front)
        this.hud.hurtFrom(-(ang - Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw))));
        const hit = this.pendingDmg || 10;
        this.hud.flash('hurt', 0.35 + hit / 45);
        this.addShake(clamp(hit / 60, 0.12, 0.5));
        this.pendingDmg = 0;
        sfx.hurt();
        this.emote = null;
        break;
      }
      case 'storm': this.hud.flash('storm', 0.7); sfx.storm(); this.pendingDmg = 0; break;
      case 'kb': if (this.veh.driving) break; this.local.vx += e[1]; this.local.vy = Math.max(this.local.vy, e[2]); this.local.vz += e[3]; this.local.onGround = false; break;
      case 'msg': this.hud.toast(e[1]); break;
      case 'veh': this.veh.onEnterExit(e); break;
      case 'vc': this.veh.correct(e); break;
      case 'mats': break;
      case 'use': this.useTotal = e[1]; break;
      case 'dead': {
        this.dead = true;
        this.spectateId = e[2] || 0;
        if (this.spectateId) this.net.send({ t: 'spec', id: this.spectateId });
        const killer = this.roster.get(e[2]);
        document.exitPointerLock();
        this.hud.lowHealth(0); this.hud.clearTips(true);
        this.result.place = e[1];
        sfx.lose();
        this.addShake(0.6);
        const sub = killer && e[2] !== this.myId ? `Tackled by <b>${esc(killer.name)}</b>` : 'The storm got you this time';
        // a short beat to see what happened, then the results
        setTimeout(() => { if (this.running && !this.result.win) this.showResult(false, sub); }, 1300);
        this.saveStats(false);
        break;
      }
    }
  }

  victory(names) {
    if (this.result.win) return;
    document.exitPointerLock();
    $('result').classList.add('hidden');
    this.result.win = true; this.result.place = 1;
    this.ended = true; $('pause').classList.add('hidden');
    this.hud.lowHealth(0); this.hud.clearTips(true); this.hud.clearCallouts();
    this.hud.prompt(''); this.hud.centerMsg('');
    // slow-motion victory cam: orbit around me while I celebrate
    const t = nowS();
    this.slowMoUntil = t + 2.6;
    if (!this.dead) { this.victoryCam = { start: t, yaw: this.yaw }; this.emote = { id: 3, start: t }; }
    this.hud.callout('🏆 VICTORY! 🏆', 'LAST TEAM STANDING', 'win');
    sfx.win();
    this.confetti(9000);
    for (let i = 0; i < 8; i++) setTimeout(() => this.running && this.burst(new THREE.Vector3(this.local.x + (Math.random() - 0.5) * 10, this.local.y + 4 + Math.random() * 3, this.local.z + (Math.random() - 0.5) * 10), ['#ff5a2a', '#ffcc33', '#3fa2ff', '#4fd16b', '#ff7bf2'], 60), i * 280);
    const sub = names.includes('&') ? `${esc(names)}: champions together!` : 'You\'re the last one standing!';
    setTimeout(() => { if (this.running) this.showResult(true, sub); }, 2600);
    this.saveStats(true);
  }

  // ---------- end-of-match results ----------
  showResult(win, sub) {
    const r = this.result;
    $('result').className = win ? 'win' : 'out';
    $('pause').classList.add('hidden');
    if (win) $('res-kicker').textContent = 'FOOTBALL ROYALE CHAMPION';
    else if (!this.ended) $('res-kicker').textContent = `${this.alive} player${this.alive === 1 ? '' : 's'} still in the match`;
    $('res-head').textContent = win ? '#1 VICTORY!' : r.place && r.place <= 10 ? `TOP ${r.place <= 5 ? 5 : 10}! NICE RUN!` : 'FUMBLED!';
    $('res-sub').innerHTML = sub || '';
    $('res-spectate').classList.toggle('hidden', win || this.ended);
    $('res-again-sub').textContent = `straight into ${this.mode === 'build' ? 'Build' : 'No-Build'} Quick Play`;
    $('res-msg').textContent = '';
    this.renderResult();
    if (r.place && r.place <= 10 && !win) this.confetti(1500);
  }
  renderResult() {
    const r = this.result;
    $('res-place').textContent = r.place ? `#${r.place}` : '#–';
    $('res-elims').textContent = this.me.k;
    $('res-dmg').textContent = Math.round(r.dmg).toLocaleString();
    $('res-bucks').textContent = `+${r.bucks}`;
  }
  onReward(m) { this.result.bucks += m.bucks || 0; if (!$('result').classList.contains('hidden')) this.renderResult(); }
  shareInfo() {
    const r = this.result;
    return { place: r.place, win: r.win, elims: this.me.k, dmg: Math.round(r.dmg), mode: this.mode };
  }

  // ---------- callouts & feel ----------
  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }
  onMyElim(victim, head) {
    sfx.elim();
    this.hud.toast(`${head ? '🎯 ' : ''}You eliminated ${victim.name}!`);
    const t = nowS();
    this.myKillTimes = this.myKillTimes.filter((k) => t - k < 8);
    this.myKillTimes.push(t);
    this.myElims = (this.myElims || 0) + 1;
    const n = this.myKillTimes.length, total = this.myElims;
    const STREAK = { 2: 'DOUBLE TACKLE!', 3: 'TRIPLE TACKLE!', 4: 'QUAD SQUAD SMASH!' };
    const TOTAL = { 3: ['ON A HOT STREAK! 🔥', '3 eliminations'], 5: ['UNSTOPPABLE RUNNER!', '5 eliminations'], 10: ['ALL-STAR LEGEND! ⭐', '10 eliminations'], 15: ['HALL OF FAMER! 👑', '15 eliminations'] };
    if (n >= 2) { this.hud.callout(STREAK[n] || 'TOUCHDOWN FRENZY!', `${n} in a row`, 'streak'); sfx.streak(n); }
    else if (TOTAL[total]) { this.hud.callout(TOTAL[total][0], TOTAL[total][1], 'streak'); sfx.streak(3); }
  }
  checkAliveCallouts() {
    const prev = this.lastAlive, now = this.alive;
    this.lastAlive = now;
    if (prev == null || now >= prev || this.dead || this.ended || this.kind === 'island') return;
    const M = [[50, '50 PLAYERS LEFT'], [25, '25 PLAYERS LEFT'], [10, 'TOP 10!', 'only 10 players left'], [5, 'FINAL 5!', 'stay sharp'], [2, 'LAST TWO STANDING!', 'win this and it\'s yours']];
    for (const [m, text, sub] of M) if (prev > m && now <= m) { this.hud.callout(text, sub || '', m <= 5 ? 'hot' : ''); sfx.callout(); break; }
  }
  checkStorm(st) {
    const z = this.zone;
    if (!z || z.r >= 3000 || this.kind === 'island') return;
    if (!this.zoneSeen) {
      this.zoneSeen = true;
      if (this.local.phase === 'ground') this.hud.tip('storm', this.tipText('🌀 The <b>Overtime Storm</b> shrinks the field and hurts if you\'re outside it. Stay inside the <b>white circle</b> on your map (<kbd>M</kbd> for the big map).', '🌀 The <b>Overtime Storm</b> shrinks the field and hurts if you\'re outside it. Stay inside the <b>white circle</b> on your map (tap 🗺️ for the big map).'), 9000);
      else this.zoneSeen = false; // wait until I've landed
    }
    const key = `${z.ph}:${z.st}`;
    const left = z.end - st;
    if (st >= z.t0 && z.st === 0 && left <= 10 && left > 0 && this.stormWarned !== `${z.ph}:warn`) {
      this.stormWarned = `${z.ph}:warn`;
      if (!this.dead) { this.hud.toast('🌀 The storm moves in 10 seconds! Get inside the white circle.', 3500); sfx.beep(); setTimeout(() => this.running && sfx.beep(), 250); }
    }
    if (z.st === 1 && this.stormWarned !== key) {
      this.stormWarned = key;
      if (!this.dead) { this.hud.callout('⚠️ THE STORM IS CLOSING IN!', 'move to the safe zone', 'storm'); sfx.siren(); }
    }
  }

  saveStats(win) {
    if (this.statsSaved && !win) return;
    try {
      const s = JSON.parse(localStorage.getItem('fr_stats') || '{}');
      if (!this.statsSaved) { s.matches = (s.matches || 0) + 1; s.kills = (s.kills || 0) + this.me.k; }
      if (win && !this.savedWin) { s.wins = (s.wins || 0) + 1; this.savedWin = true; }
      localStorage.setItem('fr_stats', JSON.stringify(s));
    } catch { /* storage blocked */ }
    this.statsSaved = true;
  }

  onEnd() { this.ended = true; }

  cycleSpectate() {
    const ids = [...this.ents.keys()];
    if (!ids.length) return;
    const i = ids.indexOf(this.spectateId);
    this.spectateId = ids[(i + 1) % ids.length];
    this.net.send({ t: 'spec', id: this.spectateId });   // server sends players near them more often
  }

  showScoreboard() {
    const rows = [...this.kills.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([id, k]) => `<tr><td>${esc(this.roster.get(id)?.name || '?')}${id === this.myId ? ' (you)' : ''}</td><td>${k}</td></tr>`).join('');
    const mates = [...this.roster.entries()].filter(([id, r]) => r.team === this.myTeam && id !== this.myId).map(([, r]) => esc(r.name));
    $('scoreboard').innerHTML = `<h3>Players left: ${this.alive}</h3>${mates.length ? `<p>Your squad: ${mates.join(', ')}</p>` : ''}<table><tr><th align=left>Top eliminations</th><th></th></tr>${rows || '<tr><td>No eliminations yet</td><td></td></tr>'}</table>`;
    $('scoreboard').classList.remove('hidden');
  }

  // ---------- effects ----------
  tracer(a, b, wid) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: wid === 'sniper' ? 0xffffff : 0xffe28a, transparent: true, opacity: 0.9 }));
    this.scene.add(l);
    this.fx.push({ life: 0.09, max: 0.09, obj: l, update(k) { l.material.opacity = k; } });
  }
  explosion(p) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true }));
    s.position.copy(p); this.scene.add(s);
    this.fx.push({ life: 0.5, max: 0.5, obj: s, update(k) { s.scale.setScalar(1 + (1 - k) * 6); s.material.opacity = k; } });
    this.burst(p, ['#ff5a2a', '#ffcc33', '#ffffff', '#8b4513'], 30);
  }
  burst(p, colors, n) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), vel = [], col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      vel.push([(Math.random() - 0.5) * 10, Math.random() * 9 + 2, (Math.random() - 0.5) * 10]);
      c.set(colors[i % colors.length]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.25, vertexColors: true, transparent: true }));
    this.scene.add(pts);
    this.fx.push({
      life: 1.6, max: 1.6, obj: pts,
      update(k, dt) {
        for (let i = 0; i < n; i++) {
          vel[i][1] -= 12 * dt;
          pos[i * 3] += vel[i][0] * dt; pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + vel[i][1] * dt); pos[i * 3 + 2] += vel[i][2] * dt;
        }
        geo.attributes.position.needsUpdate = true;
        pts.material.opacity = Math.min(1, k * 2);
      },
    });
  }

  // ---------- entities ----------
  removeEnt(id) {
    const e = this.ents.get(id);
    if (!e) return;
    this.players.release(e);
    if (e.tag) { this.scene.remove(e.tag); e.tag.material.map.dispose(); e.tag.material.dispose(); }
    this.ents.delete(id);
  }
  // Skin and name tag; the 3D model itself is created on demand by players.js
  ensureModels(e) {
    const r = this.roster.get(e.id);
    e.skin = r ? r.skin : this.mySkin;
    const showTag = this.kind === 'island' || (r && r.team === this.myTeam);
    if (showTag && r && !e.tag) { e.tag = nameTag(r.name, r.team === this.myTeam ? '#3fa2ff' : '#ffffff'); this.scene.add(e.tag); }
  }
  // test hook (tools/rendermeter.js): throw away and rebuild one player's model
  debugRecreate(e) { this.players.release(e); }
  // Interpolated state of entity e at render time t (far players are drawn e.delay further back,
  // matching the server's lag compensation for them).
  sample(e, t) {
    t -= e.delay || 0;
    const b = e.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const a = b[i - 1], c = b[i];
        if (t >= c.t) return c;
        const k = (t - a.t) / (c.t - a.t);
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: lerpAngle(a.yaw, c.yaw, k), pitch: a.pitch + (c.pitch - a.pitch) * k, ph: c.ph, w: c.w, em: c.em, fl: c.fl };
      }
    }
    return b[b.length - 1];
  }

  // ---------- main loop ----------
  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const t = nowS();
    const dt = Math.min(0.05, t - this.lastFrame);
    this.lastFrame = t;
    this.frame++;
    // visual delta: slows down during the victory slow-motion moment
    const vdt = t < this.slowMoUntil ? dt * (0.25 + 0.75 * clamp(1 - (this.slowMoUntil - t) / 2.6, 0, 1) ** 2) : dt;
    this.feelTick(t, dt);
    const st = this.serverNow();
    const renderT = st - 0.1;
    const L = this.local;
    const locked = document.pointerLockElement === this.renderer.domElement || !!this.touch?.active;

    // --- local movement ---
    if (!this.dead) {
      const input = { f: 0, s: 0, yaw: this.yaw, pitch: this.pitch, jump: false, sprint: false };
      if (locked) {
        input.f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
        input.s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
        input.jump = this.keys.has('Space');
        input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      }
      if (this.touch) this.touch.applyInput(input);
      if (this.emote && (input.f || input.s || input.jump || this.veh.driving)) this.emote = null;
      this.driveInput = input;
      if (L.phase === 'ground' && this.veh.driving) this.veh.drive(input, dt);
      else if (L.phase === 'ground') {
        let left = dt;
        while (left > 0) { const h = Math.min(left, 1 / 60); stepPlayer(this.world, L, input, h); left -= h; }
      } else if (L.phase === 'fall' || L.phase === 'glide') {
        const wasGlide = L.phase === 'glide';
        if (stepFalling(this.world, L, input, dt)) { this.hud.centerMsg(''); this.onLanded(); }
        else if (!wasGlide && L.phase === 'glide') sfx.chute();
      } else if (L.phase === 'blimp' && this.blimp) {
        const b = this.blimp, d = Math.min(b.len, (st - b.t0) * DROP.speed);
        L.x = b.x0 + b.dx * d; L.y = DROP.height; L.z = b.z0 + b.dz * d;
      }
      if (t - this.lastSend > 1 / TICK_RATE) {
        this.lastSend = t;
        this.net.send({ t: 'in', x: +L.x.toFixed(2), y: +L.y.toFixed(2), z: +L.z.toFixed(2), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), em: this.emote ? this.emote.id : 0, ph: L.phase, ...this.veh.inFields() });
      }
    }

    if (this.touch) this.touch.update(dt, renderT);
    // --- aiming, shooting, building ---
    const it = this.currentItem();
    const wantAds = this.mouse.right && locked && it && it.w && it.w !== 'tackle' && it.w !== 'whistle' && !this.buildKind && L.phase === 'ground';
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    if (locked && !this.dead && L.phase === 'ground' && !this.emoteMenu && !this.veh.driving) {
      if (this.buildKind) this.updateBuild(t);
      else if (this.mouse.left) this.tryFire(t, renderT);
    }
    this.ghost.visible = !!this.buildKind && L.phase === 'ground' && !this.dead;
    this.mouse.leftEdge = false;
    if (this.reloadUntil && t >= this.reloadUntil) this.reloadUntil = 0;
    this.recoil *= Math.pow(0.0001, dt);
    this.swing = Math.max(0, this.swing - dt * 4);

    // --- other players: interpolate (drawn after the camera moved, see below) ---
    for (const e of this.ents.values()) {
      // far players arrive less often and are drawn a little further back in time (glide between bands)
      const target = extraDelay(e.every || 1, TICK_RATE);
      e.delay = (e.delay ?? target) + clamp(target - (e.delay ?? target), -dt * 0.3, dt * 0.3);
      e.s = this.sample(e, renderT);
      if (!e.skin) this.ensureModels(e);
      // footsteps of nearby players (game feel)
      if (e.s && e.s.ph === 0 && !this.dead) {
        const dist = Math.hypot(e.s.x - L.x, e.s.z - L.z);
        const prev = e.lastStep || e.s;
        const spd = Math.hypot(e.s.x - prev.x, e.s.z - prev.z) / Math.max(dt, 0.001);
        e.lastStep = { x: e.s.x, z: e.s.z };
        if (dist < 38 && spd > 2) this.footstep(e, e.s, dist, spd, dt);
      }
    }

    this.veh.update(dt, renderT, this.dead ? null : this.driveInput);

    // --- projectiles ---
    for (const p of this.projs.values()) {
      p.vy -= p.grav * vdt;
      p.x += p.vx * vdt; p.y += p.vy * vdt; p.z += p.vz * vdt;
      if (p.y < 0.1) { p.y = 0.1; p.vy = Math.abs(p.vy) * 0.4; p.vx *= 0.6; p.vz *= 0.6; }
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.kind === 'pigskin') { p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz); p.mesh.rotateZ(t * 20); }
    }

    // --- effects ---
    this.fx = this.fx.filter((f) => {
      f.life -= vdt;
      if (f.life <= 0) { this.scene.remove(f.obj); f.obj.geometry?.dispose(); f.obj.material?.dispose(); return false; }
      f.update(f.life / f.max, vdt);
      return true;
    });

    // --- loot & equipment bags (instanced, only the nearby ones) ---
    const Q = getSettings();
    this.lootR.update(dt, L.x, L.z, Q.lootDist);
    if (this.frame % 3 === 0) this.chestR.update(L.x, L.z, Q.chestDist);

    // --- storm ---
    if (this.zone) {
      const z = this.zone, d = this.zoneDisp;
      const k = Math.min(1, dt * 6);
      d.cx += (z.cx - d.cx) * k; d.cz += (z.cz - d.cz) * k; d.r += (z.r - d.r) * k;
      Object.assign(d, { tx: z.tx, tz: z.tz, tr: z.tr, st: z.st });
      this.storm.visible = d.r < ZONE_START_RADIUS - 5; // hidden until the storm starts closing in
      this.storm.position.set(d.cx, 150, d.cz);
      this.storm.scale.set(Math.max(0.1, d.r), 1, Math.max(0.1, d.r));
      this.stormTex.offset.x = t * 0.02;
    }

    // --- camera ---
    this.updateCamera(t, vdt, renderT);

    // --- other players: level of detail, culling, animation (players.js) ---
    const cp = this.camera.position;
    for (const e of this.ents.values()) {
      if (!e.s) continue;
      e.dist = Math.hypot(e.s.x - cp.x, e.s.z - cp.z);
      if (e.tag) { e.tag.position.set(e.s.x, e.s.y + 2.5, e.s.z); e.tag.visible = e.dist < Q.tagDist && e.s.ph !== 4; if (e.inVehicle) e.tag.position.y += 0.4; }
    }
    this.players.update(this.ents, this.camera, Q, t, dt, this.dead ? this.spectateId : 0);
    frameTick(dt);

    // --- HUD ---
    if (this.frame % 4 === 0) this.updateHud(st, t);

    // --- render ---
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    const showVm = !this.dead && L.phase === 'ground' && !this.emote && !this.veh.driving && !(this.ads > 0.6 && it && it.w === 'sniper');
    if (showVm) {
      this.updateViewmodelItem();
      const bob = Math.hypot(L.vx, L.vz) > 1 && L.onGround ? Math.sin(t * 11) * 0.012 : 0;
      const a = this.ads;
      this.vm.position.set(0.22 * (1 - a) + 0.0 * a - 0.03 * a, -0.22 * (1 - a) - 0.13 * a + bob, -0.38 + this.recoil * 0.3 + (this.swing > 0 ? -this.swing * 0.3 : 0));
      this.vm.rotation.set(this.recoil * 0.8 + (this.swing > 0 ? this.swing * 0.6 : 0), 0, 0);
      this.vmArmL.visible = !(it && it.w && it.w !== 'tackle') || a < 0.5;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCam);
    }
  }

  updateCamera(t, dt, renderT) {
    const L = this.local, cam = this.camera;
    const it = this.currentItem();
    const base = this.baseFov();
    const fov = base - this.ads * (base - base * (it && it.w === 'sniper' ? 0.25 : 0.72));
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    $('scope').classList.toggle('hidden', !(this.ads > 0.6 && it && it.w === 'sniper'));
    $('crosshair').style.setProperty('--g', `${4 + this.spreadNow() * 260}px`);
    $('crosshair').style.visibility = this.veh.driving ? 'hidden' : '';
    this.blimpMesh.visible = !!this.blimp && this.serverNow() - this.blimp.t0 < this.blimp.len / DROP.speed + 8;
    if (this.blimpMesh.visible) {
      const b = this.blimp, d = (this.serverNow() - b.t0) * DROP.speed;
      this.blimpMesh.position.set(b.x0 + b.dx * d, DROP.height + 14, b.z0 + b.dz * d);
      this.blimpMesh.rotation.y = Math.atan2(b.dx, b.dz);
    }
    let thirdTarget = null, dist = 4.5;
    if (this.dead) {
      const e = this.ents.get(this.spectateId);
      const s = e && this.sample(e, renderT);
      if (s) thirdTarget = new THREE.Vector3(s.x, s.y + 1.6, s.z);
      else if (this.frame % 60 === 0) this.cycleSpectate();
    } else if (this.victoryCam) {
      // slow orbit around the champion
      thirdTarget = new THREE.Vector3(L.x, L.y + 1.2, L.z); dist = 4.2;
      this.yaw = this.victoryCam.yaw + Math.PI + (t - this.victoryCam.start) * 0.35; this.pitch = -0.12;
      if (!this.emote) this.emote = { id: 3, start: t };
    } else if (L.phase === 'blimp') {
      thirdTarget = this.blimpMesh.position.clone(); dist = 70;
    } else if (this.veh.driving) {
      // chase camera behind my vehicle
      thirdTarget = new THREE.Vector3(L.x, L.y + 2.2, L.z);
      dist = this.veh.driving.type === 'truck' ? 8 : 6.5;
    } else if (this.emote || L.phase === 'fall' || L.phase === 'glide') {
      thirdTarget = new THREE.Vector3(L.x, L.y + 1.6, L.z);
      dist = L.phase === 'glide' ? 8 : 5;
    }
    const showMe = !this.dead && L.phase !== 'blimp' && !!thirdTarget && !this.veh.driving;
    this.myModel.visible = showMe;
    if (showMe) {
      this.myModel.position.set(L.x, L.y, L.z);
      this.myModel.rotation.y = this.victoryCam ? this.victoryCam.yaw : this.yaw;
      const ph = { ground: 0, fall: 2, glide: 3 }[L.phase] ?? 0;
      animatePlayer(this.myModel, { speed: Math.hypot(L.vx, L.vz), phase: ph, emote: this.emote?.id || 0, emoteT: this.emote ? t - this.emote.start : 0, pitch: 0, t }, dt);
      if (this.emote) {
        const E = EMOTES.find((e) => e.id === this.emote.id);
        if (E && !E.loop && t - this.emote.start > E.dur) this.emote = null;
      }
    }
    if (thirdTarget) {
      const d = dirFrom(this.yaw, this.pitch);
      let back = dist;
      if (L.phase !== 'blimp') {
        const hit = raycastWorld(this.world, thirdTarget.x, thirdTarget.y, thirdTarget.z, -d[0], -d[1], -d[2], dist);
        if (hit) back = Math.max(0.5, hit.t - 0.3);
      }
      cam.position.set(thirdTarget.x - d[0] * back, Math.max(0.3, thirdTarget.y - d[1] * back), thirdTarget.z - d[2] * back);
      cam.lookAt(thirdTarget);
    } else {
      cam.position.set(L.x, L.y + PLAYER.eye, L.z);
      cam.rotation.set(this.pitch + this.recoil * 0.4, this.yaw, 0, 'YXZ');
    }
    // screen shake (explosions, hits, landing); stays subtle so nobody gets dizzy
    if (this.shake > 0.01) {
      const k = this.shake * this.shake, ph = t * 47;
      cam.rotation.x += (Math.sin(ph) * 0.6 + Math.sin(ph * 2.3) * 0.4) * 0.022 * k;
      cam.rotation.y += (Math.cos(ph * 1.3) * 0.6 + Math.sin(ph * 3.1) * 0.4) * 0.018 * k;
      cam.rotation.z += Math.sin(ph * 0.7) * 0.012 * k;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    } else this.shake = 0;
  }

  baseFov() { return clamp(+this.settings.fov || 75, 60, 100); }

  // ---------- small per-frame game-feel things ----------
  feelTick(t, dt) {
    // low-health heartbeat
    const hp = this.me.hp;
    if (!this.dead && !this.ended && hp > 0 && hp <= 30 && this.me.ph === 'ground' && t > this.nextHeart) {
      sfx.heartbeat();
      this.nextHeart = t + 0.6 + (hp / 30) * 0.5;
    }
    // my own footsteps (quiet)
    const L = this.local;
    if (!this.dead && L.phase === 'ground' && L.onGround && !this.victoryCam) {
      const sp = Math.hypot(L.vx, L.vz);
      if (sp > 2) { this.myStep = (this.myStep || 0) + dt * sp / 2.4; if (this.myStep >= 1) { this.myStep -= 1; sfx.step(0.22, 0); } }
    }
    // FPS counter
    if (this.settings.showFps) {
      const a = this.fpsAcc; a.n++; a.t = a.t || t;
      if (t - a.t >= 0.5) { this.hud.fps(`${Math.round(a.n / (t - a.t))} FPS`); a.n = 0; a.t = t; }
    } else if (!$('fps').classList.contains('hidden')) this.hud.fps(null);
  }
  // coach tips speak touch on phones/tablets
  tipText(desktop, touch) { return this.touch?.active || document.documentElement.classList.contains('touch-on') ? touch : desktop; }
  footstep(e, s, dist, spd, dt) {
    e.step = (e.step || 0) + dt * Math.min(spd, 10) / 2.4;
    if (e.step < 1) return;
    e.step -= 1;
    const L = this.local, dx = (s.x - L.x) / (dist || 1), dz = (s.z - L.z) / (dist || 1);
    const pan = dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw); // dot with my right vector
    const v = (1 - dist / 38) ** 2;
    if (v > 0.02) sfx.step(0.9 * v, pan * 0.8);
  }
  onLanded() {
    sfx.land();
    this.addShake(0.4);
    this.hud.tip('loot', this.tipText('Gear glows on the ground. Walk up to it and press <kbd>E</kbd> to <b>pick it up</b>. Golden Equipment Bags hold the best stuff!', 'Gear glows on the ground. Walk up to it and tap <b>USE</b> to <b>pick it up</b>. Golden Equipment Bags hold the best stuff!'), 8000);
    if (this.mode === 'build') this.hud.tip('build', this.tipText('BUILD MODE: <kbd>Z</kbd> wall · <kbd>X</kbd> floor · <kbd>C</kbd> ramp, then <b>left click</b> to place. Tackle trees, cars and walls (slot <kbd>1</kbd>) to collect Turf 🟩.', 'BUILD MODE: tap <b>WALL</b>, <b>FLOOR</b> or <b>RAMP</b>, then <b>FIRE</b> to place. Tackle trees, cars and walls (slot 1) to collect Turf 🟩.'), 9000);
  }

  spreadNow() {
    const it = this.currentItem();
    if (!it || !it.w || !WEAPONS[it.w].spread) return 0.01;
    const W = WEAPONS[it.w], L = this.local;
    let s = W.spread + (W.adsSpread - W.spread) * this.ads;
    const moving = Math.hypot(L.vx, L.vz) > 1.5;
    if (moving) s *= 1.5;
    if (!L.onGround) s *= 2;
    return s;
  }

  tryFire(t, renderT) {
    const it = this.currentItem();
    if (!it) return;
    this.emote = null;
    if (it.c) {
      if (!this.mouse.leftEdge || this.me.us) return;
      this.net.send({ t: 'fire', aim: [0, 0, -1], rt: renderT });
      return;
    }
    const W = WEAPONS[it.w];
    if (t < this.nextFire) return;
    if (!W.auto && !this.mouse.leftEdge) return;
    if (W.mag && it.ammo <= 0) { if (this.mouse.leftEdge) this.reload(); return; }
    if (this.reloadUntil > t) return;
    this.nextFire = t + 1 / W.rate;
    const aim = dirFrom(this.yaw, this.pitch);
    const dirs = [];
    const spread = this.spreadNow();
    for (let i = 0; i < (W.pellets || 1); i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      dirs.push(dirFrom(this.yaw + Math.cos(a) * r, this.pitch + Math.sin(a) * r).map((v) => +v.toFixed(4)));
    }
    this.net.send({ t: 'fire', aim: aim.map((v) => +v.toFixed(4)), dirs, rt: +renderT.toFixed(3) });
    sfx.gun(it.w, 1);
    if (W.kind === 'melee') { this.swing = 1; return; }
    if (W.mag) it.ammo--;
    if (it.w === 'whistle') { it.ammo--; this.swing = 1; return; }
    this.recoil += it.w === 'sniper' ? 0.12 : it.w === 'shotgun' ? 0.09 : 0.035;
    if (W.kind !== 'hitscan') return;
    // local tracers
    const L = this.local;
    const o = new THREE.Vector3(L.x, L.y + PLAYER.eye, L.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const muzzle = o.clone().add(right.multiplyScalar(0.25)).add(new THREE.Vector3(0, -0.2, 0)).add(new THREE.Vector3(...aim).multiplyScalar(0.6));
    for (const d of dirs) {
      const hit = raycastWorld(this.world, o.x, o.y, o.z, d[0], d[1], d[2], W.range);
      let tt = hit ? hit.t : W.range;
      for (const e of this.ents.values()) {
        const s = this.sample(e, renderT);
        if (!s) continue;
        const tp = rayPlayer(s.x, s.y, s.z, o.x, o.y, o.z, d[0], d[1], d[2]);
        if (tp !== null && tp < tt) tt = tp;
      }
      this.tracer(muzzle, o.clone().add(new THREE.Vector3(...d).multiplyScalar(tt)), it.w);
    }
  }

  // ---------- building ----------
  buildTarget() {
    const L = this.local, G = BUILD.grid, k = this.buildKind;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rot = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2);
    let gy = Math.floor((L.y + 0.2) / G);
    if (k === 'wall') {
      let gx = Math.floor(L.x / G), gz = Math.floor(L.z / G);
      if (this.pitch > 0.6) gy += 1;
      return { k, gx, gy, gz, r: rot };
    }
    if (k === 'floor') {
      const dist = this.pitch < -0.5 ? 0 : 3;
      const px = L.x + fx * dist, pz = L.z + fz * dist;
      if (this.pitch > 0.5) gy += 1;
      return { k, gx: Math.floor(px / G), gy, gz: Math.floor(pz / G), r: 0 };
    }
    const px = L.x + fx * 2.6, pz = L.z + fz * 2.6;
    return { k, gx: Math.floor(px / G), gy, gz: Math.floor(pz / G), r: rot };
  }
  updateBuild(t) {
    const tg = this.buildTarget();
    const b = pieceBox(tg.k, tg.gx, tg.gy, tg.gz, tg.r, BUILD.grid, BUILD.thick);
    const m = this.pieceMesh(tg.k, b, this.ghost.material);
    this.ghost.geometry.dispose();
    this.ghost.geometry = m.geometry;
    this.ghost.position.copy(m.position); this.ghost.rotation.copy(m.rotation);
    this.ghost.material.color.set(this.me.mats >= BUILD.cost ? 0x3fa2ff : 0xff4040);
    if (this.mouse.left && t > this.nextBuild) {
      this.nextBuild = t + 0.15;
      if (this.me.mats < BUILD.cost) { if (this.mouse.leftEdge) this.hud.toast('Not enough Turf! Tackle trees, cars and buildings to collect it.'); return; }
      this.net.send({ t: 'build', ...tg });
    }
  }

  // ---------- HUD ----------
  updateHud(st, t) {
    const me = this.me, L = this.local;
    this.hud.bars(me);
    this.hud.hotbar(me, this.buildKind);
    this.hud.counters(this.alive, me.k);
    $('mats').querySelector('span').textContent = me.mats;
    // zone info
    this.checkStorm(st);
    if (this.zone && this.zone.r < 3000) {
      const z = this.zone;
      const left = Math.max(0, Math.ceil(z.end - st));
      const pre = st < z.t0 ? Math.ceil(z.t0 - st) : null;
      const mm = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const out = Math.hypot(L.x - z.cx, L.z - z.cz) > z.r;
      let txt = pre != null ? `🌀 Storm forms in ${mm(left)}` : z.st === 0 ? `🌀 Storm shrinks in ${mm(left)}` : z.st === 1 ? `🌀 Storm closing! ${mm(left)}` : '🌀 Final circle';
      if (out && !this.dead && L.phase === 'ground') txt = '⚠️ YOU ARE IN THE STORM! ' + txt;
      this.hud.zoneText(txt);
      $('zoneinfo').classList.toggle('danger', out && !this.dead && L.phase === 'ground');
    } else this.hud.zoneText(this.kind === 'island' ? '🎉 Party Island' : '');
    // interact prompt
    const target = this.nearestInteract();
    this.hud.prompt(target ? `<b>E</b>${target.label}` : this.local.phase === 'fall' ? '' : '');
    // use / reload bar
    if (me.us) this.hud.useBar(me.us, this.useTotal, 'Using…');
    else if (this.reloadUntil > t) this.hud.useBar(this.reloadUntil - t, this.reloadTotal || 1, 'Reloading…');
    else this.hud.useBar(0);
    // map
    const s = { x: L.x, z: L.z, yaw: this.yaw, zone: this.zoneDisp, mates: [], blimp: L.phase === 'blimp' ? this.blimp : null, vehicles: this.veh.mapIcons() };
    for (const [id, e] of this.ents) {
      const r = this.roster.get(id);
      if (r && r.team === this.myTeam && e.buf.length) s.mates.push(e.buf[e.buf.length - 1]);
    }
    if (this.dead) { const e = this.ents.get(this.spectateId); if (e && e.buf.length) { const b = e.buf[e.buf.length - 1]; s.x = b.x; s.z = b.z; } }
    this.hud.drawMap(false, s);
    if (this.bigMap) this.hud.drawMap(true, s);
    if (this.dead && !this.ended) {
      const r = this.roster.get(this.spectateId);
      this.hud.centerMsg(r ? `<small>Spectating <b>${esc(r.name)}</b> — click or SPACE for next · ENTER for results</small>` : '');
    }
  }

  leave() {
    this.net.send({ t: 'leave' });
    this.destroy();
    this.onLeave();
  }

  destroy() {
    if (!this.running) return;
    this.running = false;
    removeEventListener('keydown', this.h.keydown); removeEventListener('keyup', this.h.keyup);
    removeEventListener('mousemove', this.h.mousemove); removeEventListener('mousedown', this.h.mousedown);
    removeEventListener('mouseup', this.h.mouseup); removeEventListener('wheel', this.h.wheel);
    removeEventListener('contextmenu', this.h.contextmenu); removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.h.lockchange);
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.touch) this.touch.destroy();
    for (const id of ['pause', 'result', 'emotes', 'bigmap', 'scoreboard']) $(id).classList.add('hidden');
    this.hud.clearCallouts(); this.hud.clearTips(); this.hud.lowHealth(0); this.hud.fps(null);
    $('zoneinfo').classList.remove('danger');
    this.hud.show(false);
    this.hud.centerMsg(''); this.hud.prompt('');
    this.offQuality();
    for (const e of this.ents.values()) { this.players.release(e); if (e.tag) { e.tag.material.map.dispose(); e.tag.material.dispose(); } }
    this.players.dispose(); this.lootR.dispose(); this.chestR.dispose(); this.veh.dispose();
    for (const p of this.pieces.values()) p.mesh.geometry.dispose();
    disposePlayer(this.myModel);
    this.worldObjects.push(this.blimpMesh, this.ghost);
    this.disposeWorld();
  }
  // free the city (it is rebuilt for every match); shared player/prop resources stay cached
  disposeWorld() {
    for (const o of this.worldObjects || []) {
      o.traverse((x) => {
        if (x.geometry) x.geometry.dispose();
        for (const m of [].concat(x.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
      });
    }
  }
}

function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 32);
  g.fillStyle = color; g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.renderOrder = 5;
  return s;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
