// Touch controls for phones and tablets (iPad Safari, Android Chrome).
// Only switches on for touch devices: a coarse primary pointer, or the first real touch event.
// Everything here drives the same Game state the keyboard/mouse uses (keys, mouse, yaw/pitch,
// selectSlot, onKey...), so the server sees exactly the same messages as from a desktop player.
import { WEAPONS } from '/shared/weapons.js';
import { PLAYER } from '/shared/constants.js';
import { raycastWorld } from '/shared/physics.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** A coarse primary pointer = phone/tablet. Used for the default UI and the performance settings. */
export const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const root = document.documentElement;
let touchSeen = IS_TOUCH;

/** Call once at app start: marks <html> for touch CSS, stops pinch-zoom/scroll bounce. */
export function initTouchEnvironment() {
  if (IS_TOUCH) root.classList.add('touch');
  // the sensitivity slider also sets touch look speed
  const sl = document.getElementById('sens')?.parentElement?.firstChild;
  if (IS_TOUCH && sl && sl.nodeType === 3) sl.textContent = 'Look sensitivity ';
  // first real touch (e.g. a touchscreen laptop or an iPad reporting a fine pointer) switches touch UI on
  addEventListener('touchstart', () => {
    if (!touchSeen) { touchSeen = true; root.classList.add('touch'); }
    if (activeControls) activeControls.setActive(true);
  }, { capture: true, passive: true });
  // a real mouse click switches the on-screen controls off again (hybrid devices)
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && activeControls && activeControls.active && !e.target.closest?.('#touch')) activeControls.setActive(false);
  }, { capture: true });
  // iOS Safari ignores user-scalable=no; block pinch zoom gestures and double-tap zoom on the game
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || root.classList.contains('in-match')) {
      // let scrollable menus/panels scroll, but never zoom or bounce the whole page
      if (e.touches.length > 1 || !e.target.closest?.('.screen, #admin-drop, #emotes, #scoreboard')) e.preventDefault();
    }
  }, { passive: false });
}

/** Renderer pixel ratio to use: lower on phones/tablets to keep the frame rate up. */
export function pixelRatioFor(max) { return Math.min(devicePixelRatio || 1, IS_TOUCH ? Math.min(max, 1.25) : max); }

let activeControls = null;

/** Create touch controls for a Game (returns null on devices that have never seen touch). */
export function createTouchControls(game) {
  if (!touchSeen && !('ontouchstart' in window)) return null;
  const tc = new TouchControls(game);
  if (touchSeen) tc.setActive(true);
  return tc;
}

// The on-screen buttons are static HTML, so their listeners are bound once and act on the current match.
let buttonsBound = false;
function bindButtons() {
  const c = () => activeControls;
  const opt = { passive: false };
  // buttons: act on touchstart (no 300ms delay, no ghost mouse events)
  const press = (id, down, up) => {
    const b = $(id);
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); if (!c()) return; b.classList.add('down'); down(e); }, opt);
    const rel = (e) => { e.preventDefault(); b.classList.remove('down'); if (up && c()) up(e); };
    b.addEventListener('touchend', rel, opt); b.addEventListener('touchcancel', rel, opt);
    // also clickable (accessibility / mouse on a touch laptop)
    b.addEventListener('click', (e) => { if (!c() || !c().active) return; e.preventDefault(); down(e); if (up) up(e); });
  };
  press('t-fire', (e) => {
    const t = e.changedTouches?.[0];
    c().fireId = t ? t.identifier : null;
    if (t) c().looks.set(t.identifier, { x: t.clientX, y: t.clientY }); // drag the fire button to aim
    if (c().g.dead) { c().g.cycleSpectate(); return; }
    c().g.mouse.left = true; c().g.mouse.leftEdge = true;
  }, () => { c().releaseFireAt = c().frame + 2; }); // a quick tap still fires one shot
  press('t-aim', () => { c().g.mouse.right = !c().g.mouse.right; });
  press('t-jump', () => {
    if (c().g.emoteMenu) return;
    c().g.keys.add('Space'); c().g.onKey('Space');
  }, () => c().g.keys.delete('Space'));
  press('t-reload', () => c().g.onKey('KeyR'));
  press('t-use', () => c().g.onKey('KeyE'));
  press('t-wall', () => c().g.onKey('KeyZ'));
  press('t-floor', () => c().g.onKey('KeyX'));
  press('t-ramp', () => c().g.onKey('KeyC'));
  press('t-emote', () => {
    if (c().g.emoteMenu) c().g.toggleEmoteMenu(false);
    else c().g.onKey('KeyG');
  });
  press('t-map', () => c().g.onKey('KeyM'));
  press('t-score', () => {
    const sb = $('scoreboard');
    if (sb.classList.contains('hidden')) c().g.showScoreboard(); else sb.classList.add('hidden');
  });
  press('t-pause', () => { $('pause').classList.remove('hidden'); c().release(); });
}

class TouchControls {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.el = $('touch');
    this.stick = null;         // { id, ox, oy, x, y }
    this.looks = new Map();    // touch id -> { x, y }
    this.fireId = null;
    this.move = { f: 0, s: 0, sprint: false };
    this.assist = 1;           // look-speed multiplier from aim assist (1 = none)
    this.target = null;
    this.frame = 0;
    activeControls = this;
    root.classList.add('in-match');

    const canvas = game.renderer.domElement;
    const opt = { passive: false };
    this.h = {
      start: (e) => this.onCanvasStart(e),
      move: (e) => this.onMove(e),
      end: (e) => this.onEnd(e),
    };
    canvas.addEventListener('touchstart', this.h.start, opt);
    addEventListener('touchmove', this.h.move, opt);
    addEventListener('touchend', this.h.end, opt);
    addEventListener('touchcancel', this.h.end, opt);

    if (!buttonsBound) { buttonsBound = true; bindButtons(); }

    // tap a hotbar slot to select it
    this.hotbarTap = (e) => {
      if (!this.active) return;
      const s = e.target.closest('.slot');
      if (!s) return;
      e.preventDefault();
      const i = [...$('hotbar').children].indexOf(s);
      if ($('hotbar').classList.contains('big')) { // scrolling strip: drag to scroll, tap to pick
        const t = e.changedTouches[0];
        this.hotDrag = { id: t.identifier, x: t.clientX, left: $('hotbar').scrollLeft, i, moved: false };
        return;
      }
      if (i >= 0 && !this.g.dead) { this.g.selectSlot(i); this.g.mouse.right = false; }
    };
    this.hotbarMove = (e) => {
      const d = this.hotDrag; if (!d) return;
      for (const t of e.changedTouches) if (t.identifier === d.id) {
        e.preventDefault();
        const dx = t.clientX - d.x;
        if (Math.abs(dx) > 8) d.moved = true;
        if (d.moved) { $('hotbar').scrollLeft = d.left - dx; this.g.hud.hotUserScroll = performance.now(); }
      }
    };
    this.hotbarEnd = (e) => {
      const d = this.hotDrag; if (!d) return;
      for (const t of e.changedTouches) if (t.identifier === d.id) {
        this.hotDrag = null;
        e.preventDefault();
        if (!d.moved && d.i >= 0 && this.active && !this.g.dead) { this.g.selectSlot(d.i); this.g.mouse.right = false; }
      }
    };
    $('hotbar').addEventListener('touchstart', this.hotbarTap, opt);
    $('hotbar').addEventListener('touchmove', this.hotbarMove, opt);
    $('hotbar').addEventListener('touchend', this.hotbarEnd, opt);
    $('hotbar').addEventListener('touchcancel', this.hotbarEnd, opt);
    // tap the big map to close it
    this.bigmapTap = (e) => { if (this.active && this.g.bigMap) { e.preventDefault(); this.g.onKey('KeyM'); } };
    $('bigmap').addEventListener('touchstart', this.bigmapTap, opt);

    // swap keyboard hints for touch words in on-screen messages
    this.obs = new MutationObserver(() => this.relabel());
    for (const id of ['center-msg', 'toast']) this.obs.observe($(id), { childList: true, characterData: true, subtree: true });
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    root.classList.toggle('touch-on', on);
    if (on && document.pointerLockElement) document.exitPointerLock();
    if (!on) this.release();
    if (on) $('pause').classList.add('hidden');
    this.relabel();
  }

  release() {
    this.stick = null; this.looks.clear(); this.fireId = null;
    this.move = { f: 0, s: 0, sprint: false };
    this.g.mouse.left = false;
    this.g.keys.delete('Space');
    this.drawStick();
  }

  relabel() {
    if (!this.active) return;
    const fix = (id, pairs) => {
      const el = $(id);
      let h = el.innerHTML;
      const before = h;
      for (const [a, b] of pairs) h = h.split(a).join(b);
      if (h !== before) el.innerHTML = h;
    };
    fix('center-msg', [['Press <b>SPACE</b>', 'Tap <b>JUMP</b>'], ['Press <b>G</b>', 'Tap <b>EMOTE</b>'], ['click or SPACE for next', 'tap the screen for next']]);
    fix('toast', [['Press SPACE', 'Tap JUMP']]);
  }

  // ---------- touches on the 3D view ----------
  onCanvasStart(e) {
    if (!this.active) return;
    e.preventDefault(); // no mouse emulation, no zoom
    for (const t of e.changedTouches) {
      if (this.g.dead) { this.g.cycleSpectate(); continue; }
      if (t.clientX < innerWidth * 0.42 && !this.stick && !this.g.emoteMenu) {
        this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        this.updateStick();
      } else {
        this.looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  onMove(e) {
    if (!this.active) return;
    let used = false;
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) {
        this.stick.x = t.clientX; this.stick.y = t.clientY; this.updateStick(); used = true;
      } else if (this.looks.has(t.identifier)) {
        const p = this.looks.get(t.identifier);
        const dx = t.clientX - p.x, dy = t.clientY - p.y;
        p.x = t.clientX; p.y = t.clientY;
        this.look(dx, dy); used = true;
      }
    }
    if (used && e.cancelable) e.preventDefault();
  }

  onEnd(e) {
    for (const t of e.changedTouches) {
      if (this.stick && t.identifier === this.stick.id) { this.stick = null; this.updateStick(); }
      this.looks.delete(t.identifier);
      if (t.identifier === this.fireId) { this.fireId = null; this.releaseFireAt = this.frame + 2; }
    }
  }

  look(dx, dy) {
    const g = this.g;
    if (g.emoteMenu) return;
    const s = 0.0052 * g.settings.sens * (g.ads > 0.5 ? g.zoomFactor() : 1) * this.assist;
    g.yaw -= dx * s;
    g.pitch = clamp(g.pitch - dy * s, -1.5, 1.5);
    this.lookedAt = performance.now();
  }

  updateStick() {
    const R = 60;
    const st = this.stick;
    if (!st) { this.move = { f: 0, s: 0, sprint: false }; this.drawStick(); return; }
    let dx = st.x - st.ox, dy = st.y - st.oy;
    const d = Math.hypot(dx, dy);
    // drag past the ring: the ring follows the finger (so you never "run out" of stick)
    if (d > R * 1.6) { const k = (d - R * 1.6) / d; st.ox += dx * k; st.oy += dy * k; dx = st.x - st.ox; dy = st.y - st.oy; }
    const m = Math.min(1, Math.hypot(dx, dy) / R);
    const dead = 0.18;
    if (m < dead) this.move = { f: 0, s: 0, sprint: false };
    else {
      const ang = Math.atan2(dx, -dy); // 0 = forward
      this.move = { f: Math.cos(ang), s: Math.sin(ang), sprint: Math.hypot(dx, dy) > R * 1.15 && Math.cos(ang) > 0.5 };
    }
    this.drawStick();
  }

  drawStick() {
    const base = $('t-stick'), knob = $('t-knob');
    if (!base) return;
    const st = this.stick;
    base.classList.toggle('live', !!st);
    base.classList.toggle('sprint', this.move.sprint);
    if (!st) { base.style.left = base.style.top = ''; knob.style.transform = ''; return; }
    base.style.left = `${st.ox}px`; base.style.top = `${st.oy}px`;
    const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), max = 60;
    const k = d > max ? max / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  /** Called by Game.loop after the keyboard input is read: adds joystick movement. */
  applyInput(input) {
    if (!this.active) return;
    if (this.move.f || this.move.s) {
      input.f = this.move.f; input.s = this.move.s;
      input.sprint = input.sprint || this.move.sprint;
    }
  }

  /** Called once per frame by Game.loop. */
  update(dt, renderT) {
    if (!this.active) return;
    this.frame++;
    if (this.releaseFireAt && this.frame >= this.releaseFireAt) { this.releaseFireAt = 0; if (this.fireId == null) this.g.mouse.left = false; }
    this.aimAssist(dt, renderT);
    if (this.frame % 4) return;
    const g = this.g, L = g.local, it = g.currentItem();
    const ground = L.phase === 'ground' && !g.dead;
    const gun = it && it.w && it.w !== 'tackle' && it.w !== 'whistle';
    const cl = this.el.classList;
    cl.toggle('dead', g.dead);
    cl.toggle('air', !g.dead && L.phase !== 'ground');
    cl.toggle('build', g.mode === 'build' && ground);
    cl.toggle('can-use', ground && !!g.nearestInteract());
    cl.toggle('gun', ground && !!gun && !g.buildKind);
    cl.toggle('reloadable', ground && !!(it && it.w && WEAPONS[it.w].mag));
    cl.toggle('menu', g.emoteMenu);
    cl.toggle('island', g.kind === 'island');
    const driving = !!g.veh?.driving;
    if (cl.contains('driving') !== driving) $('t-jump').innerHTML = driving ? '🛑<small>BRAKE</small>' : '⬆<small>JUMP</small>';
    cl.toggle('driving', driving);
    $('t-aim').classList.toggle('on', !!g.mouse.right && !!gun);
    for (const k of ['wall', 'floor', 'ramp']) $(`t-${k}`).classList.toggle('on', g.buildKind === k);
    $('t-fire').textContent = g.buildKind ? '🧱' : it && it.c ? '🩹' : it && it.w === 'tackle' ? '💪' : '🔥';
  }

  // Gentle aim assist (touch only, purely client-side view help: the server still checks every shot).
  // When the crosshair is near an enemy we slow the look speed a little, and while you're shooting or
  // aiming we nudge the view a small step toward them.
  aimAssist(dt, renderT) {
    const g = this.g, L = g.local;
    this.assist = 1; this.target = null;
    const it = g.currentItem();
    if (g.dead || g.veh?.driving || L.phase !== 'ground' || g.kind === 'island' || g.buildKind || g.emote || !it || !it.w) return;
    const W = WEAPONS[it.w];
    const range = Math.min(W.range || 3, 120);
    const ex = L.x, ey = L.y + PLAYER.eye, ez = L.z;
    let best = null, bestErr = Infinity;
    for (const e of g.ents.values()) {
      const r = g.roster.get(e.id);
      if (!r || (r.team != null && r.team === g.myTeam)) continue;
      const s = g.sample(e, renderT);
      if (!s || s.ph !== 0) continue;
      const tx = s.x - ex, ty = s.y + 1.25 - ey, tz = s.z - ez;
      const hd = Math.hypot(tx, tz), dist = Math.hypot(hd, ty);
      if (dist > range || dist < 0.5) continue;
      const dyaw = wrap(Math.atan2(-tx, -tz) - g.yaw);
      const dpitch = Math.atan2(ty, hd) - g.pitch;
      const err = Math.hypot(dyaw, dpitch);
      const cone = clamp(Math.atan(1.1 / dist), 0.02, 0.16); // about a body width around them
      if (err > cone || err >= bestErr) continue;
      const hit = raycastWorld(g.world, ex, ey, ez, tx / dist, ty / dist, tz / dist, dist);
      if (hit && hit.t < dist - 0.5) continue; // behind a wall
      best = { dyaw, dpitch, cone }; bestErr = err;
    }
    if (!best) return;
    this.target = best;
    this.assist = 0.6; // "friction": slower look while over a target
    const engaged = g.mouse.left || g.ads > 0.5 || (performance.now() - (this.lookedAt || 0) < 150);
    if (!engaged) return;
    const k = Math.min(1, dt * (g.ads > 0.5 ? 3.5 : 2.2)) * 0.5;
    g.yaw += best.dyaw * k;
    g.pitch = clamp(g.pitch + best.dpitch * k, -1.5, 1.5);
  }

  destroy() {
    const canvas = this.g.renderer.domElement;
    canvas.removeEventListener('touchstart', this.h.start);
    removeEventListener('touchmove', this.h.move);
    removeEventListener('touchend', this.h.end);
    removeEventListener('touchcancel', this.h.end);
    $('hotbar').removeEventListener('touchstart', this.hotbarTap);
    $('hotbar').removeEventListener('touchmove', this.hotbarMove);
    $('hotbar').removeEventListener('touchend', this.hotbarEnd);
    $('hotbar').removeEventListener('touchcancel', this.hotbarEnd);
    $('bigmap').removeEventListener('touchstart', this.bigmapTap);
    this.obs.disconnect();
    this.release();
    this.el.className = '';
    root.classList.remove('in-match');
    if (activeControls === this) activeControls = null;
  }
}
