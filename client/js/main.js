// Locker Room (menu), squads, news, broadcasts, party pop-ups and starting matches.
import * as THREE from 'three';
import { generateMap } from '/shared/map.js';
import { SKIN_PRESETS, sanitizeSkin } from '/shared/skins.js';
import { createPlayer, animatePlayer, disposePlayer } from './models.js';
import { drawMapImage } from './world.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { initAudio, sfx, startPartyMusic } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
};

// ---------- profile ----------
const profile = store.get('fr_profile', {});
profile.name = profile.name || '';
profile.mode = profile.mode || 'nobuild';
profile.skin = sanitizeSkin(profile.skin || { preset: 'llamas', number: Math.floor(Math.random() * 99) + 1 });
const settings = { sens: store.get('fr_sens', 1) };
const stats = () => store.get('fr_stats', { wins: 0, kills: 0, matches: 0 });
const saveProfile = () => { store.set('fr_profile', profile); net.send({ t: 'hello', name: profile.name, skin: profile.skin }); };

// ---------- network ----------
const net = {
  ws: null, handlers: {}, queue: [],
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      $('menu-error').textContent = '';
      ws.send(JSON.stringify({ t: 'hello', name: profile.name, skin: profile.skin }));
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); (this.handlers[m.t] || (() => {}))(m); };
    ws.onclose = () => {
      if (game) { game.destroy(); game = null; showScreen('menu'); }
      $('menu-error').textContent = 'Lost connection to the server… reconnecting';
      setTimeout(() => this.connect(), 2000);
    };
  },
  send(obj) {
    const s = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s);
  },
  on(t, fn) { this.handlers[t] = fn; },
};

// ---------- shared things ----------
const map = generateMap();
const hud = new Hud(drawMapImage(map, 1000), map.pois);
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

let game = null, myId = null, currentRoom = null, partyInfo = null, info = { news: [], events: [] };

function showScreen(name) {
  for (const id of ['menu', 'lobby', 'loading']) $(id).classList.toggle('hidden', id !== name);
  previewRunning = name === 'menu';
  if (previewRunning) { requestAnimationFrame(previewLoop); renderStats(); }
}

// ---------- skin preview ----------
const pr = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: true, alpha: true });
pr.setPixelRatio(Math.min(devicePixelRatio, 2));
pr.setSize(360, 380, false);
pr.outputColorSpace = THREE.SRGBColorSpace;
const pScene = new THREE.Scene();
pScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.4));
const pl = new THREE.DirectionalLight(0xffffff, 1.5); pl.position.set(2, 3, 3); pScene.add(pl);
const pCam = new THREE.PerspectiveCamera(35, 360 / 380, 0.1, 50);
pCam.position.set(0, 1.25, 4.6); pCam.lookAt(0, 1.0, 0);
let pModel = null, previewRunning = true, previewEmote = 0, previewEmoteStart = 0;
function refreshPreview() {
  if (pModel) { pScene.remove(pModel); disposePlayer(pModel); }
  pModel = createPlayer(profile.skin);
  pModel.rotation.y = Math.PI;
  pScene.add(pModel);
  const preset = SKIN_PRESETS.find((p) => p.id === profile.skin.preset);
  $('skin-team').textContent = preset ? preset.team : '';
  $('c-jersey').value = profile.skin.jersey; $('c-accent').value = profile.skin.accent;
  $('c-helmet').value = profile.skin.helmet; $('c-number').value = profile.skin.number;
}
function previewLoop(ts) {
  if (!previewRunning) return;
  requestAnimationFrame(previewLoop);
  const t = ts / 1000;
  if (pModel) {
    pModel.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.6;
    if (!previewEmote || t - previewEmoteStart > 4) { previewEmote = 1 + Math.floor(Math.random() * 5); previewEmoteStart = t; }
    animatePlayer(pModel, { speed: 0, phase: 0, emote: previewEmote, emoteT: t - previewEmoteStart, t }, 1 / 60);
  }
  pr.render(pScene, pCam);
}

function unlocked(p) {
  if (!p.unlock) return true;
  const s = stats();
  return (!p.unlock.wins || (s.wins || 0) >= p.unlock.wins) && (!p.unlock.kills || (s.kills || 0) >= p.unlock.kills);
}
function renderSkins() {
  $('skins').innerHTML = SKIN_PRESETS.map((p) => {
    const ok = unlocked(p);
    const req = p.unlock ? (p.unlock.wins ? `${p.unlock.wins} win${p.unlock.wins > 1 ? 's' : ''}` : `${p.unlock.kills} elims`) : '';
    return `<button data-id="${p.id}" class="${profile.skin.preset === p.id ? 'sel' : ''} ${ok ? '' : 'locked'}" title="${esc(p.team)}${ok ? '' : ' — unlock with ' + req}"
      style="background:linear-gradient(135deg, ${p.jersey} 0 55%, ${p.accent} 55% 70%, ${p.helmet} 70%)">${ok ? '' : `<span class="lock">🔒</span>`}<span style="position:absolute;bottom:2px;left:0;right:0">${esc(p.team.split(' ')[1] || p.team)}</span></button>`;
  }).join('');
}
$('skins').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const p = SKIN_PRESETS.find((x) => x.id === b.dataset.id);
  if (!unlocked(p)) { $('menu-error').textContent = `🔒 ${p.team} unlocks with ${p.unlock.wins ? p.unlock.wins + ' win(s)' : p.unlock.kills + ' eliminations'}!`; return; }
  profile.skin = sanitizeSkin({ ...p, preset: p.id, number: profile.skin.number });
  saveProfile(); renderSkins(); refreshPreview();
};
for (const k of ['jersey', 'accent', 'helmet']) {
  $(`c-${k}`).oninput = (e) => { profile.skin[k] = e.target.value; if (k === 'helmet') profile.skin.stripe = profile.skin.accent; refreshPreview(); };
  $(`c-${k}`).onchange = saveProfile;
}
$('c-number').onchange = (e) => { profile.skin = sanitizeSkin({ ...profile.skin, number: e.target.value }); saveProfile(); refreshPreview(); };

function renderStats() {
  const s = stats();
  $('stats').innerHTML = `🏆 Wins: <b>${s.wins || 0}</b> &nbsp; 🏈 Eliminations: <b>${s.kills || 0}</b> &nbsp; 🎮 Matches: <b>${s.matches || 0}</b>`;
  renderSkins();
}

// ---------- menu controls ----------
$('name').value = profile.name;
$('name').onchange = () => { profile.name = $('name').value.trim().slice(0, 16); saveProfile(); };
$('sens').value = settings.sens;
$('sens').oninput = () => { settings.sens = +$('sens').value; store.set('fr_sens', settings.sens); };
const setMode = (m) => { profile.mode = m; [...$('mode').children].forEach((b) => b.classList.toggle('on', b.dataset.v === m)); };
setMode(profile.mode);
$('mode').onclick = (e) => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.v); saveProfile(); } };

function join(extra) {
  initAudio();
  profile.name = $('name').value.trim().slice(0, 16) || `Rookie${Math.floor(Math.random() * 900 + 100)}`;
  $('name').value = profile.name;
  saveProfile();
  $('menu-error').textContent = '';
  net.send({ t: 'join', name: profile.name, skin: profile.skin, mode: profile.mode, ...extra });
}
$('quick').onclick = () => join({});
$('create').onclick = () => join({ create: true, difficulty: $('difficulty').value });
$('join').onclick = () => { const c = $('code').value.trim().toUpperCase(); if (c.length === 4) join({ room: c }); else $('menu-error').textContent = 'Room codes have 4 letters.'; };
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('code').value = urlRoom.toUpperCase();
const urlSquad = new URLSearchParams(location.search).get('squad');

// ---------- squads ----------
$('party-create').onclick = () => { initAudio(); saveProfile(); net.send({ t: 'party_create' }); };
$('party-join').onclick = () => { initAudio(); saveProfile(); net.send({ t: 'party_join', code: $('party-code').value.trim().toUpperCase() }); };
$('party-leave').onclick = () => net.send({ t: 'party_leave' });
if (urlSquad) setTimeout(() => net.send({ t: 'party_join', code: urlSquad.toUpperCase() }), 800);
net.on('party', (m) => {
  partyInfo = m.code ? m : null;
  $('party-none').classList.toggle('hidden', !!partyInfo);
  $('party-on').classList.toggle('hidden', !partyInfo);
  if (!partyInfo) return;
  $('party-code-show').textContent = m.code;
  $('party-members').innerHTML = m.members.map((x) => `<li style="color:${x.skin.jersey}"><span style="color:#fff">${esc(x.name)}${x.name === m.leader ? ' 👑' : ''}${x.busy ? ' <small>(in a match)</small>' : ''}</span></li>`).join('');
  $('party-note').textContent = m.youLead ? 'You are the leader: press Quick Play or Create Room and your squad comes with you!' : `Waiting for ${m.leader} to start…`;
});

// ---------- lobby ----------
net.on('welcome', (m) => {
  myId = m.id; currentRoom = m;
  $('lobby-title').textContent = m.kind === 'partyRoyale' ? `🎉 ${m.title || 'Party Royale'}` : m.kind === 'island' ? '🎉 Party Island' : m.isPublic ? 'Quick Play Lobby' : 'Private Room';
  $('lobby-code-box').classList.toggle('hidden', m.isPublic);
  $('lobby-code').textContent = m.code;
  showScreen(m.kind === 'island' ? 'loading' : 'lobby');
});
net.on('lobby', (m) => {
  $('lobby-players').innerHTML = m.players.map((p) => `<li>🏈 ${esc(p.name)}${p.id === m.host ? ' 👑' : ''}${p.id === myId ? ' (you)' : ''}</li>`).join('');
  const isHost = m.host === myId && !m.isPublic;
  $('lobby-start').classList.toggle('hidden', !isHost);
  const mode = m.mode === 'build' ? 'Build mode' : 'No-Build mode';
  $('lobby-info').innerHTML = `${mode} · ${m.players.length} player${m.players.length > 1 ? 's' : ''} · bots fill the rest up to 75<br>` +
    (m.countdown != null ? `<b>Match starts in ${m.countdown}s</b>` : isHost ? 'Share the code with friends, then press START!' : 'Waiting for the host to start…');
});
$('lobby-start').onclick = () => net.send({ t: 'start' });
$('lobby-leave').onclick = () => { net.send({ t: 'leave' }); showScreen('menu'); };
$('copy-link').onclick = () => {
  const link = `${location.origin}/?room=${currentRoom.code}`;
  navigator.clipboard?.writeText(link).then(() => { $('copy-link').textContent = 'Copied! ✅'; setTimeout(() => { $('copy-link').textContent = 'Copy invite link'; }, 1500); });
};

// ---------- match ----------
net.on('start', (m) => {
  showScreen('loading');
  setTimeout(() => {
    if (game) game.destroy();
    for (const id of ['menu', 'lobby', 'loading']) $(id).classList.add('hidden');
    previewRunning = false;
    game = new Game({
      renderer, map, hud, net, myId, mode: currentRoom.mode, kind: currentRoom.kind, mySkin: profile.skin, settings,
      onLeave: () => { game = null; showScreen('menu'); },
    });
    game.start(m);
    renderer.domElement.requestPointerLock?.();
  }, 30);
});
net.on('s', (m) => game && game.onSnapshot(m));
net.on('end', (m) => game && game.onEnd(m));
net.on('closed', () => {
  if (game) { game.destroy(); game = null; }
  showScreen('menu');
});
net.on('error', (m) => {
  $('menu-error').textContent = m.msg;
  if (game) hud.toast(m.msg);
  if (!game && !$('lobby').classList.contains('hidden')) showScreen('menu');
});

// ---------- news & scheduled events ----------
net.on('info', (m) => { info = m; renderNews(); });
function renderNews() {
  $('news').innerHTML = info.news.map((n) => `<div class="news-item"><b>${esc(n.title)}</b>${esc(n.body)}<br><small>${new Date(n.date).toLocaleDateString()}</small></div>`).join('') || '<small>No updates yet.</small>';
  renderEvents();
}
function renderEvents() {
  const now = Date.now();
  $('events').innerHTML = info.events.filter((e) => e.time > now - 30000).map((e) => {
    const s = Math.max(0, Math.floor((e.time - now) / 1000));
    const cd = s > 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    return `<div class="event-item">🎉 ${esc(e.title)}<br><small>${e.kind === 'island' ? 'Party Island' : 'Party Royale'} · ${new Date(e.time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small><div class="cd">${s ? cd : 'NOW!'}</div></div>`;
  }).join('');
}
setInterval(renderEvents, 1000);

// ---------- broadcasts ----------
let bannerTimer = 0;
net.on('bc', (m) => {
  const b = $('banner');
  b.className = m.style || 'info';
  b.textContent = (m.style === 'alert' ? '⚠️ ' : m.style === 'hype' ? '🔥 ' : '📢 ') + m.text;
  b.classList.remove('hidden');
  sfx.message();
  if (m.style === 'hype') confetti(2500);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), 8000);
});

// ---------- GLOBAL PARTY ----------
let partyCode = null;
net.on('party_time', (m) => {
  partyCode = m.code;
  initAudio();
  confetti(7000);
  startPartyMusic(30);
  sfx.whistleBlow();
  $('party-title').textContent = m.title || 'GLOBAL PARTY!';
  $('party-desc').innerHTML = m.kind === 'island'
    ? '🏝️ <b>Party Island</b> is open! No fighting. Hang out on the Mega Dome field, dance and launch footballs with everyone online.'
    : '🏈 <b>Party Royale</b> is starting! Double loot everywhere. Everyone online is invited!'
    + (game ? '<br><small>(Joining will leave your current match.)</small>' : '');
  $('party-pop').classList.remove('hidden');
  document.exitPointerLock?.();
});
$('party-go').onclick = () => {
  $('party-pop').classList.add('hidden');
  if (game) game.leave();
  else if (!$('lobby').classList.contains('hidden')) net.send({ t: 'leave' });
  join({ room: partyCode });
};
$('party-no').onclick = () => $('party-pop').classList.add('hidden');

// ---------- confetti overlay ----------
const cc = $('confetti'), cg = cc.getContext('2d');
let bits = [], confettiUntil = 0, confettiOn = false;
function confetti(ms) {
  confettiUntil = performance.now() + ms;
  if (!confettiOn) { confettiOn = true; requestAnimationFrame(confettiLoop); }
}
function confettiLoop(t) {
  cc.width = innerWidth; cc.height = innerHeight;
  if (t < confettiUntil) for (let i = 0; i < 8; i++) bits.push({ x: Math.random() * innerWidth, y: -10, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6, c: `hsl(${Math.random() * 360},95%,60%)`, s: 6 + Math.random() * 6 });
  bits = bits.filter((b) => b.y < innerHeight + 20);
  for (const b of bits) {
    b.x += b.vx; b.y += b.vy; b.r += 0.1;
    cg.save(); cg.translate(b.x, b.y); cg.rotate(b.r); cg.fillStyle = b.c; cg.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); cg.restore();
  }
  if (bits.length || t < confettiUntil) requestAnimationFrame(confettiLoop);
  else { confettiOn = false; cg.clearRect(0, 0, cc.width, cc.height); }
}

// debug hook for automated tests
window.__fr = { get game() { return game; } };

// ---------- start ----------
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('touch-warning').classList.remove('hidden');
renderStats();
refreshPreview();
showScreen('menu');
net.connect();
