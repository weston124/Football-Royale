// Server CPU benchmark: runs N full matches (1 fake human + 74 bots each) in this process and
// reports the time each tick takes (simulate + snapshots) and per-section breakdown.
//   node tools/serverbench.js [matches=4] [seconds=60] [humansPerMatch=1]
//   node --cpu-prof --cpu-prof-dir=/tmp/prof tools/serverbench.js 4 60   (for a flame graph)
import { Match } from '../server/match.js';
import { updateBot } from '../server/bots.js';

const N = Number(process.argv[2]) || 4;
const SECS = Number(process.argv[3]) || 60;
const HUMANS = Number(process.argv[4]) || 1;
const ticks = [], sim = [], snap = [];
let bytes = 0;
const origTick = Match.prototype.tick, origSim = Match.prototype.simulate, origSnap = Match.prototype.sendSnapshots;
const timed = (fn, arr) => function (...a) { const t0 = performance.now(); const r = fn.apply(this, a); arr.push(performance.now() - t0); return r; };
Match.prototype.tick = timed(origTick, ticks);
// fake humans are driven by the bot AI so they move and fight like real players
Match.prototype.simulate = timed(function (t) {
  for (const p of this.players.values()) if (p.fake && p.alive) { const ph = p.phase; updateBot(this, p, 1 / 20, t); if (ph === 'blimp' && p.phase === 'blimp') continue; }
  return origSim.call(this, t);
}, sim);
Match.prototype.sendSnapshots = timed(origSnap, snap);

const matches = [];
for (let i = 0; i < N; i++) {
  const m = new Match({ code: 'B' + i, mode: i % 2 ? 'build' : 'nobuild', difficulty: 'normal' });
  for (let h = 0; h < HUMANS; h++) {
    const ws = { readyState: 1, send(s) { bytes += s.length; } };
    m.addHuman(ws, 'BENCH' + i + '_' + h, null);
  }
  m.start();
  for (const p of m.players.values()) if (!p.bot) { p.fake = true; updateBot.init(m, p); }
  matches.push(m);
}
const cpu0 = process.cpuUsage();
const t0 = performance.now();
await new Promise((r) => setTimeout(r, SECS * 1000));
const wall = (performance.now() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = s.reduce((x, y) => x + y, 0) / (s.length || 1);
  return { avg: +avg.toFixed(3), p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(3), max: +(s[s.length - 1] || 0).toFixed(3), n: s.length };
};
console.log(JSON.stringify({
  matches: N, secs: +wall.toFixed(1),
  alive: matches.map((m) => m.alive.length),
  tickMs: stat(ticks), simulateMs: stat(sim), snapshotMs: stat(snap),
  cpuPct: +(((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(1),
  humans: HUMANS, humanKBps: +(bytes / N / HUMANS / wall / 1024).toFixed(2),
}, null, 1));
for (const m of matches) m.close();
process.exit(0);
