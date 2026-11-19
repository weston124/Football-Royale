// All sounds are made with the Web Audio API (no sound files needed).
let ctx = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function noise(dur, freq, q, vol, type = 'lowpass', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}
function tone(freq, dur, vol, type = 'square', when = 0, slideTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

const GUN = {
  pistol: [0.12, 2400, 0.5], smg: [0.08, 3000, 0.35], rifle: [0.14, 1800, 0.5], shotgun: [0.3, 900, 0.8], sniper: [0.5, 1200, 0.9],
};
export const sfx = {
  gun(wid, vol = 1) {
    if (wid === 'pigskin') { noise(0.25, 500, 1, 0.5 * vol); tone(180, 0.2, 0.2 * vol, 'sine', 0, 60); return; }
    if (wid === 'whistle') { tone(2200, 0.25, 0.1 * vol, 'sine', 0, 2600); return; }
    if (wid === 'tackle') { noise(0.12, 600, 1, 0.25 * vol); return; }
    const g = GUN[wid] || GUN.pistol;
    noise(g[0], g[1], 0.8, g[2] * vol);
    tone(140, g[0] * 0.8, 0.25 * vol, 'triangle', 0, 50);
  },
  boom(vol = 1) { noise(0.9, 400, 0.7, 0.9 * vol); tone(90, 0.6, 0.5 * vol, 'sine', 0, 30); },
  hit(head) { tone(head ? 1600 : 1100, 0.07, 0.15, 'square'); if (head) tone(2200, 0.1, 0.1, 'sine', 0.05); },
  hurt() { noise(0.15, 300, 1, 0.4); },
  pickup() { tone(660, 0.07, 0.12, 'square'); tone(990, 0.09, 0.12, 'square', 0.06); },
  build() { noise(0.1, 1500, 2, 0.3, 'bandpass'); tone(300, 0.08, 0.1, 'square'); },
  reload() { noise(0.05, 3000, 3, 0.2, 'bandpass'); noise(0.05, 2500, 3, 0.2, 'bandpass', 0.25); },
  whistleBlow() { tone(2600, 0.45, 0.12, 'sine'); tone(2750, 0.45, 0.08, 'sine'); },
  elim() { [523, 659, 784].forEach((f, i) => tone(f, 0.12, 0.12, 'square', i * 0.07)); },
  win() {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.25, 0.15, 'square', i * 0.15));
    noise(2.5, 1200, 0.3, 0.25, 'bandpass', 0.2); // crowd
  },
  storm() { noise(0.4, 200, 1, 0.2); },
  chest() { [880, 1175, 1568].forEach((f, i) => tone(f, 0.2, 0.1, 'triangle', i * 0.08)); },
  message() { tone(880, 0.1, 0.12, 'sine'); tone(1320, 0.15, 0.12, 'sine', 0.1); },
};

// ---------- party music: a little chiptune loop ----------
let partyTimer = null;
export function startPartyMusic(seconds = 30) {
  if (!ctx) return;
  stopPartyMusic();
  const bpm = 124, beat = 60 / bpm;
  const bass = [55, 55, 82.4, 73.4, 65.4, 65.4, 82.4, 98];
  const melody = [659, 0, 784, 659, 880, 784, 659, 523, 587, 0, 659, 587, 523, 440, 523, 0];
  let step = 0;
  const end = ctx.currentTime + seconds;
  const play = () => {
    if (ctx.currentTime > end) return stopPartyMusic();
    for (let i = 0; i < 4; i++, step++) {
      const w = i * beat / 2;
      if (step % 2 === 0) noise(0.08, 120, 1, 0.5, 'lowpass', w);        // kick
      if (step % 4 === 2) noise(0.12, 2500, 0.7, 0.25, 'highpass', w);  // clap
      noise(0.03, 8000, 1, 0.08, 'highpass', w + beat / 4);              // hat
      tone(bass[Math.floor(step / 2) % bass.length] * 2, beat / 2 * 0.9, 0.12, 'sawtooth', w);
      const m = melody[step % melody.length];
      if (m) tone(m, beat / 2 * 0.8, 0.07, 'square', w);
    }
  };
  play();
  partyTimer = setInterval(play, beat * 2 * 1000);
}
export function stopPartyMusic() { if (partyTimer) clearInterval(partyTimer); partyTimer = null; }
