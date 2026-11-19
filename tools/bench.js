// Server CPU per tick with 75 players (1 scripted human + 74 bots), simulate() only
// (snapshot encoding is measured separately). node tools/bench.js [matches=3] [mode]
import { runMatch } from './sim.js';
const n = +(process.argv[2] || 3);
const all = [], early = [];
for (let i = 0; i < n; i++) {
  const r = runMatch({ mode: process.argv[3] || (i % 2 ? 'build' : 'nobuild'), difficulty: 'normal', humans: 1, keepTimes: true });
  all.push(...r.simTimes);
  early.push(...r.simTimes.slice(0, 20 * 180)); // first 3 minutes: most players alive
}
const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)} ms, p50 ${s[Math.floor(s.length * 0.5)].toFixed(3)}, p99 ${s[Math.floor(s.length * 0.99)].toFixed(2)}, max ${s[s.length - 1].toFixed(1)} (${a.length} ticks)`;
};
console.log('whole match :', stat(all));
console.log('first 3 min :', stat(early));
