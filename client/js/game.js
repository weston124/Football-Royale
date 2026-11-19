// The in-match game: movement, shooting, building, emotes, camera and syncing.
import * as THREE from 'three';
import { World, stepPlayer, stepFalling, raycastWorld, rayPlayer, pieceBox } from '/shared/physics.js';
import { WEAPONS, CONSUMABLES, itemName, RARITIES } from '/shared/weapons.js';
import { PLAYER, DROP, BUILD, PICKUP_RANGE, ZONE_PHASES, TICK_RATE } from '/shared/constants.js';
import { EMOTES } from '/shared/skins.js';
import { buildWorld } from './world.js';
import {
  createPlayer, animatePlayer, setHeld, disposePlayer, createWeaponModel, createConsumable, createLootModel,
  createChest, createBlimp, createFootball, turfMaterial, mat, WCODES, createHand, setupEnvironment,
} from './models.js';
import { sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const PH = ['ground', 'blimp', 'fall', 'glide', 'dead'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerpAngle = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const dirFrom = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };
const nowS = () => performance.now() / 1000;

export class Game {
  constructor({ renderer, map, hud, net, myId, mode, kind, mySkin, settings, onLeave, emotes }) {
    this.myEmotes = emotes || EMOTES.filter((e) => !e.price);
    this.renderer = renderer; this.map = map; this.hud = hud; this.net = net;
    this.myId = myId; this.mode = mode; this.kind = kind; this.mySkin = mySkin;
    this.settings = settings; this.onLeave = onLeave;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 2000);
    this.world = new World();
    for (const b of map.boxes) this.world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
    const w = buildWorld(this.scene, map);
    setupEnvironment(renderer, this.scene, 0.5);
    this.storm = w.storm; this.stormTex = w.stormTex;
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
    this.blimpMesh = createBlimp(); this.blimpMesh.visible = false; this.scene.add(this.blimpMesh);
    this.myModel = createPlayer(mySkin); this.myModel.visible = false; this.scene.add(this.myModel);
    // chests
    map.chests.forEach((c, i) => {
      const m = createChest(); m.position.set(c.x, c.y, c.z); this.scene.add(m);
      this.chests.set(i, { mesh: m, x: c.x, y: c.y, z: c.z });
    });
    this.setupViewmodel();
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3fa2ff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false; this.scene.add(this.ghost);
    this.pieceMat = turfMaterial();
    this.bindInput();
    this.running = true;
    this.lastFrame = nowS();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.hud.show(true);
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

  currentItem() { return this.me.slot === 0 ? { w: 'tackle', r: 0 } : this.me.inv[this.me.slot - 1]; }
  serverNow() { return nowS() + (this.offset || 0); }

  // ---------- input ----------
  bindInput() {
    const c = this.renderer.domElement;
    this.h = {
      keydown: (e) => {
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
        this.pitch = clamp(this.pitch - e.movementY * s, -1.5, 1.5);
      },
      mousedown: (e) => {
        if (document.pointerLockElement !== c) { if (!this.dead && !this.emoteMenu) c.requestPointerLock(); return; }
        if (e.button === 0) { this.mouse.left = true; this.mouse.leftEdge = true; if (this.dead) this.cycleSpectate(); }
        if (e.button === 2) this.mouse.right = true;
      },
      mouseup: (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; },
      wheel: (e) => {
        if (document.pointerLockElement !== c || this.dead) return;
        const n = (this.me.slot + (e.deltaY > 0 ? 1 : 5)) % 6;
        this.selectSlot(n);
      },
      contextmenu: (e) => e.preventDefault(),
      lockchange: () => {
        const locked = document.pointerLockElement === c;
        $('pause').classList.toggle('hidden', locked || this.dead || this.ended || this.emoteMenu);
        if (!locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      },
    };
    addEventListener('keydown', this.h.keydown); addEventListener('keyup', this.h.keyup);
    addEventListener('mousemove', this.h.mousemove); addEventListener('mousedown', this.h.mousedown);
    addEventListener('mouseup', this.h.mouseup); addEventListener('wheel', this.h.wheel, { passive: true });
    addEventListener('contextmenu', this.h.contextmenu);
    document.addEventListener('pointerlockchange', this.h.lockchange);
    $('resume').onclick = () => c.requestPointerLock();
    $('quit').onclick = () => this.leave();
    $('spectate').onclick = () => { $('dead').classList.add('hidden'); this.cycleSpectate(); };
    $('dead-leave').onclick = () => this.leave();
    $('victory-leave').onclick = () => this.leave();
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
    if (this.dead) { if (code === 'Space') this.cycleSpectate(); return; }
    if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 6) this.selectSlot(n - 1); }
    switch (code) {
      case 'Space':
        if (this.local.phase === 'blimp') this.net.send({ t: 'jump' });
        else if (this.local.phase === 'fall') { this.local.phase = 'glide'; this.net.send({ t: 'deploy' }); }
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
    else this.renderer.domElement.requestPointerLock();
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
    if (t.chest != null) { this.net.send({ t: 'open', id: t.chest }); sfx.chest(); }
    else { this.net.send({ t: 'pickup', id: t.id }); sfx.pickup(); }
  }
  nearestInteract() {
    if (this.local.phase !== 'ground' || this.dead) return null;
    const L = this.local;
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
    return best;
  }

  zoomFactor() { const it = this.currentItem(); return it && it.w === 'sniper' ? 0.3 : 0.7; }

  // ---------- network messages ----------
  start(msg) {
    this.blimp = msg.blimp;
    this.kind = msg.kind || this.kind;
    for (const r of msg.roster) this.addRoster(r);
    for (const l of msg.loot) this.addLoot(l);
    for (const id of msg.chests) this.removeChest(id);
    for (const pc of msg.pieces || []) this.addPiece(pc);
    this.offset = msg.tm - nowS();
    if (this.blimp) {
      const b = this.blimp;
      this.yaw = Math.atan2(-b.dx, -b.dz);
      this.hud.centerMsg('🎈 Press <b>SPACE</b> to jump out of the Team Blimp!');
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
    const mesh = createLootModel(item);
    mesh.position.set(x, y, z);
    mesh.visible = false;
    this.scene.add(mesh);
    this.loot.set(id, { mesh, item, x, y, z, spin: Math.random() * 6 });
  }
  removeLoot(id) { const l = this.loot.get(id); if (l) { this.scene.remove(l.mesh); this.loot.delete(id); } }
  removeChest(id) { const c = this.chests.get(id); if (c) { this.scene.remove(c.mesh); this.chests.delete(id); } }

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
    const seen = new Set();
    for (const s of m.ps) {
      const id = s[0];
      seen.add(id);
      if (id === this.myId) continue;
      let e = this.ents.get(id);
      if (!e) { e = { id, buf: [], model: null, lod: null, em: 0, emStart: 0, swing: 0 }; this.ents.set(id, e); }
      e.buf.push({ t: m.tm, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5], ph: s[6], w: s[7], em: s[8], fl: s[9] });
      if (e.buf.length > 30) e.buf.shift();
    }
    for (const [id, e] of this.ents) if (!seen.has(id)) this.removeEnt(id);
    for (const ev of m.ev) this.onEvent(ev);
    if (m.zn) {
      const z = m.zn;
      this.zone = { cx: z[0], cz: z[1], r: z[2], tx: z[3], tz: z[4], tr: z[5], st: z[6], end: z[7], ph: z[8], t0: z[9] };
      if (!this.zoneDisp) this.zoneDisp = { ...this.zone };
    }
    if (m.al != null) this.alive = m.al;
    if (m.me) this.applyMe(m.me);
    if (m.pe) for (const e of m.pe) this.onPersonal(e);
  }

  applyMe(me) {
    const prevPh = this.me.ph;
    this.me = me;
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
        }
        break;
      }
      case 'pr': {
        const [, id, kind, x, y, z, vx, vy, vz, owner] = ev;
        const mesh = kind === 'pigskin' ? createFootball(0.45) : createConsumable('tape');
        if (kind === 'whistle') { mesh.clear(); mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat('#e0e0e0'))); }
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
        sfx.boom(clamp(1 - Math.hypot(x - this.local.x, z - this.local.z) / 200, 0.05, 1));
        break;
      }
      case 'kf': {
        const [, kid, vid, wid, head] = ev;
        const killer = this.roster.get(kid), victim = this.roster.get(vid);
        if (!victim) break;
        if (kid) this.kills.set(kid, (this.kills.get(kid) || 0) + 1);
        const e = this.ents.get(vid);
        if (e && e.model) this.burst(e.model.position.clone().add(new THREE.Vector3(0, 1.2, 0)), ['#ff5a2a', '#ffcc33', '#3fa2ff', '#4fd16b', '#ff7bf2'], 40);
        const mine = kid === this.myId || vid === this.myId;
        let html;
        if (wid === 'storm') html = `<b>${esc(victim.name)}</b> got caught in the Overtime Storm 🌀`;
        else if (wid === 'quit') html = `<b>${esc(victim.name)}</b> left the game`;
        else html = `<b>${esc(killer ? killer.name : '?')}</b> ${head ? '🎯' : '🏈'} <small>${WEAPONS[wid] ? WEAPONS[wid].name : ''}</small> <b>${esc(victim.name)}</b>`;
        this.hud.killfeed(html, mine);
        if (kid === this.myId && vid !== this.myId) { sfx.elim(); this.hud.toast(`You eliminated ${victim.name}!`); }
        if (this.spectateId === vid && this.dead) setTimeout(() => this.cycleSpectate(), 1500);
        break;
      }
      case 'win': {
        const [, wid, names, team] = ev;
        this.ended = true;
        if (team === this.myTeam || wid === this.myId) this.victory(names);
        else this.hud.centerMsg(`🏆 <b>${esc(names)}</b> won the match!`);
        break;
      }
    }
  }

  onPersonal(e) {
    switch (e[0]) {
      case 'corr':
        this.local.x = e[1]; this.local.y = e[2]; this.local.z = e[3];
        this.local.vx = this.local.vy = this.local.vz = 0;
        if (e[4] === 'fall') { this.local.phase = 'fall'; this.hud.centerMsg(''); this.hud.toast('Press SPACE to open your parachute early', 3000); }
        break;
      case 'hit': {
        const [, dmg, head, x, y, z, kill] = e;
        this.hud.hitmarker(kill, head);
        sfx.hit(head);
        const v = new THREE.Vector3(x, y, z).project(this.camera);
        if (v.z < 1) this.hud.damageNumber((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, dmg, head);
        break;
      }
      case 'hurt': {
        const ang = Math.atan2(e[1] - this.local.x, e[2] - this.local.z);
        // angle relative to view (0 = in front)
        this.hud.hurtFrom(-(ang - Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw))));
        this.hud.flash('hurt');
        sfx.hurt();
        this.emote = null;
        break;
      }
      case 'storm': this.hud.flash('storm'); sfx.storm(); break;
      case 'kb': this.local.vx += e[1]; this.local.vy = Math.max(this.local.vy, e[2]); this.local.vz += e[3]; this.local.onGround = false; break;
      case 'msg': this.hud.toast(e[1]); break;
      case 'mats': break;
      case 'use': this.useTotal = e[1]; break;
      case 'dead': {
        this.dead = true;
        this.spectateId = e[2] || 0;
        const killer = this.roster.get(e[2]);
        document.exitPointerLock();
        $('dead-title').textContent = 'FUMBLED!';
        $('dead-info').innerHTML = `${killer ? `Eliminated by <b>${esc(killer.name)}</b>.` : 'You were eliminated.'}<br>You placed <b>#${e[1]}</b> with <b>${this.me.k}</b> eliminations.`;
        $('dead').classList.remove('hidden');
        this.saveStats(false);
        break;
      }
    }
  }

  victory(names) {
    if (this.dead && !this.savedWin) { /* team won while I was down */ }
    document.exitPointerLock();
    $('dead').classList.add('hidden');
    $('victory-info').innerHTML = `${esc(names)} — ${this.me.k} eliminations. You're the last team standing! 🏈`;
    $('victory').classList.remove('hidden');
    sfx.win();
    for (let i = 0; i < 6; i++) setTimeout(() => this.burst(this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 3, (Math.random() - 0.5) * 8)), ['#ff5a2a', '#ffcc33', '#3fa2ff', '#4fd16b', '#ff7bf2'], 60), i * 300);
    this.saveStats(true);
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
    if (e.model) { this.scene.remove(e.model); disposePlayer(e.model); }
    if (e.lod) this.scene.remove(e.lod);
    if (e.tag) this.scene.remove(e.tag);
    this.ents.delete(id);
  }
  ensureModels(e) {
    const r = this.roster.get(e.id);
    const skin = r ? r.skin : this.mySkin;
    if (!e.model) {
      e.model = createPlayer(skin); this.scene.add(e.model);
      const lod = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 2, 6), mat(skin.pants)); legs.position.y = 0.55; lod.add(legs);
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.35, 2, 6), mat(skin.jersey)); b.position.y = 1.3; lod.add(b);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(skin.helmet)); h.position.y = 1.8; lod.add(h);
      e.lod = lod; this.scene.add(lod);
      const showTag = this.kind === 'island' || (r && r.team === this.myTeam);
      if (showTag && r) { e.tag = nameTag(r.name, r.team === this.myTeam ? '#3fa2ff' : '#ffffff'); this.scene.add(e.tag); }
    }
  }
  sample(e, t) {
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
    const st = this.serverNow();
    const renderT = st - 0.1;
    const L = this.local;
    const locked = document.pointerLockElement === this.renderer.domElement;

    // --- local movement ---
    if (!this.dead) {
      const input = { f: 0, s: 0, yaw: this.yaw, pitch: this.pitch, jump: false, sprint: false };
      if (locked) {
        input.f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
        input.s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
        input.jump = this.keys.has('Space');
        input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      }
      if (this.emote && (input.f || input.s || input.jump)) this.emote = null;
      if (L.phase === 'ground') {
        let left = dt;
        while (left > 0) { const h = Math.min(left, 1 / 60); stepPlayer(this.world, L, input, h); left -= h; }
      } else if (L.phase === 'fall' || L.phase === 'glide') {
        if (stepFalling(this.world, L, input, dt)) { this.hud.centerMsg(''); }
      } else if (L.phase === 'blimp' && this.blimp) {
        const b = this.blimp, d = Math.min(b.len, (st - b.t0) * DROP.speed);
        L.x = b.x0 + b.dx * d; L.y = DROP.height; L.z = b.z0 + b.dz * d;
      }
      if (t - this.lastSend > 1 / TICK_RATE) {
        this.lastSend = t;
        this.net.send({ t: 'in', x: +L.x.toFixed(2), y: +L.y.toFixed(2), z: +L.z.toFixed(2), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), em: this.emote ? this.emote.id : 0, ph: L.phase });
      }
    }

    // --- aiming, shooting, building ---
    const it = this.currentItem();
    const wantAds = this.mouse.right && locked && it && it.w && it.w !== 'tackle' && it.w !== 'whistle' && !this.buildKind && L.phase === 'ground';
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    if (locked && !this.dead && L.phase === 'ground' && !this.emoteMenu) {
      if (this.buildKind) this.updateBuild(t);
      else if (this.mouse.left) this.tryFire(t, renderT);
    }
    this.ghost.visible = !!this.buildKind && L.phase === 'ground' && !this.dead;
    this.mouse.leftEdge = false;
    if (this.reloadUntil && t >= this.reloadUntil) this.reloadUntil = 0;
    this.recoil *= Math.pow(0.0001, dt);
    this.swing = Math.max(0, this.swing - dt * 4);

    // --- other players ---
    const mates = [];
    for (const e of this.ents.values()) {
      const s = this.sample(e, renderT);
      if (!s) continue;
      const dist = Math.hypot(s.x - L.x, s.z - L.z);
      const r = this.roster.get(e.id);
      if (r && r.team === this.myTeam) mates.push(s);
      if (dist > 450) { if (e.model) e.model.visible = e.lod.visible = false; continue; }
      this.ensureModels(e);
      const near = dist < 90 || e.id === this.spectateId;
      e.model.visible = near; e.lod.visible = !near && s.ph !== 3;
      const obj = near ? e.model : e.lod;
      const prev = e.last || s;
      const spd = Math.hypot(s.x - prev.x, s.z - prev.z) / Math.max(dt, 0.001);
      e.last = { x: s.x, z: s.z };
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.y = s.yaw;
      if (e.tag) { e.tag.position.set(s.x, s.y + 2.5, s.z); e.tag.visible = dist < 200; }
      if (near) {
        if (s.em && s.em !== e.em) e.emStart = t;
        e.em = s.em;
        e.swing = Math.max(0, e.swing - dt * 4);
        setHeld(e.model, s.ph === 0 && !s.em ? s.w : 0);
        animatePlayer(e.model, { speed: Math.min(spd, 12), phase: s.ph, emote: s.em, emoteT: t - e.emStart, pitch: s.pitch, swing: e.swing, t }, dt);
      }
    }

    // --- projectiles ---
    for (const p of this.projs.values()) {
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.1) { p.y = 0.1; p.vy = Math.abs(p.vy) * 0.4; p.vx *= 0.6; p.vz *= 0.6; }
      p.mesh.position.set(p.x, p.y, p.z);
      if (p.kind === 'pigskin') { p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz); p.mesh.rotateZ(t * 20); }
    }

    // --- effects ---
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.obj); f.obj.geometry?.dispose(); f.obj.material?.dispose(); return false; }
      f.update(f.life / f.max, dt);
      return true;
    });

    // --- loot visibility & spin ---
    if (this.frame % 3 === 0) {
      for (const l of this.loot.values()) l.mesh.visible = Math.abs(l.x - L.x) < 70 && Math.abs(l.z - L.z) < 70;
      for (const c of this.chests.values()) c.mesh.visible = Math.abs(c.x - L.x) < 150 && Math.abs(c.z - L.z) < 150;
    }
    for (const l of this.loot.values()) if (l.mesh.visible) { l.spin += dt * 1.5; l.mesh.userData.inner.rotation.y = l.spin; l.mesh.userData.inner.position.y = 0.55 + Math.sin(l.spin * 2) * 0.08; }

    // --- storm ---
    if (this.zone) {
      const z = this.zone, d = this.zoneDisp;
      const k = Math.min(1, dt * 6);
      d.cx += (z.cx - d.cx) * k; d.cz += (z.cz - d.cz) * k; d.r += (z.r - d.r) * k;
      Object.assign(d, { tx: z.tx, tz: z.tz, tr: z.tr, st: z.st });
      this.storm.visible = d.r < 3000;
      this.storm.position.set(d.cx, 150, d.cz);
      this.storm.scale.set(Math.max(0.1, d.r), 1, Math.max(0.1, d.r));
      this.stormTex.offset.x = t * 0.02;
    }

    // --- camera ---
    this.updateCamera(t, dt, renderT);

    // --- HUD ---
    if (this.frame % 4 === 0) this.updateHud(st, t);

    // --- render ---
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    const showVm = !this.dead && L.phase === 'ground' && !this.emote && !(this.ads > 0.6 && it && it.w === 'sniper');
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
    const fov = 75 - this.ads * (75 - 75 * (it && it.w === 'sniper' ? 0.25 : 0.72));
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    $('scope').classList.toggle('hidden', !(this.ads > 0.6 && it && it.w === 'sniper'));
    $('crosshair').style.setProperty('--g', `${4 + this.spreadNow() * 260}px`);
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
    } else if (L.phase === 'blimp') {
      thirdTarget = this.blimpMesh.position.clone(); dist = 70;
    } else if (this.emote || L.phase === 'fall' || L.phase === 'glide') {
      thirdTarget = new THREE.Vector3(L.x, L.y + 1.6, L.z);
      dist = L.phase === 'glide' ? 8 : 5;
    }
    const showMe = !this.dead && L.phase !== 'blimp' && !!thirdTarget;
    this.myModel.visible = showMe;
    if (showMe) {
      this.myModel.position.set(L.x, L.y, L.z);
      this.myModel.rotation.y = this.yaw;
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
    if (this.zone && this.zone.r < 3000) {
      const z = this.zone;
      const left = Math.max(0, Math.ceil(z.end - st));
      const pre = st < z.t0 ? Math.ceil(z.t0 - st) : null;
      const mm = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const out = Math.hypot(L.x - z.cx, L.z - z.cz) > z.r;
      let txt = pre != null ? `🌀 Storm forms in ${mm(left)}` : z.st === 0 ? `🌀 Storm shrinks in ${mm(left)}` : z.st === 1 ? `🌀 Storm closing! ${mm(left)}` : '🌀 Final circle';
      if (out && !this.dead && L.phase === 'ground') txt = '⚠️ YOU ARE IN THE STORM! ' + txt;
      this.hud.zoneText(txt);
    } else this.hud.zoneText(this.kind === 'island' ? '🎉 Party Island' : '');
    // interact prompt
    const target = this.nearestInteract();
    this.hud.prompt(target ? `<b>E</b>${target.label}` : this.local.phase === 'fall' ? '' : '');
    // use / reload bar
    if (me.us) this.hud.useBar(me.us, this.useTotal, 'Using…');
    else if (this.reloadUntil > t) this.hud.useBar(this.reloadUntil - t, this.reloadTotal || 1, 'Reloading…');
    else this.hud.useBar(0);
    // map
    const s = { x: L.x, z: L.z, yaw: this.yaw, zone: this.zoneDisp, mates: [], blimp: L.phase === 'blimp' ? this.blimp : null };
    for (const [id, e] of this.ents) {
      const r = this.roster.get(id);
      if (r && r.team === this.myTeam && e.buf.length) s.mates.push(e.buf[e.buf.length - 1]);
    }
    if (this.dead) { const e = this.ents.get(this.spectateId); if (e && e.buf.length) { const b = e.buf[e.buf.length - 1]; s.x = b.x; s.z = b.z; } }
    this.hud.drawMap(false, s);
    if (this.bigMap) this.hud.drawMap(true, s);
    if (this.dead && !this.ended) {
      const r = this.roster.get(this.spectateId);
      this.hud.centerMsg(r ? `<small>Spectating <b>${esc(r.name)}</b> — click or SPACE for next</small>` : '');
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
    for (const id of ['pause', 'dead', 'victory', 'emotes', 'bigmap', 'scoreboard']) $(id).classList.add('hidden');
    this.hud.show(false);
    this.hud.centerMsg(''); this.hud.prompt('');
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
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
