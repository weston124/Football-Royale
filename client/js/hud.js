// Heads-up display helpers: bars, hotbar, minimap, kill feed, toasts.
import { WEAPONS, CONSUMABLES, RARITIES, itemName } from '/shared/weapons.js';
import { MAP_HALF } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const ICON = { tackle: '💪', pistol: '🔫', smg: '🔫', rifle: '🔫', shotgun: '🔫', sniper: '🎯', pigskin: '🏈', whistle: '📣', tape: '🩹', kit: '🧰', padding: '🛡️' };

export class Hud {
  constructor(mapImage, pois) {
    this.mapImage = mapImage;
    this.pois = pois;
    this.mini = $('minimap').getContext('2d');
    this.big = $('bigmap').getContext('2d');
    this.lastHot = '';
    this.toastTimer = 0;
    this.feed = [];
  }
  show(v) { $('hud').classList.toggle('hidden', !v); }

  bars(me) {
    $('hpfill').style.width = `${me.hp}%`; $('hptxt').textContent = me.hp;
    $('padfill').style.width = `${me.pad}%`; $('padtxt').textContent = me.pad;
  }

  hotbar(me, buildKind) {
    const key = JSON.stringify([me.inv, me.slot, buildKind]);
    if (key === this.lastHot) return;
    this.lastHot = key;
    const slots = [{ w: 'tackle', r: 0 }, ...me.inv];
    const hb = $('hotbar');
    // more than the normal 6 slots (admins' unlimited backpack): a scrolling strip
    const big = slots.length > 6;
    hb.classList.toggle('big', big);
    hb.innerHTML = slots.map((it, i) => {
      if (!it) return `<div class="slot ${me.slot === i ? 'sel' : ''}"><span class="key">${i + 1}</span></div>`;
      const col = it.w ? RARITIES[it.r || 0].color : it.c ? RARITIES[CONSUMABLES[it.c].rarity].color : '#888';
      const cnt = it.c ? it.n : it.w === 'whistle' ? it.ammo : '';
      return `<div class="slot ${me.slot === i && !buildKind ? 'sel' : ''}" style="border-color:${col};background:${col}33">
        <span class="key">${i + 1}</span><span class="cnt">${cnt}</span><span class="ic">${ICON[it.w || it.c] || '❔'}</span>${itemName(it)}</div>`;
    }).join('');
    if (big) this.keepSlotInView(me.slot, me.slot !== this.lastHotSlot);
    else hb.classList.remove('more-l', 'more-r');
    this.lastHotSlot = me.slot;
    const cur = slots[me.slot];
    if (buildKind) $('ammo').textContent = `BUILD: ${buildKind.toUpperCase()}`;
    else if (cur && cur.w && WEAPONS[cur.w].mag) $('ammo').textContent = `${cur.ammo} / ${WEAPONS[cur.w].mag}`;
    else $('ammo').textContent = '';
  }

  // Scrolls the big hotbar so the selected slot is visible (centred when the slot changed)
  // and fades the edges that have more slots behind them.
  keepSlotInView(slot, center) {
    const hb = $('hotbar'), s = hb.children[slot];
    // don't yank the strip back while the player is swiping through it
    if (s && (center || !(performance.now() - (this.hotUserScroll || 0) < 3000))) {
      const l = s.offsetLeft, r = l + s.offsetWidth, pad = s.offsetWidth * 0.6;
      if (center || l < hb.scrollLeft + pad || r > hb.scrollLeft + hb.clientWidth - pad) {
        hb.scrollTo({ left: l - (hb.clientWidth - s.offsetWidth) / 2, behavior: center ? 'smooth' : 'auto' });
      }
    }
    if (!this.hotScrollBound) {
      this.hotScrollBound = true;
      hb.addEventListener('scroll', () => this.hotEdges(), { passive: true });
    }
    this.hotEdges();
  }
  hotEdges() {
    const hb = $('hotbar');
    if (!hb.classList.contains('big')) return;
    hb.classList.toggle('more-l', hb.scrollLeft > 4);
    hb.classList.toggle('more-r', hb.scrollLeft + hb.clientWidth < hb.scrollWidth - 4);
  }

  toast(text, ms = 2500) {
    $('toast').textContent = text;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { $('toast').textContent = ''; }, ms);
  }

  killfeed(html, mine) {
    const el = document.createElement('div');
    el.innerHTML = html;
    if (mine) el.className = 'me';
    $('killfeed').prepend(el);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  // draw minimap (zoomed around the player) or the big map
  drawMap(big, s) {
    const g = big ? this.big : this.mini;
    const W = g.canvas.width;
    const view = big ? MAP_HALF * 2 : 360;  // meters shown
    const cx = big ? 0 : s.x, cz = big ? 0 : s.z;
    const k = W / view;
    const img = this.mapImage, ik = img.width / (MAP_HALF * 2);
    g.fillStyle = '#2a83c9'; g.fillRect(0, 0, W, W);
    g.drawImage(img, (cx - view / 2 + MAP_HALF) * ik, (cz - view / 2 + MAP_HALF) * ik, view * ik, view * ik, 0, 0, W, W);
    const X = (x) => (x - cx) * k + W / 2, Z = (z) => (z - cz) * k + W / 2;
    if (big) {
      g.font = 'bold 15px Trebuchet MS'; g.textAlign = 'center';
      for (const p of this.pois) { g.fillStyle = '#000a'; g.fillText(p.name, X(p.x) + 1, Z(p.z) + 1); g.fillStyle = '#fff'; g.fillText(p.name, X(p.x), Z(p.z)); }
    }
    if (s.blimp) {
      g.strokeStyle = '#ffcc33'; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(X(s.blimp.x0), Z(s.blimp.z0)); g.lineTo(X(s.blimp.x0 + s.blimp.dx * s.blimp.len), Z(s.blimp.z0 + s.blimp.dz * s.blimp.len)); g.stroke();
      g.setLineDash([]);
    }
    if (s.zone && s.zone.r < 3000) {
      const z = s.zone;
      // storm outside current circle
      g.save(); g.beginPath(); g.rect(0, 0, W, W); g.arc(X(z.cx), Z(z.cz), z.r * k, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(130, 50, 220, 0.35)'; g.fill(); g.restore();
      g.strokeStyle = '#d9a8ff'; g.lineWidth = 2; g.beginPath(); g.arc(X(z.cx), Z(z.cz), z.r * k, 0, 7); g.stroke();
      if (z.st === 0) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(X(z.tx), Z(z.tz), z.tr * k, 0, 7); g.stroke(); }
    }
    for (const v of s.vehicles || []) { // drivable vehicles: little rounded cars
      if (v.mine) continue;
      const len = (v.len || 3) * k * (big ? 1.6 : 1.3) + 4, wid = len * 0.55;
      g.save(); g.translate(X(v.x), Z(v.z)); g.rotate(-v.yaw);
      g.fillStyle = v.broken ? '#777' : '#ffffff'; g.strokeStyle = '#1d2026'; g.lineWidth = 1.5;
      g.beginPath(); g.roundRect(-wid / 2, -len / 2, wid, len, 2); g.fill(); g.stroke();
      g.fillStyle = '#e8412c'; g.fillRect(-wid / 2 + 1, -len / 2 + 1, wid - 2, len * 0.3);
      g.restore();
    }
    for (const m of s.mates || []) { g.fillStyle = '#3fa2ff'; g.beginPath(); g.arc(X(m.x), Z(m.z), big ? 6 : 4, 0, 7); g.fill(); }
    // me
    g.save(); g.translate(X(s.x), Z(s.z)); g.rotate(-s.yaw);
    g.fillStyle = '#ffcc33'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  zoneText(text) { $('zoneinfo').textContent = text; }
  counters(alive, kills) { $('alive').textContent = alive; $('kills').textContent = kills; }
  prompt(html) { $('prompt').innerHTML = html || ''; }
  centerMsg(text) { $('center-msg').innerHTML = text || ''; }

  hitmarker(kill, head) {
    const h = $('hitmarker');
    h.style.color = kill ? '#ff3b3b' : head ? '#ffd23f' : '#ffffff';
    h.style.transition = 'none'; h.style.opacity = 1;
    requestAnimationFrame(() => { h.style.transition = 'opacity .3s'; h.style.opacity = 0; });
  }
  damageNumber(x, y, amount, head) {
    const el = document.createElement('div');
    el.textContent = amount;
    if (head) el.className = 'head';
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    $('dmgnums').appendChild(el);
    requestAnimationFrame(() => { el.style.transform = 'translateY(-50px)'; el.style.opacity = 0; });
    setTimeout(() => el.remove(), 800);
  }
  // damage / storm flash; `amount` 0..1 scales how strong the red edge glow is
  flash(kind, amount = 1) {
    const v = $('vignette');
    v.className = kind === 'storm' ? 'storm' : '';
    v.style.transition = 'none'; v.style.opacity = Math.max(0.35, Math.min(1, amount));
    requestAnimationFrame(() => { v.style.transition = 'opacity .7s ease-out'; v.style.opacity = 0; });
  }
  // persistent pulsing red edges when health is low (0 = off, 1 = nearly out)
  lowHealth(k) {
    const el = $('lowhp');
    const on = k > 0;
    el.classList.toggle('on', on);
    el.style.setProperty('--k', on ? (0.35 + k * 0.65).toFixed(2) : '0');
  }

  // big center-screen callout ("DOUBLE TACKLE!", "10 PLAYERS LEFT"); queued so they never overlap
  callout(text, sub = '', kind = '') {
    this.calls = this.calls || [];
    this.calls.push({ text, sub, kind });
    if (!this.calling) this.nextCallout();
  }
  nextCallout() {
    const c = this.calls.shift();
    const el = $('callout');
    if (!c) { this.calling = false; return; }
    this.calling = true;
    el.className = '';
    el.innerHTML = `<div class="co-main">${c.text}</div>${c.sub ? `<div class="co-sub">${c.sub}</div>` : ''}`;
    void el.offsetWidth; // restart the animation
    el.className = `show ${c.kind}`;
    clearTimeout(this.calloutTimer);
    this.calloutTimer = setTimeout(() => { el.className = ''; setTimeout(() => this.nextCallout(), 250); }, 1900);
  }
  clearCallouts() { this.calls = []; this.calling = false; clearTimeout(this.calloutTimer); $('callout').className = ''; }

  // coach tips for new players; each tip id is shown once ever (remembered in localStorage)
  tip(id, html, ms = 7000) {
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem('fr_tips') || '{}'); } catch { /* blocked */ }
    if (seen[id] || this.tipsMuted) return false;
    seen[id] = 1;
    try { localStorage.setItem('fr_tips', JSON.stringify(seen)); } catch { /* blocked */ }
    this.tips = this.tips || [];
    this.tips.push({ html, ms });
    if (!this.tipping) this.nextTip();
    return true;
  }
  nextTip() {
    const t = this.tips.shift();
    const el = $('tip');
    if (!t) { this.tipping = false; el.classList.add('hidden'); return; }
    this.tipping = true;
    el.innerHTML = `<div class="tip-head">🏈 COACH TIP</div><div>${t.html}</div>`;
    el.classList.remove('hidden', 'out');
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => { el.classList.add('out'); this.tipTimer = setTimeout(() => this.nextTip(), 350); }, t.ms);
  }
  clearTips(mute = false) { this.tipsMuted = mute; this.tips = []; this.tipping = false; clearTimeout(this.tipTimer); $('tip').classList.add('hidden'); }
  fps(text) { const el = $('fps'); el.classList.toggle('hidden', text == null); if (text != null) el.textContent = text; }
  hurtFrom(angle) {
    const h = $('hurtdir');
    h.style.transform = `rotate(${angle}rad)`;
    h.style.transition = 'none'; h.style.opacity = 1;
    requestAnimationFrame(() => { h.style.transition = 'opacity .8s'; h.style.opacity = 0; });
  }
  useBar(left, total, label) {
    const b = $('usebar');
    if (!left) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.firstElementChild.style.width = `${100 * (1 - left / total)}%`;
    b.lastElementChild.textContent = label;
  }
}
