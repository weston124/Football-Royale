// All sounds are made with the Web Audio API (no sound files needed).
// Mix: master -> [sfx bus, music bus]. Volumes come from the Settings panel.
let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
const vol = { master: 0.8, music: 0.5, sfx: 0.9 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // a gentle limiter so stacked explosions / crowd never clip
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
  sfxBus = ctx.createGain(); musicBus = ctx.createGain();
  sfxBus.connect(comp); musicBus.connect(comp); comp.connect(master);
  applyVolumes();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export const audioReady = () => !!ctx && ctx.state === 'running';

function applyVolumes() {
  if (!ctx) return;
  master.gain.value = 0.6 * vol.master;
  sfxBus.gain.value = vol.sfx;
  musicBus.gain.value = vol.music;
}
/** Set any of { master, music, sfx } (0..1). Safe to call before audio starts. */
export function setVolumes(v) { Object.assign(vol, v); applyVolumes(); }

function out(dest, pan) {
  const bus = dest || sfxBus;
  if (!pan || !ctx.createStereoPanner) return bus;
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(bus);
  return p;
}
function noise(dur, freq, q, v, type = 'lowpass', when = 0, dest = null, pan = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(out(dest, pan));
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}
function tone(freq, dur, v, type = 'square', when = 0, slideTo = null, dest = null, attack = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + attack); }
  else g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(out(dest)); o.start(t); o.stop(t + dur + 0.05);
}
// a crowd: several band-passed noise layers that swell and fade
function crowd(dur, v, when = 0) {
  if (!ctx) return;
  for (const [f, q, k] of [[900, 0.6, 1], [1800, 0.9, 0.6], [450, 0.7, 0.7]]) {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * k, t + dur * 0.25);
    g.gain.setValueAtTime(v * k, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }
}

const GUN = {
  pistol: [0.12, 2400, 0.5], smg: [0.08, 3000, 0.35], rifle: [0.14, 1800, 0.5], shotgun: [0.3, 900, 0.8], sniper: [0.5, 1200, 0.9],
};
export const sfx = {
  gun(wid, v = 1) {
    if (wid === 'pigskin') { noise(0.25, 500, 1, 0.5 * v); tone(180, 0.2, 0.2 * v, 'sine', 0, 60); return; }
    if (wid === 'whistle') { tone(2200, 0.25, 0.1 * v, 'sine', 0, 2600); return; }
    if (wid === 'tackle') { noise(0.12, 600, 1, 0.25 * v); return; }
    const g = GUN[wid] || GUN.pistol;
    noise(g[0], g[1], 0.8, g[2] * v);
    tone(140, g[0] * 0.8, 0.25 * v, 'triangle', 0, 50);
  },
  boom(v = 1) { noise(0.9, 400, 0.7, 0.9 * v); tone(90, 0.6, 0.5 * v, 'sine', 0, 30); noise(1.6, 160, 0.5, 0.5 * v, 'lowpass', 0.05); },
  // punchy "thwack" on every hit; headshots get a bright bell ding on top
  hit(head) {
    noise(0.05, 2200, 1.2, 0.35, 'bandpass');
    tone(head ? 1500 : 1050, 0.06, 0.13, 'square');
    tone(180, 0.08, 0.25, 'sine', 0, 70);
    if (head) { tone(2637, 0.35, 0.12, 'sine', 0.03); tone(3951, 0.25, 0.05, 'sine', 0.03); tone(1318, 0.3, 0.06, 'triangle', 0.03); }
  },
  hurt() { noise(0.15, 300, 1, 0.4); tone(120, 0.12, 0.25, 'sine', 0, 60); },
  pickup() { tone(660, 0.07, 0.12, 'square'); tone(990, 0.09, 0.12, 'square', 0.06); },
  build() { noise(0.1, 1500, 2, 0.3, 'bandpass'); tone(300, 0.08, 0.1, 'square'); },
  reload() { noise(0.05, 3000, 3, 0.2, 'bandpass'); noise(0.05, 2500, 3, 0.2, 'bandpass', 0.25); },
  whistleBlow() { tone(2600, 0.45, 0.12, 'sine'); tone(2750, 0.45, 0.08, 'sine'); },
  // elimination stinger: rising power chord + a quick crowd "ohh!"
  elim() {
    [523, 659, 784, 1046].forEach((f, i) => { tone(f, 0.22, 0.11, 'square', i * 0.06); tone(f / 2, 0.22, 0.06, 'sawtooth', i * 0.06); });
    noise(0.25, 120, 1, 0.6, 'lowpass');
    crowd(1.1, 0.22, 0.05);
  },
  streak(n) {
    const base = [0, 523, 587, 659, 784, 880][Math.min(5, n)] || 880;
    [1, 1.26, 1.5, 2].forEach((k, i) => tone(base * k, 0.18, 0.1, 'square', i * 0.05));
    tone(base * 2, 0.5, 0.06, 'triangle', 0.22);
  },
  win() {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => { tone(f, 0.3, 0.13, 'square', i * 0.15); tone(f / 2, 0.3, 0.08, 'triangle', i * 0.15); });
    crowd(6, 0.45, 0.1);   // the crowd roars
    for (let i = 0; i < 6; i++) noise(0.08, 2600, 0.8, 0.25, 'highpass', 0.6 + i * 0.32 + Math.random() * 0.1); // claps
  },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, 0.09, 'triangle', i * 0.18)); crowd(1.8, 0.12, 0.2); },
  storm() { noise(0.4, 200, 1, 0.2); tone(70, 0.4, 0.15, 'sine'); },
  // storm siren: two-tone rising wail
  siren() { for (let i = 0; i < 3; i++) { tone(520, 0.42, 0.07, 'sawtooth', i * 0.5, 820, null, 0.05); } noise(1.4, 180, 0.6, 0.25, 'lowpass'); },
  beep() { tone(880, 0.12, 0.08, 'square'); },
  callout() { tone(392, 0.12, 0.1, 'square'); tone(523, 0.12, 0.1, 'square', 0.1); tone(784, 0.25, 0.1, 'square', 0.2); noise(0.6, 900, 0.6, 0.12, 'bandpass', 0.15); },
  land(v = 1) { noise(0.22, 160, 0.8, 0.8 * v, 'lowpass'); tone(85, 0.2, 0.4 * v, 'sine', 0, 40); },
  step(v = 1, pan = 0) { noise(0.06, 500 + Math.random() * 300, 1.4, 0.35 * v, 'bandpass', 0, null, pan); },
  heartbeat() { tone(62, 0.13, 0.5, 'sine', 0, 45); tone(58, 0.15, 0.4, 'sine', 0.2, 40); },
  chute() { noise(0.35, 700, 0.6, 0.45, 'bandpass'); },
  chest() { [880, 1175, 1568].forEach((f, i) => tone(f, 0.2, 0.1, 'triangle', i * 0.08)); },
  message() { tone(880, 0.1, 0.12, 'sine'); tone(1320, 0.15, 0.12, 'sine', 0.1); },
  click() { tone(1200, 0.03, 0.05, 'square'); },
};

// ---------- party music: a little chiptune loop ----------
let partyTimer = null;
export function startPartyMusic(seconds = 30) {
  if (!ctx) return;
  stopPartyMusic();
  stopMenuMusic();
  const bpm = 124, beat = 60 / bpm;
  const bass = [55, 55, 82.4, 73.4, 65.4, 65.4, 82.4, 98];
  const melody = [659, 0, 784, 659, 880, 784, 659, 523, 587, 0, 659, 587, 523, 440, 523, 0];
  let step = 0;
  const end = ctx.currentTime + seconds;
  const M = musicBus;
  const play = () => {
    if (ctx.currentTime > end) return stopPartyMusic();
    for (let i = 0; i < 4; i++, step++) {
      const w = i * beat / 2;
      if (step % 2 === 0) noise(0.08, 120, 1, 0.5, 'lowpass', w, M);        // kick
      if (step % 4 === 2) noise(0.12, 2500, 0.7, 0.25, 'highpass', w, M);  // clap
      noise(0.03, 8000, 1, 0.08, 'highpass', w + beat / 4, M);              // hat
      tone(bass[Math.floor(step / 2) % bass.length] * 2, beat / 2 * 0.9, 0.12, 'sawtooth', w, null, M);
      const m = melody[step % melody.length];
      if (m) tone(m, beat / 2 * 0.8, 0.07, 'square', w, null, M);
    }
  };
  play();
  partyTimer = setInterval(play, beat * 2 * 1000);
}
export function stopPartyMusic() { if (partyTimer) clearInterval(partyTimer); partyTimer = null; }

// ---------- Locker Room music: an original, laid-back game-day groove ----------
// Scheduled with a small look-ahead so the timing stays tight. Plays through the music bus
// with its own fader so it can fade in/out smoothly. Only ever starts after a user gesture.
let menuTimer = null, menuGain = null, menuDelay = null, menuNext = 0, menuStep = 0;
const N = (s) => 440 * Math.pow(2, (s - 9) / 12); // semitones from C4 -> Hz
// 4 bars, 8 eighth-notes each. Chords: C - Am - F - G (with a sus lift on the last bar)
const CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
const BASS = [[-24, -24, -12, -24, -24, -12, -17, -14], [-27, -27, -15, -27, -27, -15, -20, -17], [-31, -31, -19, -31, -31, -19, -24, -22], [-29, -29, -17, -29, -29, -17, -22, -19]];
// lead hook (null = rest); answers itself in bar 4
const LEAD = [
  [12, null, 16, 19, null, 16, 14, 12], [9, null, 12, 16, null, 14, 12, null],
  [12, null, 9, 12, 14, null, 12, 9], [7, 11, 14, null, 19, null, 17, 14],
];
function scheduleMenu() {
  const beat = 60 / 104, e = beat / 2;
  while (menuNext < ctx.currentTime + 0.25) {
    const bar = Math.floor(menuStep / 8) % 4, s = menuStep % 8, t = menuNext - ctx.currentTime;
    const M = menuGain;
    if (s % 4 === 0) { tone(110, 0.16, 0.5, 'sine', t, 40, M); noise(0.05, 140, 1, 0.25, 'lowpass', t, M); } // kick
    if (s === 4) noise(0.14, 2200, 0.8, 0.16, 'bandpass', t, M);                                               // snap
    noise(0.025, 9000, 1, s % 2 ? 0.05 : 0.025, 'highpass', t, M);                                            // hat
    tone(N(BASS[bar][s]), e * 0.9, 0.16, 'triangle', t, null, M);                                              // bass
    if (s === 0 || s === 3 || s === 6) for (const c of CHORDS[bar]) tone(N(c + 12), e * 1.6, 0.025, 'sawtooth', t, null, M, 0.02); // stabs
    const l = LEAD[bar][s];
    if (l != null && Math.floor(menuStep / 32) % 2 === 1) { // the hook comes in every other phrase
      tone(N(l + 12), e * 0.95, 0.05, 'square', t, null, menuDelay, 0.005);
      tone(N(l + 24), e * 0.6, 0.015, 'sine', t, null, menuDelay);
    }
    menuNext += e; menuStep++;
  }
}
export function startMenuMusic() {
  if (!ctx || ctx.state !== 'running' || menuTimer || partyTimer) return;
  menuGain = ctx.createGain();
  menuGain.gain.setValueAtTime(0.0001, ctx.currentTime);
  menuGain.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + 2.5);
  menuGain.connect(musicBus);
  // slap-back echo for the lead
  menuDelay = ctx.createGain(); menuDelay.connect(menuGain);
  const dl = ctx.createDelay(1); dl.delayTime.value = (60 / 104) * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.3;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  menuDelay.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(menuGain);
  menuNext = ctx.currentTime + 0.1; menuStep = 0;
  scheduleMenu();
  menuTimer = setInterval(scheduleMenu, 80);
}
export function stopMenuMusic() {
  if (!menuTimer) return;
  clearInterval(menuTimer); menuTimer = null;
  const g = menuGain;
  try { g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); } catch { /* ignore */ }
  setTimeout(() => g.disconnect(), 900);
}
export const menuMusicPlaying = () => !!menuTimer;
