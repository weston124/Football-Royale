// Locker Room (menu), squads, news, broadcasts, party pop-ups and starting matches.
import * as THREE from 'three';
import { generateMap } from '/shared/map.js';
import { SKIN_PRESETS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, EMOTES, SHOP, sanitizeSkin, canUseSkin, canUseEmote, isNewItem } from '/shared/skins.js';
import { dailyShop, utcDateKey, anyShopItem, dailyItem, dailyIds } from '/shared/shop.js';
import { RARITIES, WEAPONS, GUN_IDS } from '/shared/weapons.js';
import { createPlayer, animatePlayer, disposePlayer, setupEnvironment, loadHuman, createFootball } from './models.js';

try { await loadHuman(); } catch (e) { console.warn('Realistic model failed to load, using simple players', e); }
import { drawMapImage } from './world.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { createMenuScene } from './menuScene.js';
import { initAudio, sfx, startPartyMusic, setVolumes, startMenuMusic, stopMenuMusic } from './audio.js';
import { IS_TOUCH, initTouchEnvironment, pixelRatioFor } from './touch.js';

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
// player settings (the Game reads this same object live, so changes apply mid-match)
const settings = Object.assign(
  { sens: store.get('fr_sens', 1), fov: 75, invertY: false, showFps: false, master: 0.8, music: 0.5, sfx: 0.9, menuMusic: true },
  store.get('fr_settings', {}),
);
const saveSettings = () => { store.set('fr_settings', settings); store.set('fr_sens', settings.sens); };
setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
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
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatioFor(1.5)); // phones/tablets render fewer pixels
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
  const wasRunning = previewRunning;
  previewRunning = name === 'menu';
  if (previewRunning && !wasRunning) requestAnimationFrame(previewLoop);
  if (previewRunning) renderStats();
  updateMenuMusic();
}

// ---------- Locker Room music (never before the player has clicked or pressed a key) ----------
let userGestured = false;
function updateMenuMusic() {
  const inMenus = !game;
  if (inMenus && settings.menuMusic && userGestured) startMenuMusic(); else stopMenuMusic();
  $('music-toggle').classList.toggle('off', !settings.menuMusic);
  $('music-toggle').textContent = settings.menuMusic ? '🎵' : '🔇';
}
const firstGesture = () => {
  if (userGestured) return;
  userGestured = true;
  initAudio();
  setTimeout(updateMenuMusic, 50);
  removeEventListener('pointerdown', firstGesture); removeEventListener('keydown', firstGesture);
};
addEventListener('pointerdown', firstGesture); addEventListener('keydown', firstGesture);
$('music-toggle').onclick = () => { settings.menuMusic = !settings.menuMusic; saveSettings(); syncSettingsUI(); updateMenuMusic(); };

// ---------- skin preview ----------
const pr = new THREE.WebGLRenderer({ canvas: $('preview'), antialias: true, alpha: true });
pr.setPixelRatio(pixelRatioFor(2));
pr.setSize(360, 380, false);
pr.outputColorSpace = THREE.SRGBColorSpace;
const pScene = new THREE.Scene();
setupEnvironment(pr, pScene, 0.7);
pScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const rim = new THREE.DirectionalLight(0x9fd0ff, 2.2); rim.position.set(-3, 3, -3); pScene.add(rim);
const pl = new THREE.DirectionalLight(0xfff4e6, 2.4); pl.position.set(2, 4, 3); pScene.add(pl);
pr.shadowMap.enabled = true; pr.shadowMap.type = THREE.PCFSoftShadowMap;
pl.castShadow = true; pl.shadow.mapSize.set(IS_TOUCH ? 512 : 2048, IS_TOUCH ? 512 : 2048); pl.shadow.bias = -0.0004; pl.shadow.normalBias = 0.02;
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
  if (shopPreview) { animateShopPreview(t); pr.render(pScene, pCam); return; }
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
// 📸 poster of your player on a purple studio background (also used for sharing match results)
function makePoster(result) {
  const W = 1080, H = 1440;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  const win = result && result.win;
  const bg = g.createRadialGradient(W / 2, H * 0.35, 50, W / 2, H * 0.4, H * 0.8);
  if (win) { bg.addColorStop(0, '#ffd75e'); bg.addColorStop(0.45, '#e08a1e'); bg.addColorStop(1, '#3a1606'); }
  else { bg.addColorStop(0, '#8a5ee0'); bg.addColorStop(0.5, '#5b34b8'); bg.addColorStop(1, '#1d0d45'); }
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  if (result) { // stadium light rays behind the player
    g.save(); g.translate(W / 2, H * 0.42); g.globalAlpha = 0.12; g.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(-60, -1100); g.lineTo(60, -1100); g.fill(); }
    g.restore();
  }
  // render the player big and sharp (pose them like the menu preview)
  const keep = { pr: pr.getPixelRatio(), aspect: pCam.aspect, pos: pCam.position.clone() };
  pr.setPixelRatio(1); pr.setSize(W, H, false);
  pCam.aspect = W / H; pCam.position.set(0, 1.05, result ? 5.2 : 3.35); pCam.lookAt(0, result ? 1.05 : 0.98, 0); pCam.updateProjectionMatrix();
  if (pModel) { pModel.rotation.y = Math.PI + 0.3; pModel.userData.ball.visible = false; animatePlayer(pModel, { speed: 0, phase: 0, hero: true, emote: 0, emoteT: 0, t: 1 }, 1 / 60); }
  pr.render(pScene, pCam);
  g.drawImage(pr.domElement, 0, 0, W, H);
  pr.setPixelRatio(keep.pr); pr.setSize(360, 380, false);
  pCam.aspect = keep.aspect; pCam.position.copy(keep.pos); pCam.lookAt(0, 1.05, 0); pCam.updateProjectionMatrix();
  const name = $('me-name').textContent.replace(' 👑', '');
  const preset = SKIN_PRESETS.find((p) => p.id === profile.skin.preset);
  g.textAlign = 'center';
  if (result) {
    // big result headline at the top
    const head = win ? '#1 VICTORY' : `#${result.place || '?'} PLACE`;
    g.font = 'italic 900 150px "Arial Black", Impact, sans-serif';
    g.lineWidth = 18; g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeText(head, W / 2, 190);
    g.fillStyle = win ? '#fff6c9' : '#ffffff'; g.fillText(head, W / 2, 190);
    g.font = 'bold 50px "Trebuchet MS", sans-serif'; g.fillStyle = win ? '#3a1606' : '#ffcc33';
    const bits = [`${result.elims} ELIM${result.elims === 1 ? '' : 'S'}`];
    if (result.dmg) bits.push(`${result.dmg.toLocaleString()} DAMAGE`);
    g.fillText(bits.join('  ·  '), W / 2, 265);
  }
  // name plate
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, H - 210, W, 210);
  g.textAlign = 'left';
  g.font = 'italic 900 92px "Arial Black", Impact, sans-serif'; g.fillStyle = '#ffffff';
  g.fillText(name, 60, H - 105, W - 120);
  g.font = 'bold 36px "Trebuchet MS", sans-serif'; g.fillStyle = '#ffcc33';
  g.fillText(result ? `${win ? '#1 VICTORY' : `#${result.place} PLACE`}  ·  ${result.elims} ELIMS  ·  FOOTBALL ROYALE` : `#${profile.skin.number}  ·  ${preset ? preset.team.toUpperCase() : ''}  ·  FOOTBALL ROYALE`, 64, H - 45, W - 120);
  return new Promise((res) => out.toBlob(res, 'image/png'));
}
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const inviteLink = () => partyInfo ? `${location.origin}/?squad=${partyInfo.code}` : `${location.origin}/`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try { // old-school fallback
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
// share a file + text with the Web Share API when the device supports it, else download + copy the link
async function shareOrSave(blob, filename, text, link) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Football Royale', text: `${text} ${link}` }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  const copied = await copyText(`${text} ${link}`);
  return copied ? 'saved+copied' : 'saved';
}
$('photo').onclick = async () => {
  const blob = await makePoster(null);
  download(blob, 'my-football-royale-player.png');
};
async function shareResult(r) {
  const msg = $('res-msg');
  msg.textContent = 'Making your poster…';
  const blob = await makePoster(r);
  const text = `${r.win ? '#1 VICTORY' : `#${r.place} place`} · ${r.elims} ELIMS · FOOTBALL ROYALE 🏈 Come squad up with me!`;
  const how = await shareOrSave(blob, r.win ? 'football-royale-victory.png' : 'football-royale-result.png', text, inviteLink());
  msg.textContent = how === 'shared' ? 'Shared! 🎉' : how === 'cancelled' ? '' : how === 'saved+copied' ? '📸 Poster saved and invite link copied. Send it to your friends!' : '📸 Poster saved!';
}

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
let signOutReason = '';
net.on('account_deleted', (m) => { signOutReason = m.msg || ''; });
net.on('auth_needed', () => {
  const wasSignedIn = signedIn;
  signedIn = false;
  store.set('fr_session', null);
  if (game) { game.destroy(); game = null; }
  for (const id of ['menu', 'lobby', 'loading', 'shop', 'settings']) $(id).classList.add('hidden');
  $('admin-menu').classList.add('hidden');
  setAuthMode(wasSignedIn ? 'login' : authMode); // signed out (or password reset): go straight to Log in
  if (signOutReason) { $('auth-error').textContent = signOutReason; signOutReason = ''; }
  $('auth').classList.remove('hidden');
});
net.on('auth', (m) => {
  store.set('fr_session', m.token);
  $('a-pass').value = '';
  $('auth').classList.add('hidden');
  signedIn = true;
  showScreen('menu');
  net.send(hello());
  joinPendingSquad();
});
net.on('auth_error', (m) => { $('auth-error').textContent = m.msg; });
$('logout').onclick = () => { net.send({ t: 'logout' }); $('admin-menu').classList.add('hidden'); };

// ---------- in-game admin drop-down ----------
$('admin-toggle').onclick = () => {
  const open = $('admin-drop').classList.toggle('hidden') === false;
  if (open) document.exitPointerLock?.();
};
// 🔫 armory pickers: every weapon in shared/weapons.js and every rarity
$('ad-weapon').innerHTML = GUN_IDS.map((w) => `<option value="${w}">${WEAPONS[w].name}</option>`).join('');
$('ad-rarity').innerHTML = RARITIES.map((r, i) => `<option value="${i}"${i === 4 ? ' selected' : ''}>${r.name}</option>`).join('');
$('admin-drop').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'give' || act === 'refill' || act === 'everything') {
    if (!game) { $('ad-status').textContent = 'Admin armory works in Private Rooms and Party Island. Start one first!'; $('ad-status').className = 'err'; return; }
    if (act === 'give') net.send({ t: 'admin', action: 'armory', weapon: $('ad-weapon').value, rarity: +$('ad-rarity').value });
    else net.send({ t: 'admin', action: 'armory', [act]: true });
    return;
  }
  if (act === 'royale' || act === 'island') net.send({ t: 'admin', action: 'party', kind: act, title: $('ad-title').value });
  else if (act === 'endparty') { if (confirm('End all parties?')) net.send({ t: 'admin', action: 'endparty' }); }
  else if (act === 'broadcast') { net.send({ t: 'admin', action: 'broadcast', text: $('ad-msg').value, style: $('ad-style').value }); $('ad-msg').value = ''; }
  else if (act === 'gift') net.send({ t: 'admin', action: 'gift', name: $('ad-user').value.trim(), amount: +$('ad-amt').value });
  else if (act === 'stats') net.send({ t: 'admin', action: 'stats' });
  else if (act === 'resetpw') { const n = $('ad-pwuser').value.trim(); if (n && confirm(`Give ${n.toUpperCase()} a temporary password? Their old password will stop working.`)) net.send({ t: 'admin', action: 'resetpw', name: n }); }
};
net.on('admin_ok', (m) => { $('ad-status').textContent = m.msg; $('ad-status').className = m.ok ? '' : 'err'; });
const setMode = (m) => { profile.mode = m; [...$('mode').children].forEach((b) => b.classList.toggle('on', b.dataset.v === m)); updateQuickSub(); };
setMode(profile.mode);
$('mode').onclick = (e) => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.v); saveProfile(); } };

function join(extra) {
  initAudio();
  userGestured = true;
  saveProfile();
  $('menu-error').textContent = '';
  net.send({ t: 'join', skin: profile.skin, mode: profile.mode, ...extra });
}
$('quick').onclick = () => join({});
$('create').onclick = () => join({ create: true, difficulty: $('difficulty').value });
$('join').onclick = () => { const c = $('code').value.trim().toUpperCase(); if (c.length === 4) join({ room: c }); else $('menu-error').textContent = 'Room codes have 4 letters.'; };
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) { $('code').value = urlRoom.toUpperCase(); setTab('rooms'); $('join').classList.add('pulse'); }
const urlSquad = new URLSearchParams(location.search).get('squad');
if (urlSquad || urlRoom) {
  $('auth-invite').innerHTML = urlSquad ? '👥 A friend invited you to their <b>squad</b>! Sign up or log in and you\'ll join them.' : `🔒 A friend invited you to room <b>${esc(urlRoom.toUpperCase())}</b>! Log in to join.`;
  $('auth-invite').classList.remove('hidden');
}

// ---------- squads ----------
// one tap: make a squad (if needed) and share / copy the invite link
let inviteAfterCreate = false;
async function shareInvite() {
  const link = inviteLink();
  const text = 'Squad up with me in Football Royale! 🏈';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Football Royale', text, url: link }); partyMsg('Invite sent! 🎉'); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(link)) partyMsg(`🔗 Invite link copied! Paste it to your friends.`);
  else partyMsg(`Send your friends this link: <b>${esc(link)}</b>`);
}
let partyMsgTimer = 0;
function partyMsg(html) { $('party-msg').innerHTML = html; clearTimeout(partyMsgTimer); partyMsgTimer = setTimeout(() => { $('party-msg').innerHTML = ''; }, 6000); }
$('party-invite').onclick = () => {
  initAudio(); saveProfile();
  if (partyInfo) return shareInvite();
  inviteAfterCreate = true;
  net.send({ t: 'party_create' });
};
$('party-share').onclick = shareInvite;
$('party-join').onclick = () => {
  const c = $('party-code').value.trim().toUpperCase();
  if (c.length !== 4) { partyMsg('Squad codes have 4 letters.'); return; }
  initAudio(); saveProfile(); net.send({ t: 'party_join', code: c });
};
$('party-code').onkeydown = (e) => { if (e.key === 'Enter') $('party-join').click(); };
$('party-leave').onclick = () => net.send({ t: 'party_leave' });
// ?squad=CODE invite links: join once we're signed in
let pendingSquad = urlSquad ? urlSquad.toUpperCase().slice(0, 4) : null;
function joinPendingSquad() {
  if (!pendingSquad) return;
  net.send({ t: 'party_join', code: pendingSquad });
  pendingSquad = null;
  history.replaceState(null, '', location.pathname);
}
net.on('party', (m) => {
  partyInfo = m.code ? m : null;
  updateQuickSub();
  if (partyInfo && inviteAfterCreate) { inviteAfterCreate = false; shareInvite(); }
  $('party-none').classList.toggle('hidden', !!partyInfo);
  $('party-on').classList.toggle('hidden', !partyInfo);
  if (!partyInfo) return;
  $('party-code-show').textContent = m.code;
  $('party-members').innerHTML = m.members.map((x) => `<li style="color:${x.skin.jersey}"><span style="color:#fff">${esc(x.name)}${x.name === m.leader ? ' 👑' : ''}${x.busy ? ' <small>(in a match)</small>' : ''}</span></li>`).join('');
  $('party-note').textContent = m.youLead
    ? (m.members.length > 1 ? 'You lead! Press Quick Play and your squad drops in with you.' : 'Invite friends with the link, then press Quick Play together!')
    : `Waiting for ${m.leader} to press Quick Play…`;
});
function updateQuickSub() {
  const n = partyInfo ? partyInfo.members.length : 0;
  $('quick-sub').textContent = partyInfo && !partyInfo.youLead ? `your squad leader starts the match`
    : n > 1 ? `drop in with your squad of ${n}` : `75 players · ${profile.mode === 'build' ? 'building on' : 'no building'} · drop in now`;
}

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
let earlySnaps = null; // snapshots that arrive before the Game exists (they are delta-encoded: none may be lost)
net.on('start', (m) => {
  showScreen('loading');
  earlySnaps = [];
  setTimeout(() => {
    if (game) game.destroy();
    for (const id of ['menu', 'lobby', 'loading']) $(id).classList.add('hidden');
    previewRunning = false;
    game = new Game({
      renderer, map, hud, net, myId, mode: currentRoom.mode, kind: currentRoom.kind, mySkin: profile.skin, settings,
      onLeave: () => { game = null; showScreen('menu'); },
      onPlayAgain: () => join({}),
      onShare: shareResult,
      confetti,
      emotes: EMOTES.filter((e) => canUseEmote(e.id, account)),
    });
    stopMenuMusic();
    game.start(m);
    for (const s of earlySnaps || []) game.onSnapshot(s);
    earlySnaps = null;
    renderer.domElement.requestPointerLock?.();
  }, 30);
});
net.on('s', (m) => { if (earlySnaps) earlySnaps.push(m); else if (game) game.onSnapshot(m); });
net.on('end', (m) => game && game.onEnd(m));
net.on('closed', () => {
  if (game) { game.destroy(); game = null; }
  showScreen('menu');
});
net.on('error', (m) => {
  // squad problems show up right in the squad card (the UI calls parties "squads")
  if (/party/i.test(m.msg) && !game) { partyMsg(`😕 ${esc(m.msg.replace(/party leader/gi, 'squad leader').replace(/party/gi, 'squad'))}`); return; }
  $('menu-error').textContent = m.msg;
  if (!$('shop').classList.contains('hidden')) $('shop-msg').textContent = m.msg;
  if (game) hud.toast(m.msg);
  if (!game && !$('lobby').classList.contains('hidden')) showScreen('menu');
});

// ---------- news & scheduled events ----------
net.on('info', (m) => {
  info = m;
  if (m.shop) shopClock = m.shop.now - Date.now(); // server time - my time (the countdown follows the server)
  renderNews();
  updateShopButton();
  if (!$('shop').classList.contains('hidden')) renderShop();
});
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
  nudgePasswordChange(m);
  $('me-name').textContent = m.username + (m.isAdmin ? ' 👑' : '');
  $('admin-menu').classList.toggle('hidden', !m.isAdmin);
  if (!signedIn) { signedIn = true; $('auth').classList.add('hidden'); if (!game && $('lobby').classList.contains('hidden')) showScreen('menu'); }
  joinPendingSquad();
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
  if (game) game.onReward(m);
  const el = $('reward');
  el.textContent = `+${m.bucks} Ball Bucks · ${m.why}`;
  el.classList.remove('hidden');
  clearTimeout(rewardTimer);
  rewardTimer = setTimeout(() => el.classList.add('hidden'), 2500);
});
const wearSkin = (id) => {
  const p = SKIN_PRESETS.find((x) => x.id === id);
  profile.skin = sanitizeSkin({ ...p, preset: p.id, number: profile.skin.number, tone: profile.skin.tone, hair: profile.skin.hair, hairStyle: profile.skin.hairStyle, eyes: profile.skin.eyes, smile: profile.skin.smile, helmetOn: profile.skin.helmetOn });
  saveProfile(); refreshPreview();
};
net.on('bought', (m) => {
  const item = anyShopItem(m.item);
  sfx.chest(); confetti(1800);
  $('shop-msg').textContent = item && item.kind === 'emote' ? `🎉 ${item.name} is yours! Press G (or 💃) in a match to use it.` : '';
  if (item && item.kind === 'skin') wearSkin(item.id);
});
const artCache = new Map();
const shopDate = () => todaysShop().date;
const NEW_TAG = '<span class="tag-new">NEW!</span>';
const ART_FRAME = { 8: 2.4, 9: 1.6, 10: 0.6, 11: 0.35, 12: 0.4, 13: 0.5 }; // the best moment of each emote for its poster
function itemArt(item) {
  if (artCache.has(item.id)) return artCache.get(item.id);
  const skin = item.kind === 'skin'
    ? sanitizeSkin({ ...SKIN_PRESETS.find((p) => p.id === item.id), preset: item.id, number: 1 + (item.price % 97), tone: profile.skin.tone })
    : item.shop === 'daily' ? { ...profile.skin } : { ...profile.skin, horns: profile.skin.horns || '#f3ead2' };
  const m = createPlayer(skin);
  m.rotation.y = Math.PI + 0.35;
  animatePlayer(m, { speed: 0, phase: 0, emote: item.emote || 3, emoteT: ART_FRAME[item.emote] ?? EMOTES.find((e) => e.id === item.emote)?.art ?? 0.55, t: 1 }, 1 / 60);
  const was = pModel; if (pModel) pModel.visible = false;
  pScene.add(m);
  pr.render(pScene, pCam);
  const url = pr.domElement.toDataURL();
  pScene.remove(m); disposePlayer(m);
  if (was) was.visible = true;
  artCache.set(item.id, url);
  return url;
}
const buyLabel = (item) => (account.owned.includes(item.id) ? (item.kind === 'skin' ? '✅ Owned · Wear' : '✅ Owned') : `🏈 ${item.price.toLocaleString()}`);
const buyClass = (item) => (account.owned.includes(item.id) ? 'owned' : account.bucks >= item.price ? '' : 'cant');
function card(item, isNew) {
  const r = RARITIES[item.rarity || 0];
  return `<div class="card" style="--rc:${r.color}">
      ${isNew ? NEW_TAG : ''}
      <div class="art" data-preview="${item.id}" title="Preview"><img src="${itemArt(item)}" alt=""><span class="zoom">🔍</span></div>
      <div class="info">
        <div class="nm">${esc(item.name)}</div>
        <div class="meta">${r.name} ${item.kind === 'skin' ? 'Outfit' : 'Emote'}</div>
        <button data-buy="${item.id}" class="${buyClass(item)}">${buyLabel(item)}</button>
      </div></div>`;
}
// ⭐ Daily Item Shop: today's pick comes from the server (info.shop); the same seeded pick is
// worked out here too until the first info message arrives.
let shopClock = 0, shopTab = store.get('fr_shop_tab', 'daily') === 'longhorn' ? 'longhorn' : 'daily';
const todaysShop = () => info.shop || dailyShop(utcDateKey());
function renderDaily() {
  const d = todaysShop();
  $('daily-featured').innerHTML = d.featured.map(dailyItem).filter(Boolean).map((item) => {
    const r = RARITIES[item.rarity || 0];
    return `<div class="fcard" style="--rc:${r.color}">
      ${isNewItem(item, d.date) ? NEW_TAG : ''}
      <div class="art" data-preview="${item.id}" title="Preview"><img src="${itemArt(item)}" alt=""><span class="zoom">🔍</span></div>
      <div class="info">
        <span class="ribbon">★ FEATURED</span>
        <div class="nm">${esc(item.name)}</div>
        <div class="meta">${r.name} ${item.kind === 'skin' ? 'Outfit' : 'Emote'}</div>
        <button data-buy="${item.id}" class="${buyClass(item)}">${buyLabel(item)}</button>
      </div></div>`;
  }).join('');
  // the new batch first, then the rest (the rotation already mixes them)
  const items = d.items.map(dailyItem).filter(Boolean);
  const fresh = items.filter((i) => isNewItem(i, d.date));
  $('daily-items').innerHTML = [...fresh, ...items.filter((i) => !fresh.includes(i))].map((item) => card(item, fresh.includes(item))).join('');
  tickDaily();
}
function tickDaily() {
  const left = todaysShop().resetsAt - (Date.now() + shopClock);
  const h = Math.floor(left / 3600_000), mn = Math.floor((left % 3600_000) / 60_000), sec = Math.floor((left % 60_000) / 1000);
  $('daily-cd').textContent = left <= 0 ? 'any second now!' : h ? `${h}h ${mn}m` : mn ? `${mn}m ${sec}s` : `${sec}s`;
}
setInterval(() => { if (!$('shop').classList.contains('hidden') && shopTab === 'daily') tickDaily(); }, 1000);
function renderShop() {
  $('shop').classList.toggle('daily', shopTab === 'daily');
  [...$('shop-tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.shop === shopTab));
  document.querySelectorAll('#shop .shop-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== shopTab));
  if (shopPreview) renderPreviewInfo();
  if (shopTab === 'daily') return renderDaily();
  $('shop-items').innerHTML = SHOP.map((item) => card(item, false)).join('');
}
// "NEW!" on the Item Shop button while today's shop has items from the newest batch
function updateShopButton() {
  const d = todaysShop();
  const anyNew = dailyIds(d).some((id) => isNewItem(dailyItem(id), d.date));
  $('open-shop').innerHTML = `⭐ ITEM SHOP${anyNew ? ' <span class="new-dot">NEW!</span>' : ''}`;
}
updateShopButton();

// ---------- 🔍 shop preview: the Locker Room preview canvas moves into a pop-up and shows the item ----------
let shopPreview = null; // { item, model, start, yaw, drag }
const PATTERN_NAMES = { flames: 'Flame jersey', camo: 'Camo jersey', stars: 'Starry jersey', chevron: 'V-stripe jersey', sash: 'Sash jersey', candy: 'Candy-stripe jersey',
  split: 'Two-tone jersey', sweater: 'Holiday sweater jersey', frost: 'Frosty jersey', dino: 'Dino-scale jersey', mech: 'Armor-plate jersey', stripes: 'Striped jersey' };
function itemFeatures(item) {
  if (item.kind === 'emote') {
    const e = EMOTES.find((x) => x.id === item.emote);
    return [e && e.loop ? '🔁 Loops until you move' : '▶️ One-shot celebration', item.emote === 16 && '🏆 Comes with a trophy'];
  }
  const p = SKIN_PRESETS.find((x) => x.id === item.id), st = p.style || {};
  return [st.pattern && PATTERN_NAMES[st.pattern], st.chrome && 'Chrome helmet', st.glow && 'Glowing trim', st.decal && 'Helmet logo', st.visor && 'Tinted visor',
    st.fin === 'spikes' && 'Spiky helmet', st.fin === 'antenna' && 'Robot antennas', st.back === 'cape' && 'Cape', st.back === 'jetpack' && 'Rocket pack',
    st.gloves && 'Matching gloves', st.chute && 'Matching parachute', p.horns && 'Horns'];
}
function previewSkin(item) {
  const keep = { number: profile.skin.number, tone: profile.skin.tone, hair: profile.skin.hair, hairStyle: profile.skin.hairStyle, eyes: profile.skin.eyes, smile: profile.skin.smile, helmetOn: profile.skin.helmetOn };
  if (item.kind === 'skin') return sanitizeSkin({ ...SKIN_PRESETS.find((p) => p.id === item.id), preset: item.id, ...keep });
  return item.shop === 'daily' ? { ...profile.skin } : { ...profile.skin, horns: profile.skin.horns || '#f3ead2' };
}
function renderPreviewInfo() {
  const { item } = shopPreview, r = RARITIES[item.rarity || 0];
  $('sp-card').style.setProperty('--rc', r.color);
  $('sp-new').classList.toggle('hidden', !isNewItem(item, shopDate()));
  $('sp-name').textContent = item.name;
  $('sp-meta').textContent = `${r.name} ${item.kind === 'skin' ? 'Outfit' : 'Emote'}`;
  $('sp-feat').innerHTML = itemFeatures(item).filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('');
  const b = $('sp-buy');
  b.dataset.buy = item.id; b.className = buyClass(item); b.textContent = buyLabel(item);
}
let previewHome = null;
function openPreview(item) {
  closePreview();
  const model = createPlayer(previewSkin(item));
  shopPreview = { item, model, start: performance.now() / 1000, yaw: 0.35, drag: null };
  pScene.add(model);
  if (pModel) pModel.visible = false;
  const cv = $('preview');
  previewHome = { parent: cv.parentNode, next: cv.nextSibling };
  $('sp-stage').prepend(cv);
  renderPreviewInfo();
  $('shop-preview').classList.remove('hidden');
  sfx.click();
}
function closePreview() {
  if (!shopPreview) return;
  pScene.remove(shopPreview.model); disposePlayer(shopPreview.model);
  shopPreview = null;
  if (pModel) pModel.visible = true;
  previewHome.parent.insertBefore($('preview'), previewHome.next);
  $('shop-preview').classList.add('hidden');
}
function animateShopPreview(t) {
  const P = shopPreview, m = P.model, el = t - P.start;
  if (P.item.kind === 'emote') {
    const E = EMOTES.find((e) => e.id === P.item.emote), len = E.loop ? 1e9 : E.dur + 1.2;
    m.rotation.y = Math.PI + P.yaw;
    animatePlayer(m, { speed: 0, phase: 0, emote: P.item.emote, emoteT: el % len, t }, 1 / 60);
  } else {
    if (!P.drag) P.yaw += 0.01;   // slow turntable so you see the back too (cape, rocket pack, number)
    m.rotation.y = Math.PI + P.yaw;
    animatePlayer(m, { speed: 0, phase: 0, hero: true, emote: 0, emoteT: 0, t }, 1 / 60);
  }
}
$('sp-close').onclick = () => { closePreview(); sfx.click(); };
$('shop-preview').addEventListener('pointerdown', (e) => {
  if (e.target === $('shop-preview')) return closePreview();   // tap outside the card
  if (shopPreview && e.target.id === 'preview') { shopPreview.drag = { x: e.clientX, yaw: shopPreview.yaw }; e.target.setPointerCapture?.(e.pointerId); }
});
$('shop-preview').addEventListener('pointermove', (e) => { const P = shopPreview; if (P && P.drag) P.yaw = P.drag.yaw + (e.clientX - P.drag.x) * 0.012; });
for (const ev of ['pointerup', 'pointercancel']) $('shop-preview').addEventListener(ev, () => { if (shopPreview) shopPreview.drag = null; });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && shopPreview) closePreview(); });
$('shop-tabs').onclick = (e) => {
  const b = e.target.closest('button[data-shop]'); if (!b || b.dataset.shop === shopTab) return;
  shopTab = b.dataset.shop; store.set('fr_shop_tab', shopTab); sfx.click();
  $('shop-msg').textContent = '';
  renderShop();
};
function openShop(tab) {
  initAudio();
  if (tab === 'daily' || tab === 'longhorn') shopTab = tab;
  $('shop-msg').textContent = '';
  $('shop').classList.remove('hidden');
  renderShop();
}
$('open-shop').onclick = () => openShop('daily'); // the Daily Shop is the front page
$('close-shop').onclick = () => { closePreview(); $('shop').classList.add('hidden'); renderSkins(); };
$('shop').onclick = (e) => {
  const pv = e.target.closest('[data-preview]');
  if (pv) { const it = anyShopItem(pv.dataset.preview); if (it) openPreview(it); return; }
  const b = e.target.closest('button[data-buy]'); if (!b) return;
  const item = anyShopItem(b.dataset.buy); if (!item) return;
  if (account.owned.includes(item.id)) {
    if (item.kind === 'skin') { $('close-shop').click(); wearSkin(item.id); renderSkins(); }
    else if (shopPreview) closePreview();
    return;
  }
  if (account.bucks < item.price) { $('shop-msg').textContent = `You need ${(item.price - account.bucks).toLocaleString()} more Ball Bucks. Keep playing to earn more!`; return; }
  if (confirm(`Buy ${item.name} for ${item.price.toLocaleString()} Ball Bucks?`)) net.send({ t: 'buy', item: item.id });
};

// ---------- Locker Room tabs ----------
function setTab(name) {
  [...$('menu-tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('#menu .tab-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
  store.set('fr_tab', name);
}
$('menu-tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) { setTab(b.dataset.tab); sfx.click(); } };
if (!urlRoom) setTab(store.get('fr_tab', 'locker'));
$('reset-tips').onclick = () => { store.set('fr_tips', {}); $('reset-tips').textContent = '✅ Coach tips will show in your next match'; };

// ---------- Settings (gear in the Locker Room and in the pause menu) ----------
const SLIDERS = [
  ['s-master', 'master', (v) => `${Math.round(v * 100)}%`], ['s-music', 'music', (v) => `${Math.round(v * 100)}%`],
  ['s-sfx', 'sfx', (v) => `${Math.round(v * 100)}%`], ['sens', 'sens', (v) => `${(+v).toFixed(1)}x`], ['s-fov', 'fov', (v) => `${v}°`],
];
function syncSettingsUI() {
  for (const [id, key, fmt] of SLIDERS) { $(id).value = settings[key]; $(id).nextElementSibling.textContent = fmt(settings[key]); }
  $('s-invert').checked = !!settings.invertY;
  $('s-fps').checked = !!settings.showFps;
  $('s-menu-music').checked = !!settings.menuMusic;
}
for (const [id, key, fmt] of SLIDERS) {
  $(id).oninput = () => {
    settings[key] = +$(id).value;
    $(id).nextElementSibling.textContent = fmt(settings[key]);
    setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
    saveSettings();
  };
  if (key === 'sfx' || key === 'master') $(id).onchange = () => sfx.pickup(); // let them hear the new level
}
$('s-invert').onchange = () => { settings.invertY = $('s-invert').checked; saveSettings(); };
$('s-fps').onchange = () => { settings.showFps = $('s-fps').checked; saveSettings(); };
$('s-menu-music').onchange = () => { settings.menuMusic = $('s-menu-music').checked; saveSettings(); updateMenuMusic(); };
function openSettings() { initAudio(); syncSettingsUI(); $('settings').classList.remove('hidden'); }
$('open-settings').onclick = openSettings;
$('pause-settings').onclick = openSettings;
$('settings-close').onclick = () => $('settings').classList.add('hidden');
// change password
$('pw-save').onclick = () => {
  $('pw-msg').className = 'error'; $('pw-msg').textContent = '';
  if (!$('pw-old').value || !$('pw-new').value) { $('pw-msg').textContent = 'Fill in both boxes.'; return; }
  net.send({ t: 'change_password', old: $('pw-old').value, new: $('pw-new').value });
};
$('em-save').onclick = () => {
  $('em-msg').className = 'error'; $('em-msg').textContent = '';
  if (!$('em-new').value || !$('em-pass').value) { $('em-msg').textContent = 'Fill in both boxes.'; return; }
  net.send({ t: 'change_email', email: $('em-new').value, password: $('em-pass').value });
};
net.on('email_result', (m) => {
  $('em-msg').textContent = m.msg;
  $('em-msg').className = m.ok ? 'error ok' : 'error';
  if (m.ok) { $('em-new').value = ''; $('em-pass').value = ''; }
});
net.on('pw_result', (m) => {
  $('pw-msg').textContent = m.msg;
  $('pw-msg').className = m.ok ? 'error ok' : 'error';
  if (m.ok) { $('pw-old').value = ''; $('pw-new').value = ''; $('pw-note').classList.add('hidden'); }
});
let pwNudged = false;
function nudgePasswordChange(m) {
  $('pw-note').classList.toggle('hidden', !m.mustChangePw);
  if (m.mustChangePw && !pwNudged && !game) { pwNudged = true; openSettings(); }
}
$('settings').onclick = (e) => { if (e.target === $('settings')) $('settings').classList.add('hidden'); };
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) $('settings').classList.add('hidden'); });
// Graphics quality: hooks into client/js/quality.js (setQuality/getQuality) when that module is present.
import('./quality.js').then((q) => {
  if (typeof q.setQuality !== 'function') return;
  const levels = q.QUALITY_LEVELS || q.LEVELS || ['low', 'medium', 'high'];
  const names = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', auto: 'Auto' };
  const box = $('s-quality');
  const draw = () => {
    const cur = typeof q.getQuality === 'function' ? q.getQuality() : null;
    box.innerHTML = levels.map((l) => `<button data-v="${esc(l)}" class="${l === cur ? 'on' : ''}">${esc(names[l] || l)}</button>`).join('');
  };
  box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; q.setQuality(b.dataset.v); draw(); };
  draw();
  $('s-quality-row').classList.remove('hidden');
}).catch(() => { /* quality.js not available: the row stays hidden */ });
syncSettingsUI();

// debug hook for automated tests
window.__fr = window.__fr || {}; // quality.js adds window.__fr.quality
Object.defineProperty(window.__fr, 'game', { get() { return game; }, configurable: true });

// ---------- start ----------
initTouchEnvironment(); // phones & tablets: touch CSS, no pinch-zoom (on-screen controls start with each match)
renderStats();
refreshPreview();
showScreen('loading');
net.connect();
