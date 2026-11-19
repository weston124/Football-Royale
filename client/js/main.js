// Locker Room (menu), squads, news, broadcasts, party pop-ups and starting matches.
import * as THREE from 'three';
import { generateMap } from '/shared/map.js';
import { SKIN_PRESETS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, EMOTES, SHOP, sanitizeSkin, canUseSkin, canUseEmote } from '/shared/skins.js';
import { RARITIES } from '/shared/weapons.js';
import { createPlayer, animatePlayer, disposePlayer, setupEnvironment, loadHuman, createFootball } from './models.js';

try { await loadHuman(); } catch (e) { console.warn('Realistic model failed to load, using simple players', e); }
import { drawMapImage } from './world.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { createMenuScene } from './menuScene.js';
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
profile.skin = sanitizeSkin(profile.skin || { preset: 'thunder', number: Math.floor(Math.random() * 99) + 1 });
const settings = { sens: store.get('fr_sens', 1) };
let account = { bucks: 0, owned: [], stats: { wins: 0, kills: 0, matches: 0 } }; // from the server
const stats = () => account.stats;
const hello = () => ({ t: 'hello', token: store.get('fr_session', null), skin: profile.skin });
const saveProfile = () => { store.set('fr_profile', profile); net.send(hello()); };

// ---------- network ----------
const net = {
  ws: null, handlers: {}, queue: [],
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      $('menu-error').textContent = '';
      ws.send(JSON.stringify(hello()));
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

// stadium home-screen background (runs whenever you're not in a match)
const menuScene = createMenuScene();
let lastBg = performance.now();
function bgLoop(t) {
  requestAnimationFrame(bgLoop);
  const dt = Math.min(0.1, (t - lastBg) / 1000); lastBg = t;
  if (game) return;
  menuScene.update(dt);
  renderer.autoClear = true;
  renderer.render(menuScene.scene, menuScene.camera);
}
requestAnimationFrame(bgLoop);

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
setupEnvironment(pr, pScene, 0.7);
pScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const rim = new THREE.DirectionalLight(0x9fd0ff, 2.2); rim.position.set(-3, 3, -3); pScene.add(rim);
const pl = new THREE.DirectionalLight(0xfff4e6, 2.4); pl.position.set(2, 4, 3); pScene.add(pl);
pr.shadowMap.enabled = true; pr.shadowMap.type = THREE.PCFSoftShadowMap;
pl.castShadow = true; pl.shadow.mapSize.set(2048, 2048); pl.shadow.bias = -0.0004; pl.shadow.normalBias = 0.02;
Object.assign(pl.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.2, near: 0.5, far: 10 });
const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.35 }));
floorShadow.rotation.x = -Math.PI / 2; floorShadow.receiveShadow = true; pScene.add(floorShadow);
const pCam = new THREE.PerspectiveCamera(35, 360 / 380, 0.1, 50);
pCam.position.set(0, 1.25, 3.7); pCam.lookAt(0, 1.05, 0);
let pModel = null, previewRunning = true, previewEmote = 0, previewEmoteStart = 0;
function refreshPreview() {
  if (pModel) { pScene.remove(pModel); disposePlayer(pModel); }
  pModel = createPlayer(profile.skin);
  pModel.rotation.y = Math.PI;
  const ball = createFootball(0.23); ball.rotation.set(0.3, 0, 0.5); ball.position.set(0.01, 0.02, -0.03);
  pModel.userData.parts.hand.add(ball); pModel.userData.ball = ball;
  pScene.add(pModel);
  const preset = SKIN_PRESETS.find((p) => p.id === profile.skin.preset);
  $('skin-team').textContent = preset ? preset.team : '';
  $('c-jersey').value = profile.skin.jersey; $('c-accent').value = profile.skin.accent;
  $('c-helmet').value = profile.skin.helmet; $('c-pants').value = profile.skin.pants; $('c-number').value = profile.skin.number;
  for (const [id, key] of [['tones', 'tone'], ['hairs', 'hair'], ['eyes', 'eyes']]) [...$(id).children].forEach((b) => b.classList.toggle('sel', b.dataset.t === profile.skin[key]));
  [...$('body-pick').children].forEach((b) => b.classList.toggle('on', b.dataset.v === profile.skin.body));
  $('hair-style').value = profile.skin.hairStyle; $('smile').checked = profile.skin.smile !== false; $('helmet-on').checked = profile.skin.helmetOn !== false;
}
function previewLoop(ts) {
  if (!previewRunning) return;
  requestAnimationFrame(previewLoop);
  const t = ts / 1000;
  if (pModel) {
    // stand in the hero pose; show off an emote every so often
    if (!previewEmoteStart) previewEmoteStart = t;
    const since = t - previewEmoteStart;
    if (previewEmote && since > 4) { previewEmote = 0; previewEmoteStart = t; }
    else if (!previewEmote && since > 10) { previewEmote = 1 + Math.floor(Math.random() * 5); previewEmoteStart = t; }
    pModel.rotation.y = Math.PI + (previewEmote ? 0 : 0.28 + Math.sin(t * 0.5) * 0.12);
    pModel.userData.ball.visible = false;
    animatePlayer(pModel, { speed: 0, phase: 0, hero: !previewEmote, emote: previewEmote, emoteT: t - previewEmoteStart, t }, 1 / 60);
  }
  pr.render(pScene, pCam);
}

function unlocked(p) { return canUseSkin(p, account); }
function renderSkins() {
  $('skins').innerHTML = SKIN_PRESETS.filter((p) => !p.price || unlocked(p)).map((p) => {
    const ok = unlocked(p);
    const req = p.unlock ? (p.unlock.wins ? `${p.unlock.wins} win${p.unlock.wins > 1 ? 's' : ''}` : `${p.unlock.kills} elims`) : '';
    return `<button data-id="${p.id}" class="${profile.skin.preset === p.id ? 'sel' : ''} ${ok ? '' : 'locked'}" title="${esc(p.team)}${ok ? '' : ' — unlock with ' + req}"
      style="background:linear-gradient(135deg, ${p.jersey} 0 55%, ${p.accent} 55% 70%, ${p.helmet} 70%)">${ok ? '' : `<span class="lock">🔒</span>`}<span style="position:absolute;bottom:2px;left:0;right:0">${esc(p.team.split(' ').slice(-1)[0])}</span></button>`;
  }).join('');
}
$('skins').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const p = SKIN_PRESETS.find((x) => x.id === b.dataset.id);
  if (!unlocked(p)) { if (p.price) return openShop(); $('menu-error').textContent = `🔒 ${p.team} unlocks with ${p.unlock.wins ? p.unlock.wins + ' win(s)' : p.unlock.kills + ' eliminations'}!`; return; }
  profile.skin = sanitizeSkin({ ...p, preset: p.id, number: profile.skin.number, tone: profile.skin.tone, hair: profile.skin.hair, hairStyle: profile.skin.hairStyle, eyes: profile.skin.eyes, smile: profile.skin.smile, helmetOn: profile.skin.helmetOn });
  saveProfile(); renderSkins(); refreshPreview();
};
for (const k of ['jersey', 'accent', 'helmet', 'pants']) {
  $(`c-${k}`).oninput = (e) => { profile.skin[k] = e.target.value; if (k === 'helmet') profile.skin.stripe = profile.skin.accent; refreshPreview(); };
  $(`c-${k}`).onchange = saveProfile;
}
// 📸 poster photo of your player on a purple studio background
$('photo').onclick = () => {
  const W = 1080, H = 1440;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  const bg = g.createRadialGradient(W / 2, H * 0.35, 50, W / 2, H * 0.4, H * 0.8);
  bg.addColorStop(0, '#8a5ee0'); bg.addColorStop(0.5, '#5b34b8'); bg.addColorStop(1, '#1d0d45');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // render the player big and sharp
  const keep = { pr: pr.getPixelRatio(), aspect: pCam.aspect, pos: pCam.position.clone() };
  pr.setPixelRatio(1); pr.setSize(W, H, false);
  pCam.aspect = W / H; pCam.position.set(0, 1.05, 3.35); pCam.lookAt(0, 0.98, 0); pCam.updateProjectionMatrix();
  pr.render(pScene, pCam);
  g.drawImage(pr.domElement, 0, 0, W, H);
  pr.setPixelRatio(keep.pr); pr.setSize(360, 380, false);
  pCam.aspect = keep.aspect; pCam.position.copy(keep.pos); pCam.lookAt(0, 1.05, 0); pCam.updateProjectionMatrix();
  // name plate
  const preset = SKIN_PRESETS.find((p) => p.id === profile.skin.preset);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, H - 210, W, 210);
  g.font = 'italic 900 92px "Arial Black", Impact, sans-serif'; g.fillStyle = '#ffffff'; g.textAlign = 'left';
  g.fillText($('me-name').textContent.replace(' 👑', ''), 60, H - 105);
  g.font = 'bold 36px "Trebuchet MS", sans-serif'; g.fillStyle = '#ffcc33';
  g.fillText(`#${profile.skin.number}  ·  ${preset ? preset.team.toUpperCase() : ''}  ·  FOOTBALL ROYALE`, 64, H - 45);
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'my-football-royale-player.png';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
};

// character creator: skin tone, hair, eyes, smile
const swatchRow = (id, list, key) => {
  $(id).innerHTML = list.map((t) => `<button data-t="${t}" style="background:${t}"></button>`).join('');
  $(id).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    profile.skin[key] = b.dataset.t; saveProfile(); refreshPreview();
  };
};
swatchRow('tones', SKIN_TONES, 'tone');
swatchRow('hairs', HAIR_COLORS, 'hair');
swatchRow('eyes', EYE_COLORS, 'eyes');
$('body-pick').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  profile.skin.body = b.dataset.v; saveProfile(); refreshPreview();
};
$('hair-style').onchange = () => { profile.skin.hairStyle = $('hair-style').value; saveProfile(); refreshPreview(); };
$('smile').onchange = () => { profile.skin.smile = $('smile').checked; saveProfile(); refreshPreview(); };
$('helmet-on').onchange = () => { profile.skin.helmetOn = $('helmet-on').checked; saveProfile(); refreshPreview(); };
$('c-number').onchange = (e) => { profile.skin = sanitizeSkin({ ...profile.skin, number: e.target.value }); saveProfile(); refreshPreview(); };

function renderStats() {
  const s = stats();
  $('stats').innerHTML = `🏆 Wins: <b>${s.wins || 0}</b> &nbsp; 🏈 Eliminations: <b>${s.kills || 0}</b> &nbsp; 🎮 Matches: <b>${s.matches || 0}</b>`;
  renderSkins();
}

// ---------- menu controls ----------
// ---------- sign in / sign up ----------
let authMode = 'login', signedIn = false;
function setAuthMode(m) {
  authMode = m;
  $('auth').className = `screen mode-${m}`;
  [...$('auth-tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  $('a-go').textContent = m === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
  $('a-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-error').textContent = '';
}
$('auth-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setAuthMode(b.dataset.v); };
$('auth-form').onsubmit = (e) => {
  e.preventDefault();
  initAudio();
  $('auth-error').textContent = '';
  if (authMode === 'login') net.send({ t: 'login', login: $('a-user').value, password: $('a-pass').value });
  else net.send({ t: 'signup', email: $('a-email').value, username: $('a-user').value, password: $('a-pass').value, ageOk: $('a-age').checked });
};
net.on('auth_needed', () => {
  signedIn = false;
  store.set('fr_session', null);
  if (game) { game.destroy(); game = null; }
  for (const id of ['menu', 'lobby', 'loading', 'shop']) $(id).classList.add('hidden');
  setAuthMode(authMode);
  $('auth').classList.remove('hidden');
});
net.on('auth', (m) => {
  store.set('fr_session', m.token);
  $('a-pass').value = '';
  $('auth').classList.add('hidden');
  signedIn = true;
  showScreen('menu');
  net.send(hello());
});
net.on('auth_error', (m) => { $('auth-error').textContent = m.msg; });
$('logout').onclick = () => { net.send({ t: 'logout' }); $('admin-menu').classList.add('hidden'); };

// ---------- in-game admin drop-down ----------
$('admin-toggle').onclick = () => {
  const open = $('admin-drop').classList.toggle('hidden') === false;
  if (open) document.exitPointerLock?.();
};
$('admin-drop').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'royale' || act === 'island') net.send({ t: 'admin', action: 'party', kind: act, title: $('ad-title').value });
  else if (act === 'endparty') { if (confirm('End all parties?')) net.send({ t: 'admin', action: 'endparty' }); }
  else if (act === 'broadcast') { net.send({ t: 'admin', action: 'broadcast', text: $('ad-msg').value, style: $('ad-style').value }); $('ad-msg').value = ''; }
  else if (act === 'gift') net.send({ t: 'admin', action: 'gift', name: $('ad-user').value.trim(), amount: +$('ad-amt').value });
  else if (act === 'stats') net.send({ t: 'admin', action: 'stats' });
};
net.on('admin_ok', (m) => { $('ad-status').textContent = m.msg; $('ad-status').className = m.ok ? '' : 'err'; });
$('sens').value = settings.sens;
$('sens').oninput = () => { settings.sens = +$('sens').value; store.set('fr_sens', settings.sens); };
const setMode = (m) => { profile.mode = m; [...$('mode').children].forEach((b) => b.classList.toggle('on', b.dataset.v === m)); };
setMode(profile.mode);
$('mode').onclick = (e) => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.v); saveProfile(); } };

function join(extra) {
  initAudio();
  saveProfile();
  $('menu-error').textContent = '';
  net.send({ t: 'join', skin: profile.skin, mode: profile.mode, ...extra });
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
      emotes: EMOTES.filter((e) => canUseEmote(e.id, account)),
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
  if (!$('shop').classList.contains('hidden')) $('shop-msg').textContent = m.msg;
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

// ---------- Ball Bucks & the Longhorn Item Shop ----------
net.on('profile', (m) => {
  $('me-name').textContent = m.username + (m.isAdmin ? ' 👑' : '');
  $('admin-menu').classList.toggle('hidden', !m.isAdmin);
  if (!signedIn) { signedIn = true; $('auth').classList.add('hidden'); if (!game && $('lobby').classList.contains('hidden')) showScreen('menu'); }
  account = { bucks: m.bucks, owned: m.owned, stats: m.stats };
  $('bucks').textContent = m.bucks.toLocaleString();
  $('shop-bucks').textContent = m.bucks.toLocaleString();
  // if the server swapped us off a locked outfit, follow it
  if (!canUseSkin(SKIN_PRESETS.find((p) => p.id === profile.skin.preset), account)) {
    profile.skin = sanitizeSkin(profile.skin, account); store.set('fr_profile', profile); refreshPreview();
  }
  renderStats();
  if (!$('shop').classList.contains('hidden')) renderShop();
});
let rewardTimer = 0;
net.on('reward', (m) => {
  const el = $('reward');
  el.textContent = `+${m.bucks} Ball Bucks · ${m.why}`;
  el.classList.remove('hidden');
  clearTimeout(rewardTimer);
  rewardTimer = setTimeout(() => el.classList.add('hidden'), 2500);
});
net.on('bought', (m) => {
  const item = SHOP.find((i) => i.id === m.item);
  sfx.chest(); confetti(1800);
  $('shop-msg').textContent = '';
  if (item && item.kind === 'skin') {
    const p = SKIN_PRESETS.find((x) => x.id === item.id);
    profile.skin = sanitizeSkin({ ...p, preset: p.id, number: profile.skin.number, tone: profile.skin.tone, hair: profile.skin.hair, hairStyle: profile.skin.hairStyle, eyes: profile.skin.eyes, smile: profile.skin.smile, helmetOn: profile.skin.helmetOn });
    saveProfile(); refreshPreview();
  }
});
const artCache = new Map();
function itemArt(item) {
  if (artCache.has(item.id)) return artCache.get(item.id);
  const skin = item.kind === 'skin'
    ? sanitizeSkin({ ...SKIN_PRESETS.find((p) => p.id === item.id), preset: item.id, number: 1 + (item.price % 97), tone: profile.skin.tone })
    : { ...profile.skin, horns: profile.skin.horns || '#f3ead2' };
  const m = createPlayer(skin);
  m.rotation.y = Math.PI + 0.35;
  animatePlayer(m, { speed: 0, phase: 0, emote: item.emote || 3, emoteT: item.emote === 8 ? 2.4 : 0.55, t: 1 }, 1 / 60);
  const was = pModel; if (pModel) pModel.visible = false;
  pScene.add(m);
  pr.render(pScene, pCam);
  const url = pr.domElement.toDataURL();
  pScene.remove(m); disposePlayer(m);
  if (was) was.visible = true;
  artCache.set(item.id, url);
  return url;
}
function renderShop() {
  $('shop-items').innerHTML = SHOP.map((item) => {
    const r = RARITIES[item.rarity || 0];
    const owned = account.owned.includes(item.id);
    const afford = account.bucks >= item.price;
    return `<div class="card" style="--rc:${r.color}">
      <div class="art"><img src="${itemArt(item)}" alt=""></div>
      <div class="info">
        <div class="nm">${esc(item.name)}</div>
        <div class="meta">${r.name} ${item.kind === 'skin' ? 'Outfit' : 'Emote'}</div>
        <button data-buy="${item.id}" class="${owned ? 'owned' : afford ? '' : 'cant'}">${owned ? '✅ Owned' : `🏈 ${item.price.toLocaleString()}`}</button>
      </div></div>`;
  }).join('');
}
function openShop() {
  initAudio();
  $('shop-msg').textContent = '';
  $('shop').classList.remove('hidden');
  renderShop();
}
$('open-shop').onclick = openShop;
$('close-shop').onclick = () => { $('shop').classList.add('hidden'); renderSkins(); };
$('shop-items').onclick = (e) => {
  const b = e.target.closest('button[data-buy]'); if (!b) return;
  const item = SHOP.find((i) => i.id === b.dataset.buy);
  if (account.owned.includes(item.id)) {
    if (item.kind === 'skin') { $('close-shop').click(); const p = SKIN_PRESETS.find((x) => x.id === item.id); profile.skin = sanitizeSkin({ ...p, preset: p.id, number: profile.skin.number, tone: profile.skin.tone, hair: profile.skin.hair, hairStyle: profile.skin.hairStyle, eyes: profile.skin.eyes, smile: profile.skin.smile, helmetOn: profile.skin.helmetOn }); saveProfile(); refreshPreview(); renderSkins(); }
    return;
  }
  if (account.bucks < item.price) { $('shop-msg').textContent = `You need ${(item.price - account.bucks).toLocaleString()} more Ball Bucks. Keep playing to earn more!`; return; }
  if (confirm(`Buy ${item.name} for ${item.price.toLocaleString()} Ball Bucks?`)) net.send({ t: 'buy', item: item.id });
};

// debug hook for automated tests
window.__fr = { get game() { return game; } };

// ---------- start ----------
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('touch-warning').classList.remove('hidden');
renderStats();
refreshPreview();
showScreen('loading');
net.connect();
