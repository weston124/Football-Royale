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
    $('hotbar').innerHTML = slots.map((it, i) => {
      if (!it) return `<div class="slot ${me.slot === i ? 'sel' : ''}"><span class="key">${i + 1}</span></div>`;
      const col = it.w ? RARITIES[it.r || 0].color : it.c ? RARITIES[CONSUMABLES[it.c].rarity].color : '#888';
      const cnt = it.c ? it.n : it.w === 'whistle' ? it.ammo : '';
      return `<div class="slot ${me.slot === i && !buildKind ? 'sel' : ''}" style="border-color:${col};background:${col}33">
        <span class="key">${i + 1}</span><span class="cnt">${cnt}</span><span class="ic">${ICON[it.w || it.c] || '❔'}</span>${itemName(it)}</div>`;
    }).join('');
    const cur = slots[me.slot];
    if (buildKind) $('ammo').textContent = `BUILD: ${buildKind.toUpperCase()}`;
    else if (cur && cur.w && WEAPONS[cur.w].mag) $('ammo').textContent = `${cur.ammo} / ${WEAPONS[cur.w].mag}`;
    else $('ammo').textContent = '';
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
  flash(kind) {
    const v = $('vignette');
    v.className = kind === 'storm' ? 'storm' : '';
    v.style.transition = 'none'; v.style.opacity = 1;
    requestAnimationFrame(() => { v.style.transition = 'opacity .6s'; v.style.opacity = 0; });
  }
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
