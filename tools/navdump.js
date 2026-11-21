// Prints the bots' nav grid around a spot: floor height per 1 m cell, ## = blocked,
// ! = walkable but cut off from the main walk area.   node tools/navdump.js x z [radius=8]
import { MAP } from '../server/match.js';
import { buildNav } from '../server/nav.js';

const [cx, cz, R = 8] = process.argv.slice(2).map(Number);
const N = buildNav(MAP);
for (let z = Math.floor(cz - R); z <= cz + R; z++) {
  let row = String(z).padStart(5) + ' ';
  for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const c = N.cellOf(x + 0.5, z + 0.5);
    row += N.flags[c] & 1 ? ' ##' : (N.comp[c] === N.main ? ' ' : '!') + String(Math.round(N.floor[c])).padStart(2);
  }
  console.log(row);
}
