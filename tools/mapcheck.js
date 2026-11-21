// Map sanity report: box/vehicle/loot counts, vehicle spots that are blocked, loot spots that end up
// inside something solid, Equipment Bags the bots can't reach.   node tools/mapcheck.js   (V=1: list them)
import { generateMap } from '../shared/map.js';
import { World, supportHeight } from '../shared/physics.js';
import { VEHICLE_TYPES, vehicleBlocked, vehicleSpawns } from '../shared/vehicles.js';
import { buildNav } from '../server/nav.js';

const map = generateMap();
const kinds = {};
for (const b of map.boxes) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
const types = {};
for (const v of map.vehicles) types[v.type] = (types[v.type] || 0) + 1;
console.log({
  boxes: map.boxes.length, kinds, vehicles: map.vehicles.length, types, loot: map.loot.length, chests: map.chests.length,
  pois: map.pois.length, trees: map.trees.length, decor: map.decor.length,
});
console.log(map.pois.map((p) => p.name).join(', '));
const world = new World();
for (const b of map.boxes) world.add({ min: b.min.slice(), max: b.max.slice(), kind: b.kind });
for (const v of vehicleSpawns(map, 'normal')) {
  const T = VEHICLE_TYPES[v.type];
  const b = vehicleBlocked(world, v.x, 0, v.z, v.yaw, { ...T, W: T.W + 1.5, L: T.L + 1.5 });
  if (b) console.log('vehicle blocked', v.id, v.type, v.x, v.z, b.kind, b.min, b.max);
}
const inside = (x, y, z) => world.query(x - 0.3, z - 0.3, x + 0.3, z + 0.3).some((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && y + 0.5 > b.min[1] && y + 0.5 < b.max[1]);
let bad = 0;
for (const s of map.loot) {
  const y = supportHeight(world, s.x, s.y + 0.5, s.z);
  if (inside(s.x, y, s.z)) { bad++; if (process.env.V) console.log('loot inside', s.x.toFixed(1), s.y, s.z.toFixed(1), '->', y); }
}
console.log('loot spots inside solids:', bad);
const nav = buildNav(map);
let unreach = 0;
for (const c of map.chests) if (!nav.reachable(c.x, c.y, c.z)) { unreach++; console.log('bag unreachable', c); }
console.log('bags unreachable:', unreach);
